#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s APP_ROOT\n' "${0##*/}" >&2
  exit 64
fi

app_root="$1"
if [ ! -d "$app_root" ]; then
  printf 'portable release app root is missing: %s\n' "$app_root" >&2
  exit 1
fi

while IFS= read -r -d '' binary; do
  if ! file -b "$binary" | grep -Fq ELF; then
    continue
  fi

  case "$binary" in
    *.musl.node)
      prebuild_stem="${binary%.musl.node}"
      glibc_companion=""
      for candidate in "$prebuild_stem.glibc.node" "$prebuild_stem.node"; do
        if [ -f "$candidate" ] && [ ! -L "$candidate" ]; then
          glibc_companion="$candidate"
          break
        fi
      done
      if [ -z "$glibc_companion" ]; then
        printf 'portable release app has a musl prebuild without a regular glibc companion: %s\n' \
          "$binary" >&2
        exit 1
      fi
      continue
      ;;
  esac

  dependencies="$(ldd "$binary" 2>&1 || true)"
  if grep -E 'not found|version .* not found' <<< "$dependencies"; then
    printf 'portable release app has an unresolved ELF dependency: %s\n' "$binary" >&2
    exit 1
  fi
done < <(find "$app_root" -type f -print0)
