#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(realpath -- "${BASH_SOURCE[0]}")"
REPO_DIR="${SCRIPT_PATH%/*/*}"
TEST_TMP="$(mktemp -d)"

cleanup() {
    rm -rf "$TEST_TMP"
}
trap cleanup EXIT

fail() {
    printf 'updater reproducibility test failed: %s\n' "$*" >&2
    exit 1
}

copy_workspace() {
    local destination="$1"
    local member
    mkdir -p "$destination"
    cp "$REPO_DIR/Cargo.toml" "$REPO_DIR/Cargo.lock" "$destination/"
    for member in \
        generated-app-mutation-broker \
        computer-use-linux \
        notification-actions-linux \
        read-aloud-linux \
        updater \
        record-replay-linux; do
        cp -a "$REPO_DIR/$member" "$destination/$member"
    done
}

build_updater() {
    local source_root="$1"
    local target_root="$2"
    (
        cd "$source_root"
        env \
            -u CARGO_BUILD_RUSTC \
            -u RUSTC \
            -u RUSTC_WRAPPER \
            -u RUSTFLAGS \
            CARGO_NET_OFFLINE=true \
            CARGO_TARGET_DIR="$target_root" \
            cargo build --locked --release -p chatgpt-updater
    )
}

main() {
    local source_a="$TEST_TMP/source-a"
    local source_b="$TEST_TMP/different-source-b"
    local target_a="$TEST_TMP/target-a"
    local target_b="$TEST_TMP/different-target-b"
    local binary_a="$target_a/release/chatgpt-updater"
    local binary_b="$target_b/release/chatgpt-updater"

    copy_workspace "$source_a"
    copy_workspace "$source_b"
    build_updater "$source_a" "$target_a"
    build_updater "$source_b" "$target_b"

    cmp -s "$binary_a" "$binary_b" || \
        fail "independent absolute source roots produced different updater bytes"
    if LC_ALL=C grep -aFq "$source_a" "$binary_a"; then
        fail "updater binary embeds the first absolute source root"
    fi
    if LC_ALL=C grep -aFq "$source_b" "$binary_b"; then
        fail "updater binary embeds the second absolute source root"
    fi

    printf 'updater reproducibility tests passed\n'
}

main "$@"
