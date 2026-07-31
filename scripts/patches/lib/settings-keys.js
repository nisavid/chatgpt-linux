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

const COMPUTER_USE_UI_ENV_VAR = "CHATGPT_LINUX_ENABLE_COMPUTER_USE_UI";
const COMPUTER_USE_UI_SETTINGS_KEY = "chatgpt-linux-computer-use-ui-enabled";

module.exports = {
  COMPUTER_USE_UI_ENV_VAR,
  COMPUTER_USE_UI_SETTINGS_KEY,
  keybindsSettingsAsset,
  linuxKeybindOverridesKey,
  linuxSettingsKeys,
};
