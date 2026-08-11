#!/bin/bash
set -Eeuo pipefail

SCRIPT_PATH="$(realpath -- "${BASH_SOURCE[0]}")"
REPO_DIR="${SCRIPT_PATH%/*/*}"
HELPER="$REPO_DIR/scripts/lib/package-provenance.py"
TEST_TMP=""

fail() {
    printf 'package provenance test failed: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    if [ -n "$TEST_TMP" ]; then
        rm -rf "$TEST_TMP"
    fi
}
trap cleanup EXIT

expect_failure() {
    local label="$1"
    shift
    if "$@" >"$TEST_TMP/stdout" 2>"$TEST_TMP/stderr"; then
        fail "$label unexpectedly succeeded"
    fi
}

write_manifest() {
    python3 "$HELPER" manifest "$1" "$2"
}

copy_fixture() {
    local destination="$1"
    mkdir -p "$destination/usr/bin" "$destination/usr/share/chatgpt"
    printf '#!/bin/sh\nexit 0\n' >"$destination/usr/bin/chatgpt"
    chmod 0755 "$destination/usr/bin/chatgpt"
    printf 'payload\n' >"$destination/usr/share/chatgpt/data.txt"
    ln -s ../share/chatgpt/data.txt "$destination/usr/link"
}

assert_manifest_mismatch() {
    local label="$1"
    local expected_root="$2"
    local actual_root="$3"
    write_manifest "$expected_root" "$TEST_TMP/expected.json"
    write_manifest "$actual_root" "$TEST_TMP/actual.json"
    expect_failure "$label" \
        python3 "$HELPER" compare "$TEST_TMP/expected.json" "$TEST_TMP/actual.json"
}

test_manifest_contract() {
    local expected="$TEST_TMP/expected"
    local actual="$TEST_TMP/actual"
    copy_fixture "$expected"
    cp -a "$expected" "$actual"

    write_manifest "$expected" "$TEST_TMP/expected.json"
    write_manifest "$actual" "$TEST_TMP/actual.json"
    python3 "$HELPER" compare "$TEST_TMP/expected.json" "$TEST_TMP/actual.json"

    printf 'extra\n' >"$actual/usr/share/chatgpt/extra.txt"
    assert_manifest_mismatch "added file" "$expected" "$actual"
    rm "$actual/usr/share/chatgpt/extra.txt"

    printf 'changed\n' >"$actual/usr/share/chatgpt/data.txt"
    assert_manifest_mismatch "changed file" "$expected" "$actual"
    cp "$expected/usr/share/chatgpt/data.txt" "$actual/usr/share/chatgpt/data.txt"

    rm "$actual/usr/share/chatgpt/data.txt"
    assert_manifest_mismatch "removed file" "$expected" "$actual"
    cp "$expected/usr/share/chatgpt/data.txt" "$actual/usr/share/chatgpt/data.txt"

    chmod 0600 "$actual/usr/share/chatgpt/data.txt"
    assert_manifest_mismatch "changed mode" "$expected" "$actual"
    chmod 0644 "$actual/usr/share/chatgpt/data.txt"

    rm "$actual/usr/link"
    ln -s ../share/chatgpt/other.txt "$actual/usr/link"
    assert_manifest_mismatch "changed symlink" "$expected" "$actual"

    mkfifo "$actual/usr/share/chatgpt/pipe"
    expect_failure "special file manifest" \
        python3 "$HELPER" manifest "$actual" "$TEST_TMP/special.json"
}

test_mutable_manifest_rejects_hardlinks() {
    local root="$TEST_TMP/mutable-hardlinks"
    copy_fixture "$root"
    ln "$root/usr/share/chatgpt/data.txt" "$root/usr/share/chatgpt/data-hardlink.txt"

    expect_failure "mutable hard-linked manifest" \
        python3 "$HELPER" manifest "$root" "$TEST_TMP/mutable-hardlinks.json"
    grep -Fq 'hard-linked files are not allowed in package payloads' "$TEST_TMP/stderr" || \
        fail "mutable manifest hardlink rejection was not explicit"
}

