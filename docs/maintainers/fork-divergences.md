# Fork Divergences

> [!NOTE]
> This inventory is a non-executable historical record of the final maintained
> divergence state. The repository is retired and unsupported. Do not use it to
> start or continue sync, build, package, release, or security work. See
> [Repository Retirement](../retirement.md).

This reference records the intentional differences between this fork and the
last synced ref from the Linux-port upstream. In this document, `upstream` means
that remote unless a sentence names another surface. The inventory was used
during upstream syncs to preserve local contracts and keep divergence claims
grounded in the synced baseline. These differences formed a finishing layer:
upstream owned the primary Linux app conversion and much of the runtime
support, while this fork preserved local names, paths, updater policy,
hardening, security review, packaging polish, and maintainer policy.

## Upstream Terminology

The final maintained documentation used these terms from `AGENTS.md`:

- `Linux-port upstream`: `ilysenko/codex-desktop-linux`, the git remote named
  `upstream`, and sync work that imports that repository's Linux conversion
  changes.
- `Official OpenAI ChatGPT DMG`: the OpenAI-distributed macOS app artifact used
  as app-generation input.
- `Official OpenAI app bundle`: the `ChatGPT.app` bundle extracted from the DMG
  and patched for Linux.
- `OpenAI-hosted services`: account, rollout, entitlement, remote-control, and
  other service-side behavior outside this fork's local packaging path.

Specific terms distinguished the Linux-port upstream from the official OpenAI
app, DMG, app bundle, and hosted services. Once a surface was clear, concise
terms such as `upstream`, `DMG`, or `app bundle` appeared in the record.

The final comparison baseline is upstream commit
`efe491761d9075341fe79f564631a6dd9aafd291` (2026-07-30). Claims below describe
the current tree's diff against that baseline, with current source files taking
precedence over generated output.

## Final Source Decision

After this baseline, the Linux-port upstream switched its app input to OpenAI's
signed Linux APT package. This fork remained a DMG-based maintenance fallback
until the signed Linux package was accepted as its successor. Both native
packages owned the `chatgpt` identity and were mutually exclusive on one host.
The accepted switch, rollback evidence, and delayed cleanup boundary are
recorded in [Repository Retirement](../retirement.md).

## Historical Sync Review Record

Before retirement, sync reviews compared incoming changes with every
divergence area below. They preserved local naming, layout, versioning, updater,
package, and security boundaries; recorded uncertain conflicts in the sync
ledger; and bound generated-app or package changes to local build evidence.
This record no longer defines a sync procedure.

The layout rules for this fork follow, in order, the XDG Base Directory
Specification, the Filesystem Hierarchy Standard, and common distro conventions
for modern Electron-style app bundles.

## Final Maintained Rename And Compatibility Map

This map recorded the rename and compatibility relationships applied during
the final maintained syncs. It is retained for provenance only.

