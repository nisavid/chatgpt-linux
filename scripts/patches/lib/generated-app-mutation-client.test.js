"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GeneratedAppIntegrityError,
  isGeneratedAppIntegrityError,
  openGeneratedAppMutationRoot,
} = require("./generated-app-mutation-client.js");

function makePrivateRoot(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-mutation-client-"));
  const root = path.join(parent, "root");
  fs.mkdirSync(root, { mode: 0o700 });
  t.after(() => fs.rmSync(parent, { force: true, recursive: true }));
  return { parent, root };
}

function writeBroker(parent, source) {
  const brokerPath = path.join(parent, "fake-broker");
  fs.writeFileSync(brokerPath, `#!/usr/bin/node\n${source}`, { mode: 0o700 });
  return brokerPath;
}

const brokerPrelude = String.raw`
"use strict";
const fs = require("node:fs");
if (process.argv.length !== 2) process.exit(90);
const root = fs.fstatSync(3);
if (!root.isDirectory() || (root.mode & 0o077) !== 0) process.exit(91);
function readExact(length) {
  const value = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(0, value, offset, length - offset, null);
    if (count === 0) return offset === 0 ? null : process.exit(92);
    offset += count;
  }
  return value;
}
function readFrame() {
  const header = readExact(4);
  if (header == null) return null;
  return readExact(header.readUInt32BE(0));
}
function frame(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}
function writeFrame(payload, split = false) {
  const output = frame(payload);
  if (!split) return fs.writeSync(1, output);
  for (const byte of output) fs.writeSync(1, Buffer.from([byte]));
}
function metadata() {
  const value = Buffer.alloc(52);
  value.writeBigUInt64BE(11n, 0);
  value.writeBigUInt64BE(12n, 8);
  value.writeUInt32BE(0o100600, 16);
  value.writeUInt32BE(process.getuid(), 20);
  value.writeUInt32BE(process.getgid(), 24);
  value.writeBigUInt64BE(3n, 28);
  value.writeBigInt64BE(13n, 36);
  value.writeBigUInt64BE(14n, 44);
  return value;
}
`;

