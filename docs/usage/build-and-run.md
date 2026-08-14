# Build and Run Guide

This guide is for users who want to run ChatGPT on Linux or build a native
package from this repository.

## Prerequisites

You need:

- `python3`;
- `7z` or `7zz`;
- `curl`;
- `unzip`;
- `tar`;
- `make`;
- `g++` or equivalent C++ build tooling;
- Rust and `cargo` for local source builds of `chatgpt-updater` and for app
  generation when `CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE` does not name
  a validated prebuilt broker.

Public releases additionally require a root-managed multi-user Nix daemon, a
root-owned canonical Nix store, `sandbox = true`, GnuPG, a trusted system Node.js
runtime, and the package tools for the selected native format. The public gate
builds the static updater and mutation broker in the `release-helpers` Nix
output from the reviewed source snapshot. Packaged updater rebuilds use the
package-owned prebuilt broker.

The installer downloads and bundles a managed Linux Node.js runtime for the
generated app, Browser Use, Codex CLI install/update flow, and updater rebuilds.
System `node`, `npm`, and `npx` remain useful for development and tests, but
normal app and package builds do not depend on distro Node.js packages.

The dependency helper supports `apt`, `dnf5`, `dnf`, `zypper`, and `pacman`:

```bash
bash scripts/install-deps.sh
```

On hardened systems where `/tmp` is mounted `noexec`, the Rust installer and
managed Linux Node.js runtime may fail when they try to execute temporary files.
Use executable user-owned locations for temporary and cache files before
running install or build commands:

```bash
mkdir -p ~/tmp/chatgpt-work ~/tmp/chatgpt-cache
export TMPDIR=~/tmp/chatgpt-work
export XDG_CACHE_HOME=~/tmp/chatgpt-cache
```

The generated launcher can install `@openai/codex` on first run when the CLI is
missing. To install it before launching:

```bash
npm i -g --include=optional @openai/codex
```

If global npm installs require elevated privileges, install under `~/.local`:

```bash
npm i -g --prefix ~/.local --include=optional @openai/codex
```

## Upgrading Existing Wrapper State

Native `chatgpt` packages replace the former `codex-app` and `codex-desktop`
package identities without installing legacy commands or service aliases. Before
starting any canonical runtime component, ChatGPT moves wrapper-owned XDG data
to the `chatgpt` and `chatgpt-updater` identities with a crash-durable journal.

The migration refuses collisions, symlinks, unexpected file types, and
cross-filesystem moves. If it reports a collision, do not merge or delete either
tree manually; follow the exact `Recovery command:` it prints. A forward recovery
ends by running `chatgpt`. To reverse a completed migration after closing the
app, run:

```bash
chatgpt migrate-state --reverse
```

Reverse migration restores former directory names only. It does not reinstall
the old package or add compatibility shims.

## Distro Notes

### Ubuntu And Pop!_OS

Ubuntu-family `p7zip-full` packages can be too old to extract newer APFS DMGs.
`scripts/install-deps.sh` bootstraps a newer `7zz` into `~/.local/bin` by
default. Set `SEVENZIP_SYSTEM_INSTALL=1` to install it under `/usr/local/bin`
instead. The bootstrap accepts only source-controlled archive and executable
SHA-256 identities from `scripts/lib/sevenzip-bootstrap.sh`:

```bash
bash scripts/install-deps.sh
```

For a manual installation, prefer a distribution package with signed metadata.
Do not install a downloaded `7zz` archive without independently verifying its
published identity.

### Fedora

Run the dependency helper:

```bash
bash scripts/install-deps.sh
```

It installs Python, 7z, curl, build tools, and bootstraps Rust through `rustup`
if `cargo` is missing. Fedora 41+ uses the app's managed Node.js runtime
instead of requiring distro `nodejs` and `npm` packages.

### Arch Linux

Run the dependency helper:

```bash
bash scripts/install-deps.sh
```

Or install the system packages directly:

```bash
sudo pacman -S --needed python p7zip curl unzip zstd base-devel
```

Install Rust through `rustup` if `cargo` is still missing:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### NixOS

Run the flake:

```bash
nix run github:nisavid/codex-app-linux
```

The default app runs the Nix-store build directly. Use
`nix run github:nisavid/codex-app-linux#installer` only when you want the
installer to generate `chatgpt/` in the current checkout.

Or enter a development shell:

```bash
nix develop github:nisavid/codex-app-linux
```

