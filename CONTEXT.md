# ChatGPT for Linux

This context names the unofficial Linux project, the OpenAI product it adapts,
and the Codex subsystem that remains inside that product.

## Language

**ChatGPT**:
The product name for the current OpenAI desktop application and this project's
generated Linux application.
_Avoid_: Codex, Codex App, ChatGPT Desktop

**ChatGPT for Linux**:
The prose name for this unofficial hardening and finishing fork.
_Avoid_: Codex App for Linux, ChatGPT Desktop for Linux, the Linux fork

**Canonical project identity**:
The canonical GitHub repository is `nisavid/chatgpt-linux`, with
`chatgpt-linux` as the local project and checkout name. GitHub redirects the
former `nisavid/codex-app-linux` slug to this repository. Runtime and package
identities remain `chatgpt`.
_Avoid_: using the former slug as canonical, using `chatgpt-linux` as the app
name

**Codex**:
The coding subsystem, CLI, and OpenAI-owned compatibility interfaces retained
inside ChatGPT.
_Avoid_: using Codex as the name of the application, package, or project

**Finishing fork**:
This repository's hardening, packaging, policy, and runtime-polish layer over
the Linux-port upstream.
_Avoid_: Linux fork, primary Linux port

**Fallback baseline**:
The finishing fork at its tagged, fully verified rename-completion commit,
retained with exact package evidence as a reinstallable alternative while
OpenAI's official Linux app is evaluated.
_Avoid_: co-installed fallback, permanent parallel distribution

**Evaluation transition**:
The period in which one Linux host may alternate between mutually exclusive
official and finishing-fork `chatgpt` installations while the inherited
`codex` CLI remains available as a continuity harness.
_Avoid_: co-installation, dual ChatGPT installation

**Validated native repackage**:
The CachyOS-signed `chatgpt-desktop-bin` package after its source recipe and
built payload have been independently checked against OpenAI's signed official
Linux package, with every distribution-specific change identified. Acceptance
requires a trusted OpenAI package-repository signature plus recorded SHA-256
digests for the official package, repackage, and compared payload manifests.
Missing or mismatched evidence rejects the candidate. An accepted candidate is
evidence for evaluating official-app behavior on CachyOS, but it is not an
OpenAI-supported Arch package lifecycle.
_Avoid_: official Arch release, vendor-supported Arch package

**Official-app evaluation evidence**:
Observed behavior of the OpenAI application payload installed from an official
OpenAI package or a validated native repackage. It supports feature-parity and
sunsetting decisions, but does not establish vendor support for the host
distribution.
_Avoid_: Arch support certification, unmodified vendor package

**Shared operational state**:
The live `Codex` application profile and inherited Codex home that continue to
evolve while either mutually exclusive ChatGPT installation is active. A
package switch preserves this state; rollback does not rewind it automatically.
_Avoid_: installation-owned profile, disposable evaluation state

**Recovery snapshot**:
An integrity-checked pre-switch copy of shared and fallback state used only to
recover from corruption or incompatibility. It captures the complete Transition
recovery set after every writer of a captured path is quiesced, or through that
store's atomic or online-backup interface when its unrelated writer must remain
live. Before any restore, preserve the newer live state and reconcile or
restore only what recovery requires.
_Avoid_: automatic rollback image, routine profile reset

**Selective quiescence**:
Stopping every active ChatGPT desktop process and masking the updater in every
active user manager that the package lifecycle can reach, then confirming that
the current task can resume through the inherited `codex` CLI, without
requiring unrelated Codex tasks on the host to stop.
_Avoid_: whole-host Codex shutdown, live desktop package replacement

**Transition recovery set**:
The durable shared profile, Codex task state, and fallback configuration and
state captured before a package switch. Reproducible worktrees, caches,
temporary files, IPC, and writer locks remain outside the snapshot and are
audited separately when relevant.
_Avoid_: entire-home archive, cache backup, worktree migration

**Retained fallback artifact**:
The exact verified finishing-fork package, digest, source revision, payload
manifest, and verification record kept outside the package-manager cache until
the sunsetting decision. Rollback installs this artifact rather than rebuilding
or selecting a nominally equivalent version.
_Avoid_: pacman-cache-only fallback, version-only rollback

**Active update authority**:
The sole mechanism permitted to replace the installed ChatGPT package. The
fallback uses `chatgpt-updater`; the validated native repackage uses the
CachyOS package repository through pacman, with `chatgpt-desktop-bin` held by
pacman's persistent `IgnorePkg` setting until each replacement candidate passes
the Validated native repackage gate.
_Avoid_: concurrent update authorities, package inference from version alone

**Accepted package switch**:
A two-transaction package replacement that follows the preflight, ordering,
masking, verification, and failure-recovery procedure in
`docs/maintainers/package-runtime-maintenance.md`. It preserves Shared
operational state and reaches a verified package, command, desktop, update
authority, profile, and Codex CLI state before acceptance. Product parity is
evaluated after switch acceptance.
_Avoid_: in-place package upgrade, parity decision as installation failure

**Maintenance fallback**:
The fallback baseline's interim posture: latest-DMG compatibility, security,
packaging, and essential parity repairs without discretionary feature growth.
The rename-completion package remains the designated rollback artifact until a
later repair produces its own tagged, fully verified package, digest, source
revision, payload manifest, and verification record and is explicitly promoted
as the new rollback target. “Latest-DMG” identifies the verified official DMG
used to build that maintenance candidate; it does not change the retained
artifact by itself.
_Avoid_: feature expansion, frozen archive

**Sunsetting decision**:
The later owner decision to retire or retain the finishing fork after the
official Linux app has been evaluated against the project's essential goals.
_Avoid_: automatic retirement, rename-completion decision

**Linux-port upstream**:
`ilysenko/codex-desktop-linux`, the direct upstream whose synced baseline
performs the DMG-based Linux conversion used here. Its current development has
moved to OpenAI's signed Linux package; this fork has not adopted that source
transition.
_Avoid_: using upstream when the official OpenAI artifact could also be meant

**Port-owned identity**:
A package, command, service, desktop, XDG, or environment-variable name
introduced by the Linux-port upstream or this finishing fork.
_Avoid_: treating port-owned names as immutable OpenAI interfaces

**OpenAI-owned Codex interface**:
A first-party Codex runtime, CLI, protocol, bundle, skill, or configuration
interface whose name remains part of ChatGPT.
_Avoid_: renaming these interfaces for visual consistency

**Legacy local identity**:
The former `codex-app` and `codex-app-updater` package, runtime, and XDG
names that migrate to canonical `chatgpt` and `chatgpt-updater` names.
_Avoid_: applying this term to Linux-port upstream installations

**Port integration**:
A configurable build-time module that adapts official app behavior or supplies
a local runtime helper for this Linux port.
_Avoid_: Linux feature, optional patch

**Owning feature control**:
The existing ChatGPT, Codex, or port-integration setting, approval, or policy
that authorizes a feature's sensitive actions until the user changes it.
_Avoid_: universal Computer Use grant, fork consent, session grant

**Local support readiness**:
The current Linux host and generated app's ability to execute an authorized
feature successfully; it is not a separate authorization decision.
_Avoid_: availability grant, usability permission
