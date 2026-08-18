#!/bin/bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_file_contains() {
    local path="$1"
    local expected="$2"
    [ -f "$path" ] || fail "expected file: $path"
    grep -Fq -- "$expected" "$path" || fail "expected $path to contain: $expected"
}

make_launcher_fixture() {
    local fixture_root="$1"
    local app_dir="$fixture_root/app"
    mkdir -p "$app_dir/.chatgpt-linux" "$fixture_root/bin"
    cp "$REPO_ROOT/launcher/state-migration.py" "$app_dir/.chatgpt-linux/state-migration.py"
    chmod 0755 "$app_dir/.chatgpt-linux/state-migration.py"
    {
        printf '%s\n' '#!/bin/bash' 'set -euo pipefail'
        printf '%s\n' 'CHATGPT_LINUX_APP_ID=chatgpt'
        printf '%s\n' 'CHATGPT_LINUX_APP_DISPLAY_NAME=ChatGPT'
        printf '%s\n' 'CHATGPT_LINUX_WEBVIEW_PORT=5175'
        cat "$REPO_ROOT/launcher/start.sh.template"
    } > "$app_dir/start.sh"
    chmod 0755 "$app_dir/start.sh"
    ln -s "$app_dir/start.sh" "$fixture_root/bin/chatgpt"
}

run_chatgpt() {
    local fixture_root="$1"
    local -a migration_test_env=()
    shift
    if [ -n "${CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER:-}" ]; then
        migration_test_env+=("CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER=$CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER")
    fi
    if [ -n "${CHATGPT_STATE_MIGRATION_TEST_CREATE_DESTINATION_BEFORE_MOVE:-}" ]; then
        migration_test_env+=("CHATGPT_STATE_MIGRATION_TEST_CREATE_DESTINATION_BEFORE_MOVE=$CHATGPT_STATE_MIGRATION_TEST_CREATE_DESTINATION_BEFORE_MOVE")
    fi
    if [ -n "${CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME:-}" ]; then
        migration_test_env+=("CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME=$CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME")
    fi
    env -i \
        HOME="$fixture_root/home" \
        PATH="$fixture_root/bin:/usr/bin:/bin" \
        XDG_CONFIG_HOME="$fixture_root/xdg/config" \
        XDG_STATE_HOME="$fixture_root/xdg/state" \
        XDG_CACHE_HOME="$fixture_root/xdg/cache" \
        XDG_DATA_HOME="$fixture_root/xdg/data" \
        XDG_RUNTIME_DIR="$fixture_root/xdg/runtime" \
        "${migration_test_env[@]}" \
        chatgpt "$@"
}

test_agent_workspace_permission_file_round_trips_and_rewrites_global_state() {
    local fixture_root="$TEST_ROOT/agent-workspace-permissions"
    local collision_root="$TEST_ROOT/agent-workspace-permissions-collision"
    local legacy_permissions
    local canonical_permissions
    local workspace_command
    local output
    local status
    make_launcher_fixture "$fixture_root"
    legacy_permissions="$fixture_root/xdg/data/agent-workspace-linux/permissions/codex-agent-workspace-permissions.json"
    canonical_permissions="$fixture_root/xdg/data/agent-workspace-linux/permissions/chatgpt-agent-workspace-permissions.json"
    workspace_command="/usr/local/bin/agent-workspace-linux"
    mkdir -p \
        "$fixture_root/xdg/config/chatgpt" \
        "$(dirname "$legacy_permissions")" \
        "$fixture_root/xdg/runtime"
    printf '%s\n' '{"network":{"mode":"local_only"}}' > "$legacy_permissions"
    printf '{"codex-linux-agent-workspace-command":"%s","codex-linux-agent-workspace-permissions":"%s"}\n' \
        "$workspace_command" "$legacy_permissions" > \
        "$fixture_root/xdg/config/chatgpt/globalState.json"

    set +e
    CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME=agent-workspace-permissions
    run_chatgpt "$fixture_root" --help >/dev/null 2>&1
    status=$?
    unset CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME
    set -e

    [ "$status" -ne 0 ] || fail "permission-file rename interruption did not stop migration"
    [ ! -e "$legacy_permissions" ] || fail "legacy permission file remains after atomic rename"
    assert_file_contains "$canonical_permissions" '"mode":"local_only"'
    [ -f "$fixture_root/xdg/state/.chatgpt-state-migration.json" ] ||
        fail "permission-file rename interruption did not retain the journal"

    run_chatgpt "$fixture_root" --help >/dev/null
    assert_file_contains "$fixture_root/xdg/config/chatgpt/globalState.json" "$canonical_permissions"
    assert_file_contains "$fixture_root/xdg/config/chatgpt/globalState.json" '"chatgpt-linux-agent-workspace-command"'
    assert_file_contains "$fixture_root/xdg/config/chatgpt/globalState.json" '"chatgpt-linux-agent-workspace-permissions"'
    if grep -Fq -- '"codex-linux-agent-workspace-' "$fixture_root/xdg/config/chatgpt/globalState.json"; then
        fail "forward migration retained legacy agent-workspace state keys"
    fi
    if grep -Fq -- "$legacy_permissions" "$fixture_root/xdg/config/chatgpt/globalState.json"; then
        fail "forward migration retained the legacy permission path in globalState"
    fi
    [ ! -e "$fixture_root/xdg/state/.chatgpt-state-migration.json" ] ||
        fail "resumed permission-file migration retained the journal"

    run_chatgpt "$fixture_root" migrate-state --reverse
    run_chatgpt "$fixture_root" migrate-state --reverse
    assert_file_contains "$legacy_permissions" '"mode":"local_only"'
    [ ! -e "$canonical_permissions" ] || fail "canonical permission file remains after reverse"
    assert_file_contains "$fixture_root/xdg/config/codex-app/globalState.json" "$legacy_permissions"
    assert_file_contains "$fixture_root/xdg/config/codex-app/globalState.json" '"codex-linux-agent-workspace-command"'
    assert_file_contains "$fixture_root/xdg/config/codex-app/globalState.json" '"codex-linux-agent-workspace-permissions"'
    if grep -Fq -- '"chatgpt-linux-agent-workspace-' "$fixture_root/xdg/config/codex-app/globalState.json"; then
        fail "reverse migration retained canonical agent-workspace state keys"
    fi
    if grep -Fq -- "$canonical_permissions" "$fixture_root/xdg/config/codex-app/globalState.json"; then
        fail "reverse migration retained the canonical permission path in globalState"
    fi

    make_launcher_fixture "$collision_root"
    legacy_permissions="$collision_root/xdg/data/agent-workspace-linux/permissions/codex-agent-workspace-permissions.json"
    canonical_permissions="$collision_root/xdg/data/agent-workspace-linux/permissions/chatgpt-agent-workspace-permissions.json"
    mkdir -p \
        "$(dirname "$legacy_permissions")" \
        "$collision_root/xdg/state/codex-app" \
        "$collision_root/xdg/runtime"
    printf '%s\n' legacy > "$legacy_permissions"
    printf '%s\n' canonical > "$canonical_permissions"
    printf '%s\n' unmoved > "$collision_root/xdg/state/codex-app/session.json"

    set +e
    output="$(run_chatgpt "$collision_root" --help 2>&1)"
    status=$?
    set -e

    [ "$status" -ne 0 ] || fail "permission-file collision unexpectedly launched ChatGPT"
    [[ "$output" == *"Recovery command: mv -T -- $canonical_permissions $canonical_permissions.pre-chatgpt-migration && chatgpt"* ]] ||
        fail "permission-file collision did not report the exact recovery command: $output"
    assert_file_contains "$legacy_permissions" legacy
    assert_file_contains "$canonical_permissions" canonical
    assert_file_contains "$collision_root/xdg/state/codex-app/session.json" unmoved
    [ ! -e "$collision_root/xdg/state/chatgpt/session.json" ] ||
        fail "permission-file collision allowed partial mutation"
}

