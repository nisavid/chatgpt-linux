#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(realpath -- "${BASH_SOURCE[0]}")"
REPO_DIR="${SCRIPT_PATH%/*/*}"
FORMAT="${1:-}"
TEST_TMP=""
PACKAGE_VERSION="${CI_RELEASE_GATE_PACKAGE_VERSION:-1.2.3}"
SOURCE_DATE_EPOCH=1700000000

fail() {
    printf 'package release-gate test failed: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    if [ -n "$TEST_TMP" ]; then
        if [ "${CHATGPT_TEST_KEEP_TMP:-0}" = "1" ]; then
            printf 'package release-gate test kept fixture: %s\n' "$TEST_TMP" >&2
        else
            rm -rf "$TEST_TMP"
        fi
    fi
}
trap cleanup EXIT

case "$FORMAT" in
    deb|rpm|pacman) ;;
    *) fail "usage: $0 {deb|rpm|pacman}" ;;
esac

prepare_fixture() {
    TEST_TMP="$(mktemp -d)"
    local app_dir="$TEST_TMP/chatgpt"
    local config_path="$TEST_TMP/integrations.json"
    local resolved_path="$TEST_TMP/resolved.json"
    local inputs_path="$TEST_TMP/integration-inputs.json"
    local integrations_root="$TEST_TMP/port-integrations"
    local dmg_path="$TEST_TMP/ChatGPT.dmg"
    local source_commit dmg_sha

    CHATGPT_FIXTURE_PORT_INTEGRATIONS_JSON='[]' \
        "$REPO_DIR/tests/fixtures/create-packaged-app-fixture.sh" "$app_dir"
    printf "CHATGPT_APP_PACKAGE_VERSION='%s'\n" "$PACKAGE_VERSION" \
        >"$app_dir/chatgpt-version.env"
    printf 'release gate DMG fixture\n' >"$dmg_path"
    dmg_sha="$(sha256sum "$dmg_path" | awk '{print $1}')"
    source_commit="$(git -C "$REPO_DIR" rev-parse HEAD)"
    mkdir -p "$integrations_root/release-gate-fixture"
    cat >"$integrations_root/release-gate-fixture/integration.json" <<'JSON'
{"id":"release-gate-fixture","title":"Release Gate Fixture","description":"Test-only package provenance input.","defaultEnabled":true}
JSON
    printf 'release gate integration input\n' \
        >"$integrations_root/release-gate-fixture/README.md"
    printf '{"enabled":[],"disabled":[]}\n' >"$config_path"
    CHATGPT_PORT_INTEGRATIONS_ROOT="$integrations_root" \
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$config_path" \
        node "$REPO_DIR/scripts/lib/port-integrations.js" --resolved-config-json \
            >"$resolved_path"
    CHATGPT_PORT_INTEGRATIONS_ROOT="$integrations_root" \
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$config_path" \
        node "$REPO_DIR/scripts/lib/port-integrations.js" --build-inputs-json \
            >"$inputs_path"
    python3 - "$app_dir/.chatgpt-linux/build-info.json" "$resolved_path" "$inputs_path" \
        "$dmg_sha" "$source_commit" <<'PY'
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
    broker_digest="$(
        sed -n 's/^\([0-9a-f]\{64\}\)  chatgpt-generated-app-mutation-broker$/\1/p' \
            "$app_dir/.chatgpt-linux/generated-app-mutation-broker.sha256"
    )"
    python3 "$REPO_DIR/scripts/lib/package-provenance.py" \
        write-generation-receipt \
        --app "$app_dir" \
        --broker-sha256 "$broker_digest" >/dev/null
}

