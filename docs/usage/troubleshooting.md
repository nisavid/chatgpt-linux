# Troubleshooting

> [!WARNING]
> This page preserves troubleshooting knowledge for retired and unsupported
> source. Do not use this to start or continue maintenance. The commands
> below are historical reference only, not current install, update,
> troubleshooting, or repair instructions. No new support or compatibility
> fixes are provided. See
> [Repository Retirement](../retirement.md).

Before retirement, this guide listed checks for common ChatGPT for Linux
launch, package, CLI, and updater problems.

## Start With Logs

Launcher log:

```bash
sed -n '1,160p' ~/.cache/chatgpt/launcher.log
```

Updater service log:

```bash
sed -n '1,160p' ~/.local/state/chatgpt-updater/service.log
```

Updater state:

```bash
sed -n '1,160p' ~/.local/state/chatgpt-updater/state.json
chatgpt-updater status --json
```

The updater uses these XDG paths:

```text
~/.config/chatgpt-updater/config.toml
~/.local/state/chatgpt-updater/state.json
~/.local/state/chatgpt-updater/service.log
~/.cache/chatgpt-updater/
```

The Electron launcher also writes:

```text
~/.cache/chatgpt/launcher.log
~/.local/state/chatgpt/app.pid
```

The PID file lets the updater wait until Electron exits before installing a
pending package.

## Symptoms

