const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findExecutableJavaScriptSubstring,
  inferModuleAlias,
  requireName,
} = require("./minified-js.js");

test("findExecutableJavaScriptSubstring ignores comments, strings, and regex literals", () => {
  const needle = "function trustedHelper(";
  const decoys = [
    `/*${needle}*/`,
    `//${needle}\nlet other=1`,
    `let decoy="${needle}"`,
    `let decoy='${needle}'`,
    `let decoy=/${needle.replace(/[()]/g, "\\$&")}/`,
    `return /${needle.replace(/[()]/g, "\\$&")}/`,
    `if(true)/${needle.replace(/[()]/g, "\\$&")}/.test("")`,
    `while(false)/${needle.replace(/[()]/g, "\\$&")}/.test("")`,
    `if(false){}else /${needle.replace(/[()]/g, "\\$&")}/.test("")`,
    `async function f(){for await(const x of [1])/${needle.replace(/[()]/g, "\\$&")}/.test("")}`,
    `function f(){outer:while(true){break outer\n/${needle.replace(/[()]/g, "\\$&")}/.test("")}}`,
    `let x=1;x/ /${needle.replace(/[()]/g, "\\$&")}/.test("")`,
    `class C extends /${needle.replace(/[()]/g, "\\$&")}/.constructor{}`,
    `function f(){return [.../${needle.replace(/[()]/g, "\\$&")}/]}`,
    `function f(){return g(.../${needle.replace(/[()]/g, "\\$&")}/)}`,
    `function f(){return {.../${needle.replace(/[()]/g, "\\$&")}/}}`,
  ];
  for (const source of decoys) {
    assert.equal(findExecutableJavaScriptSubstring(source, needle), -1);
  }
  assert.equal(
    findExecutableJavaScriptSubstring(`${decoys.join(";")};${needle}){}` , needle),
    decoys.join(";").length + 1,
  );
});

test("requireName finds direct require assignment", () => {
  const source = `let a=1,b=require("electron"),c=3`;
  assert.strictEqual(requireName(source, "electron"), "b");
});

test("requireName finds require with double quotes", () => {
  const source = `const myModule=require("node:path")`;
  assert.strictEqual(requireName(source, "node:path"), "myModule");
});

test("requireName finds require with backticks", () => {
  const source = `const myModule=require(\`electron\`)`;
  assert.strictEqual(requireName(source, "electron"), "myModule");
});

test("requireName finds wrapped require with chatgptLinuxPatchExternalOpen", () => {
  const source = `let a=1,electronAlias=chatgptLinuxPatchExternalOpen(require(\`electron\`)),c=3`;
  assert.strictEqual(requireName(source, "electron"), "electronAlias");
});

test("requireName rejects an arbitrary require wrapper", () => {
  const source = `let a=1,electronAlias=myCustomWrapper(require(\`electron\`)),c=3`;
  assert.strictEqual(requireName(source, "electron"), null);
});

test("requireName limits the Linux external-open wrapper to electron", () => {
  const source = `const fsAlias=chatgptLinuxPatchExternalOpen(require("node:fs"))`;
  assert.strictEqual(requireName(source, "node:fs"), null);
});

test("requireName returns null when module not found", () => {
  const source = `const other=require("other-module")`;
  assert.strictEqual(requireName(source, "electron"), null);
});

test("inferModuleAlias delegates to requireName for direct require", () => {
  const source = `let electronAlias=require("electron")`;
  assert.strictEqual(inferModuleAlias(source, "electron"), "electronAlias");
});

test("inferModuleAlias delegates to requireName for the Linux external-open wrapper", () => {
  const source = `let electronAlias=chatgptLinuxPatchExternalOpen(require("electron"))`;
  assert.strictEqual(inferModuleAlias(source, "electron"), "electronAlias");
});

test("inferModuleAlias falls back to pattern matching for electron", () => {
  const source = `let electronAlias={app:{`;
  assert.strictEqual(inferModuleAlias(source, "electron"), "electronAlias");
});