function responseFrame(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

async function waitForPath(filePath, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${path.basename(filePath)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("client uses an inherited private-root fd and preserves protocol bytes", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const token = Buffer.alloc(16, 2);
for (;;) {
  const request = readFrame();
  if (request == null) process.exit(0);
  const operation = request[1];
  if (operation === 1) {
    const count = Buffer.alloc(4); count.writeUInt32BE(1);
    const name = Buffer.from([0xff, 0x61]);
    const nameLength = Buffer.alloc(2); nameLength.writeUInt16BE(name.length);
    writeFrame(Buffer.concat([Buffer.from([1, 0, 1, 0]), count, nameLength, name, metadata()]), true);
  } else if (operation === 2) {
    const content = Buffer.from([0xff, 0, 0x61]);
    const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
    writeFrame(Buffer.concat([Buffer.from([1, 0, 2, 0]), token, metadata(), Buffer.alloc(32, 3), length, content]), true);
  } else if (operation === 3) {
    if (!request.subarray(request.length - 3).equals(Buffer.from([7, 8, 9]))) process.exit(93);
    writeFrame(Buffer.concat([Buffer.from([1, 0, 3, 0]), token]), true);
  } else process.exit(94);
}
`,
  );

  const client = await openGeneratedAppMutationRoot(root, {
    brokerPath,
    verifiedPrivateRoot: true,
  });
  t.after(() => client.close());

  const listed = await client.list([Buffer.from("assets")]);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].name, Buffer.from([0xff, 0x61]));
  assert.equal(listed[0].metadata.ino, 12n);

  const read = await client.read([Buffer.from("assets"), Buffer.from([0xff, 0x61])]);
  assert.deepEqual(read.operationId, Buffer.alloc(16, 2));
  assert.deepEqual(read.digest, Buffer.alloc(32, 3));
  assert.deepEqual(read.content, Buffer.from([0xff, 0, 0x61]));

  const replaced = await client.replace(
    [Buffer.from("assets"), Buffer.from([0xff, 0x61])],
    read.operationId,
    Buffer.from([7, 8, 9]),
  );
  assert.deepEqual(replaced.operationId, read.operationId);
  await client.close();
});

test("client digest remains bound to the broker descriptor after path replacement", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const readyPath = path.join(parent, "broker-ready");
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
fs.writeFileSync(${JSON.stringify(readyPath)}, "yes");
if (readFrame() == null) process.exit(0);
`,
  );
  const executedDigest = crypto.createHash("sha256").update(fs.readFileSync(brokerPath)).digest("hex");
  const replacementPath = path.join(parent, "replacement-broker");
  fs.writeFileSync(
    replacementPath,
    `#!/usr/bin/node\n${brokerPrelude}\nprocess.exit(73);\n`,
    { mode: 0o700 },
  );

  const client = await openGeneratedAppMutationRoot(root, { brokerPath });
  await waitForPath(readyPath);
  fs.renameSync(replacementPath, brokerPath);

  assert.equal(client.brokerDigest, executedDigest);
  assert.notEqual(
    client.brokerDigest,
    crypto.createHash("sha256").update(fs.readFileSync(brokerPath)).digest("hex"),
  );
  assert.equal(Object.isFrozen(client), true);
  await client.close();
});

test("clean close rejects an in-place broker executable change", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const readyPath = path.join(parent, "broker-ready");
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
fs.writeFileSync(${JSON.stringify(readyPath)}, "yes");
if (readFrame() == null) process.exit(0);
`,
  );

  const client = await openGeneratedAppMutationRoot(root, { brokerPath });
  await waitForPath(readyPath);
  fs.appendFileSync(brokerPath, "\n// changed during the broker session\n");

  await assert.rejects(
    client.close(),
    (error) => isGeneratedAppIntegrityError(error)
      && error.code === "unsafe-broker"
      && error.operation === "close",
  );
});

test("broker starts with a neutral cwd and no inherited environment", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const secretName = "CHATGPT_MUTATION_BROKER_TEST_SECRET";
  const loaderName = "LD_PRELOAD";
  const previousSecret = process.env[secretName];
  const previousLoader = process.env[loaderName];
  process.env[secretName] = path.join(parent, "private-candidate");
  process.env[loaderName] = path.join(parent, "private-loader.so");
  t.after(() => {
    if (previousSecret === undefined) delete process.env[secretName];
    else process.env[secretName] = previousSecret;
    if (previousLoader === undefined) delete process.env[loaderName];
    else process.env[loaderName] = previousLoader;
  });
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
if (process.cwd() !== "/") process.exit(95);
if (Object.keys(process.env).length !== 0) process.exit(96);
const request = readFrame();
const count = Buffer.alloc(4);
writeFrame(Buffer.concat([Buffer.from([1, 0, request[1], 0]), count]));
if (readFrame() == null) process.exit(0);
`,
  );

  const client = await openGeneratedAppMutationRoot(root, { brokerPath });
  assert.deepEqual(await client.list([]), []);
  await client.close();
});

