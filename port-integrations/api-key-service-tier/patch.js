"use strict";

const JS_IDENT = "[A-Za-z_$][\\w$]*";
const PATCH_MARKER = "chatgptLinuxApiKeyFastTier";
const MODEL_MARKER = "chatgptLinuxApiKeyServiceTierModel";
const SERVICE_TIER_GATE_SHAPE = new RegExp(
  `authMethod===\`chatgpt\`[\\s\\S]{0,200}?authMethod\\?\\?null` +
    `[\\s\\S]{0,1200}?featureRequirements\\?\\.fast_mode` +
    `[\\s\\S]{0,500}?\\{isServiceTierAllowed:${JS_IDENT},isLoading:${JS_IDENT}\\}`,
);
const PATCHED_SERVICE_TIER_GATE = new RegExp(
  `${JS_IDENT}=!${JS_IDENT}&&\\(${JS_IDENT}\\?${JS_IDENT}!=null&&` +
    `${JS_IDENT}\\?\\.requirements\\?\\.featureRequirements\\?\\.fast_mode!==!1:` +
    `${JS_IDENT}===\`apikey\`\\)`,
);
const PATCHED_MODEL_MARKER = new RegExp(`${MODEL_MARKER}:${JS_IDENT}===\\\`apikey\\\``);
const MODEL_LIST_MAPPING_SHAPE = new RegExp(
  `function ${JS_IDENT}\\(\\{authMethod:${JS_IDENT},availableModels:${JS_IDENT},` +
    `defaultModel:${JS_IDENT},enabledReasoningEfforts:${JS_IDENT},` +
    `includeUltraReasoningEffort:${JS_IDENT},models:${JS_IDENT},useHiddenModels:${JS_IDENT}\\}\\)` +
    `\\{[\\s\\S]{0,3000}?supportedReasoningEfforts[\\s\\S]{0,1200}?isDefault`,
);

function warn(message, patchName) {
  console.warn(`WARN: ${message} - skipping ${patchName}`);
}

function applyApiKeyServiceTierGatePatch(source) {
  const gateNeedle = new RegExp(
    `(${JS_IDENT})=(${JS_IDENT})\\?\\.authMethod===\\\`chatgpt\\\`,` +
      `(${JS_IDENT})=\\2\\?\\.authMethod\\?\\?null([\\s\\S]{0,500}?),` +
      `d=\\1&&!(${JS_IDENT})&&(${JS_IDENT})!=null&&\\6\\?\\.requirements\\?\\.featureRequirements\\?\\.fast_mode!==!1`,
    "g",
  );

  const patched = source.replace(
    gateNeedle,
    (_match, isChatGptVar, hostVar, authMethodVar, middle, loadingVar, requirementsVar) =>
      `${isChatGptVar}=${hostVar}?.authMethod===\`chatgpt\`,` +
      `${authMethodVar}=${hostVar}?.authMethod??null${middle},` +
      `d=!${loadingVar}&&(${isChatGptVar}?${requirementsVar}!=null&&${requirementsVar}?.requirements?.featureRequirements?.fast_mode!==!1:${authMethodVar}===\`apikey\`)`,
  );

  if (patched !== source || PATCHED_SERVICE_TIER_GATE.test(source)) {
    return patched;
  }

  if (hasApiKeyServiceTierGateShape(source)) {
    warn("Could not find service tier auth gate", "API key service tier gate patch");
  }
  return source;
}

function hasApiKeyServiceTierGateShape(source) {
  return SERVICE_TIER_GATE_SHAPE.test(source);
}

function applyApiKeyModelMarkerPatch(source) {
  if (PATCHED_MODEL_MARKER.test(source)) {
    return source;
  }

  const modelListPattern = new RegExp(
    `(function ${JS_IDENT}\\(\\{authMethod:(${JS_IDENT}),availableModels:${JS_IDENT},` +
      `defaultModel:${JS_IDENT},enabledReasoningEfforts:${JS_IDENT},` +
      `includeUltraReasoningEffort:${JS_IDENT},models:${JS_IDENT},useHiddenModels:${JS_IDENT}\\}\\)` +
      `\\{[\\s\\S]{0,1800}?[,;]${JS_IDENT}=\\{\\.\\.\\.${JS_IDENT},supportedReasoningEfforts:${JS_IDENT})(\\})`,
    "g",
  );

  const patched = source.replace(
    modelListPattern,
    (_match, prefix, authMethodVar, suffix) => `${prefix},${MODEL_MARKER}:${authMethodVar}===\`apikey\`${suffix}`,
  );

  if (patched !== source) {
    return patched;
  }

  if (hasApiKeyModelListMappingShape(source)) {
    warn("Could not find model list mapping", "API key model service tier marker patch");
  }
  return source;
}

function hasApiKeyModelListMappingShape(source) {
  return MODEL_LIST_MAPPING_SHAPE.test(source);
}

function hasCompleteFallbackFastTierPatch(source) {
  return (
    source.includes(`function ${PATCH_MARKER}(`) &&
    source.includes(`??${PATCH_MARKER}(`) &&
    source.includes(`[${PATCH_MARKER}(`) &&
    source.includes(".filter(Boolean)).map")
  );
}

function applyFallbackFastTierPatch(source) {
  // Provider capabilities are authoritative. Never synthesize a service tier.
  return source;
}

function applyApiKeyServiceTierPatch(source) {
  return applyApiKeyServiceTierGatePatch(source);
}

function applyCurrentGatePatch(source) {
  const gateAlreadyPatched = PATCHED_SERVICE_TIER_GATE.test(source);
  const gateCandidate = gateAlreadyPatched ? source : applyApiKeyServiceTierGatePatch(source);
  const gateReady = gateAlreadyPatched || gateCandidate !== source;

  if (!gateReady && !hasApiKeyServiceTierGateShape(source)) {
    warn("Could not identify current service tier auth gate", "API key service tier gate patch");
  }
  return gateCandidate;
}

function applyCurrentModelPatch(source) {
  return source;
}

function applyCurrentFallbackFastTierPatch(source) {
  return source;
}

const descriptors = [
  {
    id: "api-key-service-tier-gate",
    phase: "webview-asset",
    order: 20600,
    ciPolicy: "optional",
    pattern: /^app-initial-[A-Za-z0-9_-]+\.js$/,
    missingDescription: "current API key service tier gate bundle",
    skipDescription: "API key service tier gate patch",
    apply: applyCurrentGatePatch,
  },

];

module.exports = {
  applyApiKeyModelMarkerPatch,
  applyApiKeyServiceTierGatePatch,
  applyFallbackFastTierPatch,
  applyApiKeyServiceTierPatch,
  applyCurrentGatePatch,
  applyCurrentModelPatch,
  applyCurrentFallbackFastTierPatch,
  hasApiKeyServiceTierGateShape,
  hasApiKeyModelListMappingShape,
  descriptors,
};
