#!/bin/bash
set -Eeuo pipefail

SCRIPT_PATH="$(realpath -- "${BASH_SOURCE[0]}")"
SCRIPT_DIR="${SCRIPT_PATH%/*}"
REPO_DIR="${SCRIPT_DIR%/*}"
SOURCE_CHECKOUT_DIR="$REPO_DIR"

# shellcheck source=scripts/lib/package-common.sh
. "$REPO_DIR/scripts/lib/package-common.sh"

APP_DIR="${APP_DIR:-$PWD/chatgpt}"
SOURCE_APP_DIR="$APP_DIR"
DIST_DIR="${DIST_DIR:-$PWD/dist}"
DMG_PATH="${DMG:-$PWD/ChatGPT.dmg}"
CHECKSUM_FILE="${CHECKSUM_FILE:-$DIST_DIR/SHA256SUMS}"
PROVENANCE_FILE="${PROVENANCE_FILE:-$DIST_DIR/RELEASE-PROVENANCE.json}"
PUBLIC_KEY_FILE="${CHATGPT_RELEASE_GPG_PUBLIC_KEY:-$DIST_DIR/release-signing-key.asc}"
REQUIRE_RELEASE_SIGNATURE="${REQUIRE_RELEASE_SIGNATURE:-0}"
RELEASE_REHEARSAL="${CHATGPT_RELEASE_REHEARSAL:-0}"
SKIP_APP_INSPECTION="${CHATGPT_RELEASE_REHEARSAL_SKIP_APP_INSPECTION:-0}"
PROVENANCE_HELPER="$REPO_DIR/scripts/lib/package-provenance.py"

DESKTOP_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt.desktop"
SERVICE_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater.service"
# Consumed dynamically by the sourced package staging library.
# shellcheck disable=SC2034
USER_SERVICE_HELPER_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
PACKAGED_RUNTIME_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-packaged-runtime.sh"
REQUESTED_PACKAGE_NAME="${PACKAGE_NAME:-chatgpt}"
REQUESTED_PACKAGE_VERSION="${PACKAGE_VERSION:-}"
PACKAGE_NAME="chatgpt"
PACKAGE_WITH_UPDATER="${PACKAGE_WITH_UPDATER:-1}"
REQUESTED_UPDATER_BINARY_SOURCE="${UPDATER_BINARY_SOURCE:-}"
REQUESTED_UPDATER_SERVICE_SOURCE="${UPDATER_SERVICE_SOURCE:-}"
REQUESTED_PACKAGED_RUNTIME_SOURCE="${PACKAGED_RUNTIME_SOURCE:-}"
REQUESTED_SOURCE_INFO_SOURCE="${CHATGPT_LINUX_SOURCE_INFO_SOURCE:-}"
REQUESTED_SOURCE_COMMIT="${CHATGPT_LINUX_SOURCE_COMMIT:-}"
REQUESTED_SOURCE_BRANCH="${CHATGPT_LINUX_SOURCE_BRANCH:-}"
REQUESTED_SOURCE_REMOTE="${CHATGPT_LINUX_SOURCE_REMOTE:-}"
REQUESTED_SOURCE_DESCRIBE="${CHATGPT_LINUX_SOURCE_DESCRIBE:-}"
REQUESTED_PACKAGE_DISPLAY_NAME="${PACKAGE_DISPLAY_NAME:-}"
REQUESTED_PACKAGE_COMMENT="${PACKAGE_COMMENT:-}"
REQUESTED_PACKAGE_ICON_SOURCE="${PACKAGE_ICON_SOURCE:-}"
REQUESTED_MAKEPKG_CONF="${MAKEPKG_CONF:-}"
REQUESTED_RPM_SPEC_SOURCE="${CHATGPT_RPM_SPEC_TEMPLATE_SOURCE:-}"
REQUESTED_RPM_BINARY_PAYLOAD="${RPM_BINARY_PAYLOAD:-}"
REQUESTED_MUTATION_BROKER_SOURCE="${CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE:-}"
REQUESTED_PACKAGE_NODE_SOURCE="${CHATGPT_PACKAGE_NODE_SOURCE:-}"
REQUESTED_RELEASE_SIGNING_FINGERPRINT="${CHATGPT_RELEASE_GPG_FINGERPRINT:-}"
UPDATER_BINARY_SOURCE="${UPDATER_BINARY_SOURCE:-$REPO_DIR/target/release/chatgpt-updater}"
UPDATER_SERVICE_SOURCE="${UPDATER_SERVICE_SOURCE:-$SERVICE_TEMPLATE}"
PACKAGED_RUNTIME_SOURCE="${PACKAGED_RUNTIME_SOURCE:-$PACKAGED_RUNTIME_TEMPLATE}"

RELEASE_GATE_TMP_DIR=""
RELEASE_MODE=""
SOURCE_COMMIT_START=""
SOURCE_DIRTY=""
VERIFIED_DMG_SHA256=""
VERIFIED_DMG_APP_VERSION=""
PACKAGE_VERSION=""
ICON_SOURCE=""
REVIEWED_SOURCE_DIR=""
REVIEWED_APP_DIR=""
RELEASE_NIX=""
RELEASE_HELPERS_STORE_PATH=""
SUBMITTED_APP_DIR=""
REFERENCE_APP_STORE_PATH=""
RELEASE_GPG=""
RELEASE_SIGNING_FINGERPRINT=""
RELEASE_ASAR=""
RELEASE_NIX_CANARY_PATH=""

declare -a PACKAGE_ORIGINALS=()
declare -a PACKAGE_SNAPSHOTS=()
declare -a PACKAGE_FORMATS=()
declare -a PACKAGE_DIGESTS=()
declare -a PACKAGE_FILENAMES=()

info() {
    printf '[release-gate] %s\n' "$*" >&2
}

source_git() {
    package_git_in "$SOURCE_CHECKOUT_DIR" "$@"
}

error() {
    printf '[release-gate][ERROR] %s\n' "$*" >&2
    exit 1
}

require_file() {
    local path="$1"
    local label="$2"
    [ -f "$path" ] && [ ! -L "$path" ] || error "Missing regular non-symlink $label: $path"
}

require_dir() {
    local path="$1"
    local label="$2"
    [ -d "$path" ] && [ ! -L "$path" ] || error "Missing non-symlink $label: $path"
}

validate_boolean() {
    local name="$1"
    local value="$2"
    case "$value" in
        0|1) ;;
        *) error "$name must be 0 or 1" ;;
    esac
}

cleanup() {
    if [[ "$RELEASE_NIX_CANARY_PATH" == /var/tmp/chatgpt-release-nix-sandbox-canary-* ]]; then
        rm -f -- "$RELEASE_NIX_CANARY_PATH"
    fi
    if [ -n "$RELEASE_GATE_TMP_DIR" ]; then
        rm -rf "$RELEASE_GATE_TMP_DIR"
    fi
}
trap cleanup EXIT

prepare_release_mode() {
    validate_boolean CHATGPT_RELEASE_REHEARSAL "$RELEASE_REHEARSAL"
    validate_boolean CHATGPT_RELEASE_REHEARSAL_SKIP_APP_INSPECTION "$SKIP_APP_INSPECTION"
    validate_boolean REQUIRE_RELEASE_SIGNATURE "$REQUIRE_RELEASE_SIGNATURE"
    if [ "${CHATGPT_RELEASE_GATE_SKIP_PACKAGE_METADATA:-0}" != "0" ]; then
        error "Package metadata verification cannot be skipped"
    fi
    [ "$REQUESTED_PACKAGE_NAME" = "chatgpt" ] || \
        error "Native release package name must be chatgpt"

    if [ "$RELEASE_REHEARSAL" = "1" ]; then
        RELEASE_MODE="rehearsal"
    else
        RELEASE_MODE="public"
        [ "$SKIP_APP_INSPECTION" = "0" ] || \
            error "App inspection can only be skipped during an explicit rehearsal"
        [ "$REQUIRE_RELEASE_SIGNATURE" = "1" ] || \
            error "Public release mode requires REQUIRE_RELEASE_SIGNATURE=1"
        [ -n "${CHATGPT_RELEASE_GPG_KEY:-}" ] || \
            error "Public release mode requires CHATGPT_RELEASE_GPG_KEY"
        [[ "$REQUESTED_RELEASE_SIGNING_FINGERPRINT" =~ ^[0-9A-Fa-f]{40}([0-9A-Fa-f]{24})?$ ]] || \
            error "Public release mode requires CHATGPT_RELEASE_GPG_FINGERPRINT"
        [ "$PACKAGE_WITH_UPDATER" = "1" ] || \
            error "Public native packages must include the reviewed updater"
        [ -z "${CHATGPT_PORT_INTEGRATIONS_ROOT:-}" ] || \
            error "Public release mode does not accept CHATGPT_PORT_INTEGRATIONS_ROOT"
        [ -z "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}" ] || \
            error "Public release mode does not accept CHATGPT_PORT_INTEGRATIONS_CONFIG"
        [ -z "$REQUESTED_UPDATER_BINARY_SOURCE" ] || \
            error "Public release mode builds chatgpt-updater from the reviewed source snapshot"
        [ -z "$REQUESTED_UPDATER_SERVICE_SOURCE" ] || \
            error "Public release mode uses the reviewed updater service template"
        [ -z "$REQUESTED_PACKAGED_RUNTIME_SOURCE" ] || \
            error "Public release mode uses the reviewed packaged runtime template"
        [ -z "$REQUESTED_SOURCE_INFO_SOURCE" ] || \
            error "Public release mode captures source info from the reviewed checkout"
        [ -z "$REQUESTED_SOURCE_COMMIT$REQUESTED_SOURCE_BRANCH$REQUESTED_SOURCE_REMOTE$REQUESTED_SOURCE_DESCRIBE" ] || \
            error "Public release mode does not accept CHATGPT_LINUX_SOURCE_* metadata overrides"
        [ -z "$REQUESTED_PACKAGE_DISPLAY_NAME$REQUESTED_PACKAGE_COMMENT$REQUESTED_PACKAGE_ICON_SOURCE" ] || \
            error "Public release mode uses reviewed package identity and icon inputs"
        [ -z "$REQUESTED_MAKEPKG_CONF$REQUESTED_RPM_SPEC_SOURCE$REQUESTED_RPM_BINARY_PAYLOAD" ] || \
            error "Public release mode does not accept native package builder config overrides"
        [ -z "$REQUESTED_MUTATION_BROKER_SOURCE" ] || \
            error "Public release mode builds the mutation broker from the reviewed source snapshot"
        [ -z "$REQUESTED_PACKAGE_NODE_SOURCE" ] || \
            error "Public release mode selects its own trusted system Node.js runtime"
    fi
}

