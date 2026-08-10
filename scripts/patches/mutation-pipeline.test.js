"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function writeRejectingBroker(parent, secret) {
  const brokerPath = path.join(parent, "rejecting-broker");
  fs.writeFileSync(
    brokerPath,
    `#!/usr/bin/node
"use strict";
const fs=require("node:fs");
const header=Buffer.alloc(4);
if(fs.readSync(0,header,0,4,null)!==4)process.exit(90);
const request=Buffer.alloc(header.readUInt32BE(0));
if(fs.readSync(0,request,0,request.length,null)!==request.length)process.exit(91);
const message=Buffer.from(${JSON.stringify(secret)},"ascii");
const detail=Buffer.alloc(4);detail.writeUInt16BE(4,0);detail.writeUInt16BE(message.length,2);
const payload=Buffer.concat([Buffer.from([1,1,request[1],0]),detail,message]);
const length=Buffer.alloc(4);length.writeUInt32BE(payload.length);
fs.writeSync(1,Buffer.concat([length,payload]));
process.exit(23);
`,
    { mode: 0o700 },
  );
  return brokerPath;
}

test("patcher CLI records a generic mutation failure and exits before later work", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-mutation-pipeline-"));
  const root = path.join(parent, "root");
  const reportPath = path.join(parent, "reports", "patch-report.json");
  const secret = "broker-private-path-and-token";
  fs.mkdirSync(path.join(root, ".vite", "build"), { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const mainPath = path.join(root, ".vite", "build", "main.js");
  fs.writeFileSync(mainPath, "must-stay-unchanged");
  const brokerPath = writeRejectingBroker(parent, secret);

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "patch-linux-window-ui.js"),
        "--mutation-broker",
        brokerPath,
        "--verified-private-root",
        "--report-json",
        reportPath,
        root,
      ],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(mainPath, "utf8"), "must-stay-unchanged");
    const reportText = fs.readFileSync(reportPath, "utf8");
    const report = JSON.parse(reportText);
    assert.deepEqual(report.mutationIntegrity, {
      status: "failed",
      operation: "list",
      code: "integrity",
      reason: "generated-app mutation integrity failure",
    });
    assert.deepEqual(report.patches, [], "no later descriptor may run after broker rejection");
    for (const output of [reportText, result.stdout, result.stderr]) {
      assert.equal(output.includes(secret), false);
      assert.equal(output.includes(root), false);
      assert.equal(output.includes(brokerPath), false);
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
