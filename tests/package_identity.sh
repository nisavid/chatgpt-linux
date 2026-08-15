#!/bin/bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
    printf 'package identity test failed: %s\n' "$*" >&2
    exit 1
}

assert_contains() {
    local path="$1"
    local expected="$2"
    grep -Fq -- "$expected" "$REPO_DIR/$path" || \
        fail "$path does not contain: $expected"
}

assert_not_contains() {
    local path="$1"
    local unexpected="$2"
    if grep -Fq -- "$unexpected" "$REPO_DIR/$path"; then
        fail "$path unexpectedly contains: $unexpected"
    fi
}

for path in \
    packaging/linux/chatgpt.desktop \
    packaging/linux/chatgpt.spec \
    packaging/linux/chatgpt.install \
    packaging/linux/chatgpt-updater.service \
    packaging/linux/com.github.nisavid.chatgpt.update.policy \
    packaging/appimage/chatgpt.desktop; do
    [ -f "$REPO_DIR/$path" ] || fail "missing canonical source: $path"
done

unofficial_notice='Not affiliated with, endorsed by, sponsored by, or supported by OpenAI.'
for package_metadata in \
    packaging/linux/control \
    packaging/linux/chatgpt.spec \
    packaging/linux/PKGBUILD.template; do
    assert_contains "$package_metadata" 'Unofficial ChatGPT for Linux community build'
    assert_contains "$package_metadata" "$unofficial_notice"
done
assert_contains packaging/linux/chatgpt.desktop \
    "Comment=Unofficial community build. $unofficial_notice"
assert_contains scripts/lib/package-common.sh \
    "PACKAGE_COMMENT:-Unofficial community build. $unofficial_notice"
assert_contains scripts/build-appimage.sh \
    "PACKAGE_COMMENT:-Unofficial community build. $unofficial_notice"
assert_contains flake.nix \
    "Unofficial ChatGPT for Linux community build. $unofficial_notice"
assert_contains packaging/linux/chatgpt.spec 'License:        MIT AND Proprietary'
assert_contains packaging/linux/chatgpt.spec \
    '%license /usr/share/licenses/__PACKAGE_NAME__/LICENSE'
assert_contains packaging/linux/chatgpt.spec \
    '%license /usr/share/licenses/__PACKAGE_NAME__/OPENAI-NOTICE'
assert_contains packaging/linux/PKGBUILD.template \
    "license=('MIT AND LicenseRef-OpenAI-Proprietary')"
assert_contains flake.nix \
    'license = [ pkgs.lib.licenses.mit pkgs.lib.licenses.unfree ];'
assert_contains flake.nix 'allowUnfreePredicate = pkg:'
assert_contains flake.nix 'packageName == "chatgpt" || nixpkgs.lib.hasPrefix "chatgpt-" packageName;'
assert_contains flake.nix \
    'sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];'
assert_contains scripts/lib/package-common.sh \
    '"$REPO_DIR/LICENSE" "$root/usr/share/licenses/$PACKAGE_NAME/LICENSE"'
assert_contains scripts/lib/package-common.sh \
    '"$REPO_DIR/packaging/OPENAI-NOTICE" "$root/usr/share/licenses/$PACKAGE_NAME/OPENAI-NOTICE"'
assert_contains scripts/lib/package-common.sh \
    'cp "$REPO_DIR/LICENSE" "$update_builder_root/LICENSE"'
assert_contains scripts/lib/package-common.sh \
    'cp "$REPO_DIR/packaging/OPENAI-NOTICE" "$update_builder_root/OPENAI-NOTICE"'
assert_contains scripts/lib/package-common.sh \
    'cp "$REPO_DIR/packaging/OPENAI-NOTICE" "$update_builder_root/packaging/OPENAI-NOTICE"'
assert_contains scripts/build-appimage.sh \
    '"$REPO_DIR/LICENSE" "$APPDIR/usr/share/licenses/$PACKAGE_NAME/LICENSE"'