| Old target or token | Final local target or token | Historical sync relevance |
| --- | --- | --- |
| Former repository slug `nisavid/codex-app-linux` | Canonical repository `nisavid/chatgpt-linux` | The in-place rename preserved repository and fork identity. New operations and durable links used the canonical slug. |
| Local package, command, desktop, and app/XDG identity `codex-app` | `chatgpt` | Native package metadata replaces/conflicts with the old package, but no executable, desktop, service, or filesystem shim is installed. Wrapper-owned XDG directories move through the journaled state migration. |
| Local updater crate, command, service, and XDG identity `codex-app-updater` | `chatgpt-updater` | Package lifecycle hooks disable the old service and enable the canonical service when policy permits. Updater config, state, and cache move through the same migration; no service alias is installed. |
| Generated metadata root `.codex-linux/` and local setting keys beginning `codex-linux-` | `.chatgpt-linux/` and `chatgpt-linux-` | The migration rewrites known wrapper-owned text files and moves the CLI quarantine directory. Generated output uses only canonical names. |
| Port integration id and path `codex-wrapper-updater` | `chatgpt-wrapper-updater` | The old integration id is absent. Persisted wrapper-owned text is rewritten during state migration. |
| Port-owned `CODEX_*` environment variables | Corresponding `CHATGPT_*` names | Old port-owned names are rejected or ignored rather than treated as compatibility aliases. Inherited OpenAI Codex CLI, app-server, plugin, browser-use, Node REPL, bundle, skill, and protocol variables retain `CODEX_*`. |
| Port-owned `CODEX_MICRO_NODE_HID_ARCHIVE` | `CHATGPT_MICRO_NODE_HID_ARCHIVE` | The Nix build override belongs to the Linux-port integration, not the official Codex Micro protocol. Old installer or launcher input is rejected. |
| Port-owned `CODEX_PRIMARY_RUNTIME_ROOT` and `CODEX_RUNTIME_ROOT` | `CHATGPT_PRIMARY_RUNTIME_ROOT` and `CHATGPT_RUNTIME_ROOT` | The Nix launcher overrides were introduced by the Linux port. The underlying OpenAI runtime artifact and `codex-runtimes/codex-primary-runtime` cache path keep their upstream names. |
| `.github/workflows/upstream-build-app.yml` | `.github/workflows/official-dmg-build-app.yml` | Final syncs ported incoming workflow edits here. |
| `updater/src/upstream.rs` | `updater/src/dmg_source.rs` | Final syncs ported incoming updater source edits here. |
| patch `ciPolicy: "required-upstream"` | `ciPolicy: "required-official-dmg"`; the old value is accepted only as a legacy alias | Final syncs ported incoming required-patch policy edits to the current token unless intentionally preserving compatibility aliases. |
| patch-report profile `upstream-build` | `official-dmg-build`; the old profile is accepted only as a legacy alias | Final syncs ported incoming validation-profile edits to the current profile name. |
| CI job or local CI target `upstream` for official DMG validation | `official-dmg`; the old target is accepted only as a legacy alias | Final syncs ported incoming official DMG validation job/target changes to the current name. |
| `UPSTREAM_DMG_URL`, `UPSTREAM_DMG_PATH`, `UPSTREAM_DMG_CACHE_HIT` | `OFFICIAL_DMG_URL`, `OFFICIAL_DMG_PATH`, `OFFICIAL_DMG_CACHE_HIT`; old variables are legacy aliases | Final syncs ported incoming official DMG environment changes to the current variables and preserved legacy fallbacks only for compatibility. |
| Port integration hook `CODEX_UPSTREAM_APP_DIR` | `CHATGPT_OFFICIAL_APP_DIR`; the old port-owned variable is obsolete | Final syncs ported stage-hook environment changes to the current variable; the obsolete alias remained absent. |
| Make target `inspect-upstream` | `inspect-dmg`; the old target is a legacy alias | Final syncs ported inspect-target behavior to `inspect-dmg`; the old target remained only as a legacy alias. |
| `packaging/appimage/codex-desktop.desktop` | `packaging/appimage/chatgpt.desktop` | Final syncs ported incoming AppImage desktop-entry edits to the current local AppImage desktop entry. |
| `packaging/linux/codex-desktop.spec`, `packaging/linux/codex-desktop.install`, `packaging/linux/codex-desktop.desktop`, and `packaging/linux/codex-desktop-entry-doctor.sh` | `packaging/linux/chatgpt.spec`, `packaging/linux/chatgpt.install`, `packaging/linux/chatgpt.desktop`, and `packaging/linux/chatgpt-desktop-entry-doctor.sh` | Final syncs ported incoming native package identity and desktop-integration edits to the current local package files. |
| `packaging/linux/codex-update-manager.service`, `packaging/linux/codex-update-manager-user-service.sh`, `packaging/linux/codex-update-manager.postinst`, `packaging/linux/codex-update-manager.postrm`, and `packaging/linux/codex-update-manager.prerm` | `packaging/linux/chatgpt-updater.service`, `packaging/linux/chatgpt-updater-user-service.sh`, `packaging/linux/chatgpt-updater.postinst`, `packaging/linux/chatgpt-updater.postrm`, and `packaging/linux/chatgpt-updater.prerm` | Final syncs ported incoming updater service and maintainer-script edits under the local updater identity. |
| `packaging/linux/com.github.ilysenko.codex-desktop-linux.update.policy` | `packaging/linux/com.github.nisavid.chatgpt.update.policy` | Final syncs ported incoming privileged install policy edits to the local policy file and preserved the local action identifiers. |
| `contrib/user-local-install/files/.config/systemd/user/codex-desktop-update.service`, `contrib/user-local-install/files/.config/systemd/user/codex-desktop-update.timer`, `contrib/user-local-install/files/.local/bin/codex-desktop*`, `contrib/user-local-install/files/.local/share/applications/codex-desktop.desktop`, and `contrib/user-local-install/files/.local/lib/codex-desktop-linux/common.sh` | `contrib/user-local-install/files/.config/systemd/user/chatgpt-update.service`, `contrib/user-local-install/files/.config/systemd/user/chatgpt-update.timer`, `contrib/user-local-install/files/.local/bin/chatgpt*`, `contrib/user-local-install/files/.local/share/applications/chatgpt.desktop`, and `contrib/user-local-install/files/share/common.sh` | Final syncs ported incoming user-local install experiment edits to the current local names and layout. |
| `linux-features/` | `port-integrations/`; the old root is accepted only as a legacy override target | Final syncs ported incoming registry edits to `port-integrations/`. |
| `linux-features/*/feature.json` | `port-integrations/*/integration.json`; old manifests are accepted only for legacy roots | Final syncs ported incoming manifest edits to the current manifest path. |
| `linux-features/features.example.json` and `linux-features/features.json` | `port-integrations/integrations.example.json` and `port-integrations/integrations.json`; old names are compatibility fallbacks | Final syncs ported incoming config-shape changes to the current config names. |
| `scripts/lib/linux-features.js` and `scripts/lib/linux-features.sh` | `scripts/lib/port-integrations.js` and `scripts/lib/port-integrations.sh` | Final syncs ported incoming helper changes to the current helper names. |
| `CHATGPT_LINUX_FEATURES_ROOT`, `CHATGPT_LINUX_FEATURES_CONFIG`, `CHATGPT_LINUX_FEATURES`, `CHATGPT_LINUX_DISABLE_FEATURES`, `CHATGPT_LINUX_FEATURES_DIR`, and `CHATGPT_LINUX_FEATURE_HOOK_PHASE` | `CHATGPT_PORT_INTEGRATIONS_ROOT`, `CHATGPT_PORT_INTEGRATIONS_CONFIG`, `CHATGPT_PORT_INTEGRATIONS`, `CHATGPT_DISABLE_PORT_INTEGRATIONS`, `CHATGPT_PORT_INTEGRATIONS_DIR`, and `CHATGPT_PORT_INTEGRATION_HOOK_PHASE`; old variables are rejected with the exact current replacement | Final syncs ported incoming environment handling to the current variables without compatibility aliases. |
| `CHATGPT_BOOTSTRAP_CLEANUP_FEATURES` | `CHATGPT_BOOTSTRAP_CLEANUP_INTEGRATIONS`; the old variable is rejected with the exact current replacement | Final source, docs, and normal tests used only the current variable. |

