#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "../..");
const bundledPlugins = path.join(repoRoot, "scripts/lib/bundled-plugins.sh");
const runtimeContextKey = "chatgpt/browser-runtime-context";

const browserClientFixture = String.raw`
import{env as Ub}from"node:process";
var Ur="BROWSER_USE_SECURITY_MODE",ws="BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED";
function Zp(e){let t=Object.freeze({createElicitation:e.createElicitation,env:e.env,securityMode:e.env[Ur],enabled:e.env[ws]==="1"});return t}
function Me(){let e=globalThis.nodeRepl;return e?.config==null?void 0:e}
async function cJ(t){let e=t.createElicitation.bind(t),r={...t,platform:"linux",setResponseMeta:t.setResponseMeta,get requestMeta(){return t.requestMeta},async createElicitation(o){return await e(o)}};return r}
export async function setupBrowserRuntime(){let e=Me();if(e==null)throw new Error("Browser use requires privileged node_repl capabilities");return Zp(await cJ(e))}
`;

function stageFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-browser-security-context-"));
  const clientPath = path.join(tempDir, "browser-client.mjs");
  fs.writeFileSync(clientPath, browserClientFixture);
  const result = spawnSync(
    "bash",
    [
      "-c",
      'set -euo pipefail; warn() { printf "%s\\n" "$*" >&2; }; info() { :; }; source "$BUNDLED_PLUGINS"; patch_browser_use_node_repl_config_shim "$CLIENT"; patch_browser_use_node_repl_process_env_import "$CLIENT"',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BUNDLED_PLUGINS: bundledPlugins,
        CLIENT: clientPath,
        SCRIPT_DIR: repoRoot,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { clientPath, tempDir };
}

function stageDriftedPlugin(pluginName, clientSource) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-browser-staging-drift-"));
  const sourcePlugin = path.join(tempDir, pluginName);
  const targetPlugins = path.join(tempDir, "staged");
  fs.mkdirSync(path.join(sourcePlugin, ".codex-plugin"), { recursive: true });
  fs.mkdirSync(path.join(sourcePlugin, "scripts"), { recursive: true });
  fs.mkdirSync(targetPlugins, { recursive: true });
  fs.writeFileSync(path.join(sourcePlugin, ".codex-plugin/plugin.json"), "{}\n");
  fs.writeFileSync(path.join(sourcePlugin, "scripts/browser-client.mjs"), clientSource);
  if (pluginName === "chrome") {
    fs.writeFileSync(path.join(sourcePlugin, "scripts/installManifest.mjs"), "export default {};\n");
  }
  const result = spawnSync(
    "bash",
    [
      "-c",
      "set -uo pipefail; warn() { printf \"%s\\n\" \"$*\" >&2; }; info() { :; }; source \"$BUNDLED_PLUGINS\"; patch_chrome_plugin_for_linux() { :; }; install_chrome_extension_host_resource() { :; }; if [ \"$PLUGIN_NAME\" = chrome ]; then stage_chrome_plugin_from_official_app \"$SOURCE_PLUGIN\" \"$TARGET_PLUGINS\"; else stage_browser_plugin_from_official_app \"$SOURCE_PLUGIN\" \"$TARGET_PLUGINS\"; fi",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BUNDLED_PLUGINS: bundledPlugins,
        SCRIPT_DIR: repoRoot,
        PLUGIN_NAME: pluginName,
        SOURCE_PLUGIN: sourcePlugin,
        TARGET_PLUGINS: targetPlugins,
      },
    },
  );
  const targetPlugin = path.join(targetPlugins, pluginName);
  const targetExists = fs.existsSync(targetPlugin);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { result, targetExists };
}

function stageDriftedBrowserPlugin(clientSource) {
  return stageDriftedPlugin("browser", clientSource);
}

function validRuntimeContext() {
  return {
    [runtimeContextKey]: {
      version: 1,
      env: {
        BROWSER_USE_AVAILABLE_BACKENDS: "iab",
        BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
        BROWSER_USE_CODEX_APP_VERSION: "26.803.41515",
        CODEX_HOME: "/tmp/codex-home",
      },
    },
  };
}

