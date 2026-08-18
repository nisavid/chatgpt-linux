# Security Backlog

> [!IMPORTANT]
> This is historical source for a retired and unsupported repository. Do not
> use it to start or continue maintenance. Follow
> [Repository Retirement](../retirement.md).

This page preserves the former security queue and review workflow. Open items
are unresolved retired risk awaiting truthful tracker disposition, not a work
queue or remediation program.

- [All open security backlog issues](https://github.com/nisavid/chatgpt-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3Abacklog)
- [Highest-priority security backlog](https://github.com/nisavid/chatgpt-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3Abacklog%20label%3A%22priority%2Fhigh%22)
- [Medium-priority security backlog](https://github.com/nisavid/chatgpt-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3Abacklog%20label%3A%22priority%2Fmedium%22)
- [Lower-priority security backlog](https://github.com/nisavid/chatgpt-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3Abacklog%20label%3A%22priority%2Flow%22)

These links preserve the migrated queue's historical compatibility labels.
Their priorities record former scheduling decisions, not current work or
security impact.

## Historical security review workflow

Before retirement, security-sensitive changes used the `@codex-security`
plugin (`plugin://codex-security@openai-curated`) before implementation was
treated as review-ready. The workflow below is retained only to interpret the
historical review record.

The former workflow was:

1. Run the plugin against the current branch and the relevant backlog issue.
2. Record the reviewed trust boundaries, attacker capabilities, and required
   mitigations in the PR body or a maintainer note.
3. Implement the change in source scripts, package templates, updater code, or
   verification workflows rather than generated artifacts.
4. Run the local validation gate for the touched surface, including local app
   generation and package build checks when package or rebuild behavior changes.
5. Re-run `@codex-security` or document why the previous result still applies
   before merging.

`@codex-security` supplemented the local build gate, CodeQL, package metadata
inspection, threat-model updates, project
[security best practices](security-best-practices.md), and human approval.

The filtered links above preserve historical membership and scheduling
priority. The
[Remote Mobile Host Boundary Review](remote-mobile-host-boundary-review.md)
keeps the repository-local evidence for that specific review surface.
