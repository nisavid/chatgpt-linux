"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyMainBundlePatchDescriptors,
  applyWebviewAssetPatchDescriptors,
} = require("./engine.js");
const {
  GeneratedAppIntegrityError,
} = require("./lib/generated-app-mutation-client.js");

test("generated-app integrity errors bypass descriptor policy and stop later patches", () => {
  let laterRan = false;
  const descriptors = [
    {
      id: "integrity-failure",
      phase: "main-bundle",
      ciPolicy: "optional",
      order: 10,
      apply() {
        throw new GeneratedAppIntegrityError("candidate identity changed", {
          code: "integrity",
          operation: "replace",
        });
      },
    },
    {
      id: "must-not-run",
      phase: "main-bundle",
      ciPolicy: "optional",
      order: 20,
      apply(source) {
        laterRan = true;
        return `${source}|later`;
      },
    },
  ];

  assert.throws(
    () => applyMainBundlePatchDescriptors("original", descriptors, {}, null),
    (error) =>
      error instanceof GeneratedAppIntegrityError &&
      error.code === "integrity" &&
      error.operation === "replace",
  );
  assert.equal(laterRan, false);
});

test("webview integrity errors reject the async phase before later descriptors", async () => {
  let laterRan = false;
  const integrityFailure = new GeneratedAppIntegrityError("candidate identity changed", {
    code: "integrity",
    operation: "list",
  });
  const context = {
    generatedAppMutation: {
      async list() {
        throw integrityFailure;
      },
    },
  };
  const descriptors = [
    {
      id: "integrity-failure",
      phase: "webview-asset",
      ciPolicy: "optional",
      order: 10,
      pattern: /^app-.*\.js$/,
      apply: (source) => source,
    },
    {
      id: "must-not-run",
      phase: "webview-asset",
      ciPolicy: "optional",
      order: 20,
      pattern: /^app-.*\.js$/,
      apply(source) {
        laterRan = true;
        return source;
      },
    },
  ];

  await assert.rejects(
    applyWebviewAssetPatchDescriptors("unused", descriptors, context, null),
    (error) => error === integrityFailure,
  );
  assert.equal(laterRan, false);
});

test("central patch orchestration has no direct filesystem mutation calls", () => {
  for (const relativePath of ["engine.js", "runner.js"]) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /\b(?:fs|require\(["']node:fs["']\))\s*\.\s*(?:appendFile|chmod|chown|copyFile|cp|createWriteStream|mkdir|rename|rm|rmdir|truncate|unlink|writeFile)(?:Sync)?\s*\(/,
      relativePath,
    );
  }
});