| Problem | What to try |
| --- | --- |
| `Error: write EPIPE` | Run `./chatgpt/start.sh` directly instead of piping output. |
| Blank window | Check whether port `5175` is already in use: `ss -tlnp \| grep 5175`. |
| `ERR_CONNECTION_REFUSED` on `:5175` | Confirm `python3` works and port `5175` is free. The launcher serves the extracted webview bundle locally before Electron starts. |
| `webview bundle is missing or empty` | Regenerate the app with `./install.sh` or `make build-app`; the generated app must contain `content/webview/index.html`. |
| Stuck on the ChatGPT logo splash | Check `~/.cache/chatgpt/launcher.log`. Another process may be serving port `5175`, or `content/webview/` may be incomplete or fail integrity validation. |
| `CODEX_CLI_PATH` error | Install the CLI with `npm i -g --include=optional @openai/codex` or `npm i -g --prefix ~/.local --include=optional @openai/codex`. If you intentionally use another install, set `CODEX_CLI_PATH=/path/to/codex` for one launch or add `cli_path = "/path/to/codex"` to `~/.config/chatgpt-updater/config.toml`. |
| Electron hangs while the CLI is outdated | Re-run the launcher, then inspect `~/.cache/chatgpt/launcher.log` and `~/.local/state/chatgpt-updater/service.log`. The CLI preflight is best-effort, uses a 1-hour registry lookup cooldown, falls back to `npm install -g --prefix ~/.local` when global install fails, and warns instead of blocking when automatic refresh fails. |
| GPU, Vulkan, or Wayland errors | The launcher sets `--ozone-platform-hint=auto` by default and adds `--enable-features=WaylandWindowDecorations` only when `--ozone-platform=wayland` is selected. To force X11, try `./chatgpt/start.sh --ozone-platform=x11`. |
| Window flickering | Try `CHATGPT_ELECTRON_DISABLE_GPU_COMPOSITING=1 ./chatgpt/start.sh` to use the legacy compositing workaround. If flickering persists, try `./chatgpt/start.sh --disable-gpu`. |
| Transparent or dark sidebar | Check whether the Linux opaque-window patch was applied, then rebuild from a current checkout. |
| Sandbox errors | The launcher keeps Electron sandboxing enabled by default. As a temporary compatibility fallback, run `CHATGPT_APP_DISABLE_ELECTRON_SANDBOX=1 ./chatgpt/start.sh` and treat that mode as lower security. |
| `gh auth status` works in a terminal but fails inside ChatGPT | The app shell may be using isolated XDG paths or missing keyring DBus access. See [GitHub CLI auth in app-launched shells](../github-cli-auth.md). |
| Rust installer or managed Node runtime fails on hardened hosts | If `/tmp` is mounted `noexec`, set `TMPDIR` and `XDG_CACHE_HOME` to executable user-owned directories before install/build commands. |
| `ConnectTimeoutError` or slow Electron downloads during `@electron/rebuild` | Retry `make build-app`. If the network path is consistently blocked, set `ELECTRON_MIRROR` for the Electron runtime and `ELECTRON_HEADERS_URL` for Electron headers. |
| Stale install or cached DMG | Run `./install.sh --fresh` to remove the generated app tree and redownload the DMG. |
| `Critical patch failures` during a local or updater rebuild | Update the checkout or installed update-builder and rebuild from the same DMG. For a local build, inspect `dist-next/rebuild/patch-report.json` and `chatgpt/.chatgpt-linux/build-info.json`; for an updater rebuild, inspect the workspace `.chatgpt-linux/source-info.json` and patch report. Do not set `CHATGPT_ENFORCE_CRITICAL_PATCHES=0` for a normal package or release build. |
| Usage help | Run `./install.sh --help` or `./chatgpt/start.sh --help`. |
| Computer Use plugin invisible in UI | Rebuild from current sources and inspect the patch report for Linux support-patch drift. The support patches are applied by default, but OpenAI account and rollout eligibility plus the official persistent plugin control still determine whether the UI appears. |
| Computer Use `doctor` reports `ydotool not running` | Start the distro-provided daemon (`ydotoold` or, on some Fedora releases, `ydotool.service`), then add your user to an input-capable group for `/dev/uinput` and the daemon socket. Common group names include `input`, `uinput`, `plugdev`, and `wheel`; check your distro. |
| Computer Use `doctor` reports `ydotool_socket: Permission denied` | Adjust the `ydotoold` service/socket so the desktop user can connect, commonly by making the socket group-readable by an input-capable group such as `input`, `uinput`, `plugdev`, or `wheel`. |
| Computer Use `doctor` reports `ydotool_socket: Protocol wrong type for socket` | The daemon socket may be a Unix datagram socket rather than a stream socket. Upgrade or rebuild to a backend with datagram-aware ydotool socket checks, then rerun `doctor`; this error does not by itself prove that `ydotoold` is absent or unusable. |
| Computer Use keyboard input produces the wrong characters | Check the active keyboard layout and key remaps. Raw key synthesis can be physical-keycode based, so non-QWERTY layouts can transform requested key names after the event reaches the compositor. Temporarily switch to a standard US/QWERTY layout to isolate layout effects. |
| Computer Use `type_text` or paste-style input does not insert text | Text insertion may depend on setting the clipboard and sending a paste shortcut. Custom layouts or remapped modifier keys can break that shortcut even when pointer input and window focus work. Try a standard US/QWERTY layout, or verify the clipboard and shortcut path separately. |
| Computer Use AT-SPI tree is empty or sparse | Run `./chatgpt/resources/plugins/openai-bundled/plugins/computer-use/bin/chatgpt-computer-use-linux setup` where supported, confirm toolkit accessibility is enabled, then restart the target app. Some non-GNOME sessions still use the historical `org.gnome.desktop.interface toolkit-accessibility` key. Also check that `NO_AT_BRIDGE=1` is not set in the target app's environment. Some apps expose limited AT-SPI nodes even when screenshot, focus, and pointer input paths are healthy. |
| `chatgpt-updater` keeps running after package removal | Run `systemctl --user disable --now chatgpt-updater.service`, then confirm `/opt/chatgpt` is gone. |
| `migration collision: both ... exist` | Close ChatGPT and preserve both directories. Run the exact `Recovery command:` printed by the launcher; it moves the canonical destination aside and reruns `chatgpt`. Do not merge the trees implicitly. |
| `an incomplete ... migration must resume first` | Run the command printed in the error. Forward work resumes by launching `chatgpt`; reverse work resumes with `chatgpt migrate-state --reverse`. |
| A former updater service remains after upgrade | Run `systemctl --user disable --now codex-app-updater.service codex-update-manager.service`. Current packages do not install aliases for either service. |

## Webview Startup Checks

