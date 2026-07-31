#!/usr/bin/env bash
set -Eeuo pipefail
set -f

home_dir="${HOME:-}"
[ -n "$home_dir" ] || exit 0

app_id="${CHATGPT_LINUX_APP_ID:-${CHATGPT_APP_ID:-chatgpt}}"
case "$app_id" in
    *[!A-Za-z0-9._-]*|'') exit 0 ;;
esac

data_home="${XDG_DATA_HOME:-$home_dir/.local/share}"
applications_dir="$data_home/applications"
icons_dir="$data_home/icons/hicolor/256x256/apps"
desktop_target="$applications_dir/$app_id.desktop"
selection_icon_target="$icons_dir/$app_id-dock-selection.png"
marker="X-ChatGPT-Linux-Dock-Icon=1"
icon_owner_marker="X-ChatGPT-Linux-Dock-Icon-Resource=1"
managed_icons=(
    "$icons_dir/$app_id-dock-chatgpt.png"
    "$icons_dir/$app_id-dock-codex-dark.png"
    "$icons_dir/$app_id-dock-codex-light.png"
    "$selection_icon_target"
)

refresh_desktop_database() {
    if [[ "${XDG_CURRENT_DESKTOP:-}" == *KDE* ]]; then
        command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 >/dev/null 2>&1 || true
    fi
}

managed_desktop_is_owned() {
    local icon_value

    [ -f "$desktop_target" ] && [ ! -L "$desktop_target" ] || return 1
    grep -qxF "$marker" "$desktop_target" || return 1
    icon_value="$(awk '/^Icon=/{sub(/^Icon=/, ""); print; exit}' "$desktop_target")"
    case "$icon_value" in
        "$icons_dir/$app_id-dock-chatgpt.png"|"$icons_dir/$app_id-dock-codex-dark.png"|"$icons_dir/$app_id-dock-codex-light.png") ;;
        *) return 1 ;;
    esac
}

managed_icon_is_owned() {
    local icon="$1"
    local owner_path="$icon.chatgpt-owned"

    [ -f "$icon" ] && [ ! -L "$icon" ] || return 1
    [ -f "$owner_path" ] && [ ! -L "$owner_path" ] || return 1
    grep -qxF "$icon_owner_marker" "$owner_path"
}

cleanup_managed_desktop() {
    local icon
    local changed=0

    if managed_desktop_is_owned; then
        if rm -f -- "$desktop_target"; then
            changed=1
        else
            echo "WARN: Could not remove managed Dock icon desktop entry: $desktop_target" >&2
        fi
    fi
    for icon in "${managed_icons[@]}"; do
        if managed_icon_is_owned "$icon"; then
            if ! rm -f -- "$icon"; then
                echo "WARN: Could not remove managed Dock icon resource: $icon" >&2
            else
                rm -f -- "$icon.chatgpt-owned"
                changed=1
            fi
        fi
    done
    [ "$changed" -eq 0 ] || refresh_desktop_database
}

hook_phase="${CHATGPT_PORT_INTEGRATION_HOOK_PHASE:-}"
if [ "$hook_phase" = "prelaunch" ]; then
    app_dir="${CHATGPT_LINUX_APP_DIR:-${1:-}}"
    [ -n "$app_dir" ] && [ -d "$app_dir" ] || exit 0
    payload_helper="$app_dir/resources/dock-icon/sync-desktop-icon.sh"
    if [ -f "$payload_helper" ] && [ ! -L "$payload_helper" ]; then
        exit 0
    fi
    cleanup_managed_desktop
    exit 0
fi

selection="${1:-}"
case "$selection" in
    chatgpt|codex-dark|codex-light) ;;
    *) exit 0 ;;
esac
icon_target="$icons_dir/$app_id-dock-$selection.png"

desktop_source_matches_identity() {
    local source="$1"
    local line
    local token
    local value

    [ "$(basename -- "$source")" = "$app_id.desktop" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            StartupWMClass=*) [ "${line#*=}" = "$app_id" ] || return 1 ;;
            X-GNOME-WMClass=*) [ "${line#*=}" = "$app_id" ] || return 1 ;;
            Exec=*)
                if [ "$app_id" != "chatgpt" ] && [[ "$line" != *"$app_id"* ]]; then
                    return 1
                fi
                ;;
        esac
        for token in $line; do
            case "$token" in
                CHROME_DESKTOP=*)
                    [ "${token#*=}" = "$app_id.desktop" ] || return 1
                    ;;
                BAMF_DESKTOP_FILE_HINT=*)
                    value="${token#*=}"
                    [ "$(basename -- "$value")" = "$app_id.desktop" ] || return 1
                    ;;
                CHATGPT_APP_ID=*|CHATGPT_LINUX_APP_ID=*)
                    [ "${token#*=}" = "$app_id" ] || return 1
                    ;;
            esac
        done
    done < "$source"
}

