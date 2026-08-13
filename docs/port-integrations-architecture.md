# Port Integrations Architecture And Authoring Reference

`port-integrations/` is the extension boundary for configurable adaptations to
the official OpenAI app bundle and this port's runtime or package support. Core
provides discovery, selection, lifecycle orchestration, and safety checks;
integration-specific behavior stays in self-contained integration directories.

For the tracked catalog, config schema, and config-source precedence, see the
[Port Integration Registry](../port-integrations/README.md).

## Design Boundary

A change required for the basic Linux app to launch and behave correctly for
most users belongs in the core patch registry under `scripts/patches/`.

A configurable, distro-specific, editor-specific, browser-specific, or
workflow-specific change belongs in `port-integrations/`. Keep narrow or
dependency-heavy integrations disabled by default. A broadly useful integration
can be default-enabled when its control and security surfaces are documented and
match the [maintainer security practices](maintainers/security-best-practices.md).

## Resolution And Lifecycle

Each phase resolves integrations from the same selected config source and
validates the same dependency graph:

1. **Discovery:** manifests under `port-integrations/<id>/` and
   `port-integrations/local/<id>/` share one ID namespace.
2. **Selection:** manifest defaults and config are combined; `disabled` wins;
   `requires` and `conflicts` are validated.
3. **ASAR patching:** `entrypoints.patchDescriptors` contributes namespaced
   descriptors to the core patch runner.
4. **App staging:** cleanup hooks for disabled integrations run first,
   declarative resources and runtime hooks are reconciled next, and enabled
   custom stage hooks run last.
5. **Native packaging:** package resources, dependencies, and hooks are resolved
   against the generated app's integration snapshot.
6. **Runtime:** the launcher consumes staged environment files, prelaunch hooks,
   Electron arguments, launcher hooks, cold-start hooks, and after-exit hooks.

Do not modify the selected config or integration manifests while a build is in
progress. Patching, app staging, hook discovery, and build-info generation read
the config independently; a stable input is required for one coherent build.
Native packaging then verifies its plan against the integration snapshot stored
in the generated app.

Declarative app files are recorded in
`.chatgpt-linux/port-integrations-staged.json` inside the generated app. On the
next install, the framework removes those tracked files before staging the new
selection. A disabled integration can retain a marker-owned cleanup runtime hook
with `retainWhenDisabled`; custom `stageHook` output is not tracked and remains
the integration's responsibility.

Native package builders copy the configured integration tree, including
`local/` when present, into the packaged `update-builder`; remove checkout-local
config; and write the complete resolved config to
`update-builder/.chatgpt-linux/port-integrations.json`. The updater
prefers a saved per-user config over that snapshot, then accepts the legacy
`update-builder/port-integrations/integrations.json` path as a final fallback.

## Directory Layout

Tracked integrations live at `port-integrations/<integration-id>/`. Private or
experimental checkout integrations live at
`port-integrations/local/<integration-id>/`; `port-integrations/local/` is
git-ignored.

Every integration requires:

- `integration.json`, containing the manifest;
- `README.md`, describing behavior, validation, dependencies, and support or
  security constraints.

Repository and local integrations cannot share an ID. IDs match
`^[a-z0-9][a-z0-9-]*$`; a local integration cannot shadow a tracked one. The
git-ignored checkout config is `port-integrations/integrations.json`.

## Minimal Manifest

```json
{
  "id": "my-integration",
  "title": "My Integration",
  "description": "Configurable port integration.",
  "defaultEnabled": false,
  "entrypoints": {
    "patchDescriptors": "./patch.js"
  }
}
```

## Manifest Fields

| Field | Contract |
| --- | --- |
| `id` | Required integration ID. It must match the ID pattern; use the same directory name for a stable, inspectable identity. |
| `title` / `name` | Human-readable catalog label. `title` is preferred. |
| `description` | Concise catalog summary. |
| `defaultEnabled` | Boolean; only literal `true` enables by default. |
| `requires` | Array of integration IDs that must also be enabled. |
| `conflicts` | Array of integration IDs that cannot be enabled together. |
| `entrypoints` | Paths for `patchDescriptors`, `stageHook`, and `cleanupHook`. |
| `resources` | Files or directories copied inside the generated app. |
| `runtimeHooks` | Launcher-consumed `env`, `prelaunch`, `electronArgs`, `launcher`, `coldStart`, and `afterExit` entries. |
| `packageResources` | Regular files copied to the native package root. |
| `packageDependencies` | Package-format-specific dependency tokens. |
| `packageHooks` | Optional shell hooks that mutate native package staging. |

