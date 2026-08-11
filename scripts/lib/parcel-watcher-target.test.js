"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectHostTarget,
  selectApprovedTarget,
} = require("./parcel-watcher-target");

const targets = [
  {
    id: "linux-x64-glibc",
    platform: "linux",
    arch: "x64",
    libc: "glibc",
    kernelMachines: ["x86_64"],
    nativePackage: "@parcel/watcher-linux-x64-glibc",
  },
  {
    id: "linux-arm64-glibc",
    platform: "linux",
    arch: "arm64",
    libc: "glibc",
    kernelMachines: ["aarch64", "arm64"],
    nativePackage: "@parcel/watcher-linux-arm64-glibc",
  },
  {
    id: "linux-arm-glibc",
    platform: "linux",
    arch: "arm",
    libc: "glibc",
    kernelMachines: ["armv7l"],
    armVersion: 7,
    armFloatAbi: "hard",
    nativePackage: "@parcel/watcher-linux-arm-glibc",
  },
];

test("selects every supported Linux target exactly", () => {
  const manifest = { targets };
  const cases = [
    [
      { platform: "linux", arch: "x64", libc: "glibc", kernelMachine: "x86_64" },
      "linux-x64-glibc",
    ],
    [
      { platform: "linux", arch: "arm64", libc: "glibc", kernelMachine: "aarch64" },
      "linux-arm64-glibc",
    ],
    [
      {
        platform: "linux",
        arch: "arm",
        libc: "glibc",
        kernelMachine: "armv7l",
        armVersion: 7,
        armFloatAbi: "hard",
      },
      "linux-arm-glibc",
    ],
  ];

  for (const [host, expectedId] of cases) {
    assert.equal(selectApprovedTarget(manifest, host).id, expectedId);
  }
});

test("rejects unsupported hosts instead of selecting a nearby archive", () => {
  const manifest = { targets };
  const unsupported = [
    { platform: "darwin", arch: "x64", libc: "unknown", kernelMachine: "x86_64" },
    { platform: "linux", arch: "x64", libc: "musl", kernelMachine: "x86_64" },
    { platform: "linux", arch: "x64", libc: "unknown", kernelMachine: "x86_64" },
    { platform: "linux", arch: "ia32", libc: "glibc", kernelMachine: "i686" },
    {
      platform: "linux",
      arch: "arm",
      libc: "glibc",
      kernelMachine: "armv6l",
      armVersion: 6,
      armFloatAbi: "hard",
    },
    {
      platform: "linux",
      arch: "arm",
      libc: "glibc",
      kernelMachine: "armv7l",
      armVersion: 7,
      armFloatAbi: "soft",
    },
  ];

  for (const host of unsupported) {
    assert.throws(
      () => selectApprovedTarget(manifest, host),
      /not approved for this host/u,
    );
  }
});

test("rejects duplicate target matches", () => {
  const manifest = { targets: [...targets, { ...targets[0], id: "duplicate" }] };
  assert.throws(
    () =>
      selectApprovedTarget(manifest, {
        platform: "linux",
        arch: "x64",
        libc: "glibc",
        kernelMachine: "x86_64",
      }),
    /matched more than one approved target/u,
  );
});

test("detects the real host without accepting an override", () => {
  assert.equal(detectHostTarget.length, 0);
  const target = detectHostTarget();
  assert.equal(target.platform, process.platform);
  assert.equal(target.arch, process.arch);
  assert.equal(typeof target.kernelMachine, "string");
  assert.ok(["glibc", "musl", "unknown"].includes(target.libc));
});
