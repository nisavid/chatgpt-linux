#!/bin/bash
# Resolve the build-only generated-app mutation broker.
#
# Sourced by install.sh and package build helpers. Do not run directly.
# shellcheck shell=bash

GENERATED_APP_MUTATION_BROKER_PACKAGE="generated-app-mutation-broker"
GENERATED_APP_MUTATION_BROKER_BINARY="chatgpt-generated-app-mutation-broker"
GENERATED_APP_MUTATION_BROKER_DIGEST_RELATIVE_PATH=".chatgpt-linux/generated-app-mutation-broker.sha256"

generated_app_mutation_broker_host_elf_machine() {
    case "$(uname -m)" in
        x86_64) printf '%s\n' 62 ;;
        aarch64|arm64) printf '%s\n' 183 ;;
        armv7l|armv6l) printf '%s\n' 40 ;;
        i386|i486|i586|i686) printf '%s\n' 3 ;;
        *)
            printf 'Unsupported host architecture for generated-app mutation broker: %s\n' \
                "$(uname -m)" >&2
            return 1
            ;;
    esac
}

generated_app_mutation_broker_host_elf_class() {
    case "$(uname -m)" in
        x86_64|aarch64|arm64) printf '%s\n' 2 ;;
        armv7l|armv6l|i386|i486|i586|i686) printf '%s\n' 1 ;;
        *) generated_app_mutation_broker_host_elf_machine >/dev/null || return 1 ;;
    esac
}

validate_generated_app_mutation_broker_elf() {
    local candidate="$1"
    local class
    local data
    local expected_class
    local expected_machine
    local machine_bytes_text
    local -a machine_bytes
    local machine
    local magic

    magic="$(od -An -tx1 -N4 -- "$candidate" | tr -d ' \n')" || return 1
    class="$(od -An -tu1 -j4 -N1 -- "$candidate" | tr -d ' \n')" || return 1
    data="$(od -An -tu1 -j5 -N1 -- "$candidate" | tr -d ' \n')" || return 1
    machine_bytes_text="$(od -An -tu1 -j18 -N2 -- "$candidate")" || return 1
    read -r -a machine_bytes <<< "$machine_bytes_text"
    expected_class="$(generated_app_mutation_broker_host_elf_class)" || return 1
    if [ "$magic" != "7f454c46" ] || [ "$class" != "$expected_class" ] || \
            [ "$data" != "1" ] || \
            [ "${#machine_bytes[@]}" -ne 2 ]; then
        printf 'Generated-app mutation broker ELF class and endianness must match this host: %s\n' \
            "$candidate" >&2
        return 1
    fi
    machine=$((machine_bytes[0] + machine_bytes[1] * 256))
    expected_machine="$(generated_app_mutation_broker_host_elf_machine)" || return 1
    if [ "$machine" -ne "$expected_machine" ]; then
        printf 'Generated-app mutation broker ELF architecture does not match this host: %s\n' \
            "$candidate" >&2
        return 1
    fi
}

