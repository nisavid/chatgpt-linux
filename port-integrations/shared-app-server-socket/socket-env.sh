#!/usr/bin/env bash
set -eu

runtime_enabled="${CODEX_PORT_SHARED_APP_SERVER_SOCKET_ENABLED:-${CODEX_LINUX_SHARED_APP_SERVER_SOCKET_ENABLED:-0}}"
case "$runtime_enabled" in
    1|true|TRUE|yes|YES|on|ON) ;;
    *)
        if [ -z "${CODEX_LINUX_APP_SERVER_BRIDGE_SOCKET:-}" ]; then
            exit 0
        fi
        ;;
esac

runtime_root="${XDG_RUNTIME_DIR:-${CODEX_LINUX_APP_STATE_DIR:?}}"
runtime_dir="$runtime_root/${CODEX_LINUX_APP_ID:-codex-app}/app-server-bridge"
socket_path="${CODEX_LINUX_APP_SERVER_BRIDGE_SOCKET:-$runtime_dir/app-server.sock}"
printf 'env CODEX_LINUX_APP_SERVER_BRIDGE_SOCKET=%s\n' "$socket_path"
