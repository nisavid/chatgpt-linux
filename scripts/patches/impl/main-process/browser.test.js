#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const {
  applyLinuxBundledPluginCopyPermissionsPatch,
  applyLinuxBrowserUseSocketDirectoryPatch,
  applyLinuxExternalOpenEnvPatch,
} = require("./browser.js");

function bundledPluginCopyFixture() {
  return (
    "let p=require(`node:path`);" +
    "let m=require(`node:fs/promises`);m={default:m};" +
    "let h=require(`node:crypto`);" +
    "let g={default:{platform:process.platform}};" +
    "let cc=[`.agents`,`plugins`,`marketplace.json`];" +
    "async function fl(e,t){if(g.default.platform===`darwin`){return}if(g.default.platform!==`win32`){await m.default.cp(e,t,{recursive:!0,verbatimSymlinks:!0});return}}" +
    "async function Ac(e){let a=`${e.targetMarketplaceRoot}.staging-${h.randomUUID()}`;await m.default.mkdir((0,p.join)(a,...cc.slice(0,-1)),{recursive:!0});await m.default.writeFile((0,p.join)(a,...cc),`{}\\n`,`utf8`);let n=e.sourcePlugin,t=(0,p.join)(a,`plugins`,`chrome`);await m.default.mkdir((0,p.dirname)(t),{recursive:!0}),await fl(n,t);return a}"
  );
}

test("bundled plugin trust patch rejects executable helper-only partial state", () => {
  const helperOnly = [
    "async function chatgptLinuxValidateBundledPluginAncestors(){}",
    "async function chatgptLinuxValidateBundledPluginSource(){}",
    "async function chatgptLinuxPrepareBundledPluginStage(){}",
    "async function chatgptLinuxMakeBundledPluginTreeWritable(){}",
    bundledPluginCopyFixture(),
  ].join("");

  assert.throws(
    () => applyLinuxBundledPluginCopyPermissionsPatch(helperOnly),
    /partially present/,
  );

  const patched = applyLinuxBundledPluginCopyPermissionsPatch(
    bundledPluginCopyFixture(),
  );
  const brokenCallsite = patched.replace(
    "await chatgptLinuxPrepareBundledPluginStage(a,m.default),",
    "",
  );
  assert.notEqual(brokenCallsite, patched);
  assert.throws(
    () => applyLinuxBundledPluginCopyPermissionsPatch(brokenCallsite),
    /partially present/,
  );
});

test("bundled plugin trust patch ignores quoted and commented helper decoys", () => {
  const source = [
    "let quoted='async function chatgptLinuxValidateBundledPluginAncestors(';",
    "/*async function chatgptLinuxValidateBundledPluginSource(){}*/",
    bundledPluginCopyFixture(),
  ].join("");

  const patched = applyLinuxBundledPluginCopyPermissionsPatch(source);

  assert.notEqual(patched, source);
  assert.match(
    patched,
    /await chatgptLinuxValidateBundledPluginSource\(e,m\.default\)/,
  );
  assert.match(
    patched,
    /await chatgptLinuxPrepareBundledPluginStage\(a,m\.default\)/,
  );
  assert.equal(applyLinuxBundledPluginCopyPermissionsPatch(patched), patched);
});

const browserUseSocketFixture =
  '"use strict";' +
  'var zt=e=>e===`win32`?`\\\\\\\\.\\\\pipe\\\\codex-browser-use`:`/tmp/codex-browser-use`;' +
  'var Sd=class{server;pipePath;async start(){await new Promise((e,t)=>{this.server.once(`error`,t),this.server.listen(this.pipePath,()=>{this.server.off(`error`,t),e()})})}};' +
  'globalThis.socketDirectory=zt(`linux`);';

function evaluateBrowserUseSocketPatch({ env = {}, metadataUid = 1000 } = {}) {
  const operations = [];
  const fs = {
    mkdirSync: (target, options) => operations.push(["mkdir", target, options]),
    lstatSync: (target) => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      uid: metadataUid,
      target,
    }),
    chmodSync: (target, mode) => operations.push(["chmod", target, mode]),
  };
  const context = {
    globalThis: {},
    process: { env, getuid: () => 1000, platform: "linux" },
    require: (specifier) => {
      assert.equal(specifier, "node:fs");
      return fs;
    },
  };
  vm.runInNewContext(
    applyLinuxBrowserUseSocketDirectoryPatch(browserUseSocketFixture),
    context,
  );
  return { context, operations };
}

