# Security Backlog

Open security follow-up now lives in GitHub Issues. Use this file as the
repository-local index and review workflow pointer.

- [All open security backlog issues](https://github.com/nisavid/codex-app-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3Abacklog)
- [Highest priority security backlog](https://github.com/nisavid/codex-app-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3A%22priority%2Fhigh%22)
- [Medium priority security backlog](https://github.com/nisavid/codex-app-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3A%22priority%2Fmedium%22)
- [Lower priority security backlog](https://github.com/nisavid/codex-app-linux/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity%20label%3A%22priority%2Flow%22)

## Security Review Workflow

Use the `@codex-security` plugin (`plugin://codex-security@openai-curated`) for
security-sensitive backlog work before implementation is treated as
review-ready. This applies especially to updater trust, privileged install
boundaries, release verification, local rebuild inputs, generated-app IPC,
bundled browser or Chrome native-host behavior, Computer Use desktop control,
and secret redaction.

Expected workflow:

1. Run the plugin against the current branch and the relevant backlog issue.
2. Record the reviewed trust boundaries, attacker capabilities, and required
   mitigations in the PR body or a maintainer note.
3. Implement the change in source scripts, package templates, updater code, or
   verification workflows rather than generated artifacts.
4. Run the local validation gate for the touched surface, including local app
   generation and package build checks when package or rebuild behavior changes.
5. Re-run `@codex-security` or document why the previous result still applies
   before merging.

`@codex-security` is an additional security review gate. It does not replace
the local build gate, CodeQL, package metadata inspection, threat-model updates,
project [security best practices](security-best-practices.md), or human
maintainer approval where those are required.

The filtered links above are authoritative for status and priority. Do not
duplicate issue inventories here; completed work otherwise remains falsely
listed as open. The
[Remote Mobile Host Boundary Review](remote-mobile-host-boundary-review.md)
keeps the repository-local evidence for that specific review surface.
