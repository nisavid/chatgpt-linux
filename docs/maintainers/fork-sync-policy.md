# Fork Sync Policy

> [!WARNING]
> ChatGPT for Linux is retired and unsupported. This document preserves the
> former sync contract for audit history. Do not use it to start or continue
> maintenance or another sync. See
> [Repository Retirement](../retirement.md).

This was the procedure for syncing changes from the Linux-port upstream into
this fork. In this historical document, `upstream` means the `upstream` remote
for `ilysenko/codex-desktop-linux` unless a sentence names another surface. The
procedure was used with [Fork Divergences](fork-divergences.md), the canonical
inventory of former local contracts and terminology.

The local policy config is `.agents/fork-sync-policy.toml`. It exists for
agents and maintainers; runtime code does not consume it.

<!--
Future refactor note: this file still contains generic fork-sync procedure
because repo-local parameters are interleaved with the workflow. When revisiting
it, identify the general rules and the localization parameters they need, such
as remotes, target repository, required merge method, local gates, ledger
fields, rename maps, and issue or backlog destinations, then migrate the common
behavior into the user-global `syncing-forks-with-upstream` skill.
-->

## Historical Required Workflow

Before retirement, a sync used this workflow:

1. Maintainers created a task branch because `main` was protected.
2. They fetched `origin` and `upstream`.
3. They read [Fork Divergences](fork-divergences.md),
   `.agents/fork-sync-policy.toml`, and this document before resolving
   conflicts.
4. They used the user-global `syncing-forks-with-upstream` skill before choosing a
   merge method or pushing a sync branch. If that external skill is unavailable,
   they continued from this document and recorded the missing-skill fallback in
   the sync ledger.
5. They preserved upstream commit identity. A required PR merged the sync with
   a normal merge commit, not a rebase or squash merge.
6. They preserved this fork's intentional contracts unless the PR intentionally
   changed policy.
7. They updated the upstream baseline in
   [Fork Divergences](fork-divergences.md) after the sync. The policy config
   pointed to that canonical inventory instead of duplicating the mutable
   commit hash.
8. They compared upstream user-facing docs against this fork's README and usage
   docs, classifying relevant additions as adapted under local contracts,
   already covered, intentionally omitted, or follow-up.
