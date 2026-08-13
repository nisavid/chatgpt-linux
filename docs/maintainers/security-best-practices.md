# Security Best Practices

This document projects the repository threat model into secure-by-default review
guidance for maintainer changes. Use it with [Threat Model](threat-model.md)
and [Security Backlog](security-backlog.md).

The current default-enabled port integration set makes generated Electron,
webview, and helper-process boundaries the main day-to-day security surface.
Established defaults cover Agent Workspaces, AppShots, ChatGPT wrapper updater,
conversation mode, Copilot reasoning effort, Open Target Discovery, Read Aloud,
Read Aloud MCP, remote-control UI, and remote-mobile control. Reviewed defaults
add API-key model visibility and service tier, global dictation, Omarchy theme,
persistent status, Pet Overlay, project sorting, shared app-server socket, SSH
command wrapping, and UI Tweaks. Authenticated proxy, Codex Micro,
directory-only and shallow repository watches, MCP helper reaping, and Record &
Replay remain disabled by default.

## Default Rules

- Treat generated renderer UI, webview settings, global state, local storage,
  profile files, permission files, and bridge params as untrusted inputs. They
  can improve the user flow, but they are not security boundaries unless the
  main process, updater, helper runtime, or OpenAI-hosted service enforces the
  same decision.
- Preserve OpenAI-hosted account, rollout, entitlement, and availability gates
  when a patch adds Linux support. A platform branch should expose Linux
  plumbing; it should not turn a hosted service or account policy check into a
  local-only allow.
- Keep local process launch sinks argument-vector based. Validate the executable
  identity, target path, environment, and option-shaped values before reaching
  `spawn`, `execFile`, Electron `shell.openPath`, or generated open-target
  launch code.
