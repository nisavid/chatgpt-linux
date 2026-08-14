"use strict";

const JS_IDENT = "[A-Za-z_$][\\w$]*";
const PATCH_MARKER = "chatgptLinuxApiKeyModelVisibility";

function warn(message, patchName) {
  console.warn(`WARN: ${message} - skipping ${patchName}`);
}

function applyApiKeyModelVisibilityPatch(source) {
  const modelVisibilityPattern = new RegExp(
    "(function " + JS_IDENT + "\\(\\{additionalAvailableModels:" + JS_IDENT +
      ",authMethod:(" + JS_IDENT + "),availableModels:" + JS_IDENT +
      ",isCustomModelProvider:(" + JS_IDENT + "),model:(" + JS_IDENT +
      "),useHiddenModels:(" + JS_IDENT + ")\\}\\)" +
      "\\{return [^{}]{0,300}?\\|\\|\\4\\.model!==`codex-auto-review`&&\\()" +
      "\\5&&!\\3&&\\2!==`amazonBedrock`(?=\\?)",
    "g",
  );

  const patched = source.replace(
    modelVisibilityPattern,
    (_match, prefix, authMethodVar, customProviderVar, _modelVar, useHiddenModelsVar) =>
      `${prefix}${useHiddenModelsVar}&&!${customProviderVar}&&` +
      `${authMethodVar}!==\`amazonBedrock\`&&` +
      `${authMethodVar}!==\`apikey\`/*${PATCH_MARKER}*/`,
  );

  if (patched !== source || source.includes(`/*${PATCH_MARKER}*/`)) {
    return patched;
  }

  if (
    source.includes("additionalAvailableModels") &&
    source.includes("useHiddenModels") &&
    source.includes("amazonBedrock")
  ) {
    warn("Could not find desktop model allowlist gate", "API key model visibility patch");
  }
  return source;
}

const descriptors = [
  {
    id: "api-key-model-visibility-ui",
    phase: "webview-asset",
    order: 20550,
    ciPolicy: "optional",
    pattern: /^app-initial-[A-Za-z0-9_-]+\.js$/,
    missingDescription: "app main webview bundle",
    skipDescription: "API key model visibility patch",
    apply: applyApiKeyModelVisibilityPatch,
  },
];

module.exports = {
  applyApiKeyModelVisibilityPatch,
  descriptors,
};
