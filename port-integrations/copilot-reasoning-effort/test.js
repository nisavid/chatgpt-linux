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

function copilotReasoningEffortModelListFixture() {
  return "function Ge(){let s=`copilot`,d={};return e.forEach(e=>{let t=s===`copilot`?[e.supportedReasoningEfforts.find(Ue)??{reasoningEffort:`medium`,description:`medium effort`}]:[...e.supportedReasoningEfforts];d.models.push({...e,supportedReasoningEfforts:t})})}";
}

function legacyCurrentCopilotReasoningEffortModelListFixture() {
  return "function Ge(){let t=`copilot`;return r.forEach(e=>{let n=t===`copilot`?[e.supportedReasoningEfforts.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:[...e.supportedReasoningEfforts];i.push({...e,supportedReasoningEfforts:n})})}";
}

function currentFilteredCopilotReasoningEffortModelListFixture() {
  return "function Jv({authMethod:e,availableModels:t,defaultModel:n,enabledReasoningEfforts:r,includeUltraReasoningEffort:i,models:a,useHiddenModels:o}){let s=[],c=null,l=o&&e!==`amazonBedrock`,u=a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`max`)),d=i&&a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`ultra`));return a.forEach(n=>{if(l?t.has(n.model):!n.hidden){let t=i?n.supportedReasoningEfforts:n.supportedReasoningEfforts.filter(({reasoningEffort:e})=>e!==`ultra`),a=(e===`copilot`?[t.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:t).filter(({reasoningEffort:e})=>vg(e)&&r.has(e)),o={...n,supportedReasoningEfforts:a};s.push(o),n.isDefault&&(c=o)}}),c??=s.find(e=>e.model===n)??null,{models:s,defaultModel:c,hasModelSupportingMaxReasoningEffort:u,hasModelSupportingUltraReasoningEffort:d}}";
}

function currentCopilotReasoningEffortUiFixture() {
  return [
    "function dz(){let k=!Bm(u),A=a?.authMethod===`copilot`,j=!k&&!A,M=yh(d,m);return aO(`composer.increaseReasoningEffort`,()=>we(`increase`),{enabled:j}),(0,gz.jsx)(_m,{reasoningEffortDisabled:A})}",
    "function unrelatedGate(){let q=a&&b&&!0,c;return q}",
    "function uU(){let p=o?.authMethod===`copilot`;let E=i.formatMessage({id:`composer.reasoningSlashCommand.title`});let O=s&&f&&!p&&!0,k;return{enabled:O,dependencies:k}}",
    "function permissionGate(){let A=O.length>0,j=!w&&!A;return{shouldAutoDenyPermissionRequest:j}}",
  ].join("");
}

function copilotReasoningEffortUiFixture() {
  return [
    "function qU(){let E=o?.authMethod===`copilot`,D=ZH(T,f.model),O=QH(f.reasoningEffort,D),le=D.map(e=>{let{reasoningEffort:t}=e;return(0,$.jsx)(jm.Item,{\"data-reasoning-selected\":t===O?`true`:void 0,disabled:E,RightIcon:t===O?rg:void 0,onSelect:()=>{i.get(bh).log({eventName:`codex_composer_reasoning_effort_changed`,metadata:{reasoning_effort:t}}),p(f.model,t),H()},children:(0,$.jsx)(nM,{effort:t})},t)})}",
    "function bY(e){let p=o?.authMethod===`copilot`;let w=s&&f&&!p,T;return{enabled:w,dependencies:T}}",
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

const defaultEnabledIntegrationIds = [
  "agent-workspace",
  "appshots",
  "codex-wrapper-updater",
  "conversation-mode",
  "copilot-reasoning-effort",
  "open-target-discovery",
  "read-aloud",
  "read-aloud-mcp",
  "remote-control-ui",
  "remote-mobile-control",
];

function withTempIntegrationConfig(enabled, fn, disabled = null) {
  const originalConfig = process.env.CODEX_PORT_INTEGRATIONS_CONFIG;
  return withTempDir((tmp) => {
    process.env.CODEX_PORT_INTEGRATIONS_CONFIG = path.join(tmp, "integrations.json");
    const enabledSet = new Set(enabled);
    const effectiveDisabled =
      disabled ?? defaultEnabledIntegrationIds.filter((id) => !enabledSet.has(id));
    fs.writeFileSync(
      process.env.CODEX_PORT_INTEGRATIONS_CONFIG,
      JSON.stringify({ enabled, disabled: effectiveDisabled }, null, 2),
    );
    try {
      return fn();
    } finally {
      if (originalConfig == null) {
        delete process.env.CODEX_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CODEX_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
    }
  });
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
  const settingsChunk =
    "app-initial~app-main~hotkey-window-thread-page~keyboard-shortcuts-settings~thread-app-shell~cf704xib-BpnUyB2R.js";
  const uiChunk =
    "app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-DRU9Ekz0.js";
  const adjacentChunk =
    "app-initial~app-main~new-thread-panel-page~onboarding-page~appgen-library-page~hotkey-windo~d4kxte0o-BsjKAgmz.js";
  const loaded = require("./patch.js").descriptors;

  assert.equal(loaded[0].pattern.test(settingsChunk), true);
  assert.equal(loaded[1].pattern.test(settingsChunk), true);
  assert.equal(loaded[2].pattern.test(uiChunk), true);
  assert.ok(loaded.every((descriptor) => descriptor.pattern.test(adjacentChunk) === false));
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

test("keeps all model reasoning efforts available for legacy Copilot auth shapes", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortModelListPatch,
    copilotReasoningEffortModelListFixture(),
  );

  assert.match(patched, /let t=\[\.\.\.e\.supportedReasoningEfforts\]/);
  assert.doesNotMatch(patched, /s===`copilot`\?\[/);
  assert.doesNotMatch(patched, /description:`medium effort`/);
});

test("keeps all model reasoning efforts for renamed legacy model query aliases", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortModelListPatch,
    legacyCurrentCopilotReasoningEffortModelListFixture(),
  );

  assert.match(patched, /let n=\[\.\.\.e\.supportedReasoningEfforts\]/);
  assert.doesNotMatch(patched, /t===`copilot`\?\[/);
  assert.doesNotMatch(patched, /description:`medium effort`/);
});

test("allows Copilot auth to use the current app effort controls", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortUiPatch,
    currentCopilotReasoningEffortUiFixture(),
  );

  assert.match(patched, /A=a\?\.authMethod===`copilot`,j=!k,M=/);
  assert.match(patched, /reasoningEffortDisabled:!1/);
  assert.match(patched, /let E=i\.formatMessage\(\{id:`composer\.reasoningSlashCommand\.title`\}\);let O=s&&f&&!0,k;/);
  assert.doesNotMatch(patched, /j=!k&&!A/);
  assert.doesNotMatch(patched, /reasoningEffortDisabled:A/);
  assert.doesNotMatch(patched, /O=s&&f&&!p&&!0/);
  assert.match(patched, /let q=a&&b&&!0,c/);
  assert.match(patched, /A=O\.length>0,j=!w&&!A/);
});