## Divergence Inventory

### 1. Local Product And Package Identity

**Fork delta:** Upstream uses the `codex-desktop` app/package
identity and the `codex-update-manager` updater identity. This fork
intentionally exposes the app, packages, launcher, desktop entry, icon, app
state, and package metadata as `chatgpt`. It exposes the updater crate,
binary, service, config, state, cache, and logs as `chatgpt-updater`.

**Upstream baseline:** The underlying Linux app conversion and update manager
model come from upstream. The fork-specific contract is the local identity and
compatibility handling around that inherited model.

**Why it mattered:** These names are user-visible package and runtime contracts.
Adopting upstream names during a sync breaks upgrade paths, service state,
desktop integration, docs, and user commands.

**Final maintained paths:** `Cargo.toml`, `updater/Cargo.toml`, `Makefile`,
`install.sh`, `launcher/start.sh.template`, `launcher/state-migration.py`,
`packaging/linux/`, `scripts/build-deb.sh`, `scripts/build-rpm.sh`,
`scripts/build-pacman.sh`, `scripts/lib/package-common.sh`, `updater/`,
`contrib/user-local-install/`, `README.md`, `CHANGELOG.md`, and
`docs/maintainers/package-runtime-maintenance.md`.

Native packages provide, conflict with, and replace the former `codex-app` and
`codex-desktop` package identities where the format supports that metadata.
They do not install legacy launchers, desktop files, updater services, aliases,
or filesystem shims. Before creating canonical runtime paths, the launcher and
updater atomically move wrapper-owned XDG config, state, cache, data, and CLI
quarantine directories. The migration is journaled and resumable, discards only
known volatile runtime files, fails closed on collisions and unsafe path shapes,
and supports `chatgpt migrate-state --reverse`.

**Former preservation evidence:** Reviews searched user-facing docs, package
metadata, desktop entries, services, updater paths, and launcher commands for
former local names. Those names remained only in transition metadata,
migration logic, legacy-input tests, or explicit history; inherited OpenAI
Codex interfaces remained unchanged.

### 2. Linux Filesystem Layout And Package Payload Contract

**Fork delta:** Native packages keep the generated app bundle under
`/opt/chatgpt`, package-private support under `/usr/lib/chatgpt`, launchers
under `/usr/bin`, desktop assets under `/usr/share`, and mutable user files
under XDG base directories. The update-builder bundle is deliberately under
`/usr/lib/chatgpt/update-builder`, not inside the generated app bundle.

**Upstream baseline:** Upstream already has package builders and an
update-builder payload. This fork changes the installed names and payload
placement, and keeps those choices aligned with XDG/FHS criteria.

**Why it mattered:** This layout matches distro expectations for package-managed
Electron app bundles and keeps mutable user state out of system package roots.

**Final maintained paths:** `packaging/linux/PKGBUILD.template`,
`packaging/linux/control`, `packaging/linux/chatgpt.spec`,
`packaging/linux/chatgpt.install`, Debian/RPM maintainer scripts,
`packaging/linux/chatgpt-packaged-runtime.sh`, `scripts/lib/package-common.sh`,
`launcher/start.sh.template`, `updater/src/config.rs`, `updater/src/app.rs`,
`updater/src/builder.rs`, `contrib/user-local-install/`.