The flake pins the SRI hash of the official OpenAI `ChatGPT.dmg`. OpenAI
republishes the DMG at the same URL for each release, so the hash can
temporarily lag. A GitHub Actions job refreshes the hash on `main` once every
24 hours. If you see:

```text
error: hash mismatch in fixed-output derivation
```

retry after the scheduled job has had time to run. If the mismatch remains,
open an issue.

## Generate The Local App

```bash
make build-app
```

This creates `chatgpt/` and writes the Linux launcher to
`chatgpt/start.sh`.

Run the generated app:

```bash
make run-app
```

Equivalent direct command:

```bash
./chatgpt/start.sh
```

If you want a shell shortcut for checkout builds:

```bash
echo 'alias chatgpt="~/chatgpt-linux/chatgpt/start.sh"' >> ~/.bashrc
```

To use a DMG you already have:

```bash
make build-app DMG=/path/to/ChatGPT.dmg
```

If Electron runtime or header downloads from the default endpoints are slow or
blocked, point the build at a mirror:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
make build-app
```

`ELECTRON_HEADERS_URL` controls the Electron header URL passed to
`@electron/rebuild --dist-url`; it must provide both
`node-v<version>-headers.tar.gz` and the matching `SHASUMS256.txt`.

For a side-by-side test build with a distinct app id and webview port:

```bash
make build-dev-app
make run-dev-app
```

Override the side-by-side identity with Make variables:

```bash
DEV_APP_ID=chatgpt-test DEV_APP_NAME="ChatGPT Test" make build-dev-app
```

Override the webview port by exporting it for the build command:

```bash
CHATGPT_WEBVIEW_PORT=5180 make build-dev-app
```

### Port Integrations

Port integrations are build-time integration modules that adapt official ChatGPT app
behavior and local runtime helpers to this Linux port. The source path is
`port-integrations/`.

The default set includes the established workflow, wrapper update, remote-control,
speech, and Open Target Discovery integrations plus reviewed API-key metadata,
global dictation, Omarchy theme, persistent status, Pet Overlay, project sorting,
shared app-server socket, SSH routing, and UI Tweaks. Authenticated proxy, Codex
Micro, directory-only and shallow repository watches, MCP helper reaping, and
Record & Replay remain disabled by default.

Default enablement preserves each integration's runtime controls. Agent Workspaces
keeps its workspace approval and permission flow; AppShots keeps global hotkeys
inactive until selected; wrapper checks stay off until enabled in Settings; the
official ChatGPT/Codex Dock-icon selector is opt-in and mutates only marker-owned
ChatGPT files when enabled; and Suggested
Prompts requires official-app eligibility, the user setting, and a current local
Linux patch contract. Main-process hardening for direct workspace bridge calls is
tracked in [#99](https://github.com/nisavid/codex-app-linux/issues/99).

To disable default integrations or enable still-optional integrations, copy
`port-integrations/integrations.example.json` to the git-ignored
`port-integrations/integrations.json`, edit the `enabled` and `disabled` lists, then
rebuild. Packaged installs can use
`${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt/port-integrations.json` for the same
override shape; checkout builds ignore that persistent user file and use
`port-integrations/integrations.json` or `CHATGPT_PORT_INTEGRATIONS_CONFIG` instead. See
[`port-integrations/README.md`](../../port-integrations/README.md) for the integration
contract.

### Linux Computer Use Controls And Readiness

The Linux Computer Use backend, plugin manifest, and Linux support patches are
packaged by default. They preserve the official app's account and rollout
eligibility, persistent plugin and allowed-app controls, and Codex tool approval,
sandboxing, and auto-approval policy. This fork adds no separate consent setting
or prompt. Disable or revoke the feature through those existing controls.

Runtime readiness is separate from authorization. Input synthesis usually
requires `ydotool`/`ydotoold`, `/dev/uinput` access, and a socket usable by your
desktop user. Non-GNOME desktops usually also need the matching XDG Desktop
Portal backend, such as the KDE or wlroots portal.

Treat Computer Use readiness as a set of independent paths. `doctor` can report
that AT-SPI, screenshots, window targeting, and input are available even when a
specific target app exposes only a sparse accessibility tree. In that case,
semantic actions may be unavailable while screenshots, window focus, and pointer
input still work.

Some non-GNOME sessions still use the historical
`org.gnome.desktop.interface toolkit-accessibility` setting to enable toolkit
accessibility bridges. The setting name does not imply that GNOME Shell is
required.

Raw key synthesis is evaluated by the active desktop layout after the backend
sends the key event. Non-QWERTY layouts, remapped keys, and custom Compose keys
can change both literal key output and shortcuts such as paste. For predictable
literal-key testing, record the current layout, switch temporarily to a standard
US/QWERTY layout, retry the action, then restore the original layout.

After building the app, inspect local readiness with:

```bash
./chatgpt/resources/plugins/openai-bundled/plugins/computer-use/bin/chatgpt-computer-use-linux doctor
./chatgpt/resources/plugins/openai-bundled/plugins/computer-use/bin/chatgpt-computer-use-linux setup
./chatgpt/resources/plugins/openai-bundled/plugins/computer-use/bin/chatgpt-computer-use-linux apps
./chatgpt/resources/plugins/openai-bundled/plugins/computer-use/bin/chatgpt-computer-use-linux windows
```

To remove the existing generated tree and redownload the DMG:

```bash
./install.sh --fresh
```

## Guided Native Setup

Run `make setup-native` when you want a host preflight summary before choosing
the build and install commands. The helper reports package-manager, desktop
session, package-format, updater, Computer Use, Read Aloud, and optional port
integration readiness. It can write `port-integrations/integrations.json`
for the next build, but it does not implicitly build, package, or install.

For non-interactive integration config:

```bash
CHATGPT_PORT_INTEGRATIONS=remote-mobile-control,read-aloud \
CHATGPT_DISABLE_PORT_INTEGRATIONS=conversation-mode \
CHATGPT_BOOTSTRAP_NONINTERACTIVE=1 \
make setup-native
```

To let the helper run the existing install flow, opt in explicitly:

```bash
CHATGPT_BOOTSTRAP_INSTALL_DEPS=1 \
CHATGPT_BOOTSTRAP_INSTALL_NATIVE=1 \
make setup-native
```

## Build Native Packages

Packaging scripts require `chatgpt/` to exist. Run `make build-app` first.

Build the package type for the current host:

```bash
make package
```

Build a specific format:

```bash
make deb
make rpm
make pacman
make appimage
```

You can also run builders directly:

```bash
./scripts/build-deb.sh
./scripts/build-rpm.sh
./scripts/build-pacman.sh
./scripts/build-appimage.sh
```

App generation writes a sibling external receipt at
`.chatgpt-generation-receipts/<app-manifest-sha256>.json`. It binds the exact
mutation broker, generated app manifest, and `.chatgpt-linux/build-info.json`.
Keep the generated app and receipt root together. Debian, RPM, and pacman
builders validate the receipt before copying any app bytes into package staging.

The approved offline `@parcel/watcher` bundle supports Linux glibc on x86_64,
arm64/aarch64, and ARMv7 hard-float hosts. Unsupported platforms,
architectures, libc variants, and ARM ABIs fail before npm or the native module
load runs.

Set `PACKAGE_WITH_UPDATER=0` when you need a native package that does not
install `chatgpt-updater`, its `systemd --user` service, or the privileged
update support files:

```bash
PACKAGE_WITH_UPDATER=0 make package
PACKAGE_WITH_UPDATER=0 ./scripts/build-deb.sh
```

The legacy `PACKAGE_ENABLE_UPDATER=0` spelling is still accepted for older
local scripts, but new package commands should use `PACKAGE_WITH_UPDATER=0`.
No-updater packages are local/manual-update artifacts and cannot pass the
public release gate.

By default, `install.sh` reads `ChatGPT.app/Contents/Info.plist` from the
extracted DMG and writes `chatgpt/chatgpt-version.env`. Package builders use
that metadata, so an official OpenAI app bundle version such as
`26.422.30944 (2080)` becomes package version `26.422.30944`. Generated app
package versions use three or four numeric dot-separated segments so the updater
can compare installed and candidate versions consistently.

Override the package version only when you need to rebuild a known app tree with
an explicit local version:

```bash
PACKAGE_VERSION=26.422.30944 ./scripts/build-deb.sh
PACKAGE_VERSION=26.422.30944 ./scripts/build-rpm.sh
PACKAGE_VERSION=26.422.30944 ./scripts/build-pacman.sh
```

Expected outputs:

```text
dist/chatgpt_<app-version>_<arch>.deb
dist/chatgpt-<app-version>-1.<arch>.rpm
dist/chatgpt-<app-version>-1-<arch>.pkg.tar.zst
dist/chatgpt-<app-version>-<arch>.AppImage
```

Architecture names follow the package format: Debian uses `amd64`, `arm64`, or
`armhf`; RPM uses `x86_64`, `aarch64`, or `armv7hl`; pacman uses `x86_64` or
`aarch64`.

AppImages are manual-update artifacts. They omit `chatgpt-updater`, the
systemd user service, polkit policy, and the native-package update-builder
bundle.

Native packages are named `chatgpt`. They declare replacement metadata for
the former `codex-app` and `codex-desktop` package names where the package
format supports it. They do not install compatibility shims; the launcher and
app layout are `/usr/bin/chatgpt` and `/opt/chatgpt`.

Install the newest package in `dist/`:

```bash
make install
```

On Arch, direct installation also works:

```bash
sudo pacman -U dist/chatgpt-*.pkg.tar.zst
```

## Updater Service

Native packages install `chatgpt-updater` and its `systemd --user` service.
The service checks for newer official OpenAI ChatGPT DMGs, rebuilds a local
native package, and uses privileged installation only for the final package
install.

Enable and start the service:

```bash
make service-enable
```

Inspect it:

```bash
make service-status
systemctl --user status chatgpt-updater.service
chatgpt-updater status --json
```

These targets make sense after installing a native package. A repo-only build
does not install the service unit or updater binary into the system.

## Make Targets

```bash
make help
make check
make test
make build-updater
make build-app
make run-app
make deb
make rpm
make pacman
make appimage
make package
make apple-dmg-verify
make release-gate
make install
make service-enable
make service-status
make clean
make clean-dist
make clean-state
```

`make appimage` builds a manual-update AppImage through
`./scripts/build-appimage.sh`; it consumes the generated `chatgpt/` tree,
stages the AppDir templates under `packaging/appimage/`, and writes the
resulting `.AppImage` to `dist/`. `APPIMAGETOOL=/path/to/appimagetool` can
override the AppImage tool command. `make package` detects the native package
manager on the host and builds the matching package type. `make release-gate`
defaults to public-release mode: it verifies the reviewed official OpenAI
ChatGPT DMG, snapshots the reviewed source, builds `chatgpt-release-app` and
`release-helpers` through the root-managed sandboxed Nix daemon, and requires
the submitted app to match the independent reference exactly. Candidate
packages must be built from that reference; the gate uses it as the independent
app and package authority and verifies each payload and its install controls.
RPM bytes must match the deterministic reference. Public packages require
`PACKAGE_WITH_UPDATER=1` and include `chatgpt-updater`. The gate writes
`dist/SHA256SUMS` and `dist/RELEASE-PROVENANCE.json`, and requires both files to
be signed by the exact primary fingerprint supplied through
`CHATGPT_RELEASE_GPG_FINGERPRINT`. Set
`CHATGPT_RELEASE_REHEARSAL=1` for a local rehearsal that cannot claim
public-release eligibility. Signed gates also publish
`dist/release-signing-key.asc` and verify both signatures against that public
key. Verify its fingerprint through an independently trusted project channel;
the co-published key alone does not establish signer identity. `make install`
installs the newest built native package.
`make clean` removes generated build artifacts: `chatgpt/`, its sibling
`.chatgpt-generation-receipts/` directory, `ChatGPT.dmg`, and `dist/`.
`make clean-state` removes updater runtime state under XDG directories.

## Build Flow Overview

The build flow is:

1. extract `ChatGPT.dmg` with `7z` or `7zz`;
2. download or reuse the managed Linux Node.js runtime;
3. extract and patch `app.asar`;
4. rebuild native Node.js modules for Linux;
5. download a Linux Electron runtime;
6. write `chatgpt/start.sh`;
7. publish the external content-addressed receipt that binds the mutation
   broker, generated app manifest, and build info;
8. optionally package `chatgpt/` as a Debian, RPM, pacman, or AppImage
   artifact;
9. when installed from a native package, run `chatgpt-updater` as a
   `systemd --user` service for local update checks and package rebuilds.

The macOS ChatGPT app is an Electron application. The installer replaces its
platform-specific runtime pieces, rebuilds Linux native modules, applies the
descriptor registry, validates the generated app, and only then packages it.
For the component boundaries and rationale, use
[Port Architecture](../port-architecture.md). For manifest, descriptor, hook,
resource, and updater-selection details, use
[Port Integration Architecture](../port-integrations-architecture.md).
