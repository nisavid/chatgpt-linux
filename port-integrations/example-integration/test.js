#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { applyMainBundlePatch } = require("./patch.js");
const {
  enabledPortIntegrationIds,
  enabledPortIntegrationStageHooks,
  loadPortIntegrationPatchDescriptors,
  portIntegrationsConfigPath,
} = require("../../scripts/lib/port-integrations.js");
const { createPatchReport } = require("../../scripts/lib/patch-report.js");
const {
  patchExtractedApp,
  patchMainBundleSource,
} = require("../../scripts/patches/runner.js");

function withTempIntegrationRoot(config, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-example-integration-test-"));
  try {
    fs.writeFileSync(path.join(root, "integrations.example.json"), JSON.stringify({ enabled: [], disabled: [] }, null, 2));
    const integrationConfig = Array.isArray(config) ? { enabled: config } : config;
    if (integrationConfig != null) {
      fs.writeFileSync(path.join(root, "integrations.json"), JSON.stringify(integrationConfig, null, 2));
    }
    fs.cpSync(__dirname, path.join(root, "example-integration"), { recursive: true });
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function withTempCheckoutIntegrationRoot(fn) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-example-integration-checkout-"));
  try {
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: /tmp/fake-worktree\n");
    const root = path.join(repo, "port-integrations");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "integrations.example.json"), JSON.stringify({ enabled: [], disabled: [] }, null, 2));
    fs.cpSync(__dirname, path.join(root, "example-integration"), { recursive: true });
    return fn(root);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test("example integration patches only its synthetic marker", () => {
  assert.equal(
    applyMainBundlePatch("before;chatgptLinuxExampleIntegrationDisabled();after"),
    "before;chatgptLinuxExampleIntegrationEnabled();after",
  );
});

test("example integration is a no-op without its synthetic marker", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(applyMainBundlePatch("real codex bundle"), "real codex bundle");
  } finally {
    console.warn = originalWarn;
  }
});

test("example integration stays disabled until listed in integrations.json", () => {
  withTempIntegrationRoot([], (root) => {
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), []);
    assert.deepEqual(enabledPortIntegrationStageHooks({ integrationsRoot: root }), []);
    assert.deepEqual(loadPortIntegrationPatchDescriptors({ integrationsRoot: root }), []);
  });
});

test("missing explicitly enabled integrations are not reported as enabled", () => {
  withTempIntegrationRoot(["missing-integration"], (root) => {
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), []);
  });
});

test("default-enabled integrations load unless listed in disabled", () => {
  withTempIntegrationRoot([], (root) => {
    const manifestPath = path.join(root, "example-integration", "integration.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.defaultEnabled = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    fs.writeFileSync(path.join(root, "integrations.json"), JSON.stringify({}, null, 2));
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), ["example-integration"]);

    fs.writeFileSync(
      path.join(root, "integrations.json"),
      JSON.stringify({ disabled: ["example-integration"] }, null, 2),
    );
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), []);
  });
});

test("default-enabled integrations can be disabled from XDG user config", () => {
  withTempIntegrationRoot(null, (root) => {
    const manifestPath = path.join(root, "example-integration", "integration.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.defaultEnabled = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const configHome = path.join(root, "xdg-config");
    const appConfigDir = path.join(configHome, "chatgpt");
    fs.mkdirSync(appConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(appConfigDir, "port-integrations.json"),
      JSON.stringify({ disabled: ["example-integration"] }, null, 2),
    );

    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalHome = process.env.HOME;
    const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    const originalAppId = process.env.CHATGPT_APP_ID;
    const originalLinuxAppId = process.env.CHATGPT_LINUX_APP_ID;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      process.env.HOME = path.join(root, "home");
      delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      delete process.env.CHATGPT_APP_ID;
      delete process.env.CHATGPT_LINUX_APP_ID;
      assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), []);
    } finally {
      if (originalConfigHome == null) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalConfigHome;
      }
      if (originalHome == null) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalConfig == null) {
        delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
      if (originalAppId == null) {
        delete process.env.CHATGPT_APP_ID;
      } else {
        process.env.CHATGPT_APP_ID = originalAppId;
      }
      if (originalLinuxAppId == null) {
        delete process.env.CHATGPT_LINUX_APP_ID;
      } else {
        process.env.CHATGPT_LINUX_APP_ID = originalLinuxAppId;
      }
    }
  });
});

