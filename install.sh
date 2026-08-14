#!/bin/bash
set -Eeuo pipefail

# ============================================================================
# ChatGPT for Linux — Installer
# Converts the official macOS ChatGPT app to run on Linux
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

reject_obsolete_installer_environment() {
    local obsolete replacement
    while read -r obsolete replacement; do
        [ -n "$obsolete" ] || continue
        if [[ -v "$obsolete" ]]; then
            echo "$obsolete is no longer supported; use $replacement" >&2
            return 1
        fi
    done <<'OBSOLETE_INSTALLER_ENV'
CODEX_ACCEPTANCE_DECISION_JSON CHATGPT_ACCEPTANCE_DECISION_JSON
CODEX_ACCEPTANCE_NODE CHATGPT_ACCEPTANCE_NODE
CODEX_ACCEPTANCE_OVERRIDE CHATGPT_ACCEPTANCE_OVERRIDE
CODEX_ACCEPTANCE_SOURCE CHATGPT_ACCEPTANCE_SOURCE
CODEX_ACCEPTANCE_TRANSACTION_ID CHATGPT_ACCEPTANCE_TRANSACTION_ID
CODEX_APP_DISPLAY_NAME CHATGPT_APP_DISPLAY_NAME
CODEX_APP_ID CHATGPT_APP_ID
CODEX_INSTALLER_SOURCE_ONLY CHATGPT_INSTALLER_SOURCE_ONLY
CODEX_INSTALL_DIR CHATGPT_INSTALL_DIR
CODEX_INSTALL_ROOT CHATGPT_INSTALL_ROOT
CODEX_INSTALL_TRANSACTION_ACTIVE CHATGPT_INSTALL_TRANSACTION_ACTIVE
CODEX_KEEP_REJECTED_CANDIDATE CHATGPT_KEEP_REJECTED_CANDIDATE
CODEX_LINUX_ICON_SOURCE CHATGPT_LINUX_ICON_SOURCE
CODEX_MANAGED_NODE_RUNTIME_DIR CHATGPT_MANAGED_NODE_RUNTIME_DIR
CODEX_MICRO_NODE_HID_ARCHIVE CHATGPT_MICRO_NODE_HID_ARCHIVE
CODEX_PATCH_REPORT_JSON CHATGPT_PATCH_REPORT_JSON
CODEX_PATCH_REPORT_RESOLVED CHATGPT_PATCH_REPORT_RESOLVED
CODEX_REBUILD_REPORT_JSON CHATGPT_REBUILD_REPORT_JSON
CODEX_UPSTREAM_DMG_METADATA_JSON CHATGPT_OFFICIAL_DMG_METADATA_JSON
CODEX_WEBVIEW_PORT CHATGPT_WEBVIEW_PORT
OBSOLETE_INSTALLER_ENV
}

reject_obsolete_installer_environment

CHATGPT_APP_ID="${CHATGPT_APP_ID:-chatgpt}"
CHATGPT_APP_DISPLAY_NAME="${CHATGPT_APP_DISPLAY_NAME:-ChatGPT}"
INSTALL_ROOT="${CHATGPT_INSTALL_ROOT:-$SCRIPT_DIR}"
DEFAULT_INSTALL_DIR_NAME="$CHATGPT_APP_ID"
DEFAULT_CHATGPT_WEBVIEW_PORT=5175
if [ "$CHATGPT_APP_ID" != "chatgpt" ]; then
    DEFAULT_CHATGPT_WEBVIEW_PORT=5176
fi
INSTALL_DIR="${CHATGPT_INSTALL_DIR:-$INSTALL_ROOT/$DEFAULT_INSTALL_DIR_NAME}"
CHATGPT_WEBVIEW_PORT="${CHATGPT_WEBVIEW_PORT:-$DEFAULT_CHATGPT_WEBVIEW_PORT}"
ELECTRON_VERSION="41.3.0"
ELECTRON_HEADERS_URL="${ELECTRON_HEADERS_URL:-${npm_config_disturl:-${NPM_CONFIG_DISTURL:-https://artifacts.electronjs.org/headers/dist}}}"
ELECTRON_MIRROR="${ELECTRON_MIRROR:-}"
MIN_BETTER_SQLITE3_VERSION_FOR_ELECTRON_41="12.9.0"
MIN_BETTER_SQLITE3_VERSION_FOR_ELECTRON_42="12.10.0"
WORK_DIR="$(mktemp -d)"
ARCH="$(uname -m)"
ICON_SOURCE="$SCRIPT_DIR/assets/chatgpt.png"
LINUX_ICON_SOURCE="${CHATGPT_LINUX_ICON_SOURCE:-}"

