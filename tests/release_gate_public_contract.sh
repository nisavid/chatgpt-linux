#!/bin/bash
set -Eeuo pipefail

SCRIPT_PATH="$(realpath -- "${BASH_SOURCE[0]}")"
REPO_DIR="${SCRIPT_PATH%/*/*}"
TEST_TMP="$(mktemp -d)"

# Invoked through the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
    rm -rf "$TEST_TMP"
}
trap cleanup EXIT

fail() {
    printf 'release gate public-contract test failed: %s\n' "$*" >&2
    exit 1
}

CHATGPT_RELEASE_GATE_LIBRARY=1
# shellcheck source=scripts/release-gate.sh
. "$REPO_DIR/scripts/release-gate.sh"

PROVENANCE_HELPER="$REPO_DIR/scripts/lib/package-provenance.py"
RELEASE_GATE_TMP_DIR="$TEST_TMP/gate"
SUBMITTED_APP_DIR="$TEST_TMP/submitted-app"
REFERENCE_APP_STORE_PATH="$TEST_TMP/reference-output"
REFERENCE_APP_DIR="$REFERENCE_APP_STORE_PATH/opt/chatgpt"
RELEASE_MODE=public
mkdir -p \
    "$RELEASE_GATE_TMP_DIR" \
    "$SUBMITTED_APP_DIR/.chatgpt-linux" \
    "$REFERENCE_APP_DIR/.chatgpt-linux"
printf 'reviewed runtime bytes\n' >"$SUBMITTED_APP_DIR/runtime"
printf '{"schemaVersion":1}\n' >"$SUBMITTED_APP_DIR/.chatgpt-linux/build-info.json"
cp -aT "$SUBMITTED_APP_DIR" "$REFERENCE_APP_DIR"

build_reviewed_nix_output() {
    [ "$1" = "chatgpt-release-app" ] || fail "unexpected Nix output request: $1"
    printf '%s\n' "$REFERENCE_APP_STORE_PATH"
}

build_and_compare_reference_app
[ "$APP_DIR" = "$REFERENCE_APP_DIR" ] || \
    fail "public package authority was not rebound to the independent reference app"

printf 'forged submitted bytes\n' >"$SUBMITTED_APP_DIR/runtime"
if (build_and_compare_reference_app) >"$TEST_TMP/stdout" 2>"$TEST_TMP/stderr"; then
    fail "a self-consistent but changed submitted app matched the independent reference"
fi
grep -Fq 'Submitted generated app does not exactly match the independent release reference' \
    "$TEST_TMP/stderr" || fail "app mismatch did not fail at the independent reference boundary"

rm -f "$SUBMITTED_APP_DIR/runtime"
if (build_and_compare_reference_app) >"$TEST_TMP/stdout" 2>"$TEST_TMP/stderr"; then
    fail "a submitted app with a removed file matched the independent reference"
fi

cp "$REFERENCE_APP_DIR/runtime" "$SUBMITTED_APP_DIR/runtime"
chmod 0600 "$SUBMITTED_APP_DIR/runtime"
if (build_and_compare_reference_app) >"$TEST_TMP/stdout" 2>"$TEST_TMP/stderr"; then
    fail "a submitted app with changed mode matched the independent reference"
fi

printf 'release gate public contract tests passed\n'