prepare_release_signing_identity() {
    if [ "$REQUIRE_RELEASE_SIGNATURE" != "1" ] && [ -z "${CHATGPT_RELEASE_GPG_KEY:-}" ]; then
        return 0
    fi

    local candidate canonical owner mode
    local -a fingerprints=()
    for candidate in /usr/bin/gpg /bin/gpg; do
        [ -x "$candidate" ] || continue
        canonical="$(readlink -f -- "$candidate")"
        [ -f "$canonical" ] && [ ! -L "$canonical" ] && [ -x "$canonical" ] || continue
        read -r owner mode < <(stat -Lc '%u %a' "$canonical")
        if [ "$RELEASE_MODE" = "public" ] && [ "$owner" != "0" ]; then
            continue
        fi
        (( (8#$mode & 8#022) == 0 )) || continue
        RELEASE_GPG="$canonical"
        break
    done
    [ -n "$RELEASE_GPG" ] || error "Signed release output requires a trusted system gpg"
    [ -n "${CHATGPT_RELEASE_GPG_KEY:-}" ] || \
        error "CHATGPT_RELEASE_GPG_KEY is required when release signatures are requested"

    mapfile -t fingerprints < <(
        "$RELEASE_GPG" --batch --with-colons --fingerprint --list-secret-keys \
            "$CHATGPT_RELEASE_GPG_KEY" 2>/dev/null | \
            awk -F: '
              $1 == "sec" { primary = 1; next }
              primary && $1 == "fpr" { print toupper($10); primary = 0 }
            '
    )
    [ "${#fingerprints[@]}" -eq 1 ] || \
        error "CHATGPT_RELEASE_GPG_KEY must resolve to exactly one primary secret key"
    RELEASE_SIGNING_FINGERPRINT="${fingerprints[0]}"
    [[ "$RELEASE_SIGNING_FINGERPRINT" =~ ^[0-9A-F]{40}([0-9A-F]{24})?$ ]] || \
        error "Release signing key has an invalid primary fingerprint"
    if [ -n "$REQUESTED_RELEASE_SIGNING_FINGERPRINT" ] && \
        [ "$RELEASE_SIGNING_FINGERPRINT" != "${REQUESTED_RELEASE_SIGNING_FINGERPRINT^^}" ]; then
        error "Release signing key does not match CHATGPT_RELEASE_GPG_FINGERPRINT"
    fi
}

prepare_release_node() {
    [ "$RELEASE_MODE" = "public" ] || return 0

    local candidate=""
    local canonical=""
    local mode owner
    for candidate in /usr/bin/node /bin/node; do
        [ -x "$candidate" ] || continue
        canonical="$(readlink -f -- "$candidate")"
        [ -n "$canonical" ] || continue
        [ -f "$canonical" ] && [ ! -L "$canonical" ] && [ -x "$canonical" ] || continue
        read -r owner mode < <(stat -Lc '%u %a' "$canonical")
        [ "$owner" = "0" ] || continue
        if (( (8#$mode & 8#022) == 0 )); then
            CHATGPT_PACKAGE_NODE_SOURCE="$canonical"
            export CHATGPT_PACKAGE_NODE_SOURCE
            return 0
        fi
    done
    error "Public release mode requires a root-owned, non-writable system Node.js executable"
}

prepare_release_environment() {
    [ "$RELEASE_MODE" = "public" ] || return 0
    PATH=/usr/sbin:/usr/bin:/sbin:/bin
    LC_ALL=C
    export PATH LC_ALL
    unset \
        BASH_ENV \
        CDPATH \
        ENV \
        NODE_OPTIONS \
        NODE_PATH \
        PYTHONHOME \
        PYTHONPATH
    hash -r
}

prepare_source_state() {
    local source_status
    local commit_epoch
    SOURCE_COMMIT_START="$(source_git rev-parse HEAD)" || \
        error "A trusted system Git is required to identify the reviewed source"
    source_status="$(source_git status --porcelain --untracked-files=all)" || \
        error "Trusted Git could not inspect the reviewed source state"
    if [ -n "$source_status" ]; then
        SOURCE_DIRTY=1
    else
        SOURCE_DIRTY=0
    fi
    if [ "$RELEASE_MODE" = "public" ] && [ "$SOURCE_DIRTY" != "0" ]; then
        error "Public release mode requires a clean source tree"
    fi
    if [ "$RELEASE_MODE" = "public" ]; then
        commit_epoch="$(source_git show -s --format=%ct "$SOURCE_COMMIT_START")" || \
            error "Could not derive the public package epoch from the reviewed commit"
        [[ "$commit_epoch" =~ ^[0-9]+$ ]] || error "Reviewed commit has an invalid source epoch"
        if [ -n "${SOURCE_DATE_EPOCH:-}" ] && [ "$SOURCE_DATE_EPOCH" != "$commit_epoch" ]; then
            error "Public release SOURCE_DATE_EPOCH must match the reviewed commit epoch $commit_epoch"
        fi
        export SOURCE_DATE_EPOCH="$commit_epoch"
    fi
}

prepare_reviewed_source() {
    if [ "$RELEASE_MODE" != "public" ]; then
        REVIEWED_SOURCE_DIR="$SOURCE_CHECKOUT_DIR"
        return
    fi

    local archive="$RELEASE_GATE_TMP_DIR/reviewed-source.tar"
    local source_metadata_root="$RELEASE_GATE_TMP_DIR/reviewed-source-metadata"
    mkdir -m 0700 "$source_metadata_root"
    stage_update_builder_source_info "$source_metadata_root"
    CHATGPT_LINUX_SOURCE_INFO_SOURCE="$source_metadata_root/.chatgpt-linux/source-info.json"
    export CHATGPT_LINUX_SOURCE_INFO_SOURCE
    REVIEWED_SOURCE_DIR="$RELEASE_GATE_TMP_DIR/reviewed-source"
    mkdir -m 0700 "$REVIEWED_SOURCE_DIR"
    source_git archive --format=tar --output="$archive" "$SOURCE_COMMIT_START" || \
        error "Could not snapshot the reviewed Git source object"
    require_file "$archive" "reviewed source archive"
    tar --no-same-owner --same-permissions -xf "$archive" -C "$REVIEWED_SOURCE_DIR" || \
        error "Could not extract the reviewed source snapshot"
    rm -f "$archive"
    mkdir -m 0700 "$REVIEWED_SOURCE_DIR/.chatgpt-linux"
    cp "$CHATGPT_LINUX_SOURCE_INFO_SOURCE" \
        "$REVIEWED_SOURCE_DIR/.chatgpt-linux/source-info.json"
    chmod 0644 "$REVIEWED_SOURCE_DIR/.chatgpt-linux/source-info.json"

    REPO_DIR="$REVIEWED_SOURCE_DIR"
    PROVENANCE_HELPER="$REPO_DIR/scripts/lib/package-provenance.py"
    DESKTOP_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt.desktop"
    SERVICE_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater.service"
    # Consumed dynamically by the sourced package staging library.
    # shellcheck disable=SC2034
    USER_SERVICE_HELPER_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
    PACKAGED_RUNTIME_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-packaged-runtime.sh"
    UPDATER_SERVICE_SOURCE="$SERVICE_TEMPLATE"
    PACKAGED_RUNTIME_SOURCE="$PACKAGED_RUNTIME_TEMPLATE"
    unset CHATGPT_PORT_INTEGRATIONS_ROOT CHATGPT_PORT_INTEGRATIONS_CONFIG
    CHATGPT_PORT_INTEGRATIONS_ROOT="$REPO_DIR/port-integrations"
    CHATGPT_PORT_INTEGRATIONS_CONFIG="$REPO_DIR/port-integrations/integrations.example.json"
    export CHATGPT_PORT_INTEGRATIONS_ROOT CHATGPT_PORT_INTEGRATIONS_CONFIG
    require_file "$CHATGPT_PORT_INTEGRATIONS_CONFIG" "reviewed port integration config"
    require_file "$PROVENANCE_HELPER" "reviewed package provenance helper"
}

snapshot_submitted_app() {
    local snapshot_record
    SUBMITTED_APP_DIR="$RELEASE_GATE_TMP_DIR/submitted-app"
    require_dir "$SOURCE_APP_DIR" "generated app"
    snapshot_record="$(python3 "$PROVENANCE_HELPER" snapshot-tree "$SOURCE_APP_DIR" "$SUBMITTED_APP_DIR")" || \
        error "Could not snapshot the submitted generated app"
    [[ "$snapshot_record" == *'"manifestSha256"'* ]] || \
        error "Submitted generated-app snapshot did not return a manifest digest"
    if [ "$RELEASE_MODE" = "rehearsal" ]; then
        REVIEWED_APP_DIR="$SUBMITTED_APP_DIR"
        APP_DIR="$REVIEWED_APP_DIR"
    fi
}

resolve_release_package_version() {
    local generated_version
    generated_version="$(default_package_version)"
    if [ "$RELEASE_MODE" = "public" ]; then
        [ "$generated_version" = "$VERIFIED_DMG_APP_VERSION" ] || \
            error "Generated app package version $generated_version does not match verified DMG version $VERIFIED_DMG_APP_VERSION"
        if [ -n "$REQUESTED_PACKAGE_VERSION" ] && [ "$REQUESTED_PACKAGE_VERSION" != "$generated_version" ]; then
            error "Public release PACKAGE_VERSION must match the generated app version $generated_version"
        fi
        PACKAGE_VERSION="$generated_version"
    else
        PACKAGE_VERSION="${REQUESTED_PACKAGE_VERSION:-$generated_version}"
    fi
}

prepare_release_nix() {
    [ "$RELEASE_MODE" = "public" ] || return 0

    local candidate canonical owner group mode sandbox_value
    for candidate in \
        /usr/bin/nix \
        /bin/nix \
        /run/current-system/sw/bin/nix \
        /nix/var/nix/profiles/default/bin/nix; do
        [ -x "$candidate" ] || continue
        canonical="$(readlink -f -- "$candidate")"
        [ -f "$canonical" ] && [ ! -L "$canonical" ] && [ -x "$canonical" ] || continue
        read -r owner mode < <(stat -Lc '%u %a' "$canonical")
        [ "$owner" = "0" ] || continue
        if (( (8#$mode & 8#022) == 0 )); then
            RELEASE_NIX="$canonical"
            break
        fi
    done
    [ -n "$RELEASE_NIX" ] || \
        error "Public release mode requires a root-owned, non-writable system Nix client"

    [ -S /nix/var/nix/daemon-socket/socket ] || \
        error "Public release mode requires the root-managed multi-user Nix daemon"
    read -r owner mode < <(stat -Lc '%u %a' /nix/var/nix/daemon-socket/socket)
    [ "$owner" = "0" ] || error "The Nix daemon socket must be root-owned"
    [ -d /nix/store ] && [ ! -L /nix/store ] || \
        error "Public release mode requires a canonical /nix/store"
    read -r owner group mode < <(stat -Lc '%u %g %a' /nix/store)
    [ "$owner" = "0" ] || error "The Nix store must be root-owned"
    (( (8#$mode & 8#002) == 0 )) || error "The Nix store must not be world-writable"
    if (( (8#$mode & 8#020) != 0 )) && id -G | tr ' ' '\n' | grep -Fxq "$group"; then
        error "The release user must not belong to a group that can write the Nix store"
    fi

    sandbox_value="$({
        /usr/bin/env -i \
            PATH=/usr/bin:/bin \
            HOME="$RELEASE_GATE_TMP_DIR/nix-config-home" \
            XDG_CONFIG_HOME="$RELEASE_GATE_TMP_DIR/nix-config-home/config" \
            NIX_USER_CONF_FILES=/dev/null \
            "$RELEASE_NIX" \
                --extra-experimental-features 'nix-command flakes' \
                config show 2>/dev/null
    } | awk -F= '$1 ~ /^[[:space:]]*sandbox[[:space:]]*$/ { gsub(/[[:space:]]/, "", $2); print $2; exit }')"
    [ "$sandbox_value" = "true" ] || \
        error "Public release mode requires sandbox = true in the root-managed Nix configuration"

    RELEASE_NIX_CANARY_PATH="/var/tmp/chatgpt-release-nix-sandbox-canary-$(id -u)-$$-${RANDOM:-0}"
    (umask 077 && printf 'release sandbox canary\n' >"$RELEASE_NIX_CANARY_PATH")
    printf '%s\n' "$RELEASE_NIX_CANARY_PATH" \
        >"$REVIEWED_SOURCE_DIR/.chatgpt-linux/release-sandbox-canary-path"
    chmod 0644 "$REVIEWED_SOURCE_DIR/.chatgpt-linux/release-sandbox-canary-path"
    build_reviewed_nix_output release-sandbox-canary "release sandbox canary" >/dev/null
    rm -f -- "$RELEASE_NIX_CANARY_PATH"
    RELEASE_NIX_CANARY_PATH=""
}

validate_static_release_helper() {
    local binary="$1"
    local label="$2"
    local readelf_cmd=""
    local candidate canonical owner mode expected_machine

    require_file "$binary" "$label"
    canonical="$(readlink -f -- "$binary")"
    case "$canonical" in
        /nix/store/*) ;;
        *) error "$label must come from the canonical Nix store" ;;
    esac
    read -r owner mode < <(stat -Lc '%u %a' "$canonical")
    [ "$owner" = "0" ] || error "$label must be root-owned"
    (( (8#$mode & 8#022) == 0 )) || error "$label must not be group- or world-writable"
    [ -x "$canonical" ] || error "$label must be executable"

    for candidate in /usr/bin/readelf /bin/readelf; do
        [ -x "$candidate" ] || continue
        readelf_cmd="$(readlink -f -- "$candidate")"
        [ -f "$readelf_cmd" ] && [ ! -L "$readelf_cmd" ] || continue
        read -r owner mode < <(stat -Lc '%u %a' "$readelf_cmd")
        [ "$owner" = "0" ] || continue
        (( (8#$mode & 8#022) == 0 )) || continue
        break
    done
    [ -n "$readelf_cmd" ] || error "Public release mode requires a trusted system readelf"
    case "$(uname -m)" in
        x86_64) expected_machine='Advanced Micro Devices X86-64' ;;
        aarch64) expected_machine='AArch64' ;;
        *) error "Unsupported release-helper architecture: $(uname -m)" ;;
    esac
    "$readelf_cmd" -h "$canonical" | grep -F "Machine:                           $expected_machine" >/dev/null || \
        error "$label has the wrong ELF architecture"
    if "$readelf_cmd" -l "$canonical" | grep -F 'INTERP' >/dev/null; then
        error "$label must not have a dynamic ELF interpreter"
    fi
    if "$readelf_cmd" -d "$canonical" 2>/dev/null | grep -E '(NEEDED|RPATH|RUNPATH)' >/dev/null; then
        error "$label must not have dynamic library dependencies"
    fi
}

build_reviewed_nix_output() {
    local attribute="$1"
    local label="$2"
    local nix_home="$RELEASE_GATE_TMP_DIR/nix-${attribute//[^a-zA-Z0-9_-]/-}-home"
    local build_output output_path owner mode
    mkdir -m 0700 "$nix_home"
    build_output="$(
        /usr/bin/env -i \
            PATH=/usr/bin:/bin \
            HOME="$nix_home" \
            XDG_CACHE_HOME="$nix_home/cache" \
            XDG_CONFIG_HOME="$nix_home/config" \
            XDG_STATE_HOME="$nix_home/state" \
            TMPDIR="$RELEASE_GATE_TMP_DIR" \
            NIX_USER_CONF_FILES=/dev/null \
            "$RELEASE_NIX" \
                --extra-experimental-features 'nix-command flakes' \
                build \
                --store daemon \
                --no-link \
                --print-out-paths \
                --no-update-lock-file \
                --no-write-lock-file \
                --no-use-registries \
                --option accept-flake-config false \
                "path:$REPO_DIR#$attribute"
    )" || error "Could not build $label from the reviewed source snapshot"
    [ "$(printf '%s\n' "$build_output" | sed '/^$/d' | wc -l)" -eq 1 ] || \
        error "Nix returned an unexpected number of outputs for $label"
    output_path="$(printf '%s\n' "$build_output" | sed -n '/^\/nix\/store\//p')"
    [ -n "$output_path" ] || error "Nix did not return a canonical store path for $label"
    [ "$(readlink -f -- "$output_path")" = "$output_path" ] || \
        error "$label output must be a canonical Nix store path"
    [ -d "$output_path" ] && [ ! -L "$output_path" ] || \
        error "$label output must be a non-symlink Nix store directory"
    read -r owner mode < <(stat -Lc '%u %a' "$output_path")
    [ "$owner" = "0" ] || error "$label output must be root-owned"
    (( (8#$mode & 8#022) == 0 )) || error "$label output must not be group- or world-writable"
    printf '%s\n' "$output_path"
}

build_reviewed_native_helpers() {
    [ "$RELEASE_MODE" = "public" ] || return 0

    info "Building static release helpers from the reviewed source snapshot"
    RELEASE_HELPERS_STORE_PATH="$(build_reviewed_nix_output release-helpers "release helpers")"

    UPDATER_BINARY_SOURCE="$RELEASE_HELPERS_STORE_PATH/bin/chatgpt-updater"
    CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="$RELEASE_HELPERS_STORE_PATH/bin/chatgpt-generated-app-mutation-broker"
    RELEASE_ASAR="$(readlink -f -- "$RELEASE_HELPERS_STORE_PATH/bin/asar")"
    validate_static_release_helper "$UPDATER_BINARY_SOURCE" "reviewed updater binary"
    validate_static_release_helper \
        "$CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE" \
        "reviewed generated-app mutation broker"
    case "$RELEASE_ASAR" in
        /nix/store/*) ;;
        *) error "Reviewed ASAR extractor must come from the canonical Nix store" ;;
    esac
    require_file "$RELEASE_ASAR" "reviewed ASAR extractor"
    [ -x "$RELEASE_ASAR" ] || error "Reviewed ASAR extractor must be executable"
    export CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE
}

build_and_compare_reference_app() {
    [ "$RELEASE_MODE" = "public" ] || return 0

    local submitted_manifest="$RELEASE_GATE_TMP_DIR/submitted-app-manifest.json"
    local reference_manifest="$RELEASE_GATE_TMP_DIR/reference-app-manifest.json"
    info "Building the independent generated-app reference from the reviewed DMG and source"
    REFERENCE_APP_STORE_PATH="$(build_reviewed_nix_output chatgpt-release-app "release reference app")"
    REVIEWED_APP_DIR="$REFERENCE_APP_STORE_PATH/opt/chatgpt"
    require_dir "$REVIEWED_APP_DIR" "release reference app"
    python3 "$PROVENANCE_HELPER" manifest "$SUBMITTED_APP_DIR" "$submitted_manifest"
    python3 "$PROVENANCE_HELPER" manifest "$REVIEWED_APP_DIR" "$reference_manifest"
    python3 "$PROVENANCE_HELPER" compare "$reference_manifest" "$submitted_manifest" || \
        error "Submitted generated app does not exactly match the independent release reference"
    APP_DIR="$REVIEWED_APP_DIR"
}

prepare_output_paths() {
    mkdir -p "$DIST_DIR"
    rm -f \
        "$CHECKSUM_FILE" \
        "${CHECKSUM_FILE}.asc" \
        "$PROVENANCE_FILE" \
        "${PROVENANCE_FILE}.asc"
}

snapshot_official_dmg() {
    local snapshot_path="$RELEASE_GATE_TMP_DIR/verified-ChatGPT.dmg"
    local snapshot_record
    require_file "$DMG_PATH" "official OpenAI ChatGPT DMG"
    snapshot_record="$(python3 "$PROVENANCE_HELPER" snapshot "$DMG_PATH" "$snapshot_path")" || \
        error "Could not snapshot the official OpenAI ChatGPT DMG"
    [[ "$snapshot_record" == *'"sha256"'* ]] || \
        error "Official DMG snapshot did not return a content digest"
    DMG_PATH="$snapshot_path"
}

sri_to_hex() {
    local sri="$1"
    local payload="${sri#sha256-}"
    printf '%s' "$payload" | base64 -d 2>/dev/null | od -An -tx1 | tr -d ' \n'
}

flake_dmg_sri() {
    awk '
        /ChatGPT\.dmg/ { found_dmg = 1 }
        found_dmg && /hash = "sha256-/ { print; exit }
    ' "$REPO_DIR/flake.nix" | sed -E 's/.*(sha256-[^"]+).*/\1/'
}

expected_dmg_sha256() {
    if [ "$RELEASE_MODE" = "public" ]; then
        local pinned_sri pinned_sha requested_sha
        pinned_sri="$(flake_dmg_sri || true)"
        [ -n "$pinned_sri" ] || error "Public release mode requires a reviewed DMG hash in flake.nix"
        pinned_sha="$(sri_to_hex "$pinned_sri")"
        if [ -n "${CHATGPT_DMG_SHA256:-}" ]; then
            requested_sha="${CHATGPT_DMG_SHA256,,}"
            [ "$requested_sha" = "$pinned_sha" ] || \
                error "Public release DMG SHA-256 must match the reviewed flake pin"
        fi
        if [ -n "${CHATGPT_DMG_SRI:-}" ]; then
            requested_sha="$(sri_to_hex "$CHATGPT_DMG_SRI")"
            [ "$requested_sha" = "$pinned_sha" ] || \
                error "Public release DMG SRI must match the reviewed flake pin"
        fi
        printf '%s\n' "$pinned_sha"
        return
    fi
    if [ -n "${CHATGPT_DMG_SHA256:-}" ]; then
        printf '%s\n' "$CHATGPT_DMG_SHA256"
        return
    fi

    local sri="${CHATGPT_DMG_SRI:-}"
    if [ -z "$sri" ] && [ -f "$REPO_DIR/flake.nix" ]; then
        sri="$(flake_dmg_sri || true)"
    fi

    [ -n "$sri" ] || error "Set CHATGPT_DMG_SHA256 or CHATGPT_DMG_SRI before releasing"
    sri_to_hex "$sri"
}

verify_dmg_hash() {
    require_file "$DMG_PATH" "official OpenAI ChatGPT DMG"

    local expected
    expected="$(expected_dmg_sha256)"
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || error "Trusted DMG hash is not a hex SHA-256 digest"
    VERIFIED_DMG_SHA256="$(sha256sum "$DMG_PATH" | awk '{print $1}')"
    [ "$VERIFIED_DMG_SHA256" = "${expected,,}" ] || \
        error "DMG hash mismatch: expected ${expected,,}, got $VERIFIED_DMG_SHA256"
    info "Verified DMG SHA-256: $VERIFIED_DMG_SHA256"
}

verify_dmg_app_version() {
    [ "$RELEASE_MODE" = "public" ] || return 0

    local seven_zip=""
    local candidate member plist_path
    local -a members=()
    for candidate in /usr/bin/7z /usr/bin/7zz /bin/7z /bin/7zz; do
        if [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ]; then
            seven_zip="$candidate"
            break
        fi
    done
    [ -n "$seven_zip" ] || error "Public release mode requires a trusted system 7z or 7zz"
    mapfile -t members < <(
        "$seven_zip" l -slt "$DMG_PATH" | sed -n 's/^Path = //p' | \
            awk '/(^|\/)ChatGPT\.app\/Contents\/Info\.plist$/ { print }'
    )
    [ "${#members[@]}" -eq 1 ] || \
        error "Verified DMG must contain exactly one ChatGPT.app/Contents/Info.plist"
    member="${members[0]}"
    plist_path="$RELEASE_GATE_TMP_DIR/verified-dmg-info.plist"
    "$seven_zip" x -so "$DMG_PATH" "$member" >"$plist_path" || \
        error "Could not read ChatGPT Info.plist from the verified DMG"
    require_file "$plist_path" "verified DMG Info.plist"
    VERIFIED_DMG_APP_VERSION="$(python3 - "$plist_path" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as source:
    print(plistlib.load(source).get("CFBundleShortVersionString", ""))
PY
)"
    [[ "$VERIFIED_DMG_APP_VERSION" =~ ^[0-9]+(\.[0-9]+){2,3}$ ]] || \
        error "Verified DMG has an invalid CFBundleShortVersionString"
    info "Verified DMG app version: $VERIFIED_DMG_APP_VERSION"
}

inspect_generated_app() {
    require_dir "$APP_DIR" "generated app"
    if [ "$SKIP_APP_INSPECTION" = "1" ]; then
        [ "$RELEASE_MODE" = "rehearsal" ] || \
            error "App inspection can only be skipped during an explicit rehearsal"
        info "Skipping Electron inspection for release rehearsal"
        return
    fi

    "$(package_node_binary)" "$REPO_DIR/scripts/inspect-electron-security.js" "$APP_DIR"
    local asar_path="$APP_DIR/resources/app.asar"
    require_file "$asar_path" "generated app.asar"

    local extracted="$RELEASE_GATE_TMP_DIR/app-asar"
    if [ "$RELEASE_MODE" = "public" ]; then
        [ -n "$RELEASE_ASAR" ] || error "Reviewed ASAR extractor is unavailable"
        "$RELEASE_ASAR" extract "$asar_path" "$extracted"
    elif command -v asar >/dev/null 2>&1; then
        asar extract "$asar_path" "$extracted"
    elif command -v npx >/dev/null 2>&1; then
        npx --no-install asar extract "$asar_path" "$extracted"
    else
        error "asar or npx is required to inspect $asar_path"
    fi
    "$(package_node_binary)" "$REPO_DIR/scripts/inspect-electron-security.js" "$extracted"
}

verify_generated_app_binding() {
    local build_info="$APP_DIR/.chatgpt-linux/build-info.json"
    local resolved_config="$RELEASE_GATE_TMP_DIR/resolved-port-integrations.json"
    local integration_inputs="$RELEASE_GATE_TMP_DIR/port-integration-build-inputs.json"
    local app_manifest="$RELEASE_GATE_TMP_DIR/generated-app-manifest.json"
    local -a public_argument=()

    require_file "$build_info" "generated-app build info"
    "$(package_node_binary)" "$REPO_DIR/scripts/lib/port-integrations.js" \
        --resolved-config-json >"$resolved_config"
    "$(package_node_binary)" "$REPO_DIR/scripts/lib/port-integrations.js" \
        --build-inputs-json >"$integration_inputs"
    if [ "$RELEASE_MODE" = "public" ]; then
        public_argument=(--public-release)
    fi
    python3 "$PROVENANCE_HELPER" validate-build-info \
        --build-info "$build_info" \
        --dmg-sha256 "$VERIFIED_DMG_SHA256" \
        --dmg-app-version "$VERIFIED_DMG_APP_VERSION" \
        --source-commit "$SOURCE_COMMIT_START" \
        --resolved-config "$resolved_config" \
        --integration-inputs "$integration_inputs" \
        "${public_argument[@]}"
    python3 "$PROVENANCE_HELPER" manifest "$APP_DIR" "$app_manifest"
}

verify_resolved_config_unchanged() {
    local current="$RELEASE_GATE_TMP_DIR/resolved-port-integrations-current.json"
    local current_inputs="$RELEASE_GATE_TMP_DIR/port-integration-build-inputs-current.json"
    "$(package_node_binary)" "$REPO_DIR/scripts/lib/port-integrations.js" \
        --resolved-config-json >"$current"
    "$(package_node_binary)" "$REPO_DIR/scripts/lib/port-integrations.js" \
        --build-inputs-json >"$current_inputs"
    python3 - \
        "$RELEASE_GATE_TMP_DIR/resolved-port-integrations.json" "$current" \
        "$RELEASE_GATE_TMP_DIR/port-integration-build-inputs.json" "$current_inputs" <<'PY'
import json
import pathlib
import sys

expected = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
actual = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
if expected != actual:
    raise SystemExit("resolved port integration config changed during release verification")
expected_inputs = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
actual_inputs = json.loads(pathlib.Path(sys.argv[4]).read_text(encoding="utf-8"))
if expected_inputs != actual_inputs:
    raise SystemExit("port integration implementation inputs changed during release verification")
PY
}

verify_generated_app_unchanged() {
    local current="$RELEASE_GATE_TMP_DIR/generated-app-manifest-current.json"
    python3 "$PROVENANCE_HELPER" manifest "$APP_DIR" "$current"
    python3 "$PROVENANCE_HELPER" compare \
        "$RELEASE_GATE_TMP_DIR/generated-app-manifest.json" "$current"
}

package_format() {
    case "$1" in
        *.deb) printf 'deb\n' ;;
        *.rpm) printf 'rpm\n' ;;
        *.pkg.tar.zst) printf 'pacman\n' ;;
        *) error "Unsupported package artifact: $1" ;;
    esac
}

collect_and_snapshot_packages() {
    local snapshot_dir="$RELEASE_GATE_TMP_DIR/package-snapshots"
    local candidate snapshot snapshot_record digest filename format
    local index=0
    declare -A seen_filenames=()
    local -a candidates=()

    mkdir -m 0700 "$snapshot_dir"
    shopt -s nullglob
    candidates=(
        "$DIST_DIR"/chatgpt_*.deb
        "$DIST_DIR"/chatgpt-*.rpm
        "$DIST_DIR"/chatgpt-*.pkg.tar.zst
    )
    shopt -u nullglob

    for candidate in "${candidates[@]}"; do
        [ -f "$candidate" ] && [ ! -L "$candidate" ] || continue
        filename="${candidate##*/}"
        [[ "$filename" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || \
            error "Unsafe package filename: $filename"
        [ -z "${seen_filenames[$filename]:-}" ] || error "Duplicate package filename: $filename"
        seen_filenames[$filename]=1
        format="$(package_format "$candidate")"
        snapshot="$snapshot_dir/$(printf '%03d-%s' "$index" "$filename")"
        snapshot_record="$(python3 "$PROVENANCE_HELPER" snapshot "$candidate" "$snapshot")"
        digest="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["sha256"])' "$snapshot_record")"
        PACKAGE_ORIGINALS+=("$candidate")
        PACKAGE_SNAPSHOTS+=("$snapshot")
        PACKAGE_FORMATS+=("$format")
        PACKAGE_DIGESTS+=("$digest")
        PACKAGE_FILENAMES+=("$filename")
        index=$((index + 1))
    done
    [ "${#PACKAGE_SNAPSHOTS[@]}" -gt 0 ] || error "No regular non-symlink native packages found in $DIST_DIR"
}

expected_arch_for_format() {
    case "$1" in
        deb)
            command -v dpkg >/dev/null 2>&1 || error "dpkg is required to verify Debian package architecture"
            dpkg --print-architecture
            ;;
        rpm)
            case "$(uname -m)" in
                x86_64) printf 'x86_64\n' ;;
                aarch64) printf 'aarch64\n' ;;
                armv7l) printf 'armv7hl\n' ;;
                *) error "Unsupported RPM architecture: $(uname -m)" ;;
            esac
            ;;
        pacman)
            case "$(uname -m)" in
                x86_64) printf 'x86_64\n' ;;
                aarch64) printf 'aarch64\n' ;;
                *) error "Unsupported pacman architecture: $(uname -m)" ;;
            esac
            ;;
    esac
}