test("checkout integration roots ignore persistent XDG user config fallback", () => {
  withTempCheckoutIntegrationRoot((root) => {
    const manifestPath = path.join(root, "example-integration", "integration.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.defaultEnabled = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const configHome = path.join(root, "xdg-config");
    const appConfigDir = path.join(configHome, "chatgpt");
    fs.mkdirSync(appConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(appConfigDir, "port-integrations.json"),
      JSON.stringify({ disabled: ["example-integration"] }, null, 2),
    );

    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalHome = process.env.HOME;
    const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      process.env.HOME = path.join(root, "home");
      delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;

      assert.equal(portIntegrationsConfigPath(root), path.join(root, "integrations.example.json"));
      assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), ["example-integration"]);
    } finally {
      if (originalConfigHome == null) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalConfigHome;
      }
      if (originalHome == null) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalConfig == null) {
        delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
    }
  });
});

test("empty CHATGPT_APP_ID does not block CHATGPT_LINUX_APP_ID config fallback", () => {
  withTempIntegrationRoot(null, (root) => {
    const configHome = path.join(root, "xdg-config");
    const appConfigDir = path.join(configHome, "chatgpt-cua-lab");
    const configPath = path.join(appConfigDir, "port-integrations.json");
    fs.mkdirSync(appConfigDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ enabled: [] }, null, 2));

    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalHome = process.env.HOME;
    const originalConfig = process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
    const originalAppId = process.env.CHATGPT_APP_ID;
    const originalLinuxAppId = process.env.CHATGPT_LINUX_APP_ID;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      process.env.HOME = path.join(root, "home");
      delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      process.env.CHATGPT_APP_ID = "  ";
      process.env.CHATGPT_LINUX_APP_ID = "chatgpt-cua-lab";

      assert.equal(portIntegrationsConfigPath(root), configPath);
    } finally {
      if (originalConfigHome == null) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalConfigHome;
      }
      if (originalHome == null) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalConfig == null) {
        delete process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG;
      } else {
        process.env.CHATGPT_PORT_INTEGRATIONS_CONFIG = originalConfig;
      }
      if (originalAppId == null) {
        delete process.env.CHATGPT_APP_ID;
      } else {
        process.env.CHATGPT_APP_ID = originalAppId;
      }
      if (originalLinuxAppId == null) {
        delete process.env.CHATGPT_LINUX_APP_ID;
      } else {
        process.env.CHATGPT_LINUX_APP_ID = originalLinuxAppId;
      }
    }
  });
});

test("example integration exposes its patch and stage hook when enabled", () => {
  withTempIntegrationRoot(["example-integration"], (root) => {
    assert.deepEqual(enabledPortIntegrationIds({ integrationsRoot: root }), ["example-integration"]);

    const hooks = enabledPortIntegrationStageHooks({ integrationsRoot: root });
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].id, "example-integration");
    assert.equal(path.basename(hooks[0].path), "stage.sh");

    const patches = loadPortIntegrationPatchDescriptors({ integrationsRoot: root });
    assert.equal(patches.length, 1);
    assert.equal(patches[0].name, "integration:example-integration:synthetic-marker");
    assert.equal(
      patches[0].apply("chatgptLinuxExampleIntegrationDisabled()", {}),
      "chatgptLinuxExampleIntegrationEnabled()",
    );
  });
});

