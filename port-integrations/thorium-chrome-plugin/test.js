#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  discoverPortIntegrationManifests,
  enabledPortIntegrationIds,
  enabledPortIntegrationStageHooks,
  loadPortIntegrationPatchDescriptors,
} = require("../../scripts/lib/port-integrations.js");
const { applyThoriumChromeExtensionStatusPatch } = require("./patch.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const repoIntegrationsRoot = path.join(repoRoot, "port-integrations");
const defaultEnabledIntegrationIds = discoverPortIntegrationManifests({
  integrationsRoot: repoIntegrationsRoot,
})
  .filter(({ manifest }) => manifest.defaultEnabled === true)
  .map(({ id }) => id);

function integrationSelection(enabled) {
  const enabledSet = new Set(enabled);
  return {
    enabled,
    disabled: defaultEnabledIntegrationIds.filter((id) => !enabledSet.has(id)),
  };
}

function withTempIntegrationRoot(enabled, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-feature-root-"));
  try {
    fs.writeFileSync(path.join(root, "integrations.example.json"), JSON.stringify({ enabled: [] }, null, 2));
    fs.writeFileSync(path.join(root, "integrations.json"), JSON.stringify(integrationSelection(enabled), null, 2));
    fs.cpSync(__dirname, path.join(root, "thorium-chrome-plugin"), { recursive: true });
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFakeChromePlugin(pluginDir) {
  const scriptsDir = path.join(pluginDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "installManifest.mjs"),
    'var n={extensionId:"hehggadaopoacecdllhhajmbjkdcmajg",extensionHostName:"com.openai.codexextension"};var p=o=>{let t=`${o.extensionHostName}.json`,r={darwin:["Library/Application Support/Google/Chrome/NativeMessagingHosts"],linux:[".config/google-chrome/NativeMessagingHosts"],win32:["AppData/Local/OpenAI/extension"]}[m.platform()];return r.map(s=>l.resolve(m.homedir(),s,t))};\n',
  );
  fs.writeFileSync(
    path.join(scriptsDir, "browser-client.mjs"),
    'import{readFile as P7}from"fs/promises";import{resolve as D7}from"path";import{resolve as S7}from"path";import{homedir as v7,platform as E7}from"os";var Cd=S7(v7(),E7()==="win32"?"AppData\\\\Local\\\\Google\\\\Chrome\\\\User Data":"Library/Application Support/Google/Chrome");import{ClassicLevel as C7}from"./node_modules/classic-level.mjs";import{resolve as bg}from"path";import{tmpdir as T7}from"os";import{cp as A7,mkdtemp as I7,rm as HI}from"fs/promises";import{existsSync as k7}from"fs";var VI=async(e,t)=>{let r=bg(Cd,e,"Local Extension Settings",t);if(!k7(r))return null;let n=await I7(bg(R7(),"codex"));await A7(r,n,{recursive:!0}),await HI(bg(n,"LOCK"));let o=new C7(n,{createIfMissing:!1,keyEncoding:"utf8",valueEncoding:"utf8"});try{await o.open();let i=await o.get("extensionInstanceId");if(!i)return null;let s=JSON.parse(i);return typeof s!="string"?null:s}finally{await o.close(),await HI(n,{force:!0,recursive:!0})}},R7=()=>T7();var GI=async e=>e,N7=async(e,t)=>(await O7(e)).find(o=>o.instanceId===t)||null,O7=async e=>{let t=await M7();return await Promise.all(t.map(async r=>({...r,instanceId:await VI(r.id,e).catch(n=>(le(n),null))})))},M7=async()=>{let e=D7(Cd,"Local State"),t=JSON.parse(await P7(e,"utf8"));return t.profile.profiles_order.map((r,n)=>{let o=t.profile.info_cache[r];return o?{id:r,name:o.name,isLastUsed:t.profile.last_used===r,orderingIndex:n,avatarUrl:o.avatar_icon}:null}).filter(r=>!!r)};\n',
  );
  fs.writeFileSync(
    path.join(scriptsDir, "check-native-host-manifest.js"),
    `function getNativeHostManifestLocation() {
  if (process.platform === "win32") {
    const registryKey = \`\${WINDOWS_NATIVE_HOST_REGISTRY_KEY_PREFIX}\\\\\${expectedHostName}\`;
    const registryManifestPath = readWindowsRegistryDefaultValue(registryKey);

    return {
      manifestPath: registryManifestPath || getDefaultWindowsManifestPath(),
      registryKey,
      registryManifestPath,
      registryKeyExists: registryManifestPath != null,
    };
  }

  throw new Error(
    \`Unsupported platform for native host manifest check: \${process.platform}. This script supports macOS and Windows.\`,
  );
}
`,
  );
  fs.writeFileSync(
    path.join(scriptsDir, "installed-browsers.js"),
    `const KNOWN_BROWSERS = [
  {
    name: "Google Chrome",
    bundleIds: ["com.google.Chrome"],
    appNames: ["Google Chrome.app"],
    commands: ["google-chrome", "chrome"],
    windowsExecutable: "chrome.exe",
  },
];
`,
  );
  fs.writeFileSync(
    path.join(scriptsDir, "chrome-is-running.js"),
    `const CHROME_PROCESS_NAMES_BY_PLATFORM = {
  darwin: new Set(["Google Chrome", "Google Chrome Helper"]),
  win32: new Set(["chrome.exe"]),
};
`,
  );
  fs.writeFileSync(
    path.join(scriptsDir, "check-extension-installed.js"),
    `function resolveChromeUserDataDirectory() {
  return path.join(os.homedir(), ".config", "google-chrome");
}
`,
  );
  fs.writeFileSync(
    path.join(scriptsDir, "open-chrome-window.js"),
    `function resolveChromeUserDataDirectory() {
  return path.join(os.homedir(), ".config", "google-chrome");
}

function getOpenChromeCommand(profileDirectory) {
  const chromeArgs = [
    \`--profile-directory=\${profileDirectory}\`,
    "--new-window",
    ABOUT_BLANK_URL,
  ];

  return {
    command: "google-chrome",
    args: chromeArgs,
  };
}
`,
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test("Thorium Chrome plugin integration stays disabled until listed in integrations.json", () => {
  withTempIntegrationRoot([], (root) => {
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), []);
    assert.deepEqual(enabledPortIntegrationStageHooks({ integrationsRoot: root }), []);
    assert.deepEqual(loadPortIntegrationPatchDescriptors({ integrationsRoot: root }), []);
  });
});

test("Thorium Chrome plugin integration exposes its patch and stage hook when enabled", () => {
  withTempIntegrationRoot(["thorium-chrome-plugin"], (root) => {
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), ["thorium-chrome-plugin"]);
    assert.equal(enabledPortIntegrationStageHooks({ integrationsRoot: root }).length, 1);
    assert.equal(loadPortIntegrationPatchDescriptors({ integrationsRoot: root }).length, 1);
  });
});

