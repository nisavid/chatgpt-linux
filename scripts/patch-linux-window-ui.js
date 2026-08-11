#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const {
  createPatchReport,
  criticalFailuresFromReport,
  writePatchReport,
} = require("./lib/patch-report.js");
const {
  patchExtractedApp,
} = require("./patches/runner.js");
const {
  isGeneratedAppIntegrityError,
} = require("./patches/lib/generated-app-mutation-client.js");
const {
  createInventory,
  findPostPatchIntegrityFindings,
} = require("./lib/upstream-dmg-intel.js");

const USAGE = "Usage: patch-linux-window-ui.js [--report-json path] [--enforce-critical] [--mutation-broker path] [--mutation-broker-digest-fd fd] [--verified-private-root] <extracted-app-asar-dir>";

async function main() {
  const args = process.argv.slice(2);
  let reportJson = null;
  let enforceCritical = false;
  let mutationBrokerPath = process.env.CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE ?? null;
  let mutationBrokerDigestFd = null;
  let verifiedPrivateRoot = false;
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--report-json") {
      reportJson = args[index + 1];
      if (!reportJson) {
        console.error(USAGE);
        process.exit(1);
      }
      index += 1;
    } else if (arg === "--enforce-critical") {
      enforceCritical = true;
    } else if (arg === "--mutation-broker") {
      mutationBrokerPath = args[index + 1];
      if (!mutationBrokerPath) {
        console.error(USAGE);
        process.exit(1);
      }
      index += 1;
    } else if (arg === "--mutation-broker-digest-fd") {
      const value = args[index + 1];
      if (
        mutationBrokerDigestFd != null ||
        typeof value !== "string" ||
        !/^(?:[3-9]|[1-9][0-9]+)$/.test(value) ||
        !Number.isSafeInteger(Number(value))
      ) {
        console.error(USAGE);
        process.exit(1);
      }
      mutationBrokerDigestFd = Number(value);
      index += 1;
    } else if (arg === "--verified-private-root") {
      verifiedPrivateRoot = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }

  const extractedDir = positional[0];

  if (!extractedDir || positional.length > 1) {
    console.error(USAGE);
    process.exit(1);
  }

  // Enforcement needs the report data even when no --report-json was requested.
  const report = reportJson == null && !enforceCritical ? null : createPatchReport();
  let mutationFailure = null;
  let patchResult = null;
  try {
    patchResult = await patchExtractedApp(extractedDir, {
      report,
      mutationBrokerPath,
      verifiedPrivateRoot,
    });
    if (report != null) {
      const inventory = createInventory({ sourcePath: extractedDir });
      const findings = findPostPatchIntegrityFindings(inventory);
      report.postPatchIntegrity = {
        sourcePath: extractedDir,
        findingCount: findings.length,
        findings,
      };
    }
  } catch (error) {
    if (!isGeneratedAppIntegrityError(error)) {
      throw error;
    }
    mutationFailure = error;
    if (report != null) {
      report.mutationIntegrity = {
        status: "failed",
        operation: error.operation,
        code: error.code,
        reason: "generated-app mutation integrity failure",
      };
    }
  } finally {
    // Write the report before gating so CI artifact upload sees it even on failure.
    writePatchReport(reportJson, report);
  }

  if (mutationFailure != null) {
    throw mutationFailure;
  }

  if (enforceCritical) {
    const failures = criticalFailuresFromReport(report);
    if (failures.length > 0) {
      console.error(`Critical patch failures (${failures.length}):`);
      for (const failure of failures) {
        console.error(`  - ${failure.name} (${failure.status})${failure.reason ? `: ${failure.reason}` : ""}`);
      }
      console.error(
        "Aborting: these patches are required for a working Linux app. " +
          "Set CHATGPT_ENFORCE_CRITICAL_PATCHES=0 to bypass (emergency builds only).",
      );
      process.exit(1);
    }
  }

  if (mutationBrokerDigestFd != null) {
    const digest = patchResult?.brokerDigest;
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error("Mutation broker did not return a valid descriptor-bound digest");
    }
    const receipt = Buffer.from(`${digest}\n`, "ascii");
    if (fs.writeSync(mutationBrokerDigestFd, receipt) !== receipt.length) {
      throw new Error("Could not write the complete mutation broker digest receipt");
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (isGeneratedAppIntegrityError(error)) {
      console.error("Generated-app mutation integrity failure; candidate patching stopped.");
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
