#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  defaultMaterializePackage,
  discoverBundledNodeHid,
  inspectElf,
  selectPrebuild,
  stageCodexMicroNativeBinding,
  validateArtifactManifest,
} = require("./native-binding.js");
const {
  CODEX_MICRO_GATE_ID,
  CODEX_MICRO_GATE_MARKER,
  CODEX_MICRO_HOTPLUG_MARKER,
  CODEX_MICRO_ROUTE,
  applyCodexMicroFeatureGatePatch,
  applyCodexMicroHotplugPatch,
  descriptors,
  exportedFeatureGateHook,
  findCodexMicroServiceBundle,
  matchesCodexMicroFeatureGateContract,
  patchCodexMicroService,
} = require("./patch.js");
const {
  enabledPortIntegrationPackageDependencies,
  enabledPortIntegrationPackageFiles,
  loadPortIntegrationPatchDescriptors,
  stageEnabledPortIntegrationPackageResources,
} = require("../../scripts/lib/port-integrations.js");

const DEVICE_KIT_RELATIVE = path.join(
  "node_modules",
  "@worklouder",
  "device-kit-oai",
);
const WORK_LOUDER_KIT_RELATIVE = path.join(
  DEVICE_KIT_RELATIVE,
  "node_modules",
  "@worklouder",
  "wl-device-kit",
);
const NODE_HID_RELATIVE = path.join(
  WORK_LOUDER_KIT_RELATIVE,
  "node_modules",
  "node-hid",
);
const FIXTURE_NODE_HID_LOADER =
  "module.exports = require('pkg-prebuilds')(__dirname); // bundled loader\n";
const FIXTURE_NODE_HID_OPTIONS =
  "module.exports = { name: 'HID', tags: ['backend'] }; // bundled options\n";

function integrationSelection(integrationsRoot, enabled) {
  const disabled = fs.readdirSync(integrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(integrationsRoot, entry.name, "integration.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(fs.readFileSync(manifestPath, "utf8")).id)
    .filter((id) => !enabled.includes(id));
  return { enabled, disabled };
}

function tempDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, contents, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, mode == null ? undefined : { mode });
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function makeElf(arch, marker = arch) {
  const machines = { x64: 62, arm64: 183 };
  const machine = machines[arch];
  if (machine == null) {
    throw new Error(`Unsupported ELF fixture architecture: ${arch}`);
  }
  const contents = Buffer.alloc(128);
  contents.set([0x7f, 0x45, 0x4c, 0x46], 0);
  contents[4] = 2;
  contents[5] = 1;
  contents[6] = 1;
  contents.writeUInt16LE(3, 16);
  contents.writeUInt16LE(machine, 18);
  contents.writeUInt32LE(1, 20);
  contents.write(marker, 64, "utf8");
  return contents;
}

function bindingRelativePath(arch) {
  return path.join(
    "prebuilds",
    `HID_hidraw-linux-${arch}`,
    "node-napi-v4.node",
  );
}

function shippedArtifact() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "native-artifacts.json"), "utf8"),
  );
}

function fixtureArtifact(binaries = {}) {
  const x64 = binaries.x64 ?? makeElf("x64", "fixture-x64");
  const arm64 = binaries.arm64 ?? makeElf("arm64", "fixture-arm64");
  return {
    ...shippedArtifact(),
    loaderContract: {
      main: "./nodehid.js",
      napiVersions: [4],
      files: {
        "nodehid.js": sha256(FIXTURE_NODE_HID_LOADER),
        "binding-options.js": sha256(FIXTURE_NODE_HID_OPTIONS),
      },
    },
    prebuilds: {
      x64: {
        path: bindingRelativePath("x64"),
        sha256: sha256(x64),
      },
      arm64: {
        path: bindingRelativePath("arm64"),
        sha256: sha256(arm64),
      },
    },
  };
}

function createBundledFixture(t, options = {}) {
  const root = tempDirectory(t, "codex-micro-bundled-");
  const extractedDir = path.join(root, "app-extracted");
  const deviceKitDir = path.join(extractedDir, DEVICE_KIT_RELATIVE);
  const workLouderKitDir = path.join(extractedDir, WORK_LOUDER_KIT_RELATIVE);
  const nodeHidDir = path.join(extractedDir, NODE_HID_RELATIVE);

  writeJson(path.join(deviceKitDir, "package.json"), {
    name: "@worklouder/device-kit-oai",
    version: "0.4.0",
  });
  writeJson(path.join(workLouderKitDir, "package.json"), {
    name: "@worklouder/wl-device-kit",
    version: "0.12.0",
  });
  writeJson(path.join(nodeHidDir, "package.json"), {
    name: "node-hid",
    version: options.bundledVersion ?? "3.4.0",
    license: "(MIT OR X11)",
    main: "./nodehid.js",
    binary: { napi_versions: [4] },
  });
  writeFile(
    path.join(nodeHidDir, "nodehid.js"),
    options.loader ?? FIXTURE_NODE_HID_LOADER,
  );
  writeFile(
    path.join(nodeHidDir, "binding-options.js"),
    FIXTURE_NODE_HID_OPTIONS,
  );
  writeFile(
    path.join(nodeHidDir, "prebuilds/HID-darwin-arm64/node-napi-v4.node"),
    "bundled Mach-O bytes",
  );

  return { extractedDir, nodeHidDir };
}

