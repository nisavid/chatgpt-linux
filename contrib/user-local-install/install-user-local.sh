#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILES_DIR="${SCRIPT_DIR}/files"
SCRIPT_REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_REPO_ROOT="${CHATGPT_USER_LOCAL_SOURCE_REPO_DIR:-$SCRIPT_REPO_ROOT}"
DESKTOP_ENTRY_DOCTOR="${SOURCE_REPO_ROOT}/packaging/linux/chatgpt-desktop-entry-doctor.sh"
XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
XDG_STATE_HOME="${XDG_STATE_HOME:-${HOME}/.local/state}"
INSTALL_ROOT="${CHATGPT_USER_INSTALL_ROOT:-${XDG_DATA_HOME}/chatgpt}"
APP_BIN_DIR="${INSTALL_ROOT}/bin"
APP_LIB_DIR="${INSTALL_ROOT}/lib"
USER_BIN_DIR="${HOME}/.local/bin"
CONFIG_DIR="${XDG_CONFIG_HOME}/chatgpt"
USER_LOCAL_ENV_FILE="${CONFIG_DIR}/user-local.env"
MANAGED_REPO_DIR="${INSTALL_ROOT}/managed-repo"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/chatgpt"
FROM_UPDATE=0
ENABLE_TIMER=0
USER_LOCAL_OZONE_PLATFORM_SETTING=""

# shellcheck disable=SC1090
. "$DESKTOP_ENTRY_DOCTOR"

while [ $# -gt 0 ]; do
    case "$1" in
        --from-update)
            FROM_UPDATE=1
            ;;
        --enable-timer)
            ENABLE_TIMER=1
            ;;
        --force-x11|--x11-fallback)
            USER_LOCAL_OZONE_PLATFORM_SETTING="x11"
            ;;
        --no-force-x11|--no-x11-fallback)
            USER_LOCAL_OZONE_PLATFORM_SETTING="auto"
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
    shift
done

copy_file() {
    local src="$1"
    local dst="$2"
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
}

write_user_local_preferences() {
    [ -n "$USER_LOCAL_OZONE_PLATFORM_SETTING" ] || return 0

    mkdir -p "$CONFIG_DIR"
    cat > "$USER_LOCAL_ENV_FILE" <<EOF
CHATGPT_USER_LOCAL_OZONE_PLATFORM=$(printf '%q' "$USER_LOCAL_OZONE_PLATFORM_SETTING")
EOF
}

repo_origin_url() {
    if [ -d "${SOURCE_REPO_ROOT}/.git" ]; then
        git -C "$SOURCE_REPO_ROOT" remote get-url origin 2>/dev/null || true
    fi
}

detected_repo_default_branch() {
    local branch=""
    if [ -d "${SOURCE_REPO_ROOT}/.git" ]; then
        branch="$(git -C "$SOURCE_REPO_ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
        branch="${branch#origin/}"
        if [ -z "$branch" ]; then
            branch="$(git -C "$SOURCE_REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
            if [ -n "$branch" ] && ! git -C "$SOURCE_REPO_ROOT" rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null; then
                branch=""
            fi
        fi
    fi
    printf '%s\n' "$branch"
}

