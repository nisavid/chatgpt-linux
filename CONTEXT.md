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

**Codex**:
The coding subsystem, CLI, and OpenAI-owned compatibility interfaces retained
inside ChatGPT.
_Avoid_: using Codex as the name of the application, package, or project

**Finishing fork**:
This repository's hardening, packaging, policy, and runtime-polish layer over
the Linux-port upstream.
_Avoid_: Linux fork, primary Linux port

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
