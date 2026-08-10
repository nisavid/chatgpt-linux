#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  loadPortIntegrationPatchDescriptors,
} = require("../../scripts/lib/port-integrations.js");
const {
  applyMainBundlePatchDescriptors,
  applyWebviewAssetPatchDescriptors,
} = require("../../scripts/patches/engine.js");
const {
  openGeneratedAppMutationRoot,
} = require("../../scripts/patches/lib/generated-app-mutation-client.js");
const {
  createPatchReport,
} = require("../../scripts/lib/patch-report.js");
const {
  MAX_WRAPPER_ARGS,
  applyMainBundlePatch,
  applyWebviewPatch,
  descriptors,
  formatCommandWrapper,
  parseCommandWrapper,
  validateCommandWrapperArgs,
  wrapRemoteCommand,
} = require("./patch.js");

const managementCall = "n.Fn({args:[`ssh`,...jC(c),...NC(this.options.sshConnection),mC(e,s)],spawnInsideWsl:!1})";
const proxyCall = "(0,x.spawn)(n.Vn.resolve(`ssh`)??`ssh`,[`-T`,...jC(this.options.getConnectTimeoutSeconds?.()),...NC(this.options.sshConnection),mC(r,a)],{env:i.t(process.env),stdio:[`pipe`,`pipe`,`pipe`]})";

const mainFixture = [
  "const existingArraySchema=n.Qc(n.ul())",
  "function mC(e,t){return e+t}",
  `function management(){let u=${managementCall};return u}`,
  `function proxy(){let a=${proxyCall};return a}`,
  "function uS(e){let t=Hre(e);return t?{sshConnection:{alias:t.sshAlias,host:t.sshHost,port:t.sshPort,identity:t.identity}}:null}",
  "function woe(e){let t=e.alias?.trim();return t?`alias:${t}`:[`direct`,e.host,String(e.port??``),e.identity?.trim()??``].join(`:",
  "aliasLoad.then(t=>t==null?null:{...t,hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,autoConnect:!1})",
  "let direct=[{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`codex-managed`,autoConnect:!1,sshAlias:null,sshHost:e.hostname,sshPort:e.sshPort,identity:e.identity}]),...t.filter",
  "let current=e.alias==null?{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`codex-managed`,alias:null,hostname:e.hostname,sshPort:e.sshPort,identity:e.identity}:{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`discovered`,alias:e.alias,hostname:null,sshPort:null,identity:null}",
  "let legacy=n==null?{hostId:t.hostId,connectionAnalyticsId:t.connectionAnalyticsId,displayName:t.displayName,source:`codex-managed`,alias:null,hostname:t.sshHost,sshPort:t.sshPort,identity:t.identity}:{hostId:t.hostId,connectionAnalyticsId:t.connectionAnalyticsId,displayName:t.displayName,source:`discovered`,alias:n,hostname:null,sshPort:null,identity:null}",
  "let host={[FS]:{sshAlias:e.sshAlias??null,sshHost:e.sshHost,sshPort:e.sshPort,identity:e.identity}};return e.homeDir",
  "var ape=n.ol({sshAlias:n.ul().nullable(),sshHost:n.ul(),sshPort:n.al().nullable(),identity:n.ul().nullable()});",
  "let config={sshPort:e.sshPort,identity:e.identity,codexCliCommand:[]}",
].join(";");

const webviewFixture = [
  "function Mi(){return{displayName:``,targetKind:`hostname`,sshHost:``,sshPort:``,authMode:`none`,identity:``}}",
  "function Ni(e){return{displayName:e.displayName,targetKind:e.sshAlias?.trim()?`alias`:`hostname`,sshHost:e.sshAlias?.trim()||e.sshHost,sshPort:e.sshPort==null?``:String(e.sshPort),authMode:e.identity==null?`none`:`identity`,identity:e.identity??``}}",
  "function Pi(e,{connectionAnalyticsId:t}={}){let n=e.displayName.trim(),r=e.sshHost.trim(),i=e.targetKind===`alias`?r:null;return i==null?{hostId:tn(n),connectionAnalyticsId:t,displayName:n,source:`codex-managed`,alias:null,hostname:r,sshPort:Ii(e.sshPort),identity:e.authMode===`identity`?e.identity.trim():null}:{hostId:It(i),connectionAnalyticsId:t,displayName:n,source:`discovered`,alias:i,hostname:null,sshPort:null,identity:null}}",
  "function Fi({draft:e,editingHostId:t,existingConnections:n}){let r=[],i=e.displayName.trim();i.length===0&&r.push(`displayNameRequired`);return r}",
  "function Ri(e){let v,q,G,Hi,u,k,ee,te,j;j=(0,q.jsx)(x,{children:(0,q.jsxs)(`div`,{children:[k,ee,te]})});return j}",
  "function Ui(e){switch(e){case`displayNameRequired`:return null}}",
].join("");

