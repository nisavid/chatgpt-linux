#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$REPO_DIR/scripts/lib/generated-app-mutation-broker.sh"
TEST_ROOT="$(mktemp -d)"
trap 'chmod -R u+w "$TEST_ROOT" 2>/dev/null || true; rm -rf "$TEST_ROOT"' EXIT

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_eq() {
    local expected="$1"
    local actual="$2"
    [ "$actual" = "$expected" ] || fail "expected '$expected', got '$actual'"
}

make_executable() {
    local destination="$1"
    mkdir -p "$(dirname "$destination")"
    cp /bin/true "$destination"
    chmod 0700 "$destination"
}

emit_patch_digest_receipt() {
    printf '%s' "$1" >&3
    return "${2:-0}"
}

test_validates_absolute_regular_executable() {
    local root="$TEST_ROOT/valid"
    local broker="$root/chatgpt-generated-app-mutation-broker"
    local resolved
    mkdir -p "$root"
    make_executable "$broker"

    # shellcheck source=../scripts/lib/generated-app-mutation-broker.sh
    . "$HELPER"
    resolved="$(validate_generated_app_mutation_broker "$broker")"
    assert_eq "$(realpath "$broker")" "$resolved"

    ln -s "$broker" "$root/broker-link"
    if validate_generated_app_mutation_broker "$root/broker-link" >/dev/null 2>&1; then
        fail "symlinked broker was accepted"
    fi

    chmod 0720 "$broker"
    if validate_generated_app_mutation_broker "$broker" >/dev/null 2>&1; then
        fail "group-writable broker was accepted"
    fi

    chmod 0600 "$broker"
    if validate_generated_app_mutation_broker "$broker" >/dev/null 2>&1; then
        fail "non-executable broker was accepted"
    fi
}

test_rejects_wrong_elf_architecture() {
    local root="$TEST_ROOT/wrong-arch"
    local broker="$root/chatgpt-generated-app-mutation-broker"
    mkdir -p "$root"
    make_executable "$broker"
    python3 - "$broker" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
content = bytearray(path.read_bytes())
content[18:20] = (3).to_bytes(2, "little")
path.write_bytes(content)
PY
    chmod 0700 "$broker"

    if validate_generated_app_mutation_broker "$broker" >/dev/null 2>&1; then
        fail "wrong-architecture ELF broker was accepted"
    fi
}

test_missing_cargo_fails_closed() {
    local root="$TEST_ROOT/no-cargo"
    mkdir -p "$root/empty-bin"

    unset CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE
    if SCRIPT_DIR="$root" PATH="$root/empty-bin" resolve_generated_app_mutation_broker \
        >/dev/null 2>&1; then
        fail "resolver accepted a source build without Cargo"
    fi
}

test_generation_digest_binds_package_helper() {
    local root="$TEST_ROOT/digest-binding"
    local app_dir="$root/app"
    local original="$root/original/chatgpt-generated-app-mutation-broker"
    local changed="$root/changed/chatgpt-generated-app-mutation-broker"
    local staged="$root/staged/chatgpt-generated-app-mutation-broker"
    local actual_digest
    local executed_digest
    make_executable "$original"
    make_executable "$changed"
    printf x >> "$changed"

    error() {
        printf '%s\n' "$*" >&2
        return 1
    }
    # shellcheck source=../scripts/lib/asar-patch.sh
    . "$REPO_DIR/scripts/lib/asar-patch.sh"
    actual_digest="$(generated_app_mutation_broker_sha256 "$original")"
    executed_digest="$(
        capture_patch_mutation_broker_digest \
            emit_patch_digest_receipt \
            "$actual_digest"$'\n'
    )" || fail "valid descriptor-bound digest handoff failed"
    write_generated_app_mutation_broker_digest "$app_dir" "$original" "$executed_digest"
    stage_generation_bound_mutation_broker "$app_dir" "$original" "$staged"
    cmp -s "$original" "$staged" || fail "staged broker differs from generation broker"

    if stage_generation_bound_mutation_broker "$app_dir" "$changed" "$staged" \
        >/dev/null 2>&1; then
        fail "package staging accepted a broker changed after generation"
    fi
}

