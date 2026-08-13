# Agent Repository Map

This map keeps the detailed file ownership notes out of `AGENTS.md` while
preserving the source-of-truth routing agents need before editing.

## Repo Orchestration

- `install.sh`
  Top-level installer entrypoint. It sources `scripts/lib/*.sh`, keeps the
  high-level build sequence small, and emits `chatgpt/start.sh` from the
  launcher template plus an install-time identity prelude.
- `Makefile`
  Convenience targets for setup, fresh/build/install/package flows, native
  package autodetection, dev side-by-side app identities, AppImage, cleanup,
  and bootstrap workflows. Important targets include `setup-native`,
  `bootstrap-native`, `install-native`, `update-native`, `appimage`, `package`,
  and `install`, plus granular helpers (`build-app`, `build-app-fresh`,
  `rebuild`, `rebuild-install`, `rebuild-next`, `build-dev-app`, `run-app`,
  `run-dev-app`, `inspect-dmg`, `build-updater`, `service-enable`,
  `service-status`, `check`, `test`, `clean-dist`, `clean-state`).
- `scripts/bootstrap-wizard.sh`
  Guided native setup/update helper. It can discover port integrations, edit
  integration config, validate integration relationships, install native packages, and
  perform explicit integration-owned cleanup.
- `Cargo.toml`
  Workspace root for `computer-use-linux`, `read-aloud-linux`,
  `record-replay-linux`, and `updater`.
- `flake.nix` / `flake.lock`
  Nix flake that pins the official DMG, Cargo dependency, and Node dependency
  hashes. Use `scripts/ci/update-nix-hashes.sh` to refresh pins.
- `nix/`
  Nix integration modules: `home-manager-module.nix`, `nixos-module.nix`, and
  `native-modules/` rebuild support for the flake.
- `.devcontainer/devcontainer.json` / `.devcontainer/Dockerfile`
  Generic build/test container with Rust, Node 22/npm, packaging tools,
  `rustfmt`, and `clippy`.

## Launcher

- `launcher/start.sh.template`
  Runtime launcher body. Edit this for webview server lifecycle, warm-start
  handoff, CLI preflight, GUI prompts, URL-scheme handling, runtime Linux
  integration hooks, bundled plugin cache sync, and process/liveness behavior.
  Single-instance enforcement uses an `flock` launcher lock plus serialized
  bootstrap around detection/spawn/`app.pid`, and a `/proc` running-app scan
  filtered by `CHATGPT_LINUX_INSTANCE_ID`.
- `launcher/webview-server.py`
  Standalone Python HTTP server for local webview assets, serving explicit
  no-store/no-cache headers. It is started and supervised by the launcher.
- `packaging/linux/chatgpt-packaged-runtime.sh`
  Native-package-only runtime helper loaded optionally by the launcher.
- `packaging/appimage/chatgpt-appimage-runtime.sh`
  AppImage-only runtime helper.

## Build Pipeline (`scripts/lib/`)

- `install-helpers.sh`
  Argument parsing, dependency checks, identity validation, install-dir
  preparation, logging/color helpers, and shell quoting.
- `build-info.sh` / `build-info.js`
  Build provenance capture: git commit, DMG source, official app and Electron
  versions, enabled integration ids, and target context.
- `node-runtime.sh`
  Managed Linux Node.js runtime download and SHA256 validation. The launcher,
  Browser Use, native module rebuilds, Codex CLI flow, and updater rebuilds use
  this runtime.
- `process-detection.sh`
  Running-app detection used to avoid overwriting a live install.
- `dmg.sh`
  Official DMG download/extraction and Electron-version detection.
- `native-modules.sh`
  Linux rebuild of native modules such as `better-sqlite3` and `node-pty`, plus
  Electron runtime download/cache.
- `asar-patch.sh`
  Drives `scripts/patch-linux-window-ui.js` over the extracted official app.
- `webview-install.sh`
  Webview asset extraction and final `chatgpt/` layout.
- `bundled-plugins.sh`
  Stages bundled Browser Use, Chrome, Linux Computer Use resources, native
  helper binaries, and marketplace metadata.
- `port-integrations.sh` / `port-integrations.js`
  Configurable port integration framework. The JS side discovers
  repository/local integrations, resolves reviewed manifest defaults plus local
  `enabled`, `disabled`, and `settings` overrides, validates dependencies,
  conflicts, entrypoints, resource modes, runtime hooks, and package hooks, and
  exposes patch descriptors. The shell side runs integration staging in the
  install pipeline.
