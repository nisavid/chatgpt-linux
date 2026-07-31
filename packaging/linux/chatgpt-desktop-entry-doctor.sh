#!/bin/sh

chatgpt_refresh_desktop_database() {
    chatgpt_db_dir="${1:-}"
    [ -n "$chatgpt_db_dir" ] || return 0

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$chatgpt_db_dir" >/dev/null 2>&1 || true
    fi
}

chatgpt_write_user_local_entry() {
    chatgpt_template_path="${1:?missing desktop template path}"
    chatgpt_target_path="${2:?missing desktop target path}"
    chatgpt_home_dir="${3:?missing home directory}"
    chatgpt_home_dir_escaped="$(printf '%s' "$chatgpt_home_dir" | sed 's/[&|\\]/\\&/g')"

    mkdir -p "$(dirname "$chatgpt_target_path")"
    sed "s|@HOME@|${chatgpt_home_dir_escaped}|g" \
        "$chatgpt_template_path" > "$chatgpt_target_path"
    chmod 0644 "$chatgpt_target_path"
    chatgpt_refresh_desktop_database "$(dirname "$chatgpt_target_path")"
}

chatgpt_entry_has_sidebar_mime() {
    grep -Eq '^MimeType=.*x-scheme-handler/codex-browser-sidebar([;]|$)' "$1"
}

chatgpt_entry_has_new_window_action() {
    grep -Eq '^Actions=.*new-window([;]|$)' "$1" &&
        grep -Eq '^\[Desktop Action new-window\]$' "$1"
}

chatgpt_entry_is_legacy_generated() {
    chatgpt_file="${1:?missing desktop entry path}"
    [ -f "$chatgpt_file" ] || return 1
    grep -Fxq 'X-ChatGPT-Linux-Managed=true' "$chatgpt_file" || return 1

    grep -Eq '^Name=(ChatGPT|Codex App|Codex Desktop)$' "$chatgpt_file" || return 1
    grep -Eq '(^Exec=.*(chatgpt|codex-(app|desktop))|^TryExec=.*(chatgpt|codex-(app|desktop))|^Icon=(chatgpt|codex-(app|desktop))$)' \
        "$chatgpt_file" || return 1

    if grep -Eq 'codex-(app|desktop)-open-next|^Actions=NewWindow([;]|$)|^\[Desktop Action NewWindow\]$|^Actions=NewInstance([;]|$)|^\[Desktop Action NewInstance\]$' \
        "$chatgpt_file"; then
        return 0
    fi

    if ! chatgpt_entry_has_sidebar_mime "$chatgpt_file"; then
        return 0
    fi

    if ! chatgpt_entry_has_new_window_action "$chatgpt_file"; then
        return 0
    fi

    return 1
}

chatgpt_next_backup_path() {
    chatgpt_backup_target="${1:?missing desktop entry path}.bak"
    chatgpt_backup_index=0

    while [ -e "$chatgpt_backup_target" ]; do
        chatgpt_backup_index=$((chatgpt_backup_index + 1))
        chatgpt_backup_target="${1}.bak.${chatgpt_backup_index}"
    done

    printf '%s\n' "$chatgpt_backup_target"
}

chatgpt_repair_shadow_entry() {
    chatgpt_target_path="${1:?missing desktop entry path}"
    chatgpt_backup_target=""

    if ! chatgpt_entry_is_legacy_generated "$chatgpt_target_path"; then
        return 1
    fi

    chatgpt_backup_target="$(chatgpt_next_backup_path "$chatgpt_target_path")"
    mv "$chatgpt_target_path" "$chatgpt_backup_target"
    chatgpt_refresh_desktop_database "$(dirname "$chatgpt_target_path")"
}

chatgpt_repair_system_package_shadow_entries() {
    chatgpt_package_name="${1:-chatgpt}"
    chatgpt_target_file="${chatgpt_package_name}.desktop"

    if ! command -v runuser >/dev/null 2>&1 || ! command -v getent >/dev/null 2>&1; then
        return 0
    fi

    for chatgpt_runtime_dir in /run/user/*; do
        [ -d "$chatgpt_runtime_dir" ] || continue

        chatgpt_uid="$(basename "$chatgpt_runtime_dir")"
        case "$chatgpt_uid" in
            ''|*[!0-9]*|0)
                continue
                ;;
        esac

        chatgpt_passwd_entry="$(getent passwd "$chatgpt_uid" || true)"
        [ -n "$chatgpt_passwd_entry" ] || continue

        chatgpt_user_name="$(printf '%s\n' "$chatgpt_passwd_entry" | cut -d: -f1)"
        chatgpt_home_dir="$(printf '%s\n' "$chatgpt_passwd_entry" | cut -d: -f6)"
        [ -n "$chatgpt_user_name" ] || continue
        [ -n "$chatgpt_home_dir" ] || continue
        [ "$chatgpt_home_dir" != "/" ] || continue

        chatgpt_user_entry="$chatgpt_home_dir/.local/share/applications/$chatgpt_target_file"
        if ! chatgpt_entry_is_legacy_generated "$chatgpt_user_entry"; then
            continue
        fi

        chatgpt_backup_target="$(chatgpt_next_backup_path "$chatgpt_user_entry")"
        runuser -u "$chatgpt_user_name" -- mv \
            "$chatgpt_user_entry" "$chatgpt_backup_target" >/dev/null 2>&1 || true
        runuser -u "$chatgpt_user_name" -- sh -c '
            if command -v update-desktop-database >/dev/null 2>&1; then
                update-desktop-database "$1" >/dev/null 2>&1 || true
            fi
        ' sh "$chatgpt_home_dir/.local/share/applications" >/dev/null 2>&1 || true
    done
}
