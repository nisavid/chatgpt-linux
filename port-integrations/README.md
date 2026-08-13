# Port Integration Registry

`port-integrations/` is the catalog and configuration boundary for configurable
modules that adapt official OpenAI app bundle behavior or add local runtime and
package support to this Linux port. This page is the registry and configuration
reference. See [Port Integrations Architecture](../docs/port-integrations-architecture.md)
for the loader lifecycle and manifest authoring contract.

Port integrations are not official Codex plugins, and they are not features of
Linux. The Linux-port upstream calls the equivalent registry "Linux features"
and stores it under `linux-features/`; translate the names when reporting an
issue there and reproduce against a Linux-port upstream build when possible.

The registry is not a complete inventory of port-authored behavior. Core
compatibility patches remain in `scripts/patches/`. Browser Use and Linux
Computer Use use separate packaging and patch paths.

## Catalog

The catalog below mirrors the tracked `integration.json` manifests. A
default-enabled integration participates in a build unless config disables it.
Runtime availability can still depend on app settings, OpenAI account rollout,
host capabilities, or integration-specific setup.

### Default-enabled integrations

| Integration | Purpose |
| --- | --- |
| [`agent-workspace`](agent-workspace/) | Adds the Linux settings and Electron bridge for Agent Workspaces. |
| [`api-key-model-visibility`](api-key-model-visibility/) | Shows non-hidden models reported by API-key-authenticated OpenAI-compatible providers. |
| [`api-key-service-tier`](api-key-service-tier/) | Adds provider-advertised Fast/service-tier controls for API-key sessions. |
| [`appshots`](appshots/) | Captures and crops the focused window for AppShots without changing the core backend. |
| [`chatgpt-wrapper-updater`](chatgpt-wrapper-updater/) | Adds the wrapper update control and its apply lifecycle. |
| [`conversation-mode`](conversation-mode/) | Adds the Linux voice conversation loop; requires `read-aloud`. |
| [`copilot-reasoning-effort`](copilot-reasoning-effort/) | Persists and selects reasoning-effort defaults for Copilot-authenticated sessions. |
| [`global-dictation`](global-dictation/) | Adds user-enabled global dictation hotkeys through X11 and XDG portal backends. |
| [`omarchy-theme`](omarchy-theme/) | Loads user CSS generated from the active Omarchy theme. |
| [`open-target-discovery`](open-target-discovery/) | Discovers Linux terminal, editor, and file-manager targets for Open menus. |
| [`persistent-status-panel`](persistent-status-panel/) | Keeps the `/status` panel open across task switches and app restarts. |
| [`pet-overlay`](pet-overlay/) | Adds compositor-safe Linux avatar overlay placement. |
| [`project-group-last-updated-sort`](project-group-last-updated-sort/) | Applies Last updated sorting to project groups as well as their tasks. |
| [`project-task-sort`](project-task-sort/) | Restores Created sorting for local tasks in the alternate Projects sidebar. |
| [`read-aloud`](read-aloud/) | Adds the Linux read-aloud action for assistant responses. |
| [`read-aloud-mcp`](read-aloud-mcp/) | Adds an MCP plugin that exposes the Linux Read Aloud backend to the agent. |
| [`remote-control-ui`](remote-control-ui/) | Exposes remote-control, Codex mobile onboarding, and related settings surfaces on Linux. |
| [`remote-mobile-control`](remote-mobile-control/) | Adds experimental Linux support for Codex mobile remote-control host enrollment. |
| [`shared-app-server-socket`](shared-app-server-socket/) | Adds a runtime-opt-in Unix socket shared by ChatGPT and ordinary app-server clients. |
| [`ssh-command-wrapper`](ssh-command-wrapper/) | Adds a per-connection argv wrapper for Codex SSH operations. |
| [`ui-tweaks`](ui-tweaks/) | Groups configurable ChatGPT UI customizations. |

### Optional integrations

| Integration | Purpose |
| --- | --- |
| [`authenticated-proxy`](authenticated-proxy/) | Adds launcher and main-process support for authenticated HTTP proxies. |
| [`codex-micro`](codex-micro/) | Adds the verified Linux native binding and device policy for Work Louder Codex Micro. |
| [`directory-only-working-tree-watch`](directory-only-working-tree-watch/) | Replaces recursive working-tree watching with bounded directory watches. |
| [`example-integration`](example-integration/) | Demonstrates patch-descriptor and stage-hook contracts. |
| [`frameless-titlebar`](frameless-titlebar/) | Hides app titlebar and menu chrome for compositor-managed decorations. |
| [`mcp-helper-reaper`](mcp-helper-reaper/) | Reaps orphaned MCP helpers without touching live sessions. |
| [`node-repl-reaper`](node-repl-reaper/) | Reaps Browser Use `node_repl` helpers leaked by the app-server. |
| [`record-and-replay`](record-and-replay/) | Adds the Linux demo-to-skill Record & Replay workflow. |
| [`shallow-repository-watches`](shallow-repository-watches/) | Limits transient repository previews; conflicts with `directory-only-working-tree-watch`. |
| [`thorium-chrome-plugin`](thorium-chrome-plugin/) | Adds Thorium support to the bundled Chrome plugin. |
| [`x11-ewmh-computer-use`](x11-ewmh-computer-use/) | Stages the standalone X11/EWMH Computer Use adapter. |