test("client rejects roots that are not private before spawning", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  fs.chmodSync(root, 0o755);
  const marker = path.join(parent, "spawned");
  const brokerPath = writeBroker(parent, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "yes");`);

  await assert.rejects(
    openGeneratedAppMutationRoot(root, { brokerPath }),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "unsafe-root",
  );
  assert.equal(fs.existsSync(marker), false);
});

test("broker error frames are typed and poison the client", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const request = readFrame();
const message = Buffer.from("identity changed", "ascii");
const detail = Buffer.alloc(4); detail.writeUInt16BE(4, 0); detail.writeUInt16BE(message.length, 2);
writeFrame(Buffer.concat([Buffer.from([1, 1, request[1], 0]), detail, message]));
process.exit(23);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  await assert.rejects(client.read([Buffer.from("main.js")]), (error) => {
    assert.equal(error instanceof GeneratedAppIntegrityError, true);
    assert.equal(error.operation, "read");
    assert.equal(error.code, "integrity");
    return true;
  });
  await assert.rejects(client.list([]), (error) => isGeneratedAppIntegrityError(error));
  await client.close();
});

test("malformed responses fail closed and poison the client", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const request = readFrame();
writeFrame(Buffer.from([2, 0, request[1], 0]));
setTimeout(() => process.exit(0), 1000);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  await assert.rejects(
    client.list([]),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
  await assert.rejects(client.list([]), (error) => isGeneratedAppIntegrityError(error));
  await client.close();
});

test("bounded response decoder rejects adversarial frames and poisons the client", async (t) => {
  const protocolHeader = (operation) => Buffer.from([1, 0, operation, 0]);
  const u32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value);
    return buffer;
  };
  const oversizedFrameHeader = Buffer.alloc(4);
  oversizedFrameHeader.writeUInt32BE(16 * 1024 * 1024 + 64 * 1024 + 1);
  const cases = [
    { name: "zero-length frame", operation: "list", raw: Buffer.alloc(4) },
    { name: "oversized frame", operation: "list", raw: oversizedFrameHeader },
    {
      name: "truncated list metadata",
      operation: "list",
      raw: responseFrame(
        Buffer.concat([protocolHeader(1), u32(1), Buffer.from([0, 1, 0x61, 0])]),
      ),
    },
    {
      name: "oversized list count",
      operation: "list",
      raw: responseFrame(Buffer.concat([protocolHeader(1), u32(8193)])),
    },
    {
      name: "oversized read content",
      operation: "read",
      raw: responseFrame(
        Buffer.concat([
          protocolHeader(2),
          Buffer.alloc(16),
          Buffer.alloc(52),
          Buffer.alloc(32),
          u32(16 * 1024 * 1024 + 1),
        ]),
      ),
    },
    {
      name: "wrong replace operation id",
      operation: "replace",
      raw: responseFrame(Buffer.concat([protocolHeader(3), Buffer.alloc(16, 3)])),
    },
  ];

  for (const malformed of cases) {
    await t.test(malformed.name, async (subtest) => {
      const { parent, root } = makePrivateRoot(subtest);
      const brokerPath = writeBroker(
        parent,
        `${brokerPrelude}
readFrame();
fs.writeSync(1, Buffer.from(${JSON.stringify(malformed.raw.toString("base64"))}, "base64"));
setInterval(() => {}, 1000);
`,
      );
      const client = await openGeneratedAppMutationRoot(root, { brokerPath });
      const action =
        malformed.operation === "read"
          ? client.read([Buffer.from("main.js")])
          : malformed.operation === "replace"
            ? client.replace([Buffer.from("main.js")], Buffer.alloc(16, 2), Buffer.alloc(0))
            : client.list([]);

      await assert.rejects(action, (error) => isGeneratedAppIntegrityError(error));
      await assert.rejects(client.list([]), (error) => isGeneratedAppIntegrityError(error));
      await client.close();
    });
  }
});

test("unexpected broker EOF rejects the active operation", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
readFrame();
process.exit(17);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  await assert.rejects(
    client.list([]),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
  await client.close();
});

test("broker stdin errors reject the active operation without escaping", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const closedStdinPath = path.join(parent, "broker-closed-stdin-before-request");
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
fs.closeSync(0);
fs.writeFileSync(${JSON.stringify(closedStdinPath)}, "yes");
setInterval(() => {}, 1000);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });
  await waitForPath(closedStdinPath);

  await assert.rejects(
    client.list([]),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
  await client.close();
});

test("unsolicited extra responses poison the client", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const request = readFrame();
const count = Buffer.alloc(4);
const response = Buffer.concat([Buffer.from([1, 0, request[1], 0]), count]);
fs.writeSync(1, Buffer.concat([frame(response), frame(response)]));
setTimeout(() => process.exit(0), 1000);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  await assert.rejects(
    client.list([]),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
  await client.close();
});

test("clean shutdown rejects an unexpected nonzero broker exit", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
if (readFrame() == null) process.exit(19);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  await assert.rejects(
    client.close(),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "broker-exit",
  );
});

test("poisoned clients kill brokers that ignore graceful termination", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
process.on("SIGTERM", () => {});
const request = readFrame();
const message = Buffer.from("denied", "ascii");
const detail = Buffer.alloc(4); detail.writeUInt16BE(4, 0); detail.writeUInt16BE(message.length, 2);
writeFrame(Buffer.concat([Buffer.from([1, 1, request[1], 0]), detail, message]));
setInterval(() => {}, 1000);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  await assert.rejects(client.list([]), (error) => isGeneratedAppIntegrityError(error));
  const startedAt = Date.now();
  await client.close();
  assert.ok(Date.now() - startedAt < 2000);
});

test("clean close rejects a delayed unsolicited response", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const request = readFrame();
const count = Buffer.alloc(4);
const response = Buffer.concat([Buffer.from([1, 0, request[1], 0]), count]);
writeFrame(response);
setTimeout(() => writeFrame(response), 50);
setTimeout(() => process.exit(0), 100);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  assert.deepEqual(await client.list([]), []);
  await assert.rejects(
    client.close(),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
});

test("clean close waits for stdout and rejects a late descendant response", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerExiting = path.join(parent, "broker-exiting");
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const { spawn } = require("node:child_process");
const request = readFrame();
const count = Buffer.alloc(4);
const response = Buffer.concat([Buffer.from([1, 0, request[1], 0]), count]);
writeFrame(response);
const lateFrame = frame(response).toString("base64");
spawn(
  process.execPath,
  ["-e", "setTimeout(() => process.stdout.write(Buffer.from(process.argv[1], 'base64')), 250)", lateFrame],
  { stdio: ["ignore", 1, "ignore"] },
).unref();
fs.writeFileSync(${JSON.stringify(brokerExiting)}, "yes");
process.exit(0);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  assert.deepEqual(await client.list([]), []);
  await waitForPath(brokerExiting);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(
    client.close(),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
});

test("clean close fails within the termination bound when a descendant holds stdout", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerExiting = path.join(parent, "broker-exiting-held-stdout");
  const releaseDescendant = path.join(parent, "release-descendant");
  const descendantDone = path.join(parent, "descendant-done");
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const { spawn } = require("node:child_process");
const request = readFrame();
const count = Buffer.alloc(4);
writeFrame(Buffer.concat([Buffer.from([1, 0, request[1], 0]), count]));
spawn(
  process.execPath,
  [
    "-e",
    "const fs=require('node:fs');const release=process.argv[1],done=process.argv[2];const timer=setInterval(()=>{if(fs.existsSync(release)){clearInterval(timer);fs.writeFileSync(done,'yes')}},10)",
    ${JSON.stringify(releaseDescendant)},
    ${JSON.stringify(descendantDone)},
  ],
  { stdio: ["ignore", 1, "ignore"] },
).unref();
fs.writeFileSync(${JSON.stringify(brokerExiting)}, "yes");
process.exit(0);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  assert.deepEqual(await client.list([]), []);
  await waitForPath(brokerExiting);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const startedAt = Date.now();
  try {
    await assert.rejects(
      client.close(),
      (error) => isGeneratedAppIntegrityError(error) && error.code === "broker-exit",
    );
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    fs.writeFileSync(releaseDescendant, "yes");
    await waitForPath(descendantDone);
  }
});

test("clean close rejects a partial trailing frame", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const request = readFrame();
const count = Buffer.alloc(4);
writeFrame(Buffer.concat([Buffer.from([1, 0, request[1], 0]), count]));
readFrame();
fs.writeSync(1, Buffer.from([0, 0]));
process.exit(0);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });

  assert.deepEqual(await client.list([]), []);
  await assert.rejects(
    client.close(),
    (error) => isGeneratedAppIntegrityError(error) && error.code === "protocol",
  );
});

test("filesystem and spawn failures do not expose local paths in enumerable errors", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const missingBroker = path.join(parent, "private-broker-secret");
  await assert.rejects(openGeneratedAppMutationRoot(root, { brokerPath: missingBroker }), (error) => {
    const projection = JSON.stringify(error);
    assert.equal(projection.includes(missingBroker), false);
    assert.equal(error.message.includes(missingBroker), false);
    assert.equal(error.reason.includes(missingBroker), false);
    assert.equal(error.cause instanceof Error, true);
    return true;
  });

  const brokerPath = writeBroker(parent, `${brokerPrelude}process.exit(0);`);
  const missingRoot = path.join(parent, "private-root-secret");
  await assert.rejects(
    openGeneratedAppMutationRoot(missingRoot, { brokerPath }),
    (error) => {
      const projection = JSON.stringify(error);
      assert.equal(projection.includes(missingRoot), false);
      assert.equal(error.message.includes(missingRoot), false);
      assert.equal(error.reason.includes(missingRoot), false);
      assert.equal(error.cause instanceof Error, true);
      return true;
    },
  );
});

test("private fallback assertion accepts only a literal boolean", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const marker = path.join(parent, "spawned");
  const brokerPath = writeBroker(
    parent,
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "yes");`,
  );

  for (const invalid of ["false", 1, {}, null]) {
    await assert.rejects(
      openGeneratedAppMutationRoot(root, { brokerPath, verifiedPrivateRoot: invalid }),
      (error) => isGeneratedAppIntegrityError(error) && error.code === "invalid-fallback-assertion",
    );
    assert.equal(fs.existsSync(marker), false);
  }
});

