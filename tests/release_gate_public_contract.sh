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
python3 - "$REPO_DIR/flake.nix" <<'PY' || \
    fail "Nix release-app receipt finalization contract is incomplete"
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
nix_electron_archive = text[
    text.index("nixElectronZip ="):
    text.index("runtimeNodePlatform =")
]
block = text[
    text.index("mkChatGPTReleaseApp ="):
    text.index("chatgptReleaseApp = mkChatGPTReleaseApp")
]
payload_block = text[
    text.index("mkChatGPTPayload ="):
    text.index("payload = mkChatGPTPayload")
]
private_broker_copy = (
    'mutation_broker_build="$TMPDIR/chatgpt-generated-app-mutation-broker"'
)
store_broker_export = (
    'export CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="${'
)
assert private_broker_copy in block
assert private_broker_copy in payload_block
assert store_broker_export not in block
assert store_broker_export not in payload_block
assert "pkgs.runCommand" in nix_electron_archive
assert "--set-interpreter" in nix_electron_archive
assert "--set-rpath" in nix_electron_archive
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${nixElectronZip}"' in block
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${nixElectronZip}"' in payload_block
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${electronZip}"' not in block
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${electronZip}"' not in payload_block
electron_library_path = 'export LD_LIBRARY_PATH="${electronLibPath}:${runtimeLibPath}"'
assert electron_library_path in block
assert electron_library_path in payload_block
install = block.index('"$source_dir/install.sh"')
discard_early_receipt = block.index('rm -rf -- "$generation_receipt_root"')
elf_postprocessing = block.index("--set-interpreter", discard_early_receipt)
post_install = block.index("runHook postInstall")
store_mode_normalization = block.index(
    'find "$CHATGPT_INSTALL_DIR" -type d -exec chmod 0555',
    post_install,
)
discard_postprocessing_receipt = block.index(
    'rm -rf -- "$generation_receipt_root"',
    store_mode_normalization,
)
write_receipt = block.index("write-generation-receipt")
validate_receipt = block.index("validate-generation-receipt")
assert install < discard_early_receipt < elf_postprocessing
assert (
    elf_postprocessing
    < post_install
    < store_mode_normalization
    < discard_postprocessing_receipt
    < write_receipt
    < validate_receipt
)
assert "chatgptReleaseAppReceiptValidation = pkgs.runCommand" in text
assert "release-app-generation-receipt = chatgptReleaseAppReceiptValidation" in text
PY
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
BROKER_DIGEST="$(printf '0%.0s' {1..64})"
printf '%s  chatgpt-generated-app-mutation-broker\n' "$BROKER_DIGEST" \
    >"$SUBMITTED_APP_DIR/.chatgpt-linux/generated-app-mutation-broker.sha256"
cp -aT "$SUBMITTED_APP_DIR" "$REFERENCE_APP_DIR"
python3 "$PROVENANCE_HELPER" write-generation-receipt \
    --app "$SUBMITTED_APP_DIR" \
    --broker-sha256 "$BROKER_DIGEST" >/dev/null
python3 "$PROVENANCE_HELPER" write-generation-receipt \
    --app "$REFERENCE_APP_DIR" \
    --broker-sha256 "$BROKER_DIGEST" >/dev/null

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
