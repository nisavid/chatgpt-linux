#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
APP_DIR="$TMP_DIR/app"
HOME_DIR="$TMP_DIR/home"
RUNTIME_DIR="$TMP_DIR/runtime"
STATE_DIR="$HOME_DIR/.local/state/chatgpt"
SOCKET_PATH="$RUNTIME_DIR/chatgpt/launch-action.sock"
COMPUTER_USE_AUTHORITY_SOCKET="$RUNTIME_DIR/chatgpt/computer-use-authority.sock"
COMPUTER_USE_CURSOR_SOCKET="$RUNTIME_DIR/chatgpt/computer-use-cursor.sock"
FIRST_LOG="$TMP_DIR/first-launch.log"
SECOND_LOG="$TMP_DIR/second-launch.log"
APP_LOG="$HOME_DIR/.cache/chatgpt/launcher.log"
LAUNCHER_PID=""
SOCKET_PID=""
COMPUTER_USE_SOCKET_PID=""
HOOK_PID=""

cleanup() {
    local pid
    if [ -f "$STATE_DIR/app.pid" ]; then
        pid="$(cat "$STATE_DIR/app.pid" 2>/dev/null || true)"
        [ -z "$pid" ] || kill "$pid" 2>/dev/null || true
    fi
    [ -z "$LAUNCHER_PID" ] || kill "$LAUNCHER_PID" 2>/dev/null || true
    [ -z "$SOCKET_PID" ] || kill "$SOCKET_PID" 2>/dev/null || true
    [ -z "$COMPUTER_USE_SOCKET_PID" ] || kill "$COMPUTER_USE_SOCKET_PID" 2>/dev/null || true
    [ -z "$HOOK_PID" ] || kill "$HOOK_PID" 2>/dev/null || true
    for cmdline in /proc/[0-9]*/cmdline; do
        [ -r "$cmdline" ] || continue
        pid="${cmdline#/proc/}"
        pid="${pid%/cmdline}"
        IFS= read -r -d '' arg0 < "$cmdline" 2>/dev/null || true
        if [ "${arg0:-}" = "$APP_DIR/electron" ]; then
            kill "$pid" 2>/dev/null || true
        fi
        arg0=""
    done
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
    printf 'launcher warm-start recovery test failed: %s\n' "$*" >&2
    printf '%s\n' '--- first launch ---' >&2
    sed -n '1,240p' "$FIRST_LOG" >&2 2>/dev/null || true
    printf '%s\n' '--- second launch ---' >&2
    sed -n '1,280p' "$SECOND_LOG" >&2 2>/dev/null || true
    printf '%s\n' '--- app launcher log ---' >&2
    sed -n '1,360p' "$APP_LOG" >&2 2>/dev/null || true
    exit 1
}

wait_for() {
    local description="$1"
    shift
    local attempt
    for attempt in $(seq 1 100); do
        "$@" && return 0
        sleep 0.05
    done
    fail "timed out waiting for $description"
}

read_live_app_pid() {
    local pid
    pid="$(cat "$STATE_DIR/app.pid" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    printf '%s\n' "$pid"
}

pid_file_is_live() {
    read_live_app_pid >/dev/null
}

webview_is_ready() {
    curl --disable --noproxy 127.0.0.1,localhost --silent --fail --max-time 0.2 \
        "http://127.0.0.1:$PORT/index.html" | grep -q 'startup-loader'
}

webview_is_down() {
    ! curl --disable --noproxy 127.0.0.1,localhost --silent --fail --max-time 0.2 \
        "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1
}

mkdir -p \
    "$APP_DIR/.chatgpt-linux/cold-start.d" \
    "$APP_DIR/.chatgpt-linux/env.d" \
    "$APP_DIR/.chatgpt-linux/port-integrations" \
    "$APP_DIR/.chatgpt-linux/prelaunch.d" \
    "$APP_DIR/.chatgpt-linux/electron-args.d" \
    "$APP_DIR/.chatgpt-linux/launcher.d" \
    "$APP_DIR/.chatgpt-linux/after-exit.d" \
    "$APP_DIR/content/webview" \
    "$APP_DIR/resources/node-runtime/bin" \
    "$HOME_DIR/.config/chatgpt" \
    "$HOME_DIR" \
    "$RUNTIME_DIR/chatgpt"
chmod 700 "$RUNTIME_DIR" "$RUNTIME_DIR/chatgpt"

if [ "${CHATGPT_TEST_DISABLE_PIDFD:-0}" = "1" ]; then
    mkdir -p "$TMP_DIR/python-site"
    cat > "$TMP_DIR/python-site/sitecustomize.py" <<'PY'
import os
import signal

for module, attribute in (
    (os, "pidfd_open"),
    (signal, "pidfd_send_signal"),
):
    if hasattr(module, attribute):
        delattr(module, attribute)
PY
fi

if [ "${CHATGPT_TEST_DISABLE_WARM_START:-0}" = "1" ]; then
    printf '%s\n' '{"chatgpt-linux-warm-start-enabled":false}' \
        > "$HOME_DIR/.config/chatgpt/settings.json"
fi

PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"

