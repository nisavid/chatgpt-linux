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

const managementCall = "n.Rn({args:[`ssh`,...cC(c),...uC(this.options.sshConnection),GS(e,s)],spawnInsideWsl:!1})";
const proxyCall = "(0,x.spawn)(n.Wn.resolve(`ssh`)??`ssh`,[`-T`,...cC(this.options.getConnectTimeoutSeconds?.()),...uC(this.options.sshConnection),GS(r,a)],{env:i.t(process.env),stdio:[`pipe`,`pipe`,`pipe`]})";

const mainFixture = [
  "const existingArraySchema=n.yl(n.jl())",
  "function GS(e,t){return e+t}",
  `function management(){let u=${managementCall};return u}`,
  `function proxy(){let a=${proxyCall};return a}`,
  "function fC(e){let t=Dse(e);return t?{sshConnection:{alias:t.sshAlias,host:t.sshHost,port:t.sshPort,identity:t.identity}}:null}",
  "function kse(e){let t=e.alias?.trim();return t?`alias:${t}`:[`direct`,e.host,String(e.port??``),e.identity?.trim()??``].join(`:",
  "aliasLoad.then(t=>t==null?null:{...t,hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,autoConnect:!1})",
  "let direct=[{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`codex-managed`,autoConnect:!1,sshAlias:null,sshHost:e.hostname,sshPort:e.sshPort,identity:e.identity}]),...t.filter",
  "let current=e.alias==null?{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`codex-managed`,alias:null,hostname:e.hostname,sshPort:e.sshPort,identity:e.identity}:{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`discovered`,alias:e.alias,hostname:null,sshPort:null,identity:null}",
  "let legacy=n==null?{hostId:t.hostId,connectionAnalyticsId:t.connectionAnalyticsId,displayName:t.displayName,source:`codex-managed`,alias:null,hostname:t.sshHost,sshPort:t.sshPort,identity:t.identity}:{hostId:t.hostId,connectionAnalyticsId:t.connectionAnalyticsId,displayName:t.displayName,source:`discovered`,alias:n,hostname:null,sshPort:null,identity:null}",
  "let host={[FS]:{sshAlias:e.sshAlias??null,sshHost:e.sshHost,sshPort:e.sshPort,identity:e.identity}};return e.homeDir",
  "var t_e=n.Dl({sshAlias:n.jl().nullable(),sshHost:n.jl(),sshPort:n.El().nullable(),identity:n.jl().nullable()});",
  "let config={sshPort:e.sshPort,identity:e.identity,codexCliCommand:[]}",
].join(";");

const currentWebviewSettingsFieldTarget =
  "let N;t[47]!==k||t[48]!==j||t[49]!==M?(N=(0,q.jsx)(ln,{children:(0,q.jsxs)(`div`,{className:`grid grid-cols-1 gap-4`,children:[k,j,M]})}),t[47]=k,t[48]=j,t[49]=M,t[50]=N):N=t[50];";

