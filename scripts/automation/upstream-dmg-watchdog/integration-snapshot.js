#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const {
  enabledPortIntegrationsConfig,
  loadEnabledPortIntegrations,
} = require("../../lib/port-integrations.js");

function main() {
  const checkout = process.argv[2];
  if (!checkout) {
    throw new Error("usage: integration-snapshot.js CHECKOUT");
  }
  const sourceCheckout = path.resolve(checkout);
  const integrationsRoot = path.join(sourceCheckout, "port-integrations");
  const config = enabledPortIntegrationsConfig({ integrationsRoot, strictConfig: true });
  const integrations = loadEnabledPortIntegrations({ integrationsRoot, strictConfig: true });
  process.stdout.write(`${JSON.stringify({
    sourceCheckout,
    integrationsRoot,
    config,
    hasLocalConfig: fs.existsSync(path.join(integrationsRoot, "integrations.json")),
    enabled: integrations.map((integration) => integration.id),
    local: integrations
      .filter((integration) => integration.local)
      .map((integration) => ({ id: integration.id, dir: integration.dir })),
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
