"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const VERSION = 1;
const STATUS_OK = 0;
const STATUS_ERROR = 1;
const FLAG_VERIFIED_PRIVATE_FALLBACK = 1;
const MAX_FRAME = 16 * 1024 * 1024 + 64 * 1024;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_COMPONENTS = 128;
const MAX_COMPONENT = 255;
const MAX_PATH = 4096;
const MAX_LIST_ENTRIES = 8192;
const BROKER_CLOSE_TIMEOUT_MS = 1_000;

const operations = Object.freeze({ list: 1, read: 2, replace: 3 });
const operationNames = Object.freeze({ 1: "list", 2: "read", 3: "replace" });
const brokerErrorCodes = Object.freeze({
  1: "protocol",
  2: "invalid-path",
  3: "unsupported-syscall",
  4: "integrity",
  5: "not-found",
  6: "wrong-type",
  7: "io",
  8: "bounds",
});

const integrityErrorMarker = Symbol("GeneratedAppIntegrityError");

class GeneratedAppIntegrityError extends Error {
  constructor(reason, { code = "integrity", operation = "session", cause } = {}) {
    super(`Generated app mutation integrity failure (${operation}/${code})`);
    this.name = "GeneratedAppIntegrityError";
    this.code = code;
    this.operation = operation;
    this.reason = typeof reason === "string" && reason.length > 0 ? reason : "integrity failure";
    this[integrityErrorMarker] = true;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { configurable: true, value: cause });
    }
  }
}

function isGeneratedAppIntegrityError(error) {
  return error?.[integrityErrorMarker] === true || error instanceof GeneratedAppIntegrityError;
}

function integrityError(error, { reason, ...options } = {}) {
  if (isGeneratedAppIntegrityError(error)) {
    return error;
  }
  const safeReason =
    typeof reason === "string" && reason.length > 0
      ? reason
      : `${options.operation ?? "mutation client"} failed`;
  return new GeneratedAppIntegrityError(safeReason, {
    ...options,
    cause: error,
  });
}

class Decoder {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  bytes(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw new Error("truncated broker response");
    }
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u8() {
    return this.bytes(1)[0];
  }

  u16() {
    const value = this.buffer.readUInt16BE(this.offset);
    this.bytes(2);
    return value;
  }

  u32() {
    const value = this.buffer.readUInt32BE(this.offset);
    this.bytes(4);
    return value;
  }

  u64() {
    const value = this.buffer.readBigUInt64BE(this.offset);
    this.bytes(8);
    return value;
  }

  i64() {
    const value = this.buffer.readBigInt64BE(this.offset);
    this.bytes(8);
    return value;
  }

  finish() {
    if (this.offset !== this.buffer.length) {
      throw new Error("broker response has trailing bytes");
    }
  }
}

function decodeMetadata(decoder) {
  return Object.freeze({
    dev: decoder.u64(),
    ino: decoder.u64(),
    mode: decoder.u32(),
    uid: decoder.u32(),
    gid: decoder.u32(),
    size: decoder.u64(),
    mtimeSeconds: decoder.i64(),
    mtimeNanoseconds: decoder.u64(),
  });
}

function validateComponents(components, allowEmpty) {
  if (!Array.isArray(components)) {
    throw new TypeError("path components must be an array of Buffers");
  }
  if ((!allowEmpty && components.length === 0) || components.length > MAX_COMPONENTS) {
    throw new RangeError("path component count is out of bounds");
  }
  let joinedLength = 0;
  const normalized = components.map((component, index) => {
    if (!Buffer.isBuffer(component)) {
      throw new TypeError("path components must be Buffers");
    }
    if (
      component.length === 0 ||
      component.length > MAX_COMPONENT ||
      component.includes(0) ||
      component.includes(0x2f) ||
      component.equals(Buffer.from(".")) ||
      component.equals(Buffer.from(".."))
    ) {
      throw new RangeError("invalid path component");
    }
    joinedLength += component.length + (index === 0 ? 0 : 1);
    return Buffer.from(component);
  });
  if (joinedLength > MAX_PATH) {
    throw new RangeError("encoded path is too long");
  }
  return normalized;
}

