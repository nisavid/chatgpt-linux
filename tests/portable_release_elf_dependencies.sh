#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'portable release ELF dependency test failed: %s\n' "$*" >&2
  exit 1
}

fixture_root="$(mktemp -d)"
trap 'rm -rf -- "$fixture_root"' EXIT

mkdir -p "$fixture_root/bin" "$fixture_root/app/prebuilds/linux-x64"

cat > "$fixture_root/bin/file" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'ELF 64-bit LSB shared object, x86-64'
EOF

cat > "$fixture_root/bin/ldd" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *.musl.node)
    printf '%s\n' 'libc.musl-x86_64.so.1 => not found'
    ;;
  *broken.node)
    printf '%s\n' 'libfixture.so => not found'
    ;;
  *)
    printf '%s\n' 'libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6'
    ;;
esac
EOF
chmod 0755 "$fixture_root/bin/file" "$fixture_root/bin/ldd"

glibc_prebuild="$fixture_root/app/prebuilds/linux-x64/classic-level.node"
musl_prebuild="$fixture_root/app/prebuilds/linux-x64/classic-level.musl.node"
: > "$glibc_prebuild"
: > "$musl_prebuild"
: > "$fixture_root/app/prebuilds/linux-x64/node.napi.glibc.node"
: > "$fixture_root/app/prebuilds/linux-x64/node.napi.musl.node"

PATH="$fixture_root/bin:$PATH" \
  "$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" "$fixture_root/app"

rm -f "$glibc_prebuild"
if PATH="$fixture_root/bin:$PATH" \
    "$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" "$fixture_root/app"; then
  fail "musl prebuild without a glibc companion was accepted"
fi

rm -f "$musl_prebuild"
: > "$fixture_root/app/broken.node"
if PATH="$fixture_root/bin:$PATH" \
    "$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" "$fixture_root/app"; then
  fail "unresolved glibc ELF dependency was accepted"
fi

printf '%s\n' 'portable release ELF dependency tests passed'
