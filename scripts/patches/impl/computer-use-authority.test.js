"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  applyLinuxComputerUseAuthorityPatch,
  applyLinuxComputerUseAvatarCursorBridgePatch,
  applyLinuxComputerUseDisableOrderingPatch,
  applyLinuxComputerUseFeaturePatch,
  applyLinuxNativeDesktopAppsHandlerPatch,
  linuxComputerUseAuthorityRuntimeSource,
  linuxComputerUseCursorBridgeRuntimeSource,
  matchesLinuxComputerUseAuthorityContract,
  matchesLinuxComputerUseAvatarCursorContract,
  matchesLinuxComputerUseDisableOrderingContract,
} = require("./computer-use.js");

function createOfficialPluginFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-cua-plugin-"));
  const codexHome = path.join(root, ".codex");
  const cacheRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "computer-use",
  );
  const cachePlugin = path.join(cacheRoot, "1.0.0");
  const marketplaceRoot = path.join(
    codexHome,
    ".tmp",
    "bundled-marketplaces",
    "openai-bundled",
  );
  const marketplaceManifest = path.join(
    marketplaceRoot,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const marketplacePluginLink = path.join(
    marketplaceRoot,
    "plugins",
    "computer-use",
  );
  const unrelatedPlugin = path.join(root, "unrelated-computer-use");

  for (const directory of [
    cachePlugin,
    path.dirname(marketplaceManifest),
    path.dirname(marketplacePluginLink),
    unrelatedPlugin,
  ]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(marketplaceManifest, "{}\n", { mode: 0o600 });
  fs.symlinkSync("1.0.0", path.join(cacheRoot, "latest"));
  fs.symlinkSync(path.join(cacheRoot, "latest"), marketplacePluginLink);

  return {
    cachePlugin,
    cacheRoot,
    codexHome,
    marketplaceManifest,
    marketplacePluginLink,
    marketplaceRoot,
    root,
    unrelatedPlugin,
  };
}

const officialPluginFixture = createOfficialPluginFixture();
test.after(() => {
  fs.rmSync(officialPluginFixture.root, { recursive: true, force: true });
});

const allowedPluginList = ({
  fixture = officialPluginFixture,
  id = "computer-use@openai-bundled",
  sourcePath = fixture.cachePlugin,
} = {}) => ({
  marketplaces: [
    {
      name: "openai-bundled",
      path: fixture.marketplaceManifest,
      plugins: [
        {
          id,
          name: "computer-use",
          installed: true,
          enabled: true,
          source: { type: "local", path: sourcePath },
        },
      ],
    },
  ],
});

function authorityApi({
  codexHome = officialPluginFixture.codexHome,
  listPlugins,
  marketplaceRoot = officialPluginFixture.marketplaceRoot,
  platform = "linux",
  env = {},
}) {
  const app = new EventEmitter();
  const context = {
    Buffer,
    clearTimeout,
    process: {
      env: { CODEX_HOME: codexHome, ...env },
      getuid: process.getuid.bind(process),
      platform,
      resourcesPath: "/opt/chatgpt/resources",
    },
    require(name) {
      if (name === "electron") return { app };
      return require(name);
    },
    setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(
    `${linuxComputerUseAuthorityRuntimeSource()};globalThis.authority={authorize:chatgptLinuxComputerUseCheckAuthorization,configure:chatgptLinuxConfigureComputerUseAuthority,path:chatgptLinuxComputerUseAuthoritySocketPath,revoke:chatgptLinuxRevokeComputerUseAuthority,setOfficial:chatgptLinuxSetOfficialComputerUseEligibility}`,
    context,
  );
  context.authority.configure(
    () => ({ listPlugins }),
    () => ({ cwd: null }),
    () => marketplaceRoot,
  );
  return { api: context.authority, app };
}

test("authorizes only the exact fresh official local Computer Use plugin", async () => {
  const cases = [
    { official: false, response: allowedPluginList(), allowed: false },
    { official: true, response: allowedPluginList(), allowed: true },
    {
      official: true,
      response: { marketplaces: [{ ...allowedPluginList().marketplaces[0], plugins: [] }] },
      allowed: false,
    },
    {
      official: true,
      response: {
        marketplaces: [{
          ...allowedPluginList().marketplaces[0],
          plugins: [{ ...allowedPluginList().marketplaces[0].plugins[0], enabled: false }],
        }],
      },
      allowed: false,
    },
    {
      official: true,
      response: allowedPluginList({ id: "computer-use@third-party" }),
      allowed: false,
    },
    {
      official: true,
      response: allowedPluginList({
        sourcePath: officialPluginFixture.unrelatedPlugin,
      }),
      allowed: false,
    },
    {
      official: true,
      response: allowedPluginList({ sourcePath: "/tmp/missing-computer-use-plugin" }),
      allowed: false,
    },
    {
      official: true,
      response: {
        marketplaces: [{
          ...allowedPluginList().marketplaces[0],
          path: "/tmp/spoofed/openai-bundled/.agents/plugins/marketplace.json",
        }],
      },
      allowed: false,
    },
    {
      official: true,
      response: {
        marketplaces: [{
          ...allowedPluginList().marketplaces[0],
          plugins: [{
            ...allowedPluginList().marketplaces[0].plugins[0],
            source: { type: "local", path: "relative/spoofed/computer-use" },
          }],
        }],
      },
      allowed: false,
    },
    {
      official: true,
      response: {
        marketplaces: [{
          ...allowedPluginList().marketplaces[0],
          plugins: [{
            ...allowedPluginList().marketplaces[0].plugins[0],
            source: { type: "remote", path: "https://example.invalid/plugin" },
          }],
        }],
      },
      allowed: false,
    },
    {
      official: true,
      response: {
        marketplaces: [
          allowedPluginList().marketplaces[0],
          allowedPluginList().marketplaces[0],
        ],
      },
      allowed: false,
    },
    { official: true, response: { marketplaces: "loading" }, allowed: false },
    { official: true, response: null, allowed: false },
  ];

  for (const entry of cases) {
    let reads = 0;
    const { api } = authorityApi({
      listPlugins: async () => {
        reads += 1;
        return entry.response;
      },
    });
    api.setOfficial(entry.official);
    const result = await api.authorize();
    assert.equal(result.allowed, entry.allowed);
    assert.equal(reads, entry.official ? 1 : 0);
  }
});

test("accepts the official marketplace link and rejects an unsafe cache chain", async () => {
  const linked = authorityApi({
    listPlugins: async () => allowedPluginList({
      sourcePath: officialPluginFixture.marketplacePluginLink,
    }),
  });
  linked.api.setOfficial(true);
  assert.equal((await linked.api.authorize()).allowed, true);

  const fixture = createOfficialPluginFixture();
  try {
    fs.chmodSync(fixture.cacheRoot, 0o770);
    const unsafe = authorityApi({
      codexHome: fixture.codexHome,
      marketplaceRoot: fixture.marketplaceRoot,
      listPlugins: async () => allowedPluginList({ fixture }),
    });
    unsafe.api.setOfficial(true);
    assert.equal((await unsafe.api.authorize()).allowed, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects aliased Computer Use sources and altered marketplace link topology", async () => {
  const cases = [
    (fixture) => ({
      sourcePath: `${fixture.cachePlugin}/../1.0.0`,
    }),
    (fixture) => {
      const alias = path.join(fixture.root, "computer-use-alias");
      fs.symlinkSync(fixture.cachePlugin, alias);
      return { sourcePath: alias };
    },
    (fixture) => {
      fs.unlinkSync(fixture.marketplacePluginLink);
      fs.symlinkSync(fixture.cachePlugin, fixture.marketplacePluginLink);
      return { sourcePath: fixture.marketplacePluginLink };
    },
    (fixture) => {
      const intermediate = path.join(fixture.root, "marketplace-intermediate");
      fs.symlinkSync(path.join(fixture.cacheRoot, "latest"), intermediate);
      fs.unlinkSync(fixture.marketplacePluginLink);
      fs.symlinkSync(intermediate, fixture.marketplacePluginLink);
      return { sourcePath: fixture.marketplacePluginLink };
    },
    (fixture) => {
      const latest = path.join(fixture.cacheRoot, "latest");
      fs.unlinkSync(latest);
      fs.symlinkSync(fixture.cachePlugin, latest);
      return { sourcePath: fixture.cachePlugin };
    },
  ];

  for (const mutate of cases) {
    const fixture = createOfficialPluginFixture();
    try {
      const { sourcePath } = mutate(fixture);
      const { api } = authorityApi({
        codexHome: fixture.codexHome,
        marketplaceRoot: fixture.marketplaceRoot,
        listPlugins: async () => allowedPluginList({ fixture, sourcePath }),
      });
      api.setOfficial(true);
      assert.equal((await api.authorize()).allowed, false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("performs a fresh listPlugins read for every authorization", async () => {
  let reads = 0;
  const { api } = authorityApi({
    listPlugins: async () => {
      reads += 1;
      return allowedPluginList();
    },
  });
  api.setOfficial(true);

  assert.equal((await api.authorize()).allowed, true);
  assert.equal((await api.authorize()).allowed, true);
  assert.equal(reads, 2);
});

test("denies a stale async plugin result after revocation", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { api } = authorityApi({ listPlugins: () => pending });
  api.setOfficial(true);

  const authorization = api.authorize();
  api.setOfficial(false);
  release(allowedPluginList());

  assert.equal((await authorization).allowed, false);
});

test("denies listPlugins failures and timeouts", async () => {
  const throwing = authorityApi({ listPlugins: async () => { throw new Error("offline"); } });
  throwing.api.setOfficial(true);
  assert.equal((await throwing.api.authorize()).allowed, false);

  const hanging = authorityApi({ listPlugins: () => new Promise(() => {}) });
  hanging.api.setOfficial(true);
  const startedAt = Date.now();
  assert.equal((await hanging.api.authorize()).allowed, false);
  assert.ok(Date.now() - startedAt < 150, "authority timeout must fit inside the Rust 150ms lease check");
});

test("keeps unsupported platforms denied", async () => {
  const { api } = authorityApi({
    platform: "darwin",
    listPlugins: async () => allowedPluginList(),
  });
  api.setOfficial(true);
  assert.equal((await api.authorize()).allowed, false);
});

test("uses the Rust-compatible private multi-instance authority socket protocol", async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-cua-authority-"));
  fs.chmodSync(runtimeRoot, 0o700);
  const { api, app } = authorityApi({
    env: {
      XDG_RUNTIME_DIR: runtimeRoot,
      CHATGPT_LINUX_APP_ID: "chatgpt-test",
      CHATGPT_LINUX_INSTANCE_ID: "secondary",
    },
    listPlugins: async () => allowedPluginList(),
  });
  api.setOfficial(true);
  const socketPath = api.path();

  try {
    for (
      let attempt = 0;
      attempt < 50 &&
        (!fs.existsSync(socketPath) || (fs.statSync(socketPath).mode & 0o777) !== 0o600);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      socketPath,
      path.join(runtimeRoot, "chatgpt-test", "instances", "secondary", "computer-use-authority.sock"),
    );
    assert.equal(fs.statSync(path.dirname(socketPath)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);

    async function check(nonce) {
      return new Promise((resolve, reject) => {
        let response = "";
        const client = net.createConnection(socketPath, () => {
          client.end(`CHATGPT-CUA-AUTH/1 CHECK ${nonce}\n`);
        });
        client.setEncoding("utf8");
        client.on("data", (chunk) => { response += chunk; });
        client.on("end", () => resolve(response));
        client.on("error", reject);
      });
    }

    const firstNonce = "0123456789abcdef0123456789abcdef";
    assert.match(
      await check(firstNonce),
      new RegExp(`^CHATGPT-CUA-AUTH/1 ALLOW [1-9][0-9]* [0-9a-f]{64} ${firstNonce}\\n$`),
    );
    api.setOfficial(false);
    const secondNonce = "abcdef0123456789abcdef0123456789";
    assert.match(
      await check(secondNonce),
      new RegExp(`^CHATGPT-CUA-AUTH/1 DENY [1-9][0-9]* ${secondNonce}\\n$`),
    );
  } finally {
    app.emit("before-quit");
    for (let attempt = 0; attempt < 50 && fs.existsSync(socketPath); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("has no persisted grant, prompt, setting, or environment authorization state", () => {
  const runtime = linuxComputerUseAuthorityRuntimeSource();
  assert.doesNotMatch(runtime, /globalState|settingsStore|writeFile|config\/batchWrite|prompt|consent/i);
  assert.doesNotMatch(runtime, /CHATGPT_[A-Z0-9_]*(?:GRANT|CONSENT|ENABLE_COMPUTER_USE)/);
  assert.doesNotMatch(runtime, /setGrant|grantSetter|persist/i);
});

test("keeps authority and disable ordering drift required", () => {
  const mainDescriptors = require("../core/all-linux/main-process/computer-use/patch.js");
  const webviewDescriptors = require("../core/all-linux/webview/computer-use-ui/patch.js");
  const authority = mainDescriptors.find((descriptor) =>
    descriptor.id === "linux-computer-use-request-authority"
  );
  const disableOrdering = webviewDescriptors.find((descriptor) =>
    descriptor.id === "linux-computer-use-disable-before-write"
  );

  assert.equal(authority.ciPolicy, "required-official-dmg");
  assert.equal(disableOrdering.ciPolicy, "required-official-dmg");
  assert.throws(
    () => authority.apply("function unrelatedMainBundle(){}"),
    /Required Linux Computer Use authority patch failed/,
  );
  assert.throws(
    () => disableOrdering.apply("function unrelatedAppInitial(){}"),
    /Required Linux Computer Use disable ordering patch failed/,
  );
});

function mainAuthorityFixture() {
  return [
    "let calls=[];let s={f:{cwd:null}};",
    "function Sne(e){let t=e.env??process.env,i=e.resourcesPath??process.resourcesPath;let p=null,v=Promise.resolve();",
    "let c=e.runtimeMarketplaceRoot??`/home/test/.codex/.tmp/bundled-marketplaces/openai-bundled`,marker={runtimeMarketplaceRoot:c};",
    "let O=({force:e,reason:t})=>{if(p==null)return logger().info(`bundled_plugins_reconcile_skipped_features_unavailable`),v;return v};",
    "let M=async t=>{let n=e.getLocalAppServerConnection();await n.listPlugins(s.f)};",
    "return{setDesktopFeatureAvailability:(t,n)=>{p=t;calls.push(`reconcile`);return O({force:!1,reason:`startup`})}}}",
    "let l={ipcMain:{handle:(channel,handler)=>{globalThis.handle=handler}}},r={X:`desktop`};",
    "function Ube(e){let{setDesktopFeatureAvailability:v,getContextForWebContents:f,isTrustedIpcEvent:M}=e;",
    "l.ipcMain.handle(r.X,async(t,s)=>{if(!M(t))return;if(s.type===`electron-desktop-features-changed`){",
    "let e={computerUse:s.computerUse,computerUseNodeRepl:s.computerUseNodeRepl};",
    "v(e,s.bundledPluginEligibilityReasons),f(t.sender)?.setChronicleConfig(s.codexChronicleConfig);return}})}",
  ].join("");
}

test("patches the validated desktop-feature flow with revoke-before-reconcile ordering", () => {
  const patched = applyLinuxComputerUseAuthorityPatch(mainAuthorityFixture());
  assert.match(patched, /chatgptLinuxComputerUseAuthorityRuntime/);
  assert.match(patched, /chatgpt-linux-computer-use-disable-requested/);
  const eventIndex = patched.indexOf("electron-desktop-features-changed");
  const revokeIndex = patched.indexOf("chatgptLinuxSetOfficialComputerUseEligibility(!1)", eventIndex);
  const reconcileIndex = patched.indexOf("v(e,s.bundledPluginEligibilityReasons)", eventIndex);
  const enableIndex = patched.indexOf("chatgptLinuxSetOfficialComputerUseEligibility(!0)", eventIndex);
  assert.ok(eventIndex < revokeIndex && revokeIndex < reconcileIndex && reconcileIndex < enableIndex);
  assert.equal(applyLinuxComputerUseAuthorityPatch(patched), patched);
});

test("support matching rejects partially stale authority and cursor patches", () => {
  const authority = applyLinuxComputerUseAuthorityPatch(mainAuthorityFixture());
  assert.equal(matchesLinuxComputerUseAuthorityContract(authority), true);
  const commentedAuthorityRuntime = authority.replace(
    linuxComputerUseAuthorityRuntimeSource(),
    `/*${linuxComputerUseAuthorityRuntimeSource()}*/`,
  );
  assert.notEqual(commentedAuthorityRuntime, authority);
  assert.equal(matchesLinuxComputerUseAuthorityContract(commentedAuthorityRuntime), false);
  assert.throws(
    () => applyLinuxComputerUseAuthorityPatch(commentedAuthorityRuntime),
    /only partially present/,
  );
  const quotedAuthorityRuntime = authority.replace(
    linuxComputerUseAuthorityRuntimeSource(),
    `let authorityDecoy='${linuxComputerUseAuthorityRuntimeSource()}';`,
  );
  assert.equal(matchesLinuxComputerUseAuthorityContract(quotedAuthorityRuntime), false);
  assert.throws(
    () => applyLinuxComputerUseAuthorityPatch(quotedAuthorityRuntime),
    /only partially present/,
  );
  const staleAuthority = authority.replace(
    "async function chatgptLinuxComputerUseCheckAuthorization",
    "async function staleComputerUseCheckAuthorization",
  );
  assert.equal(matchesLinuxComputerUseAuthorityContract(staleAuthority), false);
  assert.throws(
    () => applyLinuxComputerUseAuthorityPatch(staleAuthority),
    /only partially present/,
  );
  const weakenedAuthority = authority.replace(
    "if(!e.supportTrusted||!e.officialEligible)",
    "if(!e.supportTrusted)",
  );
  assert.notEqual(weakenedAuthority, authority);
  assert.equal(matchesLinuxComputerUseAuthorityContract(weakenedAuthority), false);
  assert.throws(
    () => applyLinuxComputerUseAuthorityPatch(weakenedAuthority),
    /only partially present/,
  );
  for (const commentedAuthority of [
    authority.replace(
      "if(s.type===`chatgpt-linux-computer-use-disable-requested`){chatgptLinuxSetOfficialComputerUseEligibility(!1);return}",
      "/*if(s.type===`chatgpt-linux-computer-use-disable-requested`){chatgptLinuxSetOfficialComputerUseEligibility(!1);return}*/",
    ),
    authority.replace(
      "process.platform===`linux`&&chatgptLinuxConfigureComputerUseAuthority(()=>e.getLocalAppServerConnection(),()=>s.f,()=>c);",
      "/*process.platform===`linux`&&chatgptLinuxConfigureComputerUseAuthority(()=>e.getLocalAppServerConnection(),()=>s.f,()=>c);*/",
    ),
    authority.replace(
      "process.platform===`linux`&&s.computerUse!==!0&&chatgptLinuxSetOfficialComputerUseEligibility(!1);",
      "/*process.platform===`linux`&&s.computerUse!==!0&&chatgptLinuxSetOfficialComputerUseEligibility(!1);*/",
    ),
    authority.replace(
      "process.platform===`linux`&&s.computerUse===!0&&chatgptLinuxSetOfficialComputerUseEligibility(!0),",
      "/*process.platform===`linux`&&s.computerUse===!0&&chatgptLinuxSetOfficialComputerUseEligibility(!0),*/",
    ),
  ]) {
    assert.notEqual(commentedAuthority, authority);
    assert.equal(matchesLinuxComputerUseAuthorityContract(commentedAuthority), false);
    assert.throws(
      () => applyLinuxComputerUseAuthorityPatch(commentedAuthority),
      /only partially present/,
    );
  }

  const cursorSource = [
    "let c=require(`electron`);",
    "function eo(e,{platform:r=process.platform}={}){if(r!==`darwin`)return!1;return c.app.setRemoteHostedPIPContentComputerUseCursorLocationHandler(e)}",
  ].join("");
  const cursor = applyLinuxComputerUseAvatarCursorBridgePatch(cursorSource);
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(cursor), true);
  const externalOpenCursor =
    "function chatgptLinuxPatchExternalOpen(){}" +
    cursor.replace(
      "a=require(`electron`)",
      "a=chatgptLinuxPatchExternalOpen(require(`electron`))",
    );
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(externalOpenCursor), true);
  assert.equal(
    applyLinuxComputerUseAvatarCursorBridgePatch(externalOpenCursor),
    externalOpenCursor,
  );
  const commentedExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    "/*function chatgptLinuxPatchExternalOpen(){}*/",
  );
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(commentedExternalOpenHelper), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(commentedExternalOpenHelper),
    /only partially present/,
  );
  const stringOnlyExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    'let decoy="function chatgptLinuxPatchExternalOpen(";',
  );
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(stringOnlyExternalOpenHelper), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(stringOnlyExternalOpenHelper),
    /only partially present/,
  );
  const regexOnlyExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    "let decoy=/function chatgptLinuxPatchExternalOpen\\(\\)/;",
  );
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(regexOnlyExternalOpenHelper), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(regexOnlyExternalOpenHelper),
    /only partially present/,
  );
  const controlFlowRegexExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    'if(true)/function chatgptLinuxPatchExternalOpen()/.test("");',
  );
  assert.equal(
    matchesLinuxComputerUseAvatarCursorContract(controlFlowRegexExternalOpenHelper),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(controlFlowRegexExternalOpenHelper),
    /only partially present/,
  );
  const asyncLoopRegexExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    'async function f(){for await(const x of [1])/function chatgptLinuxPatchExternalOpen()/.test("")}',
  );
  assert.equal(
    matchesLinuxComputerUseAvatarCursorContract(asyncLoopRegexExternalOpenHelper),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(asyncLoopRegexExternalOpenHelper),
    /only partially present/,
  );
  const labeledBreakRegexExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    'function f(){outer:while(true){break outer\n/function chatgptLinuxPatchExternalOpen()/.test("")}}',
  );
  assert.equal(
    matchesLinuxComputerUseAvatarCursorContract(labeledBreakRegexExternalOpenHelper),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(labeledBreakRegexExternalOpenHelper),
    /only partially present/,
  );
  const divisionRegexExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    'let x=1;x/ /function chatgptLinuxPatchExternalOpen()/.test("")',
  );
  assert.equal(
    matchesLinuxComputerUseAvatarCursorContract(divisionRegexExternalOpenHelper),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(divisionRegexExternalOpenHelper),
    /only partially present/,
  );
  const extendsRegexExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    "class C extends /function chatgptLinuxPatchExternalOpen()/.constructor{}",
  );
  assert.equal(
    matchesLinuxComputerUseAvatarCursorContract(extendsRegexExternalOpenHelper),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(extendsRegexExternalOpenHelper),
    /only partially present/,
  );
  const spreadRegexExternalOpenHelper = externalOpenCursor.replace(
    "function chatgptLinuxPatchExternalOpen(){}",
    "function f(){return [.../function chatgptLinuxPatchExternalOpen()/]}",
  );
  assert.equal(
    matchesLinuxComputerUseAvatarCursorContract(spreadRegexExternalOpenHelper),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(spreadRegexExternalOpenHelper),
    /only partially present/,
  );
  const cursorRuntime = linuxComputerUseCursorBridgeRuntimeSource();
  const commentedCursorRuntime = cursor.replace(cursorRuntime, `/*${cursorRuntime}*/`);
  assert.notEqual(commentedCursorRuntime, cursor);
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(commentedCursorRuntime), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(commentedCursorRuntime),
    /only partially present/,
  );
  const quotedCursorRuntime = cursor.replace(
    cursorRuntime,
    `let cursorDecoy='${cursorRuntime}';`,
  );
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(quotedCursorRuntime), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(quotedCursorRuntime),
    /only partially present/,
  );
  const staleCursor = cursor.replace(
    "function chatgptLinuxStartComputerUseCursorBridge",
    "function staleComputerUseCursorBridge",
  );
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(staleCursor), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(staleCursor),
    /only partially present/,
  );
  const weakenedCursor = cursor.replace(
    "chatgptLinuxRegisterComputerUseRevocation(chatgptLinuxStopComputerUseCursorBridge)",
    "/*chatgptLinuxRegisterComputerUseRevocation(chatgptLinuxStopComputerUseCursorBridge)*/",
  );
  assert.notEqual(weakenedCursor, cursor);
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(weakenedCursor), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(weakenedCursor),
    /only partially present/,
  );
  const disconnectedCursor = cursor.replace(
    "if(r===`linux`)return chatgptLinuxRegisterComputerUseCursorHandler(e);",
    "/*if(r===`linux`)return chatgptLinuxRegisterComputerUseCursorHandler(e);*/",
  );
  assert.notEqual(disconnectedCursor, cursor);
  assert.equal(matchesLinuxComputerUseAvatarCursorContract(disconnectedCursor), false);
  assert.throws(
    () => applyLinuxComputerUseAvatarCursorBridgePatch(disconnectedCursor),
    /only partially present/,
  );
});

