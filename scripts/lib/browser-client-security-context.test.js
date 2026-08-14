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
      'set -euo pipefail; warn() { printf "%s\\n" "$*" >&2; }; info() { :; }; source "$BUNDLED_PLUGINS"; patch_browser_use_node_repl_process_env_import "$CLIENT"; patch_browser_use_node_repl_config_shim "$CLIENT"',
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

async function setupWithContext(context, preexistingEnv) {
  const { clientPath, tempDir } = stageFixture();
  try {
    const prototype = {};
    globalThis.nodeRepl = Object.assign(Object.create(prototype), {
      config: {},
      createElicitation: async () => ({ action: "cancel" }),
      requestMeta: context,
      ...(preexistingEnv == null ? {} : { env: preexistingEnv }),
    });
    Object.preventExtensions(globalThis.nodeRepl);
    const clientUrl = `${pathToFileURL(clientPath).href}?case=${Date.now()}-${Math.random()}`;
    return await (await import(clientUrl)).setupBrowserRuntime();
  } finally {
    delete globalThis.nodeRepl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("Browser setup consumes the versioned host security context", async () => {
  const runtime = await setupWithContext({
    [runtimeContextKey]: {
      version: 1,
      env: {
        BROWSER_USE_AVAILABLE_BACKENDS: "iab",
        BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
        BROWSER_USE_CODEX_APP_VERSION: "26.803.41515",
      },
    },
  });

  assert.equal(runtime.securityMode, undefined);
  assert.equal(runtime.env.BROWSER_USE_AVAILABLE_BACKENDS, "iab");
  assert.equal(runtime.env.BROWSER_USE_CODEX_APP_BUILD_FLAVOR, "prod");
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
