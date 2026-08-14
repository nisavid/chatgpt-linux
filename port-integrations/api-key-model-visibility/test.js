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
  applyApiKeyServiceTierPatch,
} = require("../api-key-service-tier/patch.js");
const {
  applyApiKeyModelVisibilityPatch,
  descriptors,
} = require("./patch.js");

function applyPatchTwice(patchFn, source) {
  const once = patchFn(source);
  assert.notEqual(once, source);
  assert.equal(patchFn(once), once);
  return once;
}

function modelCatalogFixture() {
  return [
    "function ati({additionalAvailableModels:e,authMethod:t,availableModels:n,isCustomModelProvider:r,model:i,useHiddenModels:a}){return e?.has(i.model)===!0||i.model!==`codex-auto-review`&&(a&&!r&&t!==`amazonBedrock`?n.has(i.model):!i.hidden)}",
    "function iti({additionalAvailableModels:e,authMethod:t,availableModels:n,defaultModel:r,enabledReasoningEfforts:i,includeUltraReasoningEffort:a,isCustomModelProvider:o=!1,models:s,useHiddenModels:c}){let l=[],u=null;return s.forEach(r=>{if(ati({additionalAvailableModels:e,authMethod:t,availableModels:n,isCustomModelProvider:o,model:r,useHiddenModels:c})){l.push(r),r.isDefault&&(u=r)}}),u??=l.find(e=>e.model===r)??null,{models:l,defaultModel:u}}",
  ].join("");
}

function serviceTierCompatibleFixture() {
  return [
    "function ati({additionalAvailableModels:e,authMethod:t,availableModels:n,isCustomModelProvider:r,model:i,useHiddenModels:a}){return e?.has(i.model)===!0||i.model!==`codex-auto-review`&&(a&&!r&&t!==`amazonBedrock`?n.has(i.model):!i.hidden)}",
    "function iti({additionalAvailableModels:e,authMethod:t,availableModels:n,defaultModel:r,enabledReasoningEfforts:i,includeUltraReasoningEffort:a,isCustomModelProvider:o=!1,models:s,useHiddenModels:c}){let l=[],u=null,d=s.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`max`)),f=a&&s.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`ultra`));return s.forEach(r=>{if(ati({additionalAvailableModels:e,authMethod:t,availableModels:n,isCustomModelProvider:o,model:r,useHiddenModels:c})){let e=a?r.supportedReasoningEfforts:r.supportedReasoningEfforts.filter(({reasoningEffort:e})=>e!==`ultra`),n=(t===`copilot`?[e.find(e=>e.reasoningEffort===`medium`)??{reasoningEffort:`medium`,description:`medium effort`}]:e).filter(({reasoningEffort:e})=>Gx(e)&&i.has(e)),o={...r,supportedReasoningEfforts:n};l.push(o),r.isDefault&&(u=o)}}),u??=l.find(e=>e.model===r)??null,{models:l,defaultModel:u}}",
  ].join("");
}

function evaluateCatalog(source, authMethod, useHiddenModels = true, additionalAvailableModels) {
  const catalog = Function(`${source};return iti;`)();
  return catalog({
    additionalAvailableModels,
    authMethod,
    availableModels: new Set(["gpt-5.5"]),
    defaultModel: "gpt-5.5",
    enabledReasoningEfforts: new Set(),
    includeUltraReasoningEffort: true,
    isCustomModelProvider: false,
    models: [
      { model: "gpt-5.6-sol", hidden: false, isDefault: true },
      { model: "gpt-5.6-terra", hidden: false, isDefault: false },
      { model: "gpt-5.6-luna", hidden: false, isDefault: false },
      { model: "gpt-5.5", hidden: false, isDefault: false },
      { model: "codex-auto-review", hidden: true, isDefault: false },
    ],
    useHiddenModels,
  });
}

function modelNames(catalog) {
  return catalog.models.map((model) => model.model);
}

function withTempDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-model-visibility-"));
  try {
    return callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function withTempDirAsync(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-model-visibility-"));
  try {
    return await callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
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

function withFeatureConfig(enabled, callback) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  return withTempDir((tempDir) => {
    const configPath = path.join(tempDir, "integrations.json");
    fs.writeFileSync(configPath, `${JSON.stringify(integrationSelection(path.resolve(__dirname, ".."), enabled))}\n`);
    process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = configPath;
    try {
      return callback(path.resolve(__dirname, ".."));
    } finally {
      if (originalConfig == null) {
        delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
    }
  });
}

async function withFeatureConfigAsync(enabled, callback) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  return withTempDirAsync(async (tempDir) => {
    const configPath = path.join(tempDir, "integrations.json");
    fs.writeFileSync(configPath, `${JSON.stringify(integrationSelection(path.resolve(__dirname, ".."), enabled))}\n`);
    process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = configPath;
    try {
      return await callback(path.resolve(__dirname, ".."));
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

test("api-key-model-visibility stays disabled until listed in integrations.json", () => {
  withFeatureConfig([], (integrationsRoot) => {
    assert.deepEqual(loadPortIntegrationPatchDescriptors({ integrationsRoot }), []);
  });

  withFeatureConfig(["api-key-model-visibility"], (integrationsRoot) => {
    const loaded = loadPortIntegrationPatchDescriptors({ integrationsRoot });
    assert.deepEqual(
      loaded.map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
      [["integration:api-key-model-visibility:api-key-model-visibility-ui", "webview-asset", "optional"]],
    );
  });
});

test("descriptor is optional and targets app main webview chunks", () => {
  assert.deepEqual(
    descriptors.map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
    [["api-key-model-visibility-ui", "webview-asset", "optional"]],
  );
  assert.equal(descriptors[0].pattern.test("app-initial-DRyZ1Lin.js"), true);
  assert.equal(descriptors[0].pattern.test("settings-page-abc.js"), false);
});

test("API-key hosts use visible CLI models instead of the desktop allowlist", () => {
  const patched = applyPatchTwice(applyApiKeyModelVisibilityPatch, modelCatalogFixture());
  const catalog = evaluateCatalog(patched, "apikey");

  assert.match(patched, /t!==`apikey`\/\*chatgptLinuxApiKeyModelVisibility\*\//);
  assert.deepEqual(modelNames(catalog), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ]);
  assert.equal(catalog.defaultModel.model, "gpt-5.6-sol");
});

test("API-key hosts still exclude models marked hidden by the CLI", () => {
  const patched = applyApiKeyModelVisibilityPatch(modelCatalogFixture());

  assert.equal(modelNames(evaluateCatalog(patched, "apikey")).includes("codex-auto-review"), false);
});

test("explicit additional models retain the official helper override", () => {
  const patched = applyApiKeyModelVisibilityPatch(modelCatalogFixture());
  const catalog = evaluateCatalog(
    patched,
    "chatgpt",
    true,
    new Set(["codex-auto-review"]),
  );

  assert.deepEqual(modelNames(catalog), ["gpt-5.5", "codex-auto-review"]);
});

test("ChatGPT and existing no-allowlist paths keep their upstream behavior", () => {
  const patched = applyApiKeyModelVisibilityPatch(modelCatalogFixture());

  assert.deepEqual(modelNames(evaluateCatalog(patched, "chatgpt")), ["gpt-5.5"]);
  assert.deepEqual(modelNames(evaluateCatalog(patched, "chatgpt", false)), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ]);
  assert.deepEqual(modelNames(evaluateCatalog(patched, "amazonBedrock")), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ]);
});

test("model visibility composes with provider-authoritative API key service tiers", () => {
  const source = serviceTierCompatibleFixture();
  const visibilityFirst = applyApiKeyServiceTierPatch(
    applyApiKeyModelVisibilityPatch(source),
  );
  const serviceTierFirst = applyApiKeyModelVisibilityPatch(
    applyApiKeyServiceTierPatch(source),
  );

  assert.equal(visibilityFirst, serviceTierFirst);
  for (const patched of [visibilityFirst, serviceTierFirst]) {
    assert.match(patched, /chatgptLinuxApiKeyModelVisibility/);
    assert.doesNotMatch(patched, /chatgptLinuxApiKeyServiceTierModel/);
  }
});

test("extended upstream model gates fail soft instead of patching mid-expression", () => {
  const source = modelCatalogFixture().replace(
    "a&&!r&&t!==`amazonBedrock`?",
    "a&&!r&&t!==`amazonBedrock`&&featureGate?",
  );

  assert.equal(applyApiKeyModelVisibilityPatch(source), source);
});

test("enabled descriptor patches a matching extracted webview asset", async () => {
  await withFeatureConfigAsync(["api-key-model-visibility"], async (integrationsRoot) => {
    await withTempDirAsync(async (extractedDir) => {
      const assetsDir = path.join(extractedDir, "webview", "assets");
      const assetPath = path.join(assetsDir, "app-initial-fixture.js");
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(assetPath, modelCatalogFixture());

      const normalized = normalizePatchDescriptors(
        loadPortIntegrationPatchDescriptors({ integrationsRoot }),
      );
      await applyWebviewAssetPatchDescriptorsWithMutation(
        extractedDir,
        normalized,
        {},
        null,
      );

      assert.match(fs.readFileSync(assetPath, "utf8"), /chatgptLinuxApiKeyModelVisibility/);
    });
  });
});