build_package() {
    local rpm_spec_source="${1:-$REPO_DIR/packaging/linux/chatgpt.spec}"
    local builder
    case "$FORMAT" in
        deb) builder="$REPO_DIR/scripts/build-deb.sh" ;;
        rpm) builder="$REPO_DIR/scripts/build-rpm.sh" ;;
        pacman) builder="$REPO_DIR/scripts/build-pacman.sh" ;;
    esac
    if ! APP_DIR_OVERRIDE="$TEST_TMP/chatgpt" \
        DIST_DIR_OVERRIDE="$TEST_TMP/dist" \
        PKG_ROOT_OVERRIDE="$TEST_TMP/deb-root" \
        PACKAGE_NAME=chatgpt \
        PACKAGE_VERSION="$PACKAGE_VERSION" \
        PACKAGE_WITH_UPDATER=0 \
        SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
        CHATGPT_PORT_INTEGRATIONS_ROOT="$TEST_TMP/port-integrations" \
        CHATGPT_PORT_INTEGRATIONS_CONFIG="$TEST_TMP/integrations.json" \
        CHATGPT_RPM_SPEC_TEMPLATE_SOURCE="$rpm_spec_source" \
            bash "$builder" >"$TEST_TMP/build-$FORMAT.log" 2>&1; then
        sed -n '1,240p' "$TEST_TMP/build-$FORMAT.log" >&2
        fail "$FORMAT builder failed"
    fi
}

expect_package_build_failure() {
    local label="$1"
    local builder
    case "$FORMAT" in
        deb) builder="$REPO_DIR/scripts/build-deb.sh" ;;
        rpm) builder="$REPO_DIR/scripts/build-rpm.sh" ;;
        pacman) builder="$REPO_DIR/scripts/build-pacman.sh" ;;
    esac
    if APP_DIR_OVERRIDE="$TEST_TMP/chatgpt" \
        DIST_DIR_OVERRIDE="$TEST_TMP/dist" \
        PKG_ROOT_OVERRIDE="$TEST_TMP/deb-root" \
        PACKAGE_NAME=chatgpt \
        PACKAGE_VERSION="$PACKAGE_VERSION" \
        PACKAGE_WITH_UPDATER=0 \
        SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
        CHATGPT_PORT_INTEGRATIONS_ROOT="$TEST_TMP/port-integrations" \
        CHATGPT_PORT_INTEGRATIONS_CONFIG="$TEST_TMP/integrations.json" \
            bash "$builder" >"$TEST_TMP/build-$label.log" 2>&1; then
        fail "$FORMAT builder accepted $label after generation receipt publication"
    fi
}

find_package() {
    local pattern
    case "$FORMAT" in
        deb) pattern='chatgpt_*.deb' ;;
        rpm) pattern='chatgpt-*.rpm' ;;
        pacman) pattern='chatgpt-*.pkg.tar.zst' ;;
    esac
    find "$TEST_TMP/dist" -maxdepth 1 -type f -name "$pattern" -print -quit
}

run_gate() {
    local dmg_sha
    dmg_sha="$(sha256sum "$TEST_TMP/ChatGPT.dmg" | awk '{print $1}')"
    APP_DIR="$TEST_TMP/chatgpt" \
    DIST_DIR="$TEST_TMP/dist" \
    DMG="$TEST_TMP/ChatGPT.dmg" \
    CHATGPT_DMG_SHA256="$dmg_sha" \
    CHATGPT_RELEASE_REHEARSAL=1 \
    CHATGPT_RELEASE_REHEARSAL_SKIP_APP_INSPECTION=1 \
    CHATGPT_PORT_INTEGRATIONS_ROOT="$TEST_TMP/port-integrations" \
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$TEST_TMP/integrations.json" \
    PACKAGE_NAME=chatgpt \
    PACKAGE_VERSION="$PACKAGE_VERSION" \
    PACKAGE_WITH_UPDATER=0 \
    SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
        bash "$REPO_DIR/scripts/release-gate.sh"
}

expect_gate_failure() {
    local label="$1"
    if run_gate >"$TEST_TMP/gate-$label.log" 2>&1; then
        fail "$label candidate unexpectedly passed"
    fi
    for output in SHA256SUMS SHA256SUMS.asc RELEASE-PROVENANCE.json RELEASE-PROVENANCE.json.asc; do
        [ ! -e "$TEST_TMP/dist/$output" ] || fail "$label failure left $output behind"
    done
}