async function setupWithContext(
  context,
  preexistingEnv,
  prototypeEnvDescriptor,
  setupCount = 1,
) {
  const { clientPath, tempDir } = stageFixture();
  try {
    const prototype = {};
    if (prototypeEnvDescriptor != null) {
      Object.defineProperty(prototype, "env", prototypeEnvDescriptor);
    }
    globalThis.nodeRepl = Object.assign(Object.create(prototype), {
      config: {},
      createElicitation: async () => ({ action: "cancel" }),
      requestMeta: context,
      ...(preexistingEnv == null ? {} : { env: preexistingEnv }),
    });
    Object.preventExtensions(globalThis.nodeRepl);
    const clientUrl = `${pathToFileURL(clientPath).href}?case=${Date.now()}-${Math.random()}`;
    const client = await import(clientUrl);
    let runtime;
    for (let index = 0; index < setupCount; index += 1) {
      runtime = await client.setupBrowserRuntime();
    }
    return runtime;
  } finally {
    delete globalThis.nodeRepl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("Browser setup consumes the versioned host security context", async () => {
  const runtime = await setupWithContext(validRuntimeContext());

  assert.equal(runtime.securityMode, undefined);
  assert.equal(runtime.env.BROWSER_USE_AVAILABLE_BACKENDS, "iab");
  assert.equal(runtime.env.BROWSER_USE_CODEX_APP_BUILD_FLAVOR, "prod");
  assert.equal(runtime.env.CODEX_HOME, "/tmp/codex-home");
});

test("Browser setup keeps its own attached environment idempotent", async () => {
  const runtime = await setupWithContext(validRuntimeContext(), undefined, undefined, 2);

  assert.equal(runtime.env.CODEX_HOME, "/tmp/codex-home");
});

test("Browser setup rejects missing host security context intentionally", async () => {
  await assert.rejects(
    setupWithContext({}),
    /Browser security context is unavailable from ChatGPT/,
  );
});

test("Browser setup does not trust a model-created environment", async () => {
  await assert.rejects(
    setupWithContext({}, {
      BROWSER_USE_AVAILABLE_BACKENDS: "iab",
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "dev",
      BROWSER_USE_SECURITY_MODE: "disabled-for-local-testing",
    }),
    /Browser security context is unavailable from ChatGPT/,
  );
});

test("Browser setup rejects a matching model-created own environment", async () => {
  await assert.rejects(
    setupWithContext(validRuntimeContext(), validRuntimeContext()[runtimeContextKey].env),
    /cannot replace an untrusted Browser runtime environment/,
  );
});

test("Browser setup rejects a stateful model-created prototype environment", async () => {
  let reads = 0;
  const matchingEnv = validRuntimeContext()[runtimeContextKey].env;
  await assert.rejects(
    setupWithContext(validRuntimeContext(), undefined, {
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? matchingEnv : { BROWSER_USE_SECURITY_MODE: "disabled-for-local-testing" };
      },
    }),
    /cannot replace an untrusted Browser runtime environment/,
  );
  assert.equal(reads, 0, "must reject the descriptor without invoking model code");
});

test("Browser setup rejects an invalid host security mode", async () => {
  await assert.rejects(
    setupWithContext({
      [runtimeContextKey]: {
        version: 1,
        env: {
          BROWSER_USE_AVAILABLE_BACKENDS: "iab",
          BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
          BROWSER_USE_CODEX_APP_VERSION: "26.803.41515",
          BROWSER_USE_SECURITY_MODE: "allow-everything",
        },
      },
    }),
    /Browser security context contains an invalid security mode/,
  );
});

test("Browser staging rejects missing security-context shims", () => {
  const cases = [
    {
      source: 'import{env as Ub}from"node:process";function Drift(){return globalThis.nodeRepl}',
      warning: /Could not find Browser Use nodeRepl config shim insertion point/,
    },
    {
      source: 'import{env as Ub}from"node:process";function chatgptLinuxBrowserUseConfigShim(){}',
      warning: /already contains untrusted Browser security-context markers/,
    },
    {
      source: 'import{env as Ub}from"node:process";var chatgptLinuxBrowserUseProcessEnv=globalThis.nodeRepl?.env??{},Ub=chatgptLinuxBrowserUseProcessEnv;function chatgptLinuxBrowserUseConfigShim(){}',
      warning: /already contains untrusted Browser security-context markers/,
    },
    {
      source: 'import{env as Ub}from"node:process";var chatgptLinuxBrowserUseProcessEnv=chatgptLinuxBrowserUseValidatedEnvironment(globalThis.nodeRepl),Ub=chatgptLinuxBrowserUseProcessEnv;function chatgptLinuxBrowserUseConfigShim(){}function chatgptLinuxBrowserUseValidatedEnvironment(repl){return{}}function chatgptLinuxBrowserUseEnvironmentShim(repl){}',
      warning: /already contains untrusted Browser security-context markers/,
    },
  ];

  for (const { source, warning } of cases) {
    const { result, targetExists } = stageDriftedBrowserPlugin(source);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, warning);
    assert.match(result.stderr, /Browser security-context staging failed closed/);
    assert.equal(targetExists, false);
  }
});