- `package-common.sh`
  Shared package-builder helpers: versioning, payload staging, permission
  normalization, package hook discovery/execution, update-builder staging, and
  user service helper installation.
- `linux-target-context.js`
  Build-time target detection for patch descriptors from `/etc/os-release` and
  environment overrides. Exposes helpers such as `matchesId()`,
  `packageFormatIs()`, `packageManagerIs()`, `desktopMatches()`, and
  `versionAtLeast()`.
- `patch-report.js` / `rebuild-report.sh`
  Structured patch and rebuild reports used by official-app drift validation
  and rebuild-candidate diagnostics.
- `patch-chrome-plugin.js`
  Focused patch helper for Chrome plugin Linux compatibility. The official
  bundle owns its native Linux package updater; the wrapper-updater port
  integration owns local `chatgpt-updater` controls.

## Patch Registry (`scripts/patches/`)

- `scripts/patch-linux-window-ui.js`
  ASAR patcher CLI only: argument parsing, optional JSON report writing, runner
  invocation, and critical gating. Do not import internals from this file.
- `scripts/patches/core/**/patch.js`
  Source of truth for shipped Linux compatibility patch descriptors. New core
  patches should be descriptors under `all-linux/`, `distro/`, `package/`, or
  `desktop/`.
- `scripts/patches/descriptor.js`
  Descriptor factories, phase constants, and CI policy constants. Use
  `mainBundlePatch`, `webviewAssetPatch`, or `extractedAppPatch`.
- `scripts/patches/engine.js`
  Normalizes descriptors, checks duplicate ids, applies target/enabled
  filters, executes phases, captures warnings, and records patch report
  metadata.
- `scripts/patches/runner.js`
  Orchestrates discovered core descriptors plus enabled port integration
  descriptors. It owns `patchExtractedApp`, `patchMainBundleSource`,
  `allPatchPolicies`, and `requiredPatchNamesForProfile`.
- `scripts/patches/impl/` and `scripts/patches/lib/`
  Domain implementations and generic helpers used by descriptors. Do not
  recreate removed compatibility barrels.
- `scripts/patches/core/README.md`
  Descriptor contract. Read it before adding or moving core patches.
- `scripts/patch-linux-window-ui.test.js`
  Node test suite for the patcher.
- `scripts/ci/validate-patch-report.js`
  CI guard for required official-app patches. Mark a descriptor as required only
  when its absence should block `official-dmg-build` CI.

## Port Integrations (`port-integrations/`)

`port-integrations/` is the extension boundary for configurable port integrations.
Detailed contract: `port-integrations/README.md` and
`docs/port-integrations-architecture.md`.

- Repository integrations live under `port-integrations/<integration-id>/`.
- User-local/private integrations live under `port-integrations/local/<integration-id>/`;
  this directory is gitignored.
- `integrations.example.json` is the committed empty override template. The
  active `integrations.json` is gitignored and can add `enabled` ids, suppress
  reviewed defaults with `disabled`, and provide per-integration `settings`.
- `CHATGPT_PORT_INTEGRATIONS_ROOT` and `CHATGPT_PORT_INTEGRATIONS_CONFIG` can override
  integration discovery/config paths for setup and build flows.
- Integration ids use one namespace across repository and local integrations. Local
  integrations cannot shadow repository integrations.
- Repository manifests may set `defaultEnabled: true` after review. Local
  `disabled` entries win over both manifest defaults and `enabled` entries;
  settings are retained only for integrations in the resolved enabled set.
- Every integration must have `integration.json` and `README.md`.
- Manifest `requires` and `conflicts` are validated by setup, installer,
  patcher, and package builders.
- Runtime hook types are `env`, `prelaunch`, `electronArgs`, `launcher`,
  `coldStart`, and `afterExit`; they are staged under
  `chatgpt/.chatgpt-linux/`.
- Declarative resources and runtime hooks are tracked in
  `.chatgpt-linux/port-integrations-staged.json` and removed on the next install
  when their owning integration is disabled. A marker-owned cleanup hook may set
  `retainWhenDisabled: true`; retained hooks must remove only owned artifacts and
  must not activate the disabled integration.
- `packageHooks` run during native package staging with package/app root
  environment variables. They must be idempotent and narrowly scoped.
- Native package builders copy the integration source tree, remove
  checkout-local config files from that copy, and write the full resolved
  `enabled`/`disabled`/`settings` snapshot to
  `.chatgpt-linux/port-integrations.json` in the update-builder bundle. Updater
  rebuilds prefer the persistent per-user override and otherwise preserve that
  packaged snapshot.