test_immutable_nix_store_policy_predicates() {
    python3 - "$HELPER" <<'PY' || \
        fail "immutable Nix store policy predicates failed"
import importlib.util
import pathlib
import stat
import sys
import types

spec = importlib.util.spec_from_file_location("package_provenance", sys.argv[1])
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

store_component = "0" * 32 + "-chatgpt-release-app-1.2.3"
store_root = pathlib.Path("/nix/store") / store_component
app = store_root / "opt/chatgpt"
receipt_root = store_root / "opt/.chatgpt-generation-receipts"
receipt = receipt_root / ("1" * 64 + ".json")
runtime = app / "runtime"

def stat_result(*, file_type, mode, uid, links, inode):
    return types.SimpleNamespace(
        st_ctime_ns=1,
        st_dev=1,
        st_gid=0,
        st_ino=inode,
        st_mode=file_type | mode,
        st_mtime_ns=1,
        st_nlink=links,
        st_size=1,
        st_uid=uid,
    )

def directory(uid=0, mode=0o555, inode=1):
    return stat_result(
        file_type=stat.S_IFDIR,
        mode=mode,
        uid=uid,
        links=1,
        inode=inode,
    )

def file(uid=0, mode=0o444, links=2, inode=2):
    return stat_result(
        file_type=stat.S_IFREG,
        mode=mode,
        uid=uid,
        links=links,
        inode=inode,
    )

metadata = {
    store_root: directory(),
    store_root / "opt": directory(),
    app: directory(),
    runtime: file(),
    receipt_root: directory(),
    receipt: file(),
}
module._lstat_path = lambda path: metadata[path]

assert module.canonical_nix_store_output_root(runtime) == store_root
assert module.immutable_nix_store_path_is_trusted(runtime, directory=False)
assert module.immutable_nix_store_path_is_trusted(
    runtime,
    directory=False,
    expected_metadata=metadata[runtime],
)
assert not module.immutable_nix_store_path_is_trusted(
    runtime,
    directory=False,
    expected_metadata=file(inode=99),
)
assert module.immutable_nix_store_path_is_trusted(receipt, directory=False)
assert module.canonical_nix_store_output_root(pathlib.Path("/tmp") / store_component) is None
assert module.canonical_nix_store_output_root(
    pathlib.Path("/nix/store") / ("e" * 32 + "-invalid") / "opt/chatgpt"
) is None
assert module.canonical_nix_store_output_root(
    pathlib.Path(f"{store_root}/opt/../opt/chatgpt")
) is None

metadata[receipt_root] = directory(mode=0o575)
assert not module.immutable_nix_store_path_is_trusted(receipt, directory=False)
metadata[receipt_root] = directory()
metadata[store_root] = directory(mode=0o575)
assert not module.immutable_nix_store_path_is_trusted(runtime, directory=False)
metadata[store_root] = directory()
metadata[runtime] = file(uid=65534)
assert not module.immutable_nix_store_path_is_trusted(runtime, directory=False)
metadata[runtime] = file()
symlink = directory()
symlink.st_mode = stat.S_IFLNK | 0o777
metadata[app] = symlink
assert not module.immutable_nix_store_path_is_trusted(runtime, directory=False)
PY
}

test_tar_manifest_binds_install_metadata() {
    python3 - "$TEST_TMP/archive-root.tar" "$TEST_TMP/archive-user.tar" \
        "$TEST_TMP/archive-xattr.tar" <<'PY'
import io
import pathlib
import tarfile
import sys

payload = b"package payload\n"
for output, uid, pax_headers in (
    (sys.argv[1], 0, {}),
    (sys.argv[2], 1234, {}),
    (sys.argv[3], 0, {"SCHILY.xattr.security.capability": "safe-test-value"}),
):
    with tarfile.open(output, "w", format=tarfile.PAX_FORMAT) as archive:
        entry = tarfile.TarInfo("usr/lib/chatgpt/helper")
        entry.mode = 0o755
        entry.uid = uid
        entry.gid = uid
        entry.uname = "root" if uid == 0 else "untrusted"
        entry.gname = entry.uname
        entry.mtime = 1700000000
        entry.size = len(payload)
        entry.pax_headers = pax_headers
        archive.addfile(entry, io.BytesIO(payload))
PY
    python3 "$HELPER" tar-manifest "$TEST_TMP/root-tar.json" \
        <"$TEST_TMP/archive-root.tar"
    python3 "$HELPER" tar-manifest "$TEST_TMP/user-tar.json" \
        <"$TEST_TMP/archive-user.tar"
    python3 "$HELPER" tar-manifest "$TEST_TMP/xattr-tar.json" \
        <"$TEST_TMP/archive-xattr.tar"
    expect_failure "archive numeric ownership change" \
        python3 "$HELPER" compare "$TEST_TMP/root-tar.json" "$TEST_TMP/user-tar.json"
    grep -Fq "changed usr/lib/chatgpt/helper" "$TEST_TMP/stderr" || \
        fail "archive ownership rejection did not identify the changed entry"
    expect_failure "archive extended attribute change" \
        python3 "$HELPER" compare "$TEST_TMP/root-tar.json" "$TEST_TMP/xattr-tar.json"
    grep -Fq "changed usr/lib/chatgpt/helper" "$TEST_TMP/stderr" || \
        fail "archive xattr rejection did not identify the changed entry"
}

