#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const runtimePath = process.env.CODEX_NODE_REPL_PATH;
const pluginsRoot = process.env.CHATGPT_STAGED_BUNDLED_PLUGINS_ROOT;

function trustedBrowserRuntimeEnvironment() {
  assert.ok(runtimePath, "CODEX_NODE_REPL_PATH is required");
  assert.ok(pluginsRoot, "CHATGPT_STAGED_BUNDLED_PLUGINS_ROOT is required");
  const resourcesRoot = path.resolve(pluginsRoot, "../../..");
  const browserRoot = path.join(pluginsRoot, "browser");
  const browserService = path.join(browserRoot, "scripts", "browser-service.mjs");
  const nodePath = path.join(resourcesRoot, "node-runtime", "bin", "node");
  assert.ok(fs.existsSync(browserService), `Browser service not found: ${browserService}`);
  assert.ok(fs.existsSync(nodePath), `managed Node runtime not found: ${nodePath}`);
  return {
    BROWSER_USE_AVAILABLE_BACKENDS: "iab",
    BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
    BROWSER_USE_CODEX_APP_VERSION: "26.814.41407",
    NODE_REPL_NODE_MODULE_DIRS: browserRoot,
    NODE_REPL_NODE_PATH: nodePath,
    NODE_REPL_TRUSTED_CODE_PATHS: browserRoot,
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: browserService }),
  };
}

function stageBrowserClient(sourcePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-browser-runtime-client-"));
  const clientPath = path.join(tempDir, "browser-client.mjs");
  const source = fs.readFileSync(sourcePath, "utf8");
  for (const contract of [
    /globalThis\.nodeRepl/u,
    /typeof [A-Za-z_$][\w$]*\.rpc!="function"/u,
    /[A-Za-z_$][\w$]*\("browser",\{method:"setup",params:[A-Za-z_$][\w$]*\}\)/u,
    /[A-Za-z_$][\w$]*\("browser",\{method:"execute",params:[A-Za-z_$][\w$]*\}\)/u,
    /export\{[A-Za-z_$][\w$]* as setupBrowserRuntime\};/u,
  ]) {
    assert.equal(source.match(new RegExp(contract.source, contract.flags + "g"))?.length, 1);
  }
  assert.doesNotMatch(
    source,
    /chatgptLinuxBrowserUse|node:process/u,
    "staged Browser client must not contain legacy environment shims",
  );
  fs.copyFileSync(sourcePath, clientPath);
  return { clientPath, tempDir };
}

function runNodeReplCode(runtime, code, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, [], {
      env: {
        ...process.env,
        CODEX_BROWSER_USE_SOCKET_DIR: "/tmp/codex-browser-use-runtime-test",
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = readline.createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.close();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(
      () => finish(new Error(`node_repl import timed out: ${stderr}`)),
      20_000,
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (codeValue, signal) => {
      if (!settled) {
        finish(
          new Error(
            `node_repl exited before the import response (code=${codeValue}, signal=${signal}): ${stderr}`,
          ),
        );
      }
    });
    stdout.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "js",
            arguments: {
              code,
              timeout_ms: 10_000,
              title: "Import staged Browser clients",
            },
          },
        });
      }

      if (message.id === 2) {
        const text = message.result?.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("");
        if (message.result?.isError) {
          finish(new Error(`node_repl import failed: ${text || stderr}`));
        } else {
          finish(null, text);
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-browser-client-runtime-test", version: "1" },
      },
    });
  });
}

function runNodeReplImport(runtime, clients) {
  const code = `${clients
    .map((client) => `await import(${JSON.stringify(pathToFileURL(client).href)});`)
    .join("")}nodeRepl.write("imports-ok")`;
  return runNodeReplCode(runtime, code, trustedBrowserRuntimeEnvironment());
}

test(
  "real node_repl keeps the trusted Browser environment out of untrusted code",
  { skip: !runtimePath || !pluginsRoot },
  async () => {
    const output = await runNodeReplCode(
      runtimePath,
      'let blocked=!1;try{await import("node:process")}catch{blocked=!0}nodeRepl.write(JSON.stringify({blocked,env:nodeRepl.env.BROWSER_USE_CODEX_APP_BUILD_FLAVOR??null,rpc:typeof nodeRepl.rpc}));',
      trustedBrowserRuntimeEnvironment(),
    );

    assert.deepEqual(JSON.parse(output), { blocked: true, env: null, rpc: "function" });
  },
);

test(
  "staged Browser and Chrome clients import through the real node_repl runtime",
  { skip: !runtimePath || !pluginsRoot },
  async () => {
    const sources = ["browser", "chrome"].map((plugin) =>
      path.join(pluginsRoot, plugin, "scripts", "browser-client.mjs"),
    );
    assert.ok(fs.existsSync(runtimePath), `node_repl runtime not found: ${runtimePath}`);
    for (const source of sources) {
      assert.ok(fs.existsSync(source), `Browser client not found: ${source}`);
    }
    const stagedClients = sources.map(stageBrowserClient);

    try {
      assert.equal(
        await runNodeReplImport(
          runtimePath,
          stagedClients.map(({ clientPath }) => clientPath),
        ),
        "imports-ok",
      );
    } finally {
      for (const { tempDir } of stagedClients) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
);

test(
  "staged Browser client initializes through the real trusted node_repl service",
  { skip: !runtimePath || !pluginsRoot },
  async () => {
    const sourcePath = path.join(
      pluginsRoot,
      "browser",
      "scripts",
      "browser-client.mjs",
    );
    assert.ok(fs.existsSync(sourcePath), `Browser client not found: ${sourcePath}`);
    const { clientPath, tempDir } = stageBrowserClient(sourcePath);
    try {
      const code =
        `const {setupBrowserRuntime}=await import(${JSON.stringify(pathToFileURL(clientPath).href)});` +
        'await setupBrowserRuntime();nodeRepl.write("setup-ok")';
      const output = await runNodeReplCode(
        runtimePath,
        code,
        trustedBrowserRuntimeEnvironment(),
      );

      assert.equal(output, "setup-ok");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
