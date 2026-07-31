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
- Preserve upstream account, rollout, entitlement, and availability gates when a
  patch adds Linux support. A platform branch should expose Linux plumbing; it
  should not turn an upstream service or account policy check into a local-only
  allow.
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
  wrote them. Revalidate setting values at the action sink, especially command
  paths, update flags, model preferences, mount paths, browser-data paths, and
  permission policy files.
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
- Keep package transitions metadata-only: replacing a former package does not
  authorize compatibility commands, desktop files, services, or filesystem
  shims.
- Route any newly identified security gap that is outside the current PR's
  implementation scope to GitHub Issues and add it to
  [Security Backlog](security-backlog.md). Keep the threat model current when a
  change creates or removes a trust boundary.

## Default-Enabled Integration Review Points

- **Agent Workspaces:** before launching `agent-workspace-linux`, revalidate the
  selected command, permission file, profile JSON, browser-session copy source,
  mount list, and hidden-workspace acknowledgement state. Main-process hardening
  for command selection and acknowledgement binding is tracked in
  [issue #99](https://github.com/nisavid/chatgpt-linux/issues/99).
- **AppShots:** preserve the upstream availability flag, keep global hotkeys
  opt-in, fail closed when focused-window inputs are unavailable, and use private
  per-capture temporary directories for screenshot intermediates.
- **Wrapper updater UI:** keep wrapper update checks off until the user enables
  them, avoid UI states that imply a package is verified before updater state
  says so, and leave failed apply markers in a retryable state.
- **Copilot reasoning effort:** treat generated setting defaults as preference
  hints only. Hosted request handling remains authoritative for entitlement,
  quota, and request normalization; validation is tracked in
  [issue #100](https://github.com/nisavid/chatgpt-linux/issues/100).
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
- Runtime controls are enforced at the trusted sink, not only in generated UI.
- Any official app availability or hosted-service gate is preserved or replaced
  by a documented equivalent.
- Sensitive artifacts use private state or temp paths, owner-only modes where
  applicable, and deterministic cleanup.
- Tests cover the security-relevant branch, including stale already-patched
  bundle shapes when the patcher supports upgrades.
- The threat model, security backlog, and maintainer review paths are updated
  when the change creates, removes, or materially shifts a trust boundary.