function createMaterializedPackage(t, options = {}) {
  const packageDir = path.join(
    tempDirectory(t, "codex-micro-node-hid-artifact-"),
    "package",
  );
  writeJson(path.join(packageDir, "package.json"), {
    name: options.name ?? "node-hid",
    version: options.version ?? "3.4.0",
    license: options.license ?? "(MIT OR X11)",
    scripts: { install: "must never execute" },
  });
  writeFile(
    path.join(packageDir, "nodehid.js"),
    "throw new Error('artifact JavaScript must not be copied');\n",
  );
  for (const [arch, binary] of Object.entries(options.binaries ?? {})) {
    writeFile(path.join(packageDir, bindingRelativePath(arch)), binary, 0o755);
  }
  return packageDir;
}

function materializer(packageDir, artifact, overrides = {}) {
  return async () => ({
    packageDir,
    integrity: overrides.integrity ?? artifact.integrity,
    shasum: overrides.shasum ?? artifact.shasum,
  });
}

function currentFeatureGateFixture() {
  return [
    "const warning=`useFeatureGate hook failed to find a valid StatsigClient`;",
    "function gg(e){let t=(0,Kit.c)(2);Git(typeof e==`string`);let n;return t[0]===e?n=t[1]:(n=typeof e==`boolean`?e:{cache:`signal`,resolve(t,n){return pg.resolve(t,n,e).atom},scope:pg.scope},t[0]=e,t[1]=n),Y(n)}",
    `const microGate=gg(\`${CODEX_MICRO_GATE_ID}\`);`,
    `const microRoute=\`${CODEX_MICRO_ROUTE}\`;`,
    "export{gg as DCt};",
  ].join("");
}

function currentCodexMicroServiceFixture() {
  return [
    "const fs=require(\"node:fs\");",
    "var nativeName=`hid-topology-watcher.node`,bindingName=`hid_topology_watcher.node`;",
    "function p(){return require(bindingName)}",
    "function d(e){return p().watch(e)}",
    "function f(){return p().findCodexMicroInterfaces()}",
    "class CodexMicroService{",
    "start(){try{this.watcher=d(()=>this.handleHidTopologyChanged())}",
    "catch(error){this.scheduleTopologyFallbackScan()}}",
    "handleHidTopologyChanged(){this.requestTopologyReconciliation()}",
    "scheduleTopologyFallbackScan(){this.timer=setTimeout(()=>this.scan(),3e4)}",
    "}",
  ].join("");
}

function evaluatePatchedTopologyWatcher(options = {}) {
  const source = applyCodexMicroHotplugPatch(currentCodexMicroServiceFixture());
  const devWatchers = [];
  const nativeWatchCalls = [];
  const timeouts = new Map();
  const intervals = new Map();
  let nextTimerId = 1;

  const makeTimer = (kind, callback, delay) => {
    const timer = {
      id: nextTimerId++,
      kind,
      unreferenced: false,
      unref() {
        this.unreferenced = true;
      },
    };
    (kind === "timeout" ? timeouts : intervals).set(timer, {
      callback,
      delay,
    });
    return timer;
  };
  const fakeFs = {
    watch(target, watchOptions, listener) {
      if (options.watchError != null) {
        throw options.watchError;
      }
      const events = new Map();
      const watcher = {
        closeCount: 0,
        close() {
          this.closeCount += 1;
        },
        on(name, callback) {
          events.set(name, callback);
          return this;
        },
      };
      devWatchers.push({ target, watchOptions, listener, events, watcher });
      return watcher;
    },
  };
  const nativeHandle = { dispose() {} };
  const nativeBinding = {
    findCodexMicroInterfaces() {
      return [];
    },
    watch(callback) {
      nativeWatchCalls.push(callback);
      return nativeHandle;
    },
  };
  const fakeRequire = (request) => {
    if (request === "node:fs") {
      return fakeFs;
    }
    if (request === "hid_topology_watcher.node") {
      return nativeBinding;
    }
    throw new Error(`Unexpected fixture require: ${request}`);
  };
  const topologyWatcher = new Function(
    "require",
    "process",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    `${source};return d;`,
  )(
    fakeRequire,
    { platform: options.platform ?? "linux" },
    (callback, delay) => makeTimer("timeout", callback, delay),
    (timer) => timeouts.delete(timer),
    (callback, delay) => makeTimer("interval", callback, delay),
    (timer) => intervals.delete(timer),
  );

  return {
    devWatchers,
    intervals,
    nativeHandle,
    nativeWatchCalls,
    timeouts,
    topologyWatcher,
  };
}

