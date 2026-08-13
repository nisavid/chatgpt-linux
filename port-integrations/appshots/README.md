# Linux AppShots

`port-integrations/appshots` exposes the official app bundle's AppShots composer
entry on Linux. It attaches the focused window screenshot plus best-effort
AT-SPI text to the composer.

This integration is enabled by default in this fork. Disable it before building
when the build should omit AppShots on Linux:

```json
{
  "enabled": [],
  "disabled": [
    "appshots"
  ]
}
```

The integration is self-contained. It patches only the optional AppShots webview
availability gate, the Electron main-process AppShots handlers, and the
official app bundle's AppShots hotkey settings row. Its
`runtimeHooks.electronArgs` hook enables Chromium's `GlobalShortcutsPortal`
support. It does not add AppShots-specific code to `computer-use-linux`, core
patch modules, or the default patch flow.

## Control Surfaces

For window metadata and AT-SPI text, the integration shells out to the bundled
Linux Computer Use backend's existing `windows` and `state` commands. For the
screenshot, it uses an available desktop screenshot CLI such as `grim`,
`spectacle`, `gnome-screenshot`, `maim`, `scrot`, or ImageMagick `import`, then
crops the image to the focused window bounds in Electron.

## Security Boundary

Privacy and correctness constraints:

- The integration may briefly create a full-screen temporary screenshot before
  cropping it to the focused window. The temporary full-screen and cropped image
  files are staged inside a per-capture directory created under the system temp
  directory with owner-only permissions, then removed after the capture attempt.
- Linux AppShots availability still requires the official app's availability
  flag in addition to the Linux platform match.
- Capture fails closed when no focused window or usable bounds are available.
- Capture fails closed when no screenshot tool is available or the crop does not
  intersect the captured image.
- Global hotkeys are disabled by default on Linux until the user chooses one in
  AppShots settings. The dropdown mirrors the official app's bare-modifier
  choices where they are practical on X11 (`Alt + Alt` and `Shift + Shift`) and
  keeps `Ctrl+Super+A` as a non-bare fallback on both X11 and Wayland.
- `Alt + Alt` and `Shift + Shift` are backed by a port integration
  `bare-modifier-monitor` helper staged into `resources/native/`. It requires
  the left and right modifier keycodes, so tapping only one physical modifier
  twice does not trigger AppShots. It reads one root XInput2 event stream and
  stops that listener when its Electron parent exits. It uses `xinput` and
  `xmodmap`, so it is expected to work on X11 sessions and fail closed elsewhere.
- On Wayland, the port integration stages an Electron args hook that enables
  `GlobalShortcutsPortal`, and the settings dropdown hides the X11-only bare
  modifier shortcuts.

Run the integration self-test:

```bash
node --test port-integrations/appshots/test.js
```

To test in the app, rebuild the dev app, open a chat, open the composer
attachment/context menu, and use the AppShot entry.