## Configuration Schema

Configuration files are JSON objects with these fields:

```json
{
  "enabled": [
    "codex-micro"
  ],
  "disabled": [
    "open-target-discovery"
  ],
  "settings": {
    "pet-overlay": {
      "petOverlay": {
        "gravity": "bottom-right"
      }
    }
  }
}
```

| Field | Behavior |
| --- | --- |
| `enabled` | Adds known integration IDs to the manifest defaults. |
| `disabled` | Removes integration IDs after defaults and `enabled` are combined. It wins when an ID appears in both arrays. |
| `settings` | Maps an integration ID to an integration-owned settings object. The loader supplies settings only to enabled integrations; each integration defines its own schema. |

`enabled` is required; `disabled` and `settings` are optional. Integration IDs
match `^[a-z0-9][a-z0-9-]*$`. Default-enabled manifests are added in ID order,
then explicit `enabled` IDs are added in config order. The loader validates
`requires` and `conflicts` after applying config. The generic loader requires
each `settings` value to be an object but leaves its nested schema to the
integration.

## Configuration Sources

The JavaScript loader resolves one config file in this order:

1. `CHATGPT_PORT_INTEGRATIONS_CONFIG`, when set.
2. `<integration-root>/integrations.json`, when present.
3. `${XDG_CONFIG_HOME:-$HOME/.config}/<app-id>/port-integrations.json`, when the
   integration root is not a Git checkout and the file exists. The default app
   ID is `chatgpt`.
4. `<integration-root>/integrations.example.json`.

`CHATGPT_PORT_INTEGRATIONS_ROOT` overrides the default `port-integrations/`
root. Checkout builds intentionally ignore the persistent user config so an
installed app's preferences cannot silently change development builds or tests.

For a checkout build, copy the default config to the git-ignored checkout path
and edit it before rebuilding:

```bash
cp port-integrations/integrations.example.json port-integrations/integrations.json
./install.sh
```

Changing config or integration source affects the next app generation; it does
not mutate an already generated app. Native packaging requires the current full
resolved config, integration-root kind, and integration-input digest to match
the generated app's build info, so regenerate the app before packaging after
any such change.

## Native Packages And Updater Rebuilds

Native package builders copy the configured integration tree into the packaged
`update-builder`. They remove checkout-local config and write the full resolved
selection to `update-builder/.chatgpt-linux/port-integrations.json`: the final
`enabled` list, the configured `disabled` list, and settings for enabled
integrations.

The updater selects rebuild config in this order:

1. the saved per-user `<config>/<app-id>/port-integrations.json` written by the
   integration picker;
2. the packaged `update-builder/.chatgpt-linux/port-integrations.json` snapshot;
3. the legacy `update-builder/port-integrations/integrations.json`, when present.

The updater passes the selected path through
`CHATGPT_PORT_INTEGRATIONS_CONFIG`, so it takes precedence over config in a
freshly fetched wrapper source. Config sources are selected as whole files; they
are not merged. The picker updates `enabled` and `disabled` while preserving the
effective config's valid top-level `settings` object. On its first write it
seeds settings from the highest-priority available fallback: the modern packaged
snapshot, then the legacy builder config. After a user file exists, that file
remains the highest-priority source. If no updater config source exists, the
selected wrapper source uses its normal loader config resolution and manifest
defaults.

## Setup Helper Interface

`make setup-native` discovers repository and user-local manifests and can update
`port-integrations/integrations.json`. These environment variables control its
non-interactive interface:

| Variable | Meaning |
| --- | --- |
| `CHATGPT_BOOTSTRAP_NONINTERACTIVE=1` | Never prompt. |
| `CHATGPT_PORT_INTEGRATIONS=a,b` | Add integration IDs to `enabled`. |
| `CHATGPT_DISABLE_PORT_INTEGRATIONS=a,b` | Add integration IDs to `disabled`. |
| `CHATGPT_BOOTSTRAP_CLEANUP_INTEGRATIONS=a,b` | Offer separate cleanup of integration-owned user data. |
| `CHATGPT_BOOTSTRAP_DRY_RUN=1` | Print setup or cleanup actions without changing files. |

Disabling an integration changes only the next rebuild. Cleanup is separate,
lists exact paths, and deletes only a path confirmed with `DELETE <exact path>`.

## Validation

Integration self-tests live beside their manifests:

```bash
node --test port-integrations/*/test.js
```

Run the registry identity and naming policy separately when changing the
registry contract:

```bash
node --test port-integrations/identity-policy.test.js
```
