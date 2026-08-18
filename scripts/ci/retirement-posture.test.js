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

const approvedWorkflowTriggers = {
  "ci.yml": ["pull_request", "push", "workflow_dispatch"],
  "codeql.yml": ["pull_request"],
  "install-deps.yml": ["pull_request", "push"],
  "official-dmg-build-app.yml": ["pull_request"],
  "rust-clippy.yml": ["pull_request"],
  "updater.yml": ["pull_request", "push"],
  "verify-apple-dmg.yml": ["workflow_dispatch"],
};

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

// This retired repository has no root Node dependency tree. These helpers
// parse the block and flow forms GitHub Actions accepts for `on` and
// `permissions`; unfamiliar syntax throws instead of silently bypassing the
// closeout policy. actionlint separately validates each retained workflow.
function stripYamlComment(line) {
  let quote = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote && character === quote) {
      if (quote === "'" && line[index + 1] === "'") {
        index += 1;
      } else {
        quote = null;
      }
      continue;
    }
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (
      !quote &&
      character === "#" &&
      (index === 0 || /\s/.test(line[index - 1]))
    ) {
      return line.slice(0, index).trimEnd();
    }
  }

  assert.equal(quote, null, "workflow YAML contains an unterminated quote");
  return line.trimEnd();
}

function splitYamlFlow(source) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote && character === quote) {
      if (quote === "'" && source[index + 1] === "'") {
        index += 1;
      } else {
        quote = null;
      }
      continue;
    }
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (!quote && "[{".includes(character)) {
      depth += 1;
      continue;
    }
    if (!quote && "]}".includes(character)) {
      depth -= 1;
      assert.ok(depth >= 0, "workflow YAML has an unmatched flow delimiter");
      continue;
    }
    if (!quote && depth === 0 && character === ",") {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  assert.equal(quote, null, "workflow YAML contains an unterminated quote");
  assert.equal(depth, 0, "workflow YAML has an unmatched flow delimiter");
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function unquoteYamlScalar(source) {
  const value = source.trim();
  if (!value) return "";
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  assert.equal(value.at(-1), quote, "workflow YAML contains a partial quote");
  if (quote === "'") return value.slice(1, -1).replaceAll("''", "'");
  return JSON.parse(value);
}

function splitYamlMappingEntry(source) {
  let quote = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote && character === quote) {
      if (quote === "'" && source[index + 1] === "'") {
        index += 1;
      } else {
        quote = null;
      }
      continue;
    }
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (!quote && "[{".includes(character)) depth += 1;
    if (!quote && "]}".includes(character)) depth -= 1;
    if (!quote && depth === 0 && character === ":") {
      return [
        unquoteYamlScalar(source.slice(0, index)),
        source.slice(index + 1).trim(),
      ];
    }
  }

  return null;
}

function assertSupportedYamlMapping([key, value]) {
  assert.doesNotMatch(
    key,
    /^(?:[?&*!]|<<$)/,
    `workflow YAML uses an unsupported mapping key: ${key}`,
  );
  assert.doesNotMatch(
    value,
    /^[&*!]/,
    `workflow YAML uses an unsupported tagged or aliased value: ${value}`,
  );
}

