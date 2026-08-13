const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(
  path.resolve(__dirname, "../../.github/workflows/cachix.yml"),
  "utf8",
);
const updateHashWorkflow = fs.readFileSync(
  path.resolve(__dirname, "../../.github/workflows/update-chatgpt-hash.yml"),
  "utf8",
);
const updateHashesScript = path.resolve(__dirname, "update-nix-hashes.sh");

test("Cachix automatic population runs only for an actual ChatGPT DMG hash change", () => {
  assert.match(workflow, /paths:\n\s+- flake\.nix/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /id: chatgpt-dmg-hash/);
  assert.match(workflow, /\.\#checks\.x86_64-linux\.watchdog-port-integrations/);
  assert.doesNotMatch(workflow, /watchdog-linux-features/);
  assert.match(workflow, /if: github\.event_name != 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /if \[ "\$EVENT_NAME" = "workflow_dispatch" \]; then\n\s+changed=true/);
  assert.match(workflow, /read-flake-hash "chatgptDmg = pkgs\.fetchurl \{" "hash = "/);
  assert.equal((workflow.match(/read-flake-hash-or-missing/g) ?? []).length, 1);
  assert.match(workflow, /FLAKE_FILE="\$previous_flake"[\s\S]*read-flake-hash-or-missing/);
  assert.match(workflow, /if: needs\.detect-chatgpt-dmg-hash\.outputs\.changed == 'true'/);
});

test("Cachix treats a historical flake without the current DMG anchor as missing", (t) => {
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

test("Cachix rejects a malformed historical block that has the current anchor", (t) => {
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

test("Nix refresh commits allow post-merge workflows to run", () => {
  assert.doesNotMatch(updateHashWorkflow, /\[skip ci\]/);
  assert.match(updateHashWorkflow, /gh workflow run ci\.yml/);
});

test("Cachix population pushes each output before collecting the Nix store", () => {
  assert.match(workflow, /skipPush: true/);
  assert.match(workflow, /nix build "\$output"[\s\S]*--print-out-paths/);
  assert.doesNotMatch(workflow, /mapfile[^\n]*< <\(/);
  assert.match(workflow, /printf '%s\\n' "\$\{store_paths\[@\]\}" \| cachix push "\$CACHIX_CACHE_NAME"/);
  assert.match(workflow, /nix store gc/);
  assert.ok(
    workflow.indexOf("cachix push") < workflow.indexOf("nix store gc"),
    "Cachix upload must complete before garbage collection",
  );
});

test("Cachix population pins every third-party action", () => {
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d/);
});