verify_package_metadata() {
    local package="$1"
    local format="$2"
    local expected_arch name version arch query
    expected_arch="$(expected_arch_for_format "$format")"

    case "$format" in
        deb)
            command -v dpkg-deb >/dev/null 2>&1 || error "dpkg-deb is required to inspect $package"
            name="$(dpkg-deb -f "$package" Package)"
            version="$(dpkg-deb -f "$package" Version)"
            arch="$(dpkg-deb -f "$package" Architecture)"
            [ "$version" = "$PACKAGE_VERSION" ] || \
                error "Package $package has unexpected version '$version'"
            ;;
        rpm)
            command -v rpm >/dev/null 2>&1 || error "rpm is required to inspect $package"
            local rpm_metadata_database="$RELEASE_GATE_TMP_DIR/rpm-metadata-database"
            mkdir -p "$rpm_metadata_database"
            query="$(rpm --dbpath "$rpm_metadata_database" -qp \
                --queryformat $'%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}' "$package")"
            IFS=$'\t' read -r name version arch <<<"$query"
            local rpm_version="${PACKAGE_VERSION%%+*}"
            local rpm_release="${PACKAGE_VERSION#*+}"
            [ "$rpm_version" != "$PACKAGE_VERSION" ] || rpm_release=1
            [ "$version" = "$rpm_version-$rpm_release" ] || \
                error "Package $package has unexpected version '$version'"
            ;;
        pacman)
            command -v pacman >/dev/null 2>&1 || error "pacman is required to inspect $package"
            command -v bsdtar >/dev/null 2>&1 || error "bsdtar is required to inspect $package"
            query="$(pacman -Qp "$package")"
            read -r name version <<<"$query"
            arch="$(bsdtar -xOf "$package" .PKGINFO | sed -n 's/^arch = //p' | head -n 1)"
            [ "$version" = "${PACKAGE_VERSION//+/_}-1" ] || \
                error "Package $package has unexpected version '$version'"
            ;;
    esac

    [ "$name" = "$PACKAGE_NAME" ] || error "Package $package has unexpected name '$name'"
    [ "$arch" = "$expected_arch" ] || error "Package $package has unexpected architecture '$arch'"
    printf '%s\t%s\t%s\n' "$name" "$version" "$arch"
}

