#!/bin/bash

# shellcheck source=scripts/lib/generated-app-mutation-broker.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/generated-app-mutation-broker.sh"

info() {
    echo "[INFO] $*" >&2
}

warn() {
    echo "[WARN] $*" >&2
}

error() {
    echo "[ERROR] $*" >&2
    exit 1
}

ensure_file_exists() {
    local path="$1"
    local label="$2"
    [ -f "$path" ] || error "Missing $label: $path"
}

ensure_app_layout() {
    [ -d "$APP_DIR" ] || error "Missing app directory: $APP_DIR. Run ./install.sh first."
    [ -x "$APP_DIR/start.sh" ] || error "Missing launcher: $APP_DIR/start.sh"
    [ -f "$APP_DIR/content/webview/index.html" ] || error "Missing webview entrypoint: $APP_DIR/content/webview/index.html. Run ./install.sh first."
}

default_package_version() {
    local version_file="$APP_DIR/chatgpt-version.env"
    local version=""

    if [ ! -f "$version_file" ]; then
        error "Missing $version_file. Run ./install.sh first so package versions align with the official app bundle version."
    fi

    version="$(sed -n 's/^CHATGPT_APP_PACKAGE_VERSION=//p' "$version_file" | head -n 1)"
    version="${version#\'}"
    version="${version%\'}"
    version="${version#\"}"
    version="${version%\"}"
    if [[ "$version" =~ ^[0-9]+(\.[0-9]+){2,3}$ ]]; then
        echo "$version"
        return
    fi

    error "Invalid CHATGPT_APP_PACKAGE_VERSION in $version_file: $version"
}

package_trusted_git_binary() {
    local candidate
    for candidate in /usr/bin/git /bin/git; do
        if [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

package_git_in() {
    local git_repo_dir="$1"
    shift
    local git_binary
    git_binary="$(package_trusted_git_binary)" || return 127
    /usr/bin/env -i \
        GIT_CONFIG_GLOBAL=/dev/null \
        GIT_CONFIG_NOSYSTEM=1 \
        GIT_OPTIONAL_LOCKS=0 \
        HOME=/nonexistent \
        LC_ALL=C \
        PATH=/usr/sbin:/usr/bin:/sbin:/bin \
        XDG_CONFIG_HOME=/nonexistent \
        "$git_binary" \
        -C "$git_repo_dir" \
        -c core.fsmonitor=false \
        -c core.hooksPath=/dev/null \
        "$@"
}

package_git() {
    package_git_in "$REPO_DIR" "$@"
}

staged_package_source_date_epoch() {
    local source_info="$REPO_DIR/.chatgpt-linux/source-info.json"
    local node_bin

    [ -f "$source_info" ] && [ ! -L "$source_info" ] || return 1
    node_bin="$(package_node_binary)"
    "$node_bin" - "$source_info" <<'NODE'
const fs = require("node:fs");
const sourceInfoPath = process.argv[2];
try {
  const sourceInfo = JSON.parse(fs.readFileSync(sourceInfoPath, "utf8"));
  const epoch = sourceInfo?.sourceDateEpoch;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    process.exit(1);
  }
  process.stdout.write(String(epoch));
} catch {
  process.exit(1);
}
NODE
}

ensure_package_source_date_epoch() {
    local epoch="${SOURCE_DATE_EPOCH:-}"

    if [ -z "$epoch" ]; then
        epoch="$(staged_package_source_date_epoch 2>/dev/null || true)"
    fi
    if [ -z "$epoch" ]; then
        epoch="$(package_git show -s --format=%ct HEAD 2>/dev/null || true)"
    fi
    [[ "$epoch" =~ ^[0-9]+$ ]] || \
        error "SOURCE_DATE_EPOCH must be a non-negative integer, staged source epoch, or derivable from Git HEAD"
    export SOURCE_DATE_EPOCH="$epoch"
}

sed_escape_replacement() {
    printf '%s' "$1" | sed -e 's/[\\\/&]/\\&/g'
}

validate_no_newline() {
    local name="$1"
    local value="$2"

    case "$value" in
    *$'\n'*|*$'\r'*)
        error "$name must not contain newlines"
        ;;
    esac
}

validate_package_inputs() {
    [[ "$PACKAGE_NAME" =~ ^[a-z0-9][a-z0-9+._-]*$ ]] || \
        error "PACKAGE_NAME must match ^[a-z0-9][a-z0-9+._-]*$: $PACKAGE_NAME"
    package_with_updater_value >/dev/null
    validate_no_newline "PACKAGE_DISPLAY_NAME" "${PACKAGE_DISPLAY_NAME:-ChatGPT}"
    validate_no_newline "PACKAGE_COMMENT" "${PACKAGE_COMMENT:-Unofficial community build. Not affiliated with, endorsed by, sponsored by, or supported by OpenAI.}"
}

normalize_package_updater_value() {
    case "$1" in
    1|true|True|TRUE|yes|Yes|YES|on|On|ON)
        echo 1
        ;;
    0|false|False|FALSE|no|No|NO|off|Off|OFF)
        echo 0
        ;;
    *)
        error "PACKAGE_WITH_UPDATER must be 1 or 0"
        ;;
    esac
}

package_with_updater_value() {
    local canonical="${PACKAGE_WITH_UPDATER:-}"
    local legacy="${PACKAGE_ENABLE_UPDATER:-}"

    if [ -n "$canonical" ] && [ -n "$legacy" ]; then
        canonical="$(normalize_package_updater_value "$canonical")"
        legacy="$(normalize_package_updater_value "$legacy")"
        [ "$canonical" = "$legacy" ] || \
            error "PACKAGE_WITH_UPDATER and PACKAGE_ENABLE_UPDATER disagree"
        echo "$canonical"
        return
    fi

    if [ -n "$canonical" ]; then
        normalize_package_updater_value "$canonical"
    elif [ -n "$legacy" ]; then
        normalize_package_updater_value "$legacy"
    else
        echo 1
    fi
}

package_with_updater_enabled() {
    [ "$(package_with_updater_value)" = "1" ]
}