- Avoid adding renderer-side HTML, script, or navigation sinks. Prefer generated
  React/JSX or safe DOM APIs, and do not introduce `innerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, string
  timeouts, unvalidated `window.location` assignments, or `postMessage("*")`
  patterns unless the source is constant and the reason is documented.
- Treat values read from local state as attacker-controlled even when this fork
  wrote them. Revalidate security-relevant values through the owning trusted
  control plane or at the action sink, especially command paths, update flags,
  model preferences, mount paths, browser-data paths, permission policy files,
  targets, and action arguments. Do not create a second consent prompt or
  persisted grant merely to duplicate an existing feature control.
- Stage sensitive desktop artifacts in private owner-only paths and remove them
  deterministically. Screenshots, accessibility snapshots, browser-session
  copies, device keys, and captured app data must not live directly in shared
  temporary files or verbose logs.
- Keep update authority in `chatgpt-updater`. Generated wrapper-update UI may
  show status and collect user intent, but package eligibility, artifact
  identity, digest binding, and privileged install behavior remain updater
  responsibilities.
- Keep OpenAI-hosted service semantics authoritative. Client-side settings for
  Copilot reasoning effort, remote-control visibility, mobile state,
  conversation/audio availability, host network exposure, or Computer Use
  availability do not prove hosted entitlement, quota, enrollment, MFA, rollout,
  or exposure status.
- Treat legacy XDG state and the migration journal as untrusted same-user input.
  Preserve no-replace atomic moves, collision refusal, symlink and file-type
  checks, same-filesystem validation, narrow volatile cleanup, bounded rewrites,
  crash-durable progress, and explicit reverse migration.
- Keep central main-bundle and webview-asset mutation behind the generated-app
  mutation capability. A read token is single-use and bound to the original
  relative path, file identity, and digest. Any broker, protocol, lookup,
  identity, token, or replacement-integrity failure poisons the patch session
  and must fail the build rather than follow descriptor fail-soft policy.
- Preserve replaced files' permission mode and nanosecond modification time.
  Reject extended attributes instead of silently dropping them. Do not claim
  that extracted-app descriptors, declarative resources, or shell staging hooks
  are capability-mediated until their later migration gates are complete.
- Keep the generated-app mutation broker build-only. Source and Nix builds may
  compile it; packaged updater rebuilds must use the package-owned prebuilt
  helper and its exact generation-bound digest. Derive that digest from the
  descriptor actually executed by the patch client, return it only after a
  clean session close, and reject any later pathname whose digest differs.
  Publish a sibling external receipt keyed by the full app-manifest digest and
  binding the broker, app manifest, and build-info digests. Native package
  staging must validate that receipt before copying app bytes and revalidate it
  afterward.
  Never place the broker in the generated runtime payload or expose it as a
  user command.
- Install the official app's `@parcel/watcher` only from the repository-approved
  offline lock and archive set. Verify the official exact version, all approval
  digests, local-only lock entries, and exactly one approved Linux glibc target
  before npm or Electron load. Limit approval to `linux-x64-glibc` on
  `x86_64`, `linux-arm64-glibc` on `aarch64` or `arm64`, and
  `linux-arm-glibc` on ARMv7 hard-float `armv7l`; reject every other host before
  npm. Do not fall back to a live registry during app generation or updater
  rebuilds.
- A public release must use a root-managed sandboxed Nix daemon to build an
  independent `chatgpt-release-app` reference and static `release-helpers` from
  the immutable source and reviewed DMG. Require exact submitted/reference app
  equality, `PACKAGE_WITH_UPDATER=1`, and package verification only against that
  reference. Bind package checksums and signed provenance to the generated build
  record, full integration config and implementation digest, package version,
  payload, install controls, and updater. Require deterministic byte equality
  when a format supports it. Use only trusted host runtimes during validation,
  never an executable from the artifact under review, and require the selected
  signing key to match the exact `CHATGPT_RELEASE_GPG_FINGERPRINT`. Unsigned or
  dirty runs are rehearsals and must not claim public-release eligibility.
- Create transactional candidate roots as owned, non-symlink `0700`
  directories before population. Reverify the root in the child build and
  before promotion, retain it under `--fresh`, and change it to `0755` only
  after integrity and official-DMG acceptance succeed. Rejected candidates
  remain private or are removed.
  See [Generated-App Mutation Integrity Boundary](research/generated-app-mutation-integrity-boundary.md)
  for the implemented and planned gate boundaries.
- Keep package transitions metadata-only: replacing a former package does not
  authorize compatibility commands, desktop files, services, or filesystem
  shims.
- Route any newly identified security gap that is outside the current PR's
  implementation scope to GitHub Issues and add it to
  [Security Backlog](security-backlog.md). Keep the threat model current when a
  change creates or removes a trust boundary.

## Sensitive Desktop Authorization

The owning feature control is the sole persistent user grant for a sensitive
desktop capability. It survives app restarts and sessions until the user changes
that feature's existing setting, approval, or policy. This fork does not add a
parallel consent store or recurring first-use, session, or action prompt.
Revocation must block future invocations; an action already issued may finish.

For ChatGPT-originated actions, the trusted ChatGPT or Codex control plane must
re-evaluate the owning control before dispatch or invalidate an existing helper
session when the control changes. The local helper still validates the action,
target, and host preconditions. A reachable socket, live helper, valid request,
or positive readiness probe proves only feasibility, never authorization.
Unavailable or stale control state fails closed. Official app prompts and OS
portal prompts remain part of their owning systems and are not replaced.

Direct same-user execution of a packaged CLI is an explicit operator action,
like invoking another local terminal automation tool. It remains responsible
for input validation and local safety, but it does not need to reproduce the
ChatGPT product's feature-toggle UX.

Apply the contract to each feature independently:

- **Computer Use:** the official installed-and-enabled local
  `computer-use@openai-bundled` plugin setting is the persistent user grant.
  A live request also requires current official eligibility and trusted Linux
  support; the app authority reads the exact plugin record afresh for every
  request. The private generation/token-bound authority socket lets the Rust
  backend revalidate every MCP tool call. Disabling the plugin or losing
  official eligibility revokes before the related config write or reconcile,
  rotates authority, and makes stale or late results deny. Codex tool approval,
  sandboxing, auto-approval, allowed-app selection, and local action validation
  still apply. Host accessibility, screenshot, and input readiness can make an
  authorized action fail, but are not additional grants.
- **AppShots:** its own feature setting, selected hotkey, and explicit capture
  flow own authorization. Reuse of Computer Use inspection helpers does not
  make the Computer Use toggle its owner.
- **Remote control and mobile host:** OpenAI enrollment, MFA, connected-device,
  host-exposure, and feature settings own authorization. Linux keys and local
  reachability are supporting state, not grants.
- **SSH command wrapping and other agent tools:** the integration's explicit
  enablement plus Codex approval, sandboxing, and auto-approval policy own
  authorization. A valid command or reachable remote transport is not enough.
- **Global dictation, Dock icon, and other local actions:** the integration's
  existing setting or explicit user action owns authorization. Helpers must
  remain scoped to the resources and targets that feature owns.

## Default-Enabled Integration Review Points

- **Agent Workspaces:** before launching `agent-workspace-linux`, revalidate the
  selected command, permission file, profile JSON, browser-session copy source,
  mount list, and hidden-workspace acknowledgement state. Main-process hardening
  for command selection and acknowledgement binding is tracked in
  [issue #99](https://github.com/nisavid/codex-app-linux/issues/99).
- **AppShots:** preserve the official app's availability flag, keep global
  hotkeys opt-in, fail closed when focused-window inputs are unavailable, and
  use private per-capture temporary directories for screenshot intermediates.
- **Wrapper updater UI:** keep wrapper update checks off until the user enables
  them, avoid UI states that imply a package is verified before updater state
  says so, and leave failed apply markers in a retryable state.
- **Copilot reasoning effort:** treat generated setting defaults as preference
  hints only. Hosted request handling remains authoritative for entitlement,
  quota, and request normalization; validation is tracked in
  [issue #100](https://github.com/nisavid/codex-app-linux/issues/100).
- **Remote-control and mobile host integrations:** do not fabricate connected
  clients, MFA, enrollment, host identity, app-server reachability, host network
  exposure, or remote environment state. Use
  [Remote Mobile Host Boundary Review](remote-mobile-host-boundary-review.md)
  for host-state evidence.
- **Conversation mode and Read Aloud:** preserve hosted conversation/audio
  availability checks and keep local TTS or MCP helpers behind their runtime
  dependency checks. Local controls can prepare Linux plumbing, but they do not
  authorize account-side voice or audio features.
- **Open target discovery:** keep `.desktop` parsing narrow, reject URL-like or
  option-shaped targets before launch, sanitize app-internal environment
  variables, and treat user-local desktop entries as same-user trust inputs.
- **API-key metadata and shared routing:** model visibility, service-tier copy,
  shared app-server sockets, and SSH routing are local presentation or transport
  helpers. They must not mint credentials, broaden hosted entitlement, trust
  renderer-selected endpoints, or weaken argument-vector command validation.
- **Global dictation, Pet Overlay, and status helpers:** keep portal/input/audio
  actions behind explicit local settings and host readiness, isolate per-instance
  sockets, and fail softly when private runtime channels are absent.
- **Dock icon:** write, replace, and delete only regular, marker-owned ChatGPT
  desktop entries and icon files whose app identity matches. Leave symlinks,
  unmanaged launchers, unmanaged icons, and desktop favorites unchanged; cleanup
  must remove every owned artifact and no others.
- **Suggested Prompts:** enable the local patch only when the official app is
  eligible, the user setting is enabled, and the current Linux patch contracts
  match. Never replace hosted eligibility with the local default.

## Review Checklist

Before default-enabling or materially changing a port integration, confirm:

- The integration's control surface is documented in its README and linked from
  `port-integrations/README.md` when user-facing.
- Runtime controls are enforced by the owning trusted control plane or action
  sink, not only in generated UI.
- Any official-app client gate is preserved or, when deliberately changed,
  replaced by a documented local control enforced by its owning control plane.
- OpenAI-hosted account, rollout, entitlement, and availability gates are
  preserved; no local gate may replace them.
- Central main-bundle and webview writes use the generated-app mutation
  capability, and integrity failures cannot degrade into optional patch drift.
  Extracted-app descriptors and integration staging remain explicitly outside
  that claim until their migration gates are complete.
- Sensitive artifacts use private state or temp paths, owner-only modes where
  applicable, and deterministic cleanup.
- Tests cover the security-relevant branch, including stale already-patched
  bundle shapes when the patcher supports upgrades.
- The threat model, security backlog, and maintainer review paths are updated
  when the change creates, removes, or materially shifts a trust boundary.
