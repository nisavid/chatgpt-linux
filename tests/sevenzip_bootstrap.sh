#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/lib/sevenzip-bootstrap.sh
source "$REPO_DIR/scripts/lib/sevenzip-bootstrap.sh"

fail() {
    printf '%s\n' "[sevenzip-bootstrap][FAIL] $*" >&2
    exit 1
}

workspace="$(mktemp -d)"
trap 'rm -rf -- "$workspace"' EXIT

assert_pin() {
    local version="$1"
    local arch="$2"
    local expected="$3"
    local actual
    actual="$(chatgpt_sevenzip_expected_sha256 "$version" "$arch")" \
        || fail "missing pin for $version/$arch"
    [ "$actual" = "$expected" ] \
        || fail "unexpected pin for $version/$arch: $actual"
}

assert_pin 2600 x64 c74dc4a48492cde43f5fec10d53fb2a66f520e4a62a69d630c44cb22c477edc6
assert_pin 2600 arm64 aa8f3d0a19af9674d3af0ec788b4e261501071e626cd75ad149f1c2c176cc87d
assert_pin 2600 arm 54755c32564c5966ab6ddeca376472e1d146b3b76648184f6a7797a7fab3af52
member_sha256="$(chatgpt_sevenzip_expected_member_sha256 2600 x64)" \
    || fail "missing executable pin for 2600/x64"
[ "$member_sha256" = 57b73a4bf122b8d7e69c4c04a478f258b03f1515feebe1e70f190432710b3a3b ] \
    || fail "unexpected executable pin for 2600/x64"
if chatgpt_sevenzip_expected_sha256 9999 x64 >/dev/null 2>&1; then
    fail "an unpinned version was accepted"
fi
if chatgpt_sevenzip_expected_sha256 2600 unknown >/dev/null 2>&1; then
    fail "an unpinned architecture was accepted"
fi

mkdir -p "$workspace/source" "$workspace/extracted"
printf '%s\n' 'fixture 7zz bytes' > "$workspace/source/7zz"
tar -C "$workspace/source" -cJf "$workspace/valid.tar.xz" 7zz
valid_sha256="$(sha256sum "$workspace/valid.tar.xz")"
valid_sha256="${valid_sha256%% *}"

chatgpt_verify_sevenzip_archive_sha256 "$workspace/valid.tar.xz" "$valid_sha256" \
    || fail "matching archive digest was rejected"
if chatgpt_verify_sevenzip_archive_sha256 \
    "$workspace/valid.tar.xz" \
    0000000000000000000000000000000000000000000000000000000000000000; then
    fail "mismatched archive digest was accepted"
fi

chatgpt_validate_sevenzip_archive "$workspace/valid.tar.xz" \
    || fail "single regular 7zz member was rejected"
chatgpt_extract_sevenzip_archive "$workspace/valid.tar.xz" "$workspace/extracted" \
    || fail "verified archive extraction failed"
cmp "$workspace/source/7zz" "$workspace/extracted/7zz" \
    || fail "extracted 7zz bytes changed"
[ -f "$workspace/extracted/7zz" ] && [ ! -L "$workspace/extracted/7zz" ] \
    || fail "extracted 7zz is not a regular file"

mkdir -p "$workspace/symlink-source"
ln -s /bin/true "$workspace/symlink-source/7zz"
tar -C "$workspace/symlink-source" -cJf "$workspace/symlink.tar.xz" 7zz
if chatgpt_validate_sevenzip_archive "$workspace/symlink.tar.xz"; then
    fail "symlink 7zz member was accepted"
fi

tar -C "$workspace/source" -cJf "$workspace/duplicate.tar.xz" 7zz 7zz
if chatgpt_validate_sevenzip_archive "$workspace/duplicate.tar.xz"; then
    fail "duplicate 7zz members were accepted"
fi

install_deps="$REPO_DIR/scripts/install-deps.sh"
grep -Fq -- "curl --proto '=https' --proto-redir '=https' --tlsv1.2" "$install_deps" \
    || fail "7zz bootstrap does not restrict curl to HTTPS"
verify_line="$(grep -n -m 1 'chatgpt_verify_sevenzip_archive_sha256' "$install_deps")"
extract_line="$(grep -n -m 1 'chatgpt_extract_sevenzip_archive' "$install_deps")"
[ -n "$verify_line" ] && [ -n "$extract_line" ] \
    || fail "7zz bootstrap is not wired through integrity helpers"
[ "${verify_line%%:*}" -lt "${extract_line%%:*}" ] \
    || fail "7zz archive extraction occurs before digest verification"
member_verify_line="$(grep -n 'chatgpt_verify_sevenzip_archive_sha256.*expected_member_sha256' "$install_deps")"
install_line="$(grep -n -m 1 'install -m 755.*tmpdir/7zz' "$install_deps")"
[ -n "$member_verify_line" ] && [ -n "$install_line" ] \
    || fail "executable digest verification is not wired before installation"
[ "${member_verify_line%%:*}" -lt "${install_line%%:*}" ] \
    || fail "7zz installation occurs before executable digest verification"

printf '%s\n' "[sevenzip-bootstrap] all tests passed"