function withCapturedWarnings(callback) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return { value: callback(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function withCapturedWarningsAsync(callback) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return { value: await callback(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

function integrationSelection(integrationsRoot, enabled) {
  const disabled = fs.readdirSync(integrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(integrationsRoot, entry.name, "integration.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(fs.readFileSync(manifestPath, "utf8")).id)
    .filter((id) => !enabled.includes(id));
  return { enabled, disabled };
}

function withIntegrationConfig(enabled, callback) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-command-wrapper-integration-"));
  process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(tempDir, "integrations.json");
  fs.writeFileSync(process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG, `${JSON.stringify(integrationSelection(path.resolve(__dirname, ".."), enabled))}\n`);
  try {
    return callback(path.resolve(__dirname, ".."));
  } finally {
    if (originalConfig == null) delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    else process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function withIntegrationConfigAsync(enabled, callback) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-command-wrapper-integration-"));
  process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(tempDir, "integrations.json");
  fs.writeFileSync(process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG, `${JSON.stringify(integrationSelection(path.resolve(__dirname, ".."), enabled))}\n`);
  try {
    return await callback(path.resolve(__dirname, ".."));
  } finally {
    if (originalConfig == null) delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    else process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function applyWebviewAssetPatchDescriptorsWithMutation(
  root,
  descriptors,
  context,
  report,
) {
  fs.chmodSync(root, 0o700);
  const generatedAppMutation = await openGeneratedAppMutationRoot(root, {
    brokerPath: process.env.CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE,
    verifiedPrivateRoot: true,
  });
  try {
    return await applyWebviewAssetPatchDescriptors(
      root,
      descriptors,
      { ...context, generatedAppMutation },
      report,
    );
  } finally {
    await generatedAppMutation.close();
  }
}

test("parses argv text without invoking a shell", () => {
  assert.deepEqual(parseCommandWrapper("ssh -T target-host --"), ["ssh", "-T", "target-host", "--"]);
  assert.deepEqual(parseCommandWrapper("env 'NAME=hello world' command\\ name \"\""), [
    "env",
    "NAME=hello world",
    "command name",
    "",
  ]);
  assert.deepEqual(parseCommandWrapper('command "a\\q" "a\\$b"'), ["command", "a\\q", "a$b"]);
  assert.deepEqual(parseCommandWrapper(""), []);
  assert.deepEqual(parseCommandWrapper("   \t "), []);
});

test("rejects snippets and malformed or oversized argv", () => {
  for (const value of [
    "ssh target-host; echo unsafe",
    "ssh target-host | tee log",
    "ssh target-host\nwhoami",
    "ssh 'target-host",
    "ssh target-host\\",
    "'' -T target-host",
    `ssh ${"x".repeat(4096)}`,
  ]) {
    assert.throws(() => parseCommandWrapper(value), { code: "invalidSshCommandWrapper" });
  }
  assert.throws(
    () => parseCommandWrapper(Array.from({ length: MAX_WRAPPER_ARGS + 1 }, () => "x").join(" ")),
    { code: "invalidSshCommandWrapper" },
  );
});

test("round trips quoted argv and preserves an empty wrapper", () => {
  const args = ["ssh", "-T", "login node", "--", "apostrophe's", ""];
  assert.deepEqual(parseCommandWrapper(formatCommandWrapper(args)), args);
  assert.equal(wrapRemoteCommand("sh -c 'echo ok'", []), "sh -c 'echo ok'");
  assert.equal(
    wrapRemoteCommand("sh -c 'echo ok'", ["ssh", "-T", "target-host", "--"]),
    "exec ssh -T target-host -- 'sh -c '\\''echo ok'\\'''",
  );
});

test("keeps apostrophe-heavy wrappers within the canonical editor limit", () => {
  const atLimit = ["ssh", "'".repeat(1022), "x"];
  const formatted = formatCommandWrapper(atLimit);
  assert.equal(formatted.length, 4096);
  assert.deepEqual(parseCommandWrapper(formatted), atLimit);

  const overLimitInput = `ssh "${"'".repeat(1023)}"`;
  assert.throws(() => parseCommandWrapper(overLimitInput), { code: "invalidSshCommandWrapper" });
  assert.throws(() => validateCommandWrapperArgs(["ssh", "'".repeat(1023)]), {
    code: "invalidSshCommandWrapper",
  });
  assert.throws(() => formatCommandWrapper(["ssh", "'".repeat(1023)]), {
    code: "invalidSshCommandWrapper",
  });
});

test("validates persisted argv independently of the editor", () => {
  assert.deepEqual(validateCommandWrapperArgs(null), []);
  assert.deepEqual(validateCommandWrapperArgs(["ssh", "-T"]), ["ssh", "-T"]);
  assert.throws(() => validateCommandWrapperArgs("ssh -T"), { code: "invalidSshCommandWrapper" });
  assert.throws(() => validateCommandWrapperArgs(["ssh\nwhoami"]), {
    code: "invalidSshCommandWrapper",
  });
});

test("patches all main-process transport and persistence paths idempotently", () => {
  const patched = applyMainBundlePatch(mainFixture);
  assert.notEqual(patched, mainFixture);
  assert.equal(applyMainBundlePatch(patched), patched);
  assert.match(patched, /chatgptLinuxSshWrapRemoteCommand\(mC\(e,s\)/u);
  assert.match(patched, /chatgptLinuxSshWrapRemoteCommand\(mC\(r,a\)/u);
  assert.match(patched, /chatgptLinuxSshCommandWrapperArgs\(e\.chatgptLinuxSshCommandWrapper\)/u);
  assert.ok(patched.split("chatgptLinuxSshCommandWrapper").length > 10);
});

test("uses the current main-bundle array schema factory", () => {
  const currentBundleFixture = mainFixture;
  const patched = applyMainBundlePatch(currentBundleFixture);
  const schemaSource = /var ape=[^;]+;/u.exec(patched)?.[0];

  assert.ok(schemaSource, "patched SSH schema was not found");
  assert.match(schemaSource, /chatgptLinuxSshCommandWrapper:n\.Qc\(n\.ul\(\)\)\.optional\(\)/u);

  const scalarSchema = () => ({
    nullable() { return this; },
    optional() { return this; },
  });
  const namespace = {
    ol: (value) => value,
    ul: scalarSchema,
    al: scalarSchema,
    Qc: (value) => ({ optional: () => ({ element: value }) }),
  };
  assert.doesNotThrow(() => vm.runInNewContext(schemaSource + "ape", { n: namespace }));
});

test("main-process patch rejects a stale injected helper implementation", () => {
  const patched = applyMainBundlePatch(mainFixture);
  const stale = patched.replace("e.length>64", "e.length>63");
  assert.notEqual(stale, patched);

  const { value, warnings } = withCapturedWarnings(() => applyMainBundlePatch(stale));
  assert.equal(value, stale);
  assert.match(warnings.join("\n"), /helperSource=0/u);
});

test("main-process patch fails soft and byte-identical on drift", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    assert.equal(applyMainBundlePatch("function Gx(){}"), "function Gx(){}");
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.length > 0);
});

test("main-process patch rejects duplicate owned SSH targets", () => {
  const duplicateTarget = `${mainFixture};function duplicate(){return ${managementCall}}`;
  const { value, warnings } = withCapturedWarnings(() => applyMainBundlePatch(duplicateTarget));
  assert.equal(value, duplicateTarget);
  assert.match(warnings.join("\n"), /partial, ambiguous, or drifted/u);
});

test("main-process helper-only partial state is reported as integration drift", () => {
  const partial = mainFixture.replace(
    "function mC(",
    "function chatgptLinuxSshCommandWrapperArgs(e){}function mC(",
  );
  withIntegrationConfig(["ssh-command-wrapper"], (integrationsRoot) => {
    const descriptor = loadPortIntegrationPatchDescriptors({ integrationsRoot })
      .find((item) => item.id === "integration:ssh-command-wrapper:main-bundle-ssh-command-wrapper");
    const report = createPatchReport();
    report.enabledIntegrations = ["ssh-command-wrapper"];
    const { value, warnings } = withCapturedWarnings(() =>
      applyMainBundlePatchDescriptors(partial, [descriptor], {}, report),
    );
    assert.equal(value.patchedSource, partial);
    assert.match(warnings.join("\n"), /partial, ambiguous, or drifted/u);
    assert.equal(report.patches[0].status, "skipped-optional");
  });
});

test("patches the SSH connection editor for manual hosts and aliases", () => {
  const patched = applyWebviewPatch(webviewFixture);
  assert.notEqual(patched, webviewFixture);
  assert.equal(applyWebviewPatch(patched), patched);
  assert.match(patched, /Remote command wrapper/u);
  assert.match(patched, /ssh -T target-host --/u);
  assert.match(patched, /invalidSshCommandWrapper/u);
  assert.match(patched, /chatgptLinuxSshCommandWrapper:chatgptLinuxParseSshCommandWrapper/u);
});

test("webview patch rejects a damaged injected helper implementation", () => {
  const patched = applyWebviewPatch(webviewFixture);
  const damaged = patched.replace("t.length>64", "t.length>63");
  assert.notEqual(damaged, patched);

  const { value, warnings } = withCapturedWarnings(() => applyWebviewPatch(damaged));
  assert.equal(value, damaged);
  assert.match(warnings.join("\n"), /helperSource=0/u);
});

test("webview patch rejects duplicate owned editor targets", () => {
  const duplicateTarget = `${webviewFixture}function duplicate(){return{authMode:\`none\`,identity:\`\`}}`;
  const { value, warnings } = withCapturedWarnings(() => applyWebviewPatch(duplicateTarget));
  assert.equal(value, duplicateTarget);
  assert.match(warnings.join("\n"), /partial, ambiguous, or drifted/u);
});

test("webview helper-only partial state is reported as integration drift", async () => {
  const partial = webviewFixture.replace(
    "function Mi(){",
    "function chatgptLinuxParseSshCommandWrapper(e){}function Mi(){",
  );
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-command-wrapper-webview-"));
  const assetsDir = path.join(tempDir, "webview", "assets");
  const assetPath = path.join(assetsDir, "remote-connections-settings-current.js");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(assetPath, partial);
  try {
    await withIntegrationConfigAsync(["ssh-command-wrapper"], async (integrationsRoot) => {
      const descriptor = loadPortIntegrationPatchDescriptors({ integrationsRoot })
        .find((item) => item.id === "integration:ssh-command-wrapper:webview-ssh-command-wrapper-settings");
      const report = createPatchReport();
      report.enabledIntegrations = ["ssh-command-wrapper"];
      const { warnings } = await withCapturedWarningsAsync(() =>
        applyWebviewAssetPatchDescriptorsWithMutation(
          tempDir,
          [descriptor],
          {},
          report,
        ),
      );
      assert.equal(fs.readFileSync(assetPath, "utf8"), partial);
      assert.match(warnings.join("\n"), /partial, ambiguous, or drifted/u);
      assert.equal(report.patches[0].status, "skipped-optional");
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("exports main and settings descriptors for default-enabled builds", () => {
  assert.deepEqual(
    descriptors.map(({ phase, ciPolicy }) => [phase, ciPolicy]),
    [
      ["main-bundle", "opt-in"],
      ["webview-asset", "opt-in"],
    ],
  );
  assert.equal(
    descriptors[1].pattern.test("remote-connections-settings-current.js"),
    true,
  );
});

test("integration is enabled by default and explicit config can disable it", () => {
  assert.equal(require("./integration.json").defaultEnabled, true);

  withIntegrationConfig([], (integrationsRoot) => {
    assert.deepEqual(loadPortIntegrationPatchDescriptors({ integrationsRoot }), []);
  });
  withIntegrationConfig(["ssh-command-wrapper"], (integrationsRoot) => {
    assert.deepEqual(
      loadPortIntegrationPatchDescriptors({ integrationsRoot }).map(({ id }) => id),
      [
        "integration:ssh-command-wrapper:main-bundle-ssh-command-wrapper",
        "integration:ssh-command-wrapper:webview-ssh-command-wrapper-settings",
      ],
    );
  });
});