test_first_launch_migrates_known_wrapper_state() {
    local fixture_root="$TEST_ROOT/forward"
    make_launcher_fixture "$fixture_root"
    mkdir -p \
        "$fixture_root/xdg/config/codex-app" \
        "$fixture_root/xdg/config/codex-app-updater" \
        "$fixture_root/xdg/state/codex-app" \
        "$fixture_root/xdg/state/codex-app-updater" \
        "$fixture_root/xdg/cache/codex-app" \
        "$fixture_root/xdg/cache/codex-app-updater" \
        "$fixture_root/xdg/data/codex-app" \
        "$fixture_root/xdg/runtime"
    printf '%s\n' 'app settings' > "$fixture_root/xdg/config/codex-app/settings.json"
    printf '%s\n' 'updater settings' > "$fixture_root/xdg/config/codex-app-updater/config.toml"
    printf '%s\n' 'app state' > "$fixture_root/xdg/state/codex-app/session.json"
    printf '%s\n' 'updater state' > "$fixture_root/xdg/state/codex-app-updater/state.json"
    printf '%s\n' 'app cache' > "$fixture_root/xdg/cache/codex-app/asset.bin"
    printf '%s\n' 'updater cache' > "$fixture_root/xdg/cache/codex-app-updater/download.bin"
    printf '%s\n' 'app data' > "$fixture_root/xdg/data/codex-app/user-data.json"

    run_chatgpt "$fixture_root" --help >/dev/null

    [ ! -e "$fixture_root/xdg/config/codex-app" ] || fail "legacy app config remains"
    [ ! -e "$fixture_root/xdg/config/codex-app-updater" ] || fail "legacy updater config remains"
    [ ! -e "$fixture_root/xdg/state/codex-app" ] || fail "legacy app state remains"
    [ ! -e "$fixture_root/xdg/state/codex-app-updater" ] || fail "legacy updater state remains"
    [ ! -e "$fixture_root/xdg/cache/codex-app" ] || fail "legacy app cache remains"
    [ ! -e "$fixture_root/xdg/cache/codex-app-updater" ] || fail "legacy updater cache remains"
    [ ! -e "$fixture_root/xdg/data/codex-app" ] || fail "legacy app data remains"
    assert_file_contains "$fixture_root/xdg/config/chatgpt/settings.json" "app settings"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.toml" "updater settings"
    assert_file_contains "$fixture_root/xdg/state/chatgpt/session.json" "app state"
    assert_file_contains "$fixture_root/xdg/state/chatgpt-updater/state.json" "updater state"
    assert_file_contains "$fixture_root/xdg/cache/chatgpt/asset.bin" "app cache"
    assert_file_contains "$fixture_root/xdg/cache/chatgpt-updater/download.bin" "updater cache"
    assert_file_contains "$fixture_root/xdg/data/chatgpt/user-data.json" "app data"
}