test("example integration participates in main bundle patching and patch reports", () => {
  withTempIntegrationRoot(["example-integration"], (root) => {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-example-integration-app-"));
    try {
      assert.equal(
        patchMainBundleSource("chatgptLinuxExampleIntegrationDisabled()", null, {
          corePatchRoot: path.join(root, "core-patches"),
          integrationsRoot: root,
        }),
        "chatgptLinuxExampleIntegrationEnabled()",
      );

      const buildDir = path.join(tempApp, ".vite", "build");
      fs.mkdirSync(buildDir, { recursive: true });
      fs.writeFileSync(path.join(buildDir, "main.js"), "chatgptLinuxExampleIntegrationDisabled()");

      const report = createPatchReport();
      patchExtractedApp(tempApp, {
        corePatchRoot: path.join(root, "core-patches"),
        integrationsRoot: root,
        report,
      });

      assert.match(fs.readFileSync(path.join(buildDir, "main.js"), "utf8"), /chatgptLinuxExampleIntegrationEnabled\(\)/);
      assert.ok(report.patches.some((patch) =>
        patch.name === "integration:example-integration:synthetic-marker" &&
        patch.status === "applied"
      ));
    } finally {
      fs.rmSync(tempApp, { recursive: true, force: true });
    }
  });
});

test("example integration stage hook is runnable through the port integration shell runner", () => {
  withTempIntegrationRoot(["example-integration"], (root) => {
    const marker = path.join(root, "stage-marker.txt");
    const repoRoot = path.resolve(__dirname, "..", "..");
    const runner = path.join(repoRoot, "scripts", "lib", "port-integrations.sh");
    const result = spawnSync(
      "bash",
      [
        "-lc",
        [
          "source \"$PORT_INTEGRATIONS_RUNNER\"",
          "info(){ echo \"$*\" >&2; }",
          "warn(){ echo \"$*\" >&2; }",
          "SCRIPT_DIR=\"$REPO_ROOT\"",
          "INSTALL_DIR=\"$TMP_INSTALL_DIR\"",
          "WORK_DIR=\"$TMP_WORK_DIR\"",
          "ARCH=x86_64",
          "run_port_integration_stage_hooks",
        ].join("\n"),
      ],
      {
        env: {
          ...process.env,
          PORT_INTEGRATIONS_RUNNER: runner,
          REPO_ROOT: repoRoot,
          TMP_INSTALL_DIR: path.join(root, "install"),
          TMP_WORK_DIR: path.join(root, "work"),
          CHATGPT_PORT_INTEGRATIONS_ROOT: root,
          CHATGPT_EXAMPLE_INTEGRATION_STAGE_MARKER: marker,
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(marker, "utf8"), /example-stage:x86_64:/);
    assert.match(result.stderr, /Running port integration stage hook: example-integration/);
  });
});

test("port integration shell runner fails when an enabled stage hook fails", () => {
  withTempIntegrationRoot(["example-integration"], (root) => {
    fs.writeFileSync(
      path.join(root, "example-integration", "stage.sh"),
      "#!/bin/bash\nset -Eeuo pipefail\nexit 42\n",
    );
    const repoRoot = path.resolve(__dirname, "..", "..");
    const runner = path.join(repoRoot, "scripts", "lib", "port-integrations.sh");
    const result = spawnSync(
      "bash",
      [
        "-lc",
        [
          "source \"$PORT_INTEGRATIONS_RUNNER\"",
          "info(){ echo \"$*\" >&2; }",
          "warn(){ echo \"$*\" >&2; }",
          "SCRIPT_DIR=\"$REPO_ROOT\"",
          "INSTALL_DIR=\"$TMP_INSTALL_DIR\"",
          "WORK_DIR=\"$TMP_WORK_DIR\"",
          "ARCH=x86_64",
          "run_port_integration_stage_hooks",
        ].join("\n"),
      ],
      {
        env: {
          ...process.env,
          PORT_INTEGRATIONS_RUNNER: runner,
          REPO_ROOT: repoRoot,
          TMP_INSTALL_DIR: path.join(root, "install"),
          TMP_WORK_DIR: path.join(root, "work"),
          CHATGPT_PORT_INTEGRATIONS_ROOT: root,
        },
        encoding: "utf8",
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /port integration stage hook failed: example-integration/);
  });
});
