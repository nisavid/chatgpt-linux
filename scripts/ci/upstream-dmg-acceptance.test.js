"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { evaluateUpstreamDmg, httpIdentity } = require("../lib/upstream-dmg-acceptance.js");

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-acceptance-"));
  try {
    const dmg = path.join(root, "ChatGPT.dmg");
    fs.writeFileSync(dmg, "dmg fixture");
    return fn({ root, dmg });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function patch(name, extra = {}) {
  return { name, status: "applied", ...extra };
}

function requiredCoreReport() {
  const { requiredPatchNamesForProfile } = require("../patches/runner.js");
  return {
    patches: requiredPatchNamesForProfile("upstream-build").map((name) => patch(name, { ciPolicy: "required-official-dmg" })),
  };
}

function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
  return filePath;
}

function evaluate(root, dmg, overrides = {}) {
  const core = writeJson(root, "core.json", overrides.core ?? requiredCoreReport());
  return evaluateUpstreamDmg({
    dmgPath: dmg,
    coreReportPath: overrides.corePath ?? core,
    buildStatus: overrides.buildStatus ?? "success",
    repoRoot: root,
  });
}

test("accepts a candidate when the shared release profile passes", () => withFixture(({ root, dmg }) => {
  const decision = evaluate(root, dmg);
  assert.equal(decision.verdict, "accepted");
  assert.equal(decision.blockers.length, 0);
}));

test("reads canonical official DMG metadata from build info", () => withFixture(({ root }) => {
  const core = writeJson(root, "core.json", requiredCoreReport());
  const buildInfo = writeJson(root, "build-info.json", {
    officialDmg: {
      sha256: "a".repeat(64),
      sizeBytes: 1234,
      appVersion: "1.2.3",
    },
  });
  const decision = evaluateUpstreamDmg({
    buildInfoPath: buildInfo,
    coreReportPath: core,
    buildStatus: "success",
    repoRoot: root,
  });

  assert.equal(decision.verdict, "accepted");
  assert.equal(decision.dmg.sha256, "a".repeat(64));
  assert.equal(decision.dmg.sizeBytes, 1234);
  assert.equal(decision.dmg.appVersion, "1.2.3");
}));

test("keeps optional drift non-blocking", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.patches.push(patch("optional-ui", { status: "skipped-optional", ciPolicy: "optional", reason: "needle moved" }));
  const decision = evaluate(root, dmg, { core });
  assert.equal(decision.verdict, "accepted_with_warnings");
  assert.equal(decision.warnings.length, 1);
}));

test("rejects required patch and post-patch integrity failures", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.patches[0].status = "failed-required";
  core.patches[0].reason = "needle moved";
  core.postPatchIntegrity = { findings: [{ symbol: "brokenSymbol", reason: "undeclared symbol" }] };
  const decision = evaluate(root, dmg, { core });
  assert.equal(decision.verdict, "rejected");
  assert.ok(decision.blockers.some((item) => item.code === "post-patch-integrity"));
}));

test("rejects a generated-app mutation integrity failure", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.mutationIntegrity = {
    status: "failed",
    operation: "replace",
    code: "integrity",
    reason: "generated-app mutation integrity failure",
  };

  const decision = evaluate(root, dmg, { core });

  assert.equal(decision.verdict, "rejected");
  assert.deepEqual(
    decision.blockers.find((item) => item.code === "generated-app-mutation-integrity"),
    {
      code: "generated-app-mutation-integrity",
      check: "core",
      name: "generated-app mutation",
      status: "failed",
      reason: "generated-app mutation integrity failure",
    },
  );
}));

test("rejects drift from a user-enabled integration", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.enabledIntegrations = ["ui-tweaks"];
  core.patches.push(patch("integration:ui-tweaks:model-picker", {
    status: "skipped-optional",
    ciPolicy: "optional",
    sourceKind: "integration",
    integrationId: "ui-tweaks",
    reason: "needle moved",
  }));
  const decision = evaluate(root, dmg, { core });
  assert.equal(decision.verdict, "rejected");
  assert.deepEqual(
    decision.blockers.find((item) => item.code === "enabled-integration-drift"),
    {
      code: "enabled-integration-drift",
      check: "integration:ui-tweaks",
      name: "integration:ui-tweaks:model-picker",
      status: "skipped-optional",
      reason: "needle moved",
    },
  );
  assert.deepEqual(decision.checks.patchReport.enabledIntegrations, ["ui-tweaks"]);
}));

test("does not probe or block a disabled integration", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.enabledIntegrations = [];
  core.patches.push(patch("integration:ui-tweaks:model-picker", {
    status: "skipped-disabled",
    ciPolicy: "optional",
    sourceKind: "integration",
    integrationId: "ui-tweaks",
  }));
  const decision = evaluate(root, dmg, { core });
  assert.equal(decision.verdict, "accepted");
  assert.equal(decision.blockers.length, 0);
}));

