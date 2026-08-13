"use strict";

const fs = require("node:fs");
const os = require("node:os");

function detectLibc() {
  const report = process.report?.getReport?.();
  if (typeof report?.header?.glibcVersionRuntime === "string") {
    return "glibc";
  }
  for (const directory of ["/lib", "/usr/lib"]) {
    try {
      if (fs.readdirSync(directory).some((name) => /^ld-musl-[A-Za-z0-9._-]+\.so\.1$/u.test(name))) {
        return "musl";
      }
    } catch {
      // An unreadable conventional loader directory provides no positive proof.
    }
  }
  return "unknown";
}

function detectHostTarget() {
  const target = {
    platform: process.platform,
    arch: process.arch,
    libc: detectLibc(),
    kernelMachine: os.machine(),
  };
  if (process.arch === "arm") {
    const armVersion = Number(process.config?.variables?.arm_version);
    const armFloatAbi = process.config?.variables?.arm_float_abi;
    if (Number.isInteger(armVersion)) {
      target.armVersion = armVersion;
    }
    if (armFloatAbi === "hard" || armFloatAbi === "soft") {
      target.armFloatAbi = armFloatAbi;
    }
  }
  return Object.freeze(target);
}

function validatedTarget(target) {
  if (
    target == null ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    typeof target.id !== "string" ||
    !/^[a-z0-9-]+$/u.test(target.id) ||
    target.platform !== "linux" ||
    !["x64", "arm64", "arm"].includes(target.arch) ||
    target.libc !== "glibc" ||
    !Array.isArray(target.kernelMachines) ||
    target.kernelMachines.length === 0 ||
    target.kernelMachines.some(
      (machine) => typeof machine !== "string" || !/^[A-Za-z0-9._-]+$/u.test(machine),
    ) ||
    new Set(target.kernelMachines).size !== target.kernelMachines.length ||
    typeof target.nativePackage !== "string" ||
    !/^@parcel\/watcher-linux-[A-Za-z0-9-]+$/u.test(target.nativePackage)
  ) {
    throw new Error("approval manifest contains an invalid Parcel watcher target");
  }
  if (target.arch === "arm") {
    if (target.armVersion !== 7 || target.armFloatAbi !== "hard") {
      throw new Error("approval manifest contains an unsupported Parcel watcher ARM target");
    }
  } else if ("armVersion" in target || "armFloatAbi" in target) {
    throw new Error("approval manifest contains ARM constraints for a non-ARM target");
  }
  return target;
}

function targetMatches(target, host) {
  return (
    target.platform === host.platform &&
    target.arch === host.arch &&
    target.libc === host.libc &&
    target.kernelMachines.includes(host.kernelMachine) &&
    (target.arch !== "arm" ||
      (target.armVersion === host.armVersion && target.armFloatAbi === host.armFloatAbi))
  );
}

function selectApprovedTarget(manifest, host) {
  if (manifest == null || typeof manifest !== "object" || !Array.isArray(manifest.targets)) {
    throw new Error("approval manifest has no Parcel watcher target allowlist");
  }
  if (host == null || typeof host !== "object" || Array.isArray(host)) {
    throw new Error("Parcel watcher host target is invalid");
  }
  const targets = manifest.targets.map(validatedTarget);
  const ids = new Set();
  for (const target of targets) {
    if (ids.has(target.id)) {
      throw new Error("approval manifest contains a duplicate Parcel watcher target id");
    }
    ids.add(target.id);
  }
  const matches = targets.filter((target) => targetMatches(target, host));
  if (matches.length === 0) {
    throw new Error("@parcel/watcher is not approved for this host");
  }
  if (matches.length !== 1) {
    throw new Error("host matched more than one approved target");
  }
  return Object.freeze({ ...matches[0], kernelMachines: Object.freeze([...matches[0].kernelMachines]) });
}

module.exports = {
  detectHostTarget,
  selectApprovedTarget,
};
