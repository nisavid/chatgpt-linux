# Project Group Last Updated Sorting

This default-enabled port integration patches the current official app's
Projects sidebar.

The official app applies `Last updated` to task rows inside each project, but it
then reapplies the saved manual project order to the project groups themselves.
A complete saved order therefore leaves every project header fixed even when a
different project has the newest task.

This integration makes `Last updated` sort both project groups and their task
rows by recency. `Priority` and `Manual order` keep the official app's saved
project-group ordering behavior.

## Configuration

To disable it for a checkout build, add its id to `disabled` in the gitignored
`port-integrations/integrations.json`, then rebuild the app:

```json
{
  "enabled": [],
  "disabled": [
    "project-group-last-updated-sort"
  ]
}
```

## Test

```bash
node --test port-integrations/project-group-last-updated-sort/test.js
```

The patch targets only the current official app's Projects sidebar chunk.
Bundle drift leaves the asset unchanged and reports an optional patch warning.