function runOnlyTimer(timers) {
  assert.equal(timers.size, 1);
  const [timer, entry] = timers.entries().next().value;
  if (timer.kind === "timeout") {
    timers.delete(timer);
  }
  entry.callback();
  return { timer, delay: entry.delay };
}

test("Codex Micro locally enables only its current official-app feature gate", () => {
  const source = currentFeatureGateFixture();
  const hook = exportedFeatureGateHook(source);
  assert.deepEqual(hook, {
    source: "function gg(e){let t=(0,Kit.c)(2);Git(typeof e==`string`);let n;return t[0]===e?n=t[1]:(n=typeof e==`boolean`?e:{cache:`signal`,resolve(t,n){return pg.resolve(t,n,e).atom},scope:pg.scope},t[0]=e,t[1]=n),Y(n)}",
    hookName: "gg",
    argumentName: "e",
  });
  assert.equal(matchesCodexMicroFeatureGateContract(source), true);

  const patched = applyCodexMicroFeatureGatePatch(source);
  assert.match(
    patched,
    new RegExp(
      `function gg\\(e\\)\\{let t=\\(0,Kit\\.c\\)\\(2\\);Git\\(typeof e==\\\`string\\\`\\);` +
        `let n;return t\\[0\\]===e\\?n=t\\[1\\]:\\(n=typeof e==\\\`boolean\\\`\\?e:` +
        `\\{cache:\\\`signal\\\`,resolve\\(t,n\\)\\{return pg\\.resolve\\(t,n,e\\)\\.atom\\},` +
        `scope:pg\\.scope\\},t\\[0\\]=e,t\\[1\\]=n\\),Y\\(n\\)\\|\\|` +
        `e===\\\`${CODEX_MICRO_GATE_ID}\\\`/\\*${CODEX_MICRO_GATE_MARKER}\\*/\\}`,
    ),
  );
  assert.equal(applyCodexMicroFeatureGatePatch(patched), patched);
  assert.equal(matchesCodexMicroFeatureGateContract(patched), true);
});

test("Codex Micro keeps the current gate hook active while enabling its gate", () => {
  const patched = applyCodexMicroFeatureGatePatch(currentFeatureGateFixture());
  const functionStart = patched.indexOf("function gg(");
  const functionEnd = patched.indexOf("const microGate", functionStart);
  const memo = [];
  const contextChecks = [];
  const atomReads = [];
  const gateHook = new Function(
    "Kit",
    "Git",
    "pg",
    "Y",
    `${patched.slice(functionStart, functionEnd)};return gg;`,
  )(
    { c: (size) => (assert.equal(size, 2), memo) },
    (isString) => contextChecks.push(isString),
    { resolve: () => assert.fail("the lazy signal must not resolve during this probe"), scope: {} },
    (signal) => (atomReads.push(signal), signal === true),
  );

  assert.equal(gateHook(CODEX_MICRO_GATE_ID), true);
  assert.equal(gateHook("unrelated-gate"), false);
  assert.equal(gateHook(true), true);
  assert.deepEqual(contextChecks, [true, true, false]);
  assert.equal(atomReads.length, 3);
});

test("Codex Micro rejects the superseded direct atom-read gate shape", () => {
  const superseded = [
    "const warning=`useFeatureGate hook failed to find a valid StatsigClient`;",
    "function Rh(e){return bnt(),Bo(Fh,e)}",
    `const microGate=Rh(\`${CODEX_MICRO_GATE_ID}\`);`,
    `const microRoute=\`${CODEX_MICRO_ROUTE}\`;`,
    "export{Rh as rlt};",
  ].join("");

  assert.equal(exportedFeatureGateHook(superseded), null);
  assert.equal(matchesCodexMicroFeatureGateContract(superseded), false);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(applyCodexMicroFeatureGatePatch(superseded), superseded);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [
    "WARN: Could not find the current exported feature-gate hook - " +
      "skipping Codex Micro gate override",
  ]);
});