extract_package_payload() {
    local package="$1"
    local format="$2"
    local destination="$3"
    mkdir -m 0700 "$destination"

    case "$format" in
        deb)
            command -v dpkg-deb >/dev/null 2>&1 || error "dpkg-deb is required to extract $package"
            (umask 000 && dpkg-deb -x "$package" "$destination")
            ;;
        rpm)
            command -v rpm2cpio >/dev/null 2>&1 || error "rpm2cpio is required to extract $package"
            command -v cpio >/dev/null 2>&1 || error "cpio is required to extract $package"
            local cpio_archive
            cpio_archive="$RELEASE_GATE_TMP_DIR/package-payload-$(basename "$destination").cpio"
            rpm2cpio "$package" >"$cpio_archive"
            (umask 000 && cd "$destination" && cpio --quiet -idm --no-absolute-filenames <"$cpio_archive")
            rm -f "$cpio_archive"
            # cpio creates implicit parent directories through the caller's
            # umask instead of applying the RPM header mode. The package
            # contract normalizes every payload directory to 0755, while the
            # raw RPM header comparison below binds the archive metadata.
            find "$destination" -type d -exec chmod 0755 {} +
            ;;
        pacman)
            command -v bsdtar >/dev/null 2>&1 || error "bsdtar is required to extract $package"
            (umask 000 && bsdtar -xf "$package" -C "$destination" \
                --exclude '.PKGINFO' --exclude './.PKGINFO' \
                --exclude '.BUILDINFO' --exclude './.BUILDINFO' \
                --exclude '.MTREE' --exclude './.MTREE' \
                --exclude '.INSTALL' --exclude './.INSTALL' \
                --exclude '.CHANGELOG' --exclude './.CHANGELOG')
            ;;
    esac
}

