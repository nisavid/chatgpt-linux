const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workflowRoot = path.resolve(__dirname, "../../.github/workflows");
const updateHashesScript = path.resolve(__dirname, "update-nix-hashes.sh");

test("Cachix and Nix refresh producer workflows remain retired", () => {
  assert.equal(fs.existsSync(path.join(workflowRoot, "cachix.yml")), false);
  assert.equal(
    fs.existsSync(path.join(workflowRoot, "update-chatgpt-hash.yml")),
    false,
  );
});

test("historical hash tooling treats a flake without the current DMG anchor as missing", (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-cachix-flake-"));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const flakePath = path.join(fixtureDir, "flake.nix");
  fs.writeFileSync(
    flakePath,
    'codexDmg = pkgs.fetchurl {\n  hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";\n};\n',
  );

  const result = childProcess.spawnSync(
    updateHashesScript,
    ["read-flake-hash-or-missing", "chatgptDmg = pkgs.fetchurl {", "hash = "],
    {
      encoding: "utf8",
      env: {
        FLAKE_FILE: flakePath,
        PATH: process.env.PATH,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "missing");
});

test("historical hash tooling rejects a malformed current DMG block", (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-cachix-flake-"));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const flakePath = path.join(fixtureDir, "flake.nix");
  fs.writeFileSync(flakePath, "chatgptDmg = pkgs.fetchurl {\n  url = source;\n};\n");

  const result = childProcess.spawnSync(
    updateHashesScript,
    ["read-flake-hash-or-missing", "chatgptDmg = pkgs.fetchurl {", "hash = "],
    {
      encoding: "utf8",
      env: {
        FLAKE_FILE: flakePath,
        PATH: process.env.PATH,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Could not find 'hash = '/);
});
