#!/bin/bash

patch_node_repl_elf_for_nix() {
    if [ "$#" -ne 3 ]; then
        echo "usage: patch_node_repl_elf_for_nix BINARY INTERPRETER RPATH" >&2
        return 2
    fi

    local binary="$1"
    local target_interpreter="$2"
    local target_rpath="$3"
    local magic
    local elf_header
    local program_headers
    local dynamic_section
    local entry_point
    local interpreter
    local actual_interpreter
    local actual_rpath

    if [ ! -f "$binary" ]; then
        echo "node_repl is not a regular file: $binary" >&2
        return 1
    fi
    if ! command -v patchelf >/dev/null 2>&1; then
        echo "patchelf is required to classify node_repl: $binary" >&2
        return 1
    fi
    if ! command -v readelf >/dev/null 2>&1; then
        echo "readelf is required to classify node_repl: $binary" >&2
        return 1
    fi

    magic="$(dd if="$binary" bs=1 count=4 2>/dev/null | od -An -tx1 | tr -d ' \n')"
    if [ "$magic" != "7f454c46" ]; then
        echo "node_repl is not ELF: $binary" >&2
        return 1
    fi

    if ! elf_header="$(LC_ALL=C readelf -hW "$binary" 2>/dev/null)"; then
        echo "could not parse node_repl ELF header: $binary" >&2
        return 1
    fi
    if ! program_headers="$(LC_ALL=C readelf -lW "$binary" 2>/dev/null)"; then
        echo "could not parse node_repl program headers: $binary" >&2
        return 1
    fi
    if ! dynamic_section="$(LC_ALL=C readelf -dW "$binary" 2>/dev/null)"; then
        echo "could not parse node_repl dynamic section: $binary" >&2
        return 1
    fi

    if ! printf '%s\n' "$program_headers" | grep -Eq '^[[:space:]]*INTERP[[:space:]]'; then
        entry_point="$(printf '%s\n' "$elf_header" | awk -F: '
            /Entry point address:/ {
                gsub(/[[:space:]]/, "", $2)
                print $2
                exit
            }
        ')"
        if printf '%s\n' "$elf_header" \
                | grep -Eq 'Type:[[:space:]]+DYN[[:space:]]+\(Position-Independent Executable file\)' \
            && [ -n "$entry_point" ] \
            && [ "$entry_point" != "0x0" ] \
            && printf '%s\n' "$dynamic_section" \
                | grep -Eq '\(FLAGS_1\).*Flags:.*[[:space:]]PIE([[:space:]]|$)' \
            && ! printf '%s\n' "$dynamic_section" \
                | grep -Eq '\((NEEDED|RPATH|RUNPATH)\)'; then
            return 0
        fi
        echo "node_repl is not a verified static PIE executable: $binary" >&2
        return 1
    fi

    if ! interpreter="$(patchelf --print-interpreter "$binary" 2>/dev/null)" \
        || [ -z "$interpreter" ]; then
        echo "could not read dynamic node_repl interpreter: $binary" >&2
        return 1
    fi

    if ! patchelf \
        --set-interpreter "$target_interpreter" \
        --set-rpath "$target_rpath" \
        "$binary"; then
        echo "could not patch dynamic node_repl for Nix: $binary" >&2
        return 1
    fi

    if ! actual_interpreter="$(patchelf --print-interpreter "$binary" 2>/dev/null)" \
        || [ "$actual_interpreter" != "$target_interpreter" ]; then
        echo "node_repl interpreter verification failed: $binary" >&2
        return 1
    fi
    if ! actual_rpath="$(patchelf --print-rpath "$binary" 2>/dev/null)" \
        || [ "$actual_rpath" != "$target_rpath" ]; then
        echo "node_repl RPATH verification failed: $binary" >&2
        return 1
    fi
}