assert_contains scripts/build-appimage.sh \
    '"$REPO_DIR/packaging/OPENAI-NOTICE" "$APPDIR/usr/share/licenses/$PACKAGE_NAME/OPENAI-NOTICE"'
assert_contains flake.nix \
    'install -Dm0644 ${sourceRoot}/LICENSE'
assert_contains flake.nix \
    'install -Dm0644 ${sourceRoot}/packaging/OPENAI-NOTICE'
[ -f "$REPO_DIR/packaging/OPENAI-NOTICE" ] || \
    fail 'missing OpenAI package terms notice'
[ -f "$REPO_DIR/packaging/linux/debian-copyright" ] || \
    fail 'missing Debian copyright source'
assert_contains scripts/lib/package-common.sh \
    '"$root/usr/share/doc/$PACKAGE_NAME/copyright"'
assert_contains scripts/lib/package-common.sh \
    'cp "$REPO_DIR/packaging/linux/debian-copyright" "$update_builder_root/packaging/linux/debian-copyright"'
python3 - "$REPO_DIR/packaging/linux/debian-copyright" <<'PY'
from fnmatch import fnmatchcase
from pathlib import Path
import sys


def parse_stanza(raw):
    fields = {}
    current = None
    for line in raw.splitlines():
        if line.startswith("#"):
            continue
        if line.startswith((" ", "\t")):
            if current is None:
                raise SystemExit("Debian copyright has an orphan continuation line")
            fields[current] += "\n" + line[1:]
            continue
        name, separator, value = line.partition(":")
        if not separator or not name:
            raise SystemExit(f"Invalid Debian copyright field: {line}")
        current = name
        fields[current] = value.lstrip()
    return fields


comment_fixture = parse_stanza("# machine-readable copyright comment\nFormat: example")
if comment_fixture != {"Format": "example"}:
    raise SystemExit("Debian copyright comments must not become fields")


stanzas = [parse_stanza(raw) for raw in Path(sys.argv[1]).read_text(encoding="utf-8").strip().split("\n\n")]
header = stanzas[0]
if header.get("License") != "MIT and LicenseRef-OpenAI-Proprietary":
    raise SystemExit("Debian copyright header must summarize the mixed binary package license")
if "not part of the Debian distribution" not in header.get("Disclaimer", ""):
    raise SystemExit("Debian copyright header must carry the non-free disclaimer")
files_stanzas = [stanza for stanza in stanzas[1:] if "Files" in stanza]
if len(files_stanzas) != 2:
    raise SystemExit("Debian copyright must separate project and official app scopes")
project, official_app = files_stanzas
if project.get("Files") != "*" or project.get("License") != "MIT":
    raise SystemExit("General repository source stanza must remain MIT-only")
if "OpenAI" in project.get("Copyright", ""):
    raise SystemExit("Repository source stanza must not attribute the fetched app bundle")
if official_app.get("Files", "").split() != ["ChatGPT.dmg", "chatgpt/*"]:
    raise SystemExit("Official app stanza must cover the DMG and generated app source tree")
if official_app.get("License") != "LicenseRef-OpenAI-Proprietary":
    raise SystemExit("Official app stanza must use the proprietary license reference")
if "OpenAI" not in official_app.get("Copyright", ""):
    raise SystemExit("Official app stanza must attribute OpenAI")
if "/opt/chatgpt/" not in official_app.get("Comment", ""):
    raise SystemExit("Official app stanza must identify the installed binary payload path")


def effective_license(path):
    license_name = None
    for stanza in files_stanzas:
        if any(fnmatchcase(path, pattern) for pattern in stanza["Files"].split()):
            license_name = stanza["License"]
    return license_name


if effective_license("packaging/linux/control") != "MIT":
    raise SystemExit("Repository package sources must resolve to MIT")
if effective_license("docs/maintainers/readme-visual-capture.md") != "MIT":
    raise SystemExit("Repository documentation must resolve to MIT")
if effective_license("ChatGPT.dmg") != "LicenseRef-OpenAI-Proprietary":
    raise SystemExit("Official app input must resolve to the proprietary license")