test_already_canonical_state_does_not_rescan_large_trees() {
    local fixture_root="$TEST_ROOT/already-canonical"

    mkdir -p "$fixture_root/home" "$fixture_root/xdg/config/chatgpt" "$fixture_root/xdg/state/chatgpt"

    python3 - "$REPO_ROOT/launcher/state-migration.py" "$fixture_root" <<'PY'
import importlib.util
import os
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
fixture_root = pathlib.Path(sys.argv[2])
config_root = fixture_root / "xdg" / "config" / "chatgpt"
state_root = fixture_root / "xdg" / "state" / "chatgpt"
for index in range(2_000):
    (config_root / f"settings-{index}.json").write_text(
        '{"state":"canonical"}\n', encoding="utf-8"
    )
    (state_root / f"session-{index}.json").write_text(
        '{"state":"canonical"}\n', encoding="utf-8"
    )

os.environ.update(
    {
        "HOME": str(fixture_root / "home"),
        "XDG_CONFIG_HOME": str(fixture_root / "xdg" / "config"),
        "XDG_STATE_HOME": str(fixture_root / "xdg" / "state"),
        "XDG_CACHE_HOME": str(fixture_root / "xdg" / "cache"),
        "XDG_DATA_HOME": str(fixture_root / "xdg" / "data"),
        "XDG_RUNTIME_DIR": str(fixture_root / "xdg" / "runtime"),
    }
)

spec = importlib.util.spec_from_file_location("state_migration", script_path)
assert spec and spec.loader
state_migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state_migration)

rewrite_calls = []


def fail_if_rewritten(root, pairs):
    rewrite_calls.append(str(root))
    raise AssertionError(f"already-canonical state was recursively scanned: {root}")


state_migration.rewrite_known_paths = fail_if_rewritten
state_migration.run_migration("forward")

assert not rewrite_calls
assert not (fixture_root / "xdg" / "state" / ".chatgpt-state-migration.json").exists()
assert (config_root / "settings-1999.json").read_text(encoding="utf-8") == '{"state":"canonical"}\n'
assert (state_root / "session-1999.json").read_text(encoding="utf-8") == '{"state":"canonical"}\n'
PY
}

test_resumed_all_skipped_journal_does_not_rescan_canonical_trees() {
    local fixture_root="$TEST_ROOT/resumed-all-skipped"

    mkdir -p "$fixture_root/home" "$fixture_root/xdg/config/chatgpt" "$fixture_root/xdg/state/chatgpt"

    python3 - "$REPO_ROOT/launcher/state-migration.py" "$fixture_root" <<'PY'
import importlib.util
import os
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
fixture_root = pathlib.Path(sys.argv[2])
os.environ.update(
    {
        "HOME": str(fixture_root / "home"),
        "XDG_CONFIG_HOME": str(fixture_root / "xdg" / "config"),
        "XDG_STATE_HOME": str(fixture_root / "xdg" / "state"),
        "XDG_CACHE_HOME": str(fixture_root / "xdg" / "cache"),
        "XDG_DATA_HOME": str(fixture_root / "xdg" / "data"),
        "XDG_RUNTIME_DIR": str(fixture_root / "xdg" / "runtime"),
    }
)

spec = importlib.util.spec_from_file_location("state_migration", script_path)
assert spec and spec.loader
state_migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state_migration)

operations, journal_path = state_migration.migration_paths()
for operation in operations:
    operation["status"] = "skipped"
state_migration.write_journal(
    journal_path,
    {
        "version": state_migration.JOURNAL_VERSION,
        "direction": "forward",
        "operations": operations,
    },
)

rewrite_calls = []


def fail_if_rewritten(root, pairs):
    rewrite_calls.append(str(root))
    raise AssertionError(f"resumed all-skipped state was recursively scanned: {root}")


state_migration.rewrite_known_paths = fail_if_rewritten
state_migration.run_migration("forward")

assert not rewrite_calls
assert not journal_path.exists()
PY
}

test_repeated_launch_is_idempotent() {
    local fixture_root="$TEST_ROOT/idempotent"
    make_launcher_fixture "$fixture_root"
    mkdir -p \
        "$fixture_root/xdg/config/chatgpt" \
        "$fixture_root/xdg/runtime"
    printf '%s\n' 'keep me' > "$fixture_root/xdg/config/chatgpt/settings.json"

    run_chatgpt "$fixture_root" --help >/dev/null
    run_chatgpt "$fixture_root" --help >/dev/null

    assert_file_contains "$fixture_root/xdg/config/chatgpt/settings.json" "keep me"
    [ ! -e "$fixture_root/xdg/state/.chatgpt-state-migration.json" ] ||
        fail "completed migration journal remains"
}

test_collision_refuses_all_mutation_with_exact_recovery_command() {
    local fixture_root="$TEST_ROOT/collision"
    local output
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p \
        "$fixture_root/xdg/config/codex-app" \
        "$fixture_root/xdg/config/chatgpt" \
        "$fixture_root/xdg/state/codex-app" \
        "$fixture_root/xdg/runtime"
    printf '%s\n' legacy > "$fixture_root/xdg/config/codex-app/settings.json"
    printf '%s\n' canonical > "$fixture_root/xdg/config/chatgpt/settings.json"
    printf '%s\n' unmoved > "$fixture_root/xdg/state/codex-app/session.json"

    set +e
    output="$(run_chatgpt "$fixture_root" --help 2>&1)"
    status=$?
    set -e

    [ "$status" -ne 0 ] || fail "collision unexpectedly launched ChatGPT"
    [[ "$output" == *"Recovery command: mv -T -- $fixture_root/xdg/config/chatgpt $fixture_root/xdg/config/chatgpt.pre-chatgpt-migration && chatgpt"* ]] ||
        fail "collision did not report the exact recovery command: $output"
    assert_file_contains "$fixture_root/xdg/config/codex-app/settings.json" legacy
    assert_file_contains "$fixture_root/xdg/config/chatgpt/settings.json" canonical
    assert_file_contains "$fixture_root/xdg/state/codex-app/session.json" unmoved
    [ ! -e "$fixture_root/xdg/state/chatgpt/session.json" ] || fail "preflight collision allowed partial mutation"
}

