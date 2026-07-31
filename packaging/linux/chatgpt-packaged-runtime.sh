#!/bin/bash

chatgpt_packaged_runtime_prelaunch() {
    chatgpt_packaged_runtime_prelaunch_background >/dev/null 2>&1 &
}

chatgpt_packaged_runtime_prelaunch_background() {
    if [ "__CHATGPT_PACKAGE_ENABLE_UPDATER__" != "1" ]; then
        return 0
    fi

    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi

    if [ -z "${XDG_RUNTIME_DIR:-}" ] || [ ! -d "$XDG_RUNTIME_DIR" ]; then
        return 0
    fi

    if ! systemctl --user show-environment >/dev/null 2>&1; then
        return 0
    fi

    systemctl --user import-environment \
        DISPLAY \
        WAYLAND_DISPLAY \
        DBUS_SESSION_BUS_ADDRESS \
        XAUTHORITY \
        XDG_RUNTIME_DIR \
        HYPRLAND_INSTANCE_SIGNATURE \
        YDOTOOL_SOCKET >/dev/null 2>&1 || true

    if command -v dbus-update-activation-environment >/dev/null 2>&1; then
        dbus-update-activation-environment --systemd \
            DISPLAY \
            WAYLAND_DISPLAY \
            DBUS_SESSION_BUS_ADDRESS \
            XAUTHORITY \
            XDG_RUNTIME_DIR \
            HYPRLAND_INSTANCE_SIGNATURE \
            YDOTOOL_SOCKET >/dev/null 2>&1 || true
    fi

    systemctl --user disable --now codex-app-updater.service >/dev/null 2>&1 || true
    systemctl --user disable --now codex-update-manager.service >/dev/null 2>&1 || true

    if ! systemctl --user is-enabled chatgpt-updater.service >/dev/null 2>&1; then
        return 0
    fi

    systemctl --user start chatgpt-updater.service >/dev/null 2>&1 || true
    chatgpt_packaged_runtime_trigger_update_check
}

chatgpt_packaged_runtime_trigger_update_check() {
    if ! command -v chatgpt-updater >/dev/null 2>&1; then
        return 0
    fi

    if command -v systemd-run >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
        systemd-run --user \
            --unit=chatgpt-updater-launch-check \
            --collect \
            --quiet \
            /usr/bin/chatgpt-updater check-now --if-stale >/dev/null 2>&1 || true
        return 0
    fi

    chatgpt-updater check-now --if-stale >/dev/null 2>&1 || true
}

chatgpt_packaged_runtime_export_env() {
    export CHATGPT_PACKAGE_HAS_UPDATER="__CHATGPT_PACKAGE_ENABLE_UPDATER__"
    export CHROME_DESKTOP="chatgpt.desktop"
    export BAMF_DESKTOP_FILE_HINT="/usr/share/applications/chatgpt.desktop"
}