test_snapshot_binds_opened_inode() {
    local source="$TEST_TMP/chatgpt.pkg"
    local replacement="$TEST_TMP/replacement.pkg"
    local snapshot_dir="$TEST_TMP/private"
    local snapshot="$snapshot_dir/chatgpt.pkg"
    mkdir -m 0700 "$snapshot_dir"
    printf 'reviewed package\n' >"$source"
    printf 'replacement package\n' >"$replacement"

    python3 "$HELPER" snapshot "$source" "$snapshot" >"$TEST_TMP/snapshot.json"
    mv -f "$replacement" "$source"

    cmp -s "$snapshot" <(printf 'reviewed package\n') || \
        fail "snapshot did not preserve the reviewed inode contents"
    python3 - "$TEST_TMP/snapshot.json" "$snapshot" <<'PY'
import hashlib
import json
import pathlib
import sys

record = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
payload = pathlib.Path(sys.argv[2]).read_bytes()
assert record["sha256"] == hashlib.sha256(payload).hexdigest()
assert record["size"] == len(payload)
PY

    ln -s "$source" "$TEST_TMP/package-link"
    expect_failure "symlink package snapshot" \
        python3 "$HELPER" snapshot "$TEST_TMP/package-link" "$snapshot_dir/link-copy"

    printf 'preexisting destination\n' >"$snapshot_dir/existing"
    expect_failure "existing snapshot destination" \
        python3 "$HELPER" snapshot "$source" "$snapshot_dir/existing"
    grep -Fxq 'preexisting destination' "$snapshot_dir/existing" || \
        fail "failed snapshot attempt removed or changed a preexisting destination"
}

test_tree_snapshot_is_private_and_stable() {
    local source="$TEST_TMP/tree-source"
    local private="$TEST_TMP/tree-private"
    local snapshot="$private/app"
    mkdir -p "$source/subdir" "$private"
    chmod 0700 "$private"
    printf 'reviewed tree file\n' >"$source/subdir/file"
    chmod 0640 "$source/subdir/file"
    ln -s subdir/file "$source/link"

    python3 "$HELPER" snapshot-tree "$source" "$snapshot" >"$TEST_TMP/tree-snapshot.json"
    [ "$(stat -c '%a' "$snapshot")" = "700" ] || fail "tree snapshot root is not private"
    [ "$(stat -c '%a' "$snapshot/subdir/file")" = "640" ] || \
        fail "tree snapshot did not preserve file mode"
    [ "$(readlink "$snapshot/link")" = "subdir/file" ] || \
        fail "tree snapshot did not preserve symlink target"
    printf 'changed after snapshot\n' >"$source/subdir/file"
    grep -Fxq 'reviewed tree file' "$snapshot/subdir/file" || \
        fail "tree snapshot did not bind the copied file contents"

    ln "$source/subdir/file" "$source/subdir/hardlink"
    expect_failure "hard-linked tree source" \
        python3 "$HELPER" snapshot-tree "$source" "$private/hardlink-copy"

    mkfifo "$source/subdir/fifo"
    expect_failure "special-file tree source" \
        python3 "$HELPER" snapshot-tree "$source" "$private/special-copy"
}