Manifests may contain integration-owned default data. Build config can provide a
per-integration object under `settings.<integration-id>`. The loader attaches it
to the enabled integration as `integration.settings`; patch descriptors receive
it through `context.integration.settings`. Settings for disabled integrations
are omitted from the packaged resolved-config snapshot. Each integration README
owns its settings schema.

## Patch Descriptors

`entrypoints.patchDescriptors` names a CommonJS module that exports a descriptor,
an array of descriptors, or `{ descriptors: [...] }`. Descriptor phases are
`main-bundle`, `webview-asset`, `extracted-app:pre-webview`, and
`extracted-app:post-webview`, matching the core registry in `scripts/patches/`.

The loader prefixes each descriptor ID as
`integration:<integration-id>:<descriptor-id>`, assigns integration descriptors
after core descriptors unless `order` is explicit, and defaults `ciPolicy` to
`optional`. Descriptor callbacks receive the normal patch context plus
`context.integration` (`context.feature` is a compatibility alias).

Use descriptor APIs for all patch work.

## Install-Time Entry Points

The supported shell entry points are:

| Entry point | When it runs |
| --- | --- |
| `stageHook` | For enabled integrations, after declarative app staging. |
| `cleanupHook` | For disabled integrations, before declarative app staging. |

Both run with `SCRIPT_DIR`, `INSTALL_DIR`, `WORK_DIR`, `ARCH`, and
`CHATGPT_OFFICIAL_APP_DIR`. A nonzero exit stops integration staging. Prefer
declarative resources and runtime hooks; use shell entry points only when the
declarative model cannot express the operation. `cleanupHook` is build-time
generated-app cleanup; it is separate from the setup helper's confirmed cleanup
of integration-owned user data.

## Declarative App Resources

`resources` copies a source inside the integration directory to a target inside
the generated app:

```json
{
  "resources": [
    {
      "source": "assets/tool.json",
      "target": ".chatgpt-linux/integrations/my-integration/tool.json",
      "mode": "0644"
    }
  ]
}
```

`source` cannot escape the integration directory. `target` is relative to the
app directory, cannot escape it, and cannot name the app root. Resource targets
cannot overlap each other or the framework's staged manifest. `mode` is an
optional quoted octal string such as `"0644"` or `"0755"`; numeric JSON modes
are rejected. Declared modes are restored after native-package permission
normalization.

## Runtime Hooks

Each runtime hook accepts a relative source string, an object, or an array of
either form:

```json
{
  "runtimeHooks": {
    "env": "env",
    "prelaunch": {
      "source": "prelaunch.sh",
      "retainWhenDisabled": true
    },
    "electronArgs": "electron-args",
    "launcher": "launcher-hook.sh",
    "coldStart": "cold-start.sh",
    "afterExit": "after-exit.sh"
  }
}
```

The object form accepts `source` (or `path`), an optional output `name`, an
optional quoted-octal `mode`, and optional boolean `retainWhenDisabled`. Staged
hook filenames are prefixed with `<integration-id>-`, including an explicit
`name`.

| Hook | Staged directory | Runtime behavior |
| --- | --- | --- |
| `env` | `.chatgpt-linux/env.d/` | Exports each non-comment `KEY=VALUE` line literally, without shell evaluation. |
| `prelaunch` | `.chatgpt-linux/prelaunch.d/` | Runs synchronously before packaged-runtime prelaunch and webview setup. |
| `electronArgs` | `.chatgpt-linux/electron-args.d/` | Appends each non-comment line as one Electron argument. |
| `launcher` | `.chatgpt-linux/launcher.d/` | Runs after Electron defaults and arguments are collected, immediately before final launch-argument construction. |
| `coldStart` | `.chatgpt-linux/cold-start.d/` | Runs in the background during cold start after bundled-plugin cache sync. |
| `afterExit` | `.chatgpt-linux/after-exit.d/` | Runs after Electron exits; failures do not replace Electron's exit status. |

