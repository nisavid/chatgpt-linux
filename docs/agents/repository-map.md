# Agent Repository Map

This map keeps the detailed file ownership notes out of `AGENTS.md` while
preserving the source-of-truth routing agents need before editing.

## Repo Orchestration

- `install.sh`
  Top-level installer entrypoint. It sources `scripts/lib/*.sh`, keeps the
  high-level build sequence small, and emits `codex-app/start.sh` from the
  launcher template plus an install-time identity prelude.
- `Makefile`
  Convenience targets for setup, fresh/build/install/package flows, native
  package autodetection, dev side-by-side app identities, AppImage, cleanup,
  and bootstrap workflows. Important targets include `setup-native`,
  `bootstrap-native`, `install-native`, `update-native`, `appimage`, `package`,
  and `install`, plus granular helpers (`build-app`, `build-app-fresh`,
  `rebuild`, `rebuild-install`, `rebuild-next`, `build-dev-app`, `run-app`,
  `run-dev-app`, `inspect-upstream`, `build-updater`, `service-enable`,
  `service-status`, `check`, `test`, `clean-dist`, `clean-state`).
- `scripts/bootstrap-wizard.sh`
  Guided native setup/update helper. It can discover port integrations, edit
  integration config, validate integration relationships, install native packages, and
  perform explicit integration-owned cleanup.
- `Cargo.toml`
  Workspace root for `computer-use-linux`, `read-aloud-linux`,
  `record-replay-linux`, and `updater`.
- `flake.nix` / `flake.lock`
  Nix flake that pins upstream DMG, Cargo dependency, and Node dependency
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
  filtered by `CODEX_LINUX_INSTANCE_ID`.
- `launcher/webview-server.py`
  Standalone Python HTTP server for local webview assets, serving explicit
  no-store/no-cache headers. It is started and supervised by the launcher.
- `packaging/linux/codex-packaged-runtime.sh`
  Native-package-only runtime helper loaded optionally by the launcher.
- `packaging/appimage/codex-appimage-runtime.sh`
  AppImage-only runtime helper.

## Build Pipeline (`scripts/lib/`)

- `install-helpers.sh`
  Argument parsing, dependency checks, identity validation, install-dir
  preparation, logging/color helpers, and shell quoting.
- `build-info.sh` / `build-info.js`
  Build provenance capture: git commit, DMG source, upstream/Electron versions,
  enabled integration ids, and target context.
- `node-runtime.sh`
  Managed Linux Node.js runtime download and SHA256 validation. The launcher,
  Browser Use, native module rebuilds, Codex CLI flow, and updater rebuilds use
  this runtime.
- `process-detection.sh`
  Running-app detection used to avoid overwriting a live install.
- `dmg.sh`
  DMG download/extraction and upstream Electron-version detection.
- `native-modules.sh`
  Linux rebuild of native modules such as `better-sqlite3` and `node-pty`, plus
  Electron runtime download/cache.
- `asar-patch.sh`
  Drives `scripts/patch-linux-window-ui.js` over the extracted upstream app.
- `webview-install.sh`
  Webview asset extraction and final `codex-app/` layout.
- `bundled-plugins.sh`
  Stages bundled Browser Use, Chrome, Linux Computer Use resources, native
  helper binaries, and marketplace metadata.
- `port-integrations.sh` / `port-integrations.js`
  Opt-in port integration framework. The JS side discovers repository/local
  integrations, validates manifests, dependencies, conflicts, entrypoints,
  resource modes, runtime hooks, package hooks, and exposes patch descriptors.
  The shell side runs integration staging in the install pipeline.
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
  Structured patch and rebuild reports used by upstream drift validation and
  rebuild-candidate diagnostics.
- `patch-chrome-plugin.js` / `linux-update-bridge-patch.js`
  Focused patch helpers for Chrome plugin Linux compatibility and the in-app
  updater bridge.

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
  CI guard for required upstream patches. Mark a descriptor as required only
  when its absence should block upstream-build CI.

## Port Integrations (`port-integrations/`)

`port-integrations/` is the extension boundary for optional Linux integrations.
Detailed contract: `port-integrations/README.md` and
`docs/port-integrations-architecture.md`.

- Repository integrations live under `port-integrations/<integration-id>/`.
- User-local/private integrations live under `port-integrations/local/<integration-id>/`;
  this directory is gitignored.
- `integrations.example.json` is the committed empty template. The active
  `integrations.json` is gitignored and lists enabled ids.
- `CODEX_PORT_INTEGRATIONS_ROOT` and `CODEX_PORT_INTEGRATIONS_CONFIG` can override
  integration discovery/config paths for setup and build flows.
- Integration ids use one namespace across repository and local integrations. Local
  integrations cannot shadow repository integrations.
- `defaultEnabled: true` is rejected. Optional integrations are always opt-in.
- Every integration must have `integration.json` and `README.md`.
- Manifest `requires` and `conflicts` are validated by setup, installer,
  patcher, and package builders.
- Runtime hook types are `env`, `prelaunch`, `electronArgs`, `launcher`,
  `coldStart`, and `afterExit`; they are staged under
  `codex-app/.codex-linux/`.
- Declarative resources and runtime hooks are tracked in
  `.codex-linux/port-integrations-staged.json` and removed on the next install
  when their owning integration is disabled.
- `packageHooks` run during native package staging with package/app root
  environment variables. They must be idempotent and narrowly scoped.