if effective_license("chatgpt/resources/app.asar") != "LicenseRef-OpenAI-Proprietary":
    raise SystemExit("Generated official app payload must resolve to the proprietary license")
license_names = {
    stanza.get("License", "").splitlines()[0]
    for stanza in stanzas[1:]
    if "Files" not in stanza and "License" in stanza
}
if license_names != {"MIT", "LicenseRef-OpenAI-Proprietary"}:
    raise SystemExit("Debian copyright must define both standalone license texts")
PY

assert_contains packaging/linux/control 'Provides: codex-app, codex-desktop'
assert_contains packaging/linux/control 'Conflicts: codex-app, codex-desktop'
assert_contains packaging/linux/control 'Replaces: codex-app, codex-desktop'
assert_contains packaging/linux/chatgpt.spec 'Provides:       codex-app'
assert_contains packaging/linux/chatgpt.spec 'Provides:       codex-desktop'
assert_contains packaging/linux/chatgpt.spec 'Conflicts:      codex-app'
assert_contains packaging/linux/chatgpt.spec 'Conflicts:      codex-desktop'
assert_contains packaging/linux/chatgpt.spec 'Obsoletes:      codex-app'
assert_contains packaging/linux/chatgpt.spec 'Obsoletes:      codex-desktop'
assert_contains packaging/linux/PKGBUILD.template "provides=('codex-app' 'codex-desktop')"
assert_contains packaging/linux/PKGBUILD.template "conflicts=('codex-app' 'codex-desktop')"
assert_contains packaging/linux/PKGBUILD.template "replaces=('codex-app' 'codex-desktop')"
assert_contains packaging/linux/PKGBUILD.template 'url="https://github.com/nisavid/codex-app-linux"'
assert_contains packaging/linux/com.github.nisavid.chatgpt.update.policy \
    '<vendor_url>https://github.com/nisavid/codex-app-linux</vendor_url>'
assert_contains scripts/lib/build-info.js \
    'notes: "nix run github:nisavid/codex-app-linux"'
assert_contains scripts/ci/hash-refresh-evidence.sh \
    'DEFAULT_REPO="nisavid/codex-app-linux"'
assert_contains scripts/ci/container-entrypoint.sh \
    'export CHATGPT_PORT_INTEGRATIONS_ROOT="$integrations_root"'
assert_contains scripts/ci/container-entrypoint.sh \
    'export CHATGPT_PORT_INTEGRATIONS_CONFIG="$REPO_DIR/chatgpt.port-integrations.json"'
assert_contains scripts/ci/container-entrypoint.sh \
    'CHATGPT_FIXTURE_PORT_INTEGRATIONS_JSON="$enabled_json"'
assert_not_contains scripts/ci/container-entrypoint.sh \
    'codex-micro-integrations.json'
assert_contains scripts/automation/upstream-dmg-watchdog/watchdog.py \
    'DEFAULT_REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "nisavid/codex-app-linux")'
assert_contains .agents/fork-sync-policy.toml \
    'github_pr_repo = "nisavid/codex-app-linux"'
assert_contains plugins/openai-bundled/plugins/read-aloud/.codex-plugin/plugin.json \
    '"homepage": "https://github.com/nisavid/codex-app-linux"'
assert_contains port-integrations/record-and-replay/plugin-template/.codex-plugin/plugin.json \
    '"homepage": "https://github.com/nisavid/codex-app-linux"'
assert_contains port-integrations/record-and-replay/plugin-template/.codex-plugin/plugin.json \
    '"websiteURL": "https://github.com/nisavid/codex-app-linux"'

assert_contains packaging/linux/chatgpt-updater.service \
    'ExecStartPre=/opt/chatgpt/.chatgpt-linux/state-migration.py --forward'
assert_contains packaging/linux/chatgpt-updater.service \
    'ExecStart=/usr/bin/chatgpt-updater daemon'
assert_contains packaging/linux/chatgpt-updater.service \
    'Environment=PATH=/usr/sbin:/usr/bin:/sbin:/bin'
