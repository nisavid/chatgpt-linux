#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPatchReport } = require("../../scripts/lib/patch-report.js");
const {
  patchExtractedApp: patchExtractedAppProduction,
} = require("../../scripts/patches/runner.js");
const { loadPortIntegrationPatchDescriptors } = require("../../scripts/lib/port-integrations.js");
const {
  applyApiKeyServiceTierPatch,
  applyApiKeyServiceTierGatePatch,
  applyCurrentGatePatch,
  applyCurrentModelPatch,
  applyCurrentFallbackFastTierPatch,
  applyFallbackFastTierPatch,
  descriptors,
  hasApiKeyServiceTierGateShape,
  hasApiKeyModelListMappingShape,
} = require("./patch.js");

const integrationsRoot = path.resolve(__dirname, "..");
const gateSource =
  "function sxe(e){let t=(0,cxe.c)(6),n=X(os),r=e?.hostId??n,i=Cf(r),a=i?.authMethod===`chatgpt`,o=i?.authMethod??null,s;t[0]!==r||t[1]!==o?(s={authMethod:o,hostId:r},t[0]=r,t[1]=o,t[2]=s):s=t[2];let{data:c,isPending:l}=ye(is,s),u=!!i?.isLoading||a&&l,d=a&&!u&&c!=null&&c?.requirements?.featureRequirements?.fast_mode!==!1,f;return t[3]!==u||t[4]!==d?(f={isServiceTierAllowed:d,isLoading:u},t[3]=u,t[4]=d,t[5]=f):f=t[5],f}";
const modelSource =
  "function vbe({authMethod:e,availableModels:t,defaultModel:n,enabledReasoningEfforts:r,includeUltraReasoningEffort:i,models:a,useHiddenModels:o}){let s=[],c=null;return a.forEach(n=>{let a=n.supportedReasoningEfforts,o={...n,supportedReasoningEfforts:a};s.push(o),n.isDefault&&(c=o)}),{models:s,defaultModel:c}}";
const providerTierSource = [
  "function pQ(e,t){return t==null?null:e?.serviceTiers?.find(e=>e.id===t)??null}",
  "function tEe(e){return[{tier:null,value:null},...(e?.serviceTiers??[]).map(e=>({tier:e,value:e.id}))]}",
].join("");