**Former preservation evidence:** Package file lists and source templates were
checked for `/opt/chatgpt`, `/usr/lib/chatgpt`, `/usr/bin/chatgpt`,
`/usr/bin/chatgpt-updater`, and XDG paths. The final payload did not adopt
`~/.local/opt`, `/opt/codex-desktop`, or upstream support-bundle paths.

### 3. Package Versioning From The OpenAI DMG Bundle

**Fork delta:** Package versions default to the OpenAI app bundle's
`CFBundleShortVersionString`, written to `chatgpt/chatgpt-version.env`
during app generation. Timestamp or commit-hash package versions are explicit
test overrides only.

**Upstream baseline:** Upstream already derives update
candidates from official OpenAI ChatGPT DMG metadata. This fork changes native
package versioning and updater comparison helpers so package upgrades track the
DMG-contained app version.

**Why it mattered:** Package upgrades, updater comparisons, release notes, and
user expectations tracked the official app version rather than local build
time.

**Final maintained paths:** `install.sh`, `scripts/lib/dmg.sh`,
`scripts/lib/package-common.sh`, package builders, `updater/src/app.rs`,
`updater/src/builder.rs`, `updater/src/package_version.rs`,
`updater/src/dmg_source.rs`, `README.md`, `docs/usage/build-and-run.md`,
`tests/scripts_smoke.sh`.

**Former preservation evidence:** `make help` and package-document checks
verified that the plain native-package targets were the normal path and that
`PACKAGE_VERSION` appeared only as a deliberate override.

### 4. Package Builder Hardening

**Fork delta:** The Debian, RPM, pacman, and AppImage builders keep local
names, replacement metadata, package output names, and staged payloads aligned
with their intended package surfaces. The shared staging helper validates
native package inputs, rejects unsafe app payload symlinks, normalizes payload
modes, avoids preserving local build ownership into pacman packages, and prints
package metadata/content inspection where tools support it. AppImage stays a
manual-update artifact without updater service, polkit, or update-builder
payload.

**Upstream baseline:** Upstream already builds native packages
and now carries a local AppImage target. This fork adds hardening, local
identity, and payload consistency constraints.

**Why it mattered:** Native packages installed with package-manager-owned
system paths, predictable modes, and aligned payloads across formats.

**Final maintained paths:** `scripts/build-deb.sh`, `scripts/build-rpm.sh`,
`scripts/build-pacman.sh`, `scripts/build-appimage.sh`,
`scripts/lib/package-common.sh`, `packaging/linux/control`,
`packaging/linux/chatgpt.spec`, `packaging/linux/PKGBUILD.template`,
`packaging/linux/chatgpt.install`, `packaging/appimage/`,
`tests/scripts_smoke.sh`.

**Former preservation evidence:** Reviews built affected package formats and
inspected their metadata and file lists. Pacman packages did not inherit the
local build user's ownership, and AppImage payloads omitted updater-only
service and Polkit files.

### 5. Updater Privilege Boundary And Install Hardening

**Fork delta:** `chatgpt-updater` remains unprivileged until the final native
package install. Privileged work runs only through `install-deb`, `install-rpm`,
and `install-pacman`, which validate package paths and identity metadata,
stage private copies, and then invoke the package manager through `pkexec`.

**Upstream baseline:** Upstream already has a user-level update
manager and privileged package install path. This fork tightens the boundary and
renames the service, policy, and package identities.

**Why it mattered:** The updater handled mutable network inputs and local build
work. Privilege stayed isolated to the smallest install surface.

**Final maintained paths:** `updater/src/install.rs`, `updater/src/app.rs`,
`updater/src/config.rs`, `updater/src/builder.rs`,
`packaging/linux/com.github.nisavid.chatgpt.update.policy`,
`packaging/linux/chatgpt-updater.service`, maintainer scripts,
`docs/maintainers/security-backlog.md`, `docs/maintainers/threat-model.md`.

**Former preservation evidence:** Updater install tests or targeted review
covered state and install changes. Trust-boundary work was routed through the
security backlog and the `@codex-security` workflow.

### 6. Updater State, Config Overlay, And Failure Recovery

**Fork delta:** Updater config and state use `chatgpt-updater` XDG paths,
user config is a partial overlay, explicit `cli_path` is supported, failed or
dismissed installs avoid prompt loops, interrupted installs recover, and
production builder redirection requires `developer_mode = true`.

**Upstream baseline:** Upstream already has persisted updater state and a
daemon. This fork changes the local names, persisted config surface, recovery
rules, and developer-mode guardrails.

**Why it mattered:** The updater runs continuously and needs stable persisted
state across package upgrades, crashes, and user configuration changes.