- Native package update-builder bundles preserve the enabled integration id list
  and configured integration root, including local integrations, so local auto-updates
  keep the same opt-in integrations.

Use `port-integrations/` for anything useful to some users but not mandatory for
the baseline Linux app. If an integration needs more power, add a generic hook or
extension point to core rather than moving the integration itself into core.

## Native Packaging

- `scripts/build-deb.sh`
  Builds `.deb` from an already-generated `codex-app/`.
- `scripts/build-rpm.sh`
  Builds `.rpm` from `codex-app/`.
- `scripts/build-pacman.sh`
  Builds `.pkg.tar.zst` from `codex-app/`.
- `scripts/build-appimage.sh`
  Builds an AppImage using `packaging/appimage/`.
- `packaging/linux/`
  Debian control files, RPM spec, pacman `PKGBUILD.template`/install hooks,
  desktop entry, icon policy, Polkit policy, packaged runtime helper, shared
  user-service maintainer-script helper, and
  `codex-desktop-entry-doctor.sh`.
- `packaging/appimage/`
  AppImage `AppRun`, desktop file, and runtime helper.

The native package payload installs the app under `/opt/codex-desktop`, the
launcher under `/usr/bin/codex-desktop`, the updater under
`/usr/bin/codex-update-manager`, the user service under
`/usr/lib/systemd/user/`, desktop/icon metadata under `/usr/share/`, and an
update-builder bundle under `/opt/codex-desktop/update-builder`.

## Updater (`updater/`)

- `updater/src/main.rs` / `app.rs` / `cli.rs`
  Binary entrypoint, top-level dispatcher, and `clap` CLI.
- `builder.rs`
  Drives the packaged update-builder bundle to rebuild packages from newer
  upstream DMGs.
- `upstream.rs`
  Upstream DMG polling, ETag cache, download, and hash verification.
- `wrapper.rs` / `wrapper_apply.rs` / `changelog.rs` / `feature_picker.rs`
  Wrapper-repo self-update path, separate from the upstream DMG flow.
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
  signals. The main-process core patch uses it only for upstream notifications
  that already carry actions and falls back to Electron otherwise.
- `computer-use-linux/`
  Rust crate for Linux Computer Use MCP, Chrome native messaging host, and the
  COSMIC helper. It covers input, capture, accessibility, terminal, identity,
  and desktop integrations.
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
  Rust MCP backend for optional Read Aloud support.
- `record-replay-linux/`
  Rust CLI and stdio MCP backend for the optional Record & Replay Linux
  demo-to-skill workflow.
- `port-integrations/read-aloud/` and `port-integrations/read-aloud-mcp/`
  Optional port integrations for Read Aloud patching/staging/integration.

## User-Local Install

`contrib/user-local-install/` is an opt-in install path for users who do not
want a system-wide native package. The daily-driver flow remains `install.sh`
plus a native package plus `codex-update-manager`.

- `install-user-local.sh`
  Installs under `~/.local/opt/codex-desktop-linux`, creates wrappers under
  `~/.local/bin`, and installs a user desktop entry.
- `files/.local/bin/codex-desktop{,-update,-check-update,-version}`
  Installed launcher and update/version maintenance wrappers.
- `files/.local/lib/codex-desktop-linux/common.sh`
  Shared helpers for installed maintenance scripts.
- `files/.local/share/applications/codex-desktop.desktop`
  User desktop entry installed by the user-local path.
- `files/.config/systemd/user/codex-desktop-update.{service,timer}`
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
  `rpm`, `pacman`, `install-deps[:image]`, `nix`, and `upstream`.
- `.github/workflows/`
  GitHub Actions for CI, upstream app builds, install-deps, Cachix, Nix hash
  refreshes, and Computer Use sync reminders.

## Docs

- `README.md`
  Public install/usage entrypoint.
- `CONTRIBUTING.md`
  Contributor expectations, including the latest-DMG-only drift policy.
- `CHANGELOG.md`
  Release notes.
- `docs/architecture.md`
  High-level architecture overview of the repo and runtime flow.
- `docs/build-and-packaging.md`
  Build pipeline and native package builder reference.
- `docs/native-setup.md`
  Guided native setup/install/update walkthrough.
- `docs/updater.md`
  Update manager design, states, and operations.
- `docs/port-integrations-architecture.md`
  Port integration framework contract.
- `docs/linux-computer-use.md`
  Linux Computer Use backend, windowing, and desktop integration notes.
- `docs/record-and-replay-linux.md`
  Linux Record & Replay compatibility and tester acceptance notes.
- `docs/upstream-dmg-acceptance.md`
  Shared acceptance policy for local installs, updater rebuilds, and CI.
- `docs/upstream-dmg-intelligence.md`
  Protected-surface inspection and upstream drift intelligence.
- `docs/upstream-dmg-watchdog.md`
  Scheduled upstream DMG campaign and issue lifecycle.
- `docs/nix.md`
  Nix flake, modules, and hash-pin workflow.
- `docs/troubleshooting.md`
  Common install/runtime issues and diagnostics.
- `docs/label-governance.md`
  Staff-managed issue and pull request label policy.
- `docs/github-cli-auth.md`
  GitHub CLI authentication behavior in app-launched shells.
- `docs/wayland-input-focus-investigation.md` and
  `docs/linux-chronicle-skysight.md`
  Focused investigation and integration notes for Linux-specific workflows.
- `docs/webview-server-evaluation.md` and `docs/launcher-performance.md`
  Decision records for the webview server and launcher performance defaults.