test_migration_discards_volatile_files_rewrites_paths_and_preserves_user_data() {
    local fixture_root="$TEST_ROOT/contents"
    local old_config="$fixture_root/xdg/config/codex-app-updater"
    local old_state="$fixture_root/xdg/state/codex-app"
    local old_cache="$fixture_root/xdg/cache/codex-app-updater"
    local old_data="$fixture_root/xdg/data/codex-app"
    make_launcher_fixture "$fixture_root"
    mkdir -p "$old_config" "$old_state" "$old_cache/tmp" "$old_data/tmp" \
        "$fixture_root/xdg/runtime/codex-app" \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.codex-linux-quarantine"
    printf '%s\n' "{\"workspace\":\"$fixture_root/xdg/cache/codex-app-updater/work\",\"binary\":\"/usr/bin/codex-app-updater\",\"app\":\"/opt/codex-app\",\"codex-linux-auto-update-on-exit\":true,\"codex-linux-wrapper-updates-enabled\":false,\"codex-linux-integration-picker-on-update\":true,\"integration\":\"codex-wrapper-updater\"}" > "$old_config/config.json"
    printf '%s\n' "{\"path\":\"$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.codex-linux-quarantine\"}" > \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.codex-linux-quarantine/metadata.json"
    cat > "$old_config/rewrite-scope.json" <<'EOF'
{"note":"codex-wrapper-updater in user prose","lookalike":"/usr/bin/codex-apparel","integration":"codex-wrapper-updater","command":"/usr/bin/codex-app --help","codex-linux-warm-start-enabled":true}
EOF
    cat > "$old_config/rewrite-scope.toml" <<'EOF'
codex-linux-wrapper-updates-enabled = true
integration = "codex-wrapper-updater"
binary = "/usr/bin/codex-app-updater"
note = "codex-wrapper-updater in user prose"
lookalike = "/usr/bin/codex-apparel"
EOF
    printf '%s\n' 'codex-wrapper-updater /usr/bin/codex-app in user prose' > "$old_config/notes.txt"
    printf '%s\n' 'conversation state' > "$old_state/session.json"
    printf '%s\n' 'config lock data' > "$old_config/user.lock"
    printf '%s\n' 'user temporary data' > "$old_data/tmp/draft.tmp"
    printf '%s\n' 'volatile' > "$old_state/app.pid"
    printf '%s\n' 'volatile' > "$old_state/launch-action.sock"
    printf '%s\n' 'volatile' > "$old_state/check.lock"
    printf '%s\n' 'download' > "$old_cache/download.bin"
    printf '%s\n' 'temporary' > "$old_cache/download.tmp"
    printf '%s\n' 'temporary dir' > "$old_cache/tmp/partial"
    printf '%s\n' 'runtime socket' > "$fixture_root/xdg/runtime/codex-app/launch-action.sock"

    run_chatgpt "$fixture_root" --help >/dev/null

    assert_file_contains "$fixture_root/xdg/state/chatgpt/session.json" "conversation state"
    assert_file_contains "$fixture_root/xdg/cache/chatgpt-updater/download.bin" download
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/user.lock" "config lock data"
    assert_file_contains "$fixture_root/xdg/data/chatgpt/tmp/draft.tmp" "user temporary data"
    [ ! -e "$fixture_root/xdg/state/chatgpt/app.pid" ] || fail "stale PID was preserved"
    [ ! -e "$fixture_root/xdg/state/chatgpt/launch-action.sock" ] || fail "stale socket was preserved"
    [ ! -e "$fixture_root/xdg/state/chatgpt/check.lock" ] || fail "stale lock was preserved"
    [ ! -e "$fixture_root/xdg/cache/chatgpt-updater/download.tmp" ] || fail "temporary cache file was preserved"
    [ ! -e "$fixture_root/xdg/cache/chatgpt-updater/tmp" ] || fail "temporary cache directory was preserved"
    [ ! -e "$fixture_root/xdg/runtime/codex-app" ] || fail "legacy runtime directory was preserved"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "$fixture_root/xdg/cache/chatgpt-updater/work"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "/usr/bin/chatgpt-updater"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "/opt/chatgpt"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "chatgpt-linux-auto-update-on-exit"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "chatgpt-linux-wrapper-updates-enabled"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "chatgpt-linux-integration-picker-on-update"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/config.json" "chatgpt-wrapper-updater"
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.json" 'codex-wrapper-updater in user prose'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.json" '/usr/bin/codex-apparel'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.json" '"integration": "chatgpt-wrapper-updater"'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.json" '/usr/bin/chatgpt --help'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.json" '"chatgpt-linux-warm-start-enabled": true'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.toml" 'chatgpt-linux-wrapper-updates-enabled = true'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.toml" 'integration = "chatgpt-wrapper-updater"'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.toml" 'binary = "/usr/bin/chatgpt-updater"'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.toml" 'note = "codex-wrapper-updater in user prose"'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/rewrite-scope.toml" 'lookalike = "/usr/bin/codex-apparel"'
    assert_file_contains "$fixture_root/xdg/config/chatgpt-updater/notes.txt" 'codex-wrapper-updater /usr/bin/codex-app in user prose'
    [ ! -e "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.codex-linux-quarantine" ] ||
        fail "legacy CLI quarantine remains"
    assert_file_contains \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.chatgpt-linux-quarantine/metadata.json" \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.chatgpt-linux-quarantine"
}