function captureWarnings(callback) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    return { value: callback(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function captureWarningsAsync(callback) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    return { value: await callback(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function patchExtractedApp(extractedDir, options = {}) {
  fs.chmodSync(extractedDir, 0o700);
  return patchExtractedAppProduction(extractedDir, {
    ...options,
    mutationBrokerPath:
      process.env.CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE,
    verifiedPrivateRoot: true,
  });
}

function allIntegrationIds() {
  return fs.readdirSync(integrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(integrationsRoot, entry.name, "integration.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(fs.readFileSync(manifestPath, "utf8")).id);
}

function withIntegrationConfig(enabled, callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-service-tier-"));
  const configPath = path.join(tempDir, "integrations.json");
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  const disabled = allIntegrationIds().filter((id) => id !== "api-key-service-tier");
  if (!enabled) disabled.push("api-key-service-tier");
  try {
    fs.writeFileSync(configPath, JSON.stringify({ enabled: enabled ? ["api-key-service-tier"] : [], disabled }));
    process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = configPath;
    return callback();
  } finally {
    if (originalConfig == null) delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    else process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function withIntegrationConfigAsync(enabled, callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-service-tier-"));
  const configPath = path.join(tempDir, "integrations.json");
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  const disabled = allIntegrationIds().filter((id) => id !== "api-key-service-tier");
  if (!enabled) disabled.push("api-key-service-tier");
  try {
    fs.writeFileSync(configPath, JSON.stringify({ enabled: enabled ? ["api-key-service-tier"] : [], disabled }));
    process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = configPath;
    return await callback();
  } finally {
    if (originalConfig == null) delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    else process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function loadedDescriptors() {
  return loadPortIntegrationPatchDescriptors({ integrationsRoot })
    .filter((descriptor) => descriptor.id.startsWith("integration:api-key-service-tier:"));
}

function applyTwice(patch, source) {
  const once = patch(source);
  assert.notEqual(once, source);
  assert.equal(patch(once), once);
  return once;
}

test("api-key-service-tier is default-on but can be disabled", () => {
  withIntegrationConfig(true, () => {
    assert.deepEqual(
      loadedDescriptors().map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
      [["integration:api-key-service-tier:api-key-service-tier-gate", "webview-asset", "optional"]],
    );
  });
  withIntegrationConfig(false, () => assert.deepEqual(loadedDescriptors(), []));
});

test("current DMG descriptor targets only the owning auth-gate bundle", () => {
  assert.deepEqual(descriptors.map((descriptor) => descriptor.id), ["api-key-service-tier-gate"]);
  assert.equal(descriptors[0].pattern.test("app-initial-DRyZ1Lin.js"), true);
  assert.equal(descriptors[0].pattern.test("app-initial~app-main~onboarding-page-DjTNhJXu.js"), false);
  assert.equal(descriptors[0].pattern.test("settings-page-DjTNhJXu.js"), false);
});

test("current auth-gate wrapper warns when its exact contract disappears", () => {
  const { value, warnings } = captureWarnings(() => applyCurrentGatePatch("function driftedGate(){}"));
  assert.equal(value, "function driftedGate(){}");
  assert.deepEqual(warnings, [
    "WARN: Could not identify current service tier auth gate - skipping API key service tier gate patch",
  ]);
});

test("provider-only model and fallback compatibility exports are inert", () => {
  assert.deepEqual(captureWarnings(() => applyCurrentModelPatch(modelSource)), { value: modelSource, warnings: [] });
  assert.deepEqual(captureWarnings(() => applyCurrentFallbackFastTierPatch(providerTierSource)), {
    value: providerTierSource,
    warnings: [],
  });
});

test("auth-gate descriptor applies and records a report entry", async () => {
  await withIntegrationConfigAsync(true, async () => {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-service-tier-app-"));
    try {
      const assetsDir = path.join(tempApp, "webview", "assets");
      fs.mkdirSync(assetsDir, { recursive: true });
      const assetPath = path.join(assetsDir, "app-initial-current.js");
      fs.writeFileSync(assetPath, gateSource);
      const report = createPatchReport();
      await captureWarningsAsync(() => patchExtractedApp(tempApp, { report }));
      assert.equal(
        report.patches.find((entry) => entry.name === "integration:api-key-service-tier:api-key-service-tier-gate")?.status,
        "applied",
      );
      assert.match(fs.readFileSync(assetPath, "utf8"), /o===`apikey`/);
    } finally {
      fs.rmSync(tempApp, { recursive: true, force: true });
    }
  });
});

test("missing auth-gate bundle records one optional skip", async () => {
  await withIntegrationConfigAsync(true, async () => {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-service-tier-missing-"));
    try {
      fs.mkdirSync(path.join(tempApp, "webview", "assets"), { recursive: true });
      const report = createPatchReport();
      await captureWarningsAsync(() => patchExtractedApp(tempApp, { report }));
      const own = report.patches.filter((entry) => entry.name.startsWith("integration:api-key-service-tier:"));
      assert.deepEqual(own.map((entry) => [entry.name, entry.status]), [
        ["integration:api-key-service-tier:api-key-service-tier-gate", "skipped-optional"],
      ]);
    } finally {
      fs.rmSync(tempApp, { recursive: true, force: true });
    }
  });
});

test("service-tier auth gate allows API-key hosts while preserving ChatGPT requirements", () => {
  assert.equal(hasApiKeyServiceTierGateShape(gateSource), true);
  const patched = applyTwice(applyApiKeyServiceTierGatePatch, gateSource);
  assert.match(patched, /d=!u&&\(a\?c!=null&&c\?\.requirements\?\.featureRequirements\?\.fast_mode!==!1:o===`apikey`\)/);
});

test("unrelated fast-mode guards remain byte-identical without warnings", () => {
  const source = "async function check(e){return e?.requirements?.featureRequirements?.fast_mode!==!1}";
  assert.equal(hasApiKeyServiceTierGateShape(source), false);
  assert.deepEqual(captureWarnings(() => applyApiKeyServiceTierGatePatch(source)), { value: source, warnings: [] });
});

test("recognizable but unpatchable auth gates warn and remain unchanged", () => {
  const source = "function broken(){let a=i?.authMethod===`chatgpt`;let o=i?.authMethod??null;let d=a&&ready&&c?.requirements?.featureRequirements?.fast_mode!==!1;return{isServiceTierAllowed:d,isLoading:ready}}";
  assert.equal(hasApiKeyServiceTierGateShape(source), true);
  const { value, warnings } = captureWarnings(() => applyApiKeyServiceTierGatePatch(source));
  assert.equal(value, source);
  assert.deepEqual(warnings, ["WARN: Could not find service tier auth gate - skipping API key service tier gate patch"]);
});

test("provider model metadata remains authoritative", () => {
  assert.equal(hasApiKeyModelListMappingShape(modelSource), true);
  assert.equal(applyApiKeyServiceTierPatch(modelSource), modelSource);
  assert.doesNotMatch(applyApiKeyServiceTierPatch(modelSource), /chatgptLinuxApiKeyServiceTierModel/);
});

test("no synthetic fast tier is added when provider metadata omits it", () => {
  assert.equal(applyFallbackFastTierPatch(providerTierSource), providerTierSource);
  assert.doesNotMatch(applyFallbackFastTierPatch(providerTierSource), /chatgptLinuxApiKeyFastTier/);
});

test("combined patch changes only the API-key auth gate", () => {
  const source = gateSource + modelSource + providerTierSource;
  const patched = applyApiKeyServiceTierPatch(source);
  assert.match(patched, /o===`apikey`/);
  assert.doesNotMatch(patched, /chatgptLinuxApiKeyServiceTierModel|chatgptLinuxApiKeyFastTier/);
  assert.match(patched, /e\?\.serviceTiers/);
});
