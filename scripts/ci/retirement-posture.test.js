const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
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
const historicalExecutableFencePattern = /(?:`{3,}|~{3,})/;

// actionlint validates syntax; exact digests freeze the reviewed
// retirement-only semantics.
const retainedWorkflowDigests = new Map([
  [
    "ci.yml",
    "d9c3973e495b687afd57eee948944ad4744f047e8524c6d967bf19075312f11f",
  ],
  [
    "codeql.yml",
    "94cae7fb4319d32a2ae265c7afd276c7727c493416c7584756e6a3d74fd31bc5",
  ],
  [
    "install-deps.yml",
    "caba37cc040b444099a358ef262461ff17ecce37750727634d86115faae633a4",
  ],
  [
    "official-dmg-build-app.yml",
    "9868109e49926bfe830b944af45c4b6b4c2851ba69cc647a6c201258b6e2915b",
  ],
  [
    "rust-clippy.yml",
    "fc045e04723fde9a3a2e79f0958cfdcad029ce450c0e728fd671352eba2db4c7",
  ],
  [
    "updater.yml",
    "e20b022b64b09a8675425e4e3a95a4cfa333d1848470f81536b5eeb362aaad16",
  ],
  [
    "verify-apple-dmg.yml",
    "009a063b868bffa2e52a539b91221e3353c7abaf57991cd44f72108e163ce01c",
  ],
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assertRetainedWorkflowDigest(workflow, bytes) {
  const expected = retainedWorkflowDigests.get(workflow);
  assert.ok(expected, `${workflow} has no frozen retirement workflow digest`);
  assert.equal(sha256(bytes), expected, `${workflow} changed after retirement`);
}

function assertRetainedWorkflowFile(workflow, workflowPath) {
  assert.equal(
    fs.lstatSync(workflowPath).isFile(),
    true,
    `${workflow} must remain a regular file`,
  );
  assertRetainedWorkflowDigest(workflow, fs.readFileSync(workflowPath));
}

function assertRetainedWorkflowDirectories(repositoryRoot) {
  for (const relativePath of [".github", ".github/workflows"]) {
    assert.equal(
      fs.lstatSync(path.join(repositoryRoot, relativePath)).isDirectory(),
      true,
      `${relativePath} must remain a real directory`,
    );
  }
}

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
  "docs/maintainers/fork-sync-policy.md",
  "docs/maintainers/threat-model.md",
  "docs/policies/agentic-maintenance.md",
  "docs/upstream-dmg-acceptance.md",
  "docs/usage/troubleshooting.md",
  "port-integrations/agent-workspace/README.md",
  "port-integrations/x11-ewmh-computer-use/README.md",
  "scripts/automation/upstream-dmg-watchdog/SKILL.md",
  "scripts/automation/upstream-dmg-watchdog/local-skill-adapter.md",
];

const nonExecutableHistoricalEntryPoints = new Map([
  [
    ".agents/skills/maintaining-chatgpt-package/SKILL.md",
    [
      /^## Start Discovery$/m,
      /^## Native Package Shape$/m,
      /^## Verification$/m,
      /make build-app/,
      /\.\/install\.sh/,
      /Before pushing/i,
      /For native package changes/i,
      /supported successor/i,
      /distributed locally as `chatgpt-desktop-bin`/i,
    ],
  ],
  [
    "port-integrations/x11-ewmh-computer-use/README.md",
    [
      /^## Enable$/m,
      /^## Staging modes$/m,
      /^## Updater rebuilds$/m,
      /CHATGPT_X11_COMPUTER_USE_/,
      /make build-app/,
      /integrations\.json/,
    ],
  ],
  [
    "scripts/automation/upstream-dmg-watchdog/SKILL.md",
    [
      /watchdog\.py\s+(?:probe|worker)/,
      /PROCESS_UPSTREAM_DMG/,
      /record-acceptance/,
      /nix-preflight/,
      /Open the repair PR/i,
    ],
  ],
  [
    "docs/agents/domain.md",
    [
      /Before exploring/i,
      /Use the glossary vocabulary/i,
      /Flag ADR conflicts/i,
      /before doing ordinary work/i,
      /Use the specific term/i,
    ],
  ],
  [
    "PRODUCT.md",
    [
      /ChatGPT for Linux serves/i,
      /Success means/i,
      /Future work should/i,
      /The product should/i,
      /should target WCAG/i,
      /surfaces were[^.]*privacy-safe/i,
      /They did not fabricate/i,
    ],
  ],
  [
    "docs/agents/generated-and-runtime-notes.md",
    [
      /Override only/i,
      /should be idempotent/i,
      /Do not fix/i,
      /before changing/i,
      /For current navigation/i,
    ],
  ],
  [
    "docs/agents/repository-map.md",
    [
      /Edit this/i,
      /Current Route/i,
      /Start here when/i,
      /Use `port-integrations\//i,
      /Read it before/i,
      /Add new compositor/i,
    ],
  ],
]);