function encodePath(components, allowEmpty) {
  const normalized = validateComponents(components, allowEmpty);
  const count = Buffer.alloc(2);
  count.writeUInt16BE(normalized.length);
  const encoded = [count];
  for (const component of normalized) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(component.length);
    encoded.push(length, component);
  }
  return Buffer.concat(encoded);
}

function encodeRequest(operation, components, verifiedPrivateRoot, suffix = Buffer.alloc(0)) {
  const opcode = operations[operation];
  const header = Buffer.from([
    VERSION,
    opcode,
    verifiedPrivateRoot ? FLAG_VERIFIED_PRIVATE_FALLBACK : 0,
    0,
  ]);
  const payload = Buffer.concat([header, encodePath(components, operation === "list"), suffix]);
  if (payload.length === 0 || payload.length > MAX_FRAME) {
    throw new RangeError("request frame is out of bounds");
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, payload]);
}

function decodeResponse(frame, operation, expectedOperationId) {
  const decoder = new Decoder(frame);
  const version = decoder.u8();
  const status = decoder.u8();
  const opcode = decoder.u8();
  const reserved = decoder.u8();
  if (version !== VERSION || opcode !== operations[operation] || reserved !== 0) {
    throw new GeneratedAppIntegrityError("invalid broker response header", {
      code: "protocol",
      operation,
    });
  }
  if (status === STATUS_ERROR) {
    const rawCode = decoder.u16();
    const messageLength = decoder.u16();
    const messageBytes = decoder.bytes(messageLength);
    decoder.finish();
    if ([...messageBytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
      throw new GeneratedAppIntegrityError("non-ASCII broker error", {
        code: "protocol",
        operation,
      });
    }
    const brokerMessage = messageBytes.toString("ascii");
    throw new GeneratedAppIntegrityError("broker rejected request", {
      code: brokerErrorCodes[rawCode] ?? "protocol",
      operation,
      cause: new Error(brokerMessage),
    });
  }
  if (status !== STATUS_OK) {
    throw new GeneratedAppIntegrityError("unknown broker response status", {
      code: "protocol",
      operation,
    });
  }

  if (operation === "list") {
    const count = decoder.u32();
    if (count > MAX_LIST_ENTRIES) {
      throw new GeneratedAppIntegrityError("broker list count is out of bounds", {
        code: "bounds",
        operation,
      });
    }
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const name = Buffer.from(decoder.bytes(decoder.u16()));
      validateComponents([name], false);
      entries.push(Object.freeze({ name, metadata: decodeMetadata(decoder) }));
    }
    decoder.finish();
    return Object.freeze(entries);
  }

  if (operation === "read") {
    const operationId = Buffer.from(decoder.bytes(16));
    const metadata = decodeMetadata(decoder);
    const digest = Buffer.from(decoder.bytes(32));
    const contentLength = decoder.u32();
    if (contentLength > MAX_FILE) {
      throw new GeneratedAppIntegrityError("broker content is out of bounds", {
        code: "bounds",
        operation,
      });
    }
    const content = Buffer.from(decoder.bytes(contentLength));
    decoder.finish();
    return Object.freeze({ operationId, metadata, digest, content });
  }

  const operationId = Buffer.from(decoder.bytes(16));
  decoder.finish();
  if (!operationId.equals(expectedOperationId)) {
    throw new GeneratedAppIntegrityError("broker returned the wrong operation id", {
      code: "protocol",
      operation,
    });
  }
  return Object.freeze({ operationId });
}