test("Codex Micro service patch adds disposable Linux hidraw hot-plug discovery", () => {
  const source = currentCodexMicroServiceFixture();
  const patched = applyCodexMicroHotplugPatch(source);

  assert.notEqual(patched, source);
  assert.match(patched, new RegExp(CODEX_MICRO_HOTPLUG_MARKER));
  assert.match(patched, /process\.platform===`linux`/);
  assert.match(patched, /require\(`node:fs`\)\.watch\(`\/dev`/);
  assert.match(patched, /\^hidraw/);
  assert.match(patched, /dispose\(\)/);
  assert.match(patched, /setInterval\(chatgptLinuxNotify,2e3\)/);
  assert.match(patched, /clearInterval\(chatgptLinuxPollTimer\)/);
  assert.match(patched, /if\(chatgptLinuxDisposed\)return/);
  assert.match(patched, /return p\(\)\.watch\(e\)/);
  assert.doesNotMatch(patched, /function d\(e\)\{[^}]*let e=/);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(applyCodexMicroHotplugPatch(patched), patched);
});

test("Codex Micro Linux hot-plug watcher filters, debounces, and disposes", () => {
  const runtime = evaluatePatchedTopologyWatcher();
  let notifications = 0;
  const handle = runtime.topologyWatcher(() => {
    notifications += 1;
  });

  assert.equal(runtime.nativeWatchCalls.length, 0);
  assert.equal(runtime.devWatchers.length, 1);
  const devWatcher = runtime.devWatchers[0];
  assert.equal(devWatcher.target, "/dev");
  assert.deepEqual(devWatcher.watchOptions, { persistent: false });

  devWatcher.listener("rename", "event0");
  assert.equal(runtime.timeouts.size, 0);
  devWatcher.listener("rename", "hidraw7");
  assert.equal(runOnlyTimer(runtime.timeouts).delay, 100);
  assert.equal(notifications, 1);

  devWatcher.listener("change", null);
  assert.equal(runtime.timeouts.size, 1);
  handle.dispose();
  assert.equal(runtime.timeouts.size, 0);
  assert.equal(runtime.intervals.size, 0);
  assert.equal(devWatcher.watcher.closeCount, 1);

  devWatcher.events.get("error")(new Error("late watcher error"));
  assert.equal(runtime.intervals.size, 0);
  assert.equal(notifications, 1);
});

test("Codex Micro Linux hot-plug watcher polls only after watch failure", () => {
  const runtime = evaluatePatchedTopologyWatcher({
    watchError: new Error("watch unavailable"),
  });
  let notifications = 0;
  const handle = runtime.topologyWatcher(() => {
    notifications += 1;
  });

  assert.equal(runtime.devWatchers.length, 0);
  assert.equal(runtime.intervals.size, 1);
  const [interval] = runtime.intervals.keys();
  assert.equal(interval.unreferenced, true);
  assert.equal(runOnlyTimer(runtime.timeouts).delay, 100);
  assert.equal(notifications, 1);

  assert.equal(runOnlyTimer(runtime.intervals).delay, 2_000);
  assert.equal(runOnlyTimer(runtime.timeouts).delay, 100);
  assert.equal(notifications, 2);

  handle.dispose();
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.timeouts.size, 0);
});

test("Codex Micro keeps the native topology watcher outside Linux", () => {
  const runtime = evaluatePatchedTopologyWatcher({ platform: "darwin" });
  const callback = () => {};

  assert.equal(runtime.topologyWatcher(callback), runtime.nativeHandle);
  assert.deepEqual(runtime.nativeWatchCalls, [callback]);
  assert.equal(runtime.devWatchers.length, 0);
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.timeouts.size, 0);
});

test("Codex Micro service patch rejects unrelated topology watchers", () => {
  const unrelated =
    "function watchTopology(callback){return loadWatcher().watch(callback)}";
  assert.equal(applyCodexMicroHotplugPatch(unrelated), unrelated);
  const ambiguous =
    currentCodexMicroServiceFixture() + currentCodexMicroServiceFixture();
  assert.equal(applyCodexMicroHotplugPatch(ambiguous), ambiguous);
});

test("Codex Micro service discovery patches exactly one current bundle", (t) => {
  const root = tempDirectory(t, "codex-micro-hotplug-");
  const buildDir = path.join(root, ".vite", "build");
  const servicePath = path.join(buildDir, "service-current.js");
  writeFile(servicePath, currentCodexMicroServiceFixture());
  writeFile(path.join(buildDir, "unrelated.js"), "const unrelated=true;");

  const discovery = findCodexMicroServiceBundle(root);
  assert.equal(discovery.target, servicePath);
  assert.equal(discovery.result.matched, 1);
  assert.equal(discovery.result.changed, 1);

  const result = patchCodexMicroService(root);
  assert.equal(result.changed, 1);
  assert.equal(result.target, ".vite/build/service-current.js");
  assert.match(fs.readFileSync(servicePath, "utf8"), new RegExp(CODEX_MICRO_HOTPLUG_MARKER));

  const repeated = patchCodexMicroService(root);
  assert.equal(repeated.changed, 0);
  assert.equal(repeated.matched, 1);
});

test("generic Statsig hook bundles are not accepted as Codex Micro assets", () => {
  const generic = currentFeatureGateFixture()
    .replace(`const microGate=gg(\`${CODEX_MICRO_GATE_ID}\`);`, "")
    .replace(`const microRoute=\`${CODEX_MICRO_ROUTE}\`;`, "");
  assert.equal(exportedFeatureGateHook(generic)?.hookName, "gg");
  assert.equal(matchesCodexMicroFeatureGateContract(generic), false);
  assert.equal(applyCodexMicroFeatureGatePatch(generic), generic);
});