package_node_binary() {
    local requested_node="${CHATGPT_PACKAGE_NODE_SOURCE:-}"
    if [ -n "$requested_node" ]; then
        [[ "$requested_node" = /* ]] || error "CHATGPT_PACKAGE_NODE_SOURCE must be absolute"
        [ -f "$requested_node" ] && [ ! -L "$requested_node" ] && [ -x "$requested_node" ] || \
            error "CHATGPT_PACKAGE_NODE_SOURCE must be a regular non-symlink executable"
        printf '%s\n' "$requested_node"
        return 0
    fi

    local managed_node="${APP_DIR:-}/resources/node-runtime/bin/node"
    if [ -x "$managed_node" ] && [ "$("$managed_node" -e 'process.stdout.write("ok")' 2>/dev/null || true)" = "ok" ]; then
        printf '%s\n' "$managed_node"
        return 0
    fi

    command -v node >/dev/null 2>&1 || error "node is required"
    command -v node
}

clear_update_builder_port_integration_config() {
    local update_builder_root="$1"

    rm -f \
        "$update_builder_root/port-integrations/integrations.json" \
        "$update_builder_root/port-integrations/features.json"
}

port_integration_enabled() {
    local integration_id="$1"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin
    local enabled_output

    [ -f "$helper" ] || error "Missing port integrations helper: $helper"
    node_bin="$(package_node_binary)"
    if ! enabled_output="$("$node_bin" "$helper" --enabled)"; then
        error "Failed to discover enabled port integrations"
    fi
    grep -Fxq "$integration_id" <<<"$enabled_output"
}

stage_update_builder_global_dictation_source() {
    local update_builder_root="$1"
    local source_root="$REPO_DIR/global-dictation-linux"
    local target_root="$update_builder_root/global-dictation-linux"

    mkdir -p "$target_root/src"
    cp "$source_root/Cargo.toml" "$target_root/Cargo.toml"
    cp "$source_root/Cargo.lock" "$target_root/Cargo.lock"
    cp -R "$source_root/src/." "$target_root/src/"
}

stage_update_builder_resolved_port_integration_config() {
    local update_builder_root="$1"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin
    local config_dir="$update_builder_root/.chatgpt-linux"
    local config_path="$config_dir/port-integrations.json"

    [ -f "$helper" ] || error "Missing port integrations helper: $helper"

    mkdir -p "$config_dir"
    node_bin="$(package_node_binary)"
    "$node_bin" "$helper" --resolved-config-json > "$config_path"
}

port_integrations_root_path() {
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin

    [ -f "$helper" ] || error "Missing port integrations helper: $helper"

    node_bin="$(package_node_binary)"
    "$node_bin" "$helper" --integrations-root
}

stage_update_builder_port_integrations_tree() {
    local update_builder_root="$1"
    local source_root
    local target="$update_builder_root/port-integrations"

    source_root="$(port_integrations_root_path)"
    [ -d "$source_root" ] || error "Missing port integrations root: $source_root"

    mkdir -p "$target"
    cp -a "$source_root/." "$target/"
    find "$target" -type d -name target -prune -exec rm -rf -- {} +
    stage_update_builder_resolved_port_integration_config "$update_builder_root"
    clear_update_builder_port_integration_config "$update_builder_root"
}

run_port_integration_package_hooks() {
    local staging_root="$1"
    local package_format="$2"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin
    local integration_id
    local hook_path
    local hooks_output
    local app_dir="$staging_root/opt/$PACKAGE_NAME"

    [ -d "$staging_root" ] || error "Missing package staging root: $staging_root"
    [ -f "$helper" ] || error "Missing port integrations helper: $helper"

    node_bin="$(package_node_binary)"
    if ! hooks_output="$("$node_bin" "$helper" --package-hooks "$package_format" "$app_dir")"; then
        error "Failed to discover port integration package hooks for $package_format"
    fi

    while IFS=$'\t' read -r integration_id hook_path; do
        [ -n "${integration_id:-}" ] || continue
        [ -f "$hook_path" ] || error "Missing port integration package hook for $integration_id: $hook_path"

        info "Running port integration package hook ($package_format): $integration_id"
        REPO_DIR="$REPO_DIR" \
            SCRIPT_DIR="$REPO_DIR" \
            APP_DIR="$app_dir" \
            PACKAGE_APP_DIR="$app_dir" \
            PACKAGE_NAME="$PACKAGE_NAME" \
            PACKAGE_VERSION="$PACKAGE_VERSION" \
            PACKAGE_FORMAT="$package_format" \
            PACKAGE_ROOT="$staging_root" \
            PACKAGE_STAGING_ROOT="$staging_root" \
            bash "$hook_path"
    done <<< "$hooks_output"
}

stage_port_integration_package_resources() {
    local staging_root="$1"
    local package_format="$2"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin
    local app_dir="$staging_root/opt/$PACKAGE_NAME"

    [ -d "$staging_root" ] || error "Missing package staging root: $staging_root"
    [ -f "$helper" ] || error "Missing port integrations helper: $helper"
    node_bin="$(package_node_binary)"
    "$node_bin" "$helper" --stage-package-resources "$package_format" "$staging_root" "$app_dir"
}

port_integration_package_dependencies() {
    local package_format="$1"
    local app_dir="$2"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin

    [ -f "$helper" ] || error "Missing port integrations helper: $helper"
    node_bin="$(package_node_binary)"
    "$node_bin" "$helper" --package-dependencies "$package_format" "$app_dir"
}

port_integration_package_files() {
    local package_format="$1"
    local app_dir="$2"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin

    [ -f "$helper" ] || error "Missing port integrations helper: $helper"
    node_bin="$(package_node_binary)"
    "$node_bin" "$helper" --package-files "$package_format" "$app_dir"
}

port_integration_package_dependency_suffix() {
    local package_format="$1"
    local app_dir="$2"
    local dependencies_output
    local dependency
    local suffix=""

    if ! dependencies_output="$(port_integration_package_dependencies "$package_format" "$app_dir")"; then
        return 1
    fi
    while IFS= read -r dependency; do
        [ -n "$dependency" ] || continue
        suffix+=", $dependency"
    done <<< "$dependencies_output"
    printf '%s' "$suffix"
}

replace_literal_file_token() {
    local target="$1"
    local token="$2"
    local replacement="$3"
    local node_bin

    node_bin="$(package_node_binary)"
    "$node_bin" - "$target" "$token" "$replacement" <<'NODE'
const fs = require("node:fs");
const [target, token, replacement] = process.argv.slice(2);
const source = fs.readFileSync(target, "utf8");
if (!source.includes(token)) {
  throw new Error(`Template token not found in ${target}: ${token}`);
}
fs.writeFileSync(target, source.split(token).join(replacement));
NODE
}

render_desktop_entry() {
    local target="$1"
    local package_name
    local display_name
    local comment
    local temp_target
    local filtered_target=""
    local temp_dir

    package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
    display_name="$(sed_escape_replacement "${PACKAGE_DISPLAY_NAME:-ChatGPT}")"
    comment="$(sed_escape_replacement "${PACKAGE_COMMENT:-Unofficial community build. Not affiliated with, endorsed by, sponsored by, or supported by OpenAI.}")"
    temp_dir="$(dirname "$target")"
    temp_target="$(mktemp "$temp_dir/.${PACKAGE_NAME}.desktop.XXXXXX")" || \
        error "Failed to create temporary desktop entry"
    trap '[ -z "${temp_target:-}" ] || rm -f "$temp_target"; [ -z "${filtered_target:-}" ] || rm -f "$filtered_target"' RETURN

    sed \
        -e "s/chatgpt-updater/__CHATGPT_UPDATER__/g" \
        -e "s/chatgpt/$package_name/g" \
        -e "s/__CHATGPT_UPDATER__/chatgpt-updater/g" \
        -e "0,/^Name=.*/s/^Name=.*/Name=$display_name/" \
        -e "0,/^Comment=.*/s/^Comment=.*/Comment=$comment/" \
        "$DESKTOP_TEMPLATE" > "$temp_target"
    if package_with_updater_enabled; then
        mv "$temp_target" "$target"
        temp_target=""
    else
        filtered_target="$(mktemp "$temp_dir/.${PACKAGE_NAME}.desktop.XXXXXX")" || \
            error "Failed to create filtered desktop entry"
        awk '
            /^Actions=/ {
                rendered = ""
                action_count = split(substr($0, 9), actions, ";")
                for (i = 1; i <= action_count; i++) {
                    if (actions[i] == "" ||
                        actions[i] == "CheckForUpdates" ||
                        actions[i] == "InstallReadyUpdate") {
                        continue
                    }
                    rendered = rendered actions[i] ";"
                }
                if (rendered != "") {
                    print "Actions=" rendered
                }
                next
            }
            /^\[Desktop Action CheckForUpdates\]$/ { skip = 1; next }
            /^\[Desktop Action InstallReadyUpdate\]$/ { skip = 1; next }
            /^\[/ { skip = 0 }
            skip { next }
            { print }
        ' "$temp_target" > "$filtered_target"
        mv "$filtered_target" "$target"
        filtered_target=""
        rm -f "$temp_target"
        temp_target=""
    fi
    trap - RETURN
    chmod 0644 "$target"
}

resolve_package_icon_source() {
    if [ -n "${PACKAGE_ICON_SOURCE:-}" ]; then
        printf '%s\n' "$PACKAGE_ICON_SOURCE"
        return 0
    fi
    printf '%s\n' "$REPO_DIR/assets/chatgpt-linux.png"
}

render_packaged_runtime_helper() {
    local target="$1"
    local package_name

    package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
    sed \
        -e "s/CHROME_DESKTOP=\"chatgpt.desktop\"/CHROME_DESKTOP=\"$package_name.desktop\"/" \
        -e "s|BAMF_DESKTOP_FILE_HINT=\"/usr/share/applications/chatgpt.desktop\"|BAMF_DESKTOP_FILE_HINT=\"/usr/share/applications/$package_name.desktop\"|" \
        -e "s/__CHATGPT_PACKAGE_ENABLE_UPDATER__/$(package_with_updater_value)/g" \
        "$PACKAGED_RUNTIME_SOURCE" > "$target"
    chmod 0644 "$target"
}

render_no_updater_transition_cleanup_helper() {
    local target="$1"

    cat > "$target" <<'SCRIPT'
#!/bin/sh

SERVICE_NAMES="${SERVICE_NAMES:-chatgpt-updater.service codex-app-updater.service codex-update-manager.service}"

chatgpt_no_updater_foreach_user_manager() {
    if ! command -v runuser >/dev/null 2>&1 ||
        ! command -v systemctl >/dev/null 2>&1 ||
        ! command -v getent >/dev/null 2>&1; then
        return
    fi

    for runtime_dir in /run/user/*; do
        [ -d "$runtime_dir" ] || continue

        uid="$(basename "$runtime_dir")"
        case "$uid" in
            ''|*[!0-9]*|0)
                continue
                ;;
        esac

        bus="$runtime_dir/bus"
        [ -S "$bus" ] || continue

        user_name="$(getent passwd "$uid" | cut -d: -f1 || true)"
        [ -n "$user_name" ] || continue

        "$@" "$user_name" "$runtime_dir" "$bus"
    done
}

chatgpt_no_updater_run_systemctl_user() {
    user_name="$1"
    runtime_dir="$2"
    bus="$3"
    shift 3

    runuser -u "$user_name" -- env \
        XDG_RUNTIME_DIR="$runtime_dir" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
        systemctl --user "$@" >/dev/null 2>&1
}

chatgpt_no_updater_cleanup_one_user_manager() {
    user_name="$1"
    runtime_dir="$2"
    bus="$3"

    for service_name in $SERVICE_NAMES; do
        chatgpt_no_updater_run_systemctl_user "$user_name" "$runtime_dir" "$bus" stop "$service_name" || true
        chatgpt_no_updater_run_systemctl_user "$user_name" "$runtime_dir" "$bus" disable "$service_name" || true
    done
    chatgpt_no_updater_run_systemctl_user "$user_name" "$runtime_dir" "$bus" daemon-reload || true
}

chatgpt_no_updater_cleanup_user_enablement_links() {
    if ! command -v getent >/dev/null 2>&1 || ! command -v runuser >/dev/null 2>&1; then
        return
    fi

    getent passwd | while IFS=: read -r user_name _ uid _ _ home _; do
        case "$uid" in
            ''|*[!0-9]*|0)
                continue
                ;;
        esac

        [ -n "$home" ] || continue
        [ "$home" != "/" ] || continue

        wants_dir="$home/.config/systemd/user/default.target.wants"
        for service_name in $SERVICE_NAMES; do
            service_link="$wants_dir/$service_name"
            [ -L "$service_link" ] || continue
            runuser -u "$user_name" -- rm -f "$service_link" >/dev/null 2>&1 || true
        done
    done
}

chatgpt_no_updater_cleanup_update_manager_service() {
    chatgpt_no_updater_foreach_user_manager chatgpt_no_updater_cleanup_one_user_manager
    chatgpt_no_updater_cleanup_user_enablement_links
}
SCRIPT
    chmod 0644 "$target"
}

render_desktop_entry_doctor_helper() {
    local target="$1"

    cp "$REPO_DIR/packaging/linux/chatgpt-desktop-entry-doctor.sh" "$target"
    chmod 0644 "$target"
}

write_no_updater_deb_postinst() {
    local target="$1"
    local package_name

    package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
    cat > "$target" <<SCRIPT
#!/bin/sh
set -eu

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

CLEANUP_HELPER="/usr/lib/$package_name/no-updater-transition-cleanup.sh"
if [ -f "\$CLEANUP_HELPER" ]; then
    # shellcheck source=/usr/lib/$package_name/no-updater-transition-cleanup.sh
    . "\$CLEANUP_HELPER"
    chatgpt_no_updater_cleanup_update_manager_service || true
fi

exit 0
SCRIPT
    chmod 0755 "$target"
}

write_no_updater_deb_prerm() {
    local target="$1"
    local package_name

    package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
    cat > "$target" <<SCRIPT
#!/bin/sh
set -eu

CLEANUP_HELPER="/usr/lib/$package_name/no-updater-transition-cleanup.sh"
if [ -f "\$CLEANUP_HELPER" ]; then
    # shellcheck source=/usr/lib/$package_name/no-updater-transition-cleanup.sh
    . "\$CLEANUP_HELPER"
    chatgpt_no_updater_cleanup_update_manager_service || true
fi

exit 0
SCRIPT
    chmod 0755 "$target"
}

write_no_updater_deb_postrm() {
    local target="$1"
    local package_name

    package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
    cat > "$target" <<SCRIPT
#!/bin/sh
set -eu

CLEANUP_HELPER="/usr/lib/$package_name/no-updater-transition-cleanup.sh"
if [ -f "\$CLEANUP_HELPER" ]; then
    # shellcheck source=/usr/lib/$package_name/no-updater-transition-cleanup.sh
    . "\$CLEANUP_HELPER"
    chatgpt_no_updater_cleanup_update_manager_service || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

exit 0
SCRIPT
    chmod 0755 "$target"
}

write_no_updater_pacman_install_hooks() {
    local target="$1"
    local package_name

    package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
    cat > "$target" <<SCRIPT
CLEANUP_HELPER="/usr/lib/$package_name/no-updater-transition-cleanup.sh"
chatgpt_no_updater_cleanup_if_present() {
    if [ -f "\$CLEANUP_HELPER" ]; then
        # shellcheck source=/usr/lib/$package_name/no-updater-transition-cleanup.sh
        . "\$CLEANUP_HELPER"
        chatgpt_no_updater_cleanup_update_manager_service || true
    fi
}


post_install() {
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
    fi
    chatgpt_no_updater_cleanup_if_present
}

post_upgrade() {
    post_install
}

pre_remove() {
    chatgpt_no_updater_cleanup_if_present
}
SCRIPT
    chmod 0644 "$target"
}

validate_app_payload_source() {
    local app_root
    local link
    local link_dir
    local resolved_target
    local target

    app_root="$(realpath -m "$APP_DIR")"
    while IFS= read -r -d '' link; do
        target="$(readlink "$link")" || error "Failed to read symlink: $link"
        link_dir="$(dirname "$link")"
        case "$target" in
        /*) error "Absolute symlinks are not allowed in app payload: $link -> $target" ;;
        *) resolved_target="$(realpath -m "$link_dir/$target")" ;;
        esac

        [ -e "$resolved_target" ] || error "Broken symlink in app payload: $link -> $target"

        case "$resolved_target" in
        "$app_root"|"$app_root"/*)
            ;;
        *)
            error "Unsafe symlink in app payload: $link -> $target"
            ;;
        esac
    done < <(find "$APP_DIR" -type l -print0)
}

normalize_app_payload_modes() {
    local app_root="$1"

    find "$app_root" -exec chmod u-s,g-s,o-t {} +
    chmod -R u+rwX,go+rX,go-w "$app_root"
}

updater_binary_is_stale() {
    local binary="$1"
    local canonical_binary
    local canonical_repo
    local requested_binary
    local requested_repo

    [ -x "$binary" ] || return 0
    canonical_binary="$(realpath -e -- "$binary")" || return 0
    canonical_repo="$(realpath -e -- "$REPO_DIR")" || return 0
    requested_binary="$(realpath -m -s -- "$binary")" || return 0
    requested_repo="$(realpath -m -s -- "$REPO_DIR")" || return 0

    # An explicit binary outside the copied source tree is an authoritative
    # prebuilt input. Updater-managed rebuilds pass their currently running
    # executable here; copied checkout mtimes must not force an untrusted or
    # unavailable Rust toolchain back into that rebuild. A path requested from
    # inside the source tree remains source-owned even if its final component
    # is a symlink to an external executable.
    if [[ "$requested_binary" != "$requested_repo" &&
        "$requested_binary" != "$requested_repo"/* &&
        "$requested_binary" != "$canonical_repo" &&
        "$requested_binary" != "$canonical_repo"/* &&
        "$canonical_binary" != "$canonical_repo" &&
        "$canonical_binary" != "$canonical_repo"/* ]]; then
        return 1
    fi

    local source
    for source in "$REPO_DIR/Cargo.toml" "$REPO_DIR/Cargo.lock"; do
        if [ -f "$source" ] && [ "$source" -nt "$binary" ]; then
            return 0
        fi
    done

    while IFS= read -r -d '' source; do
        if [ "$source" -nt "$binary" ]; then
            return 0
        fi
    done < <(find "$REPO_DIR/updater" -type f -print0 2>/dev/null)

    return 1
}

find_cargo_command() {
    if command -v cargo >/dev/null 2>&1; then
        command -v cargo
        return 0
    fi

    if [ -n "${HOME-}" ] && [ -x "$HOME/.cargo/bin/cargo" ]; then
        echo "$HOME/.cargo/bin/cargo"
        return 0
    fi

    return 1
}

updater_build_output_binary() {
    local target_dir="${CARGO_TARGET_DIR:-$REPO_DIR/target}"
    case "$target_dir" in
        /*) ;;
        *) target_dir="$REPO_DIR/$target_dir" ;;
    esac
    printf '%s\n' "$target_dir/release/chatgpt-updater"
}

ensure_updater_binary() {
    local cargo_cmd=""
    local built_binary=""

    if ! package_with_updater_enabled; then
        return
    fi

    if [ -x "$UPDATER_BINARY_SOURCE" ] && ! updater_binary_is_stale "$UPDATER_BINARY_SOURCE"; then
        return
    fi

    [ -f "$REPO_DIR/Cargo.toml" ] || error "Missing updater binary: $UPDATER_BINARY_SOURCE"
    cargo_cmd="$(find_cargo_command)" || error "cargo is required to build chatgpt-updater.
Install the Rust toolchain:
  bash scripts/install-deps.sh        # auto-installs via rustup
  # or manually: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"

    info "Building chatgpt-updater release binary"
    "$cargo_cmd" build --release -p chatgpt-updater >&2
    built_binary="$(updater_build_output_binary)"
    if [ -x "$built_binary" ]; then
        UPDATER_BINARY_SOURCE="$built_binary"
    fi
    [ -x "$UPDATER_BINARY_SOURCE" ] || error "Failed to build updater binary: $UPDATER_BINARY_SOURCE"
}

stage_update_builder_source_info() {
    local update_builder_root="$1"
    local info_dir="$update_builder_root/.chatgpt-linux"
    local info_file="$info_dir/source-info.json"
    local reviewed_source_info="${CHATGPT_LINUX_SOURCE_INFO_SOURCE:-}"
    local node_bin

    mkdir -p "$info_dir"
    if [ -n "$reviewed_source_info" ]; then
        [ -f "$reviewed_source_info" ] && [ ! -L "$reviewed_source_info" ] || \
            error "CHATGPT_LINUX_SOURCE_INFO_SOURCE must be a regular non-symlink file"
        cp "$reviewed_source_info" "$info_file"
        chmod 0644 "$info_file"
        return 0
    fi
    node_bin="$(package_node_binary)"
    "$node_bin" - "$REPO_DIR" "$info_file" <<'NODE'
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [repoDir, infoFile] = process.argv.slice(2);

function trustedGitBinary() {
  for (const candidate of ["/usr/bin/git", "/bin/git"]) {
    try {
      const stat = fs.statSync(candidate);
      fs.accessSync(candidate, fs.constants.X_OK);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next fixed system path.
    }
  }
  return null;
}

const trustedGit = trustedGitBinary();

function git(args, { allowEmpty = false } = {}) {
  if (trustedGit == null) {
    return null;
  }
  const result = childProcess.spawnSync(trustedGit, [
    "-C",
    repoDir,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    ...args,
  ], {
    encoding: "utf8",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: "/nonexistent",
      LC_ALL: "C",
      PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
      XDG_CONFIG_HOME: "/nonexistent",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 || allowEmpty ? value : null;
}

function isoTimestamp() {
  const epochSeconds = sourceDateEpoch();
  if (epochSeconds != null) {
    return new Date(epochSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function sourceDateEpoch() {
  const rawEpoch = process.env.SOURCE_DATE_EPOCH?.trim();
  if (!rawEpoch || !/^\d+$/.test(rawEpoch)) {
    return null;
  }
  const epochSeconds = Number(rawEpoch);
  return Number.isSafeInteger(epochSeconds) && epochSeconds >= 0 ? epochSeconds : null;
}

function sanitizeGitRemoteUrl(remote) {
  if (remote == null) {
    return null;
  }
  const value = String(remote).trim();
  if (
    value.length === 0
    || path.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || value === "."
    || value === ".."
    || value.startsWith("./")
    || value.startsWith("../")
    || value === "~"
    || value.startsWith("~/")
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return null;
    }
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.toString();
    }
  } catch {
    if (/^(?:[^@\s/:]+@)?[^@\s/:]+:.+$/.test(value)) {
      return value;
    }
    return null;
  }
  return value;
}

function shortSourceCommit(commit) {
  if (commit == null) {
    return null;
  }
  const value = String(commit);
  const suffix = value.endsWith("-dirty") ? "-dirty" : "";
  const revision = suffix ? value.slice(0, -suffix.length) : value;
  return `${revision.slice(0, 12)}${suffix}`;
}

function readJsonFile(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value != null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseWrapperVersion(content) {
  let inPackage = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inPackage = trimmed === "[package]";
      continue;
    }
    if (!inPackage) {
      continue;
    }
    const match = trimmed.match(/^version\s*=\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function readWrapperVersion(repoDir) {
  try {
    return parseWrapperVersion(fs.readFileSync(path.join(repoDir, "updater", "Cargo.toml"), "utf8"));
  } catch {
    return null;
  }
}

function sanitizeSourceInfo(info) {
  const remote = sanitizeGitRemoteUrl(info.remote);
  return {
    ...info,
    version: info.version ?? readWrapperVersion(repoDir),
    remote,
    commitUrl: githubCommitUrl(remote, info.commit),
    provenance: info.provenance ?? "packaged-update-builder",
    recapturedAt: isoTimestamp(),
    sourceDateEpoch: info.sourceDateEpoch ?? sourceDateEpoch(),
  };
}

function githubCommitUrl(remote, commit) {
  const sha = typeof commit === "string" ? commit.trim() : "";
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return null;
  }
  const value = sanitizeGitRemoteUrl(remote);
  if (value == null) {
    return null;
  }

  let ownerAndRepo = null;
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    ownerAndRepo = url.pathname.replace(/^\/+/, "");
  } catch {
    const scpMatch = value.match(/^(?:[^@]+@)?github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
    if (scpMatch) {
      ownerAndRepo = scpMatch[1];
    }
  }

  if (ownerAndRepo == null) {
    return null;
  }
  ownerAndRepo = ownerAndRepo.replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(ownerAndRepo)) {
    return null;
  }
  return `https://github.com/${ownerAndRepo}/commit/${sha}`;
}

const stagedInfo = readJsonFile(path.join(repoDir, ".chatgpt-linux", "source-info.json"));
let info;
if (stagedInfo?.commit) {
  info = sanitizeSourceInfo(stagedInfo);
} else {
  const commit = process.env.CHATGPT_LINUX_SOURCE_COMMIT?.trim() || git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"], { allowEmpty: true });
  const remote = sanitizeGitRemoteUrl(process.env.CHATGPT_LINUX_SOURCE_REMOTE?.trim() || git(["remote", "get-url", "origin"]));
  info = {
      commit,
      shortCommit: shortSourceCommit(commit),
      version: readWrapperVersion(repoDir),
      branch: process.env.CHATGPT_LINUX_SOURCE_BRANCH?.trim() || git(["branch", "--show-current"]),
      remote,
      commitUrl: githubCommitUrl(remote, commit),
      describe: process.env.CHATGPT_LINUX_SOURCE_DESCRIBE?.trim() || git(["describe", "--always", "--dirty", "--tags"]),
      dirty: status == null ? null : status.length > 0,
      provenance: "packaged-update-builder",
      capturedAt: isoTimestamp(),
      sourceDateEpoch: sourceDateEpoch(),
  };
}

fs.mkdirSync(path.dirname(infoFile), { recursive: true });
fs.writeFileSync(infoFile, `${JSON.stringify(info, null, 2)}\n`, "utf8");
NODE
}

write_update_builder_manifest() {
    local update_builder_root="$1"
    local manifest="$update_builder_root/.chatgpt-linux/update-builder-manifest.txt"
    (
        cd "$update_builder_root"
        find . -mindepth 1 -type f \
            ! -path './node-runtime/*' \
            ! -path './.chatgpt-linux/update-builder-manifest.txt' \
            -printf '%P\n' | LC_ALL=C sort > "$manifest"
    )
}

stage_common_package_files() {
    local root="$1"
    local app_root="$root/opt/$PACKAGE_NAME"
    local support_root="$root/usr/lib/$PACKAGE_NAME"
    local polkit_policy="$REPO_DIR/packaging/linux/com.github.nisavid.chatgpt.update.policy"
    local staged_generation_receipt
    local staged_receipt_root

    validate_package_inputs
    validate_app_payload_source
    ensure_app_layout
    if package_with_updater_enabled; then
        ensure_file_exists "$polkit_policy" "polkit policy"
    fi

    mkdir -p \
        "$root/opt" \
        "$root/usr/bin" \
        "$support_root" \
        "$root/usr/share/applications" \
        "$root/usr/share/icons/hicolor/256x256/apps"
    install -Dm0644 \
        "$REPO_DIR/LICENSE" "$root/usr/share/licenses/$PACKAGE_NAME/LICENSE"
    install -Dm0644 \
        "$REPO_DIR/packaging/OPENAI-NOTICE" "$root/usr/share/licenses/$PACKAGE_NAME/OPENAI-NOTICE"
    staged_receipt_root="$(cd "$root/opt" && pwd)/.chatgpt-generation-receipts"

    rm -rf "$app_root"
    staged_generation_receipt="$(copy_generation_bound_app_payload "$app_root")" || \
        error "Could not copy the generation-bound app payload"
    [ "$(dirname "$staged_generation_receipt")" = "$staged_receipt_root" ] && \
        [[ "$(basename "$staged_generation_receipt")" =~ ^[0-9a-f]{64}\.json$ ]] || \
        error "Staged generation receipt has an unexpected path: $staged_generation_receipt"
    if package_with_updater_enabled; then
        stage_update_builder_bundle "$root" "$app_root"
    fi
    rm -f -- "$staged_generation_receipt"
    rmdir -- "$staged_receipt_root" || \
        error "Could not remove the package-staging generation receipt root"
    normalize_app_payload_modes "$app_root"
    mkdir -p "$app_root/.chatgpt-linux"
    cp "$ICON_SOURCE" "$app_root/.chatgpt-linux/$PACKAGE_NAME.png"
    cp "$(resolve_tray_icon_source "$app_root")" "$app_root/.chatgpt-linux/$PACKAGE_NAME-tray.png"
    cp "$REPO_DIR/launcher/cli-launch-path.py" "$app_root/.chatgpt-linux/cli-launch-path.py"
    render_desktop_entry_doctor_helper "$app_root/.chatgpt-linux/chatgpt-desktop-entry-doctor.sh"
    render_desktop_entry "$root/usr/share/applications/$PACKAGE_NAME.desktop"
    cp "$ICON_SOURCE" "$root/usr/share/icons/hicolor/256x256/apps/$PACKAGE_NAME.png"
    if package_with_updater_enabled; then
        mkdir -p \
            "$root/usr/lib/systemd/user" \
            "$root/usr/share/polkit-1/actions"
        cp "$UPDATER_BINARY_SOURCE" "$root/usr/bin/chatgpt-updater"
        chmod 0755 "$root/usr/bin/chatgpt-updater"
        cp "$UPDATER_SERVICE_SOURCE" "$root/usr/lib/systemd/user/chatgpt-updater.service"
        chmod 0644 "$root/usr/lib/systemd/user/chatgpt-updater.service"
        cp "$polkit_policy" "$root/usr/share/polkit-1/actions/com.github.nisavid.chatgpt.update.policy"
        chmod 0644 "$root/usr/share/polkit-1/actions/com.github.nisavid.chatgpt.update.policy"
    else
        render_no_updater_transition_cleanup_helper \
            "$support_root/no-updater-transition-cleanup.sh"
    fi
    render_packaged_runtime_helper "$support_root/packaged-runtime.sh"
}

copy_generation_bound_app_payload() (
    local app_root="$1"
    local provenance_helper="$REPO_DIR/scripts/lib/package-provenance.py"
    local receipt_before
    local receipt_after
    local expected_broker_digest
    local expected_app_manifest
    local staged_receipt
    local staged_app_manifest
    local work_dir

    [ -f "$provenance_helper" ] && [ ! -L "$provenance_helper" ] || \
        error "Missing package provenance helper: $provenance_helper"
    receipt_before="$(read_generation_bound_mutation_broker_receipt "$APP_DIR")" || \
        error "Generated app is missing a valid external generation receipt"
    expected_broker_digest="${receipt_before%% *}"
    expected_app_manifest="${receipt_before#* }"
    expected_app_manifest="${expected_app_manifest%% *}"
    work_dir="$(mktemp -d "${TMPDIR:-/tmp}/chatgpt-app-copy.XXXXXX")" || \
        error "Could not create app-copy verification workspace"
    trap 'rm -rf -- "$work_dir"' EXIT

    cp -aT --no-preserve=links "$APP_DIR" "$app_root"
    python3 "$provenance_helper" manifest "$app_root" "$work_dir/staged.json" || \
        error "Could not manifest the staged app payload"
    staged_app_manifest="$(
        python3 -c \
            'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["manifestSha256"])' \
            "$work_dir/staged.json"
    )" || error "Could not read the staged app manifest digest"
    [ "$staged_app_manifest" = "$expected_app_manifest" ] || \
        error "Staged app payload differs from its generation receipt"

    receipt_after="$(read_generation_bound_mutation_broker_receipt "$APP_DIR")" || \
        error "Generated app changed while its package payload was copied"
    [ "$receipt_after" = "$receipt_before" ] || \
        error "Generated app receipt changed while its package payload was copied"
    staged_receipt="$(python3 "$provenance_helper" write-generation-receipt \
        --app "$app_root" \
        --broker-sha256 "$expected_broker_digest")" || \
        error "Could not bind the staged app payload to its generation receipt"
    printf '%s\n' "$staged_receipt"
)

resolve_tray_icon_source() {
    local app_root="$1"
    local assets_dir="$app_root/content/webview/assets"
    local -a candidates=()
    local candidate

    if [ -d "$assets_dir" ]; then
        while IFS= read -r -d '' candidate; do
            candidates+=("$candidate")
        done < <(find "$assets_dir" -maxdepth 1 -type f -name 'app-*.png' -print0 | sort -z)
    fi

    if [ "${#candidates[@]}" -eq 1 ]; then
        printf '%s\n' "${candidates[0]}"
        return 0
    fi

    if [ "${#candidates[@]}" -gt 1 ]; then
        warn "Multiple tray icon candidates found in $assets_dir; falling back to package icon"
    else
        warn "Could not resolve a unique tray icon in $assets_dir; falling back to package icon"
    fi
    printf '%s\n' "$ICON_SOURCE"
}

stage_update_builder_bundle() {
    package_with_updater_enabled || return 0

    local root="$1"
    local app_source_root="$2"
    local update_builder_root="$root/usr/lib/$PACKAGE_NAME/update-builder"
    local node_runtime_source="$app_source_root/resources/node-runtime"

    mkdir -p \
        "$update_builder_root/scripts" \
        "$update_builder_root/scripts/lib" \
        "$update_builder_root/scripts/patches" \
        "$update_builder_root/launcher" \
        "$update_builder_root/port-integrations" \
        "$update_builder_root/packaging/linux" \
        "$update_builder_root/assets" \
        "$update_builder_root/prebuilt-helpers"

    cp "$REPO_DIR/install.sh" "$update_builder_root/install.sh"
    cp "$REPO_DIR/CHANGELOG.md" "$update_builder_root/CHANGELOG.md"
    cp "$REPO_DIR/LICENSE" "$update_builder_root/LICENSE"
    cp "$REPO_DIR/packaging/OPENAI-NOTICE" "$update_builder_root/OPENAI-NOTICE"
    cp "$REPO_DIR/packaging/OPENAI-NOTICE" "$update_builder_root/packaging/OPENAI-NOTICE"
    cp "$REPO_DIR/launcher/start.sh.template" "$update_builder_root/launcher/start.sh.template"
    cp "$REPO_DIR/launcher/cli-launch-path.py" "$update_builder_root/launcher/cli-launch-path.py"
    cp "$REPO_DIR/launcher/webview-server.py" "$update_builder_root/launcher/webview-server.py"
    cp "$REPO_DIR/Cargo.toml" "$update_builder_root/Cargo.toml"
    cp "$REPO_DIR/Cargo.lock" "$update_builder_root/Cargo.lock"
    cp -r "$REPO_DIR/generated-app-mutation-broker" \
        "$update_builder_root/generated-app-mutation-broker"
    cp -r "$REPO_DIR/computer-use-linux" "$update_builder_root/computer-use-linux"
    cp -r "$REPO_DIR/notification-actions-linux" "$update_builder_root/notification-actions-linux"
    cp -r "$REPO_DIR/record-replay-linux" "$update_builder_root/record-replay-linux"
    cp -r "$REPO_DIR/read-aloud-linux" "$update_builder_root/read-aloud-linux"
    cp -r "$REPO_DIR/updater" "$update_builder_root/updater"
    mkdir -p "$update_builder_root/plugins/openai-bundled/plugins"
    cp -r "$REPO_DIR/plugins/openai-bundled/plugins/computer-use" \
        "$update_builder_root/plugins/openai-bundled/plugins/computer-use"
    cp -r "$REPO_DIR/plugins/openai-bundled/plugins/read-aloud" \
        "$update_builder_root/plugins/openai-bundled/plugins/read-aloud"
    cp "$REPO_DIR/scripts/build-deb.sh" "$update_builder_root/scripts/build-deb.sh"
    cp "$REPO_DIR/scripts/build-rpm.sh" "$update_builder_root/scripts/build-rpm.sh"
    cp "$REPO_DIR/scripts/build-pacman.sh" "$update_builder_root/scripts/build-pacman.sh"
    cp "$REPO_DIR/scripts/rebuild-candidate.sh" "$update_builder_root/scripts/rebuild-candidate.sh"
    cp "$REPO_DIR/scripts/validate-upstream-dmg.js" "$update_builder_root/scripts/validate-upstream-dmg.js"
    cp "$REPO_DIR/scripts/patch-linux-window-ui.js" "$update_builder_root/scripts/patch-linux-window-ui.js"
    cp -r "$REPO_DIR/scripts/patches/." "$update_builder_root/scripts/patches/"
    cp "$REPO_DIR/scripts/lib/package-common.sh" "$update_builder_root/scripts/lib/package-common.sh"
    cp "$REPO_DIR/scripts/lib/package-provenance.py" \
        "$update_builder_root/scripts/lib/package-provenance.py"
    cp "$REPO_DIR/scripts/lib/parcel-watcher-target.js" \
        "$update_builder_root/scripts/lib/parcel-watcher-target.js"
    cp -r "$REPO_DIR/scripts/lib/parcel-watcher" \
        "$update_builder_root/scripts/lib/parcel-watcher"
    cp "$REPO_DIR/scripts/lib/generated-app-mutation-broker.sh" \
        "$update_builder_root/scripts/lib/generated-app-mutation-broker.sh"
    cp "$REPO_DIR/scripts/lib/patch-chrome-plugin.js" "$update_builder_root/scripts/lib/patch-chrome-plugin.js"
    cp "$REPO_DIR/scripts/lib/node-runtime.sh" "$update_builder_root/scripts/lib/node-runtime.sh"
    cp "$REPO_DIR/scripts/lib/upstream-dmg-intel.js" "$update_builder_root/scripts/lib/upstream-dmg-intel.js"
    cp "$REPO_DIR/scripts/lib/install-helpers.sh" "$update_builder_root/scripts/lib/install-helpers.sh"
    cp "$REPO_DIR/scripts/lib/process-detection.sh" "$update_builder_root/scripts/lib/process-detection.sh"
    cp "$REPO_DIR/scripts/lib/dmg.sh" "$update_builder_root/scripts/lib/dmg.sh"
    cp "$REPO_DIR/scripts/lib/native-modules.sh" "$update_builder_root/scripts/lib/native-modules.sh"
    cp "$REPO_DIR/scripts/lib/asar-patch.sh" "$update_builder_root/scripts/lib/asar-patch.sh"
    cp "$REPO_DIR/scripts/lib/webview-install.sh" "$update_builder_root/scripts/lib/webview-install.sh"
    cp "$REPO_DIR/scripts/lib/bundled-plugins.sh" "$update_builder_root/scripts/lib/bundled-plugins.sh"
    cp "$REPO_DIR/scripts/lib/port-integrations.js" "$update_builder_root/scripts/lib/port-integrations.js"
    cp "$REPO_DIR/scripts/lib/port-integrations.sh" "$update_builder_root/scripts/lib/port-integrations.sh"
    cp "$REPO_DIR/scripts/lib/notification-actions.sh" "$update_builder_root/scripts/lib/notification-actions.sh"
    cp "$REPO_DIR/scripts/lib/patch-browser-client-iab-socket-scope.js" \
        "$update_builder_root/scripts/lib/patch-browser-client-iab-socket-scope.js"
    cp "$REPO_DIR/scripts/lib/linux-target-context.js" "$update_builder_root/scripts/lib/linux-target-context.js"
    cp "$REPO_DIR/scripts/lib/patch-report.js" "$update_builder_root/scripts/lib/patch-report.js"
    cp "$REPO_DIR/scripts/lib/patch-validation.js" "$update_builder_root/scripts/lib/patch-validation.js"
    cp "$REPO_DIR/scripts/lib/upstream-dmg-acceptance.js" "$update_builder_root/scripts/lib/upstream-dmg-acceptance.js"
    cp "$REPO_DIR/scripts/lib/upstream-dmg-release-profile.js" "$update_builder_root/scripts/lib/upstream-dmg-release-profile.js"
    cp "$REPO_DIR/scripts/lib/candidate-install.sh" "$update_builder_root/scripts/lib/candidate-install.sh"
    cp "$REPO_DIR/scripts/lib/candidate-promotion.py" "$update_builder_root/scripts/lib/candidate-promotion.py"
    cp "$REPO_DIR/scripts/lib/rebuild-report.sh" "$update_builder_root/scripts/lib/rebuild-report.sh"
    cp "$REPO_DIR/scripts/lib/build-info.js" "$update_builder_root/scripts/lib/build-info.js"
    cp "$REPO_DIR/scripts/lib/build-info.sh" "$update_builder_root/scripts/lib/build-info.sh"
    cp "$REPO_DIR/packaging/linux/control" "$update_builder_root/packaging/linux/control"
    cp "$REPO_DIR/packaging/linux/chatgpt.spec" "$update_builder_root/packaging/linux/chatgpt.spec"
    cp "$REPO_DIR/packaging/linux/chatgpt.desktop" "$update_builder_root/packaging/linux/chatgpt.desktop"
    cp "$REPO_DIR/packaging/linux/chatgpt-desktop-entry-doctor.sh" \
        "$update_builder_root/packaging/linux/chatgpt-desktop-entry-doctor.sh"
    cp "$REPO_DIR/packaging/linux/chatgpt-packaged-runtime.sh" "$update_builder_root/packaging/linux/chatgpt-packaged-runtime.sh"
    cp "$REPO_DIR/packaging/linux/com.github.nisavid.chatgpt.update.policy" \
        "$update_builder_root/packaging/linux/com.github.nisavid.chatgpt.update.policy"
    cp "$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh" \
        "$update_builder_root/packaging/linux/chatgpt-updater-user-service.sh"
    cp "$REPO_DIR/packaging/linux/PKGBUILD.template" "$update_builder_root/packaging/linux/PKGBUILD.template"
    cp "$REPO_DIR/packaging/linux/debian-copyright" "$update_builder_root/packaging/linux/debian-copyright"
    cp "$REPO_DIR/packaging/linux/chatgpt.install" "$update_builder_root/packaging/linux/chatgpt.install"
    cp "$UPDATER_SERVICE_SOURCE" "$update_builder_root/packaging/linux/chatgpt-updater.service"
    cp "$REPO_DIR/packaging/linux/chatgpt-updater.postinst" "$update_builder_root/packaging/linux/chatgpt-updater.postinst"
    cp "$REPO_DIR/packaging/linux/chatgpt-updater.prerm" "$update_builder_root/packaging/linux/chatgpt-updater.prerm"
    stage_update_builder_port_integrations_tree "$update_builder_root"
    cp "$REPO_DIR/packaging/linux/chatgpt-updater.postrm" "$update_builder_root/packaging/linux/chatgpt-updater.postrm"
    if port_integration_enabled "global-dictation"; then
        stage_update_builder_global_dictation_source "$update_builder_root"
    fi
    cp "$REPO_DIR/assets/chatgpt.png" "$update_builder_root/assets/chatgpt.png"
    cp "$REPO_DIR/assets/chatgpt-linux.png" "$update_builder_root/assets/chatgpt-linux.png"
    stage_update_builder_prebuilt_helpers "$update_builder_root" "$app_source_root"
    stage_update_builder_source_info "$update_builder_root"
    write_update_builder_manifest "$update_builder_root"
    if [ -d "$node_runtime_source" ]; then
        cp -a "$node_runtime_source" "$update_builder_root/node-runtime"
    else
        error "Missing managed Node.js runtime: $node_runtime_source. Run ./install.sh first."
    fi
}

stage_update_builder_prebuilt_helper() {
    local source="$1"
    local destination="$2"
    local label="$3"

    [ -e "$source" ] || return 1
    [ -f "$source" ] && [ ! -L "$source" ] && [ -x "$source" ] || \
        error "Invalid $label helper binary: $source"
    install -m 0755 "$source" "$destination"
}

stage_update_builder_prebuilt_helpers() {
    local update_builder_root="$1"
    local app_source_root="$2"
    local helpers_root="$update_builder_root/prebuilt-helpers"
    local computer_use_root="$app_source_root/resources/plugins/openai-bundled/plugins/computer-use/bin"
    local notification_actions_source="$app_source_root/resources/native/chatgpt-notification-actions-linux"
    local global_dictation_source="$app_source_root/resources/native/chatgpt-global-dictation-linux"
    local read_aloud_mcp_source="$app_source_root/resources/plugins/openai-bundled/plugins/read-aloud/bin/chatgpt-read-aloud-linux"
    local x11_computer_use_source="$app_source_root/resources/plugins/openai-bundled/plugins/chatgpt-computer-use-x11/bin/chatgpt-computer-use-x11"
    local chrome_host_source=""
    local chrome_arch=""
    local mutation_broker_source

    resolve_generated_app_mutation_broker || \
        error "Could not resolve the generated-app mutation broker used by this package build"
    mutation_broker_source="$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
    stage_generation_bound_mutation_broker \
        "$app_source_root" \
        "$mutation_broker_source" \
        "$helpers_root/$GENERATED_APP_MUTATION_BROKER_BINARY" || \
        error "Could not stage the generation-bound generated-app mutation broker"

    case "$(uname -m)" in
        x86_64) chrome_arch="x64" ;;
        aarch64|arm64) chrome_arch="arm64" ;;
    esac
    if [ -n "$chrome_arch" ]; then
        chrome_host_source="$app_source_root/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/$chrome_arch/extension-host"
    fi

    local backend_source="$computer_use_root/chatgpt-computer-use-linux"
    local cosmic_source="$computer_use_root/chatgpt-computer-use-cosmic"
    if [ -e "$backend_source" ] || [ -e "$cosmic_source" ]; then
        stage_update_builder_prebuilt_helper \
            "$backend_source" \
            "$helpers_root/chatgpt-computer-use-linux" \
            "Linux Computer Use backend"
        stage_update_builder_prebuilt_helper \
            "$cosmic_source" \
            "$helpers_root/chatgpt-computer-use-cosmic" \
            "Linux Computer Use COSMIC"
    fi

    stage_update_builder_prebuilt_helper \
        "$notification_actions_source" \
        "$helpers_root/chatgpt-notification-actions-linux" \
        "notification actions" || true
    if [ -n "$chrome_host_source" ]; then
        stage_update_builder_prebuilt_helper \
            "$chrome_host_source" \
            "$helpers_root/chatgpt-chrome-extension-host" \
            "Chrome extension host" || true
    fi
    if port_integration_enabled "global-dictation"; then
        stage_update_builder_prebuilt_helper \
            "$global_dictation_source" \
            "$helpers_root/chatgpt-global-dictation-linux" \
            "global dictation" || error "Enabled Global Dictation helper is missing from the generated app"
    fi
    if port_integration_enabled "read-aloud-mcp"; then
        stage_update_builder_prebuilt_helper \
            "$read_aloud_mcp_source" \
            "$helpers_root/chatgpt-read-aloud-linux" \
            "Read Aloud MCP" || error "Enabled Read Aloud MCP helper is missing from the generated app"
    fi
    if port_integration_enabled "x11-ewmh-computer-use"; then
        if [ ! -f "$x11_computer_use_source" ] \
            || [ -L "$x11_computer_use_source" ] \
            || [ ! -x "$x11_computer_use_source" ]; then
            error "Enabled X11/EWMH Computer Use helper is missing or invalid: $x11_computer_use_source"
        fi
        stage_update_builder_prebuilt_helper \
            "$x11_computer_use_source" \
            "$helpers_root/chatgpt-computer-use-x11" \
            "X11/EWMH Computer Use"
    fi
}

restore_port_integration_payload_permissions() {
    local root="$1"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local app_root="$root/opt/$PACKAGE_NAME"
    local node_bin
    local staged_files_json

    [ -d "$root" ] || error "Missing package root: $root"
    [ -d "$app_root" ] || error "Missing package app root: $app_root"
    [ -f "$helper" ] || error "Missing port integrations helper: $helper"

    node_bin="$(package_node_binary)"
    if ! staged_files_json="$("$node_bin" "$helper" --staged-files-json "$app_root")"; then
        error "Failed to read port integration staged file manifest"
    fi

    if ! "$node_bin" - "$app_root" "$staged_files_json" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [appRoot, rawJson] = process.argv.slice(2);
const entries = JSON.parse(rawJson);

if (!Array.isArray(entries)) {
  throw new Error("port integration staged files payload must be an array");
}

function assertRelativeTarget(target) {
  if (typeof target !== "string" || target.length === 0) {
    throw new Error("port integration staged file target must be a relative path");
  }
  const parts = target.split(/[\\/]+/).filter(Boolean);
  if (path.isAbsolute(target) || parts.includes("..")) {
    throw new Error(`Unsafe port integration staged file target: ${target}`);
  }
  const resolved = path.resolve(appRoot, ...parts);
  const relative = path.relative(appRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe port integration staged file target: ${target}`);
  }
  return resolved;
}

for (const entry of entries) {
  if (entry == null || typeof entry !== "object") {
    throw new Error("port integration staged file entry must be an object");
  }
  if (typeof entry.mode !== "string" || !/^[0-7]{3,4}$/.test(entry.mode)) {
    throw new Error(`Invalid port integration staged file mode for ${entry.target}: ${entry.mode}`);
  }
  const target = assertRelativeTarget(entry.target);
  if (!fs.existsSync(target)) {
    throw new Error(`port integration staged file is missing from package payload: ${entry.target}`);
  }
  fs.chmodSync(target, Number.parseInt(entry.mode, 8));
}
NODE
    then
        error "Failed to restore port integration staged file permissions"
    fi
}

restore_port_integration_package_resource_permissions() {
    local root="$1"
    local package_format="$2"
    local helper="$REPO_DIR/scripts/lib/port-integrations.js"
    local node_bin
    local app_dir="$root/opt/$PACKAGE_NAME"

    [ -d "$root" ] || error "Missing package root: $root"
    [ -f "$helper" ] || error "Missing port integrations helper: $helper"

    node_bin="$(package_node_binary)"
    if ! "$node_bin" "$helper" \
        --restore-package-resource-permissions "$package_format" "$root" "$app_dir"; then
        error "Failed to restore port integration package resource permissions"
    fi
}

normalize_package_payload_permissions() {
    local root="$1"

    [ -d "$root" ] || error "Missing package root: $root"
    find "$root" -type d -exec chmod 0755 {} +
    find "$root" -type f \( -perm /u=x -o -perm /g=x -o -perm /o=x \) -exec chmod 0755 {} +
    find "$root" -type f ! \( -perm /u=x -o -perm /g=x -o -perm /o=x \) -exec chmod 0644 {} +
}

normalize_package_payload_timestamps() {
    local root="$1"

    [ -d "$root" ] || error "Missing package root: $root"
    [ -n "${SOURCE_DATE_EPOCH:-}" ] || error "SOURCE_DATE_EPOCH is required for package timestamps"
    find "$root" -depth -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
}

write_launcher_stub() {
    local root="$1"

    cat > "$root/usr/bin/$PACKAGE_NAME" <<SCRIPT
#!/usr/bin/env bash
exec /opt/$PACKAGE_NAME/start.sh "\$@"
SCRIPT
    chmod 0755 "$root/usr/bin/$PACKAGE_NAME"
}

stage_native_package_payload() {
    local root="$1"
    local package_format="$2"

    case "$package_format" in
        deb|rpm|pacman) ;;
        *) error "Unsupported native package format: $package_format" ;;
    esac

    ensure_package_source_date_epoch
    stage_common_package_files "$root"
    if ! package_with_updater_enabled; then
        info "Skipping update-builder bundle (PACKAGE_WITH_UPDATER=0)"
    fi
    write_launcher_stub "$root"
    stage_port_integration_package_resources "$root" "$package_format"
    run_port_integration_package_hooks "$root" "$package_format"
    normalize_package_payload_permissions "$root"
    restore_port_integration_payload_permissions "$root"
    restore_port_integration_package_resource_permissions "$root" "$package_format"
    normalize_package_payload_timestamps "$root"
}