if [ -e "$desktop_target" ] || [ -L "$desktop_target" ]; then
    [ -f "$desktop_target" ] && [ ! -L "$desktop_target" ] || exit 0
    grep -qxF "$marker" "$desktop_target" || exit 0
fi

desktop_source="${CHATGPT_LINUX_DESKTOP_FILE_SOURCE:-}"
if [ -z "$desktop_source" ]; then
    data_dirs="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
    IFS=: read -r -a data_dirs_array <<< "$data_dirs"
    candidates=("${BAMF_DESKTOP_FILE_HINT:-}")
    for data_dir in "${data_dirs_array[@]}"; do
        [ -n "$data_dir" ] && candidates+=("$data_dir/applications/$app_id.desktop")
    done
    for candidate in "${candidates[@]}"; do
        if [ -n "$candidate" ] && [ "$candidate" != "$desktop_target" ] && [ -f "$candidate" ] && [ ! -L "$candidate" ] && desktop_source_matches_identity "$candidate"; then
            desktop_source="$candidate"
            break
        fi
    done
fi
[ -n "$desktop_source" ] && [ -f "$desktop_source" ] && [ ! -L "$desktop_source" ] || exit 0
grep -q '^Icon=' "$desktop_source" || exit 0
if ! desktop_source_matches_identity "$desktop_source"; then
    echo "WARN: Dock icon desktop source identity does not match app id '$app_id'; leaving launchers unchanged" >&2
    exit 0
fi

mkdir -p "$applications_dir" "$icons_dir"
owner_target="$icon_target.chatgpt-owned"
if [ -e "$icon_target" ] || [ -L "$icon_target" ] || [ -e "$owner_target" ] || [ -L "$owner_target" ]; then
    managed_icon_is_owned "$icon_target" || exit 0
fi
desktop_tmp="$(mktemp "$applications_dir/.$app_id.desktop.XXXXXX")"
icon_tmp="$(mktemp "$icons_dir/.$app_id-dock-selection.XXXXXX")"
owner_tmp="$(mktemp "$icons_dir/.$app_id-dock-owner.XXXXXX")"
trap 'rm -f -- "$desktop_tmp" "$icon_tmp" "$owner_tmp"' EXIT

cat > "$icon_tmp"
[ -s "$icon_tmp" ] || exit 0
chmod 0644 "$icon_tmp"
printf '%s\n' "$icon_owner_marker" > "$owner_tmp"
chmod 0644 "$owner_tmp"
awk -v icon="$icon_target" -v marker="$marker" '
    $0 == marker { next }
    /^Icon=/ && !icon_written { print "Icon=" icon; icon_written=1; next }
    /^\[/ && $0 != "[Desktop Entry]" && !marker_written { print marker; marker_written=1 }
    { print }
    END { if (icon_written && !marker_written) print marker }
' "$desktop_source" > "$desktop_tmp"
chmod 0644 "$desktop_tmp"

changed=0
if [ ! -f "$icon_target" ] || ! cmp -s "$icon_tmp" "$icon_target"; then
    if [ -e "$icon_target" ] || [ -L "$icon_target" ] || [ -e "$owner_target" ] || [ -L "$owner_target" ]; then
        managed_icon_is_owned "$icon_target" || exit 0
    fi
    mv -f -- "$icon_tmp" "$icon_target"
    changed=1
fi
if [ ! -f "$owner_target" ] || ! cmp -s "$owner_tmp" "$owner_target"; then
    if [ -e "$owner_target" ] || [ -L "$owner_target" ]; then
        managed_icon_is_owned "$icon_target" || exit 0
    fi
    mv -f -- "$owner_tmp" "$owner_target"
    changed=1
fi
if [ ! -f "$desktop_target" ] || ! cmp -s "$desktop_tmp" "$desktop_target"; then
    if [ -e "$desktop_target" ] || [ -L "$desktop_target" ]; then
        managed_desktop_is_owned || exit 0
    fi
    mv -f -- "$desktop_tmp" "$desktop_target"
    changed=1
fi
if managed_icon_is_owned "$selection_icon_target"; then
    rm -f -- "$selection_icon_target" "$selection_icon_target.chatgpt-owned"
fi

[ "$changed" -eq 0 ] || refresh_desktop_database
