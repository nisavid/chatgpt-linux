# User-Local Desktop Integration

> [!WARNING]
> This installer is retained only as historical source for the retired,
> unsupported project. Do not use it as a current ChatGPT installation or
> update path. See [Repository Retirement](../../docs/retirement.md).

This folder packages this fork's user-local install layout for ChatGPT.

It adds:

- a stable install root under `${XDG_DATA_HOME:-~/.local/share}/chatgpt`
- self-contained maintenance scripts under `${XDG_DATA_HOME:-~/.local/share}/chatgpt/bin`
- one public `chatgpt` launcher under `~/.local/bin`; maintenance helpers stay private to the install root
- a desktop entry under `${XDG_DATA_HOME:-~/.local/share}/applications`
- an icon extracted from the local `ChatGPT.dmg`
- metadata tracking for the wrapper repo and cached `ChatGPT.dmg`
- an optional weekly `systemd --user` timer for unattended update checks and rebuilds (opt-in)

## Files

The package is laid out as reusable payload files. The installer copies them into:

- `${XDG_DATA_HOME:-~/.local/share}/chatgpt/bin/`
- `${XDG_DATA_HOME:-~/.local/share}/chatgpt/lib/`
- the `~/.local/bin/chatgpt` launcher
- `${XDG_DATA_HOME:-~/.local/share}/applications/chatgpt.desktop`
- `files/.config/systemd/user/chatgpt-update.service`
- `files/.config/systemd/user/chatgpt-update.timer`

## Expected Placement

If installing manually, copy the files to:

- `${XDG_DATA_HOME:-~/.local/share}/chatgpt/bin/`
- `${XDG_DATA_HOME:-~/.local/share}/chatgpt/lib/`
- `~/.local/bin/chatgpt`, which execs the private launcher under `${XDG_DATA_HOME:-~/.local/share}/chatgpt/bin/`
- `${XDG_DATA_HOME:-~/.local/share}/applications/`
- `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`

The preferred git checkout location is:

- `~/workspace/chatgpt-linux`

The installed maintenance scripts record the repo path in user state and use
that checkout for `git pull`, while rebuilding runtime assets into
`${XDG_DATA_HOME:-~/.local/share}/chatgpt` via `CHATGPT_INSTALL_ROOT` /
`CHATGPT_INSTALL_DIR`.

## Install

From the repository root:

```bash
./contrib/user-local-install/install-user-local.sh
```

To also enable the weekly auto-update timer, pass `--enable-timer`:

```bash
./contrib/user-local-install/install-user-local.sh --enable-timer
```

To persistently force the user-local launcher through X11/XWayland, pass `--force-x11`:

```bash
./contrib/user-local-install/install-user-local.sh --force-x11
```

To return to the default generated launcher behavior, pass `--no-force-x11`:

```bash
./contrib/user-local-install/install-user-local.sh --no-force-x11
```

The installer:

1. copies standalone helper scripts into `${XDG_DATA_HOME:-~/.local/share}/chatgpt`
2. installs only the public `chatgpt` launcher into `~/.local/bin`
3. copies systemd unit files to `~/.config/systemd/user/`
4. makes the scripts executable
5. reloads the user `systemd` daemon if available
6. enables the weekly timer only if `--enable-timer` was passed
7. refreshes desktop metadata if available
8. records local metadata and extracts the icon if `ChatGPT.dmg` already exists

## Commands

After installation, the only public command from this user-local path is:

```bash
chatgpt
```

Update checking, rebuilds, and version inspection remain private helpers under
`${XDG_DATA_HOME:-~/.local/share}/chatgpt/bin`. The opt-in timer calls the
private update helper directly.

## Notes

- The icon is not committed as a binary asset here. It is generated locally from `ChatGPT.dmg`.
- The helper scripts track both Linux-port upstream wrapper changes and
  official OpenAI `ChatGPT.dmg` headers.
- The helper scripts are copied into `${XDG_DATA_HOME:-~/.local/share}/chatgpt` and do not run from the git checkout directly.
- The X11/XWayland preference is stored in `${XDG_CONFIG_HOME:-~/.config}/chatgpt/user-local.env` and is preserved across updater refreshes.
- The weekly timer runs the private `chatgpt-update --quiet` helper from the install root. It is opt-in: pass `--enable-timer` to `install-user-local.sh` to activate it, or run `systemctl --user enable --now chatgpt-update.timer` manually after install.
- Automated rebuilds never bypass the running-app or DMG acceptance gates. They may build a candidate while ChatGPT is open, but promotion waits for the in-app after-exit flow or fails safely for a manual/timer run. Retry after closing the app.
- A successful transactional update retains only the immediately previous app backup. Older exact managed backups are pruned; manually named paths, files, and symlinks are left alone.