test("path bound matches the broker's slash-joined 4096-byte contract", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const request = readFrame();
if (request[1] !== 2) process.exit(95);
const token = Buffer.alloc(16, 2);
const length = Buffer.alloc(4);
writeFrame(Buffer.concat([Buffer.from([1, 0, 2, 0]), token, metadata(), Buffer.alloc(32), length]));
if (readFrame() == null) process.exit(0);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });
  const components = [
    ...Array.from({ length: 127 }, () => Buffer.alloc(31, 0x61)),
    Buffer.alloc(32, 0x62),
  ];

  assert.equal(
    components.reduce((total, component) => total + component.length, components.length - 1),
    4096,
  );
  await client.read(components);
  await client.close();
});

test("queued operations snapshot caller-owned buffers at admission", async (t) => {
  const { parent, root } = makePrivateRoot(t);
  const brokerPath = writeBroker(
    parent,
    `${brokerPrelude}
const first = readFrame();
if (first[1] !== 1) process.exit(95);
setTimeout(() => {
  const count = Buffer.alloc(4);
  writeFrame(Buffer.concat([Buffer.from([1, 0, 1, 0]), count]));
}, 50);
setTimeout(() => {
  const readRequest = readFrame();
  if (readRequest[1] !== 2 || !readRequest.subarray(8, 10).equals(Buffer.from([0xaa, 0xbb]))) process.exit(96);
  const token = Buffer.alloc(16, 2);
  const contentLength = Buffer.alloc(4);
  writeFrame(Buffer.concat([Buffer.from([1, 0, 2, 0]), token, metadata(), Buffer.alloc(32), contentLength]));
  const replaceRequest = readFrame();
  if (replaceRequest[1] !== 3 || replaceRequest[8] !== 0xcc) process.exit(97);
  const tokenOffset = 9;
  if (!replaceRequest.subarray(tokenOffset, tokenOffset + 16).equals(token)) process.exit(98);
  const replacementLength = replaceRequest.readUInt32BE(tokenOffset + 16);
  if (replacementLength !== 3 || !replaceRequest.subarray(-3).equals(Buffer.from([7, 8, 9]))) process.exit(99);
  writeFrame(Buffer.concat([Buffer.from([1, 0, 3, 0]), token]));
}, 75);
`,
  );
  const client = await openGeneratedAppMutationRoot(root, { brokerPath });
  const readComponent = Buffer.from([0xaa, 0xbb]);
  const replaceComponent = Buffer.from([0xcc]);
  const token = Buffer.alloc(16, 2);
  const replacement = Buffer.from([7, 8, 9]);

  const first = client.list([]);
  const read = client.read([readComponent]);
  const replace = client.replace([replaceComponent], token, replacement);
  readComponent.fill(0x11);
  replaceComponent.fill(0x22);
  token.fill(0x33);
  replacement.fill(0x44);

  await first;
  await read;
  await replace;
  await client.close();
});

