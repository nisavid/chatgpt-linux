#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const patcher = path.join(__dirname, "patch-chrome-plugin.js");

test("keeps current browser preference routing and patches the current Chrome skill", () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chrome-plugin-current-"));
  const scriptsDir = path.join(pluginDir, "scripts");
  const skillDir = path.join(pluginDir, "skills", "control-chrome");
  const browserClient = [
    "const browserPreference = {};",
    "function preferredWindowIdFor() {}",
    "function getForUrl() {}",
    "const extensionInstanceId = null;",
  ].join("\n");

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, "browser-client.mjs"),
      browserClient,
      "utf8",
    );
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "Use the browser bound to `browser` for tasks in this skill.\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, [patcher, pluginDir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(path.join(scriptsDir, "browser-client.mjs"), "utf8"),
      browserClient,
    );
    assert.doesNotMatch(result.stdout, /browser-client\.mjs skipped:/);
    assert.doesNotMatch(result.stderr, /browser-client\.mjs missing patch target/);

    const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    assert.match(skill, /agent\.browsers\.list\(\)/);
    assert.match(skill, /browser\.tabs\.new\(\)/);
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

test("adapts the current declarative browser contract without drift warnings", () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-chrome-plugin-declarative-"));
  const scriptsDir = path.join(pluginDir, "scripts");
  const skillDir = path.join(pluginDir, "skills", "control-chrome");
  const baseBrowser = {
    browserFamily: "chrome",
    displayName: "Google Chrome",
    shortDisplayName: "Chrome",
    extensionIds: ["extension-id"],
    extensionManagementUrl: "chrome://extensions",
    storeUrl: "https://example.invalid/extension",
    linux: {
      commands: ["google-chrome", "chromium"],
      configHomeEnvironmentVariables: ["XDG_CONFIG_HOME"],
      nativeMessagingManifestDirectories: [
        ".config/google-chrome/NativeMessagingHosts",
        ".config/chromium/NativeMessagingHosts",
      ],
      processNames: ["chrome"],
      userDataDirectorySegments: [".config", "google-chrome"],
    },
    macos: { applicationNames: [], bundleId: "test", processNames: [], userDataDirectorySegments: [] },
    windows: { commandNames: [], installPathSegments: [], processNames: [], userDataDirectorySegments: [] },
  };

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, "extension-ids.json"), JSON.stringify({
      browserDiagnostics: [baseBrowser, { ...baseBrowser, browserFamily: "edge" }],
    }, null, 2));
    fs.writeFileSync(path.join(scriptsDir, "chromium-browser-diagnostics.mjs"), [
      "export function getBrowserDiagnostics(config, browserFamily) {}",
      "export function resolveBrowserUserDataDirectory({}) {}",
      "export function resolveLinuxNativeMessagingManifestPath({}) {}",
    ].join("\n"));
    fs.writeFileSync(path.join(scriptsDir, "installManifest.mjs"),
      'nativeMessagingManifestDirectories:[".config/google-chrome/NativeMessagingHosts",".config/chromium/NativeMessagingHosts"]');
    fs.writeFileSync(path.join(scriptsDir, "check-native-host-manifest.js"), "current declarative checker");
    fs.writeFileSync(path.join(scriptsDir, "installed-browsers.js"), "current declarative inventory");
    fs.writeFileSync(path.join(scriptsDir, "chrome-is-running.js"), "current declarative process checker");
    for (const name of ["check-extension-installed.js", "open-chrome-window.js"]) {
      fs.writeFileSync(path.join(scriptsDir, name), [
        "resolveBrowserUserDataDirectory({",
        "const runningProfile =",
        "    resolveChromeProfileDirectoryFromRunningProcess(userDataDirectory);",
        "function linuxProcessDirectories() {}",
      ].join("\n"));
    }
    const currentSkill = [
      "App-provided in-app-browser context is ambient UI state",
      'globalThis.browser = await agent.browsers.get("extension");',
    ].join("\n");
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), currentSkill);

    const first = spawnSync(process.execPath, [patcher, pluginDir], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.doesNotMatch(first.stderr, /WARN:/);
    const diagnostics = JSON.parse(fs.readFileSync(path.join(scriptsDir, "extension-ids.json"), "utf8"));
    assert.deepEqual(diagnostics.browserDiagnostics.map((browser) => browser.browserFamily),
      ["chrome", "brave", "chromium", "edge"]);
    assert.match(fs.readFileSync(path.join(scriptsDir, "installManifest.mjs"), "utf8"),
      /BraveSoftware\/Brave-Browser\/NativeMessagingHosts/);
    assert.equal(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), currentSkill);
    for (const name of ["check-extension-installed.js", "open-chrome-window.js"]) {
      assert.doesNotMatch(fs.readFileSync(path.join(scriptsDir, name), "utf8"),
        /linuxChromiumUserDataDirectory/);
    }

    const snapshot = new Map(fs.readdirSync(scriptsDir).map((name) => [
      name, fs.readFileSync(path.join(scriptsDir, name), "utf8"),
    ]));
    const second = spawnSync(process.execPath, [patcher, pluginDir], { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stderr, /WARN:/);
    for (const [name, contents] of snapshot)
      assert.equal(fs.readFileSync(path.join(scriptsDir, name), "utf8"), contents);
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});