assert_not_contains packaging/linux/chatgpt-updater.service '%h/.local/bin'
assert_not_contains packaging/linux/chatgpt-updater.service '/usr/local/'
assert_contains packaging/linux/chatgpt.desktop '/usr/bin/chatgpt %u'
assert_contains packaging/linux/chatgpt.desktop 'Icon=chatgpt'
assert_contains packaging/linux/chatgpt.desktop '/usr/bin/chatgpt-updater check-now'
assert_not_contains packaging/linux/chatgpt.desktop '/usr/bin/codex-app'

for builder in \
    scripts/build-deb.sh \
    scripts/build-rpm.sh \
    scripts/build-pacman.sh \
    scripts/build-appimage.sh; do
    assert_contains "$builder" 'APP_DIR_OVERRIDE:-$REPO_DIR/chatgpt'
    assert_contains "$builder" 'PACKAGE_NAME:-chatgpt'
done
assert_contains scripts/lib/package-common.sh 'chatgpt-version.env'
assert_contains scripts/lib/package-common.sh 'CHATGPT_APP_PACKAGE_VERSION='
assert_contains scripts/lib/package-common.sh 'root/usr/bin/chatgpt-updater'
assert_contains scripts/lib/package-common.sh 'root/usr/lib/systemd/user/chatgpt-updater.service'
assert_contains scripts/lib/package-common.sh 'com.github.nisavid.chatgpt.update.policy'
assert_contains scripts/lib/package-common.sh 'app_root/.chatgpt-linux'
assert_not_contains scripts/lib/package-common.sh 'root/usr/bin/codex-app'
assert_contains scripts/build-appimage.sh 'PACKAGE_DISPLAY_NAME:-ChatGPT'
assert_not_contains scripts/build-appimage.sh 'PACKAGE_COMMENT:-Run ChatGPT on Linux'

assert_contains packaging/linux/chatgpt.desktop 'X-ChatGPT-Linux-Managed=true'
assert_contains packaging/linux/chatgpt-desktop-entry-doctor.sh \
    'X-ChatGPT-Linux-Managed=true'
assert_contains packaging/linux/chatgpt-updater-user-service.sh \
    'codex-app-updater.service codex-update-manager.service'
assert_contains packaging/linux/chatgpt-packaged-runtime.sh \
    'disable --now codex-app-updater.service'
assert_contains packaging/linux/chatgpt-packaged-runtime.sh \
    'disable --now codex-update-manager.service'
for lifecycle_path in \
    packaging/linux/chatgpt.install \
    packaging/linux/chatgpt-updater.postinst \
    packaging/linux/chatgpt-updater.prerm \
    packaging/linux/chatgpt-updater.postrm; do
    assert_not_contains "$lifecycle_path" '/.cache/chatgpt'
    assert_not_contains "$lifecycle_path" '/.local/state/chatgpt'
    assert_not_contains "$lifecycle_path" '/.config/chatgpt'
    assert_not_contains "$lifecycle_path" 'state-migration.py --reverse'
    assert_not_contains "$lifecycle_path" 'chatgpt_repair_system_package_shadow_entries'
done
assert_not_contains scripts/build-rpm.sh 'chatgpt_repair_system_package_shadow_entries'

assert_contains flake.nix \
    'description = "Unofficial ChatGPT for Linux community build. Not affiliated with, endorsed by, sponsored by, or supported by OpenAI.";'
assert_contains flake.nix 'packages = {'
assert_contains flake.nix 'chatgpt = chatgpt;'
assert_contains flake.nix '/opt/chatgpt'
assert_contains flake.nix '/bin/chatgpt'
assert_contains flake.nix '${sourceRoot}/assets/chatgpt-linux.png'
assert_contains flake.nix 'chatgpt-linux = default;'
assert_not_contains flake.nix 'codex-app-linux = default;'
assert_contains nix/home-manager-module.nix 'config.programs.chatgptLinux'
assert_contains nix/home-manager-module.nix 'inputs.chatgpt-linux.packages'
assert_contains nix/nixos-module.nix 'config.programs.chatgptLinux'
assert_contains nix/package-selection.nix 'flakePackages.chatgpt.override'