test("allows Copilot auth to use legacy reasoning effort controls", () => {
  const patched = applyPatchTwice(
    applyCopilotReasoningEffortUiPatch,
    copilotReasoningEffortUiFixture(),
  );

  assert.match(patched, /disabled:!1,RightIcon:t===O\?rg:void 0/);
  assert.match(patched, /let w=s&&f,T;/);
  assert.doesNotMatch(patched, /disabled:E,RightIcon:t===O\?rg:void 0/);
  assert.doesNotMatch(patched, /let w=s&&f&&!p,T;/);
});

test("current app UI drift warns without touching adjacent gates", () => {
  const source = [
    "function dz(){let k=!Bm(u),A=isCopilot(a),j=!k&&!A,M=yh(d,m);",
    "return aO(`composer.increaseReasoningEffort`,()=>we(`increase`),{enabled:j}),",
    "(0,gz.jsx)(_m,{reasoningEffortDisabled:A})}",
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

test("recognizes Copilot reasoning effort UI patch with renamed scope aliases", () => {
  const source = copilotReasoningEffortUiFixture().replace("i.get(bh).log", "scope.get(bh).log");
  const { value: patched, warnings } = captureWarnings(() =>
    applyPatchTwice(applyCopilotReasoningEffortUiPatch, source),
  );

  assert.match(patched, /disabled:!1,RightIcon:t===O\?rg:void 0/);
  assert.deepEqual(warnings, []);
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
    const currentSettingsChunk =
      "app-initial~app-main~hotkey-window-thread-page~keyboard-shortcuts-settings~thread-app-shell~cf704xib-current.js";
    const currentUiChunk =
      "app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-current.js";
    assert.match(currentSettingsChunk, descriptors[0].pattern);
    assert.match(currentSettingsChunk, descriptors[1].pattern);
    assert.match(currentUiChunk, descriptors[2].pattern);
    assert.ok(descriptors.every((descriptor) => !descriptor.pattern.test("unrelated-bundle.js")));
  });
});

test("enabled integration descriptors patch the current app chunks", () => {
  const integrationsRoot = path.resolve(__dirname, "..");
  const currentSettingsChunk =
    "app-initial~app-main~hotkey-window-thread-page~keyboard-shortcuts-settings~thread-app-shell~cf704xib-BpnUyB2R.js";
  const currentUiChunk =
    "app-initial~app-main~new-thread-panel-page~appgen-library-page~hotkey-window-thread-page~ho~iufn7mg3-DRU9Ekz0.js";

  withTempIntegrationConfig(["copilot-reasoning-effort"], () => {
    withTempDir((extractedDir) => {
      writeAsset(
        extractedDir,
        currentSettingsChunk,
        `${currentCopilotReasoningEffortSettingsFixture()};${currentFilteredCopilotReasoningEffortModelListFixture()}`,
      );
      writeAsset(extractedDir, currentUiChunk, currentCopilotReasoningEffortUiFixture());

      const descriptors = normalizePatchDescriptors(
        loadCopilotIntegrationPatchDescriptors(integrationsRoot),
      );
      applyWebviewAssetPatchDescriptors(extractedDir, descriptors, {}, null);
      const patched = readAsset(extractedDir, currentSettingsChunk);

      assert.match(patched, /copilot-default-reasoning-effort/);
      assert.match(patched, /a=\[\.\.\.t\]\.filter/);
      assert.doesNotMatch(patched, /e===`copilot`\?\[/);
      assert.match(readAsset(extractedDir, currentUiChunk), /reasoningEffortDisabled:!1/);
      assert.match(readAsset(extractedDir, currentUiChunk), /O=s&&f&&!0,k/);
    });
  });
});
