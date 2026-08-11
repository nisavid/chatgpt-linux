#!/bin/bash
# Driver for the Linux ASAR patcher (scripts/patch-linux-window-ui.js).
#
# Sourced by install.sh. Do not run directly.
# shellcheck shell=bash

resolve_patch_mutation_broker() {
    local validated

    resolve_generated_app_mutation_broker || \
        error "Could not resolve the generated-app mutation broker"
    validated="$(validate_generated_app_mutation_broker \
        "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED")" || \
        error "Resolved generated-app mutation broker did not pass validation"
    [ "$validated" = "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED" ] || \
        error "Generated-app mutation broker path changed during validation"
    CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
    export CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE
}

prepare_verified_private_patch_root() {
    local root="$1"
    local owner_uid
    local permissions
    local requested
    local resolved

    case "$root" in
        /*) ;;
        *) error "Generated-app mutation root must be absolute: $root"; return 1 ;;
    esac
    [ -d "$root" ] && [ ! -L "$root" ] || {
        error "Generated-app mutation root must be a non-symlink directory: $root"
        return 1
    }
    requested="$(realpath -m -s -- "$root")" || return 1
    resolved="$(realpath -e -- "$root")" || return 1
    [ "$requested" = "$resolved" ] || {
        error "Generated-app mutation root must not traverse symlinked components: $root"
        return 1
    }

    chmod 0700 -- "$root" || return 1
    owner_uid="$(stat -c '%u' -- "$root")" || return 1
    permissions="$(stat -c '%a' -- "$root")" || return 1
    if [ "$owner_uid" != "$(id -u)" ] || [ "$permissions" != "700" ]; then
        error "Generated-app mutation root must be owned by the current user with mode 0700: $root"
        return 1
    fi
}

validate_patch_mutation_broker_digest() {
    local receipt="$1"
    local terminator=$'\n.'
    local digest

    case "$receipt" in
        *"$terminator") digest="${receipt%"$terminator"}" ;;
        *) return 1 ;;
    esac
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$digest"
}

capture_patch_mutation_broker_digest() {
    local receipt

    if receipt="$(
        set +e
        "$@" 3>&1 1>&2
        patch_status=$?
        printf '.'
        exit "$patch_status"
    )"; then
        validate_patch_mutation_broker_digest "$receipt"
    else
        return 1
    fi
}

print_patch_report_summary() {
    local patch_report="$1"
    [ -f "$patch_report" ] || return 0

    node - "$patch_report" "$SCRIPT_DIR/scripts/lib/patch-report.js" <<'NODE'
const fs = require("node:fs");
const reportPath = process.argv[2];
const helperPath = process.argv[3];
const { optionalDriftFromReport, summarizePatchReport } = require(helperPath);

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const summary = summarizePatchReport(report);
const fmt = (counts) => Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none";

console.error("[INFO] patch summary:");
console.error(`  required core: ${fmt(summary.groups.requiredCore.statusCounts)}`);
console.error(`  optional core: ${fmt(summary.groups.optionalCore.statusCounts)}`);

const enabledIntegrations = Array.isArray(summary.enabledIntegrations)
  ? summary.enabledIntegrations
  : Array.isArray(summary.enabledFeatures)
    ? summary.enabledFeatures
    : [];
if (enabledIntegrations.length === 0) {
  console.error("  optional integrations: none enabled");
} else {
  console.error(`  enabled integrations: ${enabledIntegrations.join(", ")}`);
  const integrationEntries = Object.entries(summary.groups.optionalIntegrations.byIntegration);
  if (integrationEntries.length === 0) {
    console.error("  optional integration drift: none");
  } else {
    for (const [integrationId, integrationSummary] of integrationEntries) {
      console.error(`  integration ${integrationId}: ${fmt(integrationSummary.statusCounts)}`);
    }
  }
}

const drift = optionalDriftFromReport(report);
if (drift.length > 0) {
  console.error(`[WARN] optional patches not fully applied (${drift.length}) — fix when convenient:`);
  for (const item of drift) {
    console.error(`  - ${item.name}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`);
  }
}

const strategyDrift = [];
for (const patch of report.patches ?? []) {
  for (const entry of patch.strategies ?? []) {
    if (entry.strategy === "none") {
      strategyDrift.push(`${patch.name}: ${entry.group}=${entry.strategy}`);
    }
  }
}
if (strategyDrift.length > 0) {
  console.error(`[INFO] match strategies needing attention (${strategyDrift.length}):`);
  for (const line of strategyDrift) {
    console.error(`  - ${line}`);
  }
}
NODE
}

# ---- Extract and patch app.asar ----
patch_asar() {
    local app_dir="$1"
    local resources_dir="$app_dir/Contents/Resources"
    local -a patch_args=()

    [ -f "$resources_dir/app.asar" ] || error "app.asar not found in $resources_dir"
    resolve_patch_mutation_broker

    info "Extracting app.asar..."
    cd "$WORK_DIR"
    install -d -m 0700 "$WORK_DIR/app-extracted"
    prepare_verified_private_patch_root "$WORK_DIR/app-extracted"
    npx --yes asar extract "$resources_dir/app.asar" "$WORK_DIR/app-extracted"
    prepare_verified_private_patch_root "$WORK_DIR/app-extracted"

    # Copy unpacked native modules if they exist
    if [ -d "$resources_dir/app.asar.unpacked" ]; then
        cp -r "$resources_dir/app.asar.unpacked/"* app-extracted/ 2>/dev/null || true
    fi

    # Remove macOS-only modules
    rm -rf "$WORK_DIR/app-extracted/node_modules/sparkle-darwin" 2>/dev/null || true
    find "$WORK_DIR/app-extracted" -name "sparkle.node" -delete 2>/dev/null || true

    # Build native modules in clean environment and copy back
    build_native_modules "$WORK_DIR/app-extracted"

    info "Patching Linux window and shell behavior..."
    # Always produce a report: enforcement and the end-of-build summary need it,
    # and install.sh persists it into the app's .chatgpt-linux/ directory.
    local patch_report_json="${CHATGPT_PATCH_REPORT_JSON:-$WORK_DIR/patch-report.json}"
    mkdir -p "$(dirname "$patch_report_json")"
    patch_args+=(--report-json "$patch_report_json")
    patch_args+=(
        --mutation-broker "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
        --verified-private-root
    )
    patch_args+=(--mutation-broker-digest-fd 3)
    if [ "${CHATGPT_ENFORCE_CRITICAL_PATCHES:-1}" != "0" ]; then
        patch_args+=(--enforce-critical)
    else
        warn "Critical patch enforcement disabled (CHATGPT_ENFORCE_CRITICAL_PATCHES=0)"
    fi
    CHATGPT_GENERATED_APP_MUTATION_BROKER_DIGEST_RESOLVED=""
    if CHATGPT_GENERATED_APP_MUTATION_BROKER_DIGEST_RESOLVED="$(
        capture_patch_mutation_broker_digest \
            node \
            "$SCRIPT_DIR/scripts/patch-linux-window-ui.js" \
            "${patch_args[@]}" \
            "$WORK_DIR/app-extracted"
    )"; then
        :
    else
        error "Patch runner did not return one valid generated-app mutation broker digest receipt"
        return 1
    fi
    CHATGPT_PATCH_REPORT_RESOLVED="$patch_report_json"
    print_patch_report_summary "$patch_report_json"

    # Repack
    info "Repacking app.asar..."
    cd "$WORK_DIR"
    (cd app-extracted && find . -type f | LC_ALL=C sort | sed 's#^\./##') > "$WORK_DIR/app.asar.ordering"
    npx --yes asar pack app-extracted app.asar --ordering "$WORK_DIR/app.asar.ordering" --unpack "{*.node,*.so,*.dylib}" >&2

    info "app.asar patched"
}

inspect_rebuild_candidate() {
    local app_dir="$1"
    local dmg_path="$2"
    local resources_dir="$app_dir/Contents/Resources"
    local inspect_dir="$WORK_DIR/inspect-app-extracted"
    local report_dir="${REPORT_DIR:-$(default_rebuild_report_dir)}"
    local patch_report
    local rebuild_report

    [ -f "$resources_dir/app.asar" ] || error "app.asar not found in $resources_dir"
    resolve_patch_mutation_broker

    report_dir="$(prepare_rebuild_report_dir "$report_dir")"
    patch_report="$report_dir/patch-report.json"
    rebuild_report="$report_dir/rebuild-report.json"

    info "Inspecting app.asar without changing the active app..."
    cd "$WORK_DIR"
    install -d -m 0700 "$inspect_dir"
    prepare_verified_private_patch_root "$inspect_dir"
    npx --yes asar extract "$resources_dir/app.asar" "$inspect_dir"
    prepare_verified_private_patch_root "$inspect_dir"

    if [ -d "$resources_dir/app.asar.unpacked" ]; then
        cp -r "$resources_dir/app.asar.unpacked/"* "$inspect_dir/" 2>/dev/null || true
    fi

    node "$SCRIPT_DIR/scripts/patch-linux-window-ui.js" \
        --report-json "$patch_report" \
        --mutation-broker "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED" \
        --verified-private-root \
        "$inspect_dir"
    write_rebuild_report_json "$rebuild_report" "$dmg_path" "$ELECTRON_VERSION" "$patch_report" ""

    info "Patch report: $patch_report"
    info "Rebuild report: $rebuild_report"
    print_patch_report_summary "$patch_report"
}