test("Browser and Chrome staging correlate direct and current exported-alias setup paths", () => {
  const exportedAliasFixture = String.raw`
import{env as Ub}from"node:process";
function QP(){let t=globalThis.nodeRepl;return t?.config==null?void 0:t}
async function cJ(t){let e=t.createElicitation.bind(t),r={...t,platform:"linux",setResponseMeta:t.setResponseMeta,get requestMeta(){return t.requestMeta},async createElicitation(o){return await e(o)}};return r}
async function I3e(t={}){let e=QP();if(e==null)throw new Error("Browser use requires privileged node_repl capabilities");let r=e,n=await cJ(r);return n}
export{I3e as setupBrowserRuntime};
`;

  for (const pluginName of ["browser", "chrome"]) {
    for (const source of [browserClientFixture, exportedAliasFixture]) {
      const { result, targetExists } = stageDriftedPlugin(pluginName, source);
      assert.equal(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
      assert.equal(targetExists, true);
    }
  }
});

test("Browser and Chrome staging reject non-executable, ambiguous, and partial security anchors", () => {
  const executableConfig = "function Me(){let e=globalThis.nodeRepl;return e?.config==null?void 0:e}";
  const executableRuntime = "async function cJ(t){let e=t.createElicitation.bind(t),r={...t,platform:\"linux\",setResponseMeta:t.setResponseMeta,get requestMeta(){return t.requestMeta},async createElicitation(o){return await e(o)}};return r}";
  const processImport = 'import{env as Ub}from"node:process";';
  const disconnectedExecutableDecoys =
    `${processImport}${executableConfig}${executableRuntime}` +
    "function RealConfig(){return globalThis.nodeRepl}" +
    "async function RealRuntime(t){return{...t}}" +
    "export async function setupBrowserRuntime(){let e=RealConfig();return RealRuntime(e)}";
  const wrongDirectExportDecoys =
    `${processImport}${executableConfig}${executableRuntime}` +
    "export async function decoy(){let e=Me();return await cJ(e)}" +
    "function RealConfig(){return globalThis.nodeRepl}" +
    "async function RealRuntime(t){return{...t}}" +
    "export async function setupBrowserRuntime(){let e=RealConfig();return RealRuntime(e)}";
  const cases = [
    `${processImport}/*${executableConfig}*/${executableRuntime}`,
    `${processImport}const configDecoy=${JSON.stringify(executableConfig)};${executableRuntime}`,
    `${processImport}${executableConfig}/*${executableRuntime}*/`,
    `${processImport}${executableConfig}const runtimeDecoy=${JSON.stringify(executableRuntime)};`,
    `/*${processImport}*/${executableConfig}${executableRuntime}`,
    `const processDecoy=${JSON.stringify(processImport)};${executableConfig}${executableRuntime}`,
    `${processImport}${executableConfig}${executableConfig}${executableRuntime}`,
    `${processImport}${executableConfig}${executableRuntime}${executableRuntime}`,
    `${processImport}${executableConfig}${executableRuntime}function chatgptLinuxBrowserUseValidatedEnvironment(repl){return{}}`,
    `${processImport}${executableConfig}${executableRuntime.replace("platform:\"linux\"", "env:t.env,platform:\"linux\"")}`,
    `${processImport}${processImport}${executableConfig}${executableRuntime}`,
    disconnectedExecutableDecoys,
    wrongDirectExportDecoys,
  ];

  for (const pluginName of ["browser", "chrome"]) {
    for (const source of cases) {
      const { result, targetExists } = stageDriftedPlugin(pluginName, source);
      assert.notEqual(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /security-context staging failed closed/i);
      assert.equal(targetExists, false);
    }
  }
});