test("retained retirement workflows match the exact reviewed bytes", () => {
  assertRetainedWorkflowDirectories(repoRoot);
  const workflows = fs
    .readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

  assert.deepEqual(workflows, [...retainedWorkflowDigests.keys()].sort());
  for (const workflow of workflows) {
    assertRetainedWorkflowFile(workflow, path.join(workflowRoot, workflow));
  }

  const ciSource = fs.readFileSync(path.join(workflowRoot, "ci.yml"), "utf8");
  for (const mutation of [
    ciSource.replace("  pull_request:", "  pull_request_target:"),
    ciSource.replace("  contents: read", "  contents: write"),
    `${ciSource}\n# changed after retirement\n`,
  ]) {
    assert.notEqual(mutation, ciSource);
    assert.throws(
      () => assertRetainedWorkflowDigest("ci.yml", Buffer.from(mutation)),
      /changed after retirement/,
    );
  }

  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatgpt-retired-workflow-"),
  );
  try {
    const target = path.join(fixtureRoot, "target.yml");
    const link = path.join(fixtureRoot, "ci.yml");
    fs.writeFileSync(target, ciSource);
    fs.symlinkSync(target, link);
    assert.throws(
      () => assertRetainedWorkflowFile("ci.yml", link),
      /regular file/,
    );

    const linkedRepo = path.join(fixtureRoot, "linked-repo");
    fs.mkdirSync(linkedRepo);
    fs.symlinkSync(
      path.join(repoRoot, ".github"),
      path.join(linkedRepo, ".github"),
      "dir",
    );
    assert.throws(
      () => assertRetainedWorkflowDirectories(linkedRepo),
      /real directory/,
    );

    const linkedWorkflowsRepo = path.join(fixtureRoot, "linked-workflows-repo");
    fs.mkdirSync(path.join(linkedWorkflowsRepo, ".github"), {
      recursive: true,
    });
    fs.symlinkSync(
      workflowRoot,
      path.join(linkedWorkflowsRepo, ".github/workflows"),
      "dir",
    );
    assert.throws(
      () => assertRetainedWorkflowDirectories(linkedWorkflowsRepo),
      /real directory/,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
  assert.match(pullRequestTemplate, /^# Pull Request Closeout$/m);
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

  assert.match(
    security,
    /https:\/\/openai\.com\/security\/disclosure/,
  );

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

  const forkSyncPolicy = fs.readFileSync(
    path.join(repoRoot, "docs/maintainers/fork-sync-policy.md"),
    "utf8",
  );
  assert.match(forkSyncPolicy, /^## Historical Required Workflow$/m);
  assert.match(forkSyncPolicy, /^## Historical Sync Ledger$/m);
  assert.doesNotMatch(forkSyncPolicy, /^## Required Workflow$/m);

  const dmgAcceptance = fs.readFileSync(
    path.join(repoRoot, "docs/upstream-dmg-acceptance.md"),
    "utf8",
  );
  assert.match(dmgAcceptance, /^## Historical Drift Issue Lifecycle$/m);
  assert.match(dmgAcceptance, /^## Historical Manual Validation$/m);
  assert.doesNotMatch(dmgAcceptance, /^## Manual Validation$/m);

  const troubleshooting = fs.readFileSync(
    path.join(repoRoot, "docs/usage/troubleshooting.md"),
    "utf8",
  );
  const troubleshootingProse = troubleshooting.replace(/^>\s?/gm, "");
  assert.match(
    troubleshootingProse,
    /commands\s+below are historical reference only/i,
  );
});

test("historical entry points reject every CommonMark fence form", () => {
  for (const fence of [
    "   ```sh",
    "~~~sh",
    "  ~~~~",
    "> ```console",
    "  > > ~~~sh",
    "- ```sh",
    "1. ~~~console",
    "> - ```sh",
  ]) {
    assert.equal(
      historicalExecutableFencePattern.test(fence),
      true,
      `fence must be rejected: ${fence}`,
    );
  }
});

test("historical maintenance entry points contain no executable work route", () => {
  for (const [relativePath, forbiddenPatterns] of
    nonExecutableHistoricalEntryPoints) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    const prose = source.replace(/^>\s?/gm, "");
    assert.match(prose, /non-executable historical (?:record|context)/i, relativePath);
    assert.doesNotMatch(source, historicalExecutableFencePattern, relativePath);
    for (const forbiddenPattern of forbiddenPatterns) {
      assert.doesNotMatch(source, forbiddenPattern, relativePath);
    }
  }

  const forkDivergences = fs.readFileSync(
    path.join(repoRoot, "docs/maintainers/fork-divergences.md"),
    "utf8",
  );
  assert.match(forkDivergences, /non-executable historical record/i);
  assert.doesNotMatch(
    forkDivergences,
    /Use this inventory during upstream syncs/i,
  );
  assert.doesNotMatch(forkDivergences, /^## Sync Review Rule$/m);
  assert.doesNotMatch(forkDivergences, /^\*\*Preservation checks:\*\*/m);

  const securityBacklog = fs.readFileSync(
    path.join(repoRoot, "docs/maintainers/security-backlog.md"),
    "utf8",
  );
  assert.match(
    securityBacklog,
    /not a work\s+queue or remediation program/i,
  );
  assert.match(securityBacklog, /Historical security review workflow/i);
  assert.doesNotMatch(securityBacklog, /current remediation workflow/i);
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