const webviewFixture = [
  "function qi(){return{displayName:``,targetKind:`hostname`,sshHost:``,sshPort:``,authMode:`none`,identity:``}}",
  "function Ji(e){return{displayName:e.displayName,targetKind:e.sshAlias?.trim()?`alias`:`hostname`,sshHost:e.sshAlias?.trim()||e.sshHost,sshPort:e.sshPort==null?``:String(e.sshPort),authMode:e.identity==null?`none`:`identity`,identity:e.identity??``}}",
  "function Yi(e,{connectionAnalyticsId:t}={}){let n=e.displayName.trim(),r=e.sshHost.trim(),i=e.targetKind===`alias`?r:null;return i==null?{hostId:d(n),connectionAnalyticsId:t,displayName:n,source:`codex-managed`,alias:null,hostname:r,sshPort:Zi(e.sshPort),identity:e.authMode===`identity`?e.identity.trim():null}:{hostId:ze(i),connectionAnalyticsId:t,displayName:n,source:`discovered`,alias:i,hostname:null,sshPort:null,identity:null}}function Xi({draft:e,editingHostId:t,existingConnections:n}){let r=[],i=e.displayName.trim();i.length===0&&r.push(`displayNameRequired`);return r}",
  `function $i(e){let t=[],v,q,ln,k,j,M,ra,o,u;${currentWebviewSettingsFieldTarget}return N}`,
  "function ia(e){switch(e){case`displayNameRequired`:return null}}",
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
  assert.match(patched, /chatgptLinuxSshWrapRemoteCommand\(GS\(e,s\)/u);
  assert.match(patched, /chatgptLinuxSshWrapRemoteCommand\(GS\(r,a\)/u);
  assert.match(patched, /chatgptLinuxSshCommandWrapperArgs\(e\.chatgptLinuxSshCommandWrapper\)/u);
  assert.ok(patched.split("chatgptLinuxSshCommandWrapper").length > 10);
});

test("uses the current main-bundle array schema factory", () => {
  const currentBundleFixture = mainFixture;
  const patched = applyMainBundlePatch(currentBundleFixture);
  const schemaSource = /var t_e=[^;]+;/u.exec(patched)?.[0];

  assert.ok(schemaSource, "patched SSH schema was not found");
  assert.match(schemaSource, /chatgptLinuxSshCommandWrapper:n\.yl\(n\.jl\(\)\)\.optional\(\)/u);

  const scalarSchema = () => ({
    nullable() { return this; },
    optional() { return this; },
  });
  const namespace = {
    Dl: (value) => value,
    jl: scalarSchema,
    El: scalarSchema,
    yl: (value) => ({ optional: () => ({ element: value }) }),
  };
  assert.doesNotThrow(() => vm.runInNewContext(schemaSource + "t_e", { n: namespace }));
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
    "function GS(",
    "function chatgptLinuxSshCommandWrapperArgs(e){}function GS(",
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

test("patches the current compiler-memoized SSH connection editor for manual hosts and aliases", () => {
  const patched = applyWebviewPatch(webviewFixture);
  assert.notEqual(patched, webviewFixture);
  assert.equal(applyWebviewPatch(patched), patched);
  assert.equal(patched.includes(currentWebviewSettingsFieldTarget), false);
  const fieldStart = patched.indexOf("let N=(0,q.jsx)(ln");
  const fieldEnd = patched.indexOf("return N", fieldStart);
  assert.notEqual(fieldStart, -1);
  assert.notEqual(fieldEnd, -1);
  const injectedField = patched.slice(fieldStart, fieldEnd);
  assert.match(injectedField, /v\.Field/u);
  assert.match(injectedField, /name:`chatgptLinuxSshCommandWrapperText`/u);
  assert.match(injectedField, /disabled:u/u);
  assert.doesNotMatch(injectedField, /disabled:l/u);
  assert.match(patched, /Remote command wrapper/u);
  assert.match(patched, /ssh -T target-host --/u);
  assert.match(patched, /invalidSshCommandWrapper/u);
  assert.match(
    patched,
    /case`invalidSshCommandWrapper`:return\(0,q\.jsx\)\(o,\{id:`settings\.remoteConnections\.dialog\.field\.commandWrapper\.error`/u,
  );
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

test("webview patch rejects duplicate current settings layout targets", () => {
  const duplicateTarget = `${webviewFixture}function duplicate(){${currentWebviewSettingsFieldTarget}}`;
  const { value, warnings } = withCapturedWarnings(() => applyWebviewPatch(duplicateTarget));
  assert.equal(value, duplicateTarget);
  assert.match(warnings.join("\n"), /partial, ambiguous, or drifted/u);
});

test("webview helper-only partial state is reported as integration drift", async () => {
  const partial = webviewFixture.replace(
    "function qi(){",
    "function chatgptLinuxParseSshCommandWrapper(e){}function qi(){",
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