test("both the Codex Micro gate id and route are required", () => {
  const withoutGate = currentFeatureGateFixture().replace(CODEX_MICRO_GATE_ID, "different-gate");
  const withoutRoute = currentFeatureGateFixture().replace(CODEX_MICRO_ROUTE, "/settings/other");
  assert.equal(matchesCodexMicroFeatureGateContract(withoutGate), false);
  assert.equal(matchesCodexMicroFeatureGateContract(withoutRoute), false);
});

test("Codex Micro gate drift cannot redirect the patch to an unrelated exported hook", () => {
  const drifted = [
    "const warning=`useFeatureGate hook failed to find a valid StatsigClient`;",
    "function Ah(e){return changedGateShape(e)}",
    "function Uh(e){let t=(0,Cache.c)(2);touch(typeof e==`string`);let n;return t[0]===e?n=t[1]:(n=typeof e==`boolean`?e:{cache:`signal`,resolve(t,n){return atoms.resolve(t,n,e).atom},scope:atoms.scope},t[0]=e,t[1]=n),read(n)}",
    `const microGate=Ah(\`${CODEX_MICRO_GATE_ID}\`);`,
    `const microRoute=\`${CODEX_MICRO_ROUTE}\`;`,
    "export{Ah as gate,Uh as unrelated};",
  ].join("");

  assert.equal(exportedFeatureGateHook(drifted)?.hookName, "Uh");
  assert.equal(matchesCodexMicroFeatureGateContract(drifted), false);
  assert.equal(applyCodexMicroFeatureGatePatch(drifted), drifted);
});

test("Codex Micro hook matching rejects identifier suffix collisions", () => {
  const drifted = [
    "const warning=`useFeatureGate hook failed to find a valid StatsigClient`;",
    "function Rh(e){return changedGateShape(e)}",
    "function h(e){let t=(0,Cache.c)(2);touch(typeof e==`string`);let n;return t[0]===e?n=t[1]:(n=typeof e==`boolean`?e:{cache:`signal`,resolve(t,n){return atoms.resolve(t,n,e).atom},scope:atoms.scope},t[0]=e,t[1]=n),read(n)}",
    `const microGate=Rh(\`${CODEX_MICRO_GATE_ID}\`);`,
    `const microRoute=\`${CODEX_MICRO_ROUTE}\`;`,
    "export{Rh as gate,h as unrelated};",
  ].join("");

  assert.equal(exportedFeatureGateHook(drifted)?.hookName, "h");
  assert.equal(matchesCodexMicroFeatureGateContract(drifted), false);
  assert.equal(applyCodexMicroFeatureGatePatch(drifted), drifted);
});

test("Codex Micro route matching requires the exact current route literal", () => {
  const drifted = currentFeatureGateFixture()
    .replace(CODEX_MICRO_ROUTE, `${CODEX_MICRO_ROUTE}-v2`);
  assert.equal(matchesCodexMicroFeatureGateContract(drifted), false);
  assert.equal(applyCodexMicroFeatureGatePatch(drifted), drifted);
});

test("Codex Micro gate patch targets only the current app-initial bundle shape", () => {
  const descriptor = descriptors.find(({ id }) => id === "webview-feature-gate");
  assert.ok(descriptor);
  assert.equal(descriptor.pattern.test("app-initial-C-fROkKo.js"), true);
  assert.equal(descriptor.pattern.test("app-initial~old-chunk.js"), false);
});

test("the shipped artifact manifest pins the current archive and loader contract", () => {
  const artifact = shippedArtifact();
  assert.doesNotThrow(() => validateArtifactManifest(artifact));
  assert.equal(artifact.name, "node-hid");
  assert.equal(artifact.version, "3.4.0");
  assert.equal(
    artifact.integrity,
    "sha512-Br7EO3bJARAJBdtcsGzF/Vs5TjfbkaMdglqLQ+Rk9GOGgVqv5DxYUVH5znLerJU+OfBWw8sd552Ujcprz1bG9g==",
  );
  assert.equal(artifact.shasum, "dca0b7eb00eb9ee8bc652ef0437e30ed1889fba4");
  assert.deepEqual(artifact.loaderContract, {
    main: "./nodehid.js",
    napiVersions: [4],
    files: {
      "nodehid.js": "fdfbaa5a6daf95886de570df6536f0c7ba59991db62222e4cf5b512225c09bf5",
      "binding-options.js": "e7c820107f3b6571ca1505a5ffbe17511088336e4c410ec718ea9ec200c6b1e6",
    },
  });
});