test("invalid admission poisons the client without sending a request", async (t) => {
  const invalidCalls = [
    (client) => client.read([Buffer.from("..")]),
    (client) => client.replace([Buffer.from("main.js")], Buffer.alloc(15), Buffer.alloc(0)),
    (client) => client.replace([Buffer.from("main.js")], Buffer.alloc(16), "not-bytes"),
  ];

  for (const [index, invalidCall] of invalidCalls.entries()) {
    const { parent, root } = makePrivateRoot(t);
    const marker = path.join(parent, `request-${index}`);
    const brokerPath = writeBroker(
      parent,
      `${brokerPrelude}
if (readFrame() != null) fs.writeFileSync(${JSON.stringify(marker)}, "received");
`,
    );
    const client = await openGeneratedAppMutationRoot(root, { brokerPath });

    await assert.rejects(
      invalidCall(client),
      (error) => isGeneratedAppIntegrityError(error) && error.code === "invalid-request",
    );
    await assert.rejects(client.list([]), (error) => isGeneratedAppIntegrityError(error));
    await client.close();
    assert.equal(fs.existsSync(marker), false);
  }
});

test(
  "client and real broker preserve raw bytes, mode, and nanosecond mtime",
  {
    skip:
      process.env.CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE == null
        ? "CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE is not set"
        : false,
  },
  async (t) => {
    const brokerPath = process.env.CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE;
    const { root } = makePrivateRoot(t);
    const assets = path.join(root, "assets");
    fs.mkdirSync(assets, { mode: 0o700 });
    const rawName = Buffer.from([0xff, 0x61]);
    const rawPath = Buffer.concat([Buffer.from(`${assets}/`), rawName]);
    fs.writeFileSync(rawPath, Buffer.from([0xfe, 0, 0x62]), { mode: 0o640 });
    const before = fs.statSync(rawPath, { bigint: true });

    const client = await openGeneratedAppMutationRoot(root, {
      brokerPath,
      verifiedPrivateRoot: true,
    });
    const entries = await client.list([Buffer.from("assets")]);
    assert.equal(entries.some(({ name }) => name.equals(rawName)), true);

    const current = await client.read([Buffer.from("assets"), rawName]);
    assert.deepEqual(current.content, Buffer.from([0xfe, 0, 0x62]));
    await client.replace(
      [Buffer.from("assets"), rawName],
      current.operationId,
      Buffer.from([0xfd, 0, 0x63]),
    );
    await client.close();

    const after = fs.statSync(rawPath, { bigint: true });
    assert.deepEqual(fs.readFileSync(rawPath), Buffer.from([0xfd, 0, 0x63]));
    assert.equal(after.mode & 0o777n, before.mode & 0o777n);
    assert.equal(after.mtimeNs, before.mtimeNs);
  },
);
