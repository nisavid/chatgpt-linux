"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const {
  enabledPortIntegrationStageHooks,
  loadPortIntegrationPatchDescriptors,
} = require("../../scripts/lib/port-integrations.js");
const {
  applyLinuxReadAloudPluginGatePatch,
} = require("./patches.js");

function resolveExecutable(name) {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH entries.
    }
  }
  throw new Error(`${name} not found in PATH`);
}

function applyPatchTwice(patchFn, source) {
  const patched = patchFn(source);
  assert.equal(patchFn(patched), patched);
  return patched;
}

test("read-aloud-mcp stages by default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-aloud-mcp-integration-"));
  const integrationsRoot = path.join(tempDir, "integrations");
  try {
    fs.mkdirSync(path.join(integrationsRoot, "read-aloud-mcp"), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, "integration.json"),
      path.join(integrationsRoot, "read-aloud-mcp", "integration.json"),
    );
    fs.copyFileSync(
      path.join(__dirname, "README.md"),
      path.join(integrationsRoot, "read-aloud-mcp", "README.md"),
    );
    fs.copyFileSync(
      path.join(__dirname, "stage.sh"),
      path.join(integrationsRoot, "read-aloud-mcp", "stage.sh"),
    );
    fs.copyFileSync(
      path.join(__dirname, "patches.js"),
      path.join(integrationsRoot, "read-aloud-mcp", "patches.js"),
    );
    const patchHelperDir = path.join(tempDir, "scripts/patches/lib");
    fs.mkdirSync(patchHelperDir, { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, "scripts/patches/lib/minified-js.js"),
      path.join(patchHelperDir, "minified-js.js"),
    );
    fs.writeFileSync(path.join(integrationsRoot, "integrations.example.json"), '{"enabled":[]}\n');

    assert.equal(enabledPortIntegrationStageHooks({ integrationsRoot }).length, 1);
    assert.equal(loadPortIntegrationPatchDescriptors({ integrationsRoot }).length, 1);

    fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"disabled":["read-aloud-mcp"]}\n');
    assert.deepEqual(enabledPortIntegrationStageHooks({ integrationsRoot }), []);
    assert.deepEqual(loadPortIntegrationPatchDescriptors({ integrationsRoot }), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("read-aloud-mcp plugin gate adds a default Linux bundled plugin to the current descriptor array", () => {
  const source = [
    "var gc=[{...n.Ds.codexAppTools,isAvailable:()=>!0},{...n.Ds.sites,isAvailable:({features:e})=>e.sites},{...n.Ds.browser,isAvailable:({features:e})=>e.inAppBrowserUseAllowed},{...n.Ds.chromeDev,isAvailable:({features:e})=>e.chromeDev},{...n.Ds.chromeInternal,isAvailable:({features:e})=>e.chromeInternal},{...n.Ds.chrome,isAvailable:({features:e})=>e.chrome},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...n.Ds.messages,isAvailable:({features:e})=>e.messages},{...n.Ds.latex,isAvailable:()=>!0},{...n.Ds.visualize,isAvailable:()=>!0}];",
  ].join("");

  const patched = applyPatchTwice(applyLinuxReadAloudPluginGatePatch, source);

  assert.match(
    patched,
    /\{installWhenMissing:!0,name:`read-aloud`,isAvailable:\(\{platform:e\}\)=>e===`linux`\},\{\.\.\.n\.Ds\.latex,isAvailable:\(\)=>!0\}/,
  );
});

test("read-aloud-mcp plugin gate ignores a read-aloud name decoy in the current descriptor array", () => {
  const source = [
    "var ra=`read-aloud`;",
    "var gc=[{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{name:ra,isAvailable:()=>!1},{...n.Ds.latex,isAvailable:()=>!0}];",
  ].join("");

  const patched = applyPatchTwice(applyLinuxReadAloudPluginGatePatch, source);

  assert.match(
    patched,
    /\{installWhenMissing:!0,name:`read-aloud`,isAvailable:\(\{platform:e\}\)=>e===`linux`\},\{\.\.\.n\.Ds\.latex,isAvailable:\(\)=>!0\}/,
  );
});

test("read-aloud-mcp plugin gate resolves the descriptor array past an earlier inner bracket", () => {
  const source =
    "var gc=[{name:`earlier`,values:[1,2]},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...n.Ds.latex,isAvailable:()=>!0}];";

  const patched = applyPatchTwice(applyLinuxReadAloudPluginGatePatch, source);
  assert.match(
    patched,
    /values:\[1,2\].*\{installWhenMissing:!0,name:`read-aloud`,isAvailable:\(\{platform:e\}\)=>e===`linux`\},\{\.\.\.n\.Ds\.latex/u,
  );
});

test("read-aloud-mcp plugin gate ignores quoted and commented current descriptor arrays", () => {
  const descriptorArray =
    "var gc=[{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...n.Ds.latex,isAvailable:()=>!0}];";
  const quoted = `const decoy=${JSON.stringify(descriptorArray)};`;
  const commented = `/*${descriptorArray}*/`;

  assert.equal(applyLinuxReadAloudPluginGatePatch(quoted), quoted);
  assert.equal(applyLinuxReadAloudPluginGatePatch(commented), commented);
});

test("read-aloud-mcp plugin gate rejects quoted and commented latex descriptor decoys", () => {
  const prefix =
    "var gc=[{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},";
  const quoted = `${prefix}\"{...n.Ds.latex,isAvailable:()=>!0}\"];`;
  const commented = `${prefix}/*{...n.Ds.latex,isAvailable:()=>!0}*/];`;

  assert.throws(
    () => applyLinuxReadAloudPluginGatePatch(quoted),
    /could not find bundled plugin descriptor array/,
  );
  assert.throws(
    () => applyLinuxReadAloudPluginGatePatch(commented),
    /could not find bundled plugin descriptor array/,
  );
});

test("read-aloud-mcp plugin gate fails closed without both current platform descriptors", () => {
  const source = [
    "var gc=[{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse},{...n.Ds.latex,isAvailable:()=>!0}];",
  ].join("");

  assert.throws(
    () => applyLinuxReadAloudPluginGatePatch(source),
    /could not find bundled plugin descriptor array/,
  );
});

test("read-aloud-mcp plugin gate rejects the obsolete inline isEnabled shape", () => {
  const source = [
    "var browser=`browser-use`,computer=`computer-use`,latex=`latex-tectonic`;",
    "var plugins=[{installWhenMissing:!0,name:browser,isEnabled:({features:e})=>e.browserAgentAvailable},{name:computer,isEnabled:({features:e,platform:t})=>t===`darwin`&&e.computerUse},{name:latex,isEnabled:()=>!0}];",
  ].join("");

  assert.throws(
    () => applyLinuxReadAloudPluginGatePatch(source),
    /could not find bundled plugin descriptor array/,
  );
});

test("read-aloud-mcp plugin gate rejects ambiguous current descriptor arrays", () => {
  const source = [
    "var gc=[{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...n.Ds.latex,isAvailable:()=>!0}];",
    "var hc=[{...r.Ks.computerUse,autoInstallOptOutKey:r.As(r.Ks.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Js},{...r.Ks.computerUse,autoInstallOptOutKey:r.As(r.Ks.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...r.Ks.latex,isAvailable:()=>!0}];",
  ].join("");

  assert.throws(
    () => applyLinuxReadAloudPluginGatePatch(source),
    /bundled plugin descriptor array is ambiguous/,
  );
});

test("read-aloud-mcp plugin gate rejects an ambiguous current descriptor within one array", () => {
  const source =
    "var gc=[{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`darwin`&&e.computerUse,migrate:Hs},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...n.Ds.computerUse,autoInstallOptOutKey:n.As(n.Ds.computerUse.name),isAvailable:({features:e,platform:t})=>t===`win32`&&e.computerUse},{...n.Ds.latex,isAvailable:()=>!0}];";

  assert.throws(
    () => applyLinuxReadAloudPluginGatePatch(source),
    /could not find bundled plugin descriptor array/,
  );
});

test("read-aloud-mcp stage hook records marketplace entry", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "read-aloud-mcp-stage-"));
  const installDir = path.join(workspace, "install");
  const fakeBackend = path.join(workspace, "chatgpt-read-aloud-linux");
  const marketplace = path.join(
    installDir,
    "resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
  );

  fs.mkdirSync(path.dirname(marketplace), { recursive: true });
  fs.writeFileSync(
    marketplace,
    JSON.stringify({
      plugins: [
        {
          name: "browser-use",
          source: { source: "local", path: "./plugins/browser-use" },
          policy: { installation: "AVAILABLE" },
        },
      ],
    }),
  );
  fs.writeFileSync(fakeBackend, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(fakeBackend, 0o755);

  execFileSync("bash", [path.join(__dirname, "stage.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SCRIPT_DIR: repoRoot,
      INSTALL_DIR: installDir,
      WORK_DIR: path.join(workspace, "work"),
      ARCH: process.arch === "arm64" ? "aarch64" : "x86_64",
      CHATGPT_OFFICIAL_APP_DIR: path.join(workspace, "ChatGPT.app"),
      CHATGPT_LINUX_READ_ALOUD_MCP_SOURCE: fakeBackend,
      ICON_SOURCE: path.join(workspace, "missing-icon.png"),
    },
    stdio: "pipe",
  });

  const pluginDir = path.join(
    installDir,
    "resources/plugins/openai-bundled/plugins/read-aloud",
  );
  assert.equal(fs.existsSync(path.join(pluginDir, ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(pluginDir, "bin/chatgpt-read-aloud-linux")), true);
  assert.equal(fs.existsSync(path.join(pluginDir, "bin/kokoro-stdin")), true);

  const parsedMarketplace = JSON.parse(fs.readFileSync(marketplace, "utf8"));
  assert.equal(
    parsedMarketplace.plugins.some(
      (plugin) =>
        plugin.name === "read-aloud" &&
        plugin.source?.path === "./plugins/read-aloud" &&
        plugin.policy?.authentication === "ON_INSTALL",
    ),
    true,
  );
});

test("read-aloud-mcp stage hook skips cleanly when backend is unavailable", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "read-aloud-mcp-stage-skip-"));
  const installDir = path.join(workspace, "install");
  try {
    fs.mkdirSync(installDir, { recursive: true });

    const result = spawnSync(resolveExecutable("bash"), [path.join(__dirname, "stage.sh")], {
      cwd: repoRoot,
      env: {
        SCRIPT_DIR: repoRoot,
        INSTALL_DIR: installDir,
        WORK_DIR: path.join(workspace, "work"),
        ARCH: process.arch === "arm64" ? "aarch64" : "x86_64",
        CHATGPT_OFFICIAL_APP_DIR: path.join(workspace, "ChatGPT.app"),
        PATH: path.join(workspace, "bin"),
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /cargo not found; Read Aloud MCP plugin will be unavailable/);
    assert.match(result.stderr, /Read Aloud MCP plugin skipped; backend is unavailable/);
    assert.equal(
      fs.existsSync(path.join(installDir, "resources/plugins/openai-bundled/plugins/read-aloud")),
      false,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
