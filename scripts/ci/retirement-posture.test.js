const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const workflowRoot = path.join(repoRoot, ".github/workflows");

const retiredWorkflowFiles = [
  "cachix.yml",
  "codeql.yml",
  "computer-use-sync-reminder.yml",
  "contributor-pr-limit.yml",
  "manage-labels.yml",
  "rust-clippy.yml",
  "update-chatgpt-hash.yml",
];

test("retirement posture replaces install and support entry points", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const retirement = fs.readFileSync(
    path.join(repoRoot, "docs/retirement.md"),
    "utf8",
  );

  assert.match(readme, /retired and unsupported/i);
  assert.match(readme, /chatgpt-desktop-bin/);
  assert.match(readme, /ilysenko\/codex-desktop-linux/);
  assert.match(readme, /unofficial community project/i);
  assert.doesNotMatch(readme, /^## Quick Start$/m);
  assert.doesNotMatch(readme, /^## Local Updater$/m);

  assert.match(retirement, /official-app-parity-2026-08\.md/);
  assert.match(retirement, /rollback-evidence-retention-boundary-2026-08\.md/);
  assert.match(retirement, /arch-pkgs\/issues\/76/);
  assert.match(retirement, /arch-pkgs\/issues\/77/);
  assert.match(retirement, /10 open Dependabot alerts/);
  assert.match(retirement, /CodeQL alert #163/);
  assert.match(retirement, /unresolved retired risk/i);
});

test("retirement posture disables dependency and maintenance producers", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, ".github/dependabot.yml")),
    false,
  );

  for (const workflow of retiredWorkflowFiles) {
    assert.equal(
      fs.existsSync(path.join(workflowRoot, workflow)),
      false,
      `${workflow} must remain retired`,
    );
  }
});

test("remaining workflows cannot schedule or mutate repository maintenance state", () => {
  const workflows = fs
    .readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

  for (const workflow of workflows) {
    const source = fs.readFileSync(path.join(workflowRoot, workflow), "utf8");
    assert.doesNotMatch(source, /^\s*schedule:\s*$/m, workflow);
    assert.doesNotMatch(source, /^\s*(actions|contents|issues|pull-requests|security-events):\s*write\s*$/m, workflow);
  }

  const officialDmg = fs.readFileSync(
    path.join(workflowRoot, "official-dmg-build-app.yml"),
    "utf8",
  );
  assert.match(officialDmg, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(officialDmg, /^\s*(push|schedule|workflow_dispatch):/m);
  assert.doesNotMatch(officialDmg, /reconcile-official-dmg-issue/);
  assert.doesNotMatch(officialDmg, /reconcileUpstreamDmgIssue/);
});