test("Thorium settings patch extends the core Linux Chrome status helper", () => {
  const source =
    "function codexLinuxChromeProfileRoots({homeDir:e,platform:t}){return t===`linux`?[(0,p.join)(e,`.config`,`BraveSoftware`,`Brave-Browser`),(0,p.join)(e,`.config`,`google-chrome`),(0,p.join)(e,`.config`,`google-chrome-beta`),(0,p.join)(e,`.config`,`google-chrome-unstable`),(0,p.join)(e,`.config`,`chromium`)]:[]}function codexLinuxChromeCommand(){for(let t of[`brave-browser`,`brave`,`google-chrome`,`google-chrome-stable`,`google-chrome-beta`,`google-chrome-unstable`,`chromium-browser`,`chromium`]){}}throw Error(`Google Chrome, Brave, or Chromium is not installed`)";
  const patched = applyThoriumChromeExtensionStatusPatch(source);

  assert.match(patched, /`\.config`,`thorium`/);
  assert.match(patched, /`thorium-browser-avx2`/);
  assert.match(patched, /Google Chrome, Brave, Chromium, or Thorium is not installed/);
});

test("Thorium staging targets only the current core Chrome plugin shape", () => {
  const source = fs.readFileSync(path.join(__dirname, "patch-chrome-plugin.js"), "utf8");

  assert.doesNotMatch(
    source,
    /linux:\["\.config\/google-chrome\/NativeMessagingHosts","\.config\/BraveSoftware\/Brave-Browser\/NativeMessagingHosts","\.config\/chromium\/NativeMessagingHosts"\]/,
  );
  assert.doesNotMatch(
    source,
    /linux: new Set\(\["chrome", "google-chrome", "brave", "brave-browser", "chromium", "chromium-browser"\]\)/,
  );
  assert.match(source, /google-chrome-beta\/NativeMessagingHosts/);
  assert.match(source, /"google-chrome-beta", "google-chrome-unstable"/);
});

