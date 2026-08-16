# Repository Rename Verification

This record captures the in-place GitHub rename from
`nisavid/codex-app-linux` to `nisavid/chatgpt-linux` on 2026-08-16. It is the
durable evidence that the project name changed without replacing the GitHub
repository or its fork relationship.

## Transaction Boundary

The cutover began only after pull request
[#141](https://github.com/nisavid/chatgpt-linux/pull/141) merged and every
merge-triggered or scheduled Actions run was terminal. The exact pre-rename
`main` commit was `cd6fca0d319884f9f11e0a8e48d45ee92b10b0ec`; both queued and
in-progress run inventories were empty. The target slug returned `404`, while
the old repository, API, and Git endpoints resolved that exact commit.

The repository was renamed in place with GitHub's repository rename operation.
The final description is “ChatGPT for Linux — an unofficial hardening and
finishing fork layered over ilysenko/codex-desktop-linux.” The topics are
`arch-linux`, `chatgpt`, `debian`, `desktop`, `electron`, `linux`, `nix`,
`packaging`, `rpm`, and `unofficial`. No export, replacement repository,
force-push, history rewrite, or default-branch change was used.

## Preserved Identity

The following identifiers and relationships matched before and after the
rename:

| Surface | Verified value |
| --- | --- |
| Repository numeric ID | `1220482277` |
| Repository node ID | `R_kgDOSL8U5Q` |
| Default branch and commit | `main` at `cd6fca0d319884f9f11e0a8e48d45ee92b10b0ec` |
| Parent and source | `ilysenko/codex-desktop-linux`, numeric ID `1150380174` |
| Main ruleset | ID `15540147`, active on the default branch |
| Workflow identities | all 16 existing workflow IDs and paths preserved, as listed below |
| Cutover-boundary artifact | `official-dmg-metadata`, ID `9267629207`, from run `31962151780` and the exact `main` commit |

The ruleset retained deletion and non-fast-forward protection, one required
approval, stale-review dismissal, last-push approval, review-thread resolution,
and CodeQL and Clippy scanning. The repository remained a public fork.

### Workflow Identities

| Workflow ID | Path |
| --- | --- |
| `278518360` | `.github/workflows/cachix.yml` |
| `269309841` | `.github/workflows/ci.yml` |
| `274402505` | `.github/workflows/codeql.yml` |
| `281911834` | `.github/workflows/computer-use-sync-reminder.yml` |
| `333363840` | `.github/workflows/contributor-pr-limit.yml` |
| `269309840` | `.github/workflows/install-deps.yml` |
| `333363842` | `.github/workflows/manage-labels.yml` |
| `282574959` | `.github/workflows/official-dmg-build-app.yml` |
| `274402577` | `.github/workflows/rust-clippy.yml` |
| `333363843` | `.github/workflows/update-chatgpt-hash.yml` |
| `267525387` | `.github/workflows/updater.yml` |
| `266390780` | `.github/workflows/verify-apple-dmg.yml` |
| `286572775` | `dynamic/agents/copilot-pull-request-reviewer` |
| `266198035` | `dynamic/copilot-pull-request-reviewer/copilot-pull-request-reviewer` |
| `266178762` | `dynamic/dependabot/dependabot-updates` |
| `266178801` | `dynamic/github-code-scanning/codeql` |

### Tracker And Dependabot Identities

The canonical REST inventory contains the following 17 open issue node IDs.
Every issue was created and last updated before the cutover, and the former and
canonical API routes return these same objects from repository ID `1220482277`.
A pre-cutover search-index query briefly reported 16 open issues; that lagging
count is not used as identity evidence:

| Issue | Node ID |
| --- | --- |
| `#57` | `I_kwDOSL8U5c8AAAABClPI5w` |
| `#58` | `I_kwDOSL8U5c8AAAABClPKKA` |
| `#59` | `I_kwDOSL8U5c8AAAABClPLDw` |
| `#60` | `I_kwDOSL8U5c8AAAABClPMeg` |
| `#61` | `I_kwDOSL8U5c8AAAABClPODw` |
| `#62` | `I_kwDOSL8U5c8AAAABClPQEw` |
| `#63` | `I_kwDOSL8U5c8AAAABClPRTg` |
| `#64` | `I_kwDOSL8U5c8AAAABClPTBg` |
| `#65` | `I_kwDOSL8U5c8AAAABClPUDA` |
| `#73` | `I_kwDOSL8U5c8AAAABDJ6_Ow` |
| `#96` | `I_kwDOSL8U5c8AAAABEPdGZQ` |
| `#99` | `I_kwDOSL8U5c8AAAABFf-fig` |
| `#100` | `I_kwDOSL8U5c8AAAABFf-nXw` |
| `#102` | `I_kwDOSL8U5c8AAAABFjuPEQ` |
| `#105` | `I_kwDOSL8U5c8AAAABFlB1FA` |
| `#106` | `I_kwDOSL8U5c8AAAABFlB1Hw` |
| `#132` | `I_kwDOSL8U5c8AAAABMk0Vkg` |

The same four open Dependabot pull requests, node IDs, and head commits were
attached to the repository before and after the rename:

| Pull request | Node ID | Head commit |
| --- | --- | --- |
| `#108` | `PR_kwDOSL8U5c7nCOnE` | `e59f38fb60e43a6f92adc4eceffd1ddd49511e33` |
| `#112` | `PR_kwDOSL8U5c7pNTma` | `b31646f6adbdbb7fde86aa77a89e43807f85fde6` |
| `#114` | `PR_kwDOSL8U5c7r0MGu` | `9667c6c0eb9bee7aa4ee75ae38aa17a497685b08` |
| `#133` | `PR_kwDOSL8U5c7-c7uD` | `7f6ac64b362ec143f06feae5fc1ff4fefa9a2cbd` |

## Post-Rename CI

The required manual dispatch of `.github/workflows/ci.yml` completed
successfully as run
[`31967136910`](https://github.com/nisavid/chatgpt-linux/actions/runs/31967136910).
It used the `workflow_dispatch` event and exact `main` commit
`cd6fca0d319884f9f11e0a8e48d45ee92b10b0ec`.

| Job | Result |
| --- | --- |
| [Build RPM Package](https://github.com/nisavid/chatgpt-linux/actions/runs/31967136910/job/95213915509) | success |
| [Build Debian Package](https://github.com/nisavid/chatgpt-linux/actions/runs/31967136910/job/95213915574) | success |
| [Build Pacman Package](https://github.com/nisavid/chatgpt-linux/actions/runs/31967136910/job/95213915599) | success |
| [Rust and Smoke Tests](https://github.com/nisavid/chatgpt-linux/actions/runs/31967136910/job/95213915657) | success |
| [Nix Package Builds](https://github.com/nisavid/chatgpt-linux/actions/runs/31967136910/job/95213915679) | success, including the public-release trust path |

The repository `main` commit and immutable identity were unchanged after the
run. A later scheduled Official DMG build also succeeded at that exact commit;
it does not replace the cutover-boundary artifact recorded above.

## Redirects And Integrations

The canonical web, API, and Git identity is now
`https://github.com/nisavid/chatgpt-linux`. GitHub returns a permanent redirect
from the former web URL, and both former and canonical Git URLs resolve the
same `main` commit. The old API route resolves the repository under its new
full name and unchanged IDs.

The shared local Git configuration now uses
`https://github.com/nisavid/chatgpt-linux.git` for `origin`. The Linux-port
`upstream` remote remains
`https://github.com/ilysenko/codex-desktop-linux.git`; the rename did not change
its ownership or role.

GitHub rewrote the default OIDC subject customization during the transaction:

```text
use_default: true
use_immutable_subject: false
sub_claim_prefix: repo:nisavid@576874/chatgpt-linux@1220482277
```

That post-rename value binds the owner, canonical slug, and immutable repository
ID. No tracked workflow currently requests an OIDC token.

The public `codex-desktop-linux` Cachix cache remains intentionally unchanged.
It is owned by the Linux-port upstream, and this fork has read access rather
than a local cache or token to rename. The rename did not create Actions,
Dependabot, or Codespaces secrets; Actions variables; environments; Pages;
webhooks; deploy keys; deployments; autolinks; releases; tags; or GitHub
packages.

## Verification Commands

The boundary and identity checks used GitHub's API and both Git endpoints:

```bash
gh api repos/nisavid/chatgpt-linux
gh api repos/nisavid/codex-app-linux
gh api repos/nisavid/chatgpt-linux/commits/main
gh api repos/nisavid/chatgpt-linux/rulesets/15540147
gh api 'repos/nisavid/chatgpt-linux/actions/workflows?per_page=100'
gh api 'repos/nisavid/chatgpt-linux/actions/artifacts?per_page=1'
gh api repos/nisavid/chatgpt-linux/actions/oidc/customization/sub
gh run view 31967136910 --repo nisavid/chatgpt-linux
git remote -v
git ls-remote https://github.com/nisavid/codex-app-linux.git HEAD
git ls-remote https://github.com/nisavid/chatgpt-linux.git HEAD
```

The retained fallback baseline receives its own annotated tag and artifact
evidence after the canonical repository-reference cleanup merges and passes
post-merge validation. That later tag identifies the complete fallback, not
this intermediate rename commit.
