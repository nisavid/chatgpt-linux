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
SHEBANG_HELPER="$REPO_DIR/scripts/lib/normalize-portable-shebangs.py"
SHEBANG_ROOT="$TEST_TMP/shebang-root"
mkdir -p "$SHEBANG_ROOT/bin"
cat >"$SHEBANG_ROOT/bin/bash-tool" <<'EOF'
#!/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bash-5.3p9/bin/bash
printf 'bash tool\n'
EOF
cat >"$SHEBANG_ROOT/bin/node-tool" <<'EOF'
#!/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-nodejs-22.22.2/bin/node
console.log("node tool");
EOF
printf '\177ELF/nix/store/cccccccccccccccccccccccccccccccc-bash-5.3p9\n' \
    >"$SHEBANG_ROOT/native.node"
chmod 0751 "$SHEBANG_ROOT/bin/bash-tool" "$SHEBANG_ROOT/bin/node-tool"
python3 "$SHEBANG_HELPER" "$SHEBANG_ROOT" || \
    fail "portable shebang normalization failed"
[ "$(head -n 1 "$SHEBANG_ROOT/bin/bash-tool")" = '#!/usr/bin/env bash' ] || \
    fail "Nix Bash shebang was not normalized"
[ "$(head -n 1 "$SHEBANG_ROOT/bin/node-tool")" = '#!/usr/bin/env node' ] || \
    fail "Nix Node shebang was not normalized"
[ "$(stat -c '%a' "$SHEBANG_ROOT/bin/bash-tool")" = 751 ] || \
    fail "portable shebang normalization changed the executable mode"
grep -Fq '/nix/store/cccccccccccccccccccccccccccccccc-bash-5.3p9' \
    "$SHEBANG_ROOT/native.node" || \
    fail "portable shebang normalization changed non-shebang binary bytes"