test("Thorium stage hook upgrades a core Linux-patched Chrome plugin", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-stage-"));
  try {
    const installDir = path.join(workspace, "install");
    const workDir = path.join(workspace, "work");
    const chromePlugin = path.join(installDir, "resources", "plugins", "openai-bundled", "plugins", "chrome");
    const featuresConfig = path.join(workspace, "integrations.json");
    const manifestPathsFile = path.join(installDir, ".codex-linux", "chrome-native-host-manifest-paths");

    fs.mkdirSync(workDir, { recursive: true });
    writeFakeChromePlugin(chromePlugin);
    fs.writeFileSync(featuresConfig, JSON.stringify(integrationSelection(["thorium-chrome-plugin"]), null, 2));
    fs.mkdirSync(path.dirname(manifestPathsFile), { recursive: true });
    fs.writeFileSync(manifestPathsFile, ".config/vivaldi/NativeMessagingHosts\n", "utf8");

    run("node", [path.join(repoRoot, "scripts", "lib", "patch-chrome-plugin.js"), chromePlugin]);
    const stageResult = run("bash", [
      "-lc",
      [
        "source \"$PORT_INTEGRATIONS_RUNNER\"",
        "info(){ echo \"$*\" >&2; }",
        "warn(){ echo \"$*\" >&2; }",
        "SCRIPT_DIR=\"$REPO_ROOT\"",
        "INSTALL_DIR=\"$INSTALL_DIR\"",
        "WORK_DIR=\"$WORK_DIR\"",
        "ARCH=x86_64",
        "run_port_integration_stage_hooks",
      ].join("\n"),
    ], {
      env: {
        ...process.env,
        CODEX_PORT_INTEGRATIONS_CONFIG: featuresConfig,
        PORT_INTEGRATIONS_RUNNER: path.join(repoRoot, "scripts", "lib", "port-integrations.sh"),
        REPO_ROOT: repoRoot,
        INSTALL_DIR: installDir,
        WORK_DIR: workDir,
      },
    });
    assert.doesNotMatch(stageResult.stderr, /missing patch target/);

    const scriptsDir = path.join(chromePlugin, "scripts");
    assert.match(fs.readFileSync(path.join(scriptsDir, "installManifest.mjs"), "utf8"), /thorium\/NativeMessagingHosts/);
    assert.match(fs.readFileSync(path.join(scriptsDir, "check-native-host-manifest.js"), "utf8"), /"thorium"/);
    assert.match(fs.readFileSync(path.join(scriptsDir, "installed-browsers.js"), "utf8"), /Thorium/);
    assert.match(fs.readFileSync(path.join(scriptsDir, "chrome-is-running.js"), "utf8"), /thorium-browser-avx2/);
    assert.match(fs.readFileSync(path.join(scriptsDir, "check-extension-installed.js"), "utf8"), /linuxThoriumUserDataDirectory/);
    assert.match(fs.readFileSync(path.join(scriptsDir, "open-chrome-window.js"), "utf8"), /commandPath\("thorium-browser-avx2"\)/);
    assert.deepEqual(fs.readFileSync(manifestPathsFile, "utf8").trim().split(/\n/), [
      ".config/vivaldi/NativeMessagingHosts",
      ".config/thorium/NativeMessagingHosts",
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Thorium stage hook does not advertise native host paths when Chrome plugin is missing", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-stage-missing-plugin-"));
  try {
    const installDir = path.join(workspace, "install");
    const workDir = path.join(workspace, "work");
    const featuresConfig = path.join(workspace, "integrations.json");
    const manifestPathsFile = path.join(installDir, ".codex-linux", "chrome-native-host-manifest-paths");

    fs.mkdirSync(installDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(featuresConfig, JSON.stringify(integrationSelection(["thorium-chrome-plugin"]), null, 2));

    const result = run("bash", [
      "-lc",
      [
        "source \"$PORT_INTEGRATIONS_RUNNER\"",
        "info(){ echo \"$*\" >&2; }",
        "warn(){ echo \"$*\" >&2; }",
        "SCRIPT_DIR=\"$REPO_ROOT\"",
        "INSTALL_DIR=\"$INSTALL_DIR\"",
        "WORK_DIR=\"$WORK_DIR\"",
        "ARCH=x86_64",
        "run_port_integration_stage_hooks",
      ].join("\n"),
    ], {
      env: {
        ...process.env,
        CODEX_PORT_INTEGRATIONS_CONFIG: featuresConfig,
        PORT_INTEGRATIONS_RUNNER: path.join(repoRoot, "scripts", "lib", "port-integrations.sh"),
        REPO_ROOT: repoRoot,
        INSTALL_DIR: installDir,
        WORK_DIR: workDir,
      },
    });

    assert.match(result.stderr, /Chrome plugin not found; skipping Thorium Chrome plugin patch/);
    assert.equal(fs.existsSync(manifestPathsFile), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Thorium patcher accepts current browser preference routing without browser-client warnings", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-current-plugin-"));
  try {
    const chromePlugin = path.join(workspace, "chrome");
    const scriptsDir = path.join(chromePlugin, "scripts");
    writeFakeChromePlugin(chromePlugin);
    run("node", [path.join(repoRoot, "scripts", "lib", "patch-chrome-plugin.js"), chromePlugin]);
    fs.writeFileSync(
      path.join(scriptsDir, "browser-client.mjs"),
      'function qE(){return{extensionInstanceId:"instance",preferredWindowId:7}}var fp=class{constructor(e=null){this.browserPreference=e}browserPreference;async getForUrl(e){return e}preferredWindowIdFor(e){return this.browserPreference?.preferredWindowId}async get(e){return e}};\n',
    );
    const before = fs.readFileSync(path.join(scriptsDir, "browser-client.mjs"), "utf8");

    const result = run("node", [path.join(repoRoot, "port-integrations", "thorium-chrome-plugin", "patch-chrome-plugin.js"), chromePlugin]);

    const patched = fs.readFileSync(path.join(scriptsDir, "browser-client.mjs"), "utf8");
    assert.equal(patched, before);
    assert.doesNotMatch(result.stderr, /missing patch target/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
