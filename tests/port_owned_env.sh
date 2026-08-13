#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/home"

expect_rejected() {
    local obsolete="$1"
    local replacement="$2"
    shift 2
    local output="$TMP_DIR/${obsolete}.log"

    if env -i \
        HOME="$TMP_DIR/home" \
        PATH="$PATH" \
        TMPDIR="$TMP_DIR" \
        "$obsolete=$TMP_DIR/legacy" \
        "$@" >"$output" 2>&1; then
        printf 'Expected %s to be rejected\n' "$obsolete" >&2
        exit 1
    fi
    if ! grep -Fq "$obsolete is no longer supported; use $replacement" "$output"; then
        printf 'Missing fail-closed diagnostic for %s:\n' "$obsolete" >&2
        sed -n '1,40p' "$output" >&2
        exit 1
    fi
}

while read -r obsolete replacement; do
    [ -n "$obsolete" ] || continue
    expect_rejected \
        "$obsolete" \
        "$replacement" \
        bash "$REPO_DIR/launcher/start.sh.template"
done <<'OBSOLETE_LAUNCHER_ENV'
CODEX_LINUX_FEATURES_DIR CHATGPT_PORT_INTEGRATIONS_DIR
CHATGPT_LINUX_FEATURES_DIR CHATGPT_PORT_INTEGRATIONS_DIR
CODEX_LINUX_FEATURE_HOOK_PHASE CHATGPT_PORT_INTEGRATION_HOOK_PHASE
CHATGPT_LINUX_FEATURE_HOOK_PHASE CHATGPT_PORT_INTEGRATION_HOOK_PHASE
OBSOLETE_LAUNCHER_ENV

while read -r obsolete replacement; do
    [ -n "$obsolete" ] || continue
    expect_rejected \
        "$obsolete" \
        "$replacement" \
        env CHATGPT_BOOTSTRAP_NONINTERACTIVE=1 bash "$REPO_DIR/scripts/bootstrap-wizard.sh"
done <<'OBSOLETE_BOOTSTRAP_ENV'
CHATGPT_LINUX_FEATURES_ROOT CHATGPT_PORT_INTEGRATIONS_ROOT
CHATGPT_LINUX_FEATURES_CONFIG CHATGPT_PORT_INTEGRATIONS_CONFIG
CHATGPT_LINUX_FEATURES CHATGPT_PORT_INTEGRATIONS
CHATGPT_LINUX_DISABLE_FEATURES CHATGPT_DISABLE_PORT_INTEGRATIONS
CHATGPT_BOOTSTRAP_CLEANUP_FEATURES CHATGPT_BOOTSTRAP_CLEANUP_INTEGRATIONS
OBSOLETE_BOOTSTRAP_ENV

expect_rejected \
    CHATGPT_LINUX_FEATURES_CONFIG \
    CHATGPT_PORT_INTEGRATIONS_CONFIG \
    bash "$REPO_DIR/contrib/user-local-install/files/.local/bin/chatgpt-update"

printf 'Port-owned environment migration checks passed\n'