Executable hooks receive `CODEX_HOME`, `CHATGPT_LINUX_APP_DIR`,
`CHATGPT_LINUX_APP_STATE_DIR`, `CHATGPT_PORT_INTEGRATIONS_DIR`,
`CHATGPT_LINUX_LAUNCHER_LOG`, and `CHATGPT_PORT_INTEGRATION_HOOK_PHASE`.
`afterExit` also receives `CHATGPT_LINUX_ELECTRON_EXIT_STATUS`.

A `launcher` hook receives the collected Electron arguments as its argv. Its
standard output accepts only these line protocols:

```text
env NAME=literal value
electron-arg --switch=value
```

Blank lines and comments are ignored. `env` requires a valid shell variable name
and does not evaluate the value. `electron-arg` replaces an earlier occurrence
of the same switch; launcher-selected rendering defaults are removed when an
explicit rendering switch supersedes them. Other output is logged and ignored.

Set `retainWhenDisabled: true` only on a marker-owned cleanup hook that must
remove user-session artifacts after the integration is disabled. A retained hook
must not activate the integration and must leave unmanaged files untouched.

For user-home artifacts such as Codex skills, stage the source under
`.chatgpt-linux/integrations/<integration-id>/` and copy it into place from a
prelaunch hook. Do not write user-home files from `stageHook`; installs and
updater rebuilds may run outside the user's session.

## Native Package Resources And Dependencies

`packageResources` stages regular files outside the packaged app directory:

```json
{
  "packageResources": [
    {
      "source": "resources/70-example.rules",
      "target": "usr/lib/udev/rules.d/70-example.rules",
      "mode": "0644",
      "formats": ["deb", "rpm", "pacman"]
    }
  ]
}
```

`source` must be a regular, non-symlinked file inside the integration directory.
`target` is relative to the package root, must stay outside the packaged app,
and cannot use Debian control or pacman metadata namespaces. `formats` defaults
to all supported native formats. `mode` is a quoted octal string and defaults to
`"0644"`; special permission bits are rejected. Targets cannot overlap other
integration resources or existing package payload.

`packageDependencies` maps each package format to an array of native dependency
tokens:

```json
{
  "packageDependencies": {
    "deb": ["libusb-1.0-0"],
    "rpm": ["libusb-1.0.so.0%{chatgpt_elf_suffix}"],
    "pacman": ["libusb"]
  }
}
```

Supported keys are `deb`, `rpm`, and `pacman`. Values are validated,
deduplicated, and sorted. RPM dependencies may use the terminal
`%{chatgpt_elf_suffix}` placeholder for the package builder's architecture
suffix.

Before resolving package resources, dependencies, or hooks, packaging verifies
that the generated app's `.chatgpt-linux/build-info.json` exactly matches the
current full resolved config, integration-root kind, and integration-input
digest. Rebuild the app before packaging after changing a selection, setting,
manifest, hook, resource, or other enabled integration input.

## Package Hooks

Use `packageHooks` only when an integration must perform a mutation that
`packageResources` cannot express:

```json
{
  "packageHooks": [
    {
      "path": "package.sh",
      "formats": ["deb", "rpm", "pacman"]
    }
  ]
}
```

An empty or omitted `formats` array applies to every native format. Hooks run
with:

- `PACKAGE_FORMAT`
- `PACKAGE_NAME`
- `PACKAGE_VERSION`
- `PACKAGE_ROOT` / `PACKAGE_STAGING_ROOT`
- `APP_DIR` / `PACKAGE_APP_DIR`
- `REPO_DIR` / `SCRIPT_DIR`

Package hooks must be idempotent and narrowly scoped to their integration.

## Authoring Validation

Keep a self-contained test beside each integration and run it directly while
authoring:

```bash
node --test port-integrations/my-integration/test.js
```

Run the loader and registry-policy suites when changing manifest fields or
framework behavior:

```bash
node --test scripts/lib/port-integrations.test.js
node --test port-integrations/identity-policy.test.js
```