test_interrupted_migration_resumes_from_journal() {
    local fixture_root="$TEST_ROOT/resume"
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p \
        "$fixture_root/xdg/config/codex-app" \
        "$fixture_root/xdg/state/codex-app" \
        "$fixture_root/xdg/cache/codex-app" \
        "$fixture_root/xdg/runtime"
    printf '%s\n' config > "$fixture_root/xdg/config/codex-app/settings.json"
    printf '%s\n' state > "$fixture_root/xdg/state/codex-app/session.json"
    printf '%s\n' cache > "$fixture_root/xdg/cache/codex-app/blob.bin"

    set +e
    CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER=1 run_chatgpt "$fixture_root" --help >/dev/null 2>&1
    status=$?
    set -e
    [ "$status" -ne 0 ] || fail "interruption hook did not stop migration"
    [ -f "$fixture_root/xdg/state/.chatgpt-state-migration.json" ] || fail "interruption did not retain journal"
    assert_file_contains "$fixture_root/xdg/config/chatgpt/settings.json" config
    [ -d "$fixture_root/xdg/state/codex-app" ] || fail "interruption moved more than one operation"

    run_chatgpt "$fixture_root" --help >/dev/null

    assert_file_contains "$fixture_root/xdg/state/chatgpt/session.json" state
    assert_file_contains "$fixture_root/xdg/cache/chatgpt/blob.bin" cache
    [ ! -e "$fixture_root/xdg/state/.chatgpt-state-migration.json" ] || fail "resumed migration retained journal"
}

test_explicit_reverse_migration_restores_legacy_roots() {
    local fixture_root="$TEST_ROOT/reverse"
    local cache_digest
    make_launcher_fixture "$fixture_root"
    mkdir -p \
        "$fixture_root/xdg/config/chatgpt-updater" \
        "$fixture_root/xdg/state/chatgpt" \
        "$fixture_root/xdg/cache/chatgpt-updater" \
        "$fixture_root/xdg/runtime" \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.chatgpt-linux-quarantine"
    printf '%s\n' "{\"binary\":\"/usr/bin/chatgpt-updater\",\"app\":\"/opt/chatgpt\",\"chatgpt-linux-auto-update-on-exit\":true,\"chatgpt-linux-wrapper-updates-enabled\":false,\"chatgpt-linux-integration-picker-on-update\":true,\"integration\":\"chatgpt-wrapper-updater\"}" > \
        "$fixture_root/xdg/config/chatgpt-updater/config.json"
    printf '%s\n' quarantine > \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.chatgpt-linux-quarantine/metadata.txt"
    printf '%s\n' preserved > "$fixture_root/xdg/state/chatgpt/session.json"
    printf '%s\n' reverse-dmg > "$fixture_root/xdg/cache/chatgpt-updater/payload"
    cache_digest="$(sha256sum "$fixture_root/xdg/cache/chatgpt-updater/payload" | awk '{print $1}')"
    mv "$fixture_root/xdg/cache/chatgpt-updater/payload" \
        "$fixture_root/xdg/cache/chatgpt-updater/ChatGPT-$cache_digest.dmg"

    run_chatgpt "$fixture_root" migrate-state --reverse
    run_chatgpt "$fixture_root" migrate-state --reverse

    [ ! -e "$fixture_root/xdg/config/chatgpt-updater" ] || fail "canonical updater config remains after reverse"
    [ ! -e "$fixture_root/xdg/state/chatgpt" ] || fail "canonical app state remains after reverse"
    assert_file_contains "$fixture_root/xdg/config/codex-app-updater/config.json" "/usr/bin/codex-app-updater"
    assert_file_contains "$fixture_root/xdg/config/codex-app-updater/config.json" "/opt/codex-app"
    assert_file_contains "$fixture_root/xdg/config/codex-app-updater/config.json" "codex-linux-auto-update-on-exit"
    assert_file_contains "$fixture_root/xdg/config/codex-app-updater/config.json" "codex-linux-wrapper-updates-enabled"
    assert_file_contains "$fixture_root/xdg/config/codex-app-updater/config.json" "codex-linux-integration-picker-on-update"
    assert_file_contains "$fixture_root/xdg/config/codex-app-updater/config.json" "codex-wrapper-updater"
    assert_file_contains \
        "$fixture_root/home/.codex-cli-npm/lib/node_modules/@openai/.codex-linux-quarantine/metadata.txt" quarantine
    assert_file_contains "$fixture_root/xdg/state/codex-app/session.json" preserved
    assert_file_contains "$fixture_root/xdg/cache/codex-app-updater/Codex-$cache_digest.dmg" reverse-dmg
}

test_symlink_source_is_refused_before_other_roots_move() {
    local fixture_root="$TEST_ROOT/symlink"
    local output
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p \
        "$fixture_root/outside" \
        "$fixture_root/xdg/config" \
        "$fixture_root/xdg/state/codex-app" \
        "$fixture_root/xdg/runtime"
    printf '%s\n' outside > "$fixture_root/outside/settings.json"
    printf '%s\n' unmoved > "$fixture_root/xdg/state/codex-app/session.json"
    ln -s "$fixture_root/outside" "$fixture_root/xdg/config/codex-app"

    set +e
    output="$(run_chatgpt "$fixture_root" --help 2>&1)"
    status=$?
    set -e

    [ "$status" -ne 0 ] || fail "symlink source unexpectedly migrated"
    [[ "$output" == *"refusing symlink migration source: $fixture_root/xdg/config/codex-app"* ]] ||
        fail "symlink refusal was not actionable: $output"
    [ -L "$fixture_root/xdg/config/codex-app" ] || fail "symlink source was changed"
    assert_file_contains "$fixture_root/outside/settings.json" outside
    assert_file_contains "$fixture_root/xdg/state/codex-app/session.json" unmoved
    [ ! -e "$fixture_root/xdg/state/chatgpt" ] || fail "symlink preflight allowed partial mutation"
}

