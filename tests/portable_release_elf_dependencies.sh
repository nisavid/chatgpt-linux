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

set +e
"$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" \
  >"$fixture_root/usage.stdout" 2>"$fixture_root/usage.stderr"
usage_status=$?
set -e
[ "$usage_status" -eq 64 ] || fail "zero arguments did not exit with usage status 64"
grep -Fq 'usage:' "$fixture_root/usage.stderr" || \
  fail "zero arguments did not print usage"

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

cat > "$fixture_root/bin/readelf" <<'EOF'
#!/usr/bin/env bash
case "${*: -1}" in
  *unreadable.node)
    exit 1
    ;;
  *too-new.node)
    printf '%s\n' '  0x0010:   Name: GLIBC_2.39  Flags: none  Version: 4'
    ;;
  *)
    printf '%s\n' '  0x0010:   Name: GLIBC_2.34  Flags: none  Version: 4'
    ;;
esac
EOF
chmod 0755 "$fixture_root/bin/file" "$fixture_root/bin/ldd" "$fixture_root/bin/readelf"

glibc_prebuild="$fixture_root/app/prebuilds/linux-x64/classic-level.node"
musl_prebuild="$fixture_root/app/prebuilds/linux-x64/classic-level.musl.node"
: > "$glibc_prebuild"
: > "$musl_prebuild"
: > "$fixture_root/app/prebuilds/linux-x64/node.napi.glibc.node"
: > "$fixture_root/app/prebuilds/linux-x64/node.napi.musl.node"

PATH="$fixture_root/bin:$PATH" \
  "$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" "$fixture_root/app"

: > "$fixture_root/app/too-new.node"
if PATH="$fixture_root/bin:$PATH" \
    "$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" --versions-only \
    "$fixture_root/app" >"$fixture_root/too-new.stdout" 2>"$fixture_root/too-new.stderr"; then
  fail "an ELF requiring glibc newer than Ubuntu 22.04 was accepted"
fi
grep -Fq 'requires GLIBC_2.39 beyond the supported GLIBC_2.35 baseline' \
  "$fixture_root/too-new.stderr" || \
  fail "the newer glibc requirement did not produce the baseline diagnostic"
rm -f "$fixture_root/app/too-new.node"

: > "$fixture_root/app/unreadable.node"
if PATH="$fixture_root/bin:$PATH" \
    "$REPO_DIR/scripts/ci/check-portable-elf-dependencies.sh" --versions-only \
    "$fixture_root/app" >"$fixture_root/unreadable.stdout" 2>"$fixture_root/unreadable.stderr"; then
  fail "an ELF whose version requirements could not be read was accepted"
fi
grep -Fq 'could not inspect ELF version requirements' \
  "$fixture_root/unreadable.stderr" || \
  fail "the unreadable ELF did not produce the fail-closed diagnostic"
rm -f "$fixture_root/app/unreadable.node"

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
