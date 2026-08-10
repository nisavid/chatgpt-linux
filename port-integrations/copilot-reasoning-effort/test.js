#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyWebviewAssetPatchDescriptors,
  normalizePatchDescriptors,
} = require("../../scripts/patches/engine.js");
const {
  openGeneratedAppMutationRoot,
} = require("../../scripts/patches/lib/generated-app-mutation-client.js");
const {
  loadPortIntegrationPatchDescriptors,
} = require("../../scripts/lib/port-integrations.js");
const {
  applyCopilotReasoningEffortModelListPatch,
  applyCopilotReasoningEffortSettingsPatch,
  applyCopilotReasoningEffortUiPatch,
} = require("./patch.js");

function applyPatchTwice(patchFn, source) {
  const patched = patchFn(source);
  assert.equal(patchFn(patched), patched);
  return patched;
}

function captureWarnings(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

const withCapturedWarns = captureWarnings;

function copilotReasoningEffortSettingsFixture() {
  return [
    "function bwe(){let e=(0,Y.c)(3),t=wr(),{data:n,isLoading:r}=or(`copilot-default-model`),i=n??t.defaultModel,a;return e[0]!==r||e[1]!==i?(a={model:i,reasoningEffort:`medium`,profile:null,isLoading:r},e[0]=r,e[1]=i,e[2]=a):a=e[2],a}",
    "function $9(e=null){let t=j(fe),m=a?.authMethod===`copilot`,g=(0,q.useCallback)(async(t,n)=>!1,[]),c={profile:null},i=!0,r=`local`,s=`/tmp`,v=()=>{},y=()=>{};return{setModelAndReasoningEffort:(0,q.useCallback)(async(e,n)=>{try{if(await g(e,n))return;if(m){await Jn(t,`copilot-default-model`,e,{throwOnFailure:!0});return}if(h.info(`Setting default model and reasoning effort`,{safe:{newModel:e,newEffort:n,profile:c.profile}}),!i)throw Error(`Model settings host is unavailable`);await Gt(`set-default-model-config-for-host`,{hostId:r,model:e,reasoningEffort:n,profile:c.profile}),await v(),await t.query.fetch(Ss,{hostId:r,cwd:s})}catch(e){y(e)}},[m,g,c.profile,v,i,r,t,y,s])}}",
  ].join("");
}

function currentCopilotReasoningEffortSettingsFixture() {
  return [
    "function Va(){let e=(0,Ya.c)(3),t=ua(),{data:n,isLoading:r}=hn(`copilot-default-model`),i=n??t.defaultModel,a;return e[0]!==r||e[1]!==i?(a={model:i,reasoningEffort:`medium`,profile:null,isLoading:r},e[0]=r,e[1]=i,e[2]=a):a=e[2],a}",
    "function currentWriter(){let u=!0,l=!0,n={},m={profile:null},a=`host`,f=`/tmp`,r={cancelQueries:async()=>{},getQueryData:()=>null},E=async()=>!1,ln=async()=>{},za=()=>[],Xe={info:()=>{}},j=()=>{};return async(e,t)=>{let i=null,o;try{if(await E(e,t))return;if(u){await ln(n,`copilot-default-model`,e,{throwOnFailure:!0});return}if(!l)throw Error(`Model settings host is unavailable`);i=za(a,f);let s={hostId:a,cwd:f};await r.cancelQueries({exact:!0,queryKey:i}),o=r.getQueryData(i),Xe.info(`Setting default model and reasoning effort`,{safe:{newModel:e,newEffort:t,profile:m.profile}})}catch(e){j(e)}}}",
  ].join("");
}

function currentFilteredCopilotReasoningEffortModelListFixture() {
  return "function Jv({authMethod:e,availableModels:t,defaultModel:n,enabledReasoningEfforts:r,includeUltraReasoningEffort:i,models:a,useHiddenModels:o}){let s=[],c=null,l=o&&e!==`amazonBedrock`,u=a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`max`)),d=i&&a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`ultra`));return a.forEach(n=>{if(l?t.has(n.model):!n.hidden){let t=i?n.supportedReasoningEfforts:n.supportedReasoningEfforts.filter(({reasoningEffort:e})=>e!==`ultra`),a=(e===`copilot`?[t.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:t).filter(({reasoningEffort:e})=>vg(e)&&r.has(e)),o={...n,supportedReasoningEfforts:a};s.push(o),n.isDefault&&(c=o)}}),c??=s.find(e=>e.model===n)??null,{models:s,defaultModel:c,hasModelSupportingMaxReasoningEffort:u,hasModelSupportingUltraReasoningEffort:d}}";
}

function currentCopilotReasoningEffortUiFixture() {
  return [
    "function DYs(){let F=!e1r(y)||m.isLoading||T===`pending`,I=u?.authMethod===`copilot`,L=Pqs(b,_),R=ECs(b),z=Fqs(m.reasoningEffort,L),B=!F&&!I&&!0,V=o!=null&&!F&&p&&!I&&y!==`error`;return TY(`composer.increaseReasoningEffort`,()=>Se(`increase`),{enabled:B}),TY(`composer.decreaseReasoningEffort`,()=>Se(`decrease`),{enabled:B}),(0,TZ.jsx)(QJs,{reasoningEffortDisabled:I})}",
    "function unrelatedGate(){let q=a&&b&&!0,c;return q}",
    "function uU(){let h=o?.authMethod===`copilot`;let E=i.formatMessage({id:`composer.reasoningSlashCommand.title`});let M=l&&m&&!h&&!0,N;return{enabled:M,dependencies:N}}",
    "function permissionGate(){let A=O.length>0,j=!w&&!A;return{shouldAutoDenyPermissionRequest:j}}",
  ].join("");
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-reasoning-integration-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-reasoning-integration-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const defaultEnabledIntegrationIds = [
  "agent-workspace",
  "appshots",
  "chatgpt-wrapper-updater",
  "conversation-mode",
  "copilot-reasoning-effort",
  "open-target-discovery",
  "read-aloud",
  "read-aloud-mcp",
  "remote-control-ui",
  "remote-mobile-control",
];

function withTempIntegrationConfig(enabled, fn, disabled = null) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  return withTempDir((tmp) => {
    process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(tmp, "integrations.json");
    const enabledSet = new Set(enabled);
    const effectiveDisabled =
      disabled ?? defaultEnabledIntegrationIds.filter((id) => !enabledSet.has(id));
    fs.writeFileSync(
      process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG,
      JSON.stringify({ enabled, disabled: effectiveDisabled }, null, 2),
    );
    try {
      return fn();
    } finally {
      if (originalConfig == null) {
        delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
    }
  });
}

async function withTempIntegrationConfigAsync(enabled, fn, disabled = null) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  return withTempDirAsync(async (tmp) => {
    process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(tmp, "integrations.json");
    const enabledSet = new Set(enabled);
    const effectiveDisabled =
      disabled ?? defaultEnabledIntegrationIds.filter((id) => !enabledSet.has(id));
    fs.writeFileSync(
      process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG,
      JSON.stringify({ enabled, disabled: effectiveDisabled }, null, 2),
    );
    try {
      return await fn();
    } finally {
      if (originalConfig == null) {
        delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
    }
  });
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

function writeAsset(extractedDir, name, source) {
  const assetsDir = path.join(extractedDir, "webview", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, name), source);
}

function readAsset(extractedDir, name) {
  return fs.readFileSync(path.join(extractedDir, "webview", "assets", name), "utf8");
}

function loadCopilotIntegrationPatchDescriptors(integrationsRoot) {
  return loadPortIntegrationPatchDescriptors({ integrationsRoot })
    .filter((descriptor) => descriptor.id.startsWith("integration:copilot-reasoning-effort:"));
}

test("persists Copilot reasoning effort with the default Copilot model", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortSettingsPatch,
    copilotReasoningEffortSettingsFixture(),
  );

  assert.match(patched, /or\(`copilot-default-reasoning-effort`\)/);
  assert.match(patched, /reasoningEffort:codexCopilotReasoningEffortValue/);
  assert.match(patched, /isLoading:r\|\|codexCopilotReasoningEffortLoading/);
  assert.match(
    patched,
    /await Jn\(t,`copilot-default-model`,e,\{throwOnFailure:!0\}\);await Jn\(t,`copilot-default-reasoning-effort`,n,\{throwOnFailure:!0\}\);return/,
  );
  assert.doesNotMatch(patched, /reasoningEffort:`medium`,profile:null,isLoading:r/);
  assert.doesNotMatch(patched, /await Jn\(t,`copilot-default-model`,e,\{throwOnFailure:!0\}\);return/);
});

