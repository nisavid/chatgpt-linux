# Documentation Index

ChatGPT for Linux is retired and unsupported. Start with the
[repository retirement record](retirement.md) for the current producer,
support, security-risk, automation, and delayed-cleanup boundaries.

The remaining documents describe the final maintained source state. They are
historical references, not supported install, update, troubleshooting, or
maintenance instructions.

## Decision record

- [Official-app parity](maintainers/research/official-app-parity-2026-08.md)
  records why the validated native repackage became the settled producer.
- [Rollback-evidence retention](maintainers/research/rollback-evidence-retention-boundary-2026-08.md)
  records the M3/M4 boundary for private fallback and recovery evidence.
- [Repository rename verification](maintainers/repository-rename-verification.md)
  records the completed `codex-app-linux` to `chatgpt-linux` cutover.
- [Project logo rights and provenance](maintainers/project-logo-rights-research.md)
  records the approved artwork, attribution, and bounded rights assessment.

## Historical user and package references

- [Build and run](usage/build-and-run.md)
- [Troubleshooting](usage/troubleshooting.md)
- [Former support routing](usage/support-routing.md)
- [Package and runtime maintenance](maintainers/package-runtime-maintenance.md)
- [User-local app integration](../contrib/user-local-install/README.md)
- [Port integrations](../port-integrations/README.md)

These pages may help inspect or reproduce old source. They do not restore
support, establish current compatibility, or authorize a new package or updater
producer.

## Historical architecture and maintenance references

- [Port architecture](port-architecture.md)
- [Port integration architecture](port-integrations-architecture.md)
- [Fork divergences](maintainers/fork-divergences.md)
- [Fork sync policy](maintainers/fork-sync-policy.md)
- [Fork sync ledger](maintainers/fork-sync-ledger/)
- [Official DMG acceptance](upstream-dmg-acceptance.md)
- [Official DMG intelligence](upstream-dmg-intelligence.md)
- [Official DMG watchdog](upstream-dmg-watchdog.md)
- [Webview server evaluation](webview-server-evaluation.md)
- [Launcher performance](launcher-performance.md)
- [Threat model](maintainers/threat-model.md)
- [Security best practices](maintainers/security-best-practices.md)
- [Security backlog](maintainers/security-backlog.md)

The automation described in the DMG, hash-refresh, upstream-sync, issue, and
dependency-maintenance documents is retired. Do not reinstall, dispatch, or
recreate it from these historical instructions.

## Historical agent references

- [AGENTS.md](../AGENTS.md) is the current archival policy and overrides old
  maintenance recipes.
- [Repository map](agents/repository-map.md) describes the preserved source
  layout.
- [Generated and runtime notes](agents/generated-and-runtime-notes.md)
  distinguish source from generated and user-owned state.
- [Changelog](../CHANGELOG.md) preserves user-visible release history.