test("the shipped artifact manifest is prebuild-only and pinned for x64 and arm64", () => {
  const artifact = shippedArtifact();
  assert.deepEqual(Object.keys(artifact.prebuilds).sort(), ["arm64", "x64"]);
  assert.equal(
    artifact.prebuilds.x64.sha256,
    "5b50d9229ca6ebc78eba1dd9a8c73de18035addf041dbc5a1323cb904dd838c4",
  );
  assert.equal(
    artifact.prebuilds.arm64.sha256,
    "b0e734bfcca7a2f6ce8e9543a2d39836ff61d3dadf17de5ae5a4387118457b58",
  );
  assert.equal(fs.existsSync(path.join(__dirname, "source-build")), false);
});

for (const arch of ["x64", "arm64"]) {
  test(`stages only the verified ${arch} prebuild into the exact nested node-hid`, async (t) => {
    const binary = makeElf(arch, `${arch}-verified`);
    const artifact = fixtureArtifact({ [arch]: binary });
    const fixture = createBundledFixture(t);
    const packageDir = createMaterializedPackage(t, {
      binaries: { [arch]: binary },
    });

    const result = await stageCodexMicroNativeBinding({
      extractedDir: fixture.extractedDir,
      arch,
      artifactManifest: artifact,
      materializePackage: materializer(packageDir, artifact),
    });
    const targetPath = path.join(fixture.nodeHidDir, bindingRelativePath(arch));
    assert.deepEqual(fs.readFileSync(targetPath), binary);
    assert.equal(fs.statSync(targetPath).mode & 0o777, 0o755);
    assert.equal(result.changed, true);
    assert.equal(result.alreadyApplied, false);
    assert.equal(result.source, "verified-prebuild");
    assert.equal(result.targetPath, targetPath);
    assert.equal(
      fs.existsSync(path.join(fixture.nodeHidDir, "README.md")),
      false,
      "artifact package contents other than the selected native binary must not be copied",
    );
  });
}

