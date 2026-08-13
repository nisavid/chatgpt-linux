#!/usr/bin/env bash
set -euo pipefail

versions_only=0
case "$#:${1-}" in
  1:*) ;;
  2:--versions-only)
    versions_only=1
    shift
    ;;
  *)
    printf 'usage: %s [--versions-only] APP_ROOT\n' "${0##*/}" >&2
    exit 64
    ;;
esac

for required_command in file readelf; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'portable release ELF dependency check requires %s\n' \
      "$required_command" >&2
    exit 1
  fi
done
if [ "$versions_only" -eq 0 ] && ! command -v ldd >/dev/null 2>&1; then
  printf 'portable release ELF dependency check requires ldd\n' >&2
  exit 1
fi

app_root="$1"
if [ ! -d "$app_root" ]; then
  printf 'portable release app root is missing: %s\n' "$app_root" >&2
  exit 1
fi

max_glibc_version="2.35"

version_is_newer() {
  local candidate="$1"
  local baseline="$2"
  local newest

  newest="$(printf '%s\n%s\n' "$candidate" "$baseline" | sort -V | tail -n 1)"
  [ "$candidate" != "$baseline" ] && [ "$newest" = "$candidate" ]
}

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

  if ! version_info="$(readelf --version-info "$binary" 2>/dev/null)"; then
    printf 'portable release app could not inspect ELF version requirements: %s\n' \
      "$binary" >&2
    exit 1
  fi

  while IFS= read -r required_glibc; do
    if version_is_newer "$required_glibc" "$max_glibc_version"; then
      printf 'portable release ELF %s requires GLIBC_%s beyond the supported GLIBC_%s baseline\n' \
        "$binary" "$required_glibc" "$max_glibc_version" >&2
      exit 1
    fi
  done < <(
    printf '%s\n' "$version_info" \
      | sed -n 's/.*Name: GLIBC_\([0-9][0-9.]*\).*/\1/p' \
      | sort -Vu
  )

  if [ "$versions_only" -eq 1 ]; then
    continue
  fi

  dependencies="$(ldd "$binary" 2>&1 || true)"
  if grep -E 'not found|version .* not found' <<< "$dependencies"; then
    printf 'portable release app has an unresolved ELF dependency: %s\n' "$binary" >&2
    exit 1
  fi
done < <(find "$app_root" -type f -print0)
