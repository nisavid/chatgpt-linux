# Official-App Parity Audit

Status: no deal-breaking disparity found

Date: 2026-08-17

## Decision

Keep the validated native repackage as the active ChatGPT producer. The later
[producer decision](https://github.com/nisavid/chatgpt-linux/issues/148) and
[sunsetting contract](https://github.com/nisavid/chatgpt-linux/issues/149#issuecomment-5325243686)
adopted that disposition and retired the finishing fork. The OpenAI application
payload provides the documented core product, project, local-file, and plugin
surfaces. Read-only host evidence also confirms the launch, shared-profile,
URI, browser, update, and global Codex continuity paths. No established
difference requires returning to the finishing fork.

The material known omission is desktop-wide Computer Use on Linux. OpenAI's
Linux preview guide says it is not yet available, while the fallback baseline
contains a Linux Computer Use backend and integration patches
([OpenAI Linux guide](https://learn.chatgpt.com/docs/linux/linux-app),
[fallback Computer Use contract](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/docs/maintainers/fork-divergences.md#12-linux-computer-use-integration-compatibility)).
The host had the fallback's Computer Use UI flag enabled, but read-only
inspection found no installed user plugin directory or other non-content
evidence that the capability had been exercised. Treat this as a discretionary
fallback capability, not an essential-parity failure. Reopen the disposition
if desktop-wide Computer Use becomes an actual requirement before OpenAI adds
Linux support.

## Classification Summary

- **Deal-breakers:** none found.
- **Accepted operational warnings:** the Linux app is a preview; CachyOS is
  outside OpenAI's supported distribution list; AppArmor is disabled on this
  host; native Wayland remains experimental; startup is slow; and the desktop
  entry omits the fallback-only `codex-browser-sidebar:` OS association. This
  audit verified documented application sandbox and approval controls, not
  complete runtime-hardening parity with the finishing fork.
- **Discretionary finishing-fork capabilities:** desktop-wide Computer Use,
  Remote mobile control, AppShots, Thorium support, and the other saved port
  integrations. None is established as an essential or exercised requirement
  by the non-content evidence available to this audit.

## Compared Baselines

- The fallback is the annotated
  [`fallback-baseline-2026-08-16`](https://github.com/nisavid/chatgpt-linux/tree/fallback-baseline-2026-08-16)
  tag at `dd3d1397f544752ea1170af8393cd59379373f52`. It was generated from
  ChatGPT `26.810.52044` with Electron `42.3.0` and retained as the exact
  verified rollback artifact.
- At the audit boundary, the active producer was CachyOS
  `chatgpt-desktop-bin 26.810.52044-1`. Its
  [recipe pinned at `a09deb2`](https://github.com/CachyOS/cachyos-aur-derived/blob/a09deb22c33c5be84ce42e9fb2299e4f57326d68/chatgpt-desktop-bin/PKGBUILD)
  binds its source to OpenAI's versioned
  [`chatgpt_26.810.52044_amd64.deb`](https://persistent.oaistatic.com/codex-app-prod/linux/deb/pool/main/c/chatgpt/chatgpt_26.810.52044_amd64.deb)
  and SHA-256
  `708a15a1bb76e2bb7f0e376e5145391fa277ad3a64057c1d32537bdc2a1b4e6e`.
  The recipe extracts that payload, adds the reviewed Arch launcher, relocates
  license material, and removes Debian-only metadata. The
  [accepted switch record](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607)
  binds the resulting CachyOS package and detached signature, full-trust signer,
  recipe commit, installed payload, and host acceptance.
- Both compared builds therefore carry the same product version and Electron
  generation. The comparison is between the official Linux payload and the
  finishing fork's Linux adaptation and integrations, not between unrelated
  ChatGPT releases.

The host inspection was read-only. It checked package metadata and owned
surfaces with pacman; launcher, desktop, and AppArmor declarations as text;
active process metadata with `ps`; update authority with pacman and systemd;
URI registration with `xdg-mime`; and only the names or shapes of relevant
state records under the standard ChatGPT configuration roots. It did not
inspect secrets, browser contents, conversation contents, or credentials, and
it did not drive the GUI or create new browser history. The distinctions below
between documented capability and observed host behavior are intentional.

## Essential, Documented, And Observed Surfaces

| Surface | Official-app evidence | Difference from the fallback | Disposition |
| --- | --- | --- | --- |
| Core product and projects | OpenAI describes the Linux preview as supporting ChatGPT sign-in, projects, local files, and Codex. The installed app is running on the host. ([Linux guide](https://learn.chatgpt.com/docs/linux/linux-app), [desktop overview](https://learn.chatgpt.com/docs/app)) | The fallback adapted the macOS bundle to provide the same product generation on Linux. | Essential capability is documented and core launch is observed. Project and local-file flows were not driven in this audit. |
| Profile and account state | The accepted switch preserved the existing profile, sign-in, history, settings, and every inventoried durable entry. The active official process uses the same `Codex` profile root. ([switch evidence](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607), [switch contract](https://github.com/nisavid/chatgpt-linux/issues/137#issuecomment-5304506396)) | The fallback added wrapper-owned state beside the shared profile; that state is not required for ordinary official-app use. | Essential parity present. No corruption or migration blocker observed. |
| Launch and desktop integration | The package owns `chatgpt`, `chatgpt.desktop`, the app payload, icon, licenses, and user-namespace profile. Closing and relaunching from the persisted Plasma pin succeeded with the existing profile. ([switch evidence](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607), [CachyOS launcher](https://github.com/CachyOS/cachyos-aur-derived/blob/a09deb22c33c5be84ce42e9fb2299e4f57326d68/chatgpt-desktop-bin/chatgpt-launcher.sh)) | Startup is slow, but it was similarly slow from the command and desktop entry. The fallback had extra warm-start, migration, and webview verification orchestration. | Essential parity present; startup latency is an accepted warning. |
| URI handling | `codex:` remains assigned to `chatgpt.desktop` and the package advertises it. | The official desktop entry does not advertise the fallback-only `codex-browser-sidebar:` OS association. No external caller or failure requiring that association was found. | Essential parity present; missing secondary association is an accepted warning. |
| Codex continuity | The independently installed global `codex` command remained at `codex-cli 0.147.0`, and the active task continued across the switch. ([switch evidence](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607)) | The fallback launcher performed extra CLI discovery and update preflight. The official app does not own or replace the global command. | Essential parity present; the global CLI remains the continuity boundary. |
| Browser | The official payload contains OpenAI's Browser and Chrome plugins, the running session exposes the Browser skill, and the shared profile retains a populated, separate in-app browser partition. OpenAI documents the browser's separate profile, site approvals, sensitive-action confirmations, and plugin invocation. ([Browser documentation](https://learn.chatgpt.com/docs/browser)) | The fallback added Linux browser patches and a Thorium adapter. The saved fallback selection included that adapter, but no evidence makes Thorium an essential producer dependency. | Essential browser path present. Thorium support remains discretionary. |
| Files, artifacts, and plugins | OpenAI documents desktop previews and annotations for documents, presentations, spreadsheets, PDFs, HTML, and websites, plus shared skills and plugins. The official payload carries the current OpenAI bundled plugin set. ([file workflow](https://learn.chatgpt.com/docs/artifacts-viewer), [skills and plugins](https://learn.chatgpt.com/docs/skills-and-plugins)) | The fallback added local port integrations and helpers around the same product. | Essential capabilities are documented and bundled plugins are observed. Artifact workflows were not driven in this audit. |
| Permissions | OpenAI documents workspace sandbox and approval controls; changing the reviewer does not expand the sandbox. ([permissions](https://learn.chatgpt.com/docs/permission-modes)) | The fallback added local Computer Use authorization plumbing and build-time and runtime hardening without replacing OpenAI's application-level controls. | Application-level controls are documented. Complete runtime-hardening parity was not established and remains an accepted evidence gap, not a blanket parity claim. |
| Update authority | The validated native repackage installs no updater service, timer, socket, or Polkit action. Pacman and the signed CachyOS repository are the sole update authority. OpenAI likewise directs supported distributions to update through their package manager. ([Linux update guidance](https://learn.chatgpt.com/docs/linux/linux-app), [switch evidence](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607)) | The fallback shipped an unprivileged rebuild service plus privileged package-install actions. The owner has removed the transition-only `IgnorePkg` hold and chosen routine CachyOS upgrades. | The selected behavior is the desired steady-state policy, not a loss of essential parity. |

## Material Omissions That Are Not Current Blockers

### Desktop-wide Computer Use

OpenAI explicitly limits desktop-wide Computer Use to macOS and Windows during
the Linux preview. The active official payload has no bundled
`computer-use` plugin directory, while the fallback package carried a Linux
backend, bundled plugin, and registration patches. The fallback still required
OpenAI eligibility, a fresh installed-and-enabled plugin record, app approval,
and local readiness; installing it did not create an entitlement
([OpenAI Computer Use](https://learn.chatgpt.com/docs/computer-use),
[fallback authority boundary](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/docs/maintainers/fork-divergences.md#12-linux-computer-use-integration-compatibility)).

The saved wrapper setting enabled the Computer Use UI, but there is no current
installed user plugin directory or other non-content evidence of use. The
in-app browser remains available for web interaction. This omission becomes a
deal-breaker only if Linux desktop-app control, rather than browser control,
becomes essential.

### Remote Mobile Control

OpenAI currently documents Remote for a connected Mac or Windows PC, not Linux
([Remote documentation](https://learn.chatgpt.com/docs/remote)). The fallback's
saved integration selection included its Remote UI and mobile-host patches, but
the retained device-key store had no enrolled key in the read-only 2026-08-17
shape inspection. There is no evidence of an enrolled device or an exercised
workflow. This is a discretionary capability unless the owner decides that
starting, steering, or approving tasks from a phone is an essential Linux
requirement.

### AppShots

OpenAI documents AppShots as macOS-only
([AppShots documentation](https://learn.chatgpt.com/docs/appshots)). The fallback
selected a Linux AppShots integration, but no durable use evidence was found.
OpenAI documents ordinary file and artifact workflows, while the accepted
browser path provides browser annotations. Those workflows were not driven in
this audit. Treat Linux AppShots as a discretionary convenience.

### Finishing-Fork Convenience Integrations

The saved fallback selection enabled Agent Workspaces, AppShots, wrapper
updater UI, conversation mode, Copilot reasoning-effort defaults, open-target
discovery, Read Aloud and its MCP, Remote UI and mobile control, and the Thorium
adapter. Selection records desired build composition, not actual use. Apart
from the populated browser profile, no evidence in this audit establishes any
of those adapters as essential.

OpenAI documents first-party Voice for the desktop app generally and singles
out only screen context as macOS-specific
([Voice documentation](https://learn.chatgpt.com/docs/features/voice)). That is
the first-party replacement candidate for the fallback's conversation and Read
Aloud helpers; a concrete Linux Voice failure would be new evaluation evidence.

## Security, Privacy, And Support Posture

- The official path removes the mutable-DMG conversion, ASAR patching, local
  update builder, updater daemon, and privileged updater install actions from
  the active runtime. The finishing fork's generation and release hardening
  remains valuable evidence for its retained artifact, but those controls
  protect a derivative build pipeline rather than a capability the official
  package must reproduce
  ([fallback release boundary](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/docs/maintainers/fork-divergences.md#13-release-security-and-supply-chain-verification)).
- The active package is a validated CachyOS repackage, not an OpenAI-supported
  Arch lifecycle. OpenAI's preview support list currently names Ubuntu,
  Debian, and Fedora; CachyOS compatibility remains operational evidence, not a
  vendor support guarantee
  ([Linux support matrix](https://learn.chatgpt.com/docs/linux/linux-app)).
- AppArmor is disabled on this host. The installed profile is an unconfined
  user-namespace grant and is not enforced. Electron launches successfully with
  current user namespaces. This was accepted during the package switch and is
  a host hardening decision, not a newly discovered product-parity blocker.
- This was not a complete comparative runtime-security audit. It established
  package provenance, the active update boundary, documented application
  sandbox and approval controls, and the observed AppArmor state. It did not
  prove equivalence with every Electron, generated-app mutation, updater, or
  release hardening control in the finishing fork. A reproducible security or
  isolation regression remains a reopen condition.
- Both compared builds run OpenAI's product and use the same shared account and
  profile. No state or configuration inspection found a privacy regression
  caused by the official producer. The browser keeps a separate profile and
  requires site and sensitive-action approvals; ordinary task actions remain
  bounded by sandbox and approval policy
  ([Browser documentation](https://learn.chatgpt.com/docs/browser),
  [permissions](https://learn.chatgpt.com/docs/permission-modes)). This is not a
  general privacy audit of OpenAI-hosted services.
- OpenAI labels the Linux app a preview. Native Wayland is experimental and the
  app uses XWayland when available. The accepted host instance is running in a
  Wayland session through the app's X11 backend, so this is a support warning
  rather than a current failure
  ([Linux guide](https://learn.chatgpt.com/docs/linux/linux-app)).

## Recovery And Reopen Conditions

The validated native repackage does not reproduce the fallback's updater
rollback package, generation journal, or transition snapshot machinery. Those
are recovery controls for the finishing fork and the producer switch, not
ordinary ChatGPT product features. The accepted
[sunsetting contract](https://github.com/nisavid/chatgpt-linux/issues/149#issuecomment-5325243686)
keeps one exact private fallback set and the transition snapshot through M3,
then releases executable evidence only through the later M4 cleanup gate.

This audit supported the now-accepted producer and sunsetting dispositions.
Reopen them only if one of these occurs:

1. launch, profile, account, project, task, browser, or global Codex continuity
   regresses under normal use;
2. the signed OpenAI-to-CachyOS package chain becomes unavailable or fails
   validation;
3. desktop-wide Computer Use, Remote mobile control, or AppShots becomes an
   essential Linux workflow with no acceptable first-party or browser-based
   substitute; or
4. routine package updates introduce a reproducible security, privacy, state,
   or integration failure.

Absent one of those conditions, optional finishing-fork adaptations do not
justify maintaining a second ChatGPT producer.

The repository's `CONTEXT.md` still describes the transition-only persistent
`IgnorePkg` hold as active update policy. The operator has removed that hold
and selected routine CachyOS upgrades. The
[retirement closeout](https://github.com/nisavid/chatgpt-linux/issues/158) must
retire that stale statement; it does not change this research result.

## Primary Sources

- OpenAI: [ChatGPT desktop app for Linux](https://learn.chatgpt.com/docs/linux/linux-app),
  [desktop app overview](https://learn.chatgpt.com/docs/app),
  [Browser](https://learn.chatgpt.com/docs/browser),
  [Computer Use](https://learn.chatgpt.com/docs/computer-use),
  [Remote](https://learn.chatgpt.com/docs/remote),
  [AppShots](https://learn.chatgpt.com/docs/appshots),
  [Voice](https://learn.chatgpt.com/docs/features/voice), and
  [Permissions](https://learn.chatgpt.com/docs/permission-modes).
- CachyOS:
  [`chatgpt-desktop-bin` recipe at `a09deb2`](https://github.com/CachyOS/cachyos-aur-derived/commit/a09deb22c33c5be84ce42e9fb2299e4f57326d68).
- Fallback baseline:
  [`fallback-baseline-2026-08-16`](https://github.com/nisavid/chatgpt-linux/tree/fallback-baseline-2026-08-16),
  [fork divergence inventory](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/docs/maintainers/fork-divergences.md),
  and
  [runtime contract](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/docs/maintainers/package-runtime-maintenance.md).
- Accepted host evidence:
  [fallback-to-official switch record](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607).