function workflowYamlLines(source) {
  const lines = [];
  let blockScalarIndent = null;

  for (const rawLine of source.split("\n")) {
    assert.doesNotMatch(rawLine, /^ *\t/, "workflow YAML must not use tabs");
    const indent = rawLine.match(/^ */)[0].length;
    if (blockScalarIndent !== null) {
      if (!rawLine.trim() || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    const withoutComment = stripYamlComment(rawLine);
    if (!withoutComment.trim()) continue;
    const content = withoutComment.trimStart();
    assert.doesNotMatch(
      content,
      /^[?:](?:\s|$)/,
      "workflow YAML explicit mapping keys are unsupported",
    );
    const mapping = splitYamlMappingEntry(content);
    if (!mapping) {
      assert.doesNotMatch(
        content,
        /^(?:[&*!]|[\[{])/,
        "workflow YAML standalone node properties and flow collections are unsupported",
      );
    }
    lines.push({ content, indent });
    if (mapping) assertSupportedYamlMapping(mapping);
    if (mapping && /^[>|][+-]?$/.test(mapping[1])) blockScalarIndent = indent;
  }

  return lines;
}

function parseInlineYamlMap(source) {
  assert.ok(source.startsWith("{") && source.endsWith("}"));
  const body = source.slice(1, -1).trim();
  if (!body) return [];
  return splitYamlFlow(body).map((entry) => {
    const mapping = splitYamlMappingEntry(entry);
    assert.ok(mapping, `unsupported workflow YAML mapping entry: ${entry}`);
    assertSupportedYamlMapping(mapping);
    return mapping;
  });
}

function collectWorkflowWritePermissions(source) {
  const lines = workflowYamlLines(source);
  const writeKeys = new Set();
  let writeAll = false;
  let hasTopLevelPermissions = false;

  function collectPermission(key, rawValue) {
    const value = unquoteYamlScalar(rawValue).toLowerCase();
    if (value === "write-all") {
      writeAll = true;
    } else if (value === "write") {
      writeKeys.add(key);
    } else {
      assert.ok(
        ["read", "read-all", "none", "{}"].includes(value),
        `unsupported workflow permission value for ${key}: ${rawValue}`,
      );
    }
  }

  function collectPermissionDeclaration(rawValue) {
    const value = rawValue.trim();
    if (value.startsWith("{")) {
      for (const [key, permission] of parseInlineYamlMap(value)) {
        collectPermission(key, permission);
      }
    } else {
      collectPermission("permissions", value);
    }
  }

  function inspectFlowValue(rawValue) {
    const value = rawValue.trim();
    if (value.startsWith("{")) {
      for (const [key, nestedValue] of parseInlineYamlMap(value)) {
        if (key === "permissions") {
          collectPermissionDeclaration(nestedValue);
        } else {
          inspectFlowValue(nestedValue);
        }
      }
    } else if (value.startsWith("[")) {
      assert.ok(value.endsWith("]"), "workflow flow sequence is incomplete");
      for (const nestedValue of splitYamlFlow(value.slice(1, -1))) {
        inspectFlowValue(nestedValue);
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const mapping = splitYamlMappingEntry(line.content);
    if (!mapping || mapping[0] !== "permissions") continue;
    if (line.indent === 0) hasTopLevelPermissions = true;
    const value = mapping[1];
    if (value) {
      collectPermissionDeclaration(value);
      continue;
    }

    let childIndent = null;
    for (let child = index + 1; child < lines.length; child += 1) {
      const candidate = lines[child];
      if (candidate.indent <= line.indent) break;
      if (childIndent === null) childIndent = candidate.indent;
      if (candidate.indent !== childIndent) continue;
      const permission = splitYamlMappingEntry(candidate.content);
      assert.ok(
        permission,
        `unsupported workflow permissions entry: ${candidate.content}`,
      );
      collectPermission(permission[0], permission[1]);
    }
    assert.notEqual(
      childIndent,
      null,
      "workflow permissions must be an explicit map or scalar",
    );
  }

  for (const line of lines) {
    const mapping = splitYamlMappingEntry(line.content);
    if (mapping && mapping[0] !== "permissions") {
      inspectFlowValue(mapping[1]);
    }
  }

  return {
    hasTopLevelPermissions,
    writeAll,
    writeKeys: [...writeKeys].sort(),
  };
}

function assertRetirementWorkflowPermissions(workflow, source) {
  const { hasTopLevelPermissions, writeAll, writeKeys } =
    collectWorkflowWritePermissions(source);
  assert.equal(
    hasTopLevelPermissions,
    true,
    `${workflow} must declare top-level token permissions`,
  );
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

function collectWorkflowTriggers(source) {
  const lines = workflowYamlLines(source);
  const topLevelOn = lines.filter((line) => {
    if (line.indent !== 0) return false;
    const mapping = splitYamlMappingEntry(line.content);
    return mapping && mapping[0] === "on";
  });
  assert.equal(
    topLevelOn.length,
    1,
    "workflow must declare exactly one top-level on key",
  );

  const onLine = topLevelOn[0];
  const onIndex = lines.indexOf(onLine);
  const [, rawValue] = splitYamlMappingEntry(onLine.content);
  if (rawValue.startsWith("{")) {
    return parseInlineYamlMap(rawValue)
      .map(([trigger]) => trigger)
      .sort();
  }
  if (rawValue.startsWith("[")) {
    assert.ok(rawValue.endsWith("]"), "workflow trigger list is incomplete");
    return splitYamlFlow(rawValue.slice(1, -1))
      .map(unquoteYamlScalar)
      .sort();
  }
  if (rawValue) return [unquoteYamlScalar(rawValue)];

  const triggers = [];
  let triggerIndent = null;
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (candidate.indent <= onLine.indent) break;
    if (triggerIndent === null) triggerIndent = candidate.indent;
    if (candidate.indent !== triggerIndent) continue;
    const mapping = splitYamlMappingEntry(candidate.content);
    assert.ok(mapping, `unsupported workflow trigger: ${candidate.content}`);
    triggers.push(mapping[0]);
  }
  return triggers.sort();
}

function assertRetirementWorkflowTriggers(workflow, source) {
  const actual = collectWorkflowTriggers(source);
  const expected = approvedWorkflowTriggers[workflow];
  assert.ok(expected, `${workflow} has no approved retirement trigger contract`);
  assert.deepEqual(
    actual,
    [...expected].sort(),
    `${workflow} has unapproved triggers: ${actual.join(", ")}`,
  );
}

test("retirement permission audit rejects every unapproved write scope", () => {
  assert.throws(
    () => assertRetirementWorkflowPermissions("ci.yml", "on: push\n"),
    /top-level token permissions/,
  );
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
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        'permissions: "write-all"\n',
      ),
    /write-all/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        'permissions: { contents: "write" }\n',
      ),
    /contents/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        'permissions:\n  checks: "write"\n',
      ),
    /checks/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        [
          "on: pull_request",
          "permissions: read-all",
          "jobs: { build: { runs-on: ubuntu-latest, permissions: { contents: write }, steps: [{ run: true }] } }",
          "",
        ].join("\n"),
      ),
    /contents/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "permissions: read-all\njobs:\n  build:\n    ? permissions\n    : write-all\n",
      ),
    /explicit mapping keys/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "permissions: read-all\nenv:\n  PERM: &permission_key permissions\njobs:\n  build:\n    *permission_key: write-all\n",
      ),
    /tagged or aliased value/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "permissions: read-all\njobs:\n  build:\n    !!str permissions: write-all\n",
      ),
    /unsupported mapping key/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "on: pull_request\npermissions: read-all\njobs: ! {test: {runs-on: ubuntu-latest, permissions: write-all, steps: [{run: true}]}}\n",
      ),
    /tagged or aliased value/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "on: pull_request\npermissions: read-all\njobs:\n  !\n  {test: {runs-on: ubuntu-latest, permissions: write-all, steps: [{run: true}]}}\n",
      ),
    /standalone node properties/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "on: pull_request\npermissions: read-all\njobs:\n  {test: {runs-on: ubuntu-latest, permissions: write-all, steps: [{run: true}]}}\n",
      ),
    /flow collections/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowPermissions(
        "ci.yml",
        "on: pull_request\npermissions:\njobs: {}\n",
      ),
    /explicit map or scalar/,
  );
});

test("retirement trigger audit rejects alternate event syntax", () => {
  assert.doesNotThrow(() =>
    assertRetirementWorkflowTriggers(
      "codeql.yml",
      "on:\n  pull_request:\n",
    ),
  );
  assert.doesNotThrow(() =>
    assertRetirementWorkflowTriggers(
      "codeql.yml",
      "on: { pull_request: {} }\n",
    ),
  );
  assert.throws(
    () =>
      assertRetirementWorkflowTriggers(
        "codeql.yml",
        "on:\n  pull_request_target:\n",
      ),
    /pull_request_target/,
  );
  assert.throws(
    () =>
      assertRetirementWorkflowTriggers(
        "codeql.yml",
        'on: { "pull_request_target": {} }\n',
      ),
    /pull_request_target/,
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
    assertRetirementWorkflowTriggers(workflow, source);
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