repack_deb() {
    local source="$1"
    local destination="$2"
    local mutation="$3"
    local root="$TEST_TMP/deb-tamper"
    rm -rf "$root"
    dpkg-deb -R "$source" "$root"
    case "$mutation" in
        hook)
            printf '\nprintf unreviewed-maintainer-hook >/dev/null\n' >>"$root/DEBIAN/postinst"
            ;;
        dependency)
            sed -i '/^Depends:/ s/$/, unreviewed-release-gate-dependency/' \
                "$root/DEBIAN/control"
            ;;
    esac
    dpkg-deb --root-owner-group --build "$root" "$destination" >/dev/null
}

write_modified_rpm_spec() {
    local destination="$1"
    local mutation="$2"
    case "$mutation" in
        hook)
            awk '
                { print }
                $0 == "%post" { print "printf unreviewed-maintainer-hook >/dev/null" }
            ' "$REPO_DIR/packaging/linux/chatgpt.spec" >"$destination"
            ;;
        dependency)
            awk '
                $0 == "__UPDATER_REQUIRES__" { print "Requires:       unreviewed-release-gate-dependency" }
                { print }
            ' "$REPO_DIR/packaging/linux/chatgpt.spec" >"$destination"
            ;;
        dependency-qualifier)
            sed '0,/^Requires:[[:space:]]*python3$/s//Requires(pre):  python3/' \
                "$REPO_DIR/packaging/linux/chatgpt.spec" >"$destination"
            ;;
    esac
}

repack_pacman() {
    local source="$1"
    local destination="$2"
    local mutation="$3"
    local root="$TEST_TMP/pacman-tamper"
    rm -rf "$root"
    mkdir "$root"
    bsdtar -xf "$source" -C "$root"
    case "$mutation" in
        hook)
            printf '\npost_install() { printf unreviewed-maintainer-hook; }\n' \
                >>"$root/.INSTALL"
            ;;
        dependency)
            printf 'depend = unreviewed-release-gate-dependency\n' >>"$root/.PKGINFO"
            ;;
    esac
    (
        cd "$root"
        shopt -s dotglob nullglob
        local -a entries=(*)
        bsdtar -caf "$destination" --uid 0 --gid 0 --uname root --gname root \
            "${entries[@]}"
    )
}

assert_rpm_qualifier_control_surface() {
    local reviewed_package="$1"
    local changed_package="$2"
    local reviewed_control="$TEST_TMP/rpm-qualifier-reviewed-control"
    local changed_control="$TEST_TMP/rpm-qualifier-changed-control"
    mkdir -m 0700 "$reviewed_control" "$changed_control"
    (
        CHATGPT_RELEASE_GATE_LIBRARY=1
        # shellcheck source=scripts/release-gate.sh
        . "$REPO_DIR/scripts/release-gate.sh"
        RELEASE_GATE_TMP_DIR="$TEST_TMP/rpm-qualifier-control-tmp"
        mkdir -m 0700 "$RELEASE_GATE_TMP_DIR"
        write_rpm_control_surface "$reviewed_package" "$reviewed_control"
        write_rpm_control_surface "$changed_package" "$changed_control"
    )
    cmp -s "$reviewed_control/requires" "$changed_control/requires" || \
        fail "RPM qualifier fixture changed the formatted dependency list"
    if cmp -s "$reviewed_control/requires-raw" "$changed_control/requires-raw"; then
        fail "RPM raw dependency surface omitted the qualifier mutation"
    fi
}