test_provenance_is_canonical() {
    cat >"$TEST_TMP/provenance-input.json" <<'JSON'
{
  "releaseMode": "rehearsal",
  "publicReleaseEligible": false,
  "officialDmg": {"sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
  "generatedApp": {"manifestSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "buildInfoSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
  "source": {"commit": "0123456789012345678901234567890123456789", "dirty": true},
  "config": {"sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "packageBuild": {"sourceDateEpoch": 1700000000, "withUpdater": false}},
  "packages": [{"format": "deb", "name": "chatgpt", "version": "1.2.3", "arch": "amd64", "payloadManifestSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "controlManifestSha256": "abababababababababababababababababababababababababababababababab", "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "filename": "chatgpt_1.2.3_amd64.deb"}]
}
JSON
    python3 "$HELPER" provenance \
        "$TEST_TMP/provenance-input.json" "$TEST_TMP/provenance.json"
    python3 "$HELPER" provenance \
        "$TEST_TMP/provenance-input.json" "$TEST_TMP/provenance-second.json"
    cmp -s "$TEST_TMP/provenance.json" "$TEST_TMP/provenance-second.json" || \
        fail "provenance output is not deterministic"
    python3 - "$TEST_TMP/provenance.json" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["schemaVersion"] == 1
assert payload["publicReleaseEligible"] is False
assert payload["packages"][0]["sha256"] == "f" * 64
assert payload["packages"][0]["controlManifestSha256"] == "ab" * 32
PY

    python3 - "$TEST_TMP/provenance-input.json" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = json.loads(path.read_text(encoding="utf-8"))
payload["publicReleaseEligible"] = True
path.write_text(json.dumps(payload), encoding="utf-8")
PY
    expect_failure "rehearsal marked public-release eligible" \
        python3 "$HELPER" provenance \
            "$TEST_TMP/provenance-input.json" "$TEST_TMP/invalid-rehearsal.json"
    grep -Fq 'publicReleaseEligible must exactly match releaseMode' "$TEST_TMP/stderr" || \
        fail "rehearsal eligibility mismatch was not rejected explicitly"

    python3 - "$TEST_TMP/provenance-input.json" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = json.loads(path.read_text(encoding="utf-8"))
payload["releaseMode"] = "public"
payload["publicReleaseEligible"] = False
path.write_text(json.dumps(payload), encoding="utf-8")
PY
    expect_failure "public release marked ineligible" \
        python3 "$HELPER" provenance \
            "$TEST_TMP/provenance-input.json" "$TEST_TMP/invalid-public.json"
    grep -Fq 'publicReleaseEligible must exactly match releaseMode' "$TEST_TMP/stderr" || \
        fail "public eligibility mismatch was not rejected explicitly"
}

test_build_info_binds_integration_inputs() {
    local digest="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    local commit="0123456789012345678901234567890123456789"
    cat >"$TEST_TMP/resolved.json" <<'JSON'
{"enabled":["pet-overlay"],"disabled":[],"settings":{"pet-overlay":{"size":"small"}}}
JSON
    cat >"$TEST_TMP/integration-inputs.json" <<'JSON'
{"schemaVersion":1,"rootKind":"checkout","resolvedConfig":{"enabled":["pet-overlay"],"disabled":[],"settings":{"pet-overlay":{"size":"small"}}},"integrations":[{"id":"pet-overlay","origin":"repo"}],"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
JSON
    cat >"$TEST_TMP/build-info.json" <<JSON
{"schemaVersion":1,"officialDmg":{"sha256":"$digest","appVersion":"1.2.3"},"source":{"commit":"$commit","dirty":false},"portIntegrations":{"enabled":["pet-overlay"],"resolved":{"enabled":["pet-overlay"],"disabled":[],"settings":{"pet-overlay":{"size":"small"}}},"rootKind":"checkout","inputsSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}
JSON
    python3 "$HELPER" validate-build-info \
        --build-info "$TEST_TMP/build-info.json" \
        --dmg-sha256 "$digest" \
        --dmg-app-version 1.2.3 \
        --source-commit "$commit" \
        --resolved-config "$TEST_TMP/resolved.json" \
        --integration-inputs "$TEST_TMP/integration-inputs.json" \
        --public-release

    sed -i 's/"small"/"large"/g' "$TEST_TMP/resolved.json" "$TEST_TMP/integration-inputs.json"
    expect_failure "same integration ids with changed settings" \
        python3 "$HELPER" validate-build-info \
            --build-info "$TEST_TMP/build-info.json" \
            --dmg-sha256 "$digest" \
            --dmg-app-version 1.2.3 \
            --source-commit "$commit" \
            --resolved-config "$TEST_TMP/resolved.json" \
            --integration-inputs "$TEST_TMP/integration-inputs.json" \
            --public-release
    grep -Fq 'full resolved port integration config' "$TEST_TMP/stderr" || \
        fail "settings mismatch was not rejected explicitly"

    sed -i 's/"large"/"small"/g; s/"checkout"/"external"/g' \
        "$TEST_TMP/resolved.json" "$TEST_TMP/integration-inputs.json" "$TEST_TMP/build-info.json"
    expect_failure "external integration root" \
        python3 "$HELPER" validate-build-info \
            --build-info "$TEST_TMP/build-info.json" \
            --dmg-sha256 "$digest" \
            --dmg-app-version 1.2.3 \
            --source-commit "$commit" \
            --resolved-config "$TEST_TMP/resolved.json" \
            --integration-inputs "$TEST_TMP/integration-inputs.json" \
            --public-release
    grep -Fq 'must come from the reviewed checkout' "$TEST_TMP/stderr" || \
        fail "external integration root was not rejected explicitly"
}

test_public_mode_requires_signature() {
    expect_failure "unsigned public release mode" \
        env -u CHATGPT_RELEASE_REHEARSAL \
            -u CHATGPT_RELEASE_GPG_KEY \
            REQUIRE_RELEASE_SIGNATURE=0 \
            bash "$REPO_DIR/scripts/release-gate.sh"
    grep -Fq 'Public release mode requires REQUIRE_RELEASE_SIGNATURE=1' "$TEST_TMP/stderr" || \
        fail "unsigned default invocation was not rejected as public release mode"
}

test_packaged_source_epoch_without_git() {
    local bundle="$TEST_TMP/packaged-source"
    local fake_bin="$TEST_TMP/fake-bin"
    local git_marker="$TEST_TMP/ambient-git-ran"
    local observed
    mkdir -p "$bundle/scripts/lib" "$bundle/.chatgpt-linux" "$fake_bin"
    cp "$REPO_DIR/scripts/lib/package-common.sh" "$bundle/scripts/lib/package-common.sh"
    cp "$REPO_DIR/scripts/lib/generated-app-mutation-broker.sh" \
        "$bundle/scripts/lib/generated-app-mutation-broker.sh"
    printf '{"sourceDateEpoch":1700000000}\n' >"$bundle/.chatgpt-linux/source-info.json"
    printf '#!/bin/sh\ntouch %q\nexit 91\n' "$git_marker" >"$fake_bin/git"
    chmod 0755 "$fake_bin/git"

    # The child shell script deliberately expands its own positional parameters.
    # shellcheck disable=SC2016
    observed="$(PATH="$fake_bin:$PATH" "$BASH" -c '
        source "$1"
        REPO_DIR="$2"
        APP_DIR="$2/app"
        unset SOURCE_DATE_EPOCH
        ensure_package_source_date_epoch
        printf "%s\n" "$SOURCE_DATE_EPOCH"
    ' _ "$bundle/scripts/lib/package-common.sh" "$bundle")"
    [ "$observed" = "1700000000" ] || \
        fail "packaged source did not recover SOURCE_DATE_EPOCH without .git"
    [ ! -e "$git_marker" ] || fail "packaged source epoch lookup invoked ambient Git"
}

test_package_node_override_ignores_generated_app_runtime() {
    local fixture="$TEST_TMP/node-override"
    local marker="$fixture/generated-node-ran"
    local selected
    mkdir -p "$fixture/app/resources/node-runtime/bin"
    printf '#!/bin/sh\ntouch %q\nexit 97\n' "$marker" \
        >"$fixture/app/resources/node-runtime/bin/node"
    chmod 0755 "$fixture/app/resources/node-runtime/bin/node"

    # The child shell deliberately expands its own positional parameter.
    # shellcheck disable=SC2016
    selected="$(APP_DIR="$fixture/app" CHATGPT_PACKAGE_NODE_SOURCE="$(readlink -f /usr/bin/node)" \
        "$BASH" -c 'source "$1"; package_node_binary' _ \
        "$REPO_DIR/scripts/lib/package-common.sh")"
    [ "$selected" = "$(readlink -f /usr/bin/node)" ] || \
        fail "package Node override did not select the trusted system runtime"
    [ ! -e "$marker" ] || fail "package Node override executed the generated-app runtime"
}

test_package_git_ignores_ambient_config() {
    local fsmonitor_hook="$TEST_TMP/ambient-fsmonitor.sh"
    local fsmonitor_marker="$TEST_TMP/ambient-fsmonitor-ran"
    printf '#!/bin/sh\ntouch %q\nexit 1\n' "$fsmonitor_marker" >"$fsmonitor_hook"
    chmod 0755 "$fsmonitor_hook"

    # The child shell script deliberately expands its own positional parameters.
    # shellcheck disable=SC2016
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=core.fsmonitor \
    GIT_CONFIG_VALUE_0="$fsmonitor_hook" \
        "$BASH" -c '
            source "$1"
            REPO_DIR="$2"
            package_git status --porcelain >/dev/null
        ' _ "$REPO_DIR/scripts/lib/package-common.sh" "$REPO_DIR"
    [ ! -e "$fsmonitor_marker" ] || fail "package Git executed ambient core.fsmonitor config"
}

test_packaged_app_fixture_binds_resolved_mutation_broker() {
    local app_dir="$TEST_TMP/packaged-app-fixture"
    local integrations_config="$app_dir.port-integrations.json"

    "$REPO_DIR/tests/fixtures/create-packaged-app-fixture.sh" "$app_dir"

    [ -f "$integrations_config" ] || \
        fail "packaged-app fixture did not write its package-staging integration config"
    [ "$(
        CHATGPT_PORT_INTEGRATIONS_CONFIG="$integrations_config" \
            node "$REPO_DIR/scripts/lib/port-integrations.js" --enabled
    )" = "" ] || fail "packaged-app fixture package-staging integration config is not empty"

    (
        # shellcheck source=scripts/lib/generated-app-mutation-broker.sh
        source "$REPO_DIR/scripts/lib/generated-app-mutation-broker.sh"
        resolve_generated_app_mutation_broker || \
            fail "could not resolve packaged-app fixture mutation broker"

        local actual_digest manifest_digest receipt
        local staged_broker="$TEST_TMP/staged-helpers/chatgpt-generated-app-mutation-broker"
        actual_digest="$(
            generated_app_mutation_broker_sha256 \
                "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
        )"
        manifest_digest="$(read_generated_app_mutation_broker_digest "$app_dir")"
        receipt="$(read_generation_bound_mutation_broker_receipt "$app_dir")"

        [ "$manifest_digest" = "$actual_digest" ] || \
            fail "packaged-app fixture manifest does not bind the resolved broker"
        [ "${receipt%% *}" = "$actual_digest" ] || \
            fail "packaged-app fixture receipt does not bind the resolved broker"
        stage_generation_bound_mutation_broker \
            "$app_dir" \
            "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED" \
            "$staged_broker" || \
            fail "packaged-app fixture rejected its generation-bound broker"
        [ "$(generated_app_mutation_broker_sha256 "$staged_broker")" = "$actual_digest" ] || \
            fail "staged packaged-app fixture broker digest changed"
    )
}

assert_shared_staging_entrypoint() {
    local builder count
    for builder in scripts/build-deb.sh scripts/build-rpm.sh scripts/build-pacman.sh; do
        count="$(grep -c 'stage_native_package_payload' "$REPO_DIR/$builder")"
        [ "$count" -eq 1 ] || fail "$builder does not use exactly one shared payload staging call"
        if grep -Eq '^[[:space:]]*stage_common_package_files ' "$REPO_DIR/$builder"; then
            fail "$builder bypasses the shared payload staging entrypoint"
        fi
    done
    # These assertions intentionally search for literal shell expressions.
    # shellcheck disable=SC2016
    grep -Fq 'stage_native_package_payload "$expected_root" "$format"' \
        "$REPO_DIR/scripts/release-gate.sh" || \
        fail "release gate does not independently restage through the shared entrypoint"
    # shellcheck disable=SC2016
    grep -Fq '"$REPO_DIR/scripts/lib/parcel-watcher"' \
        "$REPO_DIR/scripts/lib/package-common.sh" || \
        fail "update-builder staging does not include the parcel-watcher helper tree"
}

make_rehearsal_fixture() {
    local app_dir="$1"
    local dmg_path="$2"
    local config_path="$3"
    local resolved_path="$4"
    local dmg_sha="$5"
    local source_commit="$6"
    mkdir -p \
        "$app_dir/.chatgpt-linux" \
        "$app_dir/content/webview/assets" \
        "$app_dir/resources"
    printf '#!/usr/bin/env bash\nexit 0\n' >"$app_dir/start.sh"
    chmod 0755 "$app_dir/start.sh"
    printf '<!doctype html><title>ChatGPT package fixture</title>\n' \
        >"$app_dir/content/webview/index.html"
    cp "$REPO_DIR/assets/chatgpt.png" "$app_dir/content/webview/assets/app-fixture.png"
    printf "CHATGPT_APP_PACKAGE_VERSION='1.2.3'\n" >"$app_dir/chatgpt-version.env"
    printf 'official dmg fixture\n' >"$dmg_path"

    node "$REPO_DIR/scripts/lib/port-integrations.js" --integrations-json \
        | python3 -c 'import json,sys; data=json.load(sys.stdin); print(json.dumps({"enabled": [], "disabled": sorted(item["id"] for item in data)}))' \
        >"$config_path"
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$config_path" \
        node "$REPO_DIR/scripts/lib/port-integrations.js" --resolved-config-json >"$resolved_path"
    local inputs_path="${resolved_path%.json}-inputs.json"
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$config_path" \
        node "$REPO_DIR/scripts/lib/port-integrations.js" --build-inputs-json >"$inputs_path"
    python3 - "$app_dir/.chatgpt-linux/build-info.json" "$resolved_path" "$inputs_path" "$dmg_sha" "$source_commit" <<'PY'
import json
import pathlib
import sys

resolved = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
inputs = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
payload = {
    "schemaVersion": 1,
    "officialDmg": {"sha256": sys.argv[4]},
    "source": {"commit": sys.argv[5], "dirty": True},
    "portIntegrations": {
        "enabled": resolved["enabled"],
        "resolved": resolved,
        "rootKind": inputs["rootKind"],
        "inputsSha256": inputs["sha256"],
    },
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(payload) + "\n", encoding="utf-8")
PY
    local broker_digest
    broker_digest="$(printf '0%.0s' {1..64})"
    printf '%s  %s\n' \
        "$broker_digest" \
        "chatgpt-generated-app-mutation-broker" \
        > "$app_dir/.chatgpt-linux/generated-app-mutation-broker.sha256"
    python3 "$HELPER" write-generation-receipt \
        --app "$app_dir" \
        --broker-sha256 "$broker_digest" >/dev/null
}

run_rehearsal_gate() {
    local app_dir="$1"
    local dist_dir="$2"
    local dmg_path="$3"
    local dmg_sha="$4"
    local config_path="$5"
    APP_DIR="$app_dir" \
    DIST_DIR="$dist_dir" \
    DMG="$dmg_path" \
    CHATGPT_DMG_SHA256="$dmg_sha" \
    CHATGPT_RELEASE_REHEARSAL=1 \
    CHATGPT_RELEASE_REHEARSAL_SKIP_APP_INSPECTION=1 \
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$config_path" \
    PACKAGE_WITH_UPDATER=0 \
    SOURCE_DATE_EPOCH=1700000000 \
        bash "$REPO_DIR/scripts/release-gate.sh"
}

test_available_native_package_fixture() {
    command -v makepkg >/dev/null 2>&1 || {
        printf 'package provenance test: skipping pacman integration fixture; makepkg unavailable\n' >&2
        return
    }
    command -v pacman >/dev/null 2>&1 || fail "makepkg is available but pacman is not"
    command -v bsdtar >/dev/null 2>&1 || fail "makepkg is available but bsdtar is not"

    local workspace="$TEST_TMP/pacman-integration"
    local app_dir="$workspace/app"
    local dist_dir="$workspace/dist"
    local dmg_path="$workspace/ChatGPT.dmg"
    local config_path="$workspace/integrations.json"
    local resolved_path="$workspace/resolved.json"
    local source_commit dmg_sha package_path saved_package saved_start tamper_root
    mkdir -p "$workspace" "$dist_dir"
    source_commit="$(git -C "$REPO_DIR" rev-parse HEAD)"
    printf 'official dmg fixture\n' >"$dmg_path"
    dmg_sha="$(sha256sum "$dmg_path" | awk '{print $1}')"
    make_rehearsal_fixture \
        "$app_dir" "$dmg_path" "$config_path" "$resolved_path" "$dmg_sha" "$source_commit"

    APP_DIR_OVERRIDE="$app_dir" \
    DIST_DIR_OVERRIDE="$dist_dir" \
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$config_path" \
    PACKAGE_WITH_UPDATER=0 \
    SOURCE_DATE_EPOCH=1700000000 \
        bash "$REPO_DIR/scripts/build-pacman.sh" >"$workspace/build.log" 2>&1
    package_path="$(find "$dist_dir" -maxdepth 1 -type f -name 'chatgpt-*.pkg.tar.*' -print -quit)"
    [ -n "$package_path" ] || fail "pacman fixture did not produce a package"
    saved_package="$workspace/reviewed-package.pkg.tar.zst"
    cp "$package_path" "$saved_package"

    if ! run_rehearsal_gate "$app_dir" "$dist_dir" "$dmg_path" "$dmg_sha" "$config_path" \
        >"$workspace/gate-valid.log" 2>&1; then
        sed -n '1,240p' "$workspace/gate-valid.log" >&2
        fail "valid pacman fixture was rejected"
    fi
    [ -s "$dist_dir/SHA256SUMS" ] || fail "valid package did not produce checksums"
    [ -s "$dist_dir/RELEASE-PROVENANCE.json" ] || fail "valid package did not produce provenance"
    python3 - "$dist_dir/RELEASE-PROVENANCE.json" "$package_path" <<'PY'
import hashlib
import json
import pathlib
import sys

provenance = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
package_digest = hashlib.sha256(pathlib.Path(sys.argv[2]).read_bytes()).hexdigest()
assert provenance["releaseMode"] == "rehearsal"
assert provenance["publicReleaseEligible"] is False
assert provenance["packages"][0]["sha256"] == package_digest
assert len(provenance["packages"][0]["controlManifestSha256"]) == 64
PY

    if command -v gpg >/dev/null 2>&1; then
        local signing_home="$workspace/gnupg"
        local signing_key
        mkdir -m 0700 "$signing_home"
        GNUPGHOME="$signing_home" gpg --batch --passphrase '' \
            --quick-gen-key 'ChatGPT package provenance test <chatgpt-package-test@example.invalid>' \
            ed25519 sign 0 >/dev/null 2>&1
        signing_key="$(GNUPGHOME="$signing_home" gpg --batch --with-colons --list-secret-keys \
            | awk -F: '$1 == "fpr" { print $10; exit }')"
        [ -n "$signing_key" ] || fail "could not resolve disposable signing key"
        if GNUPGHOME="$signing_home" \
            REQUIRE_RELEASE_SIGNATURE=1 \
            CHATGPT_RELEASE_GPG_KEY="$signing_key" \
            CHATGPT_RELEASE_GPG_FINGERPRINT="$(printf '0%.0s' {1..40})" \
                run_rehearsal_gate "$app_dir" "$dist_dir" "$dmg_path" "$dmg_sha" "$config_path" \
                >"$workspace/gate-wrong-signing-key.log" 2>&1; then
            fail "mismatched release signing fingerprint unexpectedly passed"
        fi
        if ! grep -Fq 'does not match CHATGPT_RELEASE_GPG_FINGERPRINT' \
            "$workspace/gate-wrong-signing-key.log"; then
            sed -n '1,160p' "$workspace/gate-wrong-signing-key.log" >&2
            fail "signing fingerprint mismatch was not rejected explicitly"
        fi
        GNUPGHOME="$signing_home" \
        REQUIRE_RELEASE_SIGNATURE=1 \
        CHATGPT_RELEASE_GPG_KEY="$signing_key" \
        CHATGPT_RELEASE_GPG_FINGERPRINT="$signing_key" \
            run_rehearsal_gate "$app_dir" "$dist_dir" "$dmg_path" "$dmg_sha" "$config_path" \
            >"$workspace/gate-signed.log" 2>&1
        python3 - "$dist_dir/RELEASE-PROVENANCE.json" "$signing_key" <<'PY'
import json
import pathlib
import sys

provenance = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert provenance["signing"]["primaryFingerprint"] == sys.argv[2].upper()
PY
        local verify_home="$workspace/verify-gnupg"
        mkdir -m 0700 "$verify_home"
        GNUPGHOME="$verify_home" gpg --batch --import "$dist_dir/release-signing-key.asc" \
            >/dev/null 2>&1
        GNUPGHOME="$verify_home" gpg --batch \
            --verify "$dist_dir/SHA256SUMS.asc" "$dist_dir/SHA256SUMS" >/dev/null 2>&1 || \
            fail "checksum signature did not verify with the exported key"
        GNUPGHOME="$verify_home" gpg --batch \
            --verify "$dist_dir/RELEASE-PROVENANCE.json.asc" "$dist_dir/RELEASE-PROVENANCE.json" \
            >/dev/null 2>&1 || fail "provenance signature did not verify with the exported key"
    fi

    saved_start="$workspace/start.sh"
    cp "$app_dir/start.sh" "$saved_start"
    printf '#!/usr/bin/env bash\nprintf stale\n' >"$app_dir/start.sh"
    chmod 0755 "$app_dir/start.sh"
    expect_failure "stale package against changed app" \
        run_rehearsal_gate "$app_dir" "$dist_dir" "$dmg_path" "$dmg_sha" "$config_path"
    [ ! -e "$dist_dir/SHA256SUMS" ] || fail "stale package failure left checksums behind"
    [ ! -e "$dist_dir/RELEASE-PROVENANCE.json" ] || fail "stale package failure left provenance behind"
    cp "$saved_start" "$app_dir/start.sh"

    tamper_root="$workspace/tamper"
    mkdir "$tamper_root"
    bsdtar -xf "$package_path" -C "$tamper_root"
    printf 'unreviewed extra file\n' >"$tamper_root/usr/share/chatgpt-unreviewed.txt"
    rm "$package_path"
    (
        cd "$tamper_root"
        shopt -s dotglob nullglob
        local -a archive_entries=(*)
        bsdtar -caf "$package_path" --uid 0 --gid 0 --uname root --gname root \
            "${archive_entries[@]}"
    )
    expect_failure "same-name package with extra file" \
        run_rehearsal_gate "$app_dir" "$dist_dir" "$dmg_path" "$dmg_sha" "$config_path"
    if ! grep -Fq 'added usr/share/chatgpt-unreviewed.txt' "$TEST_TMP/stderr"; then
        sed -n '1,240p' "$TEST_TMP/stderr" >&2
        fail "extra-file rejection did not identify the payload addition"
    fi
    [ ! -e "$dist_dir/SHA256SUMS" ] || fail "extra-file failure left checksums behind"
    [ ! -e "$dist_dir/RELEASE-PROVENANCE.json" ] || fail "extra-file failure left provenance behind"

    rm -rf "$tamper_root"
    mkdir "$tamper_root"
    bsdtar -xf "$saved_package" -C "$tamper_root"
    printf '\npost_install() { printf unreviewed-maintainer-hook; }\n' >>"$tamper_root/.INSTALL"
    rm -f "$package_path"
    (
        cd "$tamper_root"
        shopt -s dotglob nullglob
        local -a archive_entries=(*)
        bsdtar -caf "$package_path" --uid 0 --gid 0 --uname root --gname root \
            "${archive_entries[@]}"
    )
    expect_failure "same-name package with altered maintainer hook" \
        run_rehearsal_gate "$app_dir" "$dist_dir" "$dmg_path" "$dmg_sha" "$config_path"
    if ! grep -Fq 'changed INSTALL' "$TEST_TMP/stderr"; then
        sed -n '1,240p' "$TEST_TMP/stderr" >&2
        fail "maintainer-hook rejection did not identify the changed install hook"
    fi
    [ ! -e "$dist_dir/SHA256SUMS" ] || fail "maintainer-hook failure left checksums behind"
    [ ! -e "$dist_dir/RELEASE-PROVENANCE.json" ] || fail "maintainer-hook failure left provenance behind"
}

main() {
    [ -f "$HELPER" ] || fail "missing canonical helper: $HELPER"
    TEST_TMP="$(mktemp -d)"
    test_manifest_contract
    test_mutable_manifest_rejects_hardlinks
    test_immutable_nix_store_policy_predicates
    test_tar_manifest_binds_install_metadata
    test_snapshot_binds_opened_inode
    test_tree_snapshot_is_private_and_stable
    test_provenance_is_canonical
    test_build_info_binds_integration_inputs
    test_public_mode_requires_signature
    test_packaged_source_epoch_without_git
    test_package_node_override_ignores_generated_app_runtime
    test_package_git_ignores_ambient_config
    test_packaged_app_fixture_binds_resolved_mutation_broker
    assert_shared_staging_entrypoint
    test_available_native_package_fixture
    printf 'package provenance tests passed\n'
}

main "$@"