build_reference_package() {
    local format="$1"
    local index="$2"
    local reference_root="$RELEASE_GATE_TMP_DIR/reference-package-$index"
    local reference_dist="$reference_root/dist"
    local reference_home="$reference_root/home"
    local reference_tmp="$reference_root/tmp"
    local builder pattern
    local -a matches=()

    mkdir -m 0700 "$reference_root" "$reference_dist" "$reference_home" "$reference_tmp"
    case "$format" in
        deb)
            builder="$REPO_DIR/scripts/build-deb.sh"
            pattern='*.deb'
            ;;
        rpm)
            builder="$REPO_DIR/scripts/build-rpm.sh"
            pattern='*.rpm'
            ;;
        pacman)
            builder="$REPO_DIR/scripts/build-pacman.sh"
            pattern='*.pkg.tar.*'
            ;;
        *) error "Unsupported native package format: $format" ;;
    esac

    if ! /usr/bin/env -i \
        PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        LC_ALL=C \
        HOME="$reference_home" \
        XDG_CACHE_HOME="$reference_home/.cache" \
        XDG_CONFIG_HOME="$reference_home/.config" \
        XDG_DATA_HOME="$reference_home/.local/share" \
        XDG_STATE_HOME="$reference_home/.local/state" \
        TMPDIR="$reference_tmp" \
        APP_DIR_OVERRIDE="$APP_DIR" \
        DIST_DIR_OVERRIDE="$reference_dist" \
        PKG_ROOT_OVERRIDE="$reference_root/deb-root" \
        PACKAGE_NAME="$PACKAGE_NAME" \
        PACKAGE_VERSION="$PACKAGE_VERSION" \
        PACKAGE_WITH_UPDATER="$PACKAGE_WITH_UPDATER" \
        PACKAGE_DISPLAY_NAME="${PACKAGE_DISPLAY_NAME:-}" \
        PACKAGE_COMMENT="${PACKAGE_COMMENT:-}" \
        PACKAGE_ICON_SOURCE="${PACKAGE_ICON_SOURCE:-}" \
        UPDATER_BINARY_SOURCE="$UPDATER_BINARY_SOURCE" \
        UPDATER_SERVICE_SOURCE="$UPDATER_SERVICE_SOURCE" \
        PACKAGED_RUNTIME_SOURCE="$PACKAGED_RUNTIME_SOURCE" \
        CHATGPT_LINUX_SOURCE_INFO_SOURCE="${CHATGPT_LINUX_SOURCE_INFO_SOURCE:-}" \
        CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="${CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE:-}" \
        CHATGPT_PACKAGE_NODE_SOURCE="${CHATGPT_PACKAGE_NODE_SOURCE:-}" \
        CHATGPT_PORT_INTEGRATIONS_ROOT="${CHATGPT_PORT_INTEGRATIONS_ROOT:-}" \
        CHATGPT_PORT_INTEGRATIONS_CONFIG="${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}" \
        CHATGPT_RPM_SPEC_TEMPLATE_SOURCE="$REPO_DIR/packaging/linux/chatgpt.spec" \
        SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
        MAX_BUILD_THREADS=0 \
        bash "$builder" >"$reference_root/build.log" 2>&1; then
        sed -n '1,240p' "$reference_root/build.log" >&2
        error "Could not build the reviewed $format reference package"
    fi

    mapfile -t matches < <(find "$reference_dist" -maxdepth 1 -type f -name "$pattern" -print)
    [ "${#matches[@]}" -eq 1 ] || \
        error "Expected exactly one reviewed $format reference package, found ${#matches[@]}"
    printf '%s\n' "${matches[0]}"
}

