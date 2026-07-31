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
`ilysenko/codex-desktop-linux`, the direct upstream that performs the primary
Linux conversion work.
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
