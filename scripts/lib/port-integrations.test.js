#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  enabledIntegrationIdsFromBuildInfo,
  enabledPortIntegrationsConfig,
  enabledPortIntegrationPackageDependencies,
  enabledPortIntegrationPackageFiles,
  enabledPortIntegrationPackagePlan,
  loadPortIntegrationPatchDescriptors,
  portIntegrationsRoot,
  restoreEnabledPortIntegrationPackageResourcePermissions,
  stageEnabledPortIntegrationPackageResources,
  stageEnabledPortIntegrationInstall,
} = require("./port-integrations.js");

test("port integration root uses only the canonical ChatGPT environment contract", (t) => {
  const canonicalRoot = path.join(os.tmpdir(), "chatgpt-integrations-root");
  const previousCanonical = process.env.CHATGPT_PORT_INTEGRATIONS_ROOT;
  const previousLegacy = process.env.CODEX_PORT_INTEGRATIONS_ROOT;
  t.after(() => {
    if (previousCanonical == null) delete process.env.CHATGPT_PORT_INTEGRATIONS_ROOT;
    else process.env.CHATGPT_PORT_INTEGRATIONS_ROOT = previousCanonical;
    if (previousLegacy == null) delete process.env.CODEX_PORT_INTEGRATIONS_ROOT;
    else process.env.CODEX_PORT_INTEGRATIONS_ROOT = previousLegacy;
  });

  process.env.CHATGPT_PORT_INTEGRATIONS_ROOT = canonicalRoot;
  process.env.CODEX_PORT_INTEGRATIONS_ROOT = path.join(os.tmpdir(), "legacy-integrations-root");
  assert.equal(portIntegrationsRoot(), canonicalRoot);

  delete process.env.CHATGPT_PORT_INTEGRATIONS_ROOT;
  assert.equal(portIntegrationsRoot(), path.resolve(__dirname, "../..", "port-integrations"));
});

test("legacy zed-opener config migrates one-way to open-target-discovery", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-legacy-id-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const integrationsRoot = path.join(root, "port-integrations");
  const integrationDir = path.join(integrationsRoot, "open-target-discovery");
  fs.mkdirSync(integrationDir, { recursive: true });
  fs.writeFileSync(path.join(integrationDir, "README.md"), "# Open Target Discovery\n");
  fs.writeFileSync(
    path.join(integrationDir, "integration.json"),
    JSON.stringify({
      id: "open-target-discovery",
      title: "Open Target Discovery",
      entrypoints: {},
    }),
  );
  fs.writeFileSync(
    path.join(integrationsRoot, "integrations.json"),
    JSON.stringify({
      enabled: ["zed-opener"],
      settings: { "zed-opener": { value: 1 } },
    }),
  );

  assert.deepEqual(
    enabledPortIntegrationsConfig({
      integrationsRoot,
      integrationsConfigPath: path.join(integrationsRoot, "integrations.json"),
      strictConfig: true,
    }),
    {
      enabled: ["open-target-discovery"],
      disabled: [],
      settings: { "open-target-discovery": { value: 1 } },
    },
  );
});

function makeIntegrationRoot(root, integrationManifest) {
  const integrationsRoot = path.join(root, "port-integrations");
  const integrationDir = path.join(integrationsRoot, "unsafe-link");
  fs.mkdirSync(integrationDir, { recursive: true });
  fs.writeFileSync(path.join(integrationsRoot, "integrations.example.json"), '{"enabled":[]}\n');
  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"enabled":["unsafe-link"]}\n');
  fs.writeFileSync(path.join(integrationDir, "README.md"), "# Unsafe Link\n");
  fs.writeFileSync(path.join(integrationDir, "integration.json"), `${JSON.stringify(integrationManifest, null, 2)}\n`);
  return { integrationDir, integrationsRoot };
}

function makePackageIntegrationRoot(root, integrationManifest) {
  const id = "package-framework-fixture";
  const integrationsRoot = path.join(root, "port-integrations");
  const integrationDir = path.join(integrationsRoot, id);
  fs.mkdirSync(integrationDir, { recursive: true });
  fs.writeFileSync(path.join(integrationsRoot, "integrations.example.json"), '{"enabled":[]}\n');
  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), `{"enabled":["${id}"]}\n`);
  fs.writeFileSync(path.join(integrationDir, "README.md"), "# Package Framework Fixture\n");
  fs.writeFileSync(
    path.join(integrationDir, "integration.json"),
    `${JSON.stringify({ ...integrationManifest, id, title: "Package Framework Fixture" }, null, 2)}\n`,
  );
  return { integrationDir, integrationsRoot, id };
}