test_service_enablement_migration() {
    local calls
    calls="$(mktemp)"
    (
        # shellcheck source=../packaging/linux/chatgpt-updater-user-service.sh
        . "$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
        chatgpt_run_systemctl_user() {
            printf '%s\n' "$*" >> "$calls"
            case "$*" in
                *"is-enabled codex-app-updater.service") return 0 ;;
                *"is-enabled "*) return 1 ;;
                *) return 0 ;;
            esac
        }
        chatgpt_migrate_one_user_service test-user /run/user/1000 /run/user/1000/bus
    )
    grep -Fq 'disable --now codex-app-updater.service' "$calls" || \
        fail 'legacy updater service was not disabled during identity migration'
    grep -Fq 'enable --now chatgpt-updater.service' "$calls" || \
        fail 'canonical updater service was not enabled during identity migration'
    rm -f "$calls"
}

test_service_enablement_policy() {
    local calls
    calls="$(mktemp)"
    (
        # shellcheck source=../packaging/linux/chatgpt-updater-user-service.sh
        . "$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
        chatgpt_run_systemctl_user() {
            printf '%s\n' "$*" >> "$calls"
            case "$*" in
                *"is-enabled "*|*"is-active "*) return 1 ;;
                *) return 0 ;;
            esac
        }
        chatgpt_start_one_enabled_user_service test-user /run/user/1000 /run/user/1000/bus
    )
    if grep -Fq 'enable --now chatgpt-updater.service' "$calls"; then
        fail 'upgrade enabled an updater service that the user had disabled'
    fi
    : > "$calls"
    (
        # shellcheck source=../packaging/linux/chatgpt-updater-user-service.sh
        . "$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
        chatgpt_run_systemctl_user() {
            printf '%s\n' "$*" >> "$calls"
            case "$*" in
                *"is-enabled "*|*"is-active "*) return 1 ;;
                *) return 0 ;;
            esac
        }
        chatgpt_ensure_one_user_service_running test-user /run/user/1000 /run/user/1000/bus
    )
    grep -Fq 'enable --now chatgpt-updater.service' "$calls" || \
        fail 'fresh install did not enable the default updater service'
    rm -f "$calls"
}

test_desktop_marker_ownership() {
    local temp_dir managed unmanaged
    temp_dir="$(mktemp -d)"
    managed="$temp_dir/managed.desktop"
    unmanaged="$temp_dir/unmanaged.desktop"
    printf '%s\n' \
        '[Desktop Entry]' \
        'Name=Codex App' \
        'Exec=/usr/bin/codex-app' \
        'X-ChatGPT-Linux-Managed=true' > "$managed"
    cp "$managed" "$unmanaged"
    sed -i '/X-ChatGPT-Linux-Managed=true/d' "$unmanaged"
    (
        # shellcheck source=../packaging/linux/chatgpt-desktop-entry-doctor.sh
        . "$REPO_DIR/packaging/linux/chatgpt-desktop-entry-doctor.sh"
        chatgpt_entry_is_legacy_generated "$managed" || \
            fail 'marker-owned stale desktop entry was not eligible for repair'
        if chatgpt_entry_is_legacy_generated "$unmanaged"; then
            fail 'unmanaged desktop entry was eligible for mutation'
        fi
    )
    rm -rf "$temp_dir"
}