test("Linux IAB producer uses the same deterministic per-user socket directory as Browser clients", () => {
  const { context, operations } = evaluateBrowserUseSocketPatch();

  assert.equal(context.globalThis.socketDirectory, "/tmp/codex-browser-use-1000");
  assert.equal(operations[0][0], "mkdir");
  assert.equal(operations[0][1], "/tmp/codex-browser-use-1000");
  assert.equal(operations[0][2].recursive, true);
  assert.equal(operations[0][2].mode, 0o700);
  assert.deepEqual(operations[1], ["chmod", "/tmp/codex-browser-use-1000", 0o700]);
});

test("Linux IAB producer honors the explicit shared socket directory override", () => {
  const { context } = evaluateBrowserUseSocketPatch({
    env: { CODEX_BROWSER_USE_SOCKET_DIR: "/custom/browser-use" },
  });

  assert.equal(context.globalThis.socketDirectory, "/custom/browser-use");
});

test("Linux IAB producer rejects a socket directory owned by another user", () => {
  assert.throws(
    () => evaluateBrowserUseSocketPatch({ metadataUid: 2000 }),
    /not owned by the current user/,
  );
});

test("Linux IAB socket alignment patch hardens the directory and socket modes", () => {
  const patched = applyLinuxBrowserUseSocketDirectoryPatch(browserUseSocketFixture);

  assert.match(patched, /mkdirSync\(t,\{recursive:!0,mode:448\}\)/);
  assert.match(patched, /chmodSync\(t,448\)/);
  assert.match(patched, /chmodSync\(this\.pipePath,384\)/);
  assert.match(patched, /this\.server\.close\(\(\)=>\{\}\)/);
  assert.match(patched, /t\(e\);return/);
  assert.match(patched, /chatgptLinuxBrowserUseSocketMode/);
  assert.equal(applyLinuxBrowserUseSocketDirectoryPatch(patched), patched);
});

test("Linux external open env patch wraps electron require with helper", () => {
  const source = '"use strict";let e=require("electron");';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(patched, /chatgptLinuxPatchExternalOpen\(require\(("|`)electron\1\)\)/);
  assert.match(patched, /function chatgptLinuxPatchExternalOpen\(/);
});

test("Linux external open env patch injects env var guard in helper", () => {
  const source = '"use strict";let e=require("electron");';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /CHATGPT_LINUX_DISABLE_EXTERNAL_OPEN_PATCH/,
    "helper should check CHATGPT_LINUX_DISABLE_EXTERNAL_OPEN_PATCH env var",
  );
});

test("Linux external open env patch is idempotent", () => {
  const source = '"use strict";let e=require("electron");';
  const first = applyLinuxExternalOpenEnvPatch(source);
  const second = applyLinuxExternalOpenEnvPatch(first);

  assert.equal(second, first, "second application should not change the source");
});

test("Linux external open env patch ignores a quoted helper decoy", () => {
  const source =
    '"use strict";let decoy="function chatgptLinuxPatchExternalOpen(";' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores a regex helper decoy", () => {
  const source =
    '"use strict";let decoy=/function chatgptLinuxPatchExternalOpen\\(\\)/;' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores a control-flow regex helper decoy", () => {
  const source =
    '"use strict";if(true)/function chatgptLinuxPatchExternalOpen()/.test("");' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores an async-loop regex helper decoy", () => {
  const source =
    '"use strict";async function f(){for await(const x of [1])/function chatgptLinuxPatchExternalOpen()/.test("")}' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores a labeled-break regex helper decoy", () => {
  const source =
    '"use strict";function f(){outer:while(true){break outer\n/function chatgptLinuxPatchExternalOpen()/.test("")}}' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores a division-adjacent regex helper decoy", () => {
  const source =
    '"use strict";let x=1;x/ /function chatgptLinuxPatchExternalOpen()/.test("");' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores an extends-expression regex helper decoy", () => {
  const source =
    '"use strict";class C extends /function chatgptLinuxPatchExternalOpen()/.constructor{}' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch ignores a spread-expression regex helper decoy", () => {
  const source =
    '"use strict";function f(){return [.../function chatgptLinuxPatchExternalOpen()/]}' +
    'let e=chatgptLinuxPatchExternalOpen(require("electron"));';
  const patched = applyLinuxExternalOpenEnvPatch(source);

  assert.match(
    patched,
    /function chatgptLinuxPatchExternalOpen\(__chatgptElectron\)\{/,
  );
  assert.equal(applyLinuxExternalOpenEnvPatch(patched), patched);
});

test("Linux external open env patch warns when no electron require found", () => {
  const source = '"use strict";const fs=require("node:fs");';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    const patched = applyLinuxExternalOpenEnvPatch(source);
    assert.equal(patched, source, "source should be unchanged");
    assert.ok(warnings.length > 0, "should have warned about missing require");
    assert.match(warnings[0], /Could not find Electron require initializer/);
  } finally {
    console.warn = originalWarn;
  }
});
