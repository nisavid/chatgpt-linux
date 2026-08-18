# Issue Tracker: GitHub

Existing engineering issues and PRDs remain in GitHub Issues for
`nisavid/chatgpt-linux` as retirement evidence. The repository is closed to new
maintenance work. Skills may read or update an operator-owned closeout item
only when the active retirement task explicitly authorizes that mutation.

Always pass `--repo nisavid/chatgpt-linux` to the `gh` CLI rather than relying
on inferred repository identity.

## Conventions

- Read an issue: `gh issue view <number> --repo nisavid/chatgpt-linux --comments`
- List issues: `gh issue list --repo nisavid/chatgpt-linux --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --repo nisavid/chatgpt-linux --body "..."`
- Apply or remove labels: `gh issue edit <number> --repo nisavid/chatgpt-linux --add-label "..."` / `--remove-label "..."`
- Close an issue: `gh issue close <number> --repo nisavid/chatgpt-linux --comment "..."`

## When a skill says "publish to the issue tracker"

Do not create a new issue. Retirement closeout does not open replacement
maintenance work. Report that this tracker is read-only unless an owner
initiative explicitly reverses retirement.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo nisavid/chatgpt-linux --comments`.
