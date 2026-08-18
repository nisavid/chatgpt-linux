# Repository Retirement

ChatGPT for Linux is retired and unsupported. The repository is preserved as a
read-only source, research, and review record while its remaining tracker items
are dispositioned and the GitHub repository is archived. Retirement does not
turn this community fork into an OpenAI-supported product, and it does not make
the Linux-port upstream responsible for this fork's local changes.

## Current user route

Do not install, rebuild, or update ChatGPT from this repository. Use OpenAI's
official Linux application or a distribution package whose provenance you
independently accept.

For the CachyOS host evaluated by this project, the selected producer is the
repository-signed `chatgpt-desktop-bin` native repackage. The
[official-app parity record](maintainers/research/official-app-parity-2026-08.md)
documents the accepted provenance, payload comparison, transition, and
essential behavior. This establishes the project's CachyOS decision; it does
not claim vendor support for Arch Linux or CachyOS.

## Final decision and retained evidence

The parity and rollback studies were completed before the owner made the final
closeout decision:

- The
  [official-app parity record](maintainers/research/official-app-parity-2026-08.md)
  accepted the validated native repackage as the settled producer.
- The
  [rollback-evidence retention boundary](maintainers/research/rollback-evidence-retention-boundary-2026-08.md)
  identifies which private fallback and recovery artifacts remain useful and
  when they can be released.
- The owner subsequently selected retirement and repository archival after the
  immediate package-lane withdrawal and tracker closeout. That decision
  supersedes older wording that described a maintained fallback or left
  retirement contingent on a later evaluation.

Repository archival does not wait for the delayed rollback tail. The first
ordinary signed package upgrade and post-reboot continuity check remain
downstream milestone
[`arch-pkgs` #76](https://github.com/nisavid/arch-pkgs/issues/76). The later,
target-specific deletion of the retained fallback, recovery snapshot, and
fork-only runtime residue remains
[`arch-pkgs` #77](https://github.com/nisavid/arch-pkgs/issues/77). Those tickets
own M3 and M4 respectively; this repository owns neither the private artifacts
nor their deletion authority.

## Support and maintenance boundary

No new builds, releases, dependency refreshes, upstream syncs, DMG refreshes,
package repairs, updater work, compatibility fixes, feature work, or security
fixes are planned here. The source remains available for inspection and
historical reproduction, but its build and install instructions are not a
supported user path.

New reports should go only to a currently maintained owner after reproducing on
that owner's software:

- [OpenAI Support](https://help.openai.com/) for the official ChatGPT app or
  hosted services;
- [OpenAI's Codex repository](https://github.com/openai/codex) for an inherited
  Codex CLI problem; or
- the
  [Linux-port upstream](https://github.com/ilysenko/codex-desktop-linux) for a
  problem that reproduces in that project and falls within its support policy.

The `nisavid/chatgpt-linux` tracker is retained for history and closeout, not as
a support queue.

## Maintenance automation disposition

Retirement removes every repository automation path that could schedule or
create maintenance work:

| Producer | Retirement disposition |
| --- | --- |
| Dependabot version updates | `.github/dependabot.yml` is removed. Automated Dependabot security-update pull requests are disabled in repository settings; vulnerability alerts remain visible as historical risk. |
| Official DMG acceptance | The workflow remains only as read-only pull-request validation. Its hourly schedule, manual dispatch, main-branch trigger, and drift-issue reconciliation job are removed. |
| Nix DMG hash refresh | The write-capable dispatch workflow is removed. The historical refresh scripts remain source evidence, not an active campaign. |
| Cachix population | The cache-writing workflow is removed. Existing cache and workflow-run history are not deleted. |
| CodeQL and Rust Clippy scanning | Scheduled, security-event-writing workflows are removed. Existing alerts and run history remain unresolved evidence. |
| Computer Use sync reminder | The issue-writing workflow is removed. Any bounded source export is handled during tracker closeout, without a standing reminder producer. |
| Contributor PR limiting and label management | Pull-request- and issue-mutating workflows are removed because this repository no longer accepts a maintenance queue. |
| Upstream sync | No scheduled upstream-sync workflow was active at retirement. Agent policy now prohibits starting another sync or maintenance campaign without a new owner decision that explicitly reverses retirement. |

The remaining GitHub Actions workflows have no schedule and no repository,
issue, pull-request, action, or security-event write permission. Historical
workflow definitions and runs remain available through Git history and the
Actions record.

## Unresolved retired security risk

Retirement does not remediate or dismiss the repository's open alerts. A live
inventory on 2026-08-18 recorded 10 open Dependabot alerts:

- high severity: #23 (`undici`) and #33 (`extract-zip`);
- medium severity: #24 through #30 (`undici`) and #32 (`electron`).

It also recorded high-severity CodeQL alert #163,
`actions/cache-poisoning/poisonable-step`.

These alerts are unresolved retired risk. No assertion is made that the
affected historical source is secure, remediated, or suitable for deployment.
Disabling maintenance producers prevents new automated repair work; it does not
change the alert findings or their severity.

## Historical documentation

The remaining architecture, build, package, updater, port-integration,
troubleshooting, DMG, and fork-sync documents describe the final maintained
source state. They are retained to explain the implementation and its evidence,
not as current instructions. The [documentation index](README.md) separates
the retirement record from those historical references.

The repository remains an unofficial community fork of
[`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux).
It is not affiliated with, endorsed by, sponsored by, or supported by OpenAI.
