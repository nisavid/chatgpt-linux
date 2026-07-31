#!/bin/sh

SERVICE_NAME="${SERVICE_NAME:-chatgpt-updater.service}"
LEGACY_SERVICE_NAMES="codex-app-updater.service codex-update-manager.service"

chatgpt_foreach_user_manager() {
    if ! command -v runuser >/dev/null 2>&1 || ! command -v systemctl >/dev/null 2>&1; then
        return
    fi

    for runtime_dir in /run/user/*; do
        [ -d "$runtime_dir" ] || continue

        uid="$(basename "$runtime_dir")"
        case "$uid" in
            ''|*[!0-9]*|0)
                continue
                ;;
        esac

        bus="$runtime_dir/bus"
        [ -S "$bus" ] || continue

        user_name="$(getent passwd "$uid" | cut -d: -f1 || true)"
        [ -n "$user_name" ] || continue

        "$@" "$user_name" "$runtime_dir" "$bus"
    done
}

chatgpt_run_systemctl_user() {
    user_name="$1"
    runtime_dir="$2"
    bus="$3"
    shift 3

    runuser -u "$user_name" -- env \
        XDG_RUNTIME_DIR="$runtime_dir" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
        systemctl --user "$@" >/dev/null 2>&1
}

chatgpt_reload_user_managers() {
    chatgpt_foreach_user_manager chatgpt_reload_one_user_manager
}

chatgpt_reload_one_user_manager() {
    chatgpt_run_systemctl_user "$1" "$2" "$3" daemon-reload || true
}

chatgpt_ensure_user_service_running() {
    chatgpt_foreach_user_manager chatgpt_ensure_one_user_service_running
}

chatgpt_start_enabled_user_service() {
    chatgpt_foreach_user_manager chatgpt_start_one_enabled_user_service
}

chatgpt_ensure_one_user_service_running() {
    user_name="$1"
    runtime_dir="$2"
    bus="$3"

    chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" daemon-reload || true
    if chatgpt_migrate_one_user_service "$user_name" "$runtime_dir" "$bus"; then
        return
    fi

    if chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" is-active "$SERVICE_NAME"; then
        return
    fi

    if chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" is-enabled "$SERVICE_NAME"; then
        chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" start "$SERVICE_NAME" || true
    else
        chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" enable --now "$SERVICE_NAME" || true
    fi
}

chatgpt_migrate_one_user_service() {
    user_name="$1"
    runtime_dir="$2"
    bus="$3"

    for legacy_service_name in $LEGACY_SERVICE_NAMES; do
        if chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" \
            is-enabled "$legacy_service_name"; then
            chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" \
                disable --now "$legacy_service_name" || true
            chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" \
                enable --now "$SERVICE_NAME" || true
            return 0
        fi
    done

    return 1
}

chatgpt_start_one_enabled_user_service() {
    user_name="$1"
    runtime_dir="$2"
    bus="$3"

    chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" daemon-reload || true
    if chatgpt_migrate_one_user_service "$user_name" "$runtime_dir" "$bus"; then
        return
    fi

    if chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" is-active "$SERVICE_NAME"; then
        return
    fi

    if chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" is-enabled "$SERVICE_NAME"; then
        chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" start "$SERVICE_NAME" || true
    fi
}

chatgpt_cleanup_user_service() {
    action="$1"
    chatgpt_foreach_user_manager chatgpt_cleanup_one_user_service "$action"
}

chatgpt_cleanup_one_user_service() {
    action="$1"
    user_name="$2"
    runtime_dir="$3"
    bus="$4"

    chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" "$action" "$SERVICE_NAME" || true
    chatgpt_run_systemctl_user "$user_name" "$runtime_dir" "$bus" daemon-reload || true
}
