"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isGeneratedAppIntegrityError,
} = require("./generated-app-mutation-client.js");

const {
  findIconAssetWithCapability,
  findMainBundleWithCapability,
  patchAssetFilesWithCapability,
  patchUniqueAssetFileWithCapability,
  readMatchingWebviewAssetSourcesWithCapability,
  replaceMainBundleWithCapability,
} = require("./assets.js");

const REGULAR_MODE = 0o100644;
const SYMLINK_MODE = 0o120777;
const SPECIAL_MODE = 0o020600;

function metadata(mode = REGULAR_MODE) {
  return Object.freeze({ mode });
}

function entry(name, mode = REGULAR_MODE) {
  return Object.freeze({
    name: Buffer.isBuffer(name) ? Buffer.from(name) : Buffer.from(name, "utf8"),
    metadata: metadata(mode),
  });
}

function componentKey(components) {
  assert.ok(Array.isArray(components));
  assert.ok(components.every(Buffer.isBuffer), "capability paths must stay as Buffer components");
  return components.map((component) => component.toString("hex")).join("/");
}

function fileKey(components) {
  return componentKey(components);
}

class FakeMutationCapability {
  constructor({ directories = [], files = [] } = {}) {
    this.directories = new Map(
      directories.map(({ components, entries }) => [componentKey(components), entries]),
    );
    this.files = new Map(
      files.map(({ components, source, operationId, mode = REGULAR_MODE }) => [
        fileKey(components),
        {
          content: Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(source, "utf8"),
          metadata: metadata(mode),
          operationId: Buffer.from(operationId),
        },
      ]),
    );
    this.calls = [];
  }

  async list(components) {
    const key = componentKey(components);
    this.calls.push({ operation: "list", components: components.map(Buffer.from) });
    return this.directories.get(key) ?? [];
  }

  async read(components) {
    const key = fileKey(components);
    this.calls.push({ operation: "read", components: components.map(Buffer.from) });
    const file = this.files.get(key);
    assert.ok(file, `unexpected read ${key}`);
    return Object.freeze({
      content: Buffer.from(file.content),
      metadata: file.metadata,
      operationId: Buffer.from(file.operationId),
    });
  }

  async replace(components, operationId, replacement) {
    const key = fileKey(components);
    const file = this.files.get(key);
    assert.ok(file, `unexpected replace ${key}`);
    assert.deepEqual(operationId, file.operationId, "replace must use the read identity token");
    this.calls.push({
      operation: "replace",
      components: components.map(Buffer.from),
      operationId: Buffer.from(operationId),
      replacement: Buffer.from(replacement),
    });
    file.content = Buffer.from(replacement);
    return Object.freeze({ operationId: Buffer.from(operationId) });
  }
}

const MAIN_BUILD = [Buffer.from(".vite"), Buffer.from("build")];
const WEBVIEW_ASSETS = [Buffer.from("webview"), Buffer.from("assets")];

function child(components, name) {
  return [...components.map(Buffer.from), Buffer.from(name, "utf8")];
}