**Final maintained paths:** `updater/src/app.rs`, `updater/src/config.rs`,
`updater/src/dmg_source.rs`, `updater/src/builder.rs`, `updater/src/install.rs`,
`updater/src/package_version.rs`, `updater/src/codex_cli.rs`,
`.github/workflows/updater.yml`, `docs/usage/troubleshooting.md`.

**Former preservation evidence:** Full updater tests covered state, install,
CLI preflight, liveness, and daemon control-flow changes.

### 7. Codex CLI Discovery And Preflight

**Fork delta:** CLI discovery uses explicit CLI options, `CODEX_CLI_PATH`,
updater config, persisted updater state, launch `PATH`, and known user-local
package-manager paths. The launcher passes `--cli-path` only when a path is
known, gives updater preflight a fast path before direct fallback, prompts for
missing CLI installation where interactive, and exports `CODEX_CLI_PATH`
before Electron starts. A generated launch proxy pins the canonical executable
but preserves `codex` as the invocation name for multicall binaries.

**Upstream baseline:** Upstream already has launcher/updater CLI
preflight. This fork refines discovery precedence, config integration, and
best-effort behavior under the `chatgpt-updater` identity.

**Why it mattered:** The app needs a reliable Codex CLI path without blocking
Electron startup on registry or install work that can run later.

**Final maintained paths:** `launcher/start.sh.template`, `install.sh`,
`updater/src/codex_cli.rs`, `updater/src/config.rs`, `updater/src/app.rs`,
`updater/src/main.rs`, `updater/src/state.rs`,
`docs/usage/troubleshooting.md`, `.github/workflows/updater.yml`.

**Former preservation evidence:** Documentation and tests kept synchronous path
resolution separate from background npm registry and update checks. Invalid
configured paths failed loudly, while stale persisted paths did not block
fallback.

### 8. Generated Launcher And Packaged Runtime Behavior

**Fork delta:** Checkout launches stay generic. Native packages load
package-only behavior only when the packaged runtime helper exists. The helper
lives under `/usr/lib/chatgpt`, imports desktop/session display variables
without importing `PATH`, and disables the legacy upstream service name when
present. A fresh native-package installation enables and starts
`chatgpt-updater.service`; upgrades and launches start it only when the user
already enabled it. These paths do not restart an active service. Launches also
trigger update checks after Electron PID recording.

**Upstream baseline:** Upstream provides the launcher template and packaged
runtime pattern. This fork changes the package-only helper location, service
names, environment import policy, and lifecycle details.

**Why it mattered:** Package-specific service orchestration did not leak into
checkout builds or race pending updater install state.

**Final maintained paths:** `launcher/start.sh.template`, `install.sh`,
`packaging/linux/chatgpt-packaged-runtime.sh`,
`packaging/linux/chatgpt-updater.service`,
`packaging/linux/chatgpt-updater-user-service.sh`,
`scripts/lib/package-common.sh`, `tests/scripts_smoke.sh`.

**Former preservation evidence:** Package-only launcher changes were owned by
`packaging/linux/chatgpt-packaged-runtime.sh` and checked in regenerated
`chatgpt/start.sh` output.

### 9. ASAR, Port Integration, And Linux UI Patch Behavior

**Fork delta:** Ordinary optional ASAR descriptor drift remains fail-soft for
volatile official app bundle shapes. Generated-app mutation integrity failures
fail closed. The current fork delta includes local identity updates, sanitized
generated keybind literals, `CHATGPT_APP_LAUNCH_ACTION_SOCKET`, Linux window
default refinements, opt-in multi-instance launch support, default-enabled
Electron sandboxing with an explicit compatibility opt-out, and default-enabled
supported port integrations: Open target discovery, Agent Workspaces, AppShots,
wrapper updater, Copilot reasoning effort defaults, remote-control UI,
mobile-control host patches, Read Aloud, Read Aloud MCP, and conversation mode.
It also keeps Linux Computer Use support patching default-on. Live Computer Use
authority requires trusted Linux support, current official eligibility, and a
fresh exact installed-and-enabled local `computer-use@openai-bundled` record.
Remote-control UI and mobile-control host patches keep private device-key
material under
`${XDG_CONFIG_HOME:-~/.config}/chatgpt`.

**Upstream baseline:** Upstream already carries Linux ASAR patching. This fork
maintains local patch safety and selected Linux behavior changes on top of that
patching system.

**Final naming record:** Durable docs called configurable modules port
integrations. The source path was `port-integrations/`, manifests were
`integration.json`, configs were `integrations.json` or
`port-integrations.json`, and environment variables used
`CHATGPT_PORT_INTEGRATIONS_*`. Final syncs reconciled the older
`linux-features/` naming into that local vocabulary.