class FrameReader {
  constructor(stream) {
    this.buffer = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.failure = null;
    this.terminalKind = null;
    this.onData = (chunk) => this.push(chunk);
    this.onEnd = () => {
      if (this.buffer.length !== 0) {
        this.fail(new Error("broker response stream ended with a partial frame"), "protocol");
        return;
      }
      this.fail(new Error("broker response stream ended"), "end");
    };
    this.onError = (error) => this.fail(error, "stream");
    stream.on("data", this.onData);
    stream.once("end", this.onEnd);
    stream.once("error", this.onError);
    this.stream = stream;
  }

  push(chunk) {
    if (this.failure != null) return;
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME) {
        this.fail(new Error("broker frame length is out of bounds"), "protocol");
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const frame = Buffer.from(this.buffer.subarray(4, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);
      const waiter = this.waiters.shift();
      if (waiter == null) this.frames.push(frame);
      else waiter.resolve(frame);
    }
  }

  fail(error, terminalKind = "stream") {
    if (this.failure != null) return;
    this.failure = error;
    this.terminalKind = terminalKind;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  read() {
    if (this.frames.length > 0) return Promise.resolve(this.frames.shift());
    if (this.failure != null) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  get pendingCount() {
    return this.frames.length;
  }

  cleanShutdownError() {
    if (this.frames.length !== 0) return new Error("unsolicited broker response at shutdown");
    if (this.buffer.length !== 0) return new Error("partial broker response at shutdown");
    if (this.terminalKind !== "end") {
      return this.failure ?? new Error("broker response stream did not end cleanly");
    }
    return null;
  }

  dispose() {
    this.stream.off("data", this.onData);
    this.stream.off("end", this.onEnd);
    this.stream.off("error", this.onError);
  }
}

function openBrokerExecutable(brokerPath) {
  if (typeof brokerPath !== "string" || !path.isAbsolute(brokerPath)) {
    throw new GeneratedAppIntegrityError("broker path must be absolute", {
      code: "unsafe-broker",
      operation: "open",
    });
  }
  let fd;
  let stat;
  try {
    fd = fs.openSync(
      brokerPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | (fs.constants.O_CLOEXEC ?? 0),
    );
    stat = fs.fstatSync(fd);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    throw integrityError(error, { code: "unsafe-broker", operation: "open" });
  }
  const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
  const trustedOwner = effectiveUid == null || stat.uid === effectiveUid || stat.uid === 0;
  if (
    !stat.isFile() ||
    !trustedOwner ||
    (stat.mode & 0o111) === 0 ||
    (stat.mode & 0o022) !== 0
  ) {
    fs.closeSync(fd);
    throw new GeneratedAppIntegrityError("broker executable is not a trusted regular file", {
      code: "unsafe-broker",
      operation: "open",
    });
  }
  return fd;
}

function brokerStatMatches(before, after) {
  return ["dev", "ino", "mode", "nlink", "uid", "gid", "rdev", "size", "mtimeNs", "ctimeNs"]
    .every((field) => before[field] === after[field]);
}

function digestOpenBrokerExecutable(fd) {
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("broker executable size is unsafe");
    }

    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const expectedSize = Number(before.size);
    let position = 0;
    while (position < expectedSize) {
      const bytesRead = fs.readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, expectedSize - position),
        position,
      );
      if (bytesRead === 0) {
        throw new Error("broker executable changed while hashing");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    const after = fs.fstatSync(fd, { bigint: true });
    if (!brokerStatMatches(before, after)) {
      throw new Error("broker executable changed while hashing");
    }
    return hash.digest("hex");
  } catch (error) {
    throw integrityError(error, {
      code: "unsafe-broker",
      operation: "digest",
      reason: "broker executable could not be hashed from a stable descriptor",
    });
  }
}