# ---- Source library helpers ----
. "$SCRIPT_DIR/scripts/lib/install-helpers.sh"
. "$SCRIPT_DIR/scripts/lib/node-runtime.sh"
. "$SCRIPT_DIR/scripts/lib/process-detection.sh"
. "$SCRIPT_DIR/scripts/lib/dmg.sh"
. "$SCRIPT_DIR/scripts/lib/native-modules.sh"
. "$SCRIPT_DIR/scripts/lib/asar-patch.sh"
. "$SCRIPT_DIR/scripts/lib/webview-install.sh"
. "$SCRIPT_DIR/scripts/lib/bundled-plugins.sh"
. "$SCRIPT_DIR/scripts/lib/notification-actions.sh"
. "$SCRIPT_DIR/scripts/lib/port-integrations.sh"
. "$SCRIPT_DIR/scripts/lib/rebuild-report.sh"
. "$SCRIPT_DIR/scripts/lib/build-info.sh"
. "$SCRIPT_DIR/scripts/lib/candidate-install.sh"
. "$SCRIPT_DIR/scripts/lib/generated-app-mutation-broker.sh"

transaction_report_base() {
    if [ -n "${REBUILD_REPORT_DIR:-}" ]; then
        printf '%s\n' "$REBUILD_REPORT_DIR"
    elif [ -n "${CHATGPT_PATCH_REPORT_JSON:-}" ]; then
        dirname "$CHATGPT_PATCH_REPORT_JSON"
    else
        printf '%s\n' "$SCRIPT_DIR/dist-next/rebuild"
    fi
}

publish_transaction_report() {
    local source_path="$1"
    local destination_path="$2"
    local temporary_path
    [ -f "$source_path" ] || return 0
    mkdir -p "$(dirname "$destination_path")"
    temporary_path="${destination_path}.tmp.$$"
    cp "$source_path" "$temporary_path"
    mv -f "$temporary_path" "$destination_path"
}

