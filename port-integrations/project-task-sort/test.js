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
const { patchAssetFiles } = require("../../scripts/patches/lib/assets.js");
const {
  applyProjectTaskSortPatch,
  descriptors,
} = require("./patch.js");

const currentProjectSource =
  "function _os(e,t){switch(e.kind){case`local`:return e.conversation==null?e.pendingWorktree.createdAt:t===`updated_at`?e.conversation.recencyAt??e.conversation.updatedAt:e.conversation.createdAt;case`remote`:return((t===`updated_at`?e.task.updated_at??e.task.created_at:e.task.created_at??e.task.updated_at)??0)*1e3}}";

function captureWarns(fn) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

function applyPatchTwice(source) {
  const patched = applyProjectTaskSortPatch(source);
  const { value: secondPass, warnings } = captureWarns(() =>
    applyProjectTaskSortPatch(patched),
  );
  assert.equal(secondPass, patched);
  assert.deepEqual(warnings, []);
  return patched;
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

function withFeatureConfig(enabled, fn) {
  const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-task-sort-"));
  process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(tempDir, "integrations.json");
  try {
    fs.writeFileSync(process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG, JSON.stringify(integrationSelection(path.resolve(__dirname, ".."), enabled)));
    return fn();
  } finally {
    if (originalConfig == null) {
      delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    } else {
      process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("feature is disabled until selected", () => {
  const integrationsRoot = path.resolve(__dirname, "..");
  withFeatureConfig([], () => {
    assert.equal(
      loadPortIntegrationPatchDescriptors({ integrationsRoot })
        .some((descriptor) => descriptor.id === "integration:project-task-sort:creation-time"),
      false,
    );
  });
  withFeatureConfig(["project-task-sort"], () => {
    assert.equal(
      loadPortIntegrationPatchDescriptors({ integrationsRoot })
        .some((descriptor) => descriptor.id === "integration:project-task-sort:creation-time"),
      true,
    );
  });
});

test("patch recovers local UUIDv7 creation time", () => {
  const patched = applyPatchTwice(currentProjectSource);

  assert.ok(
    patched.includes(
      "e.conversation.createdAt??(/^local:[\\da-f]{8}-[\\da-f]{4}-7[\\da-f]{3}-[89ab][\\da-f]{3}-[\\da-f]{12}$/i.test(e.key)?Number.parseInt(e.key.slice(6).replaceAll(`-`,``).slice(0,12),16):e.conversation.recencyAt??e.conversation.updatedAt)",
    ),
  );

  const context = {};
  vm.runInNewContext(`${patched};globalThis.timestamp=_os`, context);
  const older = {
    key: "local:019e0000-0000-7000-8000-000000000001",
    kind: "local",
    conversation: { recencyAt: 400 },
  };
  const newer = {
    key: "local:019f0000-0000-7000-8000-000000000002",
    kind: "local",
    conversation: { recencyAt: 100 },
  };

  assert.ok(context.timestamp(newer, "created_at") > context.timestamp(older, "created_at"));
  assert.equal(context.timestamp(older, "updated_at"), 400);
  assert.equal(
    context.timestamp({ ...older, conversation: { createdAt: 123, recencyAt: 400 } }, "created_at"),
    123,
  );
  assert.equal(
    context.timestamp(
      { ...older, key: "local:legacy-id", conversation: { recencyAt: 500 } },
      "created_at",
    ),
    500,
  );
  assert.equal(
    context.timestamp(
      { ...older, key: "local:019e0000-0000-7garbage", conversation: { recencyAt: 600 } },
      "created_at",
    ),
    600,
  );
  assert.equal(
    context.timestamp(
      {
        ...older,
        key: "local:019e0000-0000-7000-7000-000000000001",
        conversation: { recencyAt: 700 },
      },
      "created_at",
    ),
    700,
  );
  const remote = { kind: "remote", task: { created_at: 10, updated_at: 20 } };
  assert.equal(context.timestamp(remote, "created_at"), 10_000);
  assert.equal(context.timestamp(remote, "updated_at"), 20_000);
});

test("drift leaves the asset byte-identical", () => {
  const source = currentProjectSource.replace(
    "e.pendingWorktree.createdAt",
    "e.pendingWorktree.createdTimestamp",
  );
  const { value, warnings } = captureWarns(() => applyProjectTaskSortPatch(source));

  assert.equal(value, source);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /project task creation timestamp insertion point/);
});

test("mixed patched and clean helpers are rejected byte-identically", () => {
  const mixed = `${applyProjectTaskSortPatch(currentProjectSource)}${currentProjectSource}`;
  const { value, warnings } = captureWarns(() => applyProjectTaskSortPatch(mixed));

  assert.equal(value, mixed);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /project task creation timestamp insertion point/);
});

test("descriptor targets and patches the current project chunk", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-task-sort-assets-"));
  try {
    const assetsDir = path.join(tempDir, "webview", "assets");
    const assetPath = path.join(
      assetsDir,
      "app-initial-DRyZ1Lin.js",
    );
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(assetPath, currentProjectSource);

    const result = patchAssetFiles(
      tempDir,
      descriptors[0].pattern,
      descriptors[0].apply,
      "missing",
    );

    assert.deepEqual(result, { matched: 1, changed: 1 });
    assert.notEqual(fs.readFileSync(assetPath, "utf8"), currentProjectSource);
    assert.equal(
      descriptors[0].pattern.test(
        "app-initial~app-main~projects-index-page~remote-conversation-page-y7pwA1Hj.js",
      ),
      false,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
