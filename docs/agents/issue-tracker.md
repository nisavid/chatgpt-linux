# Issue Tracker: GitHub

Engineering-skill issues and PRDs for this repo currently live in GitHub Issues
for `nisavid/codex-app-linux`. Use the `gh` CLI with
`--repo nisavid/codex-app-linux` until issue #119 completes the in-place rename;
then use `--repo nisavid/chatgpt-linux`.

## Conventions

- Create an issue: `gh issue create --repo nisavid/codex-app-linux --title "..." --body "..."`
- Read an issue: `gh issue view <number> --repo nisavid/codex-app-linux --comments`
- List issues: `gh issue list --repo nisavid/codex-app-linux --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --repo nisavid/codex-app-linux --body "..."`
- Apply or remove labels: `gh issue edit <number> --repo nisavid/codex-app-linux --add-label "..."` / `--remove-label "..."`
- Close an issue: `gh issue close <number> --repo nisavid/codex-app-linux --comment "..."`

## When a skill says "publish to the issue tracker"

Create a GitHub issue in the live repository named above.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo nisavid/codex-app-linux --comments` until
the rename, then use the canonical replacement slug.
