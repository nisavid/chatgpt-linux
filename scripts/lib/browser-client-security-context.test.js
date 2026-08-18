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

const trustedRpcBrowserClientFixture = String.raw`
function pc({apiManifest:t,disabledMemberIds:e,displayBridge:o,executeAgentCommand:a}){return{apiManifest:t,disabledMemberIds:e,displayBridge:o,executeAgentCommand:a}}
const Wu=async t=>{let e=globalThis.display;if(typeof e=="function"){await e(t);return}console.log(t)};
async function $x(t={}){let e=globalThis.nodeRepl;if(e==null||typeof e.rpc!="function")throw new Error("Browser use requires a trusted Node REPL browser service");let o=e.rpc,a={setup:c=>o("browser",{method:"setup",params:c}),execute:c=>o("browser",{method:"execute",params:c})},{apiManifest:n,disabledMemberIds:s}=await a.setup(t.environment??"codex-app");return pc({apiManifest:n,disabledMemberIds:new Set(s),displayBridge:{displayImage:c=>e.emitImage(c),displayValue:c=>console.log(c)},executeAgentCommand:a.execute})}export{$x as setupBrowserRuntime};
`;

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
  const stagedClientPath = path.join(targetPlugin, "scripts/browser-client.mjs");
  const stagedClientSource = fs.existsSync(stagedClientPath)
    ? fs.readFileSync(stagedClientPath, "utf8")
    : null;
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { result, stagedClientSource, targetExists };
}