test("the local and GitHub CLI surfaces use the same verdict", () => withFixture(({ root, dmg }) => {
  const core = writeJson(root, "cli-core.json", requiredCoreReport());
  const cli = path.join(__dirname, "../validate-upstream-dmg.js");
  const verdicts = [];
  for (const source of ["local", "github-actions"]) {
    const output = path.join(root, `${source}.json`);
    const result = spawnSync(process.execPath, [
      cli, "--dmg", dmg, "--core-report", core, "--build-status", "success",
      "--output", output, "--source", source, "--repo-root", root,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    verdicts.push(JSON.parse(fs.readFileSync(output, "utf8")).verdict);
  }
  assert.deepEqual(verdicts, ["accepted", "accepted"]);
}));

test("marks unstructured build failures and a missing core report inconclusive", () => withFixture(({ root, dmg }) => {
  const decision = evaluate(root, dmg, {
    buildStatus: "failure",
    corePath: path.join(root, "missing-core.json"),
  });
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.inconclusiveReasons.length >= 2);
}));

test("marks malformed reports inconclusive instead of throwing", () => withFixture(({ root, dmg }) => {
  const malformed = path.join(root, "malformed.json");
  fs.writeFileSync(malformed, "{not-json");
  const decision = evaluateUpstreamDmg({
    dmgPath: dmg,
    coreReportPath: malformed,
    buildStatus: "success",
    repoRoot: root,
  });
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.inconclusiveReasons.length > 0);
}));

test("a structured rejection wins over incomplete checks", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.patches[0].status = "failed-required";
  const decision = evaluate(root, dmg, {
    core,
    buildStatus: "failure",
  });
  assert.equal(decision.verdict, "rejected");
}));

test("preserves packaged builder source metadata when a build fails before build info", () => withFixture(({ root, dmg }) => {
  const commit = "a".repeat(40);
  writeJson(root, ".chatgpt-linux/source-info.json", {
    commit,
    shortCommit: commit.slice(0, 12),
    version: "0.10.1",
    branch: "main",
    remote: "https://github.com/ilysenko/codex-desktop-linux.git",
    provenance: "packaged-update-builder",
  });
  const core = requiredCoreReport();
  core.patches[0].status = "failed-required";
  core.patches[0].reason = "current upstream contract did not match";

  const decision = evaluate(root, dmg, {
    core,
    buildStatus: "failure",
  });

  assert.equal(decision.verdict, "rejected");
  assert.equal(decision.source?.commit, commit);
  assert.equal(decision.source?.version, "0.10.1");
  assert.equal(decision.source?.provenance, "packaged-update-builder");
}));

test("HTTP identity requires an ETag or Last-Modified plus Content-Length", () => {
  assert.equal(httpIdentity({ contentLength: 42 }), null);
  assert.equal(httpIdentity({ lastModified: "today" }), null);
  assert.ok(httpIdentity({ etag: "strong" })?.key);
  assert.ok(httpIdentity({ lastModified: "today", contentLength: 42 })?.key);
});

test("official DMG workflow is read-only pull-request validation after retirement", () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, "../../.github/workflows/official-dmg-build-app.yml"),
    "utf8",
  );
  assert.doesNotMatch(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(
    workflow,
    /group: official-dmg-acceptance-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/,
  );
  assert.doesNotMatch(workflow, /group: official-dmg-acceptance-\$\{\{ github\.event_name \}\}\s*$/m);
  assert.equal((workflow.match(/- port-integrations\/\*\*/g) ?? []).length, 1);
  assert.equal((workflow.match(/- scripts\/lib\/port-integrations\.js/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d/);
  assert.doesNotMatch(workflow, /issues:\s*write/);
  assert.doesNotMatch(workflow, /reconcileUpstreamDmgIssue/);
});

test("Nix DMG hash refresh workflow remains retired", () => {
  assert.equal(
    fs.existsSync(
      path.resolve(__dirname, "../../.github/workflows/update-chatgpt-hash.yml"),
    ),
    false,
  );
});

test("historical Nix hash tooling retains its focused output validation", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "update-nix-hashes.sh"),
    "utf8",
  );
  const workflow = fs.readFileSync(
    path.resolve(__dirname, "../../.github/workflows/ci.yml"),
    "utf8",
  );
  const watchdogProfile = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "watchdog-port-integrations.json"),
    "utf8",
  ));

  assert.deepEqual(watchdogProfile.enabled, [
    "appshots",
    "codex-micro",
    "chatgpt-wrapper-updater",
    "directory-only-working-tree-watch",
    "frameless-titlebar",
    "global-dictation",
    "mcp-helper-reaper",
    "node-repl-reaper",
    "open-target-discovery",
    "persistent-status-panel",
    "remote-control-ui",
    "remote-mobile-control",
    "ui-tweaks",
  ]);
  assert.match(script, /NIX_VERIFY_OUTPUTS/);
  assert.match(script, /NIX_COMPARE_REF/);
  assert.match(workflow, /\.#checks\.x86_64-linux\.watchdog-port-integrations/);
  assert.match(script, /Invalid Nix verification output/);
  assert.match(script, /run_nix_build "\$VERIFY_LOG" "\$\{PACKAGE_OUTPUTS\[@\]\}"/);
});

test("local Node syntax checks parse native .js ESM in module mode", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "run-node-checks.sh"),
    "utf8",
  );

  assert.match(script, /node --input-type=module --check/);
  assert.match(script, /grep -Eq .*import.*export/);
});