# The sourced helper consumes dynamically scoped variables inside a subshell.
# shellcheck disable=SC2030,SC2031,SC2034
test_external_updater_binary_is_authoritative() {
    local temp_dir
    local status
    temp_dir="$(mktemp -d)"
    mkdir -p "$temp_dir/source/updater/src" "$temp_dir/prebuilt" "$temp_dir/bin"
    printf '%s\n' '#!/bin/sh' 'exit 0' > "$temp_dir/prebuilt/chatgpt-updater"
    chmod 0755 "$temp_dir/prebuilt/chatgpt-updater"
    sleep 1
    printf '%s\n' '[workspace]' > "$temp_dir/source/Cargo.toml"
    printf '%s\n' '# newer updater source' > "$temp_dir/source/updater/src/main.rs"
    printf '%s\n' \
        '#!/bin/sh' \
        "touch '$temp_dir/cargo-ran'" \
        'exit 1' > "$temp_dir/bin/cargo"
    chmod 0755 "$temp_dir/bin/cargo"

    set +e
    (
        # shellcheck source=../scripts/lib/package-common.sh
        source "$REPO_DIR/scripts/lib/package-common.sh"
        # These dynamically scope inputs consumed by the sourced package helper.
        local REPO_DIR="$temp_dir/source"
        local UPDATER_BINARY_SOURCE="$temp_dir/prebuilt/chatgpt-updater"
        local PACKAGE_WITH_UPDATER=1
        local PATH="$temp_dir/bin:/usr/bin:/bin"
        ensure_updater_binary
    )
    status=$?
    set -e

    [ "$status" -eq 0 ] || fail 'external updater binary was rejected as stale'
    [ ! -e "$temp_dir/cargo-ran" ] || fail 'external updater binary triggered a Cargo rebuild'
    rm -rf "$temp_dir"
}

# The sourced helper consumes dynamically scoped variables inside a subshell.
# shellcheck disable=SC2030,SC2031,SC2034
test_repo_local_updater_symlink_retains_stale_source_rebuild() {
    local temp_dir
    local status
    temp_dir="$(mktemp -d)"
    mkdir -p "$temp_dir/source/updater/src" "$temp_dir/source/target/release" "$temp_dir/prebuilt" "$temp_dir/bin"
    printf '%s\n' '#!/bin/sh' 'exit 0' > "$temp_dir/prebuilt/chatgpt-updater"
    chmod 0755 "$temp_dir/prebuilt/chatgpt-updater"
    ln -s "$temp_dir/prebuilt/chatgpt-updater" "$temp_dir/source/target/release/chatgpt-updater"
    sleep 1
    printf '%s\n' '[workspace]' > "$temp_dir/source/Cargo.toml"
    printf '%s\n' '# newer updater source' > "$temp_dir/source/updater/src/main.rs"
    printf '%s\n' \
        '#!/bin/sh' \
        "touch '$temp_dir/cargo-ran'" \
        'exit 1' > "$temp_dir/bin/cargo"
    chmod 0755 "$temp_dir/bin/cargo"

    set +e
    (
        # shellcheck source=../scripts/lib/package-common.sh
        source "$REPO_DIR/scripts/lib/package-common.sh"
        local REPO_DIR="$temp_dir/source"
        local UPDATER_BINARY_SOURCE="$temp_dir/source/target/release/chatgpt-updater"
        local PACKAGE_WITH_UPDATER=1
        local PATH="$temp_dir/bin:/usr/bin:/bin"
        ensure_updater_binary
    )
    status=$?
    set -e

    # The rebuild seam is the contract under test; the fixture's existing
    # symlink may still satisfy the helper's final executable check.
    : "$status"
    [ -e "$temp_dir/cargo-ran" ] || fail 'stale repo-local updater symlink did not trigger Cargo'
    rm -rf "$temp_dir"
}

test_service_enablement_migration
test_service_enablement_policy
test_desktop_marker_ownership
test_external_updater_binary_is_authoritative
test_repo_local_updater_symlink_retains_stale_source_rebuild

