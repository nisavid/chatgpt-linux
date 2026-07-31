"use strict";

function applyMainBundlePatch(source) {
  const marker = "codexLinuxExampleIntegrationDisabled()";
  if (!source.includes(marker)) {
    console.warn("WARN: Example port integration marker not found — skipping example integration patch");
    return source;
  }
  return source.replace(marker, "codexLinuxExampleIntegrationEnabled()");
}

const descriptors = [
  {
    id: "synthetic-marker",
    phase: "main-bundle",
    order: 20_000,
    ciPolicy: "optional",
    apply: applyMainBundlePatch,
  },
];

module.exports = {
  applyMainBundlePatch,
  descriptors,
};