validate_generated_app_mutation_broker() {
    local candidate="$1"
    local effective_uid
    local owner_uid
    local permissions
    local resolved

    case "$candidate" in
        /*) ;;
        *)
            printf 'Generated-app mutation broker path must be absolute: %s\n' "$candidate" >&2
            return 1
            ;;
    esac
    if [ ! -f "$candidate" ] || [ -L "$candidate" ] || [ ! -x "$candidate" ]; then
        printf 'Generated-app mutation broker must be a regular non-symlink executable: %s\n' "$candidate" >&2
        return 1
    fi

    effective_uid="$(id -u)"
    owner_uid="$(stat -c '%u' -- "$candidate")" || return 1
    if [ "$owner_uid" != "$effective_uid" ] && [ "$owner_uid" != "0" ]; then
        printf 'Generated-app mutation broker must be owned by the current user or root: %s\n' "$candidate" >&2
        return 1
    fi

    permissions="$(stat -c '%a' -- "$candidate")" || return 1
    if (( (8#$permissions & 8#022) != 0 )); then
        printf 'Generated-app mutation broker must not be group- or world-writable: %s\n' "$candidate" >&2
        return 1
    fi

    resolved="$(realpath -e -- "$candidate")" || return 1
    if [ ! -f "$resolved" ] || [ -L "$resolved" ] || [ ! -x "$resolved" ]; then
        printf 'Resolved generated-app mutation broker is unsafe: %s\n' "$resolved" >&2
        return 1
    fi
    validate_generated_app_mutation_broker_elf "$resolved" || return 1
    printf '%s\n' "$resolved"
}

generated_app_mutation_broker_sha256() {
    local candidate="$1"
    sha256sum -- "$candidate" | awk '{print $1}'
}

write_generated_app_mutation_broker_digest() {
    local app_dir="$1"
    local broker="$2"
    local executed_digest="${3:-}"
    local actual_digest
    local digest_path="$app_dir/$GENERATED_APP_MUTATION_BROKER_DIGEST_RELATIVE_PATH"
    local temporary

    if [[ ! "$executed_digest" =~ ^[0-9a-f]{64}$ ]]; then
        printf 'Executed generated-app mutation broker digest is malformed.\n' >&2
        return 1
    fi
    broker="$(validate_generated_app_mutation_broker "$broker")" || return 1
    actual_digest="$(generated_app_mutation_broker_sha256 "$broker")" || return 1
    if [ "$actual_digest" != "$executed_digest" ]; then
        printf 'Generated-app mutation broker path changed after patch execution: %s\n' \
            "$broker" >&2
        return 1
    fi
    mkdir -p "$(dirname "$digest_path")"
    temporary="$(mktemp "$(dirname "$digest_path")/.generated-app-mutation-broker.XXXXXX")" || return 1
    printf '%s  %s\n' "$executed_digest" "$GENERATED_APP_MUTATION_BROKER_BINARY" > "$temporary"
    chmod 0644 "$temporary"
    mv -f "$temporary" "$digest_path"
}

read_generated_app_mutation_broker_digest() {
    local app_dir="$1"
    local digest_path="$app_dir/$GENERATED_APP_MUTATION_BROKER_DIGEST_RELATIVE_PATH"
    local digest
    local line
    local suffix

    if [ ! -f "$digest_path" ] || [ -L "$digest_path" ]; then
        printf 'Generated app is missing a regular broker digest manifest: %s\n' "$digest_path" >&2
        return 1
    fi
    IFS= read -r line < "$digest_path" || [ -n "$line" ] || return 1
    digest="${line%% *}"
    suffix="${line#"$digest"}"
    if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]] || \
            [ "$suffix" != "  $GENERATED_APP_MUTATION_BROKER_BINARY" ]; then
        printf 'Generated app broker digest manifest is malformed: %s\n' "$digest_path" >&2
        return 1
    fi
    printf '%s\n' "$digest"
}

stage_generation_bound_mutation_broker() {
    local app_dir="$1"
    local source="$2"
    local destination="$3"
    local actual_digest
    local expected_digest
    local staged_digest

    source="$(validate_generated_app_mutation_broker "$source")" || return 1
    expected_digest="$(read_generated_app_mutation_broker_digest "$app_dir")" || return 1
    actual_digest="$(generated_app_mutation_broker_sha256 "$source")" || return 1
    if [ "$actual_digest" != "$expected_digest" ]; then
        printf 'Generated-app mutation broker changed after app generation: %s\n' "$source" >&2
        return 1
    fi

    mkdir -p "$(dirname "$destination")"
    install -m 0755 "$source" "$destination"
    validate_generated_app_mutation_broker "$destination" >/dev/null || return 1
    staged_digest="$(generated_app_mutation_broker_sha256 "$destination")" || return 1
    [ "$staged_digest" = "$expected_digest" ] || return 1
    printf '%s  %s\n' "$expected_digest" "$GENERATED_APP_MUTATION_BROKER_BINARY" \
        > "$destination.sha256"
    chmod 0644 "$destination.sha256"
}

resolve_generated_app_mutation_broker() {
    local repo_root="${REPO_DIR:-${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
    local configured_source="${CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE:-}"
    local candidate
    local host_target
    local target_dir

    if [ -n "$configured_source" ]; then
        candidate="$(validate_generated_app_mutation_broker "$configured_source")" || return 1
    else
        if ! command -v cargo >/dev/null 2>&1; then
            printf '%s\n' \
                'Cargo is required to build the generated-app mutation broker; set CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE to a validated prebuilt binary instead.' >&2
            return 1
        fi
        if [ ! -f "$repo_root/Cargo.toml" ] || [ ! -f "$repo_root/Cargo.lock" ] || \
                [ ! -d "$repo_root/generated-app-mutation-broker" ]; then
            printf 'Generated-app mutation broker sources are incomplete under %s\n' "$repo_root" >&2
            return 1
        fi
        host_target="$(cargo -vV | sed -n 's/^host: //p')"
        if [ -z "$host_target" ] || [[ "$host_target" == *[!A-Za-z0-9._-]* ]]; then
            printf 'Could not determine a safe host target from Cargo.\n' >&2
            return 1
        fi
        target_dir="$repo_root/target/generated-app-mutation-broker"
        (
            cd "$repo_root"
            cargo build --locked --release \
                -p "$GENERATED_APP_MUTATION_BROKER_PACKAGE" \
                --target "$host_target" \
                --target-dir "$target_dir"
        ) || return 1
        candidate="$(validate_generated_app_mutation_broker \
            "$target_dir/$host_target/release/$GENERATED_APP_MUTATION_BROKER_BINARY")" || return 1
    fi

    CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED="$candidate"
}
