"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  applyMainBundlePatch,
  applyWebviewRuntimePatch,
  applyWrapperUpdateSettingsPatch,
  patchWrapperUpdateSettingsAssets,
} = require("./patch.js");
const {
  discoverPortIntegrationManifests,
  enabledPortIntegrationIds,
  loadPortIntegrationPatchDescriptors,
  stageEnabledPortIntegrationInstall,
} = require("../../scripts/lib/port-integrations.js");

const integrationDir = __dirname;
const integrationsRoot = path.resolve(integrationDir, "..");

const defaultEnabledIntegrationIds = discoverPortIntegrationManifests({ integrationsRoot })
  .filter((integration) => integration.manifest.defaultEnabled)
  .map((integration) => integration.id);

function withTempIntegrationConfig(enabled, fn) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-config-"));
  process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(tempDir, "integrations.json");
  try {
    const enabledSet = new Set(enabled);
    fs.writeFileSync(
      process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG,
      JSON.stringify({
        enabled,
        disabled: defaultEnabledIntegrationIds.filter((id) => !enabledSet.has(id)),
      }, null, 2),
    );
    return fn();
  } finally {
    if (originalConfig == null) {
      delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    } else {
      process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function fakeManager(temp, body = "exit ${CHATGPT_FAKE_MANAGER_STATUS:-0}\n") {
  const manager = path.join(temp, "chatgpt-updater");
  fs.writeFileSync(manager, `#!/usr/bin/env bash\n${body}`);
  fs.chmodSync(manager, 0o755);
  return manager;
}

function resolveBashPath() {
  const result = spawnSync("bash", ["-lc", "command -v bash"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : "bash";
}

function withoutWarnings(fn) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
}

test("main bundle patch writes app-state wrapper marker", () => {
  const source =
    `"use strict";var f=require("node:fs"),p=require("node:path"),c=require("node:child_process");` +
    `var handlers={"native-desktop-apps":async()=>({ok:true})};`;

  const patched = applyMainBundlePatch(source);

  assert.match(patched, /"chatgpt-linux-wrapper-updater":async/);
  assert.match(patched, /CHATGPT_LINUX_APP_STATE_DIR/);
  assert.match(patched, /pick-integrations/);
  assert.match(patched, /CHATGPT_PACKAGE_HAS_UPDATER/);
  assert.match(patched, /process\.env\.APPIMAGE/);
  assert.match(patched, /chatgptLinuxWrapManagerAvailable/);
  assert.match(patched, /chatgptLinuxWrapWrapperUpdatesEnabled/);
  assert.match(patched, /chatgpt-linux-wrapper-updates-enabled/);
  assert.match(patched, /if\(!chatgptLinuxWrapWrapperUpdatesEnabled\(\)\|\|!chatgptLinuxWrapManagerAvailable\(\)\)return/);
  assert.match(patched, /show:e&&a&&chatgptLinuxWrapShouldShow/);
  assert.match(patched, /wrapper-updates-disabled/);
  assert.match(patched, /chatgpt-linux-integration-picker-on-update/);
  assert.match(patched, /chatgpt-wrapper-updater/);
  assert.match(patched, /wrapper_dev_mode/);
  assert.match(patched, /installed_wrapper_commit/);
  assert.match(patched, /installed_commit/);
  assert.doesNotMatch(patched, /wrapper-update-pending/);
  assert.doesNotMatch(patched, /wrapper_status/);
});

test("main bundle helper does not shadow minified module variables", () => {
  const source =
    `"use strict";var p=require("node:fs"),u=require("node:path"),c=require("node:child_process");` +
    `var handlers={"native-desktop-apps":async()=>({ok:true})};`;

  const patched = applyMainBundlePatch(source);

  assert.match(patched, /chatgptLinuxWrapFs\(\)\.existsSync\(__chatgptWrapStatePath\)/);
  assert.match(patched, /chatgptLinuxWrapFs\(\)\.readFileSync\(__chatgptWrapStatePath,`utf8`\)/);
  assert.match(patched, /chatgptLinuxWrapFs\(\)\.mkdirSync\(chatgptLinuxWrapPath\(\)\.dirname\(__chatgptWrapMarkerPath\),\{recursive:!0\}\)/);
  assert.match(patched, /chatgptLinuxWrapFs\(\)\.writeFileSync\(__chatgptWrapMarkerPath,new Date\(\)\.toISOString\(\)\)/);
  assert.match(patched, /let __chatgptWrapCheckProcess=chatgptLinuxWrapChildProcess\(\)\.spawn\(/);
  assert.doesNotMatch(patched, /let p=chatgptLinuxWrapStatePath\(\)/);
  assert.doesNotMatch(patched, /let c=c\.spawn\(/);
  assert.doesNotMatch(patched, /__chatgptChild/);
});

test("webview runtime renders dev-mode and installed SHA chip", () => {
  const patched = applyWebviewRuntimePatch("console.log('codex');");

  assert.match(patched, /chatgpt-wrapper-updater-v4/);
  assert.match(patched, /chatgpt-linux-wrapper-sha/);
  assert.match(patched, /installed_commit/);
  assert.match(patched, /dev-mode/);
  assert.match(patched, /\\u2699/);
  assert.match(patched, /\\u2193/);
});

test("webview runtime is not swallowed by a trailing sourcemap comment", () => {
  const patched = applyWebviewRuntimePatch("console.log('codex');\n//# sourceMappingURL=index.js.map");

  assert.match(patched, /sourceMappingURL=index\.js\.map\n;\(\(\)=>/);
  assert.doesNotMatch(patched, /sourceMappingURL=index\.js\.map;\(\(\)=>/);
});

test("settings patch adds wrapper update toggle", () => {
  const source =
    `var KEYS={autoUpdateOnExit:"chatgpt-linux-auto-update-on-exit"};` +
    `function Settings(){return $.jsx(SettingsGroup,{children:$.jsx(LinuxToggle,{settingKey:KEYS.autoUpdateOnExit,label:"Install updates when you close ChatGPT",description:"When on, a ready update waits for ChatGPT to close and then installs. When off, updates wait until you click Update."})})}`;

  const patched = applyWrapperUpdateSettingsPatch(source);

  assert.match(patched, /wrapperUpdates:"chatgpt-linux-wrapper-updates-enabled"/);
  assert.match(patched, /integrationPickerOnUpdate:"chatgpt-linux-integration-picker-on-update"/);
  assert.match(patched, /Check for ChatGPT updates/);
  assert.match(patched, /Ask which integrations to enable on update/);
  assert.equal(applyWrapperUpdateSettingsPatch(patched), patched);
});

test("settings asset patch does not fall back to legacy settings bundles", () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-legacy-settings-"));
  const assetsDir = path.join(appDir, "webview", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const generalSettings = `function Br(){return null}`;
  const keybindsSettings = `var KEYS={autoUpdateOnExit:"chatgpt-linux-auto-update-on-exit"};`;
  fs.writeFileSync(path.join(assetsDir, "general-settings-z.js"), generalSettings);
  fs.writeFileSync(path.join(assetsDir, "keybinds-settings-linux.js"), keybindsSettings);

  try {
    assert.deepEqual(patchWrapperUpdateSettingsAssets(appDir), {
      matched: false,
      changed: 0,
      reason: "linux-desktop-settings-linux.js is not present",
    });
    assert.equal(fs.readFileSync(path.join(assetsDir, "general-settings-z.js"), "utf8"), generalSettings);
    assert.equal(fs.readFileSync(path.join(assetsDir, "keybinds-settings-linux.js"), "utf8"), keybindsSettings);
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("settings asset patch prefers generated Linux desktop settings bundle", () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-linux-desktop-settings-"));
  const assetsDir = path.join(appDir, "webview", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const linuxDesktopSettings =
    `var KEYS={autoUpdateOnExit:"chatgpt-linux-auto-update-on-exit"};` +
    `function Settings(){return $.jsx(SettingsGroup,{children:$.jsx(LinuxToggle,{settingKey:KEYS.autoUpdateOnExit,label:"Install updates when you close ChatGPT",description:"When on, a ready update waits for ChatGPT to close and then installs. When off, updates wait until you click Update."})})}`;
  const generalSettings = `function Br(){return null}`;
  fs.writeFileSync(path.join(assetsDir, "linux-desktop-settings-linux.js"), linuxDesktopSettings);
  fs.writeFileSync(path.join(assetsDir, "general-settings-z.js"), generalSettings);

  try {
    assert.deepEqual(patchWrapperUpdateSettingsAssets(appDir), { matched: true, changed: 1 });
    assert.deepEqual(patchWrapperUpdateSettingsAssets(appDir), { matched: true, changed: 0 });
    assert.match(
      fs.readFileSync(path.join(assetsDir, "linux-desktop-settings-linux.js"), "utf8"),
      /Check for ChatGPT updates/,
    );
    assert.equal(
      fs.readFileSync(path.join(assetsDir, "general-settings-z.js"), "utf8"),
      generalSettings,
    );
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("settings asset patch leaves current asset unchanged on synthetic drift", () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-settings-drift-"));
  const assetsDir = path.join(appDir, "webview", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const driftedSettings = `var KEYS={autoUpdateOnExit:"chatgpt-linux-auto-update-on-exit"};function Settings(){return null}`;
  const settingsPath = path.join(assetsDir, "linux-desktop-settings-linux.js");
  fs.writeFileSync(settingsPath, driftedSettings);

  try {
    assert.deepEqual(withoutWarnings(() => patchWrapperUpdateSettingsAssets(appDir)), {
      matched: false,
      changed: 0,
      reason: "could not find Linux update toggle",
    });
    assert.equal(fs.readFileSync(settingsPath, "utf8"), driftedSettings);
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("integration exposes optional patches and declarative apply hooks when enabled", () => {
  withTempIntegrationConfig(["chatgpt-wrapper-updater"], () => {
    assert.ok(enabledPortIntegrationIds({ integrationsRoot }).includes("chatgpt-wrapper-updater"));
    assert.deepEqual(
      loadPortIntegrationPatchDescriptors({ integrationsRoot })
        .filter((descriptor) => descriptor.id.startsWith("integration:chatgpt-wrapper-updater:"))
        .map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
      [
        ["integration:chatgpt-wrapper-updater:main-handler", "main-bundle", "optional"],
        ["integration:chatgpt-wrapper-updater:webview-runtime", "webview-asset", "optional"],
        ["integration:chatgpt-wrapper-updater:settings-toggle", "extracted-app:post-webview", "optional"],
      ],
    );

    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-app-"));
    try {
      const plan = stageEnabledPortIntegrationInstall(appDir, { integrationsRoot });
      assert.deepEqual(
        plan.runtimeHooks.map((hook) => [hook.key, hook.target, hook.mode.toString(8)]),
        [
          ["prelaunch", ".chatgpt-linux/prelaunch.d/chatgpt-wrapper-updater-apply-pending.sh", "755"],
          ["afterExit", ".chatgpt-linux/after-exit.d/chatgpt-wrapper-updater-apply-pending.sh", "755"],
          ["prelaunch", ".chatgpt-linux/prelaunch.d/ui-tweaks-dock-icon-cleanup.sh", "755"],
        ],
      );
      assert.equal(
        fs.existsSync(
          path.join(appDir, ".chatgpt-linux", "prelaunch.d", "chatgpt-wrapper-updater-apply-pending.sh"),
        ),
        true,
      );
      assert.equal(
        fs.existsSync(
          path.join(appDir, ".chatgpt-linux", "after-exit.d", "chatgpt-wrapper-updater-apply-pending.sh"),
        ),
        true,
      );
      assert.equal(
        fs.existsSync(path.join(appDir, ".chatgpt-linux", "env.d", "chatgpt-wrapper-updater-wrapper-updater.env")),
        false,
      );
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });
});

test("apply hook preserves marker on failure and clears it on success", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-"));
  const markerDir = path.join(temp, "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  const manager = fakeManager(temp);
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const env = {
    ...process.env,
    CHATGPT_LINUX_APP_STATE_DIR: temp,
    CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
    CHATGPT_UPDATER_PATH: manager,
  };

  const failed = spawnSync("bash", [path.join(integrationDir, "apply-pending.sh")], {
    env: { ...env, CHATGPT_FAKE_MANAGER_STATUS: "42" },
    encoding: "utf8",
  });
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(fs.existsSync(marker), true);

  const succeeded = spawnSync("bash", [path.join(integrationDir, "apply-pending.sh")], {
    env,
    encoding: "utf8",
  });
  assert.equal(succeeded.status, 0, succeeded.stderr);
  assert.equal(fs.existsSync(marker), false);
});

test("apply hook rejects the obsolete port-owned hook phase variable", () => {
  const result = spawnSync(resolveBashPath(), [path.join(integrationDir, "apply-pending.sh")], {
    env: {
      ...process.env,
      CHATGPT_LINUX_FEATURE_HOOK_PHASE: "prelaunch",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /CHATGPT_LINUX_FEATURE_HOOK_PHASE is no longer supported; use CHATGPT_PORT_INTEGRATION_HOOK_PHASE/,
  );
});

test("apply hook clears stale marker when package has no updater", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-no-updater-"));
  const markerDir = path.join(temp, "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const result = spawnSync(resolveBashPath(), [path.join(integrationDir, "apply-pending.sh")], {
    env: {
      ...process.env,
      CHATGPT_LINUX_APP_STATE_DIR: temp,
      CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
      CHATGPT_PACKAGE_HAS_UPDATER: "0",
      CHATGPT_UPDATER_PATH: "",
      PATH: process.env.PATH,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.match(result.stdout, /cleared stale marker/);
});

test("apply hook normalizes package updater flag before clearing stale marker", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-normalized-"));
  const markerDir = path.join(temp, "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const result = spawnSync(resolveBashPath(), [path.join(integrationDir, "apply-pending.sh")], {
    env: {
      ...process.env,
      CHATGPT_LINUX_APP_STATE_DIR: temp,
      CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
      CHATGPT_PACKAGE_HAS_UPDATER: " False ",
      CHATGPT_UPDATER_PATH: "",
      PATH: process.env.PATH,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.match(result.stdout, /cleared stale marker/);
});

test("apply hook treats AppImage sessions as no-updater unless explicitly flagged", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-appimage-"));
  const markerDir = path.join(temp, "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  const invoked = path.join(temp, "manager-invoked");
  const manager = fakeManager(temp, `touch ${JSON.stringify(invoked)}\nexit 0\n`);
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const result = spawnSync(resolveBashPath(), [path.join(integrationDir, "apply-pending.sh")], {
    env: {
      ...process.env,
      CHATGPT_LINUX_APP_STATE_DIR: temp,
      CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
      APPIMAGE: path.join(temp, "Codex.AppImage"),
      CHATGPT_UPDATER_PATH: manager,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(invoked), false);
  assert.match(result.stdout, /cleared stale marker/);
});

test("apply hook resolves marker from sanitized app id when app state dir is absent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-xdg-"));
  const markerDir = path.join(temp, "chatgpt-cua-lab", "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  const manager = fakeManager(temp);
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const result = spawnSync("bash", [path.join(integrationDir, "apply-pending.sh")], {
    env: {
      ...process.env,
      CHATGPT_LINUX_APP_ID: "chatgpt-cua-lab",
      CHATGPT_LINUX_APP_STATE_DIR: "",
      CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
      CHATGPT_UPDATER_PATH: manager,
      XDG_STATE_HOME: temp,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
});

test("apply hook skip guard and lock keep marker without running manager", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-guard-"));
  const markerDir = path.join(temp, "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  const invoked = path.join(temp, "manager-invoked");
  const manager = fakeManager(temp, `touch ${JSON.stringify(invoked)}\nexit 0\n`);
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const env = {
    ...process.env,
    CHATGPT_LINUX_APP_STATE_DIR: temp,
    CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
    CHATGPT_UPDATER_PATH: manager,
  };

  const skipped = spawnSync("bash", [path.join(integrationDir, "apply-pending.sh")], {
    env: { ...env, CHATGPT_WRAPPER_UPDATER_SKIP_PRELAUNCH_ONCE: "1" },
    encoding: "utf8",
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(fs.existsSync(marker), true);
  assert.equal(fs.existsSync(invoked), false);

  fs.mkdirSync(path.join(markerDir, "apply.lock"));
  const locked = spawnSync("bash", [path.join(integrationDir, "apply-pending.sh")], {
    env,
    encoding: "utf8",
  });
  assert.equal(locked.status, 0, locked.stderr);
  assert.equal(fs.existsSync(marker), true);
  assert.equal(fs.existsSync(invoked), false);
});

test("apply hook uses port-integration phase before legacy feature phase", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-wrapper-updater-phase-"));
  const markerDir = path.join(temp, "chatgpt-wrapper-updater");
  const marker = path.join(markerDir, "pending");
  const invoked = path.join(temp, "manager-invoked");
  const manager = fakeManager(temp, `touch ${JSON.stringify(invoked)}\nexit 0\n`);
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(marker, "pending\n");

  const result = spawnSync("bash", [path.join(integrationDir, "apply-pending.sh")], {
    env: {
      ...process.env,
      CHATGPT_LINUX_APP_STATE_DIR: temp,
      CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "prelaunch",
      CHATGPT_PORT_INTEGRATION_HOOK_PHASE: "manual",
      CHATGPT_WRAPPER_UPDATER_SKIP_PRELAUNCH_ONCE: "1",
      CHATGPT_UPDATER_PATH: manager,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(invoked), true);
  assert.equal(fs.existsSync(marker), false);
});