test_generation_digest_rejects_rebound_broker_path() {
    local root="$TEST_ROOT/digest-rebound"
    local app_dir="$root/app"
    local broker="$root/current/chatgpt-generated-app-mutation-broker"
    local replacement="$root/replacement/chatgpt-generated-app-mutation-broker"
    local executed_digest
    make_executable "$broker"
    make_executable "$replacement"
    printf x >> "$replacement"
    executed_digest="$(generated_app_mutation_broker_sha256 "$broker")"
    mv -f "$replacement" "$broker"

    if write_generated_app_mutation_broker_digest "$app_dir" "$broker" "$executed_digest" \
        >/dev/null 2>&1; then
        fail "manifest writer accepted a broker path rebound after execution"
    fi
    [ ! -e "$app_dir/$GENERATED_APP_MUTATION_BROKER_DIGEST_RELATIVE_PATH" ] || \
        fail "manifest writer published a digest after broker path rebound"
}

test_patch_digest_receipt_validation_is_strict() {
    local digest
    local validated
    digest="$(printf 'a%.0s' {1..64})"

    error() {
        printf '%s\n' "$*" >&2
        return 1
    }
    # shellcheck source=../scripts/lib/asar-patch.sh
    . "$REPO_DIR/scripts/lib/asar-patch.sh"

    validated="$(
        capture_patch_mutation_broker_digest \
            emit_patch_digest_receipt \
            "$digest"$'\n'
    )" || \
        fail "valid patch digest receipt was rejected"
    assert_eq "$digest" "$validated"
    for invalid in \
        "" \
        "${digest^^}"$'\n' \
        "${digest%?}"$'\n' \
        "$digest "$'\n' \
        "$digest"$'\n\n' \
        "$digest"$'\n'"$digest"$'\n'; do
        if capture_patch_mutation_broker_digest \
            emit_patch_digest_receipt \
            "$invalid" >/dev/null 2>&1; then
            fail "invalid patch digest receipt was accepted"
        fi
    done
    if capture_patch_mutation_broker_digest \
        emit_patch_digest_receipt \
        "$digest"$'\n' \
        23 >/dev/null 2>&1; then
        fail "failed patch command returned a digest receipt"
    fi
}

test_installer_resolves_and_records_generation_broker() {
    grep -Fq '. "$SCRIPT_DIR/scripts/lib/generated-app-mutation-broker.sh"' \
        "$REPO_DIR/install.sh" || fail "installer does not source broker resolver"
    grep -Fq 'resolve_generated_app_mutation_broker' \
        "$REPO_DIR/scripts/lib/asar-patch.sh" \
        || fail "ASAR patcher does not resolve the broker once per generation"
    grep -Fq 'write_generated_app_mutation_broker_digest' "$REPO_DIR/install.sh" \
        || fail "installer does not bind generated app to broker digest"
    grep -Fq '"$CHATGPT_GENERATED_APP_MUTATION_BROKER_DIGEST_RESOLVED"' \
        "$REPO_DIR/install.sh" \
        || fail "installer does not pass the executed broker digest to the manifest writer"
    grep -Fq '"$INSTALL_DIR"' "$REPO_DIR/install.sh" \
        || fail "installer does not bind the installed app to the generation broker"
}

test_asar_patcher_uses_verified_private_root() {
    local root="$TEST_ROOT/private-patch-root"
    local link="$TEST_ROOT/private-patch-root-link"
    mkdir -p "$root"
    chmod 0755 "$root"

    error() {
        printf '%s\n' "$*" >&2
        return 1
    }
    # shellcheck source=../scripts/lib/asar-patch.sh
    . "$REPO_DIR/scripts/lib/asar-patch.sh"

    prepare_verified_private_patch_root "$root"
    assert_eq "700" "$(stat -c '%a' -- "$root")"
    assert_eq "$(id -u)" "$(stat -c '%u' -- "$root")"

    ln -s "$root" "$link"
    if prepare_verified_private_patch_root "$link" >/dev/null 2>&1; then
        fail "ASAR patcher accepted a symlinked mutation root"
    fi

    grep -Fq -- '--mutation-broker "$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"' \
        "$REPO_DIR/scripts/lib/asar-patch.sh" \
        || fail "ASAR patcher does not pass the resolved broker to the patch CLI"
    grep -Fq -- '--verified-private-root' "$REPO_DIR/scripts/lib/asar-patch.sh" \
        || fail "ASAR patcher does not declare its private-root invariant"
    grep -Fq -- '--mutation-broker-digest-fd 3' "$REPO_DIR/scripts/lib/asar-patch.sh" \
        || fail "ASAR patcher does not request the descriptor-bound digest receipt"
}