test("Codex Micro uses the ChatGPT-owned node-hid archive override", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-micro-archive-"));
  const previous = process.env.CHATGPT_MICRO_NODE_HID_ARCHIVE;
  process.env.CHATGPT_MICRO_NODE_HID_ARCHIVE = tempDir;
  t.after(() => {
    if (previous == null) delete process.env.CHATGPT_MICRO_NODE_HID_ARCHIVE;
    else process.env.CHATGPT_MICRO_NODE_HID_ARCHIVE = previous;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await assert.rejects(
    defaultMaterializePackage({ name: "node-hid", version: "3.4.0" }),
    /CHATGPT_MICRO_NODE_HID_ARCHIVE is not a safe file/u,
  );
});

test("an already verified binding is idempotent and performs no package fetch", async (t) => {
  const binary = makeElf("x64", "already-staged");
  const artifact = fixtureArtifact({ x64: binary });
  const fixture = createBundledFixture(t);
  writeFile(
    path.join(fixture.nodeHidDir, bindingRelativePath("x64")),
    binary,
    0o755,
  );
  let materializeCalls = 0;

  const result = await stageCodexMicroNativeBinding({
    extractedDir: fixture.extractedDir,
    arch: "x64",
    artifactManifest: artifact,
    materializePackage: async () => {
      materializeCalls += 1;
      throw new Error("verified existing binding must avoid materialization");
    },
  });
  assert.equal(materializeCalls, 0);
  assert.equal(result.changed, false);
  assert.equal(result.alreadyApplied, true);
  assert.equal(result.source, "existing-prebuild");
});

test("an unexpected official-app binding fails closed before package materialization", async (t) => {
  const expectedBinary = makeElf("x64", "expected-binding");
  const unexpectedBinary = makeElf("x64", "unexpected-official-app-binding");
  const artifact = fixtureArtifact({ x64: expectedBinary });
  const fixture = createBundledFixture(t);
  const targetPath = path.join(fixture.nodeHidDir, bindingRelativePath("x64"));
  writeFile(targetPath, unexpectedBinary, 0o755);
  let materializeCalls = 0;

  await assert.rejects(
    stageCodexMicroNativeBinding({
      extractedDir: fixture.extractedDir,
      arch: "x64",
      artifactManifest: artifact,
      materializePackage: async () => {
        materializeCalls += 1;
        throw new Error("unexpected official-app bindings must fail before materialization");
      },
    }),
    /existing node-hid native binding hash mismatch/i,
  );
  assert.equal(materializeCalls, 0);
  assert.deepEqual(fs.readFileSync(targetPath), unexpectedBinary);
});

test("official app node-hid version or loader drift fails before package materialization", async (t) => {
  for (const options of [
    { bundledVersion: "3.3.0", expected: /version mismatch/i },
    { loader: "module.exports = 'drift';\n", expected: /loader contract hash mismatch/i },
  ]) {
    const fixture = createBundledFixture(t, options);
    let materializeCalls = 0;
    await assert.rejects(
      stageCodexMicroNativeBinding({
        extractedDir: fixture.extractedDir,
        arch: "x64",
        artifactManifest: fixtureArtifact(),
        materializePackage: async () => {
          materializeCalls += 1;
        },
      }),
      options.expected,
    );
    assert.equal(materializeCalls, 0);
  }
});

for (const scenario of [
  {
    label: "archive integrity",
    materialized: { integrity: "sha512-unverified" },
    expected: /integrity mismatch/i,
  },
  {
    label: "archive shasum",
    materialized: { shasum: "0".repeat(40) },
    expected: /shasum mismatch/i,
  },
  {
    label: "package identity",
    metadata: { name: "not-node-hid" },
    expected: /identity mismatch|artifact name mismatch/i,
  },
  {
    label: "package version",
    metadata: { version: "3.3.0" },
    expected: /version mismatch/i,
  },
]) {
  test(`rejects a materialized artifact with wrong ${scenario.label}`, async (t) => {
    const binary = makeElf("x64", scenario.label);
    const artifact = fixtureArtifact({ x64: binary });
    const fixture = createBundledFixture(t);
    const packageDir = createMaterializedPackage(t, {
      ...scenario.metadata,
      binaries: { x64: binary },
    });
    await assert.rejects(
      stageCodexMicroNativeBinding({
        extractedDir: fixture.extractedDir,
        arch: "x64",
        artifactManifest: artifact,
        materializePackage: materializer(packageDir, artifact, scenario.materialized),
      }),
      scenario.expected,
    );
    assert.equal(
      fs.existsSync(path.join(fixture.nodeHidDir, bindingRelativePath("x64"))),
      false,
    );
  });
}

test("rejects a hash-valid prebuild with the wrong ELF architecture", async (t) => {
  const arm64Binary = makeElf("arm64", "arm64-under-x64-path");
  const artifact = fixtureArtifact();
  artifact.prebuilds.x64.sha256 = sha256(arm64Binary);
  const fixture = createBundledFixture(t);
  const packageDir = createMaterializedPackage(t, {
    binaries: { x64: arm64Binary },
  });
  await assert.rejects(
    stageCodexMicroNativeBinding({
      extractedDir: fixture.extractedDir,
      arch: "x64",
      artifactManifest: artifact,
      materializePackage: materializer(packageDir, artifact),
    }),
    /ELF architecture arm64 does not match x64/i,
  );
});

test("unsupported architectures fail before discovery or materialization", async () => {
  let materializeCalls = 0;
  await assert.rejects(
    stageCodexMicroNativeBinding({
      extractedDir: "/does/not/matter",
      arch: "riscv64",
      artifactManifest: shippedArtifact(),
      materializePackage: async () => {
        materializeCalls += 1;
      },
    }),
    /unsupported.*architecture.*riscv64/i,
  );
  assert.equal(materializeCalls, 0);
  assert.throws(() => selectPrebuild(shippedArtifact(), "riscv64"), /unsupported/i);
});

test("inspectElf accepts only supported 64-bit little-endian machines", () => {
  assert.equal(inspectElf(makeElf("x64")).arch, "x64");
  assert.equal(inspectElf(makeElf("arm64")).arch, "arm64");
  assert.throws(() => inspectElf(Buffer.from("not ELF")), /ELF/i);
  const elf32 = makeElf("x64");
  elf32[4] = 1;
  assert.throws(() => inspectElf(elf32), /64-bit/i);
  const bigEndian = makeElf("x64");
  bigEndian[5] = 2;
  assert.throws(() => inspectElf(bigEndian), /little-endian/i);
});

test("udev policy imports USB properties before narrow USB and Bluetooth matches", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "resources", "70-codex-micro.rules"),
    "utf8",
  );
  const activeRules = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  assert.equal(activeRules.length, 2);
  const [usbRule, bluetoothRule] = activeRules;
  for (const rule of activeRules) {
    assert.match(rule, /SUBSYSTEM=="hidraw"/);
    assert.match(rule, /KERNEL=="hidraw\*"/);
    assert.match(rule, /TAG\+="uaccess"/);
    assert.match(rule, /MODE="0660"/);
  }
  assert.match(usbRule, /IMPORT\{builtin\}="usb_id"/);
  assert.ok(
    usbRule.indexOf('IMPORT{builtin}="usb_id"')
      < usbRule.indexOf('ENV{ID_VENDOR_ID}=="303a"'),
    "usb_id must be imported before its properties are matched",
  );
  assert.match(usbRule, /ENV\{ID_MODEL_ID\}=="8360"/);
  assert.match(usbRule, /ENV\{ID_USB_INTERFACE_NUM\}=="00"/);
  assert.match(bluetoothRule, /KERNELS=="0005:303A:8360\.\*"/);
  assert.doesNotMatch(source, /MODE="0666"/);
  assert.doesNotMatch(source, /SUBSYSTEM=="usb"/);
});