write_transaction_dmg_metadata() {
    local output_path="$1"
    local dmg_path="$2"
    local cached_metadata="$3"
    "${CHATGPT_ACCEPTANCE_NODE:-node}" - "$output_path" "$dmg_path" "$cached_metadata" "$DMG_URL" <<'NODE'
const fs = require("node:fs");
const [outputPath, dmgPath, metadataPath, url] = process.argv.slice(2);
const metadata = { url, path: dmgPath };
if (metadataPath && fs.existsSync(metadataPath)) {
  for (const line of fs.readFileSync(metadataPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) metadata[line.slice(0, separator)] = line.slice(separator + 1);
  }
}
fs.mkdirSync(require("node:path").dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
NODE
}

transactional_install() {
    local -a original_args=("$@")
    local final_dir="$INSTALL_DIR"
    local final_parent
    local final_name
    local candidate_dir
    local report_base
    local report_dir
    local transaction_id
    local core_report
    local published_core_report
    local rebuild_report
    local published_rebuild_report
    local decision_path
    local published_decision_path
    local metadata_path
    local build_info_path
    local dmg_path
    local build_status="failure"
    local generation_receipt
    local generation_broker_digest
    local verdict
    local -a acceptance_args=()

    final_parent="$(dirname "$final_dir")"
    final_name="$(basename "$final_dir")"
    mkdir -p "$final_parent"
    # Recover a completed exchange before the standard candidate path can be
    # reused or cleaned by a new transaction.
    recover_pending_candidate_promotion "$final_dir"
    candidate_dir="$final_parent/.${final_name}.candidate-$$"
    assert_distinct_candidate_paths "$candidate_dir" "$final_dir"
    remove_tree_safely "$candidate_dir"
    mkdir -m 0700 -- "$candidate_dir"
    assert_private_transaction_candidate_root "$candidate_dir"

    report_base="$(transaction_report_base)"
    transaction_id="${CHATGPT_ACCEPTANCE_TRANSACTION_ID:-$(date -u +%Y%m%dT%H%M%S)-$$-${RANDOM:-0}}"
    report_dir="$report_base/transactions/$transaction_id"
    mkdir -p "$report_dir"
    core_report="$report_dir/patch-report.json"
    published_core_report="${CHATGPT_PATCH_REPORT_JSON:-$report_base/patch-report.json}"
    rebuild_report="$report_dir/rebuild-report.json"
    published_rebuild_report="${CHATGPT_REBUILD_REPORT_JSON:-$report_base/rebuild-report.json}"
    decision_path="$report_dir/upstream-dmg-decision.json"
    published_decision_path="${CHATGPT_ACCEPTANCE_DECISION_JSON:-$report_base/upstream-dmg-decision.json}"
    metadata_path="${CHATGPT_OFFICIAL_DMG_METADATA_JSON:-$report_dir/upstream-dmg-metadata.json}"
    rm -f "$core_report" "$rebuild_report" "$decision_path"

    info "Building a transactional candidate: $candidate_dir"
    # Re-enter through the current Bash binary. Nix builds intentionally do not
    # expose /bin/bash, so executing this script through its shebang is unsafe.
    if CHATGPT_INSTALL_TRANSACTION_ACTIVE=1 \
        CHATGPT_INSTALL_DIR="$candidate_dir" \
        CHATGPT_PATCH_REPORT_JSON="$core_report" \
        CHATGPT_REBUILD_REPORT_JSON="$rebuild_report" \
        "$BASH" "$SCRIPT_DIR/install.sh" "${original_args[@]}"; then
        build_status="success"
    fi

    if [ -n "$PROVIDED_DMG_PATH" ]; then
        dmg_path="$(realpath "$PROVIDED_DMG_PATH")"
    else
        dmg_path="$CACHED_DMG_PATH"
    fi
    build_info_path="$candidate_dir/.chatgpt-linux/build-info.json"

    if [ -z "${CHATGPT_OFFICIAL_DMG_METADATA_JSON:-}" ] || [ ! -f "$metadata_path" ]; then
        write_transaction_dmg_metadata "$metadata_path" "$dmg_path" "$CACHED_DMG_METADATA_PATH"
    fi

    acceptance_args=(
        --repo-root "$SCRIPT_DIR"
        --dmg "$dmg_path"
        --core-report "$core_report"
        --build-info "$build_info_path"
        --metadata "$metadata_path"
        --build-status "$build_status"
        --output "$decision_path"
        --source "${CHATGPT_ACCEPTANCE_SOURCE:-local}"
    )
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] && acceptance_args+=(--summary "$GITHUB_STEP_SUMMARY")
    [ -n "${GITHUB_RUN_ID:-}" ] && acceptance_args+=(--run-id "$GITHUB_RUN_ID")
    [ -n "${GITHUB_RUN_ATTEMPT:-}" ] && acceptance_args+=(--run-attempt "$GITHUB_RUN_ATTEMPT")
    if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
        acceptance_args+=(--run-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID")
    fi
    "$CHATGPT_ACCEPTANCE_NODE" "$SCRIPT_DIR/scripts/validate-upstream-dmg.js" "${acceptance_args[@]}"

    publish_transaction_report "$core_report" "$published_core_report"
    publish_transaction_report "$rebuild_report" "$published_rebuild_report"
    publish_transaction_report "$decision_path" "$published_decision_path"

    verdict="$("$CHATGPT_ACCEPTANCE_NODE" -e 'console.log(require(process.argv[1]).verdict)' "$decision_path")"
    info "Upstream DMG acceptance verdict: $verdict"
    if [ "$verdict" != "accepted" ] && [ "$verdict" != "accepted_with_warnings" ]; then
        if [ "${CHATGPT_ACCEPTANCE_OVERRIDE:-0}" = "1" ] && [ "$build_status" = "success" ]; then
            warn "CHATGPT_ACCEPTANCE_OVERRIDE=1 set; promoting a candidate with verdict $verdict"
        else
            if [ "${CHATGPT_KEEP_REJECTED_CANDIDATE:-0}" != "1" ]; then
                remove_tree_safely "$candidate_dir"
            else
                warn "Rejected candidate retained for diagnostics: $candidate_dir"
            fi
            error "Candidate was not installed (verdict: $verdict). Decision: $published_decision_path"
        fi
    fi

    generation_receipt="$(
        read_generation_bound_mutation_broker_receipt "$candidate_dir"
    )" || error "Accepted candidate is missing its generation-bound mutation broker receipt"
    generation_broker_digest="${generation_receipt%% *}"
    mkdir -p "$candidate_dir/.chatgpt-linux"
    cp "$decision_path" "$candidate_dir/.chatgpt-linux/upstream-dmg-decision.json"
    python3 "$GENERATED_APP_MUTATION_BROKER_PROVENANCE_HELPER" \
        write-generation-receipt \
        --app "$candidate_dir" \
        --broker-sha256 "$generation_broker_digest" >/dev/null || \
        error "Could not bind the accepted candidate to its final app manifest"
    assert_private_transaction_candidate_root "$candidate_dir"
    chmod 0755 -- "$candidate_dir"
    if ! promote_candidate_install "$candidate_dir" "$final_dir"; then
        if [ "${CHATGPT_KEEP_REJECTED_CANDIDATE:-0}" != "1" ]; then
            remove_tree_safely "$candidate_dir"
        else
            warn "Unpromoted candidate retained for diagnostics: $candidate_dir"
        fi
        error "Accepted candidate could not be promoted; the existing app was not changed"
    fi
    info "Acceptance transaction reports: $report_dir"
    info "Acceptance decision: $published_decision_path"
    if [ -n "${PROMOTED_BACKUP_APP_DIR:-}" ]; then
        info "Previous app backup: $PROMOTED_BACKUP_APP_DIR"
    fi
}