install_manager_files() {
    local systemd_user_dir="${XDG_CONFIG_HOME}/systemd/user"
    mkdir -p "$APP_BIN_DIR" "$APP_LIB_DIR" "${XDG_DATA_HOME}/applications" "$USER_BIN_DIR" "$STATE_DIR" "$systemd_user_dir"

    copy_file "${FILES_DIR}/share/common.sh" "${APP_LIB_DIR}/common.sh"
    copy_file "${FILES_DIR}/.local/bin/chatgpt" "${APP_BIN_DIR}/chatgpt"
    copy_file "${FILES_DIR}/.local/bin/chatgpt-check-update" "${APP_BIN_DIR}/chatgpt-check-update"
    copy_file "${FILES_DIR}/.local/bin/chatgpt-update" "${APP_BIN_DIR}/chatgpt-update"
    copy_file "${FILES_DIR}/.local/bin/chatgpt-version" "${APP_BIN_DIR}/chatgpt-version"

    cat > "${USER_BIN_DIR}/chatgpt" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
INSTALL_ROOT="${CHATGPT_USER_INSTALL_ROOT:-${XDG_DATA_HOME}/chatgpt}"
exec "${INSTALL_ROOT}/bin/chatgpt" "$@"
EOF
    cat > "${USER_BIN_DIR}/chatgpt-check-update" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
INSTALL_ROOT="${CHATGPT_USER_INSTALL_ROOT:-${XDG_DATA_HOME}/chatgpt}"
exec "${INSTALL_ROOT}/bin/chatgpt-check-update" "$@"
EOF
    cat > "${USER_BIN_DIR}/chatgpt-update" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
INSTALL_ROOT="${CHATGPT_USER_INSTALL_ROOT:-${XDG_DATA_HOME}/chatgpt}"
exec "${INSTALL_ROOT}/bin/chatgpt-update" "$@"
EOF
    cat > "${USER_BIN_DIR}/chatgpt-version" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
INSTALL_ROOT="${CHATGPT_USER_INSTALL_ROOT:-${XDG_DATA_HOME}/chatgpt}"
exec "${INSTALL_ROOT}/bin/chatgpt-version" "$@"
EOF

    sed "s|@USER_BIN_DIR@|${USER_BIN_DIR}|g" "${FILES_DIR}/.local/share/applications/chatgpt.desktop" > "${XDG_DATA_HOME}/applications/chatgpt.desktop"

    copy_file "${FILES_DIR}/.config/systemd/user/chatgpt-update.service" "${systemd_user_dir}/chatgpt-update.service"
    copy_file "${FILES_DIR}/.config/systemd/user/chatgpt-update.timer" "${systemd_user_dir}/chatgpt-update.timer"

    cat > "${STATE_DIR}/install.env" <<EOF
REPO_DIR=$(printf '%q' "$SOURCE_REPO_ROOT")
SOURCE_REPO_DIR=$(printf '%q' "$SOURCE_REPO_ROOT")
MANAGED_REPO_DIR=$(printf '%q' "$MANAGED_REPO_DIR")
REPO_ORIGIN_URL=$(printf '%q' "$(repo_origin_url)")
REPO_DEFAULT_BRANCH=$(printf '%q' "$(detected_repo_default_branch)")
INSTALL_ROOT=$(printf '%q' "$INSTALL_ROOT")
XDG_DATA_HOME=$(printf '%q' "$XDG_DATA_HOME")
EOF

    chmod +x \
        "${APP_BIN_DIR}/chatgpt" \
        "${APP_BIN_DIR}/chatgpt-check-update" \
        "${APP_BIN_DIR}/chatgpt-update" \
        "${APP_BIN_DIR}/chatgpt-version" \
        "${APP_LIB_DIR}/common.sh" \
        "${USER_BIN_DIR}/chatgpt" \
        "${USER_BIN_DIR}/chatgpt-check-update" \
        "${USER_BIN_DIR}/chatgpt-update" \
        "${USER_BIN_DIR}/chatgpt-version"
}

install_manager_files
write_user_local_preferences

if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if [ "$ENABLE_TIMER" -eq 1 ]; then
        systemctl --user enable --now chatgpt-update.timer >/dev/null 2>&1 || true
    fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${XDG_DATA_HOME}/applications" >/dev/null 2>&1 || true
fi

if [ "$FROM_UPDATE" -eq 0 ] && [ -x "${USER_BIN_DIR}/chatgpt-update" ]; then
    "${USER_BIN_DIR}/chatgpt-update" --record-only >/dev/null 2>&1 || true
fi

if [ "$FROM_UPDATE" -eq 0 ]; then
    echo "Installed user-local ChatGPT for Linux integration."
fi