Use `port-integrations/` for configurable behavior whose default can change
without moving the implementation into the core patch registry. If an
integration needs more power, add a generic hook or extension point to core
rather than moving the integration itself into core.

## Native Packaging

- `scripts/build-deb.sh`
  Builds `.deb` from an already-generated `chatgpt/`.
- `scripts/build-rpm.sh`
  Builds `.rpm` from `chatgpt/`.
- `scripts/build-pacman.sh`
  Builds `.pkg.tar.zst` from `chatgpt/`.
- `scripts/build-appimage.sh`
  Builds an AppImage using `packaging/appimage/`.
- `packaging/linux/`
  Debian control files, RPM spec, pacman `PKGBUILD.template`/install hooks,
  desktop entry, icon policy, Polkit policy, packaged runtime helper, shared
  user-service maintainer-script helper, and
  `chatgpt-desktop-entry-doctor.sh`.
- `packaging/appimage/`
  AppImage `AppRun`, desktop file, and runtime helper.

The native package payload installs the app under `/opt/chatgpt`, the launcher
under `/usr/bin/chatgpt`, the updater under `/usr/bin/chatgpt-updater`, the
user service at `/usr/lib/systemd/user/chatgpt-updater.service`, desktop/icon
metadata under `/usr/share/`, and the update-builder bundle under
`/usr/lib/chatgpt/update-builder`.

## Updater (`updater/`)

- `updater/src/main.rs` / `app.rs` / `cli.rs`
  Binary entrypoint, top-level dispatcher, and `clap` CLI.
- `builder.rs`
  Drives the packaged update-builder bundle to rebuild packages from newer
  official DMGs.
- `dmg_source.rs`
  Official DMG polling, ETag cache, download, and hash verification.
- `wrapper.rs` / `wrapper_apply.rs` / `changelog.rs` / `integration_picker.rs`
  Wrapper-repo self-update path, separate from the official DMG flow.
- `cache_cleanup.rs`
  Cleanup of updater-managed download/rebuild workspaces under the cache dir.
- `install.rs` / `install_rollback.rs` / `rollback.rs`
  Privileged package install, format-specific install/rollback commands, and
  manual rollback orchestration.
- `codex_cli.rs`
  Codex CLI discovery, version reads, npm-registry preflight checks, and
  install/update flow used by launcher preflight.
- `state.rs` / `config.rs`
  Persisted updater state and runtime config/path resolution.
- `liveness.rs` / `notify.rs` / `logging.rs`
  Electron liveness, desktop notifications, and service logging.
- `test_util.rs`
  Shared test helpers, including serialization of env-mutating tests.

The updater runs unprivileged and only escalates through `pkexec` for
`install-deb`, `install-rpm`, or `install-pacman`.

## Computer Use, Browser, Read Aloud, And Record & Replay

- `notification-actions-linux/`
  Small Rust D-Bus bridge for freedesktop notification action and close
  signals. The main-process core patch uses it only for official-app
  notifications that already carry actions and falls back to Electron otherwise.
- `computer-use-linux/`
  Rust crate for Linux Computer Use MCP, Chrome native messaging host, and the
  COSMIC helper. The backend, bundled plugin, and Linux support patches ship by
  default, while official account eligibility, the persistent installed-and-
  enabled plugin and allowed-app controls, and Codex approval/sandbox policy
  remain authoritative. It covers input, capture, accessibility, terminal,
  identity, and desktop integrations.
- `computer-use-linux/src/windowing/`
  Window backend registry, target resolution, focus verification, and
  backend-specific implementations. Add new compositor/window-manager support
  under `windowing/backends/` and register it in `windowing/registry.rs`;
  avoid backend-specific branches in `server.rs` or `diagnostics.rs`.
- `computer-use-linux/gnome-shell-extension/`
  Bundled GNOME Shell extension used for exact GNOME activation.
- `plugins/openai-bundled/plugins/computer-use/` and `.../read-aloud/`
  Bundled plugin manifests/resources staged into the Linux app.
- `read-aloud-linux/`
  Rust MCP backend for Read Aloud support.
- `record-replay-linux/`
  Rust CLI and stdio MCP backend for the optional Record & Replay Linux
  demo-to-skill workflow.
