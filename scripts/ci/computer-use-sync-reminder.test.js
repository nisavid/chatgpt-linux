const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Computer Use issue-producing sync reminder remains retired", () => {
  assert.equal(
    fs.existsSync(
      path.resolve(
        __dirname,
        "../../.github/workflows/computer-use-sync-reminder.yml",
      ),
    ),
    false,
  );
});