ChatGPT expects the extracted webview assets to be available from a local
origin on port `5175`. The launcher starts
`launcher/webview-server.py` on `127.0.0.1:5175` with `content/webview/` as
the validated document root, waits
for the port, and checks that
`http://127.0.0.1:5175/index.html` contains expected ChatGPT startup markers and
that the origin serves the startup asset graph recorded in
`.chatgpt-linux/webview-integrity.sha256`. Only loopback access is expected.

If the app opens to a blank window or never leaves the splash screen:

```bash
ss -tlnp | grep 5175
curl -fsS http://127.0.0.1:5175/index.html | grep 'startup-loader'
sed -n '1,200p' ~/.cache/chatgpt/launcher.log
```

Port collisions and incomplete extracted assets should now fail fast in the
launcher log instead of hanging silently.

## Transparent Or Dark Sidebar

If the left sidebar looks black, translucent, or shows the desktop through it,
first confirm whether the Linux opaque-window patch was applied. This is
usually patch drift rather than a GPU flag issue.

For a native package built by the updater, inspect the latest report:

```bash
python3 - <<'PY'
import json
from pathlib import Path

reports = sorted(Path("~/.cache/chatgpt-updater/workspaces").expanduser().glob("*/reports/patch-report.json"))
report = reports[-1]
data = json.loads(report.read_text())
print(report)
for patch in data.get("patches", []):
    if patch.get("name") == "linux-opaque-background":
        print(patch.get("status"), patch.get("reason", ""))
PY
```

If `linux-opaque-background` is `skipped-*`, update this checkout and rebuild
from the same DMG or a fresh one:

```bash
git pull --ff-only
make build-app DMG=~/.cache/chatgpt-updater/downloads/ChatGPT.dmg
make package
make install
```

## State Migration Recovery

Normal startup performs forward migration automatically. The journal lives at
`${XDG_STATE_HOME:-$HOME/.local/state}/.chatgpt-state-migration.json` and should
not be edited by hand. A successful run removes it; an interrupted run resumes
only in the journal's recorded direction.

The helper rejects symlinked journals or data roots, non-directory data roots,
unsafe updater-cache shapes, cross-filesystem moves, and collisions. Its printed
recovery command is specific to the colliding path. To return all completed moves
to the former wrapper identity, close the app and run:

```bash
chatgpt migrate-state --reverse
```

If you installed a temporary `chatgpt-updater.service` drop-in that removed
the migration `ExecStartPre` while waiting for a package containing the
large-tree migration fix, remove that drop-in after updating, then run:

```bash
systemctl --user daemon-reload
systemctl --user restart chatgpt-updater.service
```

## Updater Recovery Notes

`chatgpt-updater status` reports `cli_path` and `cli_path_source`. The source
shows whether the selected CLI came from `CODEX_CLI_PATH`, updater config,
persisted updater state, launch `PATH`, or a known package-manager fallback
path. An explicit `--cli-path` can also be used with `chatgpt-updater
cli-preflight`; later `status` output reports the current resolver source as
`env`, `config`, `persisted`, `path`, `known_path`, or `unknown` when no CLI was
found.

The launcher log records the selected Codex CLI source, its pinned canonical
target, and the detected version. A `codex` symlink may intentionally resolve
to a multicall binary; the generated launch proxy preserves the `codex`
invocation name when Electron starts app-server.

`chatgpt-updater` stays unprivileged until it installs the rebuilt package.
The final installation uses:

- `chatgpt-updater install-deb --path <package>`;
- `chatgpt-updater install-rpm --path <package>`;
- `chatgpt-updater install-pacman --path <package>`.

If a privileged install fails or is dismissed, the updater records `failed` and
does not reprompt every few seconds. If an `installing` state is interrupted by
a crash or restart, the daemon recovers it on the next run: already-installed
candidates become `installed`, existing package artifacts return to
`ready_to_install`, and missing artifacts become `failed`.

On Arch Linux, the final updater install step uses `pacman -U --noconfirm`
against the locally rebuilt `.pkg.tar.zst`; it does not update by running
`git pull`.
