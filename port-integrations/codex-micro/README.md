# Codex Micro

This opt-in port integration enables the Work Louder Codex Micro integration that
already ships in the official ChatGPT app bundle. It does three narrowly scoped
things:

1. enables the upstream Codex Micro feature gate locally; and
2. adds the verified `node-hid@3.3.0` Linux prebuild for the current app's
   nested Work Louder dependency; and
3. watches Linux `hidraw` topology so a Micro connected after ChatGPT starts is
   discovered without restarting the app.

The integration is disabled by default.

## Hot-plug discovery

The upstream service uses a native HID topology watcher that is not available
in the Linux build. Without a replacement, discovery falls back to a 30-second
scan and a newly connected device can appear to require an app restart.

On Linux, this integration watches `/dev` for `hidraw` additions and removals,
debounces duplicate events, and asks the existing service to reconcile device
topology. If the filesystem watcher cannot start or reports an error, a
two-second unreferenced polling fallback takes over. The service's existing
settle retries still handle the short delay between device-node creation and
udev ACL application. Disconnecting or disabling the integration disposes the
watcher and any fallback timer.

## Enable

Copy `port-integrations/integrations.example.json` to the gitignored
`port-integrations/integrations.json`, then add `codex-micro` to `enabled` and rebuild:

```json
{
  "enabled": [
    "codex-micro"
  ]
}
```

```bash
./install.sh
```

The integration rejects the build if the current DMG no longer contains the
expected Codex Micro gate/route or the exact nested `node-hid` loader contract.
Only the pinned x64 and arm64 prebuilds are supported; there is no source-build
fallback.

## Runtime libraries

Native packages declare the required `libudev.so.1` and `libusb-1.0.so.0`
dependencies. For AppImage, source, or user-local installs, install them
yourself:

```bash
# Debian / Ubuntu
sudo apt install libudev1 libusb-1.0-0

# Fedora
sudo dnf install systemd-libs libusb1

# Arch Linux
sudo pacman -S systemd-libs libusb
```

## Device access

Integration-enabled Debian, RPM, and pacman packages install
`/usr/lib/udev/rules.d/70-codex-micro.rules`. Native package scripts do not
reload the system udev daemon. Reload after the first install and after a
package rebuild that enables or disables the integration, then reconnect USB or
Bluetooth:

```bash
sudo udevadm control --reload-rules
```

AppImage, source, user-local, Home Manager, and direct flake installs cannot
change host udev policy. Install the copy staged for your install mode once.

For a source build:

```bash
sudo install -Dm0644 \
  chatgpt/.chatgpt-linux/port-integrations/codex-micro/70-codex-micro.rules \
  /etc/udev/rules.d/70-codex-micro.rules
sudo udevadm control --reload-rules
```

For a user-local install, use the installed app copy:

```bash
sudo install -Dm0644 \
  "${XDG_DATA_HOME:-$HOME/.local/share}/chatgpt/app/.chatgpt-linux/port-integrations/codex-micro/70-codex-micro.rules" \
  /etc/udev/rules.d/70-codex-micro.rules
sudo udevadm control --reload-rules
```

For an AppImage, extract its staged copy first:

```bash
chatgpt_appimage="$(readlink -f ./chatgpt-*.AppImage)"
chatgpt_extract_dir="$(mktemp -d)"
trap 'rm -rf "$chatgpt_extract_dir"' EXIT
(
  cd "$chatgpt_extract_dir"
  "$chatgpt_appimage" --appimage-extract >/dev/null
)
sudo install -Dm0644 \
  "$chatgpt_extract_dir/squashfs-root/opt/chatgpt/.chatgpt-linux/port-integrations/codex-micro/70-codex-micro.rules" \
  /etc/udev/rules.d/70-codex-micro.rules
sudo udevadm control --reload-rules
```

For Home Manager or a direct flake package, resolve the selected Nix store
output from the installed launcher:

```bash
chatgpt_package_root="$(
  dirname "$(dirname "$(readlink -f "$(command -v chatgpt)")")"
)"
sudo install -Dm0644 \
  "$chatgpt_package_root/lib/udev/rules.d/70-codex-micro.rules" \
  /etc/udev/rules.d/70-codex-micro.rules
sudo udevadm control --reload-rules
```

The USB rule imports `usb_id` before matching the observed Work Louder
VID/PID/interface (`303a:8360`, interface `00`). The Bluetooth rule matches the
same vendor HID channel on the Bluetooth HID bus. Both rules use `uaccess` and
`0660`; they do not make hidraw devices world-writable.

NixOS installs the rule automatically when the integration is selected through the
module. Other install modes require the matching manual procedure above.
When disabling a manually installed copy, remove
`/etc/udev/rules.d/70-codex-micro.rules`, reload the rules, and reconnect the
device. Removing or disabling a native package build removes its packaged copy,
but still requires the same reload and reconnect.

## Bluetooth

Pair the Micro through the desktop Bluetooth settings before opening Codex.
Channel selection and pairing mode are device operations; see the Work Louder
Micro setup guide.

## Verify

With the Micro connected, identify its hidraw node and exercise the actual rule:

```bash
udevadm info --attribute-walk --name=/dev/hidrawN
sudo udevadm test "$(udevadm info --query=path --name=/dev/hidrawN)"
getfacl /dev/hidrawN
```

The test output must show the Codex Micro rule, imported USB properties for a
USB connection, the `uaccess` tag, and mode `0660`. Then open
`Settings -> Codex Micro` and verify connection state, buttons, dial, joystick,
battery/status reporting, and lighting controls.

Run focused checks with:

```bash
node --test port-integrations/codex-micro/test.js
```