python3 - "$REPO_DIR/flake.nix" <<'PY' || \
    fail "Nix release-app receipt finalization contract is incomplete"
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
nix_electron_archive = text[
    text.index("nixElectronZip ="):
    text.index("runtimeNodePlatform =")
]
managed_nix_node = text[
    text.index("managedNixNode ="):
    text.index("electronHeaders =")
]
managed_portable_node = text[
    text.index("managedPortableNode ="):
    text.index("managedNixNode =")
]
native_modules = text[
    text.index("chatgptNativeModules ="):
    text.index("electronLibs =")
]
native_modules_node_modules = text[
    text.index("nativeModulesNodeModules ="):
    text.index("chatgptNativeModules =")
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
assert "dontPatchShebangs = true;" in block
assert "pkgs.removeReferencesTo" in block
assert "pkgs.runCommand" in nix_electron_archive
assert "--set-interpreter" in nix_electron_archive
assert "--set-rpath" in nix_electron_archive
assert "pkgs.runCommandLocal" in managed_nix_node
assert "dontPatchShebangs = true;" in managed_nix_node
assert "dontPatchShebangs = true;" in managed_portable_node
assert "dontPatchShebangs = true;" in native_modules_node_modules
assert "dontPatchShebangs = true;" in native_modules
assert "normalize-portable-shebangs.py" in native_modules
assert "cp -a ${managedPortableNode}" in managed_nix_node
assert "--set-interpreter" in managed_nix_node
assert "--set-rpath" in managed_nix_node
assert 'test -f "$out/lib/node_modules/npm/bin/npm-cli.js"' in managed_nix_node
assert text.count(
    'export CHATGPT_MANAGED_NODE_SOURCE="${managedNixNode}"'
) == 3
assert 'export CHATGPT_MANAGED_NODE_SOURCE="${pkgs.nodejs}"' not in text
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${nixElectronZip}"' in block
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${nixElectronZip}"' in payload_block
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${electronZip}"' not in block
assert 'export CHATGPT_ELECTRON_ZIP_SOURCE="${electronZip}"' not in payload_block
electron_library_path = 'export LD_LIBRARY_PATH="${electronLibPath}:${runtimeLibPath}"'
assert electron_library_path in block
assert electron_library_path in payload_block
transaction_active = block.index("export CHATGPT_INSTALL_TRANSACTION_ACTIVE=1")
transaction_candidate = block.index(
    '${pkgs.coreutils}/bin/install -d -m 0700 "$CHATGPT_INSTALL_DIR"'
)
copy_source = block.index('cp -R ./. "$source_dir/"')
discard_staged_source_info = block.index(
    'rm -f -- "$source_dir/.chatgpt-linux/source-info.json"'
)
install = block.index('"$source_dir/install.sh"')
assert (
    copy_source
    < discard_staged_source_info
    < transaction_active
    < transaction_candidate
    < install
)
post_install = block.index("runHook postInstall")
symlink_portability_scan = block.index(
    'find "$CHATGPT_INSTALL_DIR" -type l -print0'
)
discard_early_receipt = block.index('rm -rf -- "$generation_receipt_root"')
make_elf_writable = block.index('chmod u+w "$file"', discard_early_receipt)
elf_postprocessing = block.index("--set-interpreter", discard_early_receipt)
active_elf_validation = block.index(
    '[[ "$rpath" != *\'/nix/store/\'* ]]',
    elf_postprocessing,
)
make_elf_parent_writable = block.index(
    'chmod u+w "$(dirname "$file")"',
    active_elf_validation,
)
inactive_reference_scrub = block.index(
    'remove-references-to -t "$store_root" "$file"',
    make_elf_parent_writable,
)
raw_reference_audit = block.index(
    'release app file contains a Nix-store reference:',
    inactive_reference_scrub,
)
assert 'scrubbed_store_hash="$(printf \'e%.0s\' {1..32})"' in block
assert 'case "$store_path" in' in block
assert '/nix/store/$scrubbed_store_hash-*) continue ;;' in block
assert "grep -aoE '/nix/store/[0-9a-z]{32}-" in block
store_mode_normalization = block.index(
    'find "$CHATGPT_INSTALL_DIR" -type d -exec chmod 0555',
    raw_reference_audit,
)
discard_postprocessing_receipt = block.index(
    'rm -rf -- "$generation_receipt_root"',
    store_mode_normalization,
)
write_receipt = block.index("write-generation-receipt")
validate_receipt = block.index("validate-generation-receipt")
assert install < post_install < discard_early_receipt < symlink_portability_scan
assert (
    symlink_portability_scan
    < make_elf_writable
    < elf_postprocessing
    < active_elf_validation
    < make_elf_parent_writable
    < inactive_reference_scrub
    < raw_reference_audit
    < store_mode_normalization
    < discard_postprocessing_receipt
    < write_receipt
    < validate_receipt
)
assert "chatgptReleaseAppReceiptValidation = pkgs.runCommand" in text
assert "release-app-generation-receipt = chatgptReleaseAppReceiptValidation" in text
PY

READ_ONLY_CLEANUP_ROOT="$TEST_TMP/read-only-release-cleanup"
mkdir -p "$READ_ONLY_CLEANUP_ROOT/subdir"
printf 'immutable snapshot bytes\n' >"$READ_ONLY_CLEANUP_ROOT/subdir/file"
chmod 0555 "$READ_ONLY_CLEANUP_ROOT" "$READ_ONLY_CLEANUP_ROOT/subdir"
chmod 0444 "$READ_ONLY_CLEANUP_ROOT/subdir/file"
RELEASE_GATE_TMP_DIR="$READ_ONLY_CLEANUP_ROOT"
cleanup || fail "release cleanup could not remove a read-only Nix app snapshot"
[ ! -e "$READ_ONLY_CLEANUP_ROOT" ] || \
    fail "release cleanup left a read-only Nix app snapshot behind"
RELEASE_GATE_TMP_DIR=""

python3 - "$REPO_DIR/.github/workflows/ci.yml" <<'PY' || \
    fail "Nix public release helper smoke contract is incomplete"
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert '"$release_helpers_store/bin/chatgpt-updater" --help' in text
assert '"$release_helpers_store/bin/chatgpt-updater" --version' not in text
assert 'PACKAGE_VERSION="$CHATGPT_APP_PACKAGE_VERSION"' in text
assert 'PACKAGE_VERSION="$CHATGPT_VERSION"' not in text
assert "sudo apt-get install -y binutils file gnupg nodejs p7zip-full" in text
assert "sudo install -m 0755 \"$(command -v nix)\" /usr/bin/nix" in text
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
