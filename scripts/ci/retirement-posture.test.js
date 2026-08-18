const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const workflowRoot = path.join(repoRoot, ".github/workflows");

const retiredWorkflowFiles = [
  "cachix.yml",
  "computer-use-sync-reminder.yml",
  "contributor-pr-limit.yml",
  "manage-labels.yml",
  "update-chatgpt-hash.yml",
];

const requiredPullRequestScannerFiles = ["codeql.yml", "rust-clippy.yml"];

const historicalAgentEntryPoints = [
  "DESIGN.md",
  "PRODUCT.md",
  ".agents/skills/maintaining-chatgpt-package/SKILL.md",
  "docs/agents/domain.md",
  "docs/agents/generated-and-runtime-notes.md",
  "docs/agents/repository-map.md",
  "docs/agents/validation-playbook.md",
  "docs/github-cli-auth.md",
  "docs/label-governance.md",
  "docs/maintainers/security-best-practices.md",
  "docs/maintainers/security-backlog.md",
  "docs/maintainers/threat-model.md",
  "docs/policies/agentic-maintenance.md",
  "port-integrations/agent-workspace/README.md",
  "port-integrations/x11-ewmh-computer-use/README.md",
  "scripts/automation/upstream-dmg-watchdog/SKILL.md",
  "scripts/automation/upstream-dmg-watchdog/local-skill-adapter.md",
];

