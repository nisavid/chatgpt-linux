# AGENTS.md

## Repository Role

This repository is the retired, unsupported source record for ChatGPT for
Linux. It is a local hardening and finishing fork layered over the Linux-port
upstream, [`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux).
It is not the primary Linux port and is not affiliated with, endorsed by,
sponsored by, or supported by OpenAI.

The validated native repackage is the settled producer. The authoritative
current boundary is [Repository Retirement](docs/retirement.md). The
[official-app parity record](docs/maintainers/research/official-app-parity-2026-08.md)
and
[rollback-evidence retention record](docs/maintainers/research/rollback-evidence-retention-boundary-2026-08.md)
preserve the accepted evidence.

## Retirement Boundary

Work in this repository is limited to the explicitly authorized retirement
route:

- correct or preserve the public record;
- disposition existing issues and pull requests transparently;
- export a bounded, still-useful source improvement when its owning closeout
  ticket authorizes that export; and
- complete the repository archive ticket after its gates pass.

Do not start or resume builds, releases, dependency refreshes, upstream syncs,
DMG or hash campaigns, package or updater maintenance, support work, feature
work, compatibility work, or security remediation. Do not recreate, enable, or
dispatch retired automation. A new owner initiative must explicitly reverse
retirement before any of those activities can begin.

Open Dependabot and code-scanning alerts are unresolved retired risk. Do not
close them as fixed, describe them as remediated, or start a maintenance cycle
to address them.

The delayed M3 package-lifecycle check and M4 deletion of private fallback and
recovery evidence belong to `nisavid/arch-pkgs` issues
[#76](https://github.com/nisavid/arch-pkgs/issues/76) and
[#77](https://github.com/nisavid/arch-pkgs/issues/77). Do not inspect, move,
delete, or publish that private evidence from this repository.

## Language

- The project prose name is **ChatGPT for Linux**. The repository and checkout
  name is `chatgpt-linux`; the historical runtime and package identity is
  `chatgpt`.
- `Linux-port upstream` means `ilysenko/codex-desktop-linux`. Do not call this
  repository “the Linux fork.”
- Preserve `Codex` for inherited OpenAI interfaces such as the Codex CLI,
  protocols, packages, skills, bundle identifiers, and explicit historical
  discussion. Do not use it as this application or project's name.
- Use `port integration` for the historical configurable modules under
  `port-integrations/`. Do not present them as maintained Linux features.
- Use `CHATGPT_*` for variables introduced by this fork or the Linux-port
  upstream. Keep inherited OpenAI `CODEX_*` interfaces unchanged.

## Git And Pull Requests

- `main` is protected. Create a task branch before editing.
- Use `checkpointing-and-publishing-git-work` for every Git-backed task and
  commit only task-owned paths.
- The first push of a task branch must create a draft pull request in the same
  workflow turn.
- Use `publishing-reviewable-prs` for every PR creation, title/body mutation,
  and draft/ready transition. Use `writing-reviewable-pr-descriptions` for the
  complete reviewer-facing title and body. Never use `gh pr create --fill` or
  its variants.
- Use `--repo nisavid/chatgpt-linux` on every `gh pr` command in this checkout.
- Use Conventional Commits and prefer rebase merge when repository policy
  permits it.
- Do not merge or archive until the active ticket's exact checks, reviews,
  tracker prerequisites, and ownership gates pass.

## Tracker And Archive Work

- Read an issue or pull request's operator-owned checklist before mutation.
  Update only checklist items owned by the operator and authorized by the
  active task.
- Preserve contributor credit and distinguish “retired without fix” from
  “fixed.”
- Do not open replacement maintenance tasks. Route delayed rollback cleanup to
  the existing `arch-pkgs` owners.
- Repository archival is owned by the dedicated archive ticket. Archival must
  preserve the Git history, fallback tag, research, issue and PR record, and
  historical Actions runs.

## Source And State Safety

Treat `chatgpt/`, side-by-side `*-app/` output, `dist/`, `ChatGPT.dmg`, updater
paths, XDG application state, caches, logs, profiles, and recovery material as
generated or user-owned state. Retirement documentation and tracker work does
not authorize mutating any of it.

Do not build or hand-edit generated app output. Do not mutate installed
packages, host services, package repositories, user state, private rollback
evidence, or credentials from this repository's closeout tasks unless a
separate task names the exact target and grants that authority.

## Documentation

- `README.md` is the user-facing retirement landing page.
- `docs/retirement.md` is the current maintainer and support boundary.
- `docs/README.md` separates the current retirement record from historical
  build, package, updater, DMG, sync, and architecture documents.
- Historical instructions may remain for source interpretation, but must be
  labeled historical and must not compete with the retirement route.
- In committed docs and PR text, use repository-relative paths and public URLs,
  never machine-local absolute paths.

## Validation

Choose the smallest checks that cover the closeout change. Retirement posture
or automation changes must run:

```bash
node --test scripts/ci/retirement-posture.test.js
bash -n tests/scripts_smoke.sh
git diff --check
```

Run the broader relevant Node or documentation checks when changed files share
their surface. Before finalization, review the exact immutable diff and refresh
thread-aware pull request state.
