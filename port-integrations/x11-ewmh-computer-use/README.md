# Historical X11/EWMH Computer Use Port Integration

> [!IMPORTANT]
> This repository is retired and unsupported. Do not use this to start or
> continue a build, staging, updater, or runtime deployment. See
> [Repository Retirement](../../docs/retirement.md).

This page is a non-executable historical record of an optional port
integration that was disabled by default. It staged a separate X11/EWMH MCP
backend and did not replace the bundled Computer Use plugin.

The integration targeted a Linux Mint Cinnamon X11 baseline. Its former tool
surface covered window discovery and focus, accessibility inspection, text and
key input, pointer actions, scrolling and dragging, application state, and
explicit target acquisition and release.

Historical package builds could retain a package-owned helper for later
rebuilds. Missing or untrusted helper state failed closed, and user preference
state alone could not create the executable. Those boundaries are retained in
Git history for provenance; this retired repository no longer offers an
activation or packaging route.
