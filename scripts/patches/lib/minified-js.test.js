const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findExecutableJavaScriptSubstring,
  inferModuleAlias,
  requireName,
  serializeJavaScriptValue,
} = require("./minified-js.js");

test("serializeJavaScriptValue escapes script-breaking characters", () => {
  const serialized = serializeJavaScriptValue("</script>\u2028next\u2029");
  assert.equal(serialized, '"\\u003c/script\\u003e\\u2028next\\u2029"');
  assert.equal(JSON.parse(serialized), "</script>\u2028next\u2029");
});

test("findExecutableJavaScriptSubstring ignores comments, strings, and regex literals", () => {
  const needle = "function trustedHelper(";
  const regexNeedle = String.raw`function trustedHelper\(`;
  const decoys = [
    `/*${needle}*/`,
    `//${needle}\nlet other=1`,
    `let decoy="${needle}"`,
    `let decoy='${needle}'`,
    `let decoy=/${regexNeedle}/`,
    `return /${regexNeedle}/`,
    `if(true)/${regexNeedle}/.test("")`,
    `while(false)/${regexNeedle}/.test("")`,
    `if(false){}else /${regexNeedle}/.test("")`,
    `async function f(){for await(const x of [1])/${regexNeedle}/.test("")}`,
    `function f(){outer:while(true){break outer\n/${regexNeedle}/.test("")}}`,
    `let x=1;x/ /${regexNeedle}/.test("")`,
    `class C extends /${regexNeedle}/.constructor{}`,
    `function f(){return [.../${regexNeedle}/]}`,
    `function f(){return g(.../${regexNeedle}/)}`,
    `function f(){return {.../${regexNeedle}/}}`,
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
