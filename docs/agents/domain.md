# Historical Domain Record

> [!IMPORTANT]
> This repository is retired and unsupported. Do not use this to start
> or continue planning, implementation, review, or maintenance. See
> [Repository Retirement](../retirement.md).

This page is a non-executable historical context for the repository's final
maintained domain model.

The repository was a local hardening and finishing fork layered over the
Linux-port upstream. It converted the official OpenAI ChatGPT DMG into native
Linux packages while preserving a local `chatgpt` identity, distro-shaped
layout, updater policy, hardening, and auditable port integrations.

Historical terminology distinguished the Linux-port upstream, the official
OpenAI DMG and app bundle, and OpenAI-hosted services. A port integration was a
configurable build-time module under `port-integrations/`, not a feature of
Linux itself.

The final divergence inventory, threat model, package/runtime notes, and
research records remain linked from the documentation index for provenance.
They describe the retired source; they do not authorize another sync, build,
package, or security-remediation cycle.
