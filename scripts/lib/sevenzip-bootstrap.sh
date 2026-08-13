#!/usr/bin/env bash

# Source-controlled identities for the exact vendor archives accepted by the
# dependency bootstrap. Adding a release requires reviewing both the archive
# and extracted executable digests for every supported architecture.
chatgpt_sevenzip_expected_sha256() {
    case "$1:$2" in
        2600:x64)   printf '%s\n' 'c74dc4a48492cde43f5fec10d53fb2a66f520e4a62a69d630c44cb22c477edc6' ;;
        2600:arm64) printf '%s\n' 'aa8f3d0a19af9674d3af0ec788b4e261501071e626cd75ad149f1c2c176cc87d' ;;
        2600:arm)   printf '%s\n' '54755c32564c5966ab6ddeca376472e1d146b3b76648184f6a7797a7fab3af52' ;;
        *) return 1 ;;
    esac
}

chatgpt_sevenzip_expected_member_sha256() {
    case "$1:$2" in
        2600:x64)   printf '%s\n' '57b73a4bf122b8d7e69c4c04a478f258b03f1515feebe1e70f190432710b3a3b' ;;
        2600:arm64) printf '%s\n' '4f1a8e6f24ebcef8797e1308f081ab8af60df263130220eeac2c635e83e9100b' ;;
        2600:arm)   printf '%s\n' '470ab54001a3ffb4fe1eb8e3765d5a1f39c2e79044153d4c2859fd21fb127762' ;;
        *) return 1 ;;
    esac
}

chatgpt_verify_sevenzip_archive_sha256() {
    local archive="$1"
    local expected="$2"
    local actual

    case "$expected" in
        *[!0-9a-f]*|'') return 1 ;;
    esac
    [ "${#expected}" -eq 64 ] || return 1
    actual="$(sha256sum -- "$archive")" || return 1
    actual="${actual%% *}"
    [ "$actual" = "$expected" ]
}

chatgpt_validate_sevenzip_archive() {
    local archive="$1"
    local member_count
    local member_listing

    member_count="$(
        tar -tf "$archive" -- 2>/dev/null \
            | awk '$0 == "7zz" { count += 1 } END { print count + 0 }'
    )" || return 1
    [ "$member_count" = 1 ] || return 1

    member_listing="$(LC_ALL=C tar -tvf "$archive" -- 7zz 2>/dev/null)" || return 1
    [ "${member_listing:0:1}" = '-' ]
}

chatgpt_extract_sevenzip_archive() {
    local archive="$1"
    local destination="$2"

    chatgpt_validate_sevenzip_archive "$archive" || return 1
    tar \
        --extract \
        --file "$archive" \
        --directory "$destination" \
        --no-same-owner \
        --no-same-permissions \
        -- 7zz \
        || return 1
    [ -f "$destination/7zz" ] && [ ! -L "$destination/7zz" ]
}
