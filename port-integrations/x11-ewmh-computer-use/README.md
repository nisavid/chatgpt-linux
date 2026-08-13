# X11/EWMH Computer Use Port Integration

This optional port integration stages the standalone
`chatgpt-computer-use-x11` MCP plugin into ChatGPT for Linux. It stays disabled
by default.

## Enable

For a checkout build, enable it through the git-ignored
`port-integrations/integrations.json` and provide one of the explicit staging
inputs below:

```json
{ "enabled": ["x11-ewmh-computer-use"] }
```

## Baseline

Supported baseline: Linux Mint Cinnamon on X11 / `x11-ewmh`.

## Tools exposed

The staged plugin exposes the standalone namespaced tool surface:

- `x11_doctor`
- `x11_list_windows`
- `x11_focused_window`
- `x11_focus_window`
- `x11_accessibility_tree`
- `x11_type_text`
- `x11_press_key`
- `x11_click`
- `x11_scroll`
- `x11_drag`
- `x11_get_app_state`
- `x11_target_window`
- `x11_target_context`
- `x11_release_window`

## Staging modes

Pinned local artifact mode:

```bash
export CHATGPT_X11_COMPUTER_USE_RELEASE_TARBALL=/path/to/chatgpt-computer-use-x11-v<VERSION>-x86_64-unknown-linux-gnu.tar.gz
export CHATGPT_X11_COMPUTER_USE_RELEASE_SHA256=<expected-sha256>
make build-app
```

Download mode requires an explicit URL and SHA-256. The integration has no
implicit remote release because the previously pinned repository is no longer
available:

```bash
export CHATGPT_X11_COMPUTER_USE_DOWNLOAD_URL=https://downloads.example.invalid/chatgpt-computer-use-x11.tar.gz
export CHATGPT_X11_COMPUTER_USE_RELEASE_SHA256=<expected-sha256>
make build-app
```

Set one of the explicit tarball, binary, source, or download inputs before
enabling the integration. Tarball and download modes always require a digest.

Local source mode:

```bash
CHATGPT_X11_COMPUTER_USE_SOURCE=/path/to/chatgpt-computer-use-x11 make build-app
```

Direct binary test mode:

```bash
CHATGPT_X11_COMPUTER_USE_BINARY=/path/to/chatgpt-computer-use-x11 make build-app
```

## Updater rebuilds

When this integration is enabled during a native package build that includes
the updater, the package retains the staged executable for updater rebuilds.
Packaging fails if the enabled integration did not stage a regular executable
helper. The updater picker offers the integration only when the installed
builder bundle retains that trusted executable.

A native package built without this integration cannot newly enable it during
an updater rebuild because it has no package-owned helper to reuse. Build and
install a new native package from a trusted checkout with the integration and
an explicit staging input enabled first. Manually adding the integration to
`${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt/port-integrations.json` does not add
the missing helper.

For compatibility with older packages, the updater disables a saved X11
selection in a private build-only config when the installed package does not
retain the helper. The rebuild continues without overwriting the user's saved
preference, so a later package that retains the helper can honor it again. If
the user confirms the picker while the helper is unavailable, the picker
removes the stale selection instead.

## Backend alignment

This port integration wires the separate `chatgpt-computer-use-x11` plugin as an opt-in port integration. It does not move X11/EWMH behavior into the core Computer Use backend and does not replace the bundled `computer-use` plugin.

`agent-sh/computer-use-linux` selectable backend/flavor work is a separate future investigation. If that route proves a better fit, handle it in a separate change or pull request; no backend/flavor experiment may require enabling this port integration by default or modifying core Computer Use behavior in this port integration.

## Non-goals

- no core Computer Use replacement;
- no Wayland/RemoteDesktop baseline;
- no default enablement;
- no submodule;
- no global doctor changes;
- no writes to user home from `stage.sh`.