test_cross_filesystem_source_is_refused_without_partial_mutation() {
    local fixture_root="$TEST_ROOT/cross-device"
    local source="$fixture_root/xdg/config/codex-app"
    local output
    local status
    command -v unshare >/dev/null || fail "unshare is required for the cross-filesystem migration test"
    make_launcher_fixture "$fixture_root"
    mkdir -p "$source" "$fixture_root/xdg/state/codex-app" "$fixture_root/xdg/runtime"
    printf '%s\n' unmoved > "$fixture_root/xdg/state/codex-app/session.json"

    set +e
    output="$(unshare --user --map-root-user --mount bash -c '
        set -Eeuo pipefail
        source_path="$1"
        fixture_root="$2"
        mount -t tmpfs -o size=1m tmpfs "$source_path"
        cleanup_mount() { umount "$source_path"; }
        trap cleanup_mount EXIT
        printf "%s\n" cross-device > "$source_path/settings.json"
        env -i \
            HOME="$fixture_root/home" \
            PATH="$fixture_root/bin:/usr/bin:/bin" \
            XDG_CONFIG_HOME="$fixture_root/xdg/config" \
            XDG_STATE_HOME="$fixture_root/xdg/state" \
            XDG_CACHE_HOME="$fixture_root/xdg/cache" \
            XDG_DATA_HOME="$fixture_root/xdg/data" \
            XDG_RUNTIME_DIR="$fixture_root/xdg/runtime" \
            chatgpt --help
    ' bash "$source" "$fixture_root" 2>&1)"
    status=$?
    set -e

    if [[ "$output" == *"unshare:"*"Operation not permitted"* ]]; then
        printf '%s\n' \
            "SKIP: user namespaces are unavailable for the cross-filesystem migration test" >&2
        return 0
    fi
    [ "$status" -ne 0 ] || fail "cross-filesystem source unexpectedly migrated"
    [[ "$output" == *"refusing non-atomic cross-filesystem migration: $source -> $fixture_root/xdg/config/chatgpt"* ]] ||
        fail "cross-filesystem refusal was not actionable: $output"
    assert_file_contains "$fixture_root/xdg/state/codex-app/session.json" unmoved
    [ ! -e "$fixture_root/xdg/state/chatgpt" ] || fail "cross-filesystem preflight allowed partial mutation"
}

test_destination_created_after_preflight_is_not_overwritten() {
    local fixture_root="$TEST_ROOT/toctou-collision"
    local source="$fixture_root/xdg/config/codex-app"
    local destination="$fixture_root/xdg/config/chatgpt"
    local output
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p "$source" "$fixture_root/xdg/runtime"
    printf '%s\n' legacy > "$source/settings.json"

    set +e
    CHATGPT_STATE_MIGRATION_TEST_CREATE_DESTINATION_BEFORE_MOVE=app-config
    output="$(run_chatgpt "$fixture_root" --help 2>&1)"
    status=$?
    unset CHATGPT_STATE_MIGRATION_TEST_CREATE_DESTINATION_BEFORE_MOVE
    set -e

    [ "$status" -ne 0 ] || fail "post-preflight destination unexpectedly overwritten"
    [[ "$output" == *"Recovery command: mv -T -- $destination $destination.pre-chatgpt-migration && chatgpt"* ]] ||
        fail "post-preflight collision did not report recovery: $output"
    assert_file_contains "$source/settings.json" legacy
    assert_file_contains "$destination/concurrent-state" concurrent
}

test_resume_refuses_changed_source_and_destination_types() {
    local fixture_root="$TEST_ROOT/resume-type-change"
    local source="$fixture_root/xdg/config/codex-app"
    local destination="$fixture_root/xdg/config/chatgpt"
    local output
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p "$source" "$fixture_root/xdg/runtime"
    printf '%s\n' preserved > "$source/settings.json"

    set +e
    CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME=app-config
    run_chatgpt "$fixture_root" --help >/dev/null 2>&1
    status=$?
    unset CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME
    set -e
    [ "$status" -ne 0 ] || fail "rename interruption hook did not stop migration"
    [ -f "$fixture_root/xdg/state/.chatgpt-state-migration.json" ] || fail "rename interruption did not retain journal"
    assert_file_contains "$destination/settings.json" preserved

    ln -s "$fixture_root/missing-source" "$source"
    set +e
    output="$(run_chatgpt "$fixture_root" --help 2>&1)"
    status=$?
    set -e
    [ "$status" -ne 0 ] || fail "broken source symlink was accepted during resume"
    [[ "$output" == *"migration source changed to a symlink while resuming: $source"* ]] ||
        fail "resume source refusal was not actionable: $output"
    rm "$source"

    mv "$destination" "$destination.held"
    printf '%s\n' unsafe > "$destination"
    set +e
    output="$(run_chatgpt "$fixture_root" --help 2>&1)"
    status=$?
    set -e
    [ "$status" -ne 0 ] || fail "regular-file destination was accepted during resume"
    [[ "$output" == *"migration destination is not a real directory while resuming: $destination"* ]] ||
        fail "resume destination refusal was not actionable: $output"
    rm "$destination"
    mv "$destination.held" "$destination"

    run_chatgpt "$fixture_root" --help >/dev/null
    assert_file_contains "$destination/settings.json" preserved
}

