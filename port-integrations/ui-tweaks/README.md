# UI Tweaks

This default-enabled port integration groups small ChatGPT UI customizations
whose settings remain independently configurable.

## Configuration

To disable it for a checkout build, add its id to `disabled` in the gitignored
`port-integrations/integrations.json`, then rebuild the app:

```json
{
  "enabled": [],
  "disabled": ["ui-tweaks"]
}
```

## Tweaks

| Tweak | Patch module | What it does | Settings |
| --- | --- | --- | --- |
| `appearance.dockIcon` | `patches/dock-icon.js` | Exposes the official app's Appearance setting and search result for switching Linux windows, the system tray, and supported launchers between the ChatGPT and Codex icons. | `tweaks.appearance.dockIcon.enabled` |
| `home.suggestedPrompts` | `patches/suggested-prompts.js` | Exposes the official app's Suggested Prompts setting and enables generated project-aware cards on Home. | `tweaks.home.suggestedPrompts.enabled` |
| `modelPicker.showModelsByDefault` | `patches/model-picker-model-list.js` | Opens the advanced picker by default and shows model choices inline instead of hiding them behind the compact Power slider and a nested Model submenu. | `tweaks.modelPicker.showModelsByDefault.enabled` |
| `reasoning.keepEffortLabelsEnglish` | `patches/reasoning-effort-labels.js` | Keeps reasoning effort values in English in the Simplified Chinese UI while leaving the surrounding interface translated. | `tweaks.reasoning.keepEffortLabelsEnglish.enabled` |
| `sidebar.projectName` | `patches/sidebar-project-name.js` | Styles project names in the left sidebar project list. It does not style `Projects` / `Chats` section headings and does not style chat rows. | `tweaks.sidebar.projectName.enabled`, `tweaks.sidebar.projectName.style` |

## Settings

Tracked defaults live in `integration.json`, but local preferences should not be
edited there. Put user-specific overrides in the gitignored
`port-integrations/integrations.json` file under `settings.ui-tweaks`.

Example local config:

```json
{
  "enabled": [],
  "disabled": [],
  "settings": {
    "ui-tweaks": {
      "tweaks": {
        "sidebar": {
          "projectName": {
            "style": "font-weight: 800 !important; color: red;"
          }
        }
      }
    }
  }
}
```

Each tweak documents its own config keys below.

### `appearance.dockIcon`

Exposes the official app's Dock icon selector on Linux and stages its original
PNG resources. The selected icon is applied to open
and restored Electron windows and to the system tray. On KDE Plasma, the tweak
also creates and updates a managed user-local desktop entry so a pinned taskbar
launcher follows the selected icon without reloading Plasma Shell. The alternate-icon
resources are cropped to the same visual occupancy as the ChatGPT icon because
Linux taskbars do not apply macOS Dock normalization. Existing user-managed
desktop entries remain untouched. Packaged launchers are discovered from the
runtime desktop hint or the standard `XDG_DATA_DIRS` application paths. The
source launcher must match the active app id before it can be copied, so a
side-by-side identity cannot inherit the default package's launch commands.

This tweak is disabled by default so the ChatGPT for Linux project logo remains
the default window, tray, and launcher identity. Enable the official app's
ChatGPT/Codex selector without changing the other UI Tweaks:

```json
{
  "enabled": [],
  "disabled": [],
  "settings": {
    "ui-tweaks": {
      "tweaks": {
        "appearance": {
          "dockIcon": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

Config keys:

- `enabled`: `true` applies the three Dock icon descriptors, stages the official
  app resources, and allows the selected official ChatGPT or Codex icon to
  replace the project logo on supported runtime surfaces. The default `false`
  skips Dock-specific asset checks and removes any staged Dock icon payload
  without disabling other UI tweaks. On the next cold start, a prelaunch hook
  also removes a marker-owned user-local launcher and its managed icon files.
  Unmanaged or symlinked desktop artifacts are preserved.

### `home.suggestedPrompts`

Exposes the official app's Suggested Prompts row in General Settings and enables
its generated-suggestion path on Home. The official app generates suggestions
from the selected project and connected apps. Selecting a
card fills the composer with its proposed next action.

Suggested Prompts is available only when all three gates pass: the official
rollout and account-eligibility checks, the user's Suggested Prompts
setting, and this port integration's Linux support. The patch preserves the
official checks as required conditions; the Linux marker does not bypass them.

This tweak is enabled by default with `ui-tweaks`. Disable its Linux support
without disabling the other UI tweaks:

```json
{
  "enabled": [],
  "disabled": [],
  "settings": {
    "ui-tweaks": {
      "tweaks": {
        "home": {
          "suggestedPrompts": {
            "enabled": false
          }
        }
      }
    }
  }
}
```

Config keys:

- `enabled`: `true` supplies Linux support while preserving the official
  eligibility and user-setting gates. `false` leaves the official Settings and
  Home behavior unchanged while other UI tweaks remain independently configurable.

### `modelPicker.showModelsByDefault`

Makes the detailed model list the default ChatGPT composer picker view. The model
rows are rendered inline, so newly available families such as GPT-5.6 Luna,
Terra, and Sol remain visible without first switching away from the compact
Power slider or opening a nested Model submenu. The compact GPT-5.6 Power
slider also derives Sol's positions from the model's `supportedReasoningEfforts`
after the app filters that list through the reasoning efforts enabled in
settings. Enabled efforts such as Max therefore appear without maintaining a
separate hard-coded effort list.

Config keys:

- `enabled`: `true` applies the tweak, `false` keeps the integration enabled but
  leaves the official app's model picker unchanged.

### `reasoning.keepEffortLabelsEnglish`

Leaves the reasoning effort values as `None`, `Minimal`, `Low`, `Medium`,
`High`, `XHigh`, `Max`, and `Ultra` in the Simplified Chinese locale. The
surrounding picker title and usage warning remain translated. This avoids
collapsing distinct official app values such as `XHigh` and `Ultra` into the
same Chinese label.

Config keys:

- `enabled`: `true` applies the tweak, `false` keeps the integration enabled but
  uses the official app's translated effort labels.

### `sidebar.projectName`

Styles project names in the left sidebar project list.

Tracked default in `integration.json`:

```json
{
  "tweaks": {
    "sidebar": {
      "projectName": {
        "enabled": true,
        "style": "font-weight: 700 !important;"
      }
    }
  }
}
```

Config keys:

- `enabled`: `true` applies the tweak, `false` keeps the integration enabled but
  skips this specific tweak.
- `style`: CSS declaration list inserted into the project-name rule, such as
  `font-weight: 800 !important; color: red;`. It is not arbitrary CSS; unsafe
  syntax that could escape the scoped rule warns and falls back to the default.
  The default is `font-weight: 700 !important;`, so project names are bold
  without changing the fixed row geometry or forcing a color.

## Drift Behavior

The patches are fail-soft. If official app bundle markers drift, the integration
writes a `WARN` message and leaves the asset unchanged. The patch report exposes
that warning, and acceptance rejects a candidate when the enabled tweak has drifted.
Missing Dock icon resources also warn, remove only the Dock icon payload, and do
not abort staging. Suggested Prompts validates every current insertion point
before changing an asset and leaves mixed or drifted input byte-identical.
Invalid style values warn and fall back to the default bold style.

## Adding Tweaks

Add each tweak as a focused module under `patches/`, register it from `patch.js`,
document its JSON settings here, and add coverage in `test.js`.

Run the integration tests with:

```bash
node --test port-integrations/ui-tweaks/test.js
```