async function captureWarnings(action) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    return { value: await action(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

test("capability discovery returns sorted regular ASCII assets and replaces changed main bytes by token", async () => {
  const mainToken = Buffer.alloc(16, 0x41);
  const capability = new FakeMutationCapability({
    directories: [
      {
        components: MAIN_BUILD,
        entries: [
          entry("main-z.js"),
          entry(Buffer.from("main-\xc3\xa9.js", "binary")),
          entry("main-link.js", SYMLINK_MODE),
          entry("main-a.js"),
        ],
      },
      {
        components: WEBVIEW_ASSETS,
        entries: [
          entry("app-z.png"),
          entry("app-link.png", SYMLINK_MODE),
          entry("app-device.png", SPECIAL_MODE),
          entry(Buffer.from("app-\xc3\xa9.png", "binary")),
          entry("app-a.png"),
        ],
      },
    ],
    files: [
      {
        components: child(MAIN_BUILD, "main-a.js"),
        source: "main-source",
        operationId: mainToken,
      },
    ],
  });

  const main = await findMainBundleWithCapability(capability);
  const icon = await findIconAssetWithCapability(capability);

  assert.equal(main.mainBundle, "main-a.js");
  assert.equal(main.source, "main-source");
  assert.deepEqual(main.operationId, mainToken);
  assert.equal(icon, "app-a.png");

  assert.equal(await replaceMainBundleWithCapability(capability, main, "main-source"), false);
  assert.equal(await replaceMainBundleWithCapability(capability, main, "patched-main"), true);
  assert.deepEqual(
    capability.calls.map(({ operation, components }) => [
      operation,
      components.map((component) => component.toString("utf8")).join("/"),
    ]),
    [
      ["list", ".vite/build"],
      ["read", ".vite/build/main-a.js"],
      ["list", "webview/assets"],
      ["replace", ".vite/build/main-a.js"],
    ],
  );
  assert.deepEqual(
    capability.calls.at(-1).replacement,
    Buffer.from("patched-main", "utf8"),
  );
});

test("matching capability reads return every sorted regular ASCII UTF-8 webview source", async () => {
  const tokenA = Buffer.alloc(16, 0x0a);
  const tokenB = Buffer.alloc(16, 0x0b);
  const capability = new FakeMutationCapability({
    directories: [{
      components: WEBVIEW_ASSETS,
      entries: [
        entry("index-b.js"),
        entry("index-link.js", SYMLINK_MODE),
        entry(Buffer.from("index-\xff.js", "binary")),
        entry("index-device.js", SPECIAL_MODE),
        entry("notes.txt"),
        entry("index-a.js"),
      ],
    }],
    files: [
      {
        components: child(WEBVIEW_ASSETS, "index-a.js"),
        source: "source-a",
        operationId: tokenA,
      },
      {
        components: child(WEBVIEW_ASSETS, "index-b.js"),
        source: "source-b",
        operationId: tokenB,
      },
    ],
  });

  const sources = await readMatchingWebviewAssetSourcesWithCapability(
    capability,
    /^index-.*\.js$/g,
  );

  assert.deepEqual(
    sources.map(({ assetName, source, operationId }) => ({ assetName, source, operationId })),
    [
      { assetName: "index-a.js", source: "source-a", operationId: tokenA },
      { assetName: "index-b.js", source: "source-b", operationId: tokenB },
    ],
  );
  assert.deepEqual(
    capability.calls.map(({ operation, components }) => [
      operation,
      components.map((component) => component.toString("utf8")).join("/"),
    ]),
    [
      ["list", "webview/assets"],
      ["read", "webview/assets/index-a.js"],
      ["read", "webview/assets/index-b.js"],
    ],
  );
});

test("capability patch-all reads every sorted candidate before changed-only token replacements", async () => {
  const tokenA = Buffer.alloc(16, 0x1a);
  const tokenB = Buffer.alloc(16, 0x1b);
  const capability = new FakeMutationCapability({
    directories: [{
      components: WEBVIEW_ASSETS,
      entries: [entry("index-b.js"), entry("index-a.js")],
    }],
    files: [
      {
        components: child(WEBVIEW_ASSETS, "index-a.js"),
        source: "unchanged",
        operationId: tokenA,
      },
      {
        components: child(WEBVIEW_ASSETS, "index-b.js"),
        source: "change-me",
        operationId: tokenB,
      },
    ],
  });

  const result = await patchAssetFilesWithCapability(
    capability,
    /^index-.*\.js$/g,
    (source) => source === "unchanged" ? source : source.toUpperCase(),
    "missing index bundle",
  );

  assert.deepEqual(result, { matched: 2, changed: 1 });
  assert.deepEqual(
    capability.calls.map(({ operation, components }) => [
      operation,
      components.map((component) => component.toString("utf8")).join("/"),
    ]),
    [
      ["list", "webview/assets"],
      ["read", "webview/assets/index-a.js"],
      ["read", "webview/assets/index-b.js"],
      ["replace", "webview/assets/index-b.js"],
    ],
  );
  assert.deepEqual(capability.calls.at(-1).operationId, tokenB);
  assert.deepEqual(capability.calls.at(-1).replacement, Buffer.from("CHANGE-ME", "utf8"));
});

test("invalid capability metadata, tokens, content, and UTF-8 stay typed integrity failures", async () => {
  const validRead = {
    content: Buffer.from("source", "utf8"),
    metadata: metadata(),
    operationId: Buffer.alloc(16, 0x31),
  };
  const cases = [
    {
      name: "list metadata",
      entries: [{ name: Buffer.from("main.js"), metadata: { mode: "regular" } }],
      read: validRead,
    },
    {
      name: "read metadata",
      entries: [entry("main.js")],
      read: { ...validRead, metadata: { mode: "regular" } },
    },
    {
      name: "read token",
      entries: [entry("main.js")],
      read: { ...validRead, operationId: Buffer.alloc(15) },
    },
    {
      name: "read content",
      entries: [entry("main.js")],
      read: { ...validRead, content: 42 },
    },
    {
      name: "read UTF-8",
      entries: [entry("main.js")],
      read: { ...validRead, content: Buffer.from([0xff]) },
    },
  ];

  for (const fixture of cases) {
    const capability = {
      async list(components) {
        componentKey(components);
        return fixture.entries;
      },
      async read(components) {
        componentKey(components);
        return fixture.read;
      },
    };
    await assert.rejects(
      findMainBundleWithCapability(capability),
      (error) => {
        assert.equal(isGeneratedAppIntegrityError(error), true, fixture.name);
        return true;
      },
    );
  }
});

test("capability patch-all performs no replacements when any transform fails", async () => {
  const capability = new FakeMutationCapability({
    directories: [{
      components: WEBVIEW_ASSETS,
      entries: [entry("index-a.js"), entry("index-b.js")],
    }],
    files: [
      {
        components: child(WEBVIEW_ASSETS, "index-a.js"),
        source: "first",
        operationId: Buffer.alloc(16, 0x2a),
      },
      {
        components: child(WEBVIEW_ASSETS, "index-b.js"),
        source: "second",
        operationId: Buffer.alloc(16, 0x2b),
      },
    ],
  });
  const transformed = [];

  await assert.rejects(
    patchAssetFilesWithCapability(
      capability,
      /^index-.*\.js$/,
      async (source) => {
        transformed.push(source);
        if (source === "second") throw new Error("transform failed");
        return source.toUpperCase();
      },
      "missing index bundle",
    ),
    (error) => {
      assert.equal(error.message, "transform failed");
      assert.equal(isGeneratedAppIntegrityError(error), false);
      return true;
    },
  );

  assert.deepEqual(transformed, ["first", "second"]);
  assert.deepEqual(
    capability.calls.map(({ operation }) => operation),
    ["list", "read", "read"],
  );
});

test("capability patch-unique reports sorted ambiguity only after reading every candidate", async () => {
  const capability = new FakeMutationCapability({
    directories: [{
      components: WEBVIEW_ASSETS,
      entries: [
        entry("settings-c.js"),
        entry("settings-b.js"),
        entry("settings-a.js"),
      ],
    }],
    files: [
      {
        components: child(WEBVIEW_ASSETS, "settings-a.js"),
        source: "current-contract-a",
        operationId: Buffer.alloc(16, 0x3a),
      },
      {
        components: child(WEBVIEW_ASSETS, "settings-b.js"),
        source: "current-contract-b",
        operationId: Buffer.alloc(16, 0x3b),
      },
      {
        components: child(WEBVIEW_ASSETS, "settings-c.js"),
        source: "wrapper",
        operationId: Buffer.alloc(16, 0x3c),
      },
    ],
  });
  let patchCalls = 0;

  const { value, warnings } = await captureWarnings(() =>
    patchUniqueAssetFileWithCapability(
      capability,
      /^settings-.*\.js$/,
      (source) => source.startsWith("current-contract"),
      (source) => {
        patchCalls += 1;
        return source.toUpperCase();
      },
      "missing settings bundle",
      "ambiguous settings bundle",
    )
  );

  assert.deepEqual(value, { matched: 2, changed: 0, assetName: null });
  assert.deepEqual(warnings, [
    "ambiguous settings bundle: settings-a.js, settings-b.js",
  ]);
  assert.equal(patchCalls, 0);
  assert.deepEqual(
    capability.calls.map(({ operation, components }) => [
      operation,
      components.map((component) => component.toString("utf8")).join("/"),
    ]),
    [
      ["list", "webview/assets"],
      ["read", "webview/assets/settings-a.js"],
      ["read", "webview/assets/settings-b.js"],
      ["read", "webview/assets/settings-c.js"],
    ],
  );
});

test("capability patch-unique preserves current missing, changed, and unchanged results", async () => {
  const capability = new FakeMutationCapability({
    directories: [{
      components: WEBVIEW_ASSETS,
      entries: [entry("settings-wrapper.js"), entry("settings-target.js")],
    }],
    files: [
      {
        components: child(WEBVIEW_ASSETS, "settings-target.js"),
        source: "current-contract",
        operationId: Buffer.alloc(16, 0x4a),
      },
      {
        components: child(WEBVIEW_ASSETS, "settings-wrapper.js"),
        source: "wrapper",
        operationId: Buffer.alloc(16, 0x4b),
      },
    ],
  });
  const patch = () => patchUniqueAssetFileWithCapability(
    capability,
    /^settings-.*\.js$/,
    (source) => source === "current-contract" || source === "patched-contract",
    (source) => source.replace("current-contract", "patched-contract"),
    "missing settings bundle",
    "ambiguous settings bundle",
  );

  assert.deepEqual(await patch(), {
    matched: 1,
    changed: 1,
    assetName: "settings-target.js",
  });
  assert.deepEqual(await patch(), {
    matched: 1,
    changed: 0,
    assetName: "settings-target.js",
  });
  assert.equal(
    capability.calls.filter(({ operation }) => operation === "replace").length,
    1,
  );

  const missing = await captureWarnings(() => patchUniqueAssetFileWithCapability(
    capability,
    /^settings-.*\.js$/,
    (source) => source === "unknown-contract",
    (source) => source,
    "missing settings bundle",
    "ambiguous settings bundle",
  ));
  assert.deepEqual(missing.value, { matched: 0, changed: 0, assetName: null });
  assert.deepEqual(missing.warnings, ["missing settings bundle"]);
});