**Why it mattered:** Official app minified bundle shapes changed often. Linux
behavior degraded with actionable warnings instead of breaking app generation
unless a required invariant failed.

**Final maintained paths:** `scripts/patch-linux-window-ui.js`,
`scripts/patch-linux-window-ui.test.js`, `scripts/lib/asar-patch.sh`,
`scripts/lib/port-integrations.js`, `port-integrations/open-target-discovery/`,
`port-integrations/remote-control-ui/`, `port-integrations/remote-mobile-control/`,
`port-integrations/integrations.example.json`, `install.sh`,
`launcher/start.sh.template`, `tests/scripts_smoke.sh`,
`docs/usage/troubleshooting.md`.

**Former preservation evidence:** Node patch tests and shell smoke tests
covered ASAR patcher and launch-flag changes.

### 10. Generated-App Mutation Integrity

**Fork delta:** Central main-bundle and webview-asset discovery, reads, and
replacements use one descriptor-relative Rust mutation broker. Single-use read
tokens bind replacement to relative path, file identity, and digest. Broker,
protocol, lookup, identity, token, and replacement failures poison the session,
stop later patch work, fail the child build, and cannot be downgraded through a
descriptor's fail-soft policy. Replacement preserves permission mode and
nanosecond modification time and rejects extended attributes.

The helper is build-only. Source and Nix builds compile it once; native packages
stage that exact executable and its generation-bound digest in the
update-builder's `prebuilt-helpers/` lane. Packaged updater rebuilds use only
the validated prebuilt helper under their cleared build environment. The helper
is absent from `/opt/chatgpt` runtime payloads and user commands.

Successful generation also publishes a sibling external receipt keyed by the
complete app-manifest digest. It binds the executed broker, app manifest, and
`.chatgpt-linux/build-info.json` digest. Native package staging requires this
receipt before copying app bytes and revalidates it after the copy.

Transactional app generation creates and verifies the sibling candidate as an
owned, non-symlink `0700` directory before population. The inner build preserves
and revalidates it even under `--fresh`. After integrity and official-DMG
acceptance, the outer transaction revalidates the root, changes it to `0755`,
and uses the existing recovery journal and atomic exchange for promotion.
Rejected candidates stay private or are removed.

**Upstream baseline:** The Linux-port upstream carries the generated app patch
pipeline and transactional promotion model. This fork adds the central mutation
capability, build-only delivery contract, poison propagation, and private
candidate lifecycle.

**Why it mattered:** Generated official-app files are untrusted build inputs.
Capability mediation prevents pathname escape and stale-read replacement from
becoming accepted package content, while private candidates preserve the
exclusive-writer premise until acceptance.

**Final maintained paths:** `generated-app-mutation-broker/`,
`scripts/patches/lib/generated-app-mutation-client.js`,
`scripts/patches/lib/assets.js`, `scripts/patches/engine.js`,
`scripts/patches/runner.js`, `scripts/lib/generated-app-mutation-broker.sh`,
`scripts/lib/package-provenance.py`, `install.sh`,
`scripts/lib/install-helpers.sh`,
`scripts/lib/package-common.sh`, `updater/src/builder.rs`, and `flake.nix`.
The gate contract is documented in
`docs/maintainers/research/generated-app-mutation-integrity-boundary.md`.

**Former preservation evidence:** The broker stayed outside runtime payloads;
packaged prebuilt use was bound to the generated app digest; native package
staging required the external broker/app/build-info receipt; and poison,
fail-closed, and private-root checks remained intact. Broker and package-release
tests covered the available native formats. Extracted-app descriptor callbacks,
declarative resource copies, and shell staging hooks remained outside the
capability-mediated claim.

### 11. Webview Server Lifecycle

**Fork delta:** The launcher keeps webview server state under the local app
identity and XDG state paths, preserves live app markers during warm-start or
second-instance handoff, and keeps origin validation tied to loopback startup
assets plus `.chatgpt-linux/webview-integrity.sha256` before Electron launch.

**Upstream baseline:** Upstream already has the local webview server model and
much of the launcher lifecycle. This fork preserves and renames that behavior
while maintaining the local XDG/path contract.

**Why it mattered:** ChatGPT expected webview assets at a local origin, while
Linux launches avoided LAN exposure, stale servers, and PID ownership races.

**Final maintained paths:** `launcher/start.sh.template`,
`launcher/webview-server.py`, `scripts/lib/webview-install.sh`, `install.sh`,
`docs/webview-server-evaluation.md`, `docs/usage/troubleshooting.md`,
`tests/scripts_smoke.sh`, `tests/webview_probe_equivalence.sh`.

**Former preservation evidence:** Webview server changes were reviewed against
`docs/webview-server-evaluation.md`.

### 12. Linux Computer Use Integration Compatibility