test_updater_cache_dmg_names_are_digest_verified_and_normalized() {
    local fixture_root="$TEST_ROOT/cache-dmg"
    local cache_root="$fixture_root/xdg/cache/codex-app-updater"
    local cache_dir="$cache_root/downloads"
    local digest
    local invalid_digest
    local unsafe_digest
    make_launcher_fixture "$fixture_root"
    mkdir -p "$cache_dir" "$fixture_root/xdg/runtime"
    printf '%s\n' trusted-dmg > "$cache_dir/payload"
    digest="$(sha256sum "$cache_dir/payload" | awk '{print $1}')"
    invalid_digest="$(printf '0%.0s' {1..64})"
    cp "$cache_dir/payload" "$cache_dir/Codex-$digest.dmg"
    cp "$cache_dir/payload" "$cache_dir/ChatGPT-$digest.dmg"
    printf '%s\n' mismatch > "$cache_dir/Codex-$invalid_digest.dmg"
    printf '%s\n' unsafe-dmg > "$cache_dir/unsafe-payload"
    unsafe_digest="$(sha256sum "$cache_dir/unsafe-payload" | awk '{print $1}')"
    cp "$cache_dir/unsafe-payload" "$cache_dir/Codex-$unsafe_digest.dmg"
    printf '%s\n' outside > "$fixture_root/outside-cache-target"
    ln -s "$fixture_root/outside-cache-target" "$cache_dir/ChatGPT-$unsafe_digest.dmg"
    rm "$cache_dir/payload" "$cache_dir/unsafe-payload"

    run_chatgpt "$fixture_root" --help >/dev/null

    assert_file_contains "$fixture_root/xdg/cache/chatgpt-updater/downloads/ChatGPT-$digest.dmg" trusted-dmg
    [ ! -e "$fixture_root/xdg/cache/chatgpt-updater/downloads/Codex-$digest.dmg" ] ||
        fail "valid legacy DMG cache name remains"
    [ ! -e "$fixture_root/xdg/cache/chatgpt-updater/downloads/Codex-$invalid_digest.dmg" ] ||
        fail "digest-mismatched legacy DMG cache entry remains"
    [ ! -e "$fixture_root/xdg/cache/chatgpt-updater/downloads/Codex-$unsafe_digest.dmg" ] ||
        fail "legacy cache file survived unsafe canonical target"
    [ ! -e "$fixture_root/xdg/cache/chatgpt-updater/downloads/ChatGPT-$unsafe_digest.dmg" ] ||
        fail "unsafe canonical cache target survived normalization"
    assert_file_contains "$fixture_root/outside-cache-target" outside
}

test_unsafe_updater_downloads_path_is_refused_before_any_move() {
    local fixture_root="$TEST_ROOT/unsafe-downloads"
    local cache_root="$fixture_root/xdg/cache/codex-app-updater"
    local output
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p "$cache_root" "$fixture_root/outside-downloads" \
        "$fixture_root/xdg/state/codex-app" "$fixture_root/xdg/runtime"
    ln -s "$fixture_root/outside-downloads" "$cache_root/downloads"
    printf '%s\n' outside > "$fixture_root/outside-downloads/keep"
    printf '%s\n' unmoved > "$fixture_root/xdg/state/codex-app/session.json"

    set +e
    output="$(run_chatgpt "$fixture_root" --help 2>&1)"
    status=$?
    set -e

    [ "$status" -ne 0 ] || fail "unsafe downloads path unexpectedly migrated"
    [[ "$output" == *"refusing unsafe updater cache downloads path: $cache_root/downloads"* ]] ||
        fail "unsafe downloads refusal was not actionable: $output"
    [ -L "$cache_root/downloads" ] || fail "unsafe downloads symlink was changed"
    assert_file_contains "$fixture_root/outside-downloads/keep" outside
    assert_file_contains "$fixture_root/xdg/state/codex-app/session.json" unmoved
    [ ! -e "$fixture_root/xdg/state/chatgpt" ] || fail "unsafe downloads preflight allowed partial mutation"
}

test_obsolete_launcher_variable_fails_loudly_with_replacement() {
    local fixture_root="$TEST_ROOT/obsolete-launcher-env"
    local output
    local status
    make_launcher_fixture "$fixture_root"
    mkdir -p "$fixture_root/xdg/runtime"

    set +e
    output="$(env -i \
        HOME="$fixture_root/home" \
        PATH="$fixture_root/bin:/usr/bin:/bin" \
        XDG_CONFIG_HOME="$fixture_root/xdg/config" \
        XDG_STATE_HOME="$fixture_root/xdg/state" \
        XDG_CACHE_HOME="$fixture_root/xdg/cache" \
        XDG_DATA_HOME="$fixture_root/xdg/data" \
        XDG_RUNTIME_DIR="$fixture_root/xdg/runtime" \
        CODEX_MULTI_LAUNCH=1 \
        chatgpt --help 2>&1)"
    status=$?
    set -e

    [ "$status" -ne 0 ] || fail "obsolete launcher variable was silently accepted"
    [[ "$output" == *"CODEX_MULTI_LAUNCH is no longer supported; use CHATGPT_MULTI_LAUNCH"* ]] ||
        fail "obsolete launcher variable did not name its replacement: $output"
    [ ! -e "$fixture_root/xdg/state/chatgpt" ] || fail "obsolete variable check ran after canonical state creation"
}