function writeBuildInfoSnapshot(appDir, enabled) {
  const buildInfoPath = path.join(appDir, ".chatgpt-linux", "build-info.json");
  fs.mkdirSync(path.dirname(buildInfoPath), { recursive: true });
  fs.writeFileSync(
    buildInfoPath,
    `${JSON.stringify({ schemaVersion: 1, portIntegrations: { enabled } }, null, 2)}\n`,
  );
  return buildInfoPath;
}

function stageIntegration(root, integrationsRoot) {
  stageEnabledPortIntegrationInstall(path.join(root, "app"), {
    integrationsConfigPath: path.join(integrationsRoot, "integrations.json"),
    integrationsRoot,
  });
}

function writeStagedManifest(appDir, manifest) {
  const manifestPath = path.join(appDir, ".chatgpt-linux", "port-integrations-staged.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("port integration asset matchers receive integration settings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-asset-match-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    entrypoints: { patchDescriptors: "./patch.js" },
  });
  fs.writeFileSync(
    path.join(integrationsRoot, "integrations.json"),
    JSON.stringify({
      enabled: ["unsafe-link"],
      settings: { "unsafe-link": { expectedContract: "current-contract" } },
    }),
  );
  fs.writeFileSync(
    path.join(integrationDir, "patch.js"),
    [
      "module.exports = [{",
      "  id: 'settings-aware-asset',",
      "  phase: 'webview-asset',",
      "  pattern: /^app-.*\\.js$/,",
      "  assetMatch: (source, assetName, context) =>",
      "    source === context.integration.settings.expectedContract && assetName === 'app-current.js',",
      "  apply: (source) => source,",
      "}];",
      "",
    ].join("\n"),
  );

  const [descriptor] = loadPortIntegrationPatchDescriptors({ integrationsRoot });
  assert.equal(descriptor.assetMatch("current-contract", "app-current.js", {}), true);
});

test("port integration staging rejects duplicate resource targets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-duplicate-resource-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, "app");
  const preservedTarget = ".chatgpt-linux/integrations/preserved/payload.txt";
  const target = ".chatgpt-linux/integrations/unsafe-link/payload.txt";
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      { source: "first.txt", target, mode: "0644" },
      { source: "second.txt", target, mode: "0644" },
    ],
  });
  fs.writeFileSync(path.join(integrationDir, "first.txt"), "first\n");
  fs.writeFileSync(path.join(integrationDir, "second.txt"), "second\n");
  fs.mkdirSync(path.dirname(path.join(appDir, preservedTarget)), { recursive: true });
  fs.writeFileSync(path.join(appDir, preservedTarget), "preserved\n");
  writeStagedManifest(appDir, {
    version: 1,
    resources: [{ id: "preserved", type: "resource", target: preservedTarget, mode: "0644" }],
    runtimeHooks: [],
  });

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /duplicate port integration install target/i,
  );
  assert.equal(fs.existsSync(path.join(root, "app", target)), false);
  assert.equal(fs.readFileSync(path.join(appDir, preservedTarget), "utf8"), "preserved\n");
});

test("port integration staging rejects ancestor and descendant target overlaps", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-target-overlap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const parentTarget = ".chatgpt-linux/integrations/unsafe-link/payload";
  const childTarget = `${parentTarget}/nested.txt`;
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      { source: "payload", target: parentTarget, mode: "0644" },
      { source: "nested.txt", target: childTarget, mode: "0644" },
    ],
  });
  fs.mkdirSync(path.join(integrationDir, "payload"));
  fs.writeFileSync(path.join(integrationDir, "payload", "nested.txt"), "parent\n");
  fs.writeFileSync(path.join(integrationDir, "nested.txt"), "child\n");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /overlapping port integration install target/i,
  );
  assert.equal(fs.existsSync(path.join(root, "app", parentTarget)), false);
});

test("port integration staging rejects resource and runtime hook target collisions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-hook-collision-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = ".chatgpt-linux/prelaunch.d/unsafe-link-hook.sh";
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      { source: "payload.sh", target, mode: "0755" },
    ],
    runtimeHooks: {
      prelaunch: { source: "hook.sh", name: "hook.sh", mode: "0755" },
    },
  });
  fs.writeFileSync(path.join(integrationDir, "payload.sh"), "resource\n");
  fs.writeFileSync(path.join(integrationDir, "hook.sh"), "hook\n");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /duplicate port integration install target/i,
  );
  assert.equal(fs.existsSync(path.join(root, "app", target)), false);
});