# ---- Create start script ----
create_start_script() {
    local quoted_app_id
    local quoted_app_display_name
    local quoted_webview_port
    quoted_app_id="$(shell_quote "$CHATGPT_APP_ID")"
    quoted_app_display_name="$(shell_quote "$CHATGPT_APP_DISPLAY_NAME")"
    quoted_webview_port="$(shell_quote "$CHATGPT_WEBVIEW_PORT")"

    cat > "$INSTALL_DIR/start.sh" << SCRIPT
#!/bin/bash
set -euo pipefail

CHATGPT_LINUX_APP_ID=$quoted_app_id
CHATGPT_LINUX_APP_DISPLAY_NAME=$quoted_app_display_name
CHATGPT_LINUX_WEBVIEW_PORT=\${CHATGPT_WEBVIEW_PORT:-$quoted_webview_port}
SCRIPT

    cat "$SCRIPT_DIR/launcher/start.sh.template" >> "$INSTALL_DIR/start.sh"

    chmod +x "$INSTALL_DIR/start.sh"
    mkdir -p "$INSTALL_DIR/.chatgpt-linux"
    [ -f "$SCRIPT_DIR/launcher/webview-server.py" ] ||
        error "Webview server helper not found at $SCRIPT_DIR/launcher/webview-server.py"
    cp "$SCRIPT_DIR/launcher/webview-server.py" "$INSTALL_DIR/.chatgpt-linux/webview-server.py"
    cp "$SCRIPT_DIR/launcher/cli-launch-path.py" "$INSTALL_DIR/.chatgpt-linux/cli-launch-path.py"
    chmod 0755 "$INSTALL_DIR/.chatgpt-linux/cli-launch-path.py"
    cp "$SCRIPT_DIR/launcher/state-migration.py" "$INSTALL_DIR/.chatgpt-linux/state-migration.py"
    chmod 0755 "$INSTALL_DIR/.chatgpt-linux/state-migration.py"
    local linux_icon_source="$LINUX_ICON_SOURCE"
    [ -f "$linux_icon_source" ] || linux_icon_source="$ICON_SOURCE"
    if [ -f "$linux_icon_source" ]; then
        cp "$linux_icon_source" "$INSTALL_DIR/.chatgpt-linux/$CHATGPT_APP_ID.png"
    else
        warn "Notification icon not found at $linux_icon_source"
    fi
    info "Start script created"
}

select_linux_icon_source() {
    if [ -n "$LINUX_ICON_SOURCE" ]; then
        if is_x11_safe_png_icon "$LINUX_ICON_SOURCE"; then
            return 0
        fi
        warn "Configured Linux icon is missing, invalid, or larger than 512x512; using the bundled project icon"
        LINUX_ICON_SOURCE=""
    fi

    LINUX_ICON_SOURCE="$SCRIPT_DIR/assets/chatgpt-linux.png"
    info "Using bundled ChatGPT for Linux project icon"
}

is_x11_safe_png_icon() {
    local icon_path="$1"
    [ -f "$icon_path" ] || return 1

    python3 - "$icon_path" <<'PY'
import struct
import sys

try:
    with open(sys.argv[1], "rb") as icon_file:
        header = icon_file.read(24)
except OSError:
    raise SystemExit(1)

if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit(1)

width, height = struct.unpack(">II", header[16:24])
raise SystemExit(0 if 0 < width <= 512 and 0 < height <= 512 else 1)
PY
}