- `port-integrations/read-aloud/` and `port-integrations/read-aloud-mcp/`
  Reviewed default-enabled integrations for the response-level Read Aloud UI
  and the agent-facing Codex MCP plugin. They remain silent until an explicit
  user or agent action and do not download a voice model during install or first
  launch. Because `conversation-mode` requires `read-aloud`, disable both to
  remove the UI backend; disable `read-aloud-mcp` separately to remove the
  agent-facing plugin.

## User-Local Install

`contrib/user-local-install/` is an opt-in install path for users who do not
want a system-wide native package. The daily-driver flow remains `install.sh`
plus a native `chatgpt` package and `chatgpt-updater`.

- `install-user-local.sh`
  Installs under `${XDG_DATA_HOME:-~/.local/share}/chatgpt`, creates the
  public `~/.local/bin/chatgpt` launcher, and installs a user desktop entry.
- `files/.local/bin/chatgpt`, `chatgpt-check-update`, `chatgpt-update`, and
  `chatgpt-version`
  Launcher and private update/version maintenance payloads. Only `chatgpt` is
  linked into the user's command path.
- `files/share/common.sh`
  Shared helpers for installed maintenance scripts.
- `files/.local/share/applications/chatgpt.desktop`
  User desktop entry installed by the user-local path.
- `files/.config/systemd/user/chatgpt-update.{service,timer}`
  Optional weekly user timer.

## Tests And CI

- `tests/scripts_smoke.sh`
  Top-level smoke suite for shell helpers, package builders, launcher template,
  Electron-version detection, native modules, ASAR patches, and bundled plugin
  staging.
- `tests/fixtures/create-packaged-app-fixture.sh`
  Minimal fake packaged app layout for package-builder tests.
- `tests/webview_probe_equivalence.sh`
  Checks the launcher's webview startup probe stays equivalent to
  `launcher/webview-server.py`.
- `scripts/ci-local.sh`
  Local containerized CI runner. Targets include `pr`, `all`, `core`, `deb`,
  `rpm`, `pacman`, `install-deps[:image]`, `nix`, and `official-dmg`.
- `.github/workflows/`
  GitHub Actions for CI, Official DMG app builds, install-deps, Cachix, Nix hash
  refreshes, and Computer Use sync reminders.

## Docs

- `docs/README.md`
  Role- and task-oriented documentation index. Start here when a task spans
  more than one documentation surface.
- `README.md`
  Public project overview and fast install entrypoint.
- `CONTRIBUTING.md`
  Contributor expectations, including the latest-DMG-only drift policy.
- `CHANGELOG.md`
  Release notes.
- `docs/port-architecture.md`
  Explanation of the official DMG conversion, app generation, patching,
  launcher, packaging, and updater boundaries.
- `docs/usage/build-and-run.md`
  User how-to for prerequisites, local generation, native packages, Nix,
  guided setup, Computer Use readiness, and service commands.
- `docs/usage/troubleshooting.md`
  Symptom-oriented launch, CLI, webview, package, updater, migration, and
  Computer Use diagnostics.
- `docs/usage/support-routing.md`
  Routing between OpenAI, the Linux-port upstream, and this finishing fork.
- `port-integrations/README.md`
  User and contributor guide to reviewed defaults, local overrides, settings,
  integration lifecycle, and validation.
- `docs/port-integrations-architecture.md`
  Maintainer-facing port integration architecture and manifest/hook contract.
- `docs/maintainers/package-runtime-maintenance.md`
  Source, generated-output, package-payload, updater, versioning, and
  validation reference.
- `docs/maintainers/fork-divergences.md` and
  `docs/maintainers/fork-sync-policy.md`
  Intentional local contracts and rename-aware Linux-port upstream sync policy.
- `docs/record-and-replay-linux.md`
  Linux Record & Replay compatibility and tester acceptance notes.
- `docs/upstream-dmg-acceptance.md`
  Shared acceptance policy for local installs, updater rebuilds, and CI.
- `docs/upstream-dmg-intelligence.md`
  Protected-surface inspection and official-app drift intelligence.
- `docs/upstream-dmg-watchdog.md`
  Scheduled Official DMG campaign and issue lifecycle.
- `docs/label-governance.md`
  Staff-managed issue and pull request label policy.
- `docs/github-cli-auth.md`
  GitHub CLI authentication behavior in app-launched shells.
- `docs/wayland-input-focus-investigation.md` and
  `docs/linux-chronicle-skysight.md`
  Focused investigation and integration notes for Linux-specific workflows.
- `docs/webview-server-evaluation.md` and `docs/launcher-performance.md`
  Decision records for the webview server and launcher performance defaults.