function openPrivateRoot(rootPath) {
  const flags =
    fs.constants.O_RDONLY |
    fs.constants.O_DIRECTORY |
    fs.constants.O_NOFOLLOW |
    (fs.constants.O_CLOEXEC ?? 0);
  let fd;
  try {
    fd = fs.openSync(rootPath, flags);
    const stat = fs.fstatSync(fd);
    const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
    if (!stat.isDirectory() || (effectiveUid != null && stat.uid !== effectiveUid) || (stat.mode & 0o077) !== 0) {
      throw new GeneratedAppIntegrityError("mutation root is not an owned private directory", {
        code: "unsafe-root",
        operation: "open",
      });
    }
    return fd;
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    throw integrityError(error, { code: "unsafe-root", operation: "open" });
  }
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function trackChildClose(child) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForChildCloseWithinBound(child, childClose) {
  let timer;
  const timeoutResult = Symbol("broker-close-timeout");
  const result = await Promise.race([
    childClose,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(timeoutResult), BROKER_CLOSE_TIMEOUT_MS);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
  if (result !== timeoutResult) {
    return result;
  }
  try {
    child.kill("SIGKILL");
  } catch {}
  try {
    child.stdin.destroy();
  } catch {}
  try {
    child.stdout.destroy();
  } catch {}
  return null;
}

function writeRequest(stream, frame) {
  return new Promise((resolve, reject) => {
    stream.write(frame, (error) => (error == null ? resolve() : reject(error)));
  });
}

async function openGeneratedAppMutationRoot(
  rootPath,
  { brokerPath, verifiedPrivateRoot = false } = {},
) {
  if (typeof verifiedPrivateRoot !== "boolean") {
    throw new GeneratedAppIntegrityError("private fallback assertion must be a boolean", {
      code: "invalid-fallback-assertion",
      operation: "open",
    });
  }
  const brokerFd = openBrokerExecutable(brokerPath);
  let rootFd;
  try {
    rootFd = openPrivateRoot(rootPath);
  } catch (error) {
    fs.closeSync(brokerFd);
    throw error;
  }
  let child;
  let childClose;
  let brokerDigest;
  try {
    brokerDigest = digestOpenBrokerExecutable(brokerFd);
    child = spawn("/proc/self/fd/5", [], {
      cwd: "/",
      env: {},
      stdio: ["pipe", "pipe", "inherit", rootFd, "ignore", brokerFd],
      windowsHide: true,
    });
    child.stdin.on("error", () => {
      // Each active write receives the same error through its callback and
      // converts it into a typed, session-poisoning integrity failure.
    });
    childClose = trackChildClose(child);
    await waitForSpawn(child);
    if (digestOpenBrokerExecutable(brokerFd) !== brokerDigest) {
      throw new Error("broker executable changed across process start");
    }
  } catch (error) {
    try {
      child?.kill("SIGKILL");
    } catch {}
    fs.closeSync(brokerFd);
    throw integrityError(error, { code: "broker-start", operation: "open" });
  } finally {
    fs.closeSync(rootFd);
  }

  const reader = new FrameReader(child.stdout);
  let poison = null;
  let closing = false;
  let closed = false;
  let queue = Promise.resolve();
  let closePromise = null;

  function poisonClient(error) {
    const typed = integrityError(error, { code: "protocol", operation: "session" });
    if (poison == null) poison = typed;
    try {
      child.stdin.destroy();
    } catch {}
    try {
      child.kill("SIGTERM");
    } catch {}
    return typed;
  }

  function enqueue(operation, action) {
    if (poison != null) return Promise.reject(poison);
    if (closing || closed) {
      return Promise.reject(
        new GeneratedAppIntegrityError("mutation client is closed", {
          code: "closed",
          operation,
        }),
      );
    }
    const result = queue.then(async () => {
      if (poison != null) throw poison;
      try {
        return await action();
      } catch (error) {
        throw poisonClient(integrityError(error, { code: "protocol", operation }));
      }
    });
    queue = result.catch(() => {});
    return result;
  }

  async function request(operation, frame, expectedOperationId) {
    if (reader.pendingCount !== 0) {
      throw new GeneratedAppIntegrityError("unsolicited broker response", {
        code: "protocol",
        operation,
      });
    }
    await writeRequest(child.stdin, frame);
    const response = await reader.read();
    if (reader.pendingCount !== 0) {
      throw new GeneratedAppIntegrityError("unsolicited broker response", {
        code: "protocol",
        operation,
      });
    }
    return decodeResponse(response, operation, expectedOperationId);
  }

  const client = {
    brokerDigest,
    list(components) {
      let frame;
      try {
        frame = encodeRequest("list", components, verifiedPrivateRoot);
      } catch (error) {
        return Promise.reject(
          poisonClient(
            integrityError(error, {
              code: "invalid-request",
              operation: "list",
              reason: "invalid list request",
            }),
          ),
        );
      }
      return enqueue("list", () => request("list", frame));
    },
    read(components) {
      let frame;
      try {
        frame = encodeRequest("read", components, verifiedPrivateRoot);
      } catch (error) {
        return Promise.reject(
          poisonClient(
            integrityError(error, {
              code: "invalid-request",
              operation: "read",
              reason: "invalid read request",
            }),
          ),
        );
      }
      return enqueue("read", () => request("read", frame));
    },
    replace(components, operationId, replacement) {
      let frame;
      let token;
      try {
        if (!Buffer.isBuffer(operationId) || operationId.length !== 16) {
          throw new TypeError("replace operation id must be a 16-byte Buffer");
        }
        if (!Buffer.isBuffer(replacement) || replacement.length > MAX_FILE) {
          throw new RangeError("replacement must be a Buffer within the file bound");
        }
        const replacementLength = Buffer.alloc(4);
        replacementLength.writeUInt32BE(replacement.length);
        token = Buffer.from(operationId);
        frame = encodeRequest(
          "replace",
          components,
          verifiedPrivateRoot,
          Buffer.concat([token, replacementLength, replacement]),
        );
      } catch (error) {
        return Promise.reject(
          poisonClient(
            integrityError(error, {
              code: "invalid-request",
              operation: "replace",
              reason: "invalid replace request",
            }),
          ),
        );
      }
      return enqueue("replace", () => request("replace", frame, token));
    },
    close() {
      if (closePromise != null) return closePromise;
      closing = true;
      closePromise = (async () => {
        let closeError = null;
        await queue;
        if (poison == null) {
          child.stdin.end();
          const result = await waitForChildCloseWithinBound(child, childClose);
          if (result == null) {
            closeError = new GeneratedAppIntegrityError("broker did not close within the termination bound", {
              code: "broker-exit",
              operation: "close",
            });
            poison = closeError;
          } else if (result.code !== 0) {
            closeError = new GeneratedAppIntegrityError("broker exited unsuccessfully", {
              code: "broker-exit",
              operation: "close",
            });
            poison = closeError;
          } else {
            const shutdownError = reader.cleanShutdownError();
            if (shutdownError != null) {
              closeError = new GeneratedAppIntegrityError(shutdownError.message, {
                code: "protocol",
                operation: "close",
                cause: shutdownError,
              });
              poison = closeError;
            } else {
              try {
                if (digestOpenBrokerExecutable(brokerFd) !== brokerDigest) {
                  throw new Error("broker executable changed during the session");
                }
              } catch (error) {
                closeError = integrityError(error, {
                  code: "unsafe-broker",
                  operation: "close",
                  reason: "broker executable changed during the session",
                });
                poison = closeError;
              }
            }
          }
        } else {
          await waitForChildCloseWithinBound(child, childClose);
        }
        fs.closeSync(brokerFd);
        reader.dispose();
        closed = true;
        if (closeError != null) throw closeError;
      })();
      return closePromise;
    },
  };

  return Object.freeze(client);
}

module.exports = {
  GeneratedAppIntegrityError,
  isGeneratedAppIntegrityError,
  openGeneratedAppMutationRoot,
};