for legacy_port_env in \
    CODEX_APP_PACKAGE_VERSION \
    CODEX_PACKAGE_HAS_UPDATER \
    CODEX_PACKAGE_ENABLE_UPDATER \
    CODEX_LINUX_SOURCE_COMMIT \
    CODEX_LINUX_SOURCE_REMOTE \
    CODEX_INSTALL_DIR \
    CODEX_MANAGED_NODE_SOURCE \
    CODEX_MICRO_NODE_HID_ARCHIVE \
    CODEX_PRIMARY_RUNTIME_ROOT \
    CODEX_RUNTIME_ROOT \
    CODEX_CLI_BUNDLE_SOURCE; do
    if grep -R -Fq -- "$legacy_port_env" \
        "$REPO_DIR/packaging" \
        "$REPO_DIR/scripts/build-appimage.sh" \
        "$REPO_DIR/scripts/build-deb.sh" \
        "$REPO_DIR/scripts/build-pacman.sh" \
        "$REPO_DIR/scripts/build-rpm.sh" \
        "$REPO_DIR/scripts/lib/package-common.sh" \
        "$REPO_DIR/flake.nix" \
        "$REPO_DIR/nix"; then
        fail "port-owned environment variable remains: $legacy_port_env"
    fi
done
assert_contains packaging/appimage/AppRun 'CODEX_CLI_PATH'
assert_contains nix/home-manager-module.nix 'CODEX_HOME'
assert_contains nix/nixos-module.nix 'CHATGPT_REMOTE_CONTROL_DAEMON_AUTOSTART_DISABLED'
assert_contains launcher/start.sh.template 'CODEX_CHROME_NATIVE_HOSTS_MANIFEST CHATGPT_CHROME_NATIVE_HOSTS_MANIFEST'
assert_contains launcher/start.sh.template 'CODEX_REMOTE_CONTROL_CODEX_PATH CHATGPT_REMOTE_CONTROL_CODEX_PATH'
assert_contains install.sh 'CODEX_MICRO_NODE_HID_ARCHIVE CHATGPT_MICRO_NODE_HID_ARCHIVE'
assert_contains launcher/start.sh.template 'CODEX_MICRO_NODE_HID_ARCHIVE CHATGPT_MICRO_NODE_HID_ARCHIVE'
assert_contains launcher/start.sh.template 'CODEX_PRIMARY_RUNTIME_ROOT CHATGPT_PRIMARY_RUNTIME_ROOT'
assert_contains launcher/start.sh.template 'CODEX_RUNTIME_ROOT CHATGPT_RUNTIME_ROOT'
assert_contains flake.nix 'CHATGPT_PRIMARY_RUNTIME_ROOT'
assert_contains flake.nix 'CHATGPT_RUNTIME_ROOT'
if grep -R -Fq -- 'CODEX_MICRO_NODE_HID_ARCHIVE' "$REPO_DIR/port-integrations/codex-micro"; then
    fail 'port-owned Codex Micro archive environment variable remains outside rejection maps'
fi

for legacy_port_env in \
    CODEX_CHROME_NATIVE_HOSTS_MANIFEST \
    CODEX_REMOTE_CONTROL_CODEX_PATH \
    CODEX_REMOTE_CONTROL_CODEX_RELEASE \
    CODEX_REMOTE_CONTROL_DAEMON_AUTOSTART_DISABLED \
    CODEX_REMOTE_CONTROL_DAEMON_AUTOSTART_TIMEOUT_SECONDS \
    CODEX_REMOTE_CONTROL_FORCE_COLD_START_DAEMON \
    CODEX_REMOTE_CONTROL_INSTALLER_SHA256 \
    CODEX_REMOTE_CONTROL_RUNTIME_AUTO_INSTALL_DISABLED; do
    if grep -R -Fq -- "$legacy_port_env" \
        "$REPO_DIR/computer-use-linux" \
        "$REPO_DIR/nix" \
        "$REPO_DIR/port-integrations/remote-mobile-control"; then
        fail "port-owned environment variable remains outside the launcher rejection map: $legacy_port_env"
    fi
done

printf 'environment ownership: ok\n'
printf 'behavioral lifecycle safety: ok\n'
printf 'Nix package and module identity: ok\n'
printf 'package lifecycle and user-data safety: ok\n'
printf 'package builder and payload identity: ok\n'
printf 'native package identity and transitions: ok\n'

printf 'package identity source names: ok\n'
