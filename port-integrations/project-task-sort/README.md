# Project Task Created Sorting

This default-enabled port integration patches the current official app's
alternate Projects sidebar.

When the official app's sidebar rollout exposes `Created`, local task rows may
omit `conversation.createdAt` even though their `local:<UUIDv7>` keys contain a
creation timestamp. The unpatched comparator receives `undefined` and keeps
the previous task order. This integration recovers that timestamp from valid
UUIDv7 keys while preserving explicit creation timestamps, remote tasks, and
the existing Last updated behavior.

## Configuration

To disable it for a checkout build, add its id to `disabled` in the gitignored
`port-integrations/integrations.json`, then rebuild the app:

```json
{
  "enabled": [],
  "disabled": [
    "project-task-sort"
  ]
}
```

## Test

```bash
node --test port-integrations/project-task-sort/test.js
```
