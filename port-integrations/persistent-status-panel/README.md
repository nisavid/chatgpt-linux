# Persistent Status Panel

This default-enabled port integration keeps the ChatGPT `/status` panel open
across thread switches and app restarts until it is explicitly closed. The
existing panel continues to own chat ID, context usage, and rate-limit
rendering.

## Configuration

To disable it for a checkout build, add its id to `disabled` in the gitignored
`port-integrations/integrations.json`, then rebuild the app:

```json
{
  "enabled": [],
  "disabled": ["persistent-status-panel"]
}
```

The webview patch is optional, fail-soft, and idempotent. If the official app's
composer bundle changes shape, the patch warns and leaves the bundle unchanged.

## Test

```bash
node --test port-integrations/persistent-status-panel/test.js
```
