"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = path.join(
  __dirname,
  "..",
  "..",
  "port-integrations",
  "integrations.example.json",
);

const { corePatchDescriptors } = require("./runner.js");

test("does not expose the obsolete Sparkle updater menu patch", () => {
  assert.equal(
    corePatchDescriptors().some((descriptor) => descriptor.id === "linux-app-updater-menu"),
    false,
  );
});