write_rpm_control_surface() {
    local package="$1"
    local destination="$2"
    local database="$destination/rpmdb"
    local query
    local -a rpm_query=(rpm --dbpath "$database" -qp)

    mkdir -m 0700 "$database"
    LC_ALL=C "${rpm_query[@]}" --queryformat $'Name: %{NAME}\nEpoch: %{EPOCHNUM}\nVersion: %{VERSION}\nRelease: %{RELEASE}\nArchitecture: %{ARCH}\nSummary: %{SUMMARY}\nLicense: %{LICENSE}\nDescription:\n%{DESCRIPTION}\nVendor: %{VENDOR}\nURL: %{URL}\nPackager: %{PACKAGER}\nGroup: %{GROUP}\nOS: %{OS}\nPrefixes: %{PREFIXES}\n' \
        "$package" >"$destination/identity"
    for query in requires provides conflicts obsoletes recommends suggests supplements enhances; do
        LC_ALL=C "${rpm_query[@]}" "--$query" "$package" | LC_ALL=C sort \
            >"$destination/$query"
    done
    LC_ALL=C "${rpm_query[@]}" --scripts "$package" >"$destination/scripts"
    LC_ALL=C "${rpm_query[@]}" --triggers "$package" >"$destination/triggers"
    LC_ALL=C "${rpm_query[@]}" --filetriggers "$package" >"$destination/filetriggers"
    LC_ALL=C "${rpm_query[@]}" --dump "$package" | LC_ALL=C sort >"$destination/files"
    LC_ALL=C "${rpm_query[@]}" --filecaps "$package" | LC_ALL=C sort >"$destination/filecaps"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{FILENAMES}\t%{FILEUSERNAME}\t%{FILEGROUPNAME}\t%{FILEMODES:octal}\t%{FILEFLAGS}\t%{FILEVERIFYFLAGS}\t%{FILECAPS}\t%{FILECONTEXTS}\n]' \
        "$package" >"$destination/file-security-metadata"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{FILENAMES}\t%{FILEDEVICES}\t%{FILEINODES}\t%{FILENLINKS}\t%{FILECOLORS}\t%{FILELANGS}\n]' \
        "$package" >"$destination/file-topology-metadata"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{FILENAMES}\t%{FILESIGNATURELENGTH}\t%{FILESIGNATURES}\t%{VERITYSIGNATUREALGO}\t%{VERITYSIGNATURES}\n]' \
        "$package" >"$destination/file-integrity-metadata"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{POLICYNAMES}\t%{POLICYFLAGS}\t%{POLICYTYPES}\n]' \
        "$package" >"$destination/policies"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{REQUIRENAME}\t%{REQUIREVERSION}\t%{REQUIREFLAGS}\n]' \
        "$package" >"$destination/requires-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{PROVIDENAME}\t%{PROVIDEVERSION}\t%{PROVIDEFLAGS}\n]' \
        "$package" >"$destination/provides-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{CONFLICTNAME}\t%{CONFLICTVERSION}\t%{CONFLICTFLAGS}\n]' \
        "$package" >"$destination/conflicts-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{OBSOLETENAME}\t%{OBSOLETEVERSION}\t%{OBSOLETEFLAGS}\n]' \
        "$package" >"$destination/obsoletes-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{RECOMMENDNAME}\t%{RECOMMENDVERSION}\t%{RECOMMENDFLAGS}\n]' \
        "$package" >"$destination/recommends-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{SUGGESTNAME}\t%{SUGGESTVERSION}\t%{SUGGESTFLAGS}\n]' \
        "$package" >"$destination/suggests-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{SUPPLEMENTNAME}\t%{SUPPLEMENTVERSION}\t%{SUPPLEMENTFLAGS}\n]' \
        "$package" >"$destination/supplements-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{ENHANCENAME}\t%{ENHANCEVERSION}\t%{ENHANCEFLAGS}\n]' \
        "$package" >"$destination/enhances-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{ORDERNAME}\t%{ORDERVERSION}\t%{ORDERFLAGS}\n]' \
        "$package" >"$destination/order-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'prein\t%{PREINPROG}\t%{PREINFLAGS}\t%{PREIN}\npostin\t%{POSTINPROG}\t%{POSTINFLAGS}\t%{POSTIN}\npreun\t%{PREUNPROG}\t%{PREUNFLAGS}\t%{PREUN}\npostun\t%{POSTUNPROG}\t%{POSTUNFLAGS}\t%{POSTUN}\npretrans\t%{PRETRANSPROG}\t%{PRETRANSFLAGS}\t%{PRETRANS}\nposttrans\t%{POSTTRANSPROG}\t%{POSTTRANSFLAGS}\t%{POSTTRANS}\npreuntrans\t%{PREUNTRANSPROG}\t%{PREUNTRANSFLAGS}\t%{PREUNTRANS}\npostuntrans\t%{POSTUNTRANSPROG}\t%{POSTUNTRANSFLAGS}\t%{POSTUNTRANS}\nverify\t%{VERIFYSCRIPTPROG}\t%{VERIFYSCRIPTFLAGS}\t%{VERIFYSCRIPT}\n' \
        "$package" >"$destination/scriptlets-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{TRIGGERINDEX}\t%{TRIGGERNAME}\t%{TRIGGERVERSION}\t%{TRIGGERFLAGS}\t%{TRIGGERSCRIPTPROG}\t%{TRIGGERSCRIPTFLAGS}\t%{TRIGGERSCRIPTS}\n]' \
        "$package" >"$destination/triggers-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{FILETRIGGERINDEX}\t%{FILETRIGGERNAME}\t%{FILETRIGGERVERSION}\t%{FILETRIGGERFLAGS}\t%{FILETRIGGERPRIORITIES}\t%{FILETRIGGERSCRIPTPROG}\t%{FILETRIGGERSCRIPTFLAGS}\t%{FILETRIGGERSCRIPTS}\n]' \
        "$package" >"$destination/filetriggers-raw"
    LC_ALL=C "${rpm_query[@]}" --queryformat \
        $'[%{TRANSFILETRIGGERINDEX}\t%{TRANSFILETRIGGERNAME}\t%{TRANSFILETRIGGERVERSION}\t%{TRANSFILETRIGGERFLAGS}\t%{TRANSFILETRIGGERPRIORITIES}\t%{TRANSFILETRIGGERSCRIPTPROG}\t%{TRANSFILETRIGGERSCRIPTFLAGS}\t%{TRANSFILETRIGGERSCRIPTS}\n]' \
        "$package" >"$destination/transfiletriggers-raw"
    rm -rf "$database"
    chmod 0644 "$destination"/*
}

extract_pacman_control_surface() {
    local package="$1"
    local destination="$2"
    local members member count output_name
    members="$(bsdtar -tf "$package")"

    for member in .PKGINFO .INSTALL .CHANGELOG; do
        count="$(printf '%s\n' "$members" | awk -v expected="$member" '
            { name = $0; sub(/^\.\//, "", name); if (name == expected) count++ }
            END { print count + 0 }
        ')"
        [ "$count" -le 1 ] || error "Package $package contains duplicate $member entries"
        if [ "$count" -eq 1 ]; then
            output_name="${member#.}"
            bsdtar -xOf "$package" "$member" >"$destination/$output_name"
        fi
    done
    [ -f "$destination/PKGINFO" ] || error "Package $package is missing .PKGINFO"

    count="$(printf '%s\n' "$members" | awk '
        { name = $0; sub(/^\.\//, "", name); if (name == ".MTREE") count++ }
        END { print count + 0 }
    ')"
    [ "$count" -eq 1 ] || error "Package $package must contain exactly one .MTREE"
    bsdtar -xOf "$package" .MTREE | gzip -dc | \
        awk '$1 != "./.BUILDINFO" { print }' >"$destination/MTREE"
    chmod 0644 "$destination"/*
}

extract_package_control_surface() {
    local package="$1"
    local format="$2"
    local destination="$3"
    mkdir -m 0700 "$destination"

    case "$format" in
        deb)
            command -v dpkg-deb >/dev/null 2>&1 || error "dpkg-deb is required to inspect $package"
            dpkg-deb -e "$package" "$destination/control"
            dpkg-deb --ctrl-tarfile "$package" | \
                python3 "$PROVENANCE_HELPER" tar-manifest "$destination/control-archive.json"
            dpkg-deb --fsys-tarfile "$package" | \
                python3 "$PROVENANCE_HELPER" tar-manifest "$destination/data-archive.json"
            ;;
        rpm)
            command -v rpm >/dev/null 2>&1 || error "rpm is required to inspect $package"
            write_rpm_control_surface "$package" "$destination"
            ;;
        pacman)
            command -v bsdtar >/dev/null 2>&1 || error "bsdtar is required to inspect $package"
            command -v gzip >/dev/null 2>&1 || error "gzip is required to inspect $package"
            extract_pacman_control_surface "$package" "$destination"
            command -v zstd >/dev/null 2>&1 || error "zstd is required to inspect $package"
            zstd -dc -- "$package" | python3 "$PROVENANCE_HELPER" tar-manifest \
                --ignore-content .BUILDINFO --ignore-content .MTREE \
                "$destination/archive.json"
            ;;
    esac
}

append_package_record() {
    local records_path="$1"
    local format="$2"
    local name="$3"
    local version="$4"
    local arch="$5"
    local payload_digest="$6"
    local control_digest="$7"
    local package_digest="$8"
    local filename="$9"
    python3 - "$records_path" "$format" "$name" "$version" "$arch" \
        "$payload_digest" "$control_digest" "$package_digest" "$filename" <<'PY'
import json
import pathlib
import sys

record = {
    "format": sys.argv[2],
    "name": sys.argv[3],
    "version": sys.argv[4],
    "arch": sys.argv[5],
    "payloadManifestSha256": sys.argv[6],
    "controlManifestSha256": sys.argv[7],
    "sha256": sys.argv[8],
    "filename": sys.argv[9],
}
with pathlib.Path(sys.argv[1]).open("a", encoding="utf-8") as destination:
    destination.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
PY
}

verify_package_payloads() {
    local records_path="$RELEASE_GATE_TMP_DIR/package-records.jsonl"
    local index package format metadata name version arch
    local expected_root actual_root expected_manifest actual_manifest payload_digest
    local reference_package expected_control actual_control
    local expected_control_manifest actual_control_manifest control_digest
    : >"$records_path"

    for index in "${!PACKAGE_SNAPSHOTS[@]}"; do
        package="${PACKAGE_SNAPSHOTS[$index]}"
        format="${PACKAGE_FORMATS[$index]}"
        metadata="$(verify_package_metadata "$package" "$format")"
        IFS=$'\t' read -r name version arch <<<"$metadata"

        expected_root="$RELEASE_GATE_TMP_DIR/expected-$index"
        actual_root="$RELEASE_GATE_TMP_DIR/actual-$index"
        mkdir -m 0700 "$expected_root"
        verify_resolved_config_unchanged
        verify_generated_app_unchanged
        stage_native_package_payload "$expected_root" "$format"
        verify_resolved_config_unchanged
        verify_generated_app_unchanged
        extract_package_payload "$package" "$format" "$actual_root"

        expected_manifest="$RELEASE_GATE_TMP_DIR/expected-$index.json"
        actual_manifest="$RELEASE_GATE_TMP_DIR/actual-$index.json"
        python3 "$PROVENANCE_HELPER" manifest "$expected_root" "$expected_manifest"
        python3 "$PROVENANCE_HELPER" manifest "$actual_root" "$actual_manifest"
        python3 "$PROVENANCE_HELPER" compare "$expected_manifest" "$actual_manifest"
        payload_digest="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["manifestSha256"])' "$expected_manifest")"

        reference_package="$(build_reference_package "$format" "$index")"
        if [ "$format" = "rpm" ] && ! cmp -s "$reference_package" "$package"; then
            error "RPM bytes differ from the deterministic reviewed reference package"
        fi
        expected_control="$RELEASE_GATE_TMP_DIR/expected-control-$index"
        actual_control="$RELEASE_GATE_TMP_DIR/actual-control-$index"
        extract_package_control_surface "$reference_package" "$format" "$expected_control"
        extract_package_control_surface "$package" "$format" "$actual_control"
        expected_control_manifest="$RELEASE_GATE_TMP_DIR/expected-control-$index.json"
        actual_control_manifest="$RELEASE_GATE_TMP_DIR/actual-control-$index.json"
        python3 "$PROVENANCE_HELPER" manifest "$expected_control" "$expected_control_manifest"
        python3 "$PROVENANCE_HELPER" manifest "$actual_control" "$actual_control_manifest"
        python3 "$PROVENANCE_HELPER" compare "$expected_control_manifest" "$actual_control_manifest"
        control_digest="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["manifestSha256"])' "$expected_control_manifest")"
        append_package_record \
            "$records_path" "$format" "$name" "$version" "$arch" \
            "$payload_digest" "$control_digest" \
            "${PACKAGE_DIGESTS[$index]}" "${PACKAGE_FILENAMES[$index]}"
        info "Verified $format payload and control surface: ${PACKAGE_FILENAMES[$index]}"
    done
}

verify_package_pathnames_unchanged() {
    local index actual
    for index in "${!PACKAGE_ORIGINALS[@]}"; do
        require_file "${PACKAGE_ORIGINALS[$index]}" "package artifact"
        actual="$(sha256sum "${PACKAGE_ORIGINALS[$index]}" | awk '{print $1}')"
        [ "$actual" = "${PACKAGE_DIGESTS[$index]}" ] || \
            error "Package pathname changed after snapshot: ${PACKAGE_ORIGINALS[$index]}"
    done
}

verify_source_unchanged() {
    local current_commit source_status
    current_commit="$(source_git rev-parse HEAD)" || \
        error "Could not re-read the reviewed source commit with trusted Git"
    [ "$current_commit" = "$SOURCE_COMMIT_START" ] || \
        error "Repository HEAD changed during release verification"
    if [ "$RELEASE_MODE" = "public" ]; then
        source_status="$(source_git status --porcelain --untracked-files=all)" || \
            error "Trusted Git could not re-inspect the reviewed source state"
        if [ -n "$source_status" ]; then
            error "Source tree changed during public release verification"
        fi
    fi
}

assemble_release_outputs() {
    local checksums_tmp="$RELEASE_GATE_TMP_DIR/SHA256SUMS"
    local provenance_tmp="$RELEASE_GATE_TMP_DIR/RELEASE-PROVENANCE.json"
    local index
    local -a updater_argument=()
    : >"$checksums_tmp"
    for index in "${!PACKAGE_SNAPSHOTS[@]}"; do
        printf '%s  %s\n' "${PACKAGE_DIGESTS[$index]}" "${PACKAGE_FILENAMES[$index]}" >>"$checksums_tmp"
    done

    if package_with_updater_enabled; then
        require_file "$UPDATER_BINARY_SOURCE" "reviewed updater binary"
        updater_argument=(--updater-sha256 "$(sha256sum "$UPDATER_BINARY_SOURCE" | awk '{print $1}')")
    fi

    python3 "$PROVENANCE_HELPER" assemble-provenance \
        --release-mode "$RELEASE_MODE" \
        --dmg-sha256 "$VERIFIED_DMG_SHA256" \
        --dmg-app-version "$VERIFIED_DMG_APP_VERSION" \
        --app-manifest "$RELEASE_GATE_TMP_DIR/generated-app-manifest.json" \
        --build-info "$APP_DIR/.chatgpt-linux/build-info.json" \
        --source-commit "$SOURCE_COMMIT_START" \
        --source-dirty "$SOURCE_DIRTY" \
        --resolved-config "$RELEASE_GATE_TMP_DIR/resolved-port-integrations.json" \
        --package-with-updater "$(package_with_updater_value)" \
        --source-date-epoch "$SOURCE_DATE_EPOCH" \
        --release-signing-fingerprint "$RELEASE_SIGNING_FINGERPRINT" \
        "${updater_argument[@]}" \
        --packages-jsonl "$RELEASE_GATE_TMP_DIR/package-records.jsonl" \
        --output "$provenance_tmp"
}

sign_release_outputs() {
    local checksums_tmp="$RELEASE_GATE_TMP_DIR/SHA256SUMS"
    local provenance_tmp="$RELEASE_GATE_TMP_DIR/RELEASE-PROVENANCE.json"
    local public_key_tmp="$RELEASE_GATE_TMP_DIR/release-signing-key.asc"
    local verify_home exported_fingerprint signature_status signature_fingerprint

    if [ "$REQUIRE_RELEASE_SIGNATURE" != "1" ] && [ -z "${CHATGPT_RELEASE_GPG_KEY:-}" ]; then
        [ "$RELEASE_MODE" = "rehearsal" ] || error "Public release outputs must be signed"
        info "Unsigned rehearsal; outputs are not public-release eligible"
        return
    fi

    [ -n "$RELEASE_GPG" ] || error "Release signing identity was not prepared"
    [ -n "$RELEASE_SIGNING_FINGERPRINT" ] || error "Release signing fingerprint is unavailable"
    "$RELEASE_GPG" --batch --yes --local-user "$RELEASE_SIGNING_FINGERPRINT" \
        --output "$RELEASE_GATE_TMP_DIR/SHA256SUMS.asc" --detach-sign --armor "$checksums_tmp"
    "$RELEASE_GPG" --batch --yes --local-user "$RELEASE_SIGNING_FINGERPRINT" \
        --output "$RELEASE_GATE_TMP_DIR/RELEASE-PROVENANCE.json.asc" --detach-sign --armor "$provenance_tmp"
    "$RELEASE_GPG" --batch --yes --armor --export "$RELEASE_SIGNING_FINGERPRINT" >"$public_key_tmp"
    require_file "$public_key_tmp" "release signing public key"

    verify_home="$RELEASE_GATE_TMP_DIR/signature-verification-home"
    mkdir -m 0700 "$verify_home"
    GNUPGHOME="$verify_home" "$RELEASE_GPG" --batch --import "$public_key_tmp" >/dev/null
    exported_fingerprint="$(
        GNUPGHOME="$verify_home" "$RELEASE_GPG" --batch --with-colons --fingerprint --list-keys \
            "$RELEASE_SIGNING_FINGERPRINT" 2>/dev/null | \
            awk -F: '$1 == "pub" { primary = 1; next } primary && $1 == "fpr" { print toupper($10); exit }'
    )"
    [ "$exported_fingerprint" = "$RELEASE_SIGNING_FINGERPRINT" ] || \
        error "Exported release key does not match the reviewed signing fingerprint"

    for signature_and_payload in \
        "$RELEASE_GATE_TMP_DIR/SHA256SUMS.asc:$checksums_tmp" \
        "$RELEASE_GATE_TMP_DIR/RELEASE-PROVENANCE.json.asc:$provenance_tmp"; do
        local signature="${signature_and_payload%%:*}"
        local payload="${signature_and_payload#*:}"
        signature_status="$(
            GNUPGHOME="$verify_home" "$RELEASE_GPG" --batch --status-fd 1 \
                --verify "$signature" "$payload" 2>/dev/null
        )" || error "Release signature verification failed"
        signature_fingerprint="$(
            printf '%s\n' "$signature_status" | \
                awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print toupper($12 != "" ? $12 : $3); exit }'
        )"
        [ "$signature_fingerprint" = "$RELEASE_SIGNING_FINGERPRINT" ] || \
            error "Release signature was not made by the reviewed primary key"
    done
    rm -rf "$verify_home"
}

publish_release_outputs() {
    mkdir -p "$(dirname "$CHECKSUM_FILE")" "$(dirname "$PROVENANCE_FILE")"
    mv -f "$RELEASE_GATE_TMP_DIR/SHA256SUMS" "$CHECKSUM_FILE"
    mv -f "$RELEASE_GATE_TMP_DIR/RELEASE-PROVENANCE.json" "$PROVENANCE_FILE"
    if [ -f "$RELEASE_GATE_TMP_DIR/SHA256SUMS.asc" ]; then
        mv -f "$RELEASE_GATE_TMP_DIR/SHA256SUMS.asc" "${CHECKSUM_FILE}.asc"
        mv -f "$RELEASE_GATE_TMP_DIR/RELEASE-PROVENANCE.json.asc" "${PROVENANCE_FILE}.asc"
        mkdir -p "$(dirname "$PUBLIC_KEY_FILE")"
        mv -f "$RELEASE_GATE_TMP_DIR/release-signing-key.asc" "$PUBLIC_KEY_FILE"
    fi
    info "Wrote $(realpath --relative-to="$PWD" "$CHECKSUM_FILE" 2>/dev/null || printf '%s' "$CHECKSUM_FILE")"
    info "Wrote $(realpath --relative-to="$PWD" "$PROVENANCE_FILE" 2>/dev/null || printf '%s' "$PROVENANCE_FILE")"
}

main() {
    prepare_release_mode
    prepare_release_environment
    prepare_release_signing_identity
    prepare_release_node
    prepare_source_state
    prepare_output_paths
    umask 077
    RELEASE_GATE_TMP_DIR="$(mktemp -d)"
    require_file "$PROVENANCE_HELPER" "package provenance helper"
    prepare_reviewed_source
    snapshot_official_dmg
    verify_dmg_hash
    verify_dmg_app_version
    prepare_release_nix
    build_reviewed_native_helpers
    snapshot_submitted_app
    build_and_compare_reference_app
    ICON_SOURCE="$(resolve_package_icon_source)"

    resolve_release_package_version
    inspect_generated_app
    verify_generated_app_binding
    collect_and_snapshot_packages
    verify_package_payloads
    verify_package_pathnames_unchanged
    verify_resolved_config_unchanged
    verify_generated_app_unchanged
    verify_source_unchanged
    assemble_release_outputs
    sign_release_outputs
    verify_package_pathnames_unchanged
    verify_resolved_config_unchanged
    verify_generated_app_unchanged
    verify_source_unchanged
    publish_release_outputs

    if [ "$RELEASE_MODE" = "public" ]; then
        info "Public release gate passed"
    else
        info "Release rehearsal passed; artifacts are not public-release eligible"
    fi
}

if [ "${CHATGPT_RELEASE_GATE_LIBRARY:-0}" != "1" ]; then
    main "$@"
fi