{
    printf '%s\n' \
        '#!/usr/bin/env bash' \
        'set -Eeuo pipefail' \
        'CHATGPT_LINUX_APP_ID=chatgpt' \
        'CHATGPT_LINUX_APP_DISPLAY_NAME="ChatGPT"' \
        'CHATGPT_LINUX_WEBVIEW_PORT="${CHATGPT_WEBVIEW_PORT:-5175}"'
    cat "$REPO_DIR/launcher/start.sh.template"
} > "$APP_DIR/start.sh"
chmod +x "$APP_DIR/start.sh"
cp "$REPO_DIR/launcher/webview-server.py" "$APP_DIR/.chatgpt-linux/webview-server.py"
cp "$REPO_DIR/launcher/cli-launch-path.py" "$APP_DIR/.chatgpt-linux/cli-launch-path.py"
cp "$REPO_DIR/launcher/state-migration.py" "$APP_DIR/.chatgpt-linux/state-migration.py"
chmod 0755 "$APP_DIR/.chatgpt-linux/state-migration.py"
ln -s "$(command -v node)" "$APP_DIR/resources/node-runtime/bin/node"
printf '%s\n' '<!doctype html><title>Codex</title><div id="startup-loader"></div>' \
    > "$APP_DIR/content/webview/index.html"
(
    cd "$APP_DIR/content/webview"
    sha256sum index.html > "$APP_DIR/.chatgpt-linux/webview-integrity.sha256"
)

g++ -x c++ -O2 -o "$APP_DIR/electron" - <<'CPP'
#include <csignal>
#include <unistd.h>

static volatile sig_atomic_t running = 1;
static void stop(int) { running = 0; }

int main() {
    std::signal(SIGTERM, stop);
    std::signal(SIGINT, stop);
    while (running) pause();
    return 0;
}
CPP

if [ "${CHATGPT_TEST_KILL_DURING_PRELAUNCH:-0}" = "1" ]; then
    cat > "$APP_DIR/.chatgpt-linux/prelaunch.d/blocking-test-hook" <<'HOOK'
#!/usr/bin/env bash
printf '%s\n' "$$" > "$CHATGPT_TEST_HOOK_PID_FILE"
exec sleep 30
HOOK
    chmod +x "$APP_DIR/.chatgpt-linux/prelaunch.d/blocking-test-hook"
fi

python3 - "$SOCKET_PATH" <<'PY' &
import os
import socket
import sys

path = sys.argv[1]
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    os.unlink(path)
except FileNotFoundError:
    pass
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
    server.bind(path)
    server.listen()
    while True:
        client, _ = server.accept()
        with client:
            client.recv(65536)
            client.sendall(b"ok\n")
PY
SOCKET_PID=$!
wait_for "launch-action socket" test -S "$SOCKET_PATH"

python3 - "$COMPUTER_USE_AUTHORITY_SOCKET" <<'PY'
import os
import socket
import sys

for path in sys.argv[1:]:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(path)
    os.chmod(path, 0o600)
PY

if [ "${CHATGPT_TEST_UNTRUSTED_COMPUTER_USE_ENDPOINT:-0}" = "1" ]; then
    printf '%s\n' "do not remove" > "$COMPUTER_USE_CURSOR_SOCKET"
    chmod 600 "$COMPUTER_USE_CURSOR_SOCKET"
elif [ "${CHATGPT_TEST_LIVE_COMPUTER_USE_SOCKET:-0}" = "1" ]; then
    python3 - "$COMPUTER_USE_CURSOR_SOCKET" <<'PY' &
import os
import socket
import sys

path = sys.argv[1]
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
    server.bind(path)
    os.chmod(path, 0o600)
    server.listen()
    while True:
        client, _ = server.accept()
        client.close()
PY
    COMPUTER_USE_SOCKET_PID=$!
    wait_for "live Computer Use cursor socket" test -S "$COMPUTER_USE_CURSOR_SOCKET"
else
    python3 - "$COMPUTER_USE_CURSOR_SOCKET" <<'PY'
import os
import socket
import sys

path = sys.argv[1]
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
    server.bind(path)
os.chmod(path, 0o600)
PY
fi

COMMON_ENV=(
    env -i
    "PATH=$PATH"
    "HOME=$HOME_DIR"
    "XDG_RUNTIME_DIR=$RUNTIME_DIR"
    "CODEX_CLI_PATH=$(command -v true)"
    "CHATGPT_WEBVIEW_PORT=$PORT"
    "CHATGPT_TEST_HOOK_PID_FILE=$TMP_DIR/hook.pid"
)
if [ "${CHATGPT_TEST_DISABLE_PIDFD:-0}" = "1" ]; then
    COMMON_ENV+=("PYTHONPATH=$TMP_DIR/python-site")
fi

"${COMMON_ENV[@]}" "$APP_DIR/start.sh" > "$FIRST_LOG" 2>&1 &
LAUNCHER_PID=$!

