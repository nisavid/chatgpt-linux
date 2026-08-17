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

function stageBrowserClient(sourcePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-browser-runtime-client-"));
  const clientPath = path.join(tempDir, "browser-client.mjs");
  const source = fs.readFileSync(sourcePath, "utf8");
  for (const marker of [
    "function chatgptLinuxBrowserUseConfigShim()",
    "function chatgptLinuxBrowserUseValidatedEnvironment(repl)",
    "function chatgptLinuxBrowserUseEnvironmentShim(repl)",
    "var chatgptLinuxBrowserUseProcessEnv=chatgptLinuxBrowserUseValidatedEnvironment(globalThis.nodeRepl),",
    "/*chatgptLinuxBrowserUseRuntimeEnv*/",
  ]) {
    assert.equal(
      source.split(marker).length - 1,
      1,
      `staged Browser client must contain exactly one verified marker: ${marker}`,
    );
  }
  assert.doesNotMatch(
    source,
    /import\{env as [A-Za-z_$][\w$]*\}from"node:process";/,
    "staged Browser client must not retain the original process environment import",
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
  return runNodeReplCode(runtime, code, {
    NODE_REPL_REQUEST_META: JSON.stringify({
      "chatgpt/browser-runtime-context": {
        version: 1,
        env: {
          BROWSER_USE_AVAILABLE_BACKENDS: "iab",
          BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
          BROWSER_USE_CODEX_APP_VERSION: "26.810.41047",
          CODEX_HOME: "/tmp/codex-home",
        },
      },
    }),
  });
}

test(
  "real node_repl transports the versioned Browser security context",
  { skip: !runtimePath },
  async () => {
    const context = {
      version: 1,
      env: {
        BROWSER_USE_AVAILABLE_BACKENDS: "iab",
        BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
        BROWSER_USE_CODEX_APP_VERSION: "26.803.41515",
        CODEX_HOME: "/tmp/codex-home",
      },
    };
    const output = await runNodeReplCode(
      runtimePath,
      'nodeRepl.write(JSON.stringify(nodeRepl.requestMeta?.["chatgpt/browser-runtime-context"]));',
      {
        NODE_REPL_REQUEST_META: JSON.stringify({
          "chatgpt/browser-runtime-context": context,
        }),
      },
    );

    assert.deepEqual(JSON.parse(output), context);
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
  "staged Browser client initializes through the real node_repl security context",
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
      const context = {
        version: 1,
        env: {
          BROWSER_USE_AVAILABLE_BACKENDS: "iab",
          BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
          BROWSER_USE_CODEX_APP_VERSION: "26.803.41515",
          CODEX_HOME: "/tmp/codex-home",
        },
      };
      const code =
        `const {setupBrowserRuntime}=await import(${JSON.stringify(pathToFileURL(clientPath).href)});` +
        'await setupBrowserRuntime();nodeRepl.write("setup-ok")';
      const output = await runNodeReplCode(runtimePath, code, {
        NODE_REPL_REQUEST_META: JSON.stringify({
          "chatgpt/browser-runtime-context": context,
        }),
      });

      assert.equal(output, "setup-ok");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