test_release_gate() {
    local package saved_package mutation modified_spec
    local app_payload="$TEST_TMP/chatgpt/content/webview/index.html"
    local saved_app_payload="$TEST_TMP/reviewed-app-payload"
    local integration_readme="$TEST_TMP/port-integrations/release-gate-fixture/README.md"
    local saved_integration_readme="$TEST_TMP/reviewed-integration-readme"
    mkdir -p "$TEST_TMP/dist"
    build_package
    package="$(find_package)"
    [ -n "$package" ] || fail "$FORMAT builder did not produce a package"
    saved_package="$TEST_TMP/reviewed-package"
    cp "$package" "$saved_package"

    if ! run_gate >"$TEST_TMP/gate-valid.log" 2>&1; then
        sed -n '1,240p' "$TEST_TMP/gate-valid.log" >&2
        fail "valid $FORMAT package was rejected"
    fi
    [ -s "$TEST_TMP/dist/SHA256SUMS" ] || fail "valid package did not produce checksums"
    [ -s "$TEST_TMP/dist/RELEASE-PROVENANCE.json" ] || \
        fail "valid package did not produce provenance"
    python3 - \
        "$TEST_TMP/dist/RELEASE-PROVENANCE.json" \
        "$TEST_TMP/dist/SHA256SUMS" \
        "$saved_package" \
        "$TEST_TMP/ChatGPT.dmg" \
        "$FORMAT" \
        "$(git -C "$(dirname -- "$0")/.." rev-parse HEAD)" <<'PY'
import hashlib
import json
import pathlib
import re
import sys

provenance_path, checksums_path, package_path, dmg_path, expected_format, source_commit = sys.argv[1:]
provenance = json.loads(pathlib.Path(provenance_path).read_text(encoding="utf-8"))
package_bytes = pathlib.Path(package_path).read_bytes()
package_sha = hashlib.sha256(package_bytes).hexdigest()
dmg_sha = hashlib.sha256(pathlib.Path(dmg_path).read_bytes()).hexdigest()
assert provenance["releaseMode"] == "rehearsal"
assert provenance["publicReleaseEligible"] is False
assert provenance["officialDmg"]["sha256"] == dmg_sha
assert provenance["source"]["commit"] == source_commit
assert provenance["config"]["packageBuild"]["sourceDateEpoch"] == 1700000000
assert provenance["config"]["packageBuild"]["withUpdater"] is False
assert len(provenance["packages"]) == 1
package = provenance["packages"][0]
assert package["format"] == expected_format
assert package["sha256"] == package_sha
assert re.fullmatch(r"[0-9a-f]{64}", package["payloadManifestSha256"])
assert re.fullmatch(r"[0-9a-f]{64}", package["controlManifestSha256"])
assert pathlib.Path(checksums_path).read_text(encoding="utf-8") == f"{package_sha}  {package['filename']}\n"
PY

    cp "$integration_readme" "$saved_integration_readme"
    printf 'changed integration implementation input\n' >>"$integration_readme"
    expect_gate_failure "integration-input"
    cp "$saved_integration_readme" "$integration_readme"

    cp "$app_payload" "$saved_app_payload"
    printf 'changed packaged payload\n' >>"$app_payload"
    rm -f "$package"
    expect_package_build_failure "changed-app-payload"
    cp "$saved_app_payload" "$app_payload"

    local -a mutations=(hook dependency)
    if [ "$FORMAT" = "rpm" ]; then
        mutations+=(dependency-qualifier)
    fi
    for mutation in "${mutations[@]}"; do
        rm -f "$package"
        case "$FORMAT" in
            deb)
                repack_deb "$saved_package" "$package" "$mutation"
                ;;
            rpm)
                modified_spec="$TEST_TMP/chatgpt-$mutation.spec"
                write_modified_rpm_spec "$modified_spec" "$mutation"
                build_package "$modified_spec"
                package="$(find_package)"
                ;;
            pacman)
                repack_pacman "$saved_package" "$package" "$mutation"
                ;;
        esac
        if [ "$mutation" = "dependency-qualifier" ]; then
            assert_rpm_qualifier_control_surface "$saved_package" "$package"
        fi
        expect_gate_failure "$mutation"
    done

    if [ "$FORMAT" = "rpm" ]; then
        rm -f "$package"
        cp "$saved_package" "$package"
        printf '\0' >>"$package"
        expect_gate_failure "rpm-byte-only"
        grep -Fq 'RPM bytes differ from the deterministic reviewed reference package' \
            "$TEST_TMP/gate-rpm-byte-only.log" || \
            fail "RPM byte-only mutation did not reach the deterministic reference check"
    fi
}

prepare_fixture
test_release_gate
printf 'package release-gate %s tests passed\n' "$FORMAT"