**Fork delta:** Upstream's Linux Computer Use backend and bundled plugin remain
part of the packaged app. This fork preserves the
`chatgpt` package identity, keeps the plugin manifest pointed at packaged
assets, carries local Linux input/window-targeting hardening where needed,
adapts configurable backend identity under the packaged resource layout, and
enables Linux support patching without claiming that local installation changes
OpenAI account policy or server-side availability. The official local
`computer-use@openai-bundled` plugin setting is the persistent user grant when
installed and enabled; this fork adds no parallel consent setting or prompt.
Every live request
also requires current official eligibility and trusted Linux support. The app
reads the exact plugin record afresh and exposes a private
generation/token-bound authority that the Rust backend revalidates for every
MCP tool call.
Plugin disablement and eligibility loss rotate and revoke authority before the
related config write or plugin reconciliation, so stale and late results deny.

**Upstream baseline:** The Rust MCP backend, bundled plugin resources,
accessibility tree capture, screenshot paths, and input automation come from
upstream in the synced baseline.

**Why it mattered:** The package can stage local Computer Use support and register
the backend on Linux, but this does not create a grant or server-side
entitlement. Codex tool approval, sandboxing, auto-approval, allowed-app
selection, and local action validation remain in force. Host accessibility,
screenshot, and input readiness can make an authorized action fail; they are
not additional grants.

**Final maintained paths:** `computer-use-linux/src/`,
`plugins/openai-bundled/plugins/computer-use/`,
`scripts/patch-linux-window-ui.js`, `scripts/patch-linux-window-ui.test.js`,
`scripts/lib/package-common.sh`, `launcher/start.sh.template`, `README.md`,
`docs/usage/build-and-run.md`, `CHANGELOG.md`.

**Former preservation evidence:** Native package staging and README wording
remained scoped to the local compatibility delta. The three live authority
inputs, fresh plugin read, generation and token rotation,
revoke-before-write/reconcile ordering, and existing Codex and allowed-app
controls remained intact. The final implementation did not add a fork-owned
grant, consent setting, or recurring prompt, and did not claim to bypass OpenAI
feature flags.

### 13. Release, Security, And Supply-Chain Verification

**Fork delta:** The fork adds and wires release/security workflow around the
mutable official OpenAI ChatGPT DMG: trusted DMG hash input, packaged trusted DMG
metadata for unattended updater rebuilds, generated app and ASAR inspection,
package metadata checks, private clean-source and generated-app snapshots,
independent sandboxed-Nix `chatgpt-release-app` and static `release-helpers`
outputs, exact submitted/reference app equality, reference-owned native-package
rebuild and install-control comparison, exact RPM reference bytes,
snapshot-derived checksums, signed release provenance bound to the approved
primary fingerprint, public key export, macOS Apple DMG verification, reviewed
hash-refresh PRs, a pinned Ubuntu 22.04 glibc ABI floor for fork-built dynamic
helpers and Electron native addons, safer DMG
URL validation, download limits, partial-file downloads, and sanitized URL
logging. Public validation uses a trusted system Node runtime rather than code
from the app under review. The
generated-app mutation-broker manifest is derived from the descriptor actually
executed. An external content-addressed generation receipt binds that broker to
the complete app manifest and build info before native package staging. The official
app's Parcel watcher is installed from approved offline bytes only after the
host matches `linux-x64-glibc` on `x86_64`, `linux-arm64-glibc` on `aarch64` or
`arm64`, or `linux-arm-glibc` on ARMv7 hard-float `armv7l`; unsupported hosts
fail before npm or module load. Public native packages require
`PACKAGE_WITH_UPDATER=1` and are verified only against the independent immutable
Nix app reference. The release signer matched the exact
`CHATGPT_RELEASE_GPG_FINGERPRINT`.

**Upstream baseline:** Upstream already downloads and converts the official
OpenAI ChatGPT DMG. This fork adds extra verification and review gates around
that inherited supply chain.

**Why it mattered:** This fork rebuilt packages from a mutable official OpenAI
ChatGPT DMG URL. Release and updater work left reviewable evidence and avoided
presenting unverified artifacts as trusted.

**Retained source paths:** `.github/workflows/verify-apple-dmg.yml`,
`.github/workflows/ci.yml`,
`.github/workflows/updater.yml`, `Makefile`, `flake.nix`,
`scripts/release-gate.sh`, `scripts/verify-apple-dmg.sh`,
`scripts/inspect-electron-security.js`, `scripts/lib/package-provenance.py`,
`scripts/lib/parcel-watcher/`, `scripts/lib/parcel-watcher-target.js`,
`scripts/lib/webview-install.sh`, `scripts/lib/dmg.sh`,
`updater/trusted-dmg-manifest.json`, `updater/src/trust.rs`,
`updater/src/dmg_source.rs`, `updater/src/app.rs`,
`docs/maintainers/security-backlog.md`, `docs/maintainers/threat-model.md`.
The former `.github/workflows/update-chatgpt-hash.yml` write-capable producer
was removed at retirement and remains available only in Git history.