test("Browser and Chrome stage the current trusted RPC client without environment rewrites", () => {
  for (const pluginName of ["browser", "chrome"]) {
    const { result, stagedClientSource, targetExists } = stageDriftedPlugin(
      pluginName,
      trustedRpcBrowserClientFixture,
    );
    assert.equal(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
    assert.equal(targetExists, true);
    assert.equal(stagedClientSource, trustedRpcBrowserClientFixture);
    assert.doesNotMatch(stagedClientSource, /chatgptLinuxBrowserUse|node:process/);
  }
});

test("Browser and Chrome staged clients use only the trusted browser RPC service", async () => {
  for (const pluginName of ["browser", "chrome"]) {
    const { result, stagedClientSource } = stageDriftedPlugin(
      pluginName,
      trustedRpcBrowserClientFixture,
    );
    assert.equal(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-browser-trusted-rpc-"));
    const clientPath = path.join(tempDir, "browser-client.mjs");
    const calls = [];
    try {
      fs.writeFileSync(clientPath, stagedClientSource);
      globalThis.nodeRepl = Object.freeze({
        emitImage: () => undefined,
        rpc: async (service, request) => {
          calls.push({ request, service });
          return request.method === "setup"
            ? { apiManifest: { interfaces: {} }, disabledMemberIds: ["Tab.close"] }
            : { ok: true };
        },
      });
      const client = await import(`${pathToFileURL(clientPath).href}?plugin=${pluginName}`);
      const runtime = await client.setupBrowserRuntime({ environment: "training" });
      await runtime.executeAgentCommand({ command: "list" });
      assert.deepEqual(calls, [
        { service: "browser", request: { method: "setup", params: "training" } },
        { service: "browser", request: { method: "execute", params: { command: "list" } } },
      ]);
      assert.deepEqual([...runtime.disabledMemberIds], ["Tab.close"]);
    } finally {
      delete globalThis.nodeRepl;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("Browser and Chrome staging reject malformed final client syntax", () => {
  const source = `${trustedRpcBrowserClientFixture}\nconst broken="`;

  for (const pluginName of ["browser", "chrome"]) {
    const { result, targetExists } = stageDriftedPlugin(pluginName, source);
    assert.notEqual(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, /Browser client syntax validation failed/);
    assert.match(result.stderr, /staging failed closed/i);
    assert.equal(targetExists, false);
  }
});

test("Browser and Chrome staging reject executable ambient Node access", () => {
  const privilegedClients = [
    `const Ub=globalThis["process"].env;${trustedRpcBrowserClientFixture}`,
    `const Ub=global["process"].env;${trustedRpcBrowserClientFixture}`,
    `const Ub=Reflect.get(globalThis,"process").env;${trustedRpcBrowserClientFixture}`,
    `const Ub=Function("return process")().env;${trustedRpcBrowserClientFixture}`,
    `const Ub=eval("process.env");${trustedRpcBrowserClientFixture}`,
    `import{env as Ub}from"node:process";${trustedRpcBrowserClientFixture}`,
    `import/* comment */("node:process");${trustedRpcBrowserClientFixture}`,
    `import"node:fs";${trustedRpcBrowserClientFixture}`,
    `export/* comment */{env}from"node:process";${trustedRpcBrowserClientFixture}`,
    `const Ub=await import("node:process");${trustedRpcBrowserClientFixture}`,
    `const Ub=require("node:process");${trustedRpcBrowserClientFixture}`,
    `const Ub=module.require("node:process");${trustedRpcBrowserClientFixture}`,
    `const Ub=process.env;${trustedRpcBrowserClientFixture}`,
    `const Ub=globalThis.process.env;${trustedRpcBrowserClientFixture}`,
  ];
  const dynamicBypasses = [
    `const Ub=(()=>{}).constructor("return process")().env;${trustedRpcBrowserClientFixture}`,
    `const Ub=pro\\u0063ess.env;${trustedRpcBrowserClientFixture}`,
  ];
  const inertDrift = [
    trustedRpcBrowserClientFixture.replaceAll("\n", "\r\n"),
    `/* import{env as Ub}from"node:process"; */${trustedRpcBrowserClientFixture}`,
    `const decoy='import{env as Ub}from"node:process";';${trustedRpcBrowserClientFixture}`,
    `const decoy=\`import{env as Ub}from"node:process";\`;${trustedRpcBrowserClientFixture}`,
    `const decoy='process.env module.require("node:process")';${trustedRpcBrowserClientFixture}`,
  ];

  for (const pluginName of ["browser", "chrome"]) {
    for (const source of privilegedClients) {
      const { result, targetExists } = stageDriftedPlugin(pluginName, source);
      assert.notEqual(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /privileged Node access/);
      assert.match(result.stderr, /security-context staging failed closed/i);
      assert.equal(targetExists, false);
    }
    for (const source of dynamicBypasses) {
      const { result, targetExists } = stageDriftedPlugin(pluginName, source);
      assert.notEqual(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /unexpected current trusted digest/);
      assert.match(result.stderr, /security-context staging failed closed/i);
      assert.equal(targetExists, false);
    }
    for (const source of inertDrift) {
      const { result, targetExists } = stageDriftedPlugin(pluginName, source);
      assert.notEqual(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
      assert.doesNotMatch(result.stderr, /privileged Node access/);
      assert.match(result.stderr, /unexpected current trusted digest/);
      assert.match(result.stderr, /security-context staging failed closed/i);
      assert.equal(targetExists, false);
    }
  }
});

test("Browser and Chrome staging reject non-executable trusted RPC decoys", () => {
  const decoys = [
    `/*${trustedRpcBrowserClientFixture}*/`,
    `const decoy=${JSON.stringify(trustedRpcBrowserClientFixture)};`,
    `const decoy=\`outer \${\`${trustedRpcBrowserClientFixture}\`} tail\`;`,
    `const decoy=/${trustedRpcBrowserClientFixture.replaceAll("\n", "").replaceAll("/", "\\/")}/;`,
    `#!${trustedRpcBrowserClientFixture.replaceAll("\n", "")}\n`,
  ];

  for (const pluginName of ["browser", "chrome"]) {
    for (const source of decoys) {
      const { result, targetExists } = stageDriftedPlugin(pluginName, source);
      assert.notEqual(result.status, 0, `${pluginName}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /trusted RPC setup contract/);
      assert.match(result.stderr, /security-context staging failed closed/i);
      assert.equal(targetExists, false);
    }
  }
});

test("Browser and Chrome staging reject partial, disconnected, ambiguous, and legacy contracts", () => {
  const disconnected = trustedRpcBrowserClientFixture.replace(
    "export{$x as setupBrowserRuntime};",
    "async function real(){}export{real as setupBrowserRuntime};",
  );
  const renamed = trustedRpcBrowserClientFixture
    .replaceAll("$x", "I3e")
    .replace("function pc", "function qc")
    .replace("return pc", "return qc");
  const cases = [
    trustedRpcBrowserClientFixture.replace('o("browser",{method:"setup"', 'o("other",{method:"setup"'),
    disconnected,
    `${trustedRpcBrowserClientFixture}${renamed}`,
    `${trustedRpcBrowserClientFixture}function chatgptLinuxBrowserUseConfigShim(){}`,
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

test("Browser and Chrome clients do not accept model-created environment state without trusted RPC", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-browser-untrusted-env-"));
  const clientPath = path.join(tempDir, "browser-client.mjs");
  try {
    fs.writeFileSync(clientPath, trustedRpcBrowserClientFixture);
    globalThis.nodeRepl = {
      env: {
        BROWSER_USE_AVAILABLE_BACKENDS: "iab",
        BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "dev",
        BROWSER_USE_SECURITY_MODE: "disabled-for-local-testing",
      },
    };
    const client = await import(`${pathToFileURL(clientPath).href}?untrusted-env`);
    await assert.rejects(
      client.setupBrowserRuntime(),
      /Browser use requires a trusted Node REPL browser service/,
    );
  } finally {
    delete globalThis.nodeRepl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