test("persists Copilot reasoning effort through the current default writer", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortSettingsPatch,
    currentCopilotReasoningEffortSettingsFixture(),
  );

  assert.match(
    patched,
    /await ln\(n,`copilot-default-model`,e,\{throwOnFailure:!0\}\);await ln\(n,`copilot-default-reasoning-effort`,t,\{throwOnFailure:!0\}\);return/,
  );
  assert.doesNotMatch(
    patched,
    /await ln\(n,`copilot-default-model`,e,\{throwOnFailure:!0\}\);return/,
  );
});

test("current DMG descriptors target only the owning Copilot chunks", () => {
  const currentChunk = "app-initial-DRyZ1Lin.js";
  const obsoleteSplitChunk =
    "app-initial~app-main~hotkey-window-thread-page~keyboard-shortcuts-settings~thread-app-shell~cf704xib-BpnUyB2R.js";
  const loaded = require("./patch.js").descriptors;

  assert.ok(loaded.every((descriptor) => descriptor.pattern.test(currentChunk) === true));
  assert.ok(loaded.every((descriptor) => descriptor.pattern.test(obsoleteSplitChunk) === false));
  assert.ok(loaded.every((descriptor) => descriptor.pattern.test("settings-page-current.js") === false));
});

test("keeps filtered current app reasoning efforts for Copilot auth", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortModelListPatch,
    currentFilteredCopilotReasoningEffortModelListFixture(),
  );

  assert.match(patched, /let t=i\?n\.supportedReasoningEfforts:n\.supportedReasoningEfforts\.filter/);
  assert.match(patched, /a=\[\.\.\.t\]\.filter\(\(\{reasoningEffort:e\}\)=>vg\(e\)&&r\.has\(e\)\)/);
  assert.doesNotMatch(patched, /e===`copilot`\?\[/);
  assert.doesNotMatch(patched, /description:`medium effort`/);
  const { value, warnings } = withCapturedWarns(() =>
    applyCopilotReasoningEffortModelListPatch(patched),
  );
  assert.equal(value, patched);
  assert.deepEqual(warnings, []);
});

