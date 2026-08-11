#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_ROOT="$REPO_DIR/tests/fixtures/parcel-watcher-trust"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT
export npm_config_cache="$TMP_DIR/npm-cache"
mkdir -p "$npm_config_cache"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_file_exists() {
    [ -f "$1" ] || fail "expected file: $1"
}

assert_file_missing() {
    [ ! -e "$1" ] || fail "unexpected file: $1"
}

assert_contains() {
    local path="$1"
    local pattern="$2"
    grep -Fq -- "$pattern" "$path" || fail "expected '$pattern' in $path"
}

sha256_file() {
    sha256sum "$1" | awk '{print $1}'
}

pack_fixture() {
    local source_dir="$1"
    local archive_dir="$2"
    npm pack "$source_dir" --pack-destination "$archive_dir" --ignore-scripts --loglevel=error >/dev/null
}

create_approved_bundle() {
    local bundle_dir="$1"
    local archive_dir="$TMP_DIR/package-archives"
    local lock_dir="$TMP_DIR/package-lock"

    mkdir -p "$archive_dir" "$lock_dir/archives" "$bundle_dir/archives"
    pack_fixture "$FIXTURE_ROOT/watcher" "$archive_dir"
    pack_fixture "$FIXTURE_ROOT/transitive" "$archive_dir"
    pack_fixture "$FIXTURE_ROOT/native" "$archive_dir"
    cp "$archive_dir"/*.tgz "$lock_dir/archives/"

    cat > "$lock_dir/package.json" <<'JSON'
{
  "name": "chatgpt-parcel-watcher-offline",
  "private": true,
  "version": "1.0.0",
  "dependencies": {
    "@parcel/watcher": "file:archives/parcel-watcher-2.5.6.tgz",
    "parcel-watcher-transitive-fixture": "file:archives/parcel-watcher-transitive-fixture-1.0.0.tgz"
  },
  "optionalDependencies": {
    "@parcel/watcher-linux-x64-glibc": "file:archives/parcel-watcher-linux-x64-glibc-2.5.6.tgz"
  }
}
JSON

    (
        cd "$lock_dir"
        npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund >/dev/null
    )
    cp "$lock_dir/package.json" "$bundle_dir/package.json"
    cp "$lock_dir/package-lock.json" "$bundle_dir/package-lock.json"

    local archive
    for archive in "$archive_dir"/*.tgz; do
        base64 -w 0 "$archive" > "$bundle_dir/archives/$(basename "$archive").base64"
        printf '\n' >> "$bundle_dir/archives/$(basename "$archive").base64"
    done

    node - "$bundle_dir" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const digestFile = (file) => digest(fs.readFileSync(file));
const archives = fs.readdirSync(path.join(root, "archives"))
  .filter((name) => name.endsWith(".tgz.base64"))
  .sort()
  .map((name) => {
    const encodedFile = path.join(root, "archives", name);
    const archiveBytes = Buffer.from(fs.readFileSync(encodedFile, "utf8").replace(/\s+/gu, ""), "base64");
    return {
      encodedFile: `archives/${name}`,
      archiveFile: name.slice(0, -".base64".length),
      sha256: digest(archiveBytes),
    };
  });
const manifest = {
  schemaVersion: 1,
  watcherVersion: "2.5.6",
  packageJsonSha256: digestFile(path.join(root, "package.json")),
  packageLockSha256: digestFile(path.join(root, "package-lock.json")),
  archives,
};
fs.writeFileSync(path.join(root, "approved.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
NODE
}

tamper_archive() {
    local bundle_dir="$1"
    local name_fragment="$2"
    local encoded
    local decoded="$TMP_DIR/tampered.tgz"

    encoded="$(find "$bundle_dir/archives" -maxdepth 1 -type f -name "*$name_fragment*.tgz.base64" -print -quit)"
    [ -n "$encoded" ] || fail "missing archive matching $name_fragment"
    base64 -d "$encoded" > "$decoded"
    printf 'tampered' >> "$decoded"
    base64 -w 0 "$decoded" > "$encoded"
    printf '\n' >> "$encoded"
}

run_install_case() {
    local case_name="$1"
    local bundle_source="$2"
    local official_version="$3"
    local expect_success="$4"
    local case_dir="$TMP_DIR/cases/$case_name"
    local fake_repo="$case_dir/repo"
    local work_dir="$case_dir/work"
    local install_dir="$case_dir/install"
    local runtime_dir="$case_dir/node-runtime"
    local output_log="$case_dir/output.log"
    local npm_log="$case_dir/npm.log"
    local electron_log="$case_dir/electron.log"
    local init_marker="$case_dir/init.marker"
    local lifecycle_marker="$case_dir/lifecycle.marker"
    local host_node host_npm

    host_node="$(type -P node)"
    host_npm="$(type -P npm)"
    mkdir -p \
        "$fake_repo/scripts/lib" \
        "$work_dir/app-extracted" \
        "$install_dir/resources" \
        "$runtime_dir/bin"
    cp -a "$bundle_source" "$fake_repo/scripts/lib/parcel-watcher"
    printf 'fixture-asar\n' > "$work_dir/app.asar"
    printf '{"dependencies":{"@parcel/watcher":"%s"}}\n' "$official_version" \
        > "$work_dir/app-extracted/package.json"
    ln -s "$host_node" "$runtime_dir/bin/node"

    cat > "$runtime_dir/bin/npm" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%q ' "$@" >> "$WATCHER_NPM_LOG"
printf '\n' >> "$WATCHER_NPM_LOG"
[ "${1:-}" != install ] || {
    printf 'live npm install attempted\n' >&2
    exit 97
}
exec "$WATCHER_HOST_NPM" "$@"
SCRIPT
    cat > "$install_dir/electron" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%q ' "$@" >> "$WATCHER_ELECTRON_LOG"
printf '\n' >> "$WATCHER_ELECTRON_LOG"
exec "$WATCHER_HOST_NODE" "$@"
SCRIPT
    chmod 0755 "$runtime_dir/bin/npm" "$install_dir/electron"

    if (
        export \
            PARCEL_WATCHER_INIT_MARKER="$init_marker" \
            PARCEL_WATCHER_LIFECYCLE_MARKER="$lifecycle_marker" \
            WATCHER_ELECTRON_LOG="$electron_log" \
            WATCHER_HOST_NODE="$host_node" \
            WATCHER_HOST_NPM="$host_npm" \
            WATCHER_NPM_LOG="$npm_log"
        export npm_config_registry='http://127.0.0.1:9'
        WORK_DIR="$work_dir"
        INSTALL_DIR="$install_dir"
        CHATGPT_MANAGED_NODE_RUNTIME_DIR="$runtime_dir"
        SCRIPT_DIR="$fake_repo"
        export WORK_DIR INSTALL_DIR CHATGPT_MANAGED_NODE_RUNTIME_DIR SCRIPT_DIR
        info() { :; }
        error() { printf '%s\n' "$*" >&2; exit 1; }
        # shellcheck source=scripts/lib/webview-install.sh
        source "$REPO_DIR/scripts/lib/webview-install.sh"
        install_app
    ) >"$output_log" 2>&1; then
        [ "$expect_success" = success ] || fail "$case_name unexpectedly succeeded"
    else
        [ "$expect_success" = failure ] || {
            sed -n '1,200p' "$output_log" >&2
            fail "$case_name unexpectedly failed"
        }
    fi

    local leaked_staging
    # The paths are fixed before the isolated install subshell starts.
    # shellcheck disable=SC2031
    leaked_staging="$(find "$install_dir/resources" -mindepth 1 -maxdepth 1 -name '.parcel-watcher.*' -print -quit)"
    [ -z "$leaked_staging" ] || fail "$case_name leaked private staging directory: $leaked_staging"

    CASE_DIR="$case_dir"
}

BASE_BUNDLE="$TMP_DIR/approved-bundle"
create_approved_bundle "$BASE_BUNDLE"

run_install_case valid "$BASE_BUNDLE" 2.5.6 success
assert_file_exists "$CASE_DIR/install/resources/node_modules/@parcel/watcher/package.json"
assert_file_exists "$CASE_DIR/init.marker"
assert_file_missing "$CASE_DIR/lifecycle.marker"
assert_contains "$CASE_DIR/npm.log" "ci"
assert_contains "$CASE_DIR/npm.log" "--offline"
assert_contains "$CASE_DIR/npm.log" "--ignore-scripts"

run_install_case production-bundle "$REPO_DIR/scripts/lib/parcel-watcher" 2.5.6 success
assert_file_exists "$CASE_DIR/install/resources/node_modules/@parcel/watcher/package.json"
production_native="$(find "$CASE_DIR/install/resources/node_modules/@parcel" -mindepth 2 -maxdepth 2 -type f -name watcher.node -print -quit)"
[ -n "$production_native" ] || fail "production bundle did not install a native watcher for this host"
assert_file_exists "$CASE_DIR/electron.log"
assert_file_missing "$CASE_DIR/lifecycle.marker"
assert_contains "$CASE_DIR/npm.log" "--offline"

run_install_case unsupported-version "$BASE_BUNDLE" 9.9.9 failure
assert_file_missing "$CASE_DIR/npm.log"
assert_file_missing "$CASE_DIR/electron.log"
assert_file_missing "$CASE_DIR/init.marker"
assert_file_missing "$CASE_DIR/install/resources/node_modules"

for archive_kind in parcel-watcher-2.5.6 transitive-fixture linux-x64-glibc; do
    tampered_bundle="$TMP_DIR/tampered-$archive_kind"
    cp -a "$BASE_BUNDLE" "$tampered_bundle"
    tamper_archive "$tampered_bundle" "$archive_kind"
    run_install_case "tampered-$archive_kind" "$tampered_bundle" 2.5.6 failure
    assert_file_missing "$CASE_DIR/electron.log"
    assert_file_missing "$CASE_DIR/init.marker"
    assert_file_missing "$CASE_DIR/install/resources/node_modules"
done

missing_bundle="$TMP_DIR/missing-archive"
cp -a "$BASE_BUNDLE" "$missing_bundle"
rm -f "$(find "$missing_bundle/archives" -maxdepth 1 -type f -name '*transitive-fixture*.tgz.base64' -print -quit)"
run_install_case missing-archive "$missing_bundle" 2.5.6 failure
assert_file_missing "$CASE_DIR/electron.log"
assert_file_missing "$CASE_DIR/init.marker"
assert_file_missing "$CASE_DIR/install/resources/node_modules"

printf 'PASS: Parcel watcher uses only approved offline bytes before initialization\n'
