# Support and Issue Routing

Use this guide to decide where to report a bug, request a feature, or attribute
behavior in ChatGPT for Linux.

## What This Project Provides

This repository does not publish or redistribute the official ChatGPT app. It
provides a recipe that converts the official OpenAI ChatGPT DMG into a local
Linux app, then builds native packages and updater support around that local
build.

Most user-facing app behavior still comes from the official OpenAI app bundle
and OpenAI-hosted services. OpenAI now publishes an official Linux package, but
does not publish or support this community fork. Behavior introduced by this
fork's DMG conversion, packaging, integrations, or local runtime remains this
project's responsibility.

## Where To Report

Report official ChatGPT desktop-app or hosted-service problems through
[OpenAI Support](https://help.openai.com/) when they reproduce in an official
OpenAI build. Report Codex CLI or coding-agent issues to
[OpenAI's Codex repository](https://github.com/openai/codex) only when they
reproduce in the OpenAI-owned Codex interface and are not specific to this
Linux wrapper.

> [!IMPORTANT]
> When reporting to OpenAI, reproduce in an official macOS or Linux build when
> possible and base the report, screenshots, logs, and terminology on that
> build. Do not report behavior unique to this community fork as an OpenAI app
> bug.

Report an issue to
[`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux)
when it reproduces in the Linux-port upstream build, or when the change belongs
to the shared Linux conversion layer that this fork inherits.

> [!IMPORTANT]
> When reporting to the Linux-port upstream, reproduce with a build of
> `ilysenko/codex-desktop-linux` when possible and attach captures or logs from
> that build. Use the Linux-port upstream's names for surfaces that this fork
> renames; see the
> [rename and compatibility map](../maintainers/fork-divergences.md#current-local-rename-and-compatibility-map)
> for the full mapping.

Report an issue to
[`nisavid/codex-app-linux`](https://github.com/nisavid/codex-app-linux) when it
is specific to this fork's package identity, distro-shaped install layout,
updater policy, hardening, supported default integrations, docs, or local
maintenance workflow. Also report here if you cannot reasonably try an
official macOS or Linux build, or the Linux-port upstream reproduction needed
for another tracker.

If you are unsure, file the issue here and include enough detail to reroute it:
the app version, build method, distro, desktop session, whether the same
behavior reproduces in the Linux-port upstream build, whether it also
reproduces in an official macOS or Linux build, and any reason you could not
attempt those repros.

## Port Integrations

Port integrations are build-time integration modules that adapt official ChatGPT app
surfaces or local runtime helpers to this Linux port. The source directory is
`port-integrations/`.

This fork enables the current supported integration set by default. The default
policy treats these integrations as part of the complete local package, with the
same experimental stability caveats as the rest of the port. Users can disable
an integration when it conflicts with their system or when they want a lighter
build. See [`port-integrations/README.md`](../../port-integrations/README.md) for the
current integration list and config format.

Port integrations do not bypass OpenAI account policy or service-side rollouts. If
a UI surface depends on OpenAI-hosted account state, MFA, connected-client
state, audio availability, or remote-control enrollment, installing this fork
does not change those requirements. Local control surfaces keep their own
runtime gates: Agent Workspaces uses settings-page approval and permission rules
for the normal UI flow, with main-process bridge hardening tracked in
[#99](https://github.com/nisavid/codex-app-linux/issues/99); AppShots keeps
global hotkeys inactive until selected; and wrapper update checks stay off until
enabled in Settings.