# ---- Main ----
main() {
    echo "============================================" >&2
    echo "  ChatGPT for Linux — Installer"       >&2
    echo "============================================" >&2
    echo ""                                             >&2

    parse_args "$@"
    validate_app_identity
    if [ "$INSPECT_ONLY" -eq 1 ]; then
        check_inspect_deps
    elif [ "${CHATGPT_INSTALL_TRANSACTION_ACTIVE:-0}" != "1" ]; then
        check_deps
        ensure_managed_node_runtime "$WORK_DIR/node-runtime"
        CHATGPT_ACCEPTANCE_NODE="$CHATGPT_MANAGED_NODE_RUNTIME_DIR/bin/node"
        export CHATGPT_ACCEPTANCE_NODE
        transactional_install "$@"
        return 0
    else
        check_deps
    fi
    if [ "$INSPECT_ONLY" -ne 1 ]; then
        assert_install_target_not_running
        prepare_install
    fi

    local dmg_path=""
    if [ -n "$PROVIDED_DMG_PATH" ]; then
        [ -f "$PROVIDED_DMG_PATH" ] || error "Provided DMG not found: $PROVIDED_DMG_PATH"
        dmg_path="$(realpath "$PROVIDED_DMG_PATH")"
        info "Using provided DMG: $dmg_path"
    else
        dmg_path=$(get_dmg)
    fi

    if [ "$INSPECT_ONLY" -ne 1 ]; then
        ensure_managed_node_runtime "$INSTALL_DIR/resources/node-runtime"
    fi

    local app_dir
    app_dir=$(extract_dmg "$dmg_path")

    detect_electron_version "$app_dir"
    if [ "$INSPECT_ONLY" -eq 1 ]; then
        inspect_rebuild_candidate "$app_dir" "$dmg_path"
        return 0
    fi

    write_app_version_metadata "$app_dir"
    patch_asar "$app_dir"
    write_generated_app_mutation_broker_digest \
        "$INSTALL_DIR" \
        "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED" \
        "$CHATGPT_GENERATED_APP_MUTATION_BROKER_DIGEST_RESOLVED"
    select_linux_icon_source
    download_electron
    extract_webview "$INSTALL_DIR"
    install_app
    stage_linux_notification_actions_bridge
    install_bundled_plugin_resources "$app_dir"
    run_port_integration_stage_hooks "$app_dir"
    harden_bundled_plugin_source_tree
    create_start_script
    if [ -n "${CHATGPT_PATCH_REPORT_RESOLVED:-}" ] && [ -f "$CHATGPT_PATCH_REPORT_RESOLVED" ]; then
        cp "$CHATGPT_PATCH_REPORT_RESOLVED" "$INSTALL_DIR/.chatgpt-linux/patch-report.json"
        info "Patch report: $INSTALL_DIR/.chatgpt-linux/patch-report.json"
    fi
    write_build_info "$dmg_path" "$app_dir"
    write_generation_bound_mutation_broker_receipt \
        "$INSTALL_DIR" \
        "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED" \
        "$CHATGPT_GENERATED_APP_MUTATION_BROKER_DIGEST_RESOLVED"

    if [ -n "${CHATGPT_REBUILD_REPORT_JSON:-}" ] && [ -n "${CHATGPT_PATCH_REPORT_JSON:-}" ]; then
        write_rebuild_report_json \
            "$CHATGPT_REBUILD_REPORT_JSON" \
            "$dmg_path" \
            "$ELECTRON_VERSION" \
            "$CHATGPT_PATCH_REPORT_JSON" \
            "$INSTALL_DIR"
        info "Rebuild report: $CHATGPT_REBUILD_REPORT_JSON"
    fi

    if ! command -v codex &>/dev/null; then
        warn "Codex CLI not found. Install it with: npm i -g @openai/codex or npm i -g --prefix ~/.local @openai/codex"
    fi

    echo ""                                             >&2
    echo "============================================" >&2
    info "Installation complete!"
    echo "  Run:  $INSTALL_DIR/start.sh"                >&2
    echo "============================================" >&2
}

if [ "${CHATGPT_INSTALLER_SOURCE_ONLY:-0}" != "1" ]; then
    main "$@"
fi