test("revokes the official Computer Use plugin before its persisted config write", async () => {
  const source = [
    "let order=[];let dp={dispatchMessage:async e=>{order.push(e)}};",
    "async function feature(){return dp.dispatchMessage(`electron-desktop-features-changed`,{})}",
    "async function Tir(){return null}async function rp(){order.push(`persist`)}async function Lma(){}function oLn(e){return[e]}",
    "function Tma(e){let n=e?.hostId??`local`,i={},o={},r={},s=async e=>{let{pluginId:t,enabled:a}=e,c=await Tir(i,n),l=await rp(`batch-write-config-value`,{hostId:n,edits:oLn({pluginId:t,enabled:a}),filePath:c?.filePath??null,expectedVersion:c?.expectedVersion??null,reloadUserConfig:!0});return await Lma(),l};return s}",
  ].join("");
  const patched = applyLinuxComputerUseDisableOrderingPatch(source);
  const api = vm.runInNewContext(`${patched};({mutate:Tma({}),order})`);

  await api.mutate({ pluginId: "computer-use@openai-bundled", enabled: false });
  assert.deepEqual(Array.from(api.order), [
    "chatgpt-linux-computer-use-disable-requested",
    "persist",
  ]);
  api.order.length = 0;
  await api.mutate({ pluginId: "computer-use@openai-bundled", enabled: true });
  assert.deepEqual(Array.from(api.order), ["persist"]);
});