test("disabled Codex Micro performs no patch or package work", (t) => {
  const root = tempDirectory(t, "codex-micro-disabled-");
  const configPath = path.join(root, "integrations.json");
  writeJson(configPath, integrationSelection(path.resolve(__dirname, ".."), []));
  const options = {
    integrationsRoot: path.resolve(__dirname, ".."),
    integrationsConfigPath: configPath,
  };
  assert.deepEqual(loadPortIntegrationPatchDescriptors(options), []);
  for (const packageFormat of ["deb", "rpm", "pacman"]) {
    assert.deepEqual(
      enabledPortIntegrationPackageDependencies({ ...options, packageFormat }),
      [],
    );
    assert.deepEqual(enabledPortIntegrationPackageFiles({ ...options, packageFormat }), []);
  }
});

test("native formats stage the exact rule and integration-only dependencies", (t) => {
  const root = tempDirectory(t, "codex-micro-packages-");
  const configPath = path.join(root, "integrations.json");
  writeJson(configPath, integrationSelection(path.resolve(__dirname, ".."), ["codex-micro"]));
  const expectedDependencies = {
    deb: ["libudev1", "libusb-1.0-0"],
    rpm: [
      "libudev.so.1%{chatgpt_elf_suffix}",
      "libusb-1.0.so.0%{chatgpt_elf_suffix}",
    ],
    pacman: ["libusb", "systemd-libs"],
  };
  const expectedRule = fs.readFileSync(
    path.join(__dirname, "resources", "70-codex-micro.rules"),
  );

  for (const packageFormat of ["deb", "rpm", "pacman"]) {
    const packageRoot = path.join(root, packageFormat);
    const options = {
      integrationsRoot: path.resolve(__dirname, ".."),
      integrationsConfigPath: configPath,
      packageFormat,
    };
    const plan = stageEnabledPortIntegrationPackageResources(packageRoot, options);
    const target = path.join(
      packageRoot,
      "usr/lib/udev/rules.d/70-codex-micro.rules",
    );
    assert.deepEqual(plan.dependencies, expectedDependencies[packageFormat]);
    assert.deepEqual(
      enabledPortIntegrationPackageDependencies(options),
      expectedDependencies[packageFormat],
    );
    assert.deepEqual(
      enabledPortIntegrationPackageFiles(options),
      ["/usr/lib/udev/rules.d/70-codex-micro.rules"],
    );
    assert.deepEqual(fs.readFileSync(target), expectedRule);
    assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  }
});

test("the nested discovery path cannot be substituted with a hoisted node-hid", (t) => {
  const root = tempDirectory(t, "codex-micro-hoisted-");
  writeJson(path.join(root, "node_modules/node-hid/package.json"), {
    name: "node-hid",
    version: "3.4.0",
  });
  assert.throws(
    () => discoverBundledNodeHid(root),
    /device-kit-oai package is missing/i,
  );
});

test("discovery rejects symlinked ancestors before reading package metadata", (t) => {
  for (const scenario of [
    {
      label: "device-kit-oai",
      scopedModules: (fixture) => path.join(
        fixture.extractedDir,
        "node_modules",
        "@worklouder",
      ),
      packageName: "device-kit-oai",
    },
    {
      label: "wl-device-kit",
      scopedModules: (fixture) => path.join(
        fixture.extractedDir,
        DEVICE_KIT_RELATIVE,
        "node_modules",
        "@worklouder",
      ),
      packageName: "wl-device-kit",
    },
  ]) {
    const fixture = createBundledFixture(t);
    const scopedModules = scenario.scopedModules(fixture);
    const outside = path.join(
      path.dirname(fixture.extractedDir),
      `outside-${scenario.label}`,
    );
    fs.renameSync(scopedModules, outside);
    writeFile(path.join(outside, scenario.packageName, "package.json"), "{");
    fs.symlinkSync(outside, scopedModules, "dir");

    assert.throws(
      () => discoverBundledNodeHid(fixture.extractedDir),
      /path must not contain symlinks/i,
    );
  }
});

test("native binding staging rejects valid existing bindings behind symlinked parents", async (t) => {
  const binary = makeElf("x64", "symlinked-target-parent");
  const artifact = fixtureArtifact({ x64: binary });
  const fixture = createBundledFixture(t);
  const outside = path.join(path.dirname(fixture.extractedDir), "outside-prebuilds");
  fs.mkdirSync(outside);
  writeFile(
    path.join(outside, "HID_hidraw-linux-x64", "node-napi-v4.node"),
    binary,
    0o755,
  );
  const prebuildsDir = path.join(fixture.nodeHidDir, "prebuilds");
  fs.rmSync(prebuildsDir, { recursive: true });
  fs.symlinkSync(outside, prebuildsDir, "dir");

  let materializeCalls = 0;
  await assert.rejects(
    stageCodexMicroNativeBinding({
      extractedDir: fixture.extractedDir,
      arch: "x64",
      artifactManifest: artifact,
      materializePackage: async () => {
        materializeCalls += 1;
        throw new Error("symlinked existing binding must fail before materialization");
      },
    }),
    /path must not contain symlinks/i,
  );
  assert.equal(materializeCalls, 0);
});
