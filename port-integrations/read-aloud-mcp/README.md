# Read Aloud MCP

Default-on port integration for reading text aloud through an MCP plugin.

This integration stages a separate `read-aloud` Codex plugin with a native Rust MCP
server. It does not enable microphone input or conversation mode. The first MCP
surface is intentionally small:

- `doctor` reports whether Kokoro, a custom command, or native fallback
  is available.
- `read_aloud` speaks text only when the user or agent explicitly asks for it.
- `stop` interrupts playback started by the MCP server.

## Disable

Add `read-aloud-mcp` to the `disabled` list in
`port-integrations/integrations.json` before rebuilding:

```json
{
  "enabled": [],
  "disabled": ["read-aloud-mcp"]
}
```

After rebuilding and launching the app, the integration patches the app's bundled
plugin registry so `read-aloud` is auto-installed like Computer Use. The
launcher also syncs the bundled `Read Aloud` plugin into Codex's local plugin
cache so the agent-facing tool is available.

The stage hook is fail-soft when no prebuilt backend is configured and the Rust
backend cannot be built in the current environment. In that case the app build
continues without staging the MCP plugin. Native packages and reproducible
builds should provide `CHATGPT_LINUX_READ_ALOUD_MCP_SOURCE` when network access
or Cargo registry access is unavailable during staging.

The response-level speaker button and settings UI come from `read-aloud`, while
`conversation-mode` depends on that backend. To remove all three Read Aloud
surfaces, disable all three integrations:

```json
{
  "enabled": [],
  "disabled": ["conversation-mode", "read-aloud", "read-aloud-mcp"]
}
```

The MCP integration reuses the same Kokoro defaults as the UI integration:

- Python runtime: `~/.local/share/chatgpt/read-aloud/kokoro-venv/bin/python`
- Model: `~/.local/share/kokoro/kokoro-v1.0.onnx`
- Voices: `~/.local/share/kokoro/voices-v1.0.bin`

Install the runtime and model files with:

```bash
bash port-integrations/read-aloud/install-kokoro-runtime.sh
```

or use the Read Aloud settings page download flow when the `read-aloud` UI
integration is enabled.

## Runtime Overrides

The MCP server reads the same overrides as the UI integration:

- `CHATGPT_LINUX_READ_ALOUD_COMMAND`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_RUNNER`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_PYTHON`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_MODEL`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_VOICES`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_VOICE`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_SPEED`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_LANG`
- `CHATGPT_LINUX_READ_ALOUD_NATIVE_FALLBACK=0`

Native `spd-say` / `espeak-ng` fallback is available by default after this MCP
plugin is enabled, but Kokoro remains preferred. Set
`CHATGPT_LINUX_READ_ALOUD_NATIVE_FALLBACK=0` to disable the machine voice
fallback.

## Validate

```bash
node port-integrations/read-aloud-mcp/test.js
cargo check -p chatgpt-read-aloud-linux
cargo test -p chatgpt-read-aloud-linux
```