test("patches the current nested Computer Use plugin edit contract", () => {
  const source = [
    "let dp={dispatchMessage:async()=>{}};",
    "async function feature(){return dp.dispatchMessage(`electron-desktop-features-changed`,{})}",
    "async function W6n(){}async function dm(){}async function Qea(){}function oLn(e){return[e]}",
    "function Bea(e){let n=e?.hostId??`local`,i={},s=async e=>{let{pluginId:t,enabled:a}=e,c=await W6n(i,n),l=await dm(`batch-write-config-value`,{hostId:n,edits:oLn({pluginId:t,enabled:a}),filePath:c?.filePath??null,expectedVersion:c?.expectedVersion??null,reloadUserConfig:!0});return await Qea(),l};return s}",
  ].join("");

  const patched = applyLinuxComputerUseDisableOrderingPatch(source);

  assert.equal(matchesLinuxComputerUseDisableOrderingContract(patched), true);
  assert.match(
    patched,
    /chatgpt-linux-computer-use-disable-before-write/,
  );
});

test("disable-before-write rejects marker-only state and ignores marker decoys", () => {
  const mutationSource = [
    "let dp={dispatchMessage:async()=>{}};",
    "async function feature(){return dp.dispatchMessage(`electron-desktop-features-changed`,{})}",
    "async function Tir(){}async function rp(){}async function Lma(){}function oLn(e){return[e]}",
    "function Tma(e){let n=e?.hostId??`local`,i={},s=async e=>{let{pluginId:t,enabled:a}=e,c=await Tir(i,n),l=await rp(`batch-write-config-value`,{hostId:n,edits:oLn({pluginId:t,enabled:a}),filePath:c?.filePath??null,expectedVersion:c?.expectedVersion??null,reloadUserConfig:!0});return await Lma(),l};return s}",
  ].join("");
  const markerOnly =
    "/*chatgpt-linux-computer-use-disable-before-write*/" + mutationSource;
  const quotedOnly =
    "let decoy='chatgpt-linux-computer-use-disable-before-write';" + mutationSource;

  assert.equal(
    matchesLinuxComputerUseDisableOrderingContract(
      "/*chatgpt-linux-computer-use-disable-before-write*/function unrelated(){}",
    ),
    false,
  );
  assert.equal(
    matchesLinuxComputerUseDisableOrderingContract(
      "let decoy='chatgpt-linux-computer-use-disable-before-write';function unrelated(){}",
    ),
    false,
  );

  assert.equal(matchesLinuxComputerUseDisableOrderingContract(markerOnly), true);
  const markerPatched = applyLinuxComputerUseDisableOrderingPatch(markerOnly);
  assert.notEqual(markerPatched, markerOnly);
  assert.match(markerPatched, /chatgpt-linux-computer-use-disable-requested/);
  assert.equal(applyLinuxComputerUseDisableOrderingPatch(markerPatched), markerPatched);

  assert.equal(matchesLinuxComputerUseDisableOrderingContract(quotedOnly), true);
  const quotedPatched = applyLinuxComputerUseDisableOrderingPatch(quotedOnly);
  assert.notEqual(quotedPatched, quotedOnly);
  assert.match(quotedPatched, /chatgpt-linux-computer-use-disable-requested/);
  assert.equal(applyLinuxComputerUseDisableOrderingPatch(quotedPatched), quotedPatched);

  const brokenPatched = markerPatched.replace(
    /if\(t===`computer-use@openai-bundled`[\s\S]*?;\/\*chatgpt-linux-computer-use-disable-before-write\*\//,
    "/*chatgpt-linux-computer-use-disable-before-write*/",
  );
  assert.equal(matchesLinuxComputerUseDisableOrderingContract(brokenPatched), false);
  assert.throws(
    () => applyLinuxComputerUseDisableOrderingPatch(brokenPatched),
    /unavailable or ambiguous/,
  );

  const dispatchCommentDecoy = mutationSource.replace(
    "async function feature(){return dp.dispatchMessage(`electron-desktop-features-changed`,{})}",
    "/*async function feature(){return dp.dispatchMessage(`electron-desktop-features-changed`,{})}*/",
  );
  assert.equal(
    matchesLinuxComputerUseDisableOrderingContract(dispatchCommentDecoy),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseDisableOrderingPatch(dispatchCommentDecoy),
    /unavailable or ambiguous/,
  );

  const persistenceCommentDecoy = mutationSource.replace(
    "l=await rp(`batch-write-config-value`,{hostId:n,edits:oLn({pluginId:t,enabled:a}),filePath:c?.filePath??null,expectedVersion:c?.expectedVersion??null,reloadUserConfig:!0})",
    "l=await rp(`unrelated`,{});/*`batch-write-config-value`,{reloadUserConfig:!0}*/l",
  );
  assert.equal(
    matchesLinuxComputerUseDisableOrderingContract(persistenceCommentDecoy),
    false,
  );
  assert.throws(
    () => applyLinuxComputerUseDisableOrderingPatch(persistenceCommentDecoy),
    /unavailable or ambiguous/,
  );
});

test("gates native desktop and icon handlers before backend or file access", async () => {
  const source = [
    "\"use strict\";",
    "let accesses=[];async function chatgptLinuxComputerUseAuthorizeRequest(){accesses.push(`authorize`);return!1}",
    "let cp=require(`node:child_process`),fs=require(`node:fs`),p=require(`node:path`),os=require(`node:os`);",
    "var h={handlers:{\"computer-use-native-desktop-app-icon\":async()=>{accesses.push(`icon`);return{iconSmall:`mac`}},\"native-desktop-apps\":async()=>{accesses.push(`backend`);return{apps:[{bundleId:`mac`}]}}}};",
  ].join("");
  const patched = applyLinuxNativeDesktopAppsHandlerPatch(source);
  const result = await vm.runInNewContext(
    `(async()=>{${patched};let apps=await h.handlers[\"native-desktop-apps\"]({params:{}}),icon=await h.handlers[\"computer-use-native-desktop-app-icon\"]({params:{appPath:\"/tmp/missing\"}});return{apps,icon,accesses}})()`,
    { Buffer, console, process: { env: {}, platform: "linux", resourcesPath: "/tmp" }, require },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result.apps)), { apps: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(result.icon)), { iconSmall: "" });
  assert.deepEqual(Array.from(result.accesses), ["authorize", "authorize"]);
});

test("removes legacy Linux feature forcing and preserves false official values", () => {
  const forced = "function Ve(e,{env:t=process.env,platform:n=process.platform}={}){return n===`linux`?{...e,computerUse:!0,computerUseNodeRepl:!0}:n!==`win32`||t.CHATGPT_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE!==`1`?e:{...e,computerUse:!0,computerUseNodeRepl:!0}}";
  const patched = applyLinuxComputerUseFeaturePatch(forced);
  assert.doesNotMatch(patched, /===`linux`\?\{\.\.\.e,computerUse:!0/);
  const evaluate = vm.runInNewContext(`${patched};Ve`);
  assert.deepEqual(
    JSON.parse(JSON.stringify(evaluate(
      { computerUse: false, computerUseNodeRepl: false },
      { env: {}, platform: "linux" },
    ))),
    { computerUse: false, computerUseNodeRepl: false },
  );
  assert.equal(applyLinuxComputerUseFeaturePatch(patched), patched);
});