9. They checked [Renamed Path Reconciliation](#historical-renamed-path-reconciliation)
   before resolving missing-file, modify/delete, rename/delete, or add/add
   conflicts.
10. They closed reusable policy gaps found during the sync by updating the
    narrowest durable policy surface before handoff.
11. They created or updated an in-tree sync ledger entry under
   [Fork Sync Ledger](fork-sync-ledger/) before closeout. The PR body may carry
   a concise summary, but the tracked ledger entry is the durable source.
12. They ran the required local gates before the first push containing code
    changes covered by [Historical Local Gates](#historical-local-gates).
13. They created a draft PR in the same workflow turn as the first task-branch
    push.
14. They used `--repo nisavid/chatgpt-linux` on every `gh pr` command in this
    checkout instead of relying on GitHub CLI repository inference.
15. They kept the PR in draft until local gates passed and the PR body recorded
    verification evidence.
16. They inspected GitHub blockers directly instead of inferring merge
    readiness from summary status alone.

## Historical Sync Ledger

Every broad upstream sync required a tracked ledger entry under
[Fork Sync Ledger](fork-sync-ledger/) with:

- upstream refs fetched and the baseline commit;
- policy files read;
- every divergence area checked;
- upstream user-facing doc changes reviewed;
- readme-relevant additions classified as adapted under local contracts,
  already covered, intentionally omitted, or follow-up;
- renamed-path checks completed, including any manual old-path to current-path
  reconciliations;
- policy gaps found and codified, or a note that no reusable gap was found;
- baseline update made in [Fork Divergences](fork-divergences.md);
- incoming changes that affect local contracts;
- explicit classification of port-owned `CHATGPT_*` versus inherited OpenAI
  `CODEX_*` environment interfaces;
- package transition, no-shim, and journaled XDG migration checks when identity
  surfaces change;
- classification for each affected area: preserved, upstream now implements it,
  obsolete by policy, intentionally changed, or uncertain;
- exact local verification commands and results;
- special-handling highlights that future maintainers may need to review;
- follow-up decisions for each special-handling item, including links to
  existing issues, newly created issues, or a note that no issue is warranted;
- unresolved uncertainties escalated to the operator, or linked to a durable,
  discoverable follow-up when escalation is unavailable.

A push remained blocked while the ledger had unchecked divergence areas,
untriaged uncertainty, or missing required local gates.

## Historical Local Gates

Before retirement, a push affecting the generated app, installer, ASAR
patcher, package builders, package payload, updater rebuild flow, or bundled
runtime helpers required maintainers to:

1. refresh `ChatGPT.dmg`, or verify the cached DMG was refreshed within the last
   24 hours.
2. run `make build-app` or `./install.sh` from current sources.
3. run the relevant package builder and inspect
   package metadata plus file listings.
4. run the relevant release gate when release workflow changed.
5. record exact commands and results in PR verification notes before marking the
   PR ready for review.

CI is secondary evidence for these surfaces. It does not replace the local
build gate.

## Historical Contract Review

Review incoming changes against every area in
[Fork Divergences](fork-divergences.md#divergence-inventory). In particular,
protect the ChatGPT for Linux product and repository identity; `chatgpt` and
`chatgpt-updater` package, command, service, and XDG names; port-owned
`CHATGPT_*` environment variables; inherited OpenAI `CODEX_*` interfaces;
install paths; the no-shim package transition and journaled state migration;
XDG/FHS layout; package versioning from the OpenAI DMG bundle; updater privilege
boundaries; package payload shape; and security gates.

If an upstream change appears to implement the same behavior, update the
divergence inventory to describe the current diff against the synced upstream
baseline. If the impact is uncertain, escalate to the operator when the session
allows. Only defer the decision when escalation is unavailable or the operator
requested an uninterrupted run; in that case, record a durable, discoverable
follow-up where the escalation would have happened. The PR body can link to that
follow-up, but it is not sufficient by itself.

Treat upstream README and usage-doc changes as product facts to review, not as
text to copy wholesale. Pull over facts that affect supported platforms, host
requirements, feature gates, install/update commands, troubleshooting, or
validation, but translate names, paths, service identifiers, package filenames,
and commands to this fork's local contracts.

## Historical Policy Gap Closeout

Treat discovered repeatable sync hazards as part of the sync, not as optional
retrospective notes. If a conflict, missed change, review comment, local gate,
or manual reconciliation exposes a rule future agents need, update the
narrowest durable surface before handoff:

- `docs/maintainers/fork-divergences.md` for repo-specific contracts, rename
  maps, baselines, and divergence checks;
- `.agents/fork-sync-policy.toml` for machine-readable repo-local policy flags
  and pointers;
- this document for repo-local sync workflow;
- `AGENTS.md` for rules that must be preloaded before an agent can choose a
  triggered workflow;
- the user-global `syncing-forks-with-upstream` skill for behavior that applies
  across maintained forks;
- tests or scripts for repeatable mechanical checks.

If the right owner is uncertain, escalate to the operator when the session
allows. Only defer the decision when escalation is unavailable or the operator
requested an uninterrupted run; in that case, record a durable, discoverable
follow-up where the escalation would have happened, and keep the safest local
guard that prevents dropped upstream changes, history replay, contract drift,
or missing verification.

## Historical Renamed Path Reconciliation

Git's merge strategy normally performs rename detection, but it is similarity
based and can still surface an upstream edit as a missing old path,
modify/delete conflict, rename/delete conflict, or resurrected file. Treat those
states as reconciliation work, not permission to drop the upstream change.

Before resolving sync conflicts:

1. Review the current rename map in
   [Fork Divergences](fork-divergences.md#current-local-rename-and-compatibility-map).
2. Inspect the merge with rename-aware commands:

   ```bash
   git status --renames
   git diff --name-status --find-renames HEAD...MERGE_HEAD
   ```

3. For each upstream change to an old path, apply the equivalent change to the
   current local path. In an active merge, this pattern keeps the old-path diff
   visible while you reconcile:

   ```bash
   base="$(git merge-base HEAD MERGE_HEAD)"
   git diff "$base" MERGE_HEAD -- old/path
   git show MERGE_HEAD:old/path
   ```

   Replace `MERGE_HEAD` with the upstream ref when inspecting before starting a
   merge.

4. Remove resurrected old paths only after their incoming changes are ported or
   intentionally rejected:

   ```bash
   git rm old/path
   git add current/path
   ```

5. Record each manual reconciliation or intentional omission in the sync
   ledger, including the old path, current path, and verification run.

If Git automatically maps the rename, still confirm the resulting current file
contains the incoming upstream change and that the old path remains absent
unless compatibility requires it.
