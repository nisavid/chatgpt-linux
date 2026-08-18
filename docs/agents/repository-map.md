# Historical Repository Map

> [!IMPORTANT]
> This repository is retired and unsupported. Do not use this to start or
> continue editing, building, packaging, updating, syncing, or releasing. See
> [Repository Retirement](../retirement.md).

This page is a non-executable historical context for the final source layout.

## Final component inventory

- `install.sh`, `launcher/`, and `scripts/lib/` formed the DMG conversion,
  generated-app, launcher, runtime, and shared package pipeline.
- `scripts/patches/` and `scripts/patch-linux-window-ui.js` held the generated
  app patch registry, engine, runner, implementations, and reporting gates.
- `port-integrations/` held configurable build-time modules and their staged
  resource, runtime-hook, and package-hook contracts.
- `packaging/linux/`, `packaging/appimage/`, and the native package builder
  scripts held distro and AppImage payload definitions.
- `updater/` held the unprivileged updater service, rebuild orchestration,
  privileged installation boundary, rollback state, and CLI.
- `computer-use-linux/`, `read-aloud-linux/`, `record-replay-linux/`, and
  `notification-actions-linux/` held fork-built runtime helpers.
- `plugins/openai-bundled/` held the bundled plugin manifests and resources
  staged into generated apps.
- `flake.nix`, `flake.lock`, and `nix/` held the Nix build and module surface.
- `tests/`, `scripts/ci/`, and retained pull-request workflows held local and
  hosted validation contracts.
- `docs/`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `DESIGN.md`, and
  `PRODUCT.md` held user, maintainer, security, design, and product records.

The source tree and its Git history preserve the detailed ownership and
implementation map. This abbreviated record exists only to interpret old
commits, build evidence, package provenance, and rollback material. It does
not select files for new work or describe a supported install or update route.
