# Read aloud

Default-on port integration for reading assistant responses aloud.

This integration stays thin. It does not bundle a voice model and it does not speak
automatically. It adds an explicit icon button under assistant messages. A click
is the only app-rendering path that starts speech.

## Disable the integration

Conversation Mode requires Read Aloud. To remove the response-level voice UI,
disable both integrations in `port-integrations/integrations.json`:

```json
{
  "enabled": [],
  "disabled": ["conversation-mode", "read-aloud"]
}
```

Then rebuild/package the app. When enabled, the installed app remains silent until the user
explicitly clicks a message's speech icon, uses conversation mode, or calls the
Read Aloud MCP tool. For older builds, or to force-enable direct runtime calls,
set the runtime opt-in:

```bash
mkdir -p ~/.config/chatgpt
node -e 'const fs=require("fs"),p=process.env.HOME+"/.config/chatgpt/settings.json";let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}s["chatgpt-linux-read-aloud-enabled"]=true;fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")'
```

or:

```bash
CHATGPT_LINUX_READ_ALOUD_ENABLED=1 chatgpt
```

The generated Read Aloud settings page also gets setup controls for machines
where the default Kokoro paths are not ready:

- `Choose folder` stores a folder that already contains `kokoro-v1.0.onnx` and
  `voices-v1.0.bin`.
- `Download voice` creates the default Python runtime and downloads the Kokoro
  model files into the default data directory.
- `Speech pace` controls Kokoro playback speed from `0.70x` to `1.40x`
  and stores the value in `chatgpt-linux-read-aloud-kokoro-speed`.

Nothing is downloaded during app install or on first launch.

## Conversation Mode

The default-enabled sibling
[`conversation-mode`](../conversation-mode/) integration builds a
back-and-forth voice loop on this output backend. It owns microphone capture,
dictation submission, assistant-turn observation, interruption, and explicit
mode controls; Read Aloud remains the small speech primitive underneath it.

The default-enabled `port-integrations/read-aloud-mcp` sibling stages a separate
`read-aloud` MCP plugin with `doctor`, `read_aloud`, and `stop` tools. It reuses
the same Kokoro paths and runtime overrides documented below.

## Voice model

Default speech uses a Kokoro ONNX runtime, similar in shape to `readd` but not
dependent on a local `readd` checkout. The app stages only a tiny runner.
Users provide or download the model files and Python runtime outside the Electron
bundle.

Default paths:

- Python runtime: `~/.local/share/chatgpt/read-aloud/kokoro-venv/bin/python`
- Model: `~/.local/share/kokoro/kokoro-v1.0.onnx`
- Voices: `~/.local/share/kokoro/voices-v1.0.bin`

Install the Python runtime and model files from the command line:

```bash
bash port-integrations/read-aloud/install-kokoro-runtime.sh
```

Set `CHATGPT_LINUX_READ_ALOUD_SKIP_MODEL_DOWNLOAD=1` to install only the Python
runtime.

Runtime overrides:

- `CHATGPT_LINUX_READ_ALOUD_KOKORO_PYTHON`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_MODEL`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_VOICES`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_VOICE`, default `bm_george`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_SPEED`, default `1.05`, clamped to `0.70`-`1.40`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_LANG`, default `en-us`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_THREADS`, default `4`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_FIRST_CHARS`, default `90`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_CHUNK_CHARS`, default `180`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_MODEL_URL`
- `CHATGPT_LINUX_READ_ALOUD_KOKORO_VOICES_URL`

Kokoro speech is chunk-streamed: the runner synthesizes a short first chunk and
starts writing PCM to `aplay`, then prepares the next chunks while audio is
already playing. It does not synthesize the whole assistant response before
playback starts.

The default downloads use Hugging Face-hosted Kokoro files that match the
`kokoro-onnx` runtime shape:

- `https://huggingface.co/zijuncheng/kokoro_model_v1.0/resolve/main/kokoro-v1.0.onnx`
- `https://huggingface.co/zijuncheng/kokoro_model_v1.0/resolve/main/voices-v1.0.bin`

The settings page has a `?` help affordance beside the setup actions. It
summarizes the two supported setup paths: choose a local folder containing both
files, or let Codex create the managed Python runtime and download the Hugging
Face files into the default data directory.

For private/local setups, a custom command can still be used. Codex writes the
cleaned response text to stdin:

```bash
CHATGPT_LINUX_READ_ALOUD_COMMAND="/path/to/tts-stdin-command" chatgpt
```

When Kokoro is not ready, Read Aloud can fall back to system TTS through
`spd-say` or `espeak-ng`. This fallback is enabled by default only after the
user has opted into the Read Aloud integration/runtime; Kokoro remains the preferred
backend when it is available. Disable the native fallback if the machine voice
is not acceptable:

```bash
CHATGPT_LINUX_READ_ALOUD_NATIVE_FALLBACK=0 chatgpt
```

The handler never invokes a shell for response text.
