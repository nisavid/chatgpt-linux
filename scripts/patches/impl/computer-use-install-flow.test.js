"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const {
  applyLinuxComputerUseInstallFlowPatch,
  matchesLinuxComputerUseInstallFlowContract,
} = require("./computer-use.js");
const {
  currentComputerUseInstallFlowFixture,
} = require("./computer-use-test-fixtures.js");

function captureWarnings(fn) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

test("loads current Computer Use plugin details without platform availability", async () => {
  const source = currentComputerUseInstallFlowFixture();

  assert.equal(matchesLinuxComputerUseInstallFlowContract(source), true);
  const patched = applyLinuxComputerUseInstallFlowPatch(source);
  assert.match(patched, /let m=p&&i!==`computer-use`,h;/);
  assert.equal(applyLinuxComputerUseInstallFlowPatch(patched), patched);

  let readRequest = null;
  const query = vm.runInNewContext(
    `${patched};currentPluginDetail(${JSON.stringify({
      hostId: "local",
      marketplacePath: "/tmp/openai-bundled/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    })})`,
    {
      cache: (size) => new Array(size),
      client: () => ({
        sendRequest: async (method, params) => {
          readRequest = { method, params };
          return { plugin: { name: "computer-use" } };
        },
      }),
      getScope: () => ({}),
      hostReady: () => true,
      pluginBaseName: (name) => name,
      queryClient: () => ({}),
      useComputerUseAvailability: () => ({ available: false, isLoading: false }),
      useQuery: (options) => options,
    },
  );

  assert.equal(query.enabled, true);
  await query.queryFn();
  assert.deepEqual(JSON.parse(JSON.stringify(readRequest)), {
    method: "plugin/read",
    params: {
      marketplacePath: "/tmp/openai-bundled/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    },
  });
});

test("preserves unrelated plugin detail availability gates", () => {
  const source = currentComputerUseInstallFlowFixture().replace(
    "p=i!=null&&isComputerUsePlugin(i),",
    "p=i!=null&&isUnrelatedPlugin(i),",
  );

  assert.equal(matchesLinuxComputerUseInstallFlowContract(source), false);
  const { value, warnings } = captureWarnings(() =>
    applyLinuxComputerUseInstallFlowPatch(source),
  );
  assert.equal(value, source);
  assert.deepEqual(warnings, [
    "WARN: Could not find current Computer Use plugin detail availability gate — skipping Linux Computer Use install flow patch",
  ]);
});

test("ignores non-executable current install-flow anchors", () => {
  const gateDecoy =
    "p=i!=null&&isComputerUsePlugin(i),t[3]=i,t[4]=p);let m=p,h;";
  const driftedGate = currentComputerUseInstallFlowFixture().replace(
    "p=i!=null&&isComputerUsePlugin(i),t[3]=i,t[4]=p);let m=p,h;",
    "p=i!=null&&isAvailabilityGated(i),t[3]=i,t[4]=p);let m=p,h;",
  );
  const cases = [
    driftedGate.replace(
      "function currentPluginDetail(e){",
      `function currentPluginDetail(e){let decoy=${JSON.stringify(gateDecoy)};`,
    ),
    driftedGate.replace(
      "function currentPluginDetail(e){",
      `function currentPluginDetail(e){/*${gateDecoy}*/`,
    ),
    currentComputerUseInstallFlowFixture()
      .replace(
        "function isComputerUsePlugin(e){return pluginBaseName(e)===computerUsePluginName}",
        "function isOtherPlugin(e){return pluginBaseName(e)===computerUsePluginName}",
      )
      .replace(
        "function currentPluginDetail(e){",
        "function currentPluginDetail(e){/*function isComputerUsePlugin(e){return pluginBaseName(e)===computerUsePluginName}*/",
      ),
  ];

  for (const source of cases) {
    assert.equal(matchesLinuxComputerUseInstallFlowContract(source), false);
    const { value, warnings } = captureWarnings(() =>
      applyLinuxComputerUseInstallFlowPatch(source),
    );
    assert.equal(value, source);
    assert.deepEqual(warnings, [
      "WARN: Could not find current Computer Use plugin detail availability gate — skipping Linux Computer Use install flow patch",
    ]);
  }
});

test("accepts the executable install-flow contract alongside non-executable decoys", () => {
  const gateDecoy =
    "p=i!=null&&isComputerUsePlugin(i),t[3]=i,t[4]=p);let m=p,h;";
  const source = currentComputerUseInstallFlowFixture().replace(
    "function currentPluginDetail(e){",
    `function currentPluginDetail(e){let decoy=${JSON.stringify(gateDecoy)};/*${gateDecoy}*/`,
  );

  assert.equal(matchesLinuxComputerUseInstallFlowContract(source), true);
  const { value, warnings } = captureWarnings(() =>
    applyLinuxComputerUseInstallFlowPatch(source),
  );
  assert.notEqual(value, source);
  assert.match(value, /let m=p&&i!==`computer-use`,h;/u);
  assert.deepEqual(warnings, []);
});

test("rejects a patched gate bound to a different plugin name variable", () => {
  const source = currentComputerUseInstallFlowFixture().replace(
    "let m=p,h;",
    "let m=p&&a!==`computer-use`,h;",
  );

  assert.equal(matchesLinuxComputerUseInstallFlowContract(source), false);
  const { value, warnings } = captureWarnings(() =>
    applyLinuxComputerUseInstallFlowPatch(source),
  );
  assert.equal(value, source);
  assert.equal(warnings.length, 1);
});