test("port integration staging rejects framework manifest targets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-manifest-target-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = ".chatgpt-linux/port-integrations-staged.json";
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [{ source: "payload.json", target, mode: "0644" }],
  });
  fs.writeFileSync(path.join(integrationDir, "payload.json"), "payload\n");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /port integration staging framework/,
  );
  assert.equal(fs.existsSync(path.join(root, "app", target)), false);
});

test("port integration staging rejects normalized target aliases across integrations", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-cross-integration-target-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = ".chatgpt-linux/integrations/shared/payload.txt";
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [{ source: "first.txt", target, mode: "0644" }],
  });
  const secondIntegrationDir = path.join(integrationsRoot, "second");
  fs.mkdirSync(secondIntegrationDir);
  fs.writeFileSync(path.join(integrationDir, "first.txt"), "first\n");
  fs.writeFileSync(path.join(secondIntegrationDir, "README.md"), "# Second\n");
  fs.writeFileSync(path.join(secondIntegrationDir, "second.txt"), "second\n");
  fs.writeFileSync(path.join(secondIntegrationDir, "integration.json"), `${JSON.stringify({
    id: "second",
    title: "Second",
    resources: [{ source: "second.txt", target: ".chatgpt-linux\\integrations\\shared\\payload.txt", mode: "0644" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"enabled":["unsafe-link","second"]}\n');

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /integration 'second'.*integration 'unsafe-link'/,
  );
  assert.equal(fs.existsSync(path.join(root, "app", target)), false);
});

test("port integration staging rejects symlinked resource sources", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-symlink-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside");
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      {
        source: "payload-link",
        target: ".chatgpt-linux/integrations/unsafe-link/payload.txt",
        mode: "0644",
      },
    ],
  });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "payload.txt"), "outside\n");
  fs.symlinkSync(outside, path.join(integrationDir, "payload-link"), "junction");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /must not contain symbolic links/,
  );
  assert.equal(
    fs.existsSync(path.join(root, "app", ".chatgpt-linux", "integrations", "unsafe-link", "payload.txt")),
    false,
  );
});

test("port integration staging rejects symlinked install target parents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-symlink-target-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside");
  const appDir = path.join(root, "app");
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      {
        source: "payload.txt",
        target: ".chatgpt-linux/integrations/unsafe-link/payload.txt",
        mode: "0644",
      },
    ],
  });
  fs.mkdirSync(path.join(appDir, ".chatgpt-linux", "integrations"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  fs.symlinkSync(outside, path.join(appDir, ".chatgpt-linux", "integrations", "unsafe-link"), "junction");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /must stay inside the install directory/,
  );
  assert.equal(fs.existsSync(path.join(outside, "payload.txt")), false);
});

test("port integration staging rejects symlinked install target ancestors before creating parents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-symlink-target-ancestor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside");
  const appDir = path.join(root, "app");
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      {
        source: "payload.txt",
        target: ".chatgpt-linux/integrations/unsafe-link/nested/payload.txt",
        mode: "0644",
      },
    ],
  });
  fs.mkdirSync(path.join(appDir, ".chatgpt-linux", "integrations"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  fs.symlinkSync(outside, path.join(appDir, ".chatgpt-linux", "integrations", "unsafe-link"), "junction");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /must (stay inside the install directory|not contain symbolic links)/,
  );
  assert.equal(fs.existsSync(path.join(outside, "nested")), false);
});

test("port integration staging does not clean stale manifest targets through symlinked parents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-symlink-manifest-cleanup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside");
  const appDir = path.join(root, "app");
  const { integrationDir, integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
    resources: [
      {
        source: "payload.txt",
        target: ".chatgpt-linux/integrations/unsafe-link/payload.txt",
        mode: "0644",
      },
    ],
  });
  fs.mkdirSync(path.join(appDir, ".chatgpt-linux", "integrations"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  fs.writeFileSync(path.join(outside, "payload.txt"), "outside\n");
  fs.symlinkSync(outside, path.join(appDir, ".chatgpt-linux", "integrations", "unsafe-link"), "junction");
  writeStagedManifest(appDir, {
    version: 1,
    resources: [
      {
        id: "unsafe-link",
        type: "resource",
        target: ".chatgpt-linux/integrations/unsafe-link/payload.txt",
        mode: "0644",
      },
    ],
    runtimeHooks: [],
  });

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /must (stay inside the install directory|not contain symbolic links)/,
  );
  assert.equal(fs.readFileSync(path.join(outside, "payload.txt"), "utf8"), "outside\n");
});

test("port integration staging does not clean legacy hooks through symlinked hook dirs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-symlink-hook-cleanup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside-hooks");
  const appDir = path.join(root, "app");
  const { integrationsRoot } = makeIntegrationRoot(root, {
    id: "unsafe-link",
    title: "Unsafe Link",
  });
  fs.mkdirSync(path.join(appDir, ".chatgpt-linux"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "unsafe-link-old-hook.sh"), "outside\n");
  fs.symlinkSync(outside, path.join(appDir, ".chatgpt-linux", "prelaunch.d"), "junction");

  assert.throws(
    () => stageIntegration(root, integrationsRoot),
    /must (stay inside the install directory|not contain symbolic links)/,
  );
  assert.equal(fs.readFileSync(path.join(outside, "unsafe-link-old-hook.sh"), "utf8"), "outside\n");
});

test("disabled port integrations do not add package resources or dependencies", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-disabled-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      {
        source: "fixture.txt",
        target: "usr/share/chatgpt-package-framework/fixture.txt",
        mode: "0644",
        formats: ["deb", "rpm", "pacman"],
      },
    ],
    packageDependencies: {
      deb: ["fixture-deb-runtime"],
      rpm: ["fixture-rpm-runtime"],
      pacman: ["fixture-pacman-runtime"],
    },
  });
  fs.writeFileSync(path.join(integrationDir, "fixture.txt"), "fixture payload\n");
  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"enabled":[]}\n');

  const options = { integrationsRoot, packageFormat: "deb" };
  assert.deepEqual(enabledPortIntegrationPackagePlan(options), {
    resources: [],
    dependencies: [],
  });
  assert.deepEqual(enabledPortIntegrationPackageDependencies(options), []);
  assert.deepEqual(enabledPortIntegrationPackageFiles(options), []);

  const packageRoot = path.join(root, "package-root");
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, "sentinel"), "preserved\n");
  assert.deepEqual(stageEnabledPortIntegrationPackageResources(packageRoot, options), {
    resources: [],
    dependencies: [],
  });
  assert.deepEqual(fs.readdirSync(packageRoot), ["sentinel"]);
});

test("enabled port integrations stage package resources with exact modes and reject payload collisions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-stage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = "usr/share/chatgpt-package-framework/fixture.txt";
  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      {
        source: "fixture.txt",
        target,
        mode: "0640",
        formats: ["deb", "rpm"],
      },
    ],
    packageDependencies: {
      deb: ["fixture-deb-runtime"],
      rpm: ["fixture-rpm-runtime"],
      pacman: ["fixture-pacman-runtime"],
    },
  });
  const payload = "fixture payload\n";
  fs.writeFileSync(path.join(integrationDir, "fixture.txt"), payload);

  const options = { integrationsRoot, packageFormat: "deb" };
  const plan = enabledPortIntegrationPackagePlan(options);
  assert.deepEqual(plan.dependencies, ["fixture-deb-runtime"]);
  assert.equal(plan.resources.length, 1);
  assert.equal(plan.resources[0].id, "package-framework-fixture");
  assert.equal(plan.resources[0].target, target);
  assert.equal(plan.resources[0].mode, 0o640);
  assert.deepEqual(plan.resources[0].formats, ["deb", "rpm"]);
  const packageRoot = path.join(root, "package-root");
  assert.deepEqual(stageEnabledPortIntegrationPackageResources(packageRoot, options), plan);
  const stagedTarget = path.join(packageRoot, target);
  assert.equal(fs.readFileSync(stagedTarget, "utf8"), payload);
  assert.equal(fs.statSync(stagedTarget).mode & 0o777, 0o640);

  fs.writeFileSync(stagedTarget, "tampered\n");
  fs.chmodSync(stagedTarget, 0o777);
  assert.throws(
    () => stageEnabledPortIntegrationPackageResources(packageRoot, options),
    /conflicts with existing package payload/i,
  );
  assert.equal(fs.readFileSync(stagedTarget, "utf8"), "tampered\n");
  assert.equal(fs.statSync(stagedTarget).mode & 0o777, 0o777);
});

test("port integration package dependencies and files are sorted, deduplicated, and format-specific", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-lists-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      {
        source: "90-last.txt",
        target: "usr/share/chatgpt-package-framework/90-last.txt",
        formats: ["rpm", "deb", "deb"],
      },
      {
        source: "70-first.txt",
        target: "etc/chatgpt-package-framework/70-first.txt",
        formats: ["deb"],
      },
      {
        source: "80-shared.txt",
        target: "usr/share/chatgpt-package-framework/80-shared.txt",
      },
    ],
    packageDependencies: {
      deb: ["zlib1g", "fixture-deb-runtime", "zlib1g"],
      rpm: ["zlib", "fixture-rpm-runtime", "zlib"],
      pacman: ["zlib", "fixture-pacman-runtime", "zlib"],
    },
  });
  for (const name of ["90-last.txt", "70-first.txt", "80-shared.txt"]) {
    fs.writeFileSync(path.join(integrationDir, name), `${name}\n`);
  }

  const debOptions = { integrationsRoot, packageFormat: "deb" };
  assert.deepEqual(enabledPortIntegrationPackageDependencies(debOptions), ["fixture-deb-runtime", "zlib1g"]);
  assert.deepEqual(enabledPortIntegrationPackageFiles(debOptions), [
    "/etc/chatgpt-package-framework/70-first.txt",
    "/usr/share/chatgpt-package-framework/80-shared.txt",
    "/usr/share/chatgpt-package-framework/90-last.txt",
  ]);
  assert.deepEqual(
    enabledPortIntegrationPackagePlan(debOptions).resources.map((resource) => resource.target),
    [
      "etc/chatgpt-package-framework/70-first.txt",
      "usr/share/chatgpt-package-framework/80-shared.txt",
      "usr/share/chatgpt-package-framework/90-last.txt",
    ],
  );

  const rpmOptions = { integrationsRoot, packageFormat: "rpm" };
  assert.deepEqual(enabledPortIntegrationPackageDependencies(rpmOptions), ["fixture-rpm-runtime", "zlib"]);
  assert.deepEqual(enabledPortIntegrationPackageFiles(rpmOptions), [
    "/usr/share/chatgpt-package-framework/80-shared.txt",
    "/usr/share/chatgpt-package-framework/90-last.txt",
  ]);

  const pacmanOptions = { integrationsRoot, packageFormat: "pacman" };
  assert.deepEqual(enabledPortIntegrationPackageDependencies(pacmanOptions), ["fixture-pacman-runtime", "zlib"]);
  assert.deepEqual(enabledPortIntegrationPackageFiles(pacmanOptions), [
    "/usr/share/chatgpt-package-framework/80-shared.txt",
  ]);
});

test("port integration package resources reject traversal and package-root targets", () => {
  const cases = [
    { target: ".", error: /must not target the package root/i },
    { target: "./", error: /must not target the package root/i },
    { target: "../escape.txt", error: /must stay inside the package root/i },
    { target: "usr/share/codex/../../escape.txt", error: /must stay inside the package root/i },
    { target: "DEBIAN", error: /reserved Debian control namespace/i },
    { target: "DEBIAN/preinst", error: /reserved Debian control namespace/i },
    { target: ".PKGINFO", format: "pacman", error: /reserved pacman package namespace/i },
    { target: ".BUILDINFO", format: "pacman", error: /reserved pacman package namespace/i },
    { target: ".MTREE", format: "pacman", error: /reserved pacman package namespace/i },
    { target: ".INSTALL", format: "pacman", error: /reserved pacman package namespace/i },
    { target: ".CHANGELOG", format: "pacman", error: /reserved pacman package namespace/i },
    { target: ".INSTALL/hooks", format: "pacman", error: /reserved pacman package namespace/i },
    { target: "usr/share/chatgpt-package-framework/bad\npath.txt", error: /unsafe package path component/i },
    { target: "usr/%{_libdir}/bad.txt", error: /unsafe package path component/i },
    { target: "usr/share/chatgpt-package-framework/*.txt", error: /unsafe package path component/i },
    { target: "usr/share/chatgpt-package-framework/-bad.txt", error: /unsafe package path component/i },
  ];

  for (const { target, format = "deb", error } of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-target-"));
    try {
      const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
        id: "package-framework-fixture",
        title: "Package Framework Fixture",
        packageResources: [{ source: "payload.txt", target, mode: "0644", formats: [format] }],
      });
      fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");

      assert.throws(
        () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: format }),
        error,
        target,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("port integration package resources reject ancestor and descendant target overlaps", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-overlap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      { source: "parent.txt", target: "usr/share/package-framework-fixture", mode: "0644", formats: ["deb"] },
      { source: "child.txt", target: "usr/share/package-framework-fixture/child.txt", mode: "0644", formats: ["deb"] },
    ],
  });
  fs.writeFileSync(path.join(integrationDir, "parent.txt"), "parent\n");
  fs.writeFileSync(path.join(integrationDir, "child.txt"), "child\n");

  assert.throws(
    () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: "deb" }),
    /overlapping port integration package target/i,
  );
});

test("port integration package resources cannot target the packaged app directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-app-target-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { integrationDir, integrationsRoot, id } = makePackageIntegrationRoot(root, {
    packageResources: [
      {
        source: "payload.txt",
        target: "opt/chatgpt/integration-owned.txt",
        mode: "0644",
        formats: ["deb"],
      },
    ],
  });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  const packageRoot = path.join(root, "package-root");
  const appDir = path.join(packageRoot, "opt", "chatgpt");
  writeBuildInfoSnapshot(appDir, [id]);

  assert.throws(
    () => stageEnabledPortIntegrationPackageResources(
      packageRoot,
      { appDir, integrationsRoot, packageFormat: "deb" },
    ),
    /must stay outside the packaged app directory/i,
  );
  assert.equal(fs.existsSync(path.join(appDir, "integration-owned.txt")), false);
});

test("port integration package resources cannot target an ancestor of the packaged app directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-app-ancestor-target-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { integrationDir, integrationsRoot, id } = makePackageIntegrationRoot(root, {
    packageResources: [
      {
        source: "payload.txt",
        target: "opt",
        mode: "0644",
        formats: ["deb"],
      },
    ],
  });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  const packageRoot = path.join(root, "package-root");
  const appDir = path.join(packageRoot, "opt", "chatgpt");
  const buildInfoPath = writeBuildInfoSnapshot(appDir, [id]);

  assert.throws(
    () => stageEnabledPortIntegrationPackageResources(
      packageRoot,
      { appDir, integrationsRoot, packageFormat: "deb" },
    ),
    /must stay outside the packaged app directory/i,
  );
  assert.equal(fs.existsSync(buildInfoPath), true);
});

test("port integration package resources must use regular file sources", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-source-type-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    packageResources: [
      {
        source: "payload",
        target: "usr/share/chatgpt-package-framework/payload",
        mode: "0644",
        formats: ["deb"],
      },
    ],
  });
  fs.mkdirSync(path.join(integrationDir, "payload"));
  fs.writeFileSync(path.join(integrationDir, "payload", "nested.txt"), "nested\n");

  assert.throws(
    () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: "deb" }),
    /source must be a regular file/i,
  );
});

test("port integration package staging rejects symlinked resource sources", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-source-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside.txt");
  const target = "usr/share/chatgpt-package-framework/fixture.txt";
  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      { source: "payload-link.txt", target, mode: "0644", formats: ["deb"] },
    ],
  });
  fs.writeFileSync(outside, "outside\n");
  fs.symlinkSync(outside, path.join(integrationDir, "payload-link.txt"));

  const packageRoot = path.join(root, "package-root");
  assert.throws(
    () => stageEnabledPortIntegrationPackageResources(packageRoot, { integrationsRoot, packageFormat: "deb" }),
    /must not contain symbolic links/i,
  );
  assert.equal(fs.existsSync(path.join(packageRoot, target)), false);
});

test("port integration package staging rejects symlinked source ancestors", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-source-ancestor-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside");
  const target = "usr/share/chatgpt-package-framework/fixture.txt";
  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      { source: "linked/payload.txt", target, mode: "0644", formats: ["deb"] },
    ],
  });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "payload.txt"), "outside\n");
  fs.symlinkSync(outside, path.join(integrationDir, "linked"), "junction");

  assert.throws(
    () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: "deb" }),
    /must not contain symbolic links/i,
  );
});

test("port integration package staging rejects symlinked target parents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-target-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside");
  const packageRoot = path.join(root, "package-root");
  const target = "usr/share/chatgpt-package-framework/fixture.txt";
  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    id: "package-framework-fixture",
    title: "Package Framework Fixture",
    packageResources: [
      { source: "payload.txt", target, mode: "0644", formats: ["deb"] },
    ],
  });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  fs.mkdirSync(path.join(packageRoot, "usr", "share"), { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(packageRoot, "usr", "share", "chatgpt-package-framework"), "junction");

  assert.throws(
    () => stageEnabledPortIntegrationPackageResources(packageRoot, { integrationsRoot, packageFormat: "deb" }),
    /must (stay inside the package root|not contain symbolic links)/i,
  );
  assert.equal(fs.existsSync(path.join(outside, "fixture.txt")), false);
});

test("port integration package permission restoration rejects symlinked targets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-restore-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, "outside.txt");
  const packageRoot = path.join(root, "package-root");
  const target = "usr/share/chatgpt-package-framework/payload.txt";
  const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
    packageResources: [
      { source: "payload.txt", target, mode: "0640", formats: ["deb"] },
    ],
  });
  fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
  fs.writeFileSync(outside, "outside\n");
  fs.chmodSync(outside, 0o600);

  const options = { integrationsRoot, packageFormat: "deb" };
  stageEnabledPortIntegrationPackageResources(packageRoot, options);
  fs.rmSync(path.join(packageRoot, target));
  fs.symlinkSync(outside, path.join(packageRoot, target));

  assert.throws(
    () => restoreEnabledPortIntegrationPackageResourcePermissions(packageRoot, options),
    /must not contain symbolic links/i,
  );
  assert.equal(fs.statSync(outside).mode & 0o777, 0o600);
});

test("port integration package resources reject invalid modes and formats", () => {
  const invalidResources = [
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: 644,
        formats: ["deb"],
      },
      error: /file mode must be a quoted octal string/i,
    },
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: "0899",
        formats: ["deb"],
      },
      error: /file mode must be a quoted octal string/i,
    },
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: "4755",
        formats: ["deb"],
      },
      error: /special permission bits are not allowed/i,
    },
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: "2755",
        formats: ["deb"],
      },
      error: /special permission bits are not allowed/i,
    },
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: "1777",
        formats: ["deb"],
      },
      error: /special permission bits are not allowed/i,
    },
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: "0644",
        formats: ["deb", "appimage"],
      },
      error: /unsupported package format.*appimage/i,
    },
    {
      resource: {
        source: "payload.txt",
        target: "usr/share/chatgpt-package-framework/payload.txt",
        mode: "0644",
        formats: "deb",
      },
      error: /formats must be an array/i,
    },
  ];

  for (const { resource, error } of invalidResources) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-invalid-resource-"));
    try {
      const { integrationDir, integrationsRoot } = makePackageIntegrationRoot(root, {
        id: "package-framework-fixture",
        title: "Package Framework Fixture",
        packageResources: [resource],
      });
      fs.writeFileSync(path.join(integrationDir, "payload.txt"), "payload\n");
      assert.throws(
        () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: "deb" }),
        error,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-invalid-format-"));
  try {
    const { integrationsRoot } = makePackageIntegrationRoot(root, {
      id: "package-framework-fixture",
      title: "Package Framework Fixture",
    });
    assert.throws(
      () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: "appimage" }),
      /unsupported package format.*appimage/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("port integration package dependencies reject unsafe tokens and unsupported formats", () => {
  const invalidDependencies = [
    { packageDependencies: { deb: ["fixture-deb-runtime;curl"] }, error: /invalid.*dependency/i },
    { packageDependencies: { deb: [""] }, error: /invalid.*dependency/i },
    { packageDependencies: { deb: "fixture-deb-runtime" }, error: /dependencies.*array/i },
    { packageDependencies: { appimage: ["fixture-deb-runtime"] }, error: /unsupported package format.*appimage/i },
    { packageDependencies: { rpm: ["runtime.so.1%(id)"] }, error: /invalid.*dependency/i },
    { packageDependencies: { rpm: ["runtime.so.1%{_libdir}"] }, error: /invalid.*dependency/i },
    {
      packageDependencies: { rpm: ["runtime.so.1%{chatgpt_elf_suffix}%(id)"] },
      error: /invalid.*dependency/i,
    },
  ];

  for (const { packageDependencies, error } of invalidDependencies) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-invalid-dependency-"));
    try {
      const { integrationsRoot } = makePackageIntegrationRoot(root, {
        id: "package-framework-fixture",
        title: "Package Framework Fixture",
        packageDependencies,
      });
      assert.throws(
        () => enabledPortIntegrationPackagePlan({ integrationsRoot, packageFormat: "deb" }),
        error,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("native package plans require the app integration snapshot to match the current config", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { integrationDir, integrationsRoot, id } = makePackageIntegrationRoot(root, {
    packageResources: [
      {
        source: "fixture.txt",
        target: "usr/share/chatgpt-package-framework/fixture.txt",
        mode: "0644",
      },
    ],
    packageDependencies: {
      deb: ["fixture-deb-runtime"],
    },
  });
  fs.writeFileSync(path.join(integrationDir, "fixture.txt"), "fixture\n");

  const appDir = path.join(root, "app");
  writeBuildInfoSnapshot(appDir, [id]);
  const matchingPlan = enabledPortIntegrationPackagePlan({
    appDir,
    integrationsRoot,
    packageFormat: "deb",
  });
  assert.deepEqual(matchingPlan.dependencies, ["fixture-deb-runtime"]);
  assert.deepEqual(
    matchingPlan.resources.map((resource) => resource.target),
    ["usr/share/chatgpt-package-framework/fixture.txt"],
  );

  writeBuildInfoSnapshot(appDir, []);
  assert.throws(
    () => enabledPortIntegrationPackagePlan({ appDir, integrationsRoot, packageFormat: "deb" }),
    /app snapshot: \[\][\s\S]*current config: \["package-framework-fixture"\]/,
  );

  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"enabled":[]}\n');
  writeBuildInfoSnapshot(appDir, [id]);
  assert.throws(
    () => enabledPortIntegrationPackagePlan({ appDir, integrationsRoot, packageFormat: "deb" }),
    /app snapshot: \["package-framework-fixture"\][\s\S]*current config: \[\]/,
  );
});

test("native package plans strictly validate the current integration config", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-config-validation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { integrationsRoot } = makePackageIntegrationRoot(root, {});
  const appDir = path.join(root, "app");
  writeBuildInfoSnapshot(appDir, []);
  const configPath = path.join(integrationsRoot, "integrations.json");
  const options = { appDir, integrationsRoot, packageFormat: "deb" };

  fs.writeFileSync(configPath, '{"enabled":[]}\n');
  assert.deepEqual(enabledPortIntegrationPackagePlan(options), {
    resources: [],
    dependencies: [],
  });

  fs.writeFileSync(configPath, '{"enabled":[}\n');
  assert.throws(
    () => enabledPortIntegrationPackagePlan(options),
    /could not read port integrations config/i,
  );

  fs.writeFileSync(configPath, '{"enabled":"package-framework-fixture"}\n');
  assert.throws(
    () => enabledPortIntegrationPackagePlan(options),
    /must contain an enabled array/i,
  );

  fs.writeFileSync(configPath, '{"enabled":["INVALID"]}\n');
  assert.throws(
    () => enabledPortIntegrationPackagePlan(options),
    /invalid port integration id/i,
  );

  fs.writeFileSync(
    configPath,
    '{"enabled":["package-framework-fixture","package-framework-fixture"]}\n',
  );
  assert.throws(
    () => enabledPortIntegrationPackagePlan(options),
    /duplicate port integration id/i,
  );

  fs.rmSync(configPath);
  assert.throws(
    () => enabledPortIntegrationPackagePlan(
      { ...options, integrationsConfigPath: configPath },
    ),
    /could not read port integrations config.*file does not exist/i,
  );
});

test("native package plans reject missing or malformed app integration snapshots", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-package-build-info-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { integrationsRoot } = makePackageIntegrationRoot(root, {});
  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"enabled":[]}\n');
  const appDir = path.join(root, "app");

  assert.throws(
    () => enabledPortIntegrationPackagePlan({ appDir, integrationsRoot, packageFormat: "deb" }),
    /could not read packaged app build info/i,
  );

  const buildInfoPath = writeBuildInfoSnapshot(appDir, []);
  assert.deepEqual(enabledIntegrationIdsFromBuildInfo(appDir), []);
  fs.writeFileSync(buildInfoPath, '{"portIntegrations":{}}\n');
  assert.throws(
    () => enabledPortIntegrationPackagePlan({ appDir, integrationsRoot, packageFormat: "deb" }),
    /must contain portIntegrations\.enabled/i,
  );
  fs.writeFileSync(buildInfoPath, '{"portIntegrations":{"enabled":["INVALID"]}}\n');
  assert.throws(
    () => enabledPortIntegrationPackagePlan({ appDir, integrationsRoot, packageFormat: "deb" }),
    /must match/i,
  );
  writeBuildInfoSnapshot(appDir, [
    "package-framework-fixture",
    "package-framework-fixture",
  ]);
  assert.throws(
    () => enabledIntegrationIdsFromBuildInfo(appDir),
    /duplicate port integration id/i,
  );
});


test("strict integration config rejects missing enabled manifests", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-integration-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const integrationsRoot = path.join(root, "port-integrations");
  fs.mkdirSync(integrationsRoot, { recursive: true });
  fs.writeFileSync(path.join(integrationsRoot, "integrations.json"), '{"enabled":["missing"]}\n');
  assert.throws(
    () => enabledPortIntegrationsConfig({ integrationsRoot, strictConfig: true }),
    /Enabled port integration ids not found in this checkout: missing/,
  );
});
