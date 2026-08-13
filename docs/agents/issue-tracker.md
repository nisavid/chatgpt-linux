# Issue Tracker: GitHub

Engineering-skill issues and PRDs for this repo live in GitHub Issues for `nisavid/chatgpt-linux`. Use the `gh` CLI with `--repo nisavid/chatgpt-linux`.

## Conventions

- Create an issue: `gh issue create --repo nisavid/chatgpt-linux --title "..." --body "..."`
- Read an issue: `gh issue view <number> --repo nisavid/chatgpt-linux --comments`
- List issues: `gh issue list --repo nisavid/chatgpt-linux --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --repo nisavid/chatgpt-linux --body "..."`
- Apply or remove labels: `gh issue edit <number> --repo nisavid/chatgpt-linux --add-label "..."` / `--remove-label "..."`
- Close an issue: `gh issue close <number> --repo nisavid/chatgpt-linux --comment "..."`

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `nisavid/chatgpt-linux`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo nisavid/chatgpt-linux --comments`.
