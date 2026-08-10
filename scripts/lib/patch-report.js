"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CRITICAL_CI_POLICY = "required-official-dmg";
const LEGACY_CRITICAL_CI_POLICY = "required-upstream";
const PATCH_STATUS_APPLIED = "applied";
const PATCH_STATUS_ALREADY_APPLIED = "already-applied";
const PATCH_STATUS_APPLIED_WITH_WARNINGS = "applied-with-warnings";
const PATCH_STATUS_FAILED_REQUIRED = "failed-required";
const PATCH_STATUS_SKIPPED_DISABLED = "skipped-disabled";
const PATCH_STATUS_SKIPPED_OPTIONAL = "skipped-optional";
const PATCH_STATUS_SKIPPED_TARGET = "skipped-target";

const SUCCESS_STATUSES = new Set([PATCH_STATUS_APPLIED, PATCH_STATUS_ALREADY_APPLIED]);
// Statuses meaning "not applicable here" rather than "failed": the patch was
// skipped because of platform targeting or an explicit enable gate.
const NOT_APPLICABLE_STATUSES = new Set([PATCH_STATUS_SKIPPED_TARGET, PATCH_STATUS_SKIPPED_DISABLED]);

function isCriticalPolicy(ciPolicy) {
  return ciPolicy === CRITICAL_CI_POLICY || ciPolicy === LEGACY_CRITICAL_CI_POLICY;
}

function reportEntryFailure(patch) {
  return {
    name: patch.name,
    status: patch.status,
    reason: patch.reason ?? null,
  };
}

function criticalFailuresFromReport(report) {
  return (report?.patches ?? [])
    .filter((patch) => isCriticalPolicy(patch.ciPolicy))
    .filter((patch) => !SUCCESS_STATUSES.has(patch.status) && !NOT_APPLICABLE_STATUSES.has(patch.status))
    .map(reportEntryFailure);
}

function optionalDriftFromReport(report) {
  return (report?.patches ?? [])
    .filter((patch) => !isCriticalPolicy(patch.ciPolicy))
    .filter((patch) => !SUCCESS_STATUSES.has(patch.status) && !NOT_APPLICABLE_STATUSES.has(patch.status))
    .map(reportEntryFailure);
}

function enabledIntegrationFailuresFromReport(report) {
  const enabledIntegrations = new Set(
    Array.isArray(report?.enabledIntegrations)
      ? report.enabledIntegrations
      : Array.isArray(report?.enabledFeatures)
        ? report.enabledFeatures
        : [],
  );
  return (report?.patches ?? [])
    .filter((patch) => {
      const integrationId = patch.integrationId ?? patch.featureId;
      return (patch.sourceKind === "integration" || patch.sourceKind === "feature") &&
        enabledIntegrations.has(integrationId);
    })
    .filter((patch) => !SUCCESS_STATUSES.has(patch.status) && !NOT_APPLICABLE_STATUSES.has(patch.status))
    .map((patch) => ({
      ...reportEntryFailure(patch),
      integrationId: patch.integrationId ?? patch.featureId,
    }));
}

function createPatchReport() {
  return {
    generatedAt: new Date().toISOString(),
    target: null,
    mainBundle: null,
    iconAsset: null,
    desktopName: null,
    linuxTarget: null,
    enabledIntegrations: [],
    mutationIntegrity: null,
    patches: [],
  };
}

function recordPatch(report, name, status, reason = null, metadata = null) {
  if (report == null) {
    return;
  }

  const entry = { name, status };
  if (reason != null && String(reason).length > 0) {
    entry.reason = String(reason);
  }
  if (metadata != null && typeof metadata === "object") {
    for (const [key, value] of Object.entries(metadata)) {
      if (["name", "status", "reason", "__proto__", "prototype", "constructor"].includes(key)) {
        continue;
      }
      entry[key] = value;
    }
  }
  report.patches.push(entry);
}

function captureWarnings(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
    originalWarn(...args);
  };
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function captureWarningsAsync(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
    originalWarn(...args);
  };
  try {
    return { value: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

function writePatchReport(reportPath, report) {
  if (reportPath == null) {
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function patchStatusFromChange(changed, warnings, ciPolicy = "optional") {
  const required = isCriticalPolicy(ciPolicy);
  if (changed) {
    if (warnings.length > 0) {
      return required ? PATCH_STATUS_FAILED_REQUIRED : PATCH_STATUS_APPLIED_WITH_WARNINGS;
    }
    return PATCH_STATUS_APPLIED;
  }
  if (warnings.length > 0) {
    return required ? PATCH_STATUS_FAILED_REQUIRED : PATCH_STATUS_SKIPPED_OPTIONAL;
  }
  return PATCH_STATUS_ALREADY_APPLIED;
}

function patchGroupForEntry(entry) {
  if (isCriticalPolicy(entry.ciPolicy)) {
    return "requiredCore";
  }
  return entry.sourceKind === "feature" || entry.sourceKind === "integration"
    ? "optionalIntegrations"
    : "optionalCore";
}

function summarizePatchReport(report) {
  const groups = {
    requiredCore: { count: 0, statusCounts: {} },
    optionalCore: { count: 0, statusCounts: {} },
    optionalIntegrations: { count: 0, statusCounts: {}, byIntegration: {} },
  };

  for (const patch of report?.patches ?? []) {
    const groupName = patchGroupForEntry(patch);
    const group = groups[groupName];
    group.count += 1;
    group.statusCounts[patch.status] = (group.statusCounts[patch.status] ?? 0) + 1;

    if (groupName === "optionalIntegrations") {
      const integrationId = patch.integrationId ?? patch.featureId ?? "unknown-integration";
      const integrationGroup = group.byIntegration[integrationId] ??= { count: 0, statusCounts: {} };
      integrationGroup.count += 1;
      integrationGroup.statusCounts[patch.status] = (integrationGroup.statusCounts[patch.status] ?? 0) + 1;
    }
  }

  return {
    enabledIntegrations: Array.isArray(report?.enabledIntegrations) ? [...report.enabledIntegrations] : [],
    groups,
  };
}

module.exports = {
  CRITICAL_CI_POLICY,
  NOT_APPLICABLE_STATUSES,
  PATCH_STATUS_ALREADY_APPLIED,
  PATCH_STATUS_APPLIED,
  PATCH_STATUS_APPLIED_WITH_WARNINGS,
  PATCH_STATUS_FAILED_REQUIRED,
  PATCH_STATUS_SKIPPED_DISABLED,
  PATCH_STATUS_SKIPPED_OPTIONAL,
  PATCH_STATUS_SKIPPED_TARGET,
  SUCCESS_STATUSES,
  captureWarnings,
  captureWarningsAsync,
  createPatchReport,
  criticalFailuresFromReport,
  enabledIntegrationFailuresFromReport,
  isCriticalPolicy,
  optionalDriftFromReport,
  patchStatusFromChange,
  recordPatch,
  summarizePatchReport,
  writePatchReport,
};
