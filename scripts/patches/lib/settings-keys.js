"use strict";

const linuxSettingsKeys = {
  readAloud: "chatgpt-linux-read-aloud-enabled",
  readAloudKokoroSpeed: "chatgpt-linux-read-aloud-kokoro-speed",
  promptWindow: "chatgpt-linux-prompt-window-enabled",
  systemTray: "chatgpt-linux-system-tray-enabled",
  warmStart: "chatgpt-linux-warm-start-enabled",
  autoUpdateOnExit: "chatgpt-linux-auto-update-on-exit",
  wrapperUpdates: "chatgpt-linux-wrapper-updates-enabled",
  integrationPickerOnUpdate: "chatgpt-linux-integration-picker-on-update",
};

const keybindsSettingsAsset = "keybinds-settings-linux.js";
const linuxKeybindOverridesKey = "chatgpt-linux-keybind-overrides";

module.exports = {
  keybindsSettingsAsset,
  linuxKeybindOverridesKey,
  linuxSettingsKeys,
};