test_prebuilt_override_avoids_cargo() {
    local root="$TEST_ROOT/prebuilt"
    local broker="$root/chatgpt-generated-app-mutation-broker"
    local fake_bin="$root/bin"
    local marker="$root/cargo-ran"
    local resolved
    mkdir -p "$fake_bin"
    make_executable "$broker"
    printf '#!/bin/sh\n/usr/bin/touch %q\nexit 99\n' "$marker" > "$fake_bin/cargo"
    chmod 0700 "$fake_bin/cargo"

    SCRIPT_DIR="$root/unused" \
    CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="$broker" \
    PATH="$fake_bin:/usr/bin:/bin" \
        resolve_generated_app_mutation_broker
    resolved="$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
    assert_eq "$(realpath "$broker")" "$resolved"
    [ ! -e "$marker" ] || fail "Cargo ran despite a prebuilt broker override"
}

test_source_build_is_locked_and_scoped() {
    local root="$TEST_ROOT/source"
    local checkout="$root/checkout"
    local fake_bin="$root/bin"
    local args_file="$root/cargo-args"
    local host_target="test-host-linux-gnu"
    local resolved
    mkdir -p "$checkout/generated-app-mutation-broker" "$fake_bin"
    printf '[workspace]\nmembers=["generated-app-mutation-broker"]\n' > "$checkout/Cargo.toml"
    printf 'version = 4\n' > "$checkout/Cargo.lock"
    {
        printf '#!/bin/bash\n'
        printf 'if [ "$1" = "-vV" ]; then\n'
        printf '  printf "cargo 1.0\\nhost: %s\\n"\n' "$host_target"
        printf '  exit 0\n'
        printf 'fi\n'
        printf 'printf "%%s\\n" "$*" > %q\n' "$args_file"
        printf 'target_dir=""\ntarget=""\n'
        printf 'while [ "$#" -gt 0 ]; do\n'
        printf '  case "$1" in\n'
        printf '    --target-dir) target_dir="$2"; shift 2 ;;\n'
        printf '    --target) target="$2"; shift 2 ;;\n'
        printf '    *) shift ;;\n'
        printf '  esac\n'
        printf 'done\n'
        printf '/usr/bin/mkdir -p "$target_dir/$target/release"\n'
        printf '/bin/cp /bin/true "$target_dir/$target/release/chatgpt-generated-app-mutation-broker"\n'
        printf '/bin/chmod 0700 "$target_dir/$target/release/chatgpt-generated-app-mutation-broker"\n'
    } > "$fake_bin/cargo"
    chmod 0700 "$fake_bin/cargo"

    mkdir -p "$checkout/target/release" "$root/ambient-target"
    make_executable "$checkout/target/release/chatgpt-generated-app-mutation-broker"

    unset CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE
    REPO_DIR="$checkout" SCRIPT_DIR="$checkout/scripts" \
    CARGO_TARGET_DIR="$root/ambient-target" PATH="$fake_bin:/usr/bin:/bin" \
        resolve_generated_app_mutation_broker
    resolved="$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
    assert_eq "$checkout/target/generated-app-mutation-broker/$host_target/release/chatgpt-generated-app-mutation-broker" "$resolved"
    assert_eq "build --locked --release -p generated-app-mutation-broker --target $host_target --target-dir $checkout/target/generated-app-mutation-broker" "$(< "$args_file")"
    [ "$resolved" != "$checkout/target/release/chatgpt-generated-app-mutation-broker" ] || \
        fail "resolver returned the stale repository-local artifact"
    [ ! -e "$root/ambient-target/$host_target/release/chatgpt-generated-app-mutation-broker" ] || \
        fail "resolver honored ambient CARGO_TARGET_DIR"
}

test_validates_absolute_regular_executable
test_rejects_wrong_elf_architecture
test_missing_cargo_fails_closed
test_prebuilt_override_avoids_cargo
test_source_build_is_locked_and_scoped
test_generation_digest_binds_package_helper
test_generation_digest_rejects_rebound_broker_path
test_patch_digest_receipt_validation_is_strict
test_installer_resolves_and_records_generation_broker
test_asar_patcher_uses_verified_private_root
printf 'Generated-app mutation broker resolver tests passed.\n'