test_obsolete_installer_variable_fails_loudly_with_replacement() {
    local fixture_root="$TEST_ROOT/obsolete-installer-env"
    local output
    local status
    mkdir -p "$fixture_root/home"

    set +e
    output="$(env -i \
        HOME="$fixture_root/home" \
        PATH="/usr/bin:/bin" \
        CODEX_INSTALL_DIR="$fixture_root/legacy-app" \
        CHATGPT_INSTALLER_SOURCE_ONLY=1 \
        bash "$REPO_ROOT/install.sh" 2>&1)"
    status=$?
    set -e

    [ "$status" -ne 0 ] || fail "obsolete installer variable was silently accepted"
    [[ "$output" == *"CODEX_INSTALL_DIR is no longer supported; use CHATGPT_INSTALL_DIR"* ]] ||
        fail "obsolete installer variable did not name its replacement: $output"
    [ ! -e "$fixture_root/legacy-app" ] || fail "obsolete installer variable was acted upon"
}

test_installer_generates_canonical_launcher_and_shared_helper() {
    local fixture_root="$TEST_ROOT/generated-launcher"
    local app_dir="$fixture_root/chatgpt"
    mkdir -p "$fixture_root/home" "$app_dir"

    env -i \
        HOME="$fixture_root/home" \
        PATH="/usr/bin:/bin" \
        CHATGPT_INSTALLER_SOURCE_ONLY=1 \
        CHATGPT_INSTALL_DIR="$app_dir" \
        bash -c 'source "$1"; create_start_script' bash "$REPO_ROOT/install.sh" >/dev/null

    [ -x "$app_dir/start.sh" ] || fail "installer did not generate executable launcher"
    [ -x "$app_dir/.chatgpt-linux/state-migration.py" ] || fail "installer did not generate executable migration helper"
    assert_file_contains "$app_dir/start.sh" "CHATGPT_LINUX_APP_ID=chatgpt"
    assert_file_contains "$app_dir/start.sh" "CHATGPT_LINUX_APP_DISPLAY_NAME=ChatGPT"
    assert_file_contains "$app_dir/start.sh" 'CHATGPT_LINUX_WEBVIEW_PORT=${CHATGPT_WEBVIEW_PORT:-5175}'
    [ ! -e "$app_dir/.codex-linux" ] || fail "installer generated legacy internal directory"
}

test_user_local_installer_migrates_before_creating_canonical_state() {
    local fixture_root="$TEST_ROOT/user-local-installer"
    mkdir -p \
        "$fixture_root/home" \
        "$fixture_root/xdg/config/codex-app" \
        "$fixture_root/xdg/state/codex-app" \
        "$fixture_root/xdg/cache/codex-app" \
        "$fixture_root/xdg/data/codex-app"
    printf '%s\n' legacy-config > "$fixture_root/xdg/config/codex-app/preferences.json"
    printf '%s\n' legacy-state > "$fixture_root/xdg/state/codex-app/session.json"
    printf '%s\n' legacy-data > "$fixture_root/xdg/data/codex-app/keep.txt"

    env -i \
        HOME="$fixture_root/home" \
        PATH="/usr/bin:/bin" \
        XDG_CONFIG_HOME="$fixture_root/xdg/config" \
        XDG_STATE_HOME="$fixture_root/xdg/state" \
        XDG_CACHE_HOME="$fixture_root/xdg/cache" \
        XDG_DATA_HOME="$fixture_root/xdg/data" \
        bash "$REPO_ROOT/contrib/user-local-install/install-user-local.sh" --from-update

    [ ! -e "$fixture_root/xdg/config/codex-app" ] || fail "user-local install retained legacy config"
    [ ! -e "$fixture_root/xdg/state/codex-app" ] || fail "user-local install retained legacy state"
    [ ! -e "$fixture_root/xdg/data/codex-app" ] || fail "user-local install retained legacy data"
    assert_file_contains "$fixture_root/xdg/config/chatgpt/preferences.json" legacy-config
    assert_file_contains "$fixture_root/xdg/state/chatgpt/session.json" legacy-state
    assert_file_contains "$fixture_root/xdg/data/chatgpt/keep.txt" legacy-data
    [ -x "$fixture_root/xdg/data/chatgpt/bin/chatgpt" ] ||
        fail "user-local install did not populate the migrated canonical data tree"
}

test_agent_workspace_permission_file_round_trips_and_rewrites_global_state
test_first_launch_migrates_known_wrapper_state
test_already_canonical_state_does_not_rescan_large_trees
test_resumed_all_skipped_journal_does_not_rescan_canonical_trees
test_repeated_launch_is_idempotent
test_collision_refuses_all_mutation_with_exact_recovery_command
test_migration_discards_volatile_files_rewrites_paths_and_preserves_user_data
test_interrupted_migration_resumes_from_journal
test_explicit_reverse_migration_restores_legacy_roots
test_symlink_source_is_refused_before_other_roots_move
test_cross_filesystem_source_is_refused_without_partial_mutation
test_obsolete_launcher_variable_fails_loudly_with_replacement
test_obsolete_installer_variable_fails_loudly_with_replacement
test_installer_generates_canonical_launcher_and_shared_helper
test_user_local_installer_migrates_before_creating_canonical_state
test_updater_cache_dmg_names_are_digest_verified_and_normalized
test_unsafe_updater_downloads_path_is_refused_before_any_move
test_destination_created_after_preflight_is_not_overwritten
test_resume_refuses_changed_source_and_destination_types
echo "state migration tests: passed"
