# Browser Use node_repl Reaper

Codex spawns `node_repl` helper processes for Browser Use and does not always
reap them: helpers accumulate over long sessions and survive their owner
(observed in production: six helpers leaked in fifteen minutes, persisting for
over a day under a hidden-to-tray instance). Each holds memory and file
descriptors indefinitely.

This integration reaps **leaked** helpers — those whose parent is no longer a
live Codex CLI owner process. Helpers with a live `codex app-server` parent
or a live CLI Codex parent such as `codex resume` are never touched, so active
Browser Use sessions are unaffected. Matching is scoped to this install's
`resources/node_repl` path, so side-by-side installs reap independently.

## How it runs

- **Cold start**: the launcher hook starts one watchdog per install
  (pid file: `<state-dir>/node-repl-reaper.pid`). The watchdog reaps every
  5 minutes (`CHATGPT_NODE_REPL_REAPER_INTERVAL` seconds to override), waits up
  to 120 seconds for the launching Electron process to appear
  (`CHATGPT_NODE_REPL_REAPER_STARTUP_GRACE` seconds to override), and
  self-terminates with a final pass once no electron from the install is
  running.
- **App exit**: the after-exit hook runs one immediate pass.
- Reaping sends SIGTERM, then SIGKILL after a grace period
  (`CHATGPT_NODE_REPL_REAPER_KILL_GRACE` seconds, default 5), re-checking
  process identity before escalating to guard against pid reuse.

## Compatibility

This port integration can be enabled together with `mcp-helper-reaper`. If that
port integration wraps `resources/node_repl`, this reaper also matches
`resources/node_repl.chatgpt-linux-original` so leaked helpers remain in scope.

## Enable

For a checkout build, add it to `port-integrations/integrations.json`. For a
normal packaged updater rebuild, add it to the persistent override at
`${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt/port-integrations.json`. A custom app
ID replaces `chatgpt`; when `CHATGPT_LINUX_SETTINGS_FILE` is non-empty, use
`port-integrations.json` beside that explicit settings file:

```json
{ "enabled": ["node-repl-reaper"] }
```

then rebuild/reinstall. Logs go to the launcher log
(`~/.cache/chatgpt/launcher.log`), prefixed `node-repl-reaper:`.

## Test

```bash
node --test port-integrations/node-repl-reaper/test.js
```
