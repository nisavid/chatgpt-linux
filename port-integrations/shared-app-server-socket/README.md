# Shared App-Server Socket

This integration makes the Codex app-server used by ChatGPT available on a
user-private Unix socket. It does not implement, inspect, filter, or translate
the app-server protocol.

From an SSH client's point of view, this behaves like an ordinary Codex SSH
app-server connection. The remote `codex app-server proxy` command still
provides the same stdio/WebSocket byte stream and the same app-server methods,
notifications, approvals, and thread authority. The only difference is that the
proxy attaches to ChatGPT's existing authority instead of starting a separate
app-server with a separate thread namespace.

ChatGPT owns one selected Codex CLI child running `app-server --listen
unix://PATH`. ChatGPT connects through the CLI's stock `app-server proxy --sock
PATH` byte tunnel and its existing WebSocket transport. Other local clients use
the same stock proxy command to attach to the Unix socket and receive the normal
WebSocket `/rpc` byte stream. Closing ChatGPT stops the authority.

The default socket is scoped by Linux app id under `XDG_RUNTIME_DIR`, preventing
side-by-side ChatGPT instances from sharing an authority accidentally. Override
it with `CHATGPT_LINUX_APP_SERVER_BRIDGE_SOCKET` when a stable path is required.
The Codex app-server creates the socket with user-only permissions. A shell
wrapper may route bare `codex app-server proxy` SSH sessions to this path.
Keep the socket in a directory accessible only to the owning user. It is a local
control endpoint and must not be exposed directly over TCP or forwarded as a
network service.

Authority startup is serialized by an owner-only lock next to the socket. The
lock records the owning Linux process identity, so a later ChatGPT launch can
reclaim it only when that exact process no longer exists. An existing socket is
probed before recovery: connectable endpoints and live or unverifiable owners
still fail closed, while an unbound socket inode from the dead owner is removed
only if its filesystem identity is unchanged.
Legacy locks without owner metadata remain protected for 15 seconds, longer
than the authority startup timeout, before they can be reclaimed when no socket
exists.

## SSH setup

Use a stable socket path when the ChatGPT instance will be reached over SSH:

```bash
export CHATGPT_LINUX_APP_SERVER_BRIDGE_SOCKET="$HOME/.codex/app-server-control/app-server-control.sock"
chatgpt
```

Then place a small `codex` wrapper earlier in the SSH user's `PATH`. Set
`real_codex` to the actual CLI executable, not to the wrapper itself:

```bash
#!/usr/bin/env bash
set -eu

real_codex="/absolute/path/to/real/codex"
desktop_socket="$HOME/.codex/app-server-control/app-server-control.sock"

if [ "$#" -eq 2 ] && [ "$1" = "app-server" ] && [ "$2" = "proxy" ]; then
    exec "$real_codex" app-server proxy --sock "$desktop_socket"
fi

exec "$real_codex" "$@"
```

The official app's SSH transport normally starts its own authority before
invoking the proxy. Configure the **remote account's login-shell environment**
to skip that bootstrap when this wrapper is used:

```bash
export CODEX_SSH_SKIP_APP_SERVER_BOOT=true
```

This is an existing official-app SSH transport switch. The port integration
does not define or patch it: the official transport evaluates it in the remote
login shell before its bootstrap command, then continues through the same
`codex app-server proxy` flow that the wrapper redirects.

Put that export in the startup file read by the account's SSH login shell (for
example `~/.profile` when that is the active login profile). This is remote
account configuration; setting it only in the local ChatGPT launcher does not
propagate it through SSH. Use it only for an account whose wrapper is dedicated
to this ChatGPT-owned socket.

Make the wrapper executable and verify that non-interactive SSH resolves it:

```bash
chmod 0755 "$HOME/.local/bin/codex"
ssh host 'command -v codex'
ssh host 'printf "%s\n" "$CODEX_SSH_SKIP_APP_SERVER_BOOT"'
```

Codex SSH clients can then connect normally; no client-side protocol option or
special method allowlist is required. Only the exact two-argument proxy command
is redirected. Interactive CLI commands and all other subcommands continue to
use the real CLI normally. `CODEX_CLI_PATH` used to launch ChatGPT must also
point to the real CLI so ChatGPT cannot recursively invoke the wrapper.

The integration is included in builds by default but remains inactive at
runtime unless a socket is configured or it is explicitly enabled:

```bash
export CHATGPT_PORT_SHARED_APP_SERVER_SOCKET_ENABLED=1
chatgpt
```

To exclude the integration from a build, add it to `disabled` in the ignored
`port-integrations/integrations.json` file:

```json
{
  "enabled": [],
  "disabled": ["shared-app-server-socket"]
}
```

Then rebuild the app. The integration does not run independently of ChatGPT.

Run focused tests with:

```bash
node --test port-integrations/shared-app-server-socket/test.js
```

Set `CODEX_CLI_PATH` to include the stock authority/socket/proxy lifecycle test:

```bash
CODEX_CLI_PATH="/absolute/path/to/real/codex" node --test port-integrations/shared-app-server-socket/test.js
```

The integration depends on the official app bundle's current local transport
factory, WebSocket adapter, and `app-server proxy` command. Bundle drift causes
the optional patch to warn and skip instead of modifying an unknown surface.
