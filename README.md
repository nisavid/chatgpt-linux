<div align="center">
  <img src="assets/chatgpt.png" alt="ChatGPT for Linux project logo" width="128" height="128">
  <h1>ChatGPT for Linux</h1>
  <p><strong>Retired source record for an unofficial Linux finishing fork.</strong></p>
</div>

> [!IMPORTANT]
> **ChatGPT for Linux is retired and unsupported.** This repository no longer
> produces maintained builds, releases, updates, security fixes, or user
> support. Do not install or update ChatGPT from this repository. Its remaining
> closeout work is limited to preserving the public record and archiving the
> repository; the retirement posture is read-only even before GitHub's archive
> switch is applied.

## Current Linux Route

Use OpenAI's official ChatGPT application for Linux or a distribution package
whose provenance you independently accept.

On CachyOS, this project's accepted replacement is the repository-signed
`chatgpt-desktop-bin` native repackage. Its recipe and payload were compared
with OpenAI's signed Linux package, and its essential behavior was accepted on
the transition host. It now follows ordinary unpinned pacman upgrades. This is
operational evidence for that CachyOS package, not a claim that OpenAI supports
Arch Linux or CachyOS.

The complete decision record is in the
[official-app parity audit](docs/maintainers/research/official-app-parity-2026-08.md).
The retained fallback and recovery evidence follow the separate
[rollback-retention boundary](docs/maintainers/research/rollback-evidence-retention-boundary-2026-08.md).

## What This Repository Preserves

This repository is a historical source and review record for a DMG-based Linux
adaptation. It converted the official OpenAI ChatGPT macOS app locally and
layered the `chatgpt` identity, distro-shaped packaging, updater policy,
hardening, and runtime polish over the Linux conversion work from
[`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux).
It did not redistribute the official OpenAI app bundle.

The [retirement record](docs/retirement.md) explains the final support boundary,
disabled maintenance automation, unresolved security risk, retained research,
and downstream M3/M4 cleanup ownership. The [documentation index](docs/README.md)
routes readers through the remaining historical material.

## Support Boundary

This tracker is not accepting new bug reports, feature requests, package
requests, updater requests, or compatibility work.

- Problems that reproduce in OpenAI's official app belong with
  [OpenAI Support](https://help.openai.com/).
- Codex CLI problems that reproduce independently of this retired wrapper
  belong in [OpenAI's Codex repository](https://github.com/openai/codex).
- Linux conversion work that reproduces in the Linux-port upstream belongs in
  [`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux),
  subject to that project's own support policy.

Do not present behavior unique to this repository as an OpenAI or Linux-port
upstream defect.

## Unofficial Project Notice

**ChatGPT for Linux is an unofficial community project.** It is not affiliated
with, endorsed by, sponsored by, or supported by OpenAI. OpenAI owns ChatGPT,
Codex, the official app, and the OpenAI-hosted services referenced by this
source. The repository license covers this fork's source code and packaging
work, not OpenAI software or services. Use of OpenAI software and services
remains subject to OpenAI's terms.

The project logo is independent community artwork derived from Tux; it is not
an OpenAI mark. Tux credit: Larry Ewing and The GIMP, Garrett LeSage, and IFo
Hancroft. See the
[project-logo rights record](docs/maintainers/project-logo-rights-research.md)
for provenance and the bounded rights assessment.
