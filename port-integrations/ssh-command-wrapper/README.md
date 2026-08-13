# SSH Command Wrapper

This integration adds a **Remote command wrapper** field to each saved SSH
connection in **Settings → Connections → SSH**. ChatGPT appends its generated
remote command as the wrapper's final argument and runs the result on the
configured SSH host.

For a connection that should route Codex operations through a specific target
host, configure:

```text
ssh -T target-host --
```

Codex still opens the configured outer connection, but every remote probe,
installation command, and app-server proxy is then routed through
`target-host`.
The wrapper is also part of the SSH startup-gate identity, so connections with
different wrappers do not share startup sequencing.

The field accepts POSIX-style argv text, including single quotes, double
quotes, and backslash escaping. It is deliberately not a shell-snippet field:
unquoted shell operators (`;`, `&`, `|`, `<`, and `>`) and newlines are
rejected. The limit is 4096 characters in both the input and its canonical
formatted form, and 64 arguments. Wrapper failures use the existing SSH
connection error path and abort setup.

An empty wrapper leaves the official app's SSH behavior unchanged. Saved
discovered aliases and manually entered hosts both support wrappers.

## Build configuration

The integration is included in builds by default. To exclude it, add the
integration id to `disabled` in the gitignored
`port-integrations/integrations.json`, then rebuild the app:

```json
{
  "enabled": [],
  "disabled": [
    "ssh-command-wrapper"
  ]
}
```

```bash
./install.sh ./ChatGPT.dmg
```

## Test

```bash
node --test port-integrations/ssh-command-wrapper/test.js
```

## Risks

The integration patches the current official app bundle's minified main-process
and settings code. Official app UI or SSH transport changes can cause the
optional patch to be skipped with a warning until its bundle needles are
updated. A configured wrapper can run any executable available on the outer
remote host, so only use values you trust.

The wrapper argv is stored with the saved SSH connection. Do not put
passwords, access tokens, private-key material, or other secrets in it.