function collectWorkflowWritePermissions(source) {
  const writeAll = source
    .split("\n")
    .some((line) => /^\s*permissions\s*:\s*write-all\s*(?:#.*)?$/.test(line));
  const writeKeys = new Set();
  const writePermission =
    /(?:^\s*|[{,]\s*)(["']?)([a-z][a-z0-9-]*)\1\s*:\s*write(?=\s*(?:[,}]|#|$))/gi;

  for (const line of source.split("\n")) {
    for (const match of line.matchAll(writePermission)) {
      writeKeys.add(match[2]);
    }
  }

  return { writeAll, writeKeys: [...writeKeys].sort() };
}

function assertRetirementWorkflowPermissions(workflow, source) {
  const { writeAll, writeKeys } = collectWorkflowWritePermissions(source);
  assert.equal(writeAll, false, `${workflow} must reject permissions: write-all`);

  const expectedWriteKeys = requiredPullRequestScannerFiles.includes(workflow)
    ? ["security-events"]
    : [];
  assert.deepEqual(
    writeKeys,
    expectedWriteKeys,
    `${workflow} has unapproved write permissions: ${writeKeys.join(", ")}`,
  );
}

test("retirement permission audit rejects every unapproved write scope", () => {
  assert.doesNotThrow(() =>
    assertRetirementWorkflowPermissions(
      "codeql.yml",
      "permissions:\n  contents: read\n  security-events: write\n",
    ),
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "permissions: write-all\n",
      ),
    /write-all/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "permissions:\n  checks: write\n",
      ),
    /checks/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "rust-clippy.yml",
        "permissions:\n  security-events: write\n  packages: write\n",
      ),
    /packages/,
  );
});

test("retirement posture replaces install and support entry points", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const contributing = fs.readFileSync(
    path.join(repoRoot, "CONTRIBUTING.md"),
    "utf8",
  );
  const security = fs.readFileSync(path.join(repoRoot, "SECURITY.md"), "utf8");
  const pullRequestTemplate = fs.readFileSync(
    path.join(repoRoot, ".github/pull_request_template.md"),
    "utf8",
  );
  const pullRequestTemplateProse = pullRequestTemplate.replace(/^>\s?/gm, "");
  const backlog = fs.readFileSync(path.join(repoRoot, "docs/backlog.md"), "utf8");
  const issueTracker = fs.readFileSync(
    path.join(repoRoot, "docs/agents/issue-tracker.md"),
    "utf8",
  );
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

  assert.match(contributing, /retired and unsupported/i);
  assert.match(contributing, /not accepting\s+contributions/i);
  assert.doesNotMatch(contributing, /Contributions of all sizes are welcome/i);
  assert.doesNotMatch(contributing, /^## Development Setup$/m);

  assert.match(security, /retired and unsupported/i);
  assert.match(security, /does not accept vulnerability reports/i);
  assert.doesNotMatch(security, /^## Supported Versions$/m);
  assert.doesNotMatch(security, /maintainers coordinate the fix/i);

  assert.match(pullRequestTemplate, /owner-directed retirement closeout/i);
  assert.match(
    pullRequestTemplateProse,
    /does not accept\s+maintenance contributions/i,
  );
  assert.doesNotMatch(pullRequestTemplate, /automated bot will close/i);
  assert.doesNotMatch(pullRequestTemplate, /latest `ChatGPT\.dmg`/i);

  assert.match(backlog, /closed to new work/i);
  assert.doesNotMatch(backlog, /Keep new durable work items/i);
  assert.doesNotMatch(backlog, /active queue/i);

  assert.match(issueTracker, /retirement closeout/i);
  assert.doesNotMatch(issueTracker, /gh issue create/);
  assert.doesNotMatch(issueTracker, /Create a GitHub issue/i);

  assert.match(retirement, /official-app-parity-2026-08\.md/);
  assert.match(retirement, /rollback-evidence-retention-boundary-2026-08\.md/);
  assert.match(retirement, /arch-pkgs\/issues\/76/);
  assert.match(retirement, /arch-pkgs\/issues\/77/);
  assert.match(retirement, /10 open Dependabot alerts/);
  assert.match(retirement, /CodeQL alert #163/);
  assert.match(
    retirement,
    /https:\/\/github\.com\/nisavid\/chatgpt-linux\/security\/code-scanning\/163/,
  );
  assert.doesNotMatch(retirement, /(?:^|\s)#(?:23|33|2[4-9]|30|32)\b/m);
  assert.match(retirement, /unresolved retired risk/i);
  assert.match(retirement, /will be archived only after that\s+closeout/i);
  assert.doesNotMatch(retirement, /repository is archived/i);
});

test("direct agent and security entry points fail closed into retirement", () => {
  for (const relativePath of historicalAgentEntryPoints) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    const prose = source.replace(/^>\s?/gm, "");
    assert.match(prose, /retired and unsupported/i, relativePath);
    assert.match(prose, /retirement\.md/, relativePath);
    assert.match(
      prose,
      /do not\s+(?:use (?:it|this)|run it) to (?:start|continue)/i,
      relativePath,
    );
  }

  const labelGovernance = fs.readFileSync(
    path.join(repoRoot, "docs/label-governance.md"),
    "utf8",
  );
  assert.doesNotMatch(labelGovernance, /\.github\/workflows\/manage-labels\.yml/);
  assert.doesNotMatch(labelGovernance, /GITHUB_TOKEN=.*manage-labels\.js/);
  assert.doesNotMatch(labelGovernance, /trusted manual workflow/i);
  assert.doesNotMatch(labelGovernance, /repository-owned issue producers must/i);
  assert.match(labelGovernance, /former manual label workflow/i);
  assert.match(labelGovernance, /not an authorized mutation path/i);

  const forkDivergences = fs.readFileSync(
    path.join(repoRoot, "docs/maintainers/fork-divergences.md"),
    "utf8",
  );
  assert.doesNotMatch(
    forkDivergences,
    /\*\*Current paths:\*\*[^\n]*update-chatgpt-hash\.yml/,
  );
  assert.match(forkDivergences, /removed at retirement/i);

  const threatModel = fs.readFileSync(
    path.join(repoRoot, "docs/maintainers/threat-model.md"),
    "utf8",
  );
  assert.doesNotMatch(threatModel, /maintained security backlog/i);
  assert.doesNotMatch(threatModel, /implementation tickets/i);
  assert.match(threatModel, /former write-capable/i);
});

test("retired watchdog public CLI exposes status but rejects mutation", () => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatgpt-retired-watchdog-"),
  );
  const binDir = path.join(fixtureRoot, "bin");
  const stateDir = path.join(fixtureRoot, "state");
  const ghMarker = path.join(fixtureRoot, "gh-called");
  const watchdog = path.join(
    repoRoot,
    "scripts/automation/upstream-dmg-watchdog/watchdog.py",
  );
  fs.mkdirSync(binDir);
  const fakeGh = path.join(binDir, "gh");
  fs.writeFileSync(
    fakeGh,
    '#!/bin/sh\n: > "$WATCHDOG_GH_MARKER"\nexit 99\n',
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    WATCHDOG_GH_MARKER: ghMarker,
  };

  try {
    const rejected = childProcess.spawnSync(
      "python3",
      [watchdog, "probe", "--state-dir", stateDir],
      { encoding: "utf8", env },
    );
    assert.equal(rejected.status, 6, rejected.stderr);
    assert.match(rejected.stderr, /watchdog is retired/i);
    assert.equal(fs.existsSync(ghMarker), false);
    assert.equal(fs.existsSync(stateDir), false);

    const status = childProcess.spawnSync(
      "python3",
      [watchdog, "status", "--state-dir", stateDir],
      { encoding: "utf8", env },
    );
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).schema, 2);
    assert.equal(fs.existsSync(ghMarker), false);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
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

  for (const workflow of requiredPullRequestScannerFiles) {
    const source = fs.readFileSync(path.join(workflowRoot, workflow), "utf8");
    assert.match(source, /^\s*pull_request:\s*$/m, workflow);
    assert.doesNotMatch(
      source,
      /^\s*(push|schedule|workflow_dispatch):/m,
      workflow,
    );
    assert.match(source, /^\s*security-events:\s*write\s*$/m, workflow);
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
    assertRetirementWorkflowPermissions(workflow, source);
  }

  const officialDmg = fs.readFileSync(
    path.join(workflowRoot, "official-dmg-build-app.yml"),
    "utf8",
  );
  assert.match(officialDmg, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(officialDmg, /^\s*(push|schedule|workflow_dispatch):/m);
  assert.doesNotMatch(officialDmg, /reconcile-official-dmg-issue/);
  assert.doesNotMatch(officialDmg, /reconcileUpstreamDmgIssue/);

  const ci = fs.readFileSync(path.join(workflowRoot, "ci.yml"), "utf8");
  assert.doesNotMatch(ci, /scheduled hash-refresh workflow/i);
  assert.doesNotMatch(ci, /hash-refresh workflow owns/i);
  assert.doesNotMatch(ci, /migration in issue #123/i);
  assert.match(ci, /historical external cache/i);
  assert.match(ci, /no maintenance producer/i);

  const appleDmg = fs.readFileSync(
    path.join(workflowRoot, "verify-apple-dmg.yml"),
    "utf8",
  );
  assert.doesNotMatch(appleDmg, /hash-refresh verification runs/i);
  assert.match(appleDmg, /read-only verification runs/i);
});
