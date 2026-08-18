# Generated Artifacts And Runtime Notes

> [!IMPORTANT]
> This is historical source for a retired and unsupported repository. Do not
> use it to start or continue maintenance. Follow
> [Repository Retirement](../retirement.md).

This document preserves the generated-output and runtime-state notes used
before retirement for source interpretation only.

## Generated Artifacts

- `chatgpt/`
  Generated Linux app directory. Treat as build output.
- `chatgpt-next/`
  Side-by-side rebuild candidate from `scripts/rebuild-candidate.sh`. Hidden
  sibling `.chatgpt.candidate-*` directories are temporary transactional
  install state and are removed after success or rejection by default.
- `chatgpt-*-app/`
  Alternate identity app directories, such as `chatgpt-cua-lab-app/`.
- `dist/`
  Native package and AppImage outputs.
- `dist/appimage.AppDir/`
  Generated AppImage staging tree.
- `dist-next/rebuild/`
  Rebuild candidate reports.
- `target/`
  Rust build output for all workspace crates.
- `ChatGPT.dmg`
  Cached official OpenAI DMG.
- `port-integrations/integrations.json`
  Gitignored checkout-local `enabled`, `disabled`, and `settings` overrides.
  Reviewed `defaultEnabled` values live in each repository integration's
  manifest.
- `port-integrations/local/`
  Gitignored user-local integration directory.
- `chatgpt/.chatgpt-linux/port-integrations-staged.json`
  Staged declarative integration ownership manifest.
- `/usr/lib/chatgpt/update-builder/.chatgpt-linux/port-integrations.json`
  Full resolved port integration snapshot stored in a native package's private
  update-builder bundle. The copied integration tree excludes checkout-local
  config files; updater rebuilds use the persistent per-user override when one
  exists and otherwise preserve this snapshot.
- `~/.config/chatgpt/port-integrations.json`
  Persistent packaged-install override and integration-picker selection. It can
  replace the packaged snapshot for later updater rebuilds.
- `~/.config/chatgpt-updater/config.toml`
  Runtime updater config.
- `~/.local/state/chatgpt-updater/state.json`
  Updater state-machine persistence.
- `~/.local/state/chatgpt-updater/service.log`
  Updater service log.
- `~/.cache/chatgpt-updater/`
  Downloaded DMGs, rebuild workspaces, staged package artifacts, and build logs.
- `~/.cache/chatgpt/launcher.log`
  Launcher log for the default app identity.
- `~/.local/state/chatgpt/app.pid` and `webview.pid`
  Launcher liveness files.
- `$XDG_RUNTIME_DIR/chatgpt/launch-action.sock`
  Warm-start handoff socket.

## Runtime Notes

- DMG extraction can warn when `7z` cannot materialize the `/Applications`
  symlink. This is acceptable if a `.app` bundle was extracted successfully.
- The managed Node.js runtime is installed under
  `chatgpt/resources/node-runtime/`. Override only with
  `CHATGPT_MANAGED_NODE_VERSION`, `CHATGPT_MANAGED_NODE_URL`, and
  `CHATGPT_MANAGED_NODE_SHA256`; the SHA must be set when overriding version or
  URL.
- GUI launchers often do not inherit shell `PATH`. The generated launcher
  searches common Codex CLI and `nvm` locations and respects `CODEX_CLI_PATH`.
- CLI preflight is launcher-scoped and normally best-effort. A detected npm CLI
  missing its required Linux optional dependency is the exception: the launcher
  performs one bounded synchronous repair and blocks Electron startup if that
  repair fails or times out, because the known-broken CLI cannot serve the app.
- ASAR patches are fail-soft unless intentionally marked required. Each patch
  should be idempotent and report warnings when official-app drift prevents a
  needle from matching.
- Patch reports are written for installs and rebuilds. Official-DMG validation
  fails only for required official-app patches that are missing or skipped.
- The Linux Computer Use backend, bundled plugin, and Linux support patches are
  packaged or applied by default. The official installed-and-enabled
  `computer-use@openai-bundled` plugin setting is the persistent user grant;
  official account eligibility, allowed-app controls, and Codex tool approval,
  sandboxing, and auto-approval policy still govern use. Host readiness proves
  feasibility, not authorization.
- The `read-aloud` UI and `read-aloud-mcp` port integrations are reviewed
  defaults. They do not speak automatically: playback starts only from an
  explicit message action, conversation-mode action, or MCP request. Voice
  model/runtime downloads are also explicit. Because `conversation-mode`
  requires `read-aloud`, disable both to remove the UI backend; disable
  `read-aloud-mcp` separately to remove the agent-facing plugin.
- The Linux Chrome integration stages the bundled Chrome plugin, native host,
  marketplace metadata, and browser profile/native-host diagnostics for Chrome,
  Brave, and Chromium. Do not fix only the user cache; patch staged bundled
  resources.
- The generated launcher starts the local webview server before Electron and
  verifies the expected startup markers. See
  `docs/webview-server-evaluation.md` before changing the server model.
- Warm-start handoff uses a Unix-domain socket under `$XDG_RUNTIME_DIR` so
  second launches can send actions to the running app.
- Native package install/removal hooks start, stop, disable, and reload the
  `systemd --user` updater service on a best-effort basis.
- Failed privileged updater installs stay failed until a newer rebuild or an
  explicit retry path; avoid auto-retrying every reconcile cycle.
- Manual rollback uses the last-known-good package recorded in updater state
  and the same format-specific command layer as normal installs.

For current navigation and task-specific procedures, use `docs/README.md`,
`docs/port-architecture.md`, `docs/port-integrations-architecture.md`,
`docs/usage/build-and-run.md`, and `docs/usage/troubleshooting.md` instead of
duplicating those guides here.

## Runtime Expectations

- `python3`, `7z`, `curl`, `unzip`, `tar`, `flock`, `make`, and `g++` are
  required for `install.sh`.
- Native package builders require their format-specific tools (`dpkg-deb`,
  `rpmbuild`, `makepkg`/pacman tooling, or `appimagetool`).
- `scripts/install-deps.sh` bootstraps common host dependencies. On apt-based
  systems, `NODEJS_MAJOR=24 bash scripts/install-deps.sh` selects Node.js 24
  instead of the default NodeSource major.
- The packaged app still needs the Codex CLI at runtime, but launcher preflight
  attempts a best-effort install/update when possible.