**Former preservation evidence:** The release surface exposed the Apple DMG
and release gates. Package provenance, public release, updater reproducibility,
Parcel watcher trust, host selection, independent Nix outputs, and the signed
updater-enabled publication path were covered by dedicated tests and builds.
Security backlog work used `@codex-security` before review-ready handoff.

The Nix release app discarded the install-time receipt before ELF, mode, and
post-install mutation, then published a new receipt only after those mutations
finished. A separate flake check validated the receipt from the final imported
`/nix/store` output.

### 14. User-Local Install Experiment Identity And Layout

**Fork delta:** The experimental unprivileged install path uses `chatgpt`
commands, service/timer names, desktop entry, and XDG user data paths. It stays
aligned with fork path triage while remaining separate from native package
layout.

**Upstream baseline:** Upstream already has the user-local install experiment.
This fork renames it and adjusts path choices so it does not reintroduce
upstream names or non-XDG roots.

**Why it mattered:** The rootless experiment did not reintroduce upstream names
or non-XDG paths while testing a different install model.

**Final maintained paths:** `contrib/user-local-install/README.md`,
`contrib/user-local-install/install-user-local.sh`,
`contrib/user-local-install/files/.config/systemd/user/`,
`contrib/user-local-install/files/.local/bin/`,
`contrib/user-local-install/files/.local/share/applications/`,
`contrib/user-local-install/files/share/common.sh`.

**Former preservation evidence:** The user-local payload stayed under the XDG
data directory and did not use `~/.local/opt`.

### 15. Maintainer Policy, Docs, And Agent Workflow

**Fork delta:** The fork adds and maintains policy/docs surfaces that are not
part of upstream: always-loaded agent rules, a repo-local maintenance skill,
maintainer references, security backlog, threat model, usage docs, README
feature status, and the divergence inventory itself.

**Upstream baseline:** The final docs preserved clear credit for upstream's
primary Linux work while describing the local policy and documentation layer as
fork finishing work.

**Why it mattered:** This fork intentionally diverged from its upstream.
Durable, discoverable policy supported maintainers and agents without turning
the README or `AGENTS.md` into large maintenance manuals.

**Final maintained paths:** `AGENTS.md`,
`.agents/skills/maintaining-chatgpt-package/SKILL.md`, `docs/README.md`,
`docs/backlog.md`, `docs/maintainers/package-runtime-maintenance.md`,
`docs/maintainers/security-backlog.md`, `docs/maintainers/threat-model.md`,
`docs/policies/agentic-maintenance.md`, `docs/usage/`, `README.md`,
`CHANGELOG.md`.

**Former preservation evidence:** `AGENTS.md` stayed concise while detailed
contracts lived in maintainer docs or repo-local skills. Sync reviews checked
README audience, clone URLs, maintainer-only material, upstream credit, and
divergence accuracy.

## Layout Triage

These path decisions are triaged against the XDG Base Directory Specification,
the Filesystem Hierarchy Standard, and common distro packaging conventions for
Electron-style app bundles.

| Surface | Decision | Rationale |
| --- | --- | --- |
| Generated native app bundle | Retained `/opt/chatgpt`. | The extracted DMG/Electron tree was a self-contained add-on app bundle. `/opt/<package>` was the conventional location for that shape. |
| User-facing launchers | Retained `/usr/bin/chatgpt` and `/usr/bin/chatgpt-updater`. | Package-managed commands lived on the normal system command path. |
| Update builder bundle | Used `/usr/lib/chatgpt/update-builder`. | The builder was package-private updater support rather than app-bundle or user data. |
| Packaged runtime helper | Used `/usr/lib/chatgpt/packaged-runtime.sh`. | The helper was package-private launcher support sourced only by native package installs. |
| Desktop entry and icon | Retained `/usr/share/applications/chatgpt.desktop` and `/usr/share/icons/hicolor/256x256/apps/chatgpt.png`. | Freedesktop desktop integration was shared, package-managed data. |
| Updater config, state, cache, logs | Retained XDG paths under the user config, state, and cache roots. | These were per-user mutable files governed by XDG base directories. |
| App PID, webview PID, launch-action socket | Retained XDG state for persistent liveness and XDG runtime for sockets. | Persistent restart state and ephemeral runtime objects stayed separate. |
| User-local non-package app payloads | Used `${XDG_DATA_HOME:-~/.local/share}/chatgpt`, not `~/.local/opt`. | XDG supplied the user-specific application data root. |

No path ambiguity remained for the native package payload after this triage.
The experimental unprivileged install used XDG user paths and stayed aligned
with this table at the final maintained state.