if [ "${CHATGPT_TEST_KILL_DURING_PRELAUNCH:-0}" = "1" ]; then
    wait_for "blocking prelaunch hook" test -s "$TMP_DIR/hook.pid"
    HOOK_PID="$(cat "$TMP_DIR/hook.pid")"
    kill -KILL "$LAUNCHER_PID"
    wait "$LAUNCHER_PID" 2>/dev/null || true
    LAUNCHER_PID=""
    rm -f "$APP_DIR/.chatgpt-linux/prelaunch.d/blocking-test-hook"

    SECONDS=0
    "${COMMON_ENV[@]}" "$APP_DIR/start.sh" > "$SECOND_LOG" 2>&1 &
    LAUNCHER_PID=$!
    replacement_is_ready() {
        pid_file_is_live && webview_is_ready
    }
    wait_for "replacement launch after parent-death lock release" replacement_is_ready
    [ "$SECONDS" -lt 5 ] || fail "replacement launcher waited for the stale lock timeout"

    SECOND_ELECTRON_PID="$(read_live_app_pid)"
    kill "$SECOND_ELECTRON_PID"
    wait "$LAUNCHER_PID"
    LAUNCHER_PID=""
    kill "$HOOK_PID" 2>/dev/null || true
    HOOK_PID=""
    printf '%s\n' "launcher parent-death lock release test passed"
    exit 0
fi

wait_for "first Electron" pid_file_is_live
wait_for "first launcher lock release" grep -q "electron_spawned" "$APP_LOG"
wait_for "first packaged webview" webview_is_ready
FIRST_ELECTRON_PID="$(read_live_app_pid)"

if [ "${CHATGPT_TEST_NORMAL_LOCK_ONLY:-0}" = "1" ]; then
    flock -n "$STATE_DIR/launcher.lock" true \
        || fail "launcher lock should be released after app.pid publication"
    if grep -q "launcher lock helper did not exit" "$FIRST_LOG"; then
        fail "normal launcher lock release should not require pidfd escalation"
    fi
    [ ! -e "$COMPUTER_USE_AUTHORITY_SOCKET" ] \
        || fail "cold start did not remove the stale Computer Use authority socket"
    grep -q "Removed stale Computer Use socket: computer-use-authority.sock" "$APP_LOG" \
        || fail "launcher did not report stale Computer Use authority socket recovery"
    if [ "${CHATGPT_TEST_UNTRUSTED_COMPUTER_USE_ENDPOINT:-0}" = "1" ]; then
        [ -f "$COMPUTER_USE_CURSOR_SOCKET" ] \
            || fail "cold start removed an untrusted Computer Use endpoint"
        grep -q "preserving untrusted Computer Use endpoint: computer-use-cursor.sock" "$APP_LOG" \
            || fail "launcher did not report preserving the untrusted Computer Use endpoint"
    elif [ "${CHATGPT_TEST_LIVE_COMPUTER_USE_SOCKET:-0}" = "1" ]; then
        [ -S "$COMPUTER_USE_CURSOR_SOCKET" ] \
            || fail "cold start removed an active Computer Use cursor socket"
        grep -q "Preserving active Computer Use socket: computer-use-cursor.sock" "$APP_LOG" \
            || fail "launcher did not report preserving the active Computer Use cursor socket"
    else
        [ ! -e "$COMPUTER_USE_CURSOR_SOCKET" ] \
            || fail "cold start did not remove the stale Computer Use cursor socket"
        grep -q "Removed stale Computer Use socket: computer-use-cursor.sock" "$APP_LOG" \
            || fail "launcher did not report stale Computer Use cursor socket recovery"
    fi
    kill "$FIRST_ELECTRON_PID"
    wait "$LAUNCHER_PID"
    LAUNCHER_PID=""
    printf '%s\n' "launcher normal lock test passed (pidfd disabled=${CHATGPT_TEST_DISABLE_PIDFD:-0})"
    exit 0
fi

kill -KILL "$LAUNCHER_PID"
wait "$LAUNCHER_PID" 2>/dev/null || true
LAUNCHER_PID=""
wait_for "webview parent-death cleanup" webview_is_down
kill -0 "$FIRST_ELECTRON_PID" 2>/dev/null \
    || fail "Electron should survive the launcher SIGKILL"

"${COMMON_ENV[@]}" "$APP_DIR/start.sh" > "$SECOND_LOG" 2>&1 &
LAUNCHER_PID=$!

new_electron_is_ready() {
    local pid
    pid="$(read_live_app_pid)" || return 1
    [ "$pid" != "$FIRST_ELECTRON_PID" ] || return 1
    webview_is_ready
}
wait_for "cold-start recovery" new_electron_is_ready

if kill -0 "$FIRST_ELECTRON_PID" 2>/dev/null; then
    fail "identity-verified stale Electron was not terminated"
fi
grep -q "Stopped identity-verified stale Electron pid=$FIRST_ELECTRON_PID" "$APP_LOG" \
    || fail "launcher did not report stale Electron recovery"

SECOND_ELECTRON_PID="$(read_live_app_pid)"
kill "$SECOND_ELECTRON_PID"
wait "$LAUNCHER_PID"
LAUNCHER_PID=""

printf '%s\n' "launcher recovery test passed (warm-start disabled=${CHATGPT_TEST_DISABLE_WARM_START:-0})"