test("allows Copilot auth to use the current app effort controls", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortUiPatch,
    currentCopilotReasoningEffortUiFixture(),
  );

  assert.match(patched, /I=u\?\.authMethod===`copilot`[\s\S]*B=!F&&!0\/\*chatgptLinuxCopilotReasoningEffort\*\//);
  assert.match(patched, /reasoningEffortDisabled:!1/);
  assert.match(patched, /let E=i\.formatMessage\(\{id:`composer\.reasoningSlashCommand\.title`\}\);let M=l&&m&&!0,N;/);
  assert.doesNotMatch(patched, /B=!F&&!I&&!0/);
  assert.doesNotMatch(patched, /reasoningEffortDisabled:I/);
  assert.doesNotMatch(patched, /M=l&&m&&!h&&!0/);
  assert.match(patched, /let q=a&&b&&!0,c/);
  assert.match(patched, /A=O\.length>0,j=!w&&!A/);
});

test("current app UI drift warns without touching adjacent gates", () => {
  const source = [
    "function DYs(){let F=!e1r(y)||m.isLoading||T===`pending`,I=isCopilot(u),L=Pqs(b,_),R=ECs(b),z=Fqs(m.reasoningEffort,L),B=!F&&!I&&!0,V=o!=null&&!F;",
    "return TY(`composer.increaseReasoningEffort`,()=>Se(`increase`),{enabled:B}),",
    "(0,TZ.jsx)(QJs,{reasoningEffortDisabled:I})}",
    "function permissionGate(){let A=O.length>0,j=!w&&!A;return j}",
  ].join("");
  const { value, warnings } = withCapturedWarns(() =>
    applyCopilotReasoningEffortUiPatch(source),
  );

  assert.equal(value, source);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /current Copilot reasoning effort shortcut gate/);
  assert.match(value, /A=O\.length>0,j=!w&&!A/);
});

test("integration descriptor loader exposes the Copilot webview asset patches unless disabled", () => {
  const integrationsRoot = path.resolve(__dirname, "..");

  withTempIntegrationConfig([], () => {
    assert.deepEqual(loadCopilotIntegrationPatchDescriptors(integrationsRoot), []);
  }, ["copilot-reasoning-effort", "open-target-discovery"]);

  withTempIntegrationConfig(["copilot-reasoning-effort"], () => {
    const descriptors = loadCopilotIntegrationPatchDescriptors(integrationsRoot);

    assert.deepEqual(
      descriptors.map((descriptor) => descriptor.id),
      [
        "integration:copilot-reasoning-effort:settings",
        "integration:copilot-reasoning-effort:model-list",
        "integration:copilot-reasoning-effort:ui",
      ],
    );
    assert.deepEqual(
      descriptors.map((descriptor) => descriptor.phase),
      ["webview-asset", "webview-asset", "webview-asset"],
    );
    assert.ok(descriptors.every((descriptor) => descriptor.ciPolicy === "optional"));
    const currentChunk = "app-initial-current.js";
    assert.ok(descriptors.every((descriptor) => descriptor.pattern.test(currentChunk)));
    assert.ok(descriptors.every((descriptor) => !descriptor.pattern.test("unrelated-bundle.js")));
  });
});

test("enabled integration descriptors patch the current app chunks", async () => {
  const integrationsRoot = path.resolve(__dirname, "..");
  const currentChunk = "app-initial-DRyZ1Lin.js";

  await withTempIntegrationConfigAsync(["copilot-reasoning-effort"], async () => {
    await withTempDirAsync(async (extractedDir) => {
      writeAsset(
        extractedDir,
        currentChunk,
        `${currentCopilotReasoningEffortSettingsFixture()};${currentFilteredCopilotReasoningEffortModelListFixture()};${currentCopilotReasoningEffortUiFixture()}`,
      );

      const descriptors = normalizePatchDescriptors(
        loadCopilotIntegrationPatchDescriptors(integrationsRoot),
      );
      await applyWebviewAssetPatchDescriptorsWithMutation(
        extractedDir,
        descriptors,
        {},
        null,
      );
      const patched = readAsset(extractedDir, currentChunk);

      assert.match(patched, /copilot-default-reasoning-effort/);
      assert.match(patched, /a=\[\.\.\.t\]\.filter/);
      assert.doesNotMatch(patched, /e===`copilot`\?\[/);
      assert.match(patched, /reasoningEffortDisabled:!1/);
      assert.match(patched, /M=l&&m&&!0,N/);
    });
  });
});
