#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  enabledPortIntegrationIds,
  integrationsJsonSummary,
} = require("../scripts/lib/port-integrations.js");

const integrationsRoot = __dirname;

const establishedDefaults = [
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

const reviewedDefaults = [
  "api-key-model-visibility",
  "api-key-service-tier",
  "global-dictation",
  "omarchy-theme",
  "persistent-status-panel",
  "pet-overlay",
  "project-group-last-updated-sort",
  "project-task-sort",
  "shared-app-server-socket",
  "ssh-command-wrapper",
  "ui-tweaks",
];

test("default integration policy exposes established and reviewed capabilities", () => {
  assert.deepEqual(
    enabledPortIntegrationIds({ integrationsRoot }).sort(),
    [...establishedDefaults, ...reviewedDefaults].sort(),
  );
});

test("deferred and resource-tradeoff integrations stay disabled", () => {
  const summaries = new Map(
    integrationsJsonSummary({ integrationsRoot }).map((integration) => [
      integration.id,
      integration,
    ]),
  );
  for (const id of [
    "authenticated-proxy",
    "codex-micro",
    "directory-only-working-tree-watch",
    "mcp-helper-reaper",
    "record-and-replay",
    "shallow-repository-watches",
  ]) {
    assert.equal(summaries.get(id)?.defaultEnabled, false, id);
  }
});

test("superseded and legacy wrapper integration ids are absent", () => {
  const ids = new Set(
    integrationsJsonSummary({ integrationsRoot }).map((integration) => integration.id),
  );
  assert.equal(ids.has("zed-opener"), false);
  assert.equal(ids.has("codex-wrapper-updater"), false);
  assert.equal(ids.has("chatgpt-wrapper-updater"), true);
  assert.equal(path.basename(integrationsRoot), "port-integrations");
});
