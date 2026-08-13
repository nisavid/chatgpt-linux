"use strict";

const path = require("node:path");

const {
  PATCH_STATUS_FAILED_REQUIRED,
  patchStatusFromChange,
  recordPatch,
} = require("../lib/patch-report.js");
const {
  detectLinuxTargetContext,
  linuxTargetSummary,
} = require("../lib/linux-target-context.js");
const {
  loadPortIntegrationPatchDescriptors,
  enabledPortIntegrationIds,
} = require("../lib/port-integrations.js");
const {
  findIconAssetWithCapability,
  findMainBundleWithCapability,
  readMatchingWebviewAssetSourcesWithCapability,
  replaceMainBundleWithCapability,
} = require("./lib/assets.js");
const {
  openGeneratedAppMutationRoot,
} = require("./lib/generated-app-mutation-client.js");
const {
  applyExtractedAppPatchDescriptors,
  applyMainBundlePatchDescriptors,
  applyWebviewAssetPatchDescriptors,
  discoverCorePatchDescriptors,
  normalizePatchDescriptors,
} = require("./engine.js");
const {
  PHASE_EXTRACTED_APP_POST_WEBVIEW,
  PHASE_EXTRACTED_APP_PRE_WEBVIEW,
  PHASE_MAIN_BUNDLE,
} = require("./descriptor.js");
const {
  matchesLinuxComputerUseAuthorityContract,
  matchesLinuxComputerUseAvatarCursorContract,
  matchesLinuxComputerUseDisableOrderingContract,
  matchesLinuxComputerUseFeatureContract,
  matchesLinuxComputerUseHostPlatformContract,
  matchesLinuxComputerUseInstallFlowContract,
  matchesLinuxComputerUseRendererAvailabilityContract,
  matchesLinuxNativeDesktopAppsContract,
} = require("./impl/computer-use.js");

const REQUIRED_OFFICIAL_DMG = "required-official-dmg";
const REQUIRED_UPSTREAM = REQUIRED_OFFICIAL_DMG;
const OPTIONAL = "optional";
const OPT_IN = "opt-in";
const CORE_PATCH_ROOT = path.join(__dirname, "core");

const CUSTOM_PATCH_POLICIES = [
  { name: "main-process-ui", ciPolicy: REQUIRED_UPSTREAM, phase: "main-bundle" },
];

function recordMainProcessUiPatch(report, status, reason = null) {
  recordPatch(report, "main-process-ui", status, reason, {
    phase: "main-bundle",
    ciPolicy: REQUIRED_UPSTREAM,
    sourceKind: "core",
  });
}

function normalizeDiscoveredCorePatchDescriptors(options = {}) {
  const root = options.corePatchRoot ?? CORE_PATCH_ROOT;
  return normalizePatchDescriptors(discoverCorePatchDescriptors({ root }));
}

function corePatchDescriptors(options = {}) {
  return normalizeDiscoveredCorePatchDescriptors(options);
}

function featurePatchDescriptors(options = {}) {
  return normalizePatchDescriptors(loadPortIntegrationPatchDescriptors(options));
}

function featurePatchOptions(options = {}) {
  return {
    ...(options.integrationsRoot != null ? { integrationsRoot: options.integrationsRoot } : {}),
    ...(options.featuresRoot != null ? { featuresRoot: options.featuresRoot } : {}),
    ...(options.integrationsConfigPath != null ? { integrationsConfigPath: options.integrationsConfigPath } : {}),
    ...(options.featuresConfigPath != null ? { featuresConfigPath: options.featuresConfigPath } : {}),
  };
}

function createMainBundleContext(iconAsset, options = {}) {
  const linux = options.linuxTarget ?? detectLinuxTargetContext(options.linuxTargetOptions);
  return {
    computerUseSupportPatching: options.computerUseSupportPatching !== false,
    iconAsset,
    iconPathExpression:
      iconAsset == null ? null : `process.resourcesPath+\`/../content/webview/assets/${iconAsset}\``,
    linux,
    linuxTarget: linux,
    corePatchRoot: options.corePatchRoot,
    featurePatchOptions: featurePatchOptions(options),
  };
}

async function matchingAssetSources(capability, pattern) {
  return (await readMatchingWebviewAssetSourcesWithCapability(capability, pattern))
    .map(({ source }) => source);
}

async function derivesLinuxComputerUseSupport(capability, mainSource) {
  if (
    !matchesLinuxComputerUseFeatureContract(mainSource) ||
    !matchesLinuxComputerUseAuthorityContract(mainSource) ||
    !matchesLinuxComputerUseAvatarCursorContract(mainSource) ||
    !matchesLinuxNativeDesktopAppsContract(mainSource)
  ) {
    return false;
  }

  const settingsSources = await matchingAssetSources(
    capability,
    /^computer-use-settings-[^.]+\.js$/,
  );
  const appInitialSources = await matchingAssetSources(capability, /^app-initial-[^.]+\.js$/);
  return settingsSources.filter(matchesLinuxComputerUseRendererAvailabilityContract).length === 1 &&
    appInitialSources.filter((source) =>
      matchesLinuxComputerUseHostPlatformContract(source) &&
      matchesLinuxComputerUseDisableOrderingContract(source) &&
      matchesLinuxComputerUseInstallFlowContract(source)
    ).length === 1;
}

function setReportLinuxTarget(report, linux) {
  if (report == null) {
    return;
  }

  report.linuxTarget = {
    summary: linuxTargetSummary(linux),
    distro: linux.distro,
    packageFormat: linux.packageFormat,
    packageManager: linux.packageManager,
    arch: linux.arch,
    desktop: linux.desktop,
    sessionType: linux.sessionType,
    wayland: linux.wayland,
    x11: linux.x11,
  };
}

function mainBundlePatchDescriptors(context) {
  return normalizePatchDescriptors([
    ...corePatchDescriptors({ corePatchRoot: context.corePatchRoot })
      .filter((patch) => patch.phase === PHASE_MAIN_BUNDLE),
    ...featurePatchDescriptors(context.featurePatchOptions).filter((patch) => patch.phase === PHASE_MAIN_BUNDLE),
  ]);
}

function applyMainBundlePatches(source, context, report) {
  return applyMainBundlePatchDescriptors(source, mainBundlePatchDescriptors(context), context, report);
}

function patchMainBundleSource(source, iconAsset, options = {}) {
  return applyMainBundlePatches(source, createMainBundleContext(iconAsset, options), null).patchedSource;
}

async function patchExtractedAppWithCapability(extractedDir, options, capability) {
  const report = options.report ?? null;
  const baseContext = createMainBundleContext(null, options);
  const integrationsOptions = featurePatchOptions(options);
  const patchDescriptors = normalizePatchDescriptors([
    ...corePatchDescriptors({ corePatchRoot: options.corePatchRoot }),
    ...featurePatchDescriptors(integrationsOptions),
  ]);

  setReportLinuxTarget(report, baseContext.linux);
  if (report != null) {
    report.enabledIntegrations = enabledPortIntegrationIds(integrationsOptions);
  }

  const main = await findMainBundleWithCapability(capability);
  if (report != null) {
    report.mainBundle = main?.mainBundle ?? null;
    report.target = main == null ? null : `.vite/build/${main.mainBundle}`;
  }
  if (main == null) {
    const reason = "Could not find main bundle in .vite/build";
    console.warn(`WARN: ${reason} — skipping main-process UI patches`);
    recordMainProcessUiPatch(report, PATCH_STATUS_FAILED_REQUIRED, reason);
  }

  const iconAsset = await findIconAssetWithCapability(capability);
  if (report != null) {
    report.iconAsset = iconAsset;
  }
  if (iconAsset == null) {
    console.warn(
      "WARN: Could not find app icon asset in webview/assets — skipping icon patches",
    );
  }

  const mainSource = main?.source ?? null;
  const computerUseSupportPatching = mainSource != null &&
    await derivesLinuxComputerUseSupport(capability, mainSource);
  if (!computerUseSupportPatching) {
    console.warn(
      "WARN: Linux Computer Use patch contracts are incomplete — leaving Computer Use support unavailable",
    );
  }

  const assetContext = createMainBundleContext(iconAsset, {
    ...options,
    linuxTarget: baseContext.linux,
    computerUseSupportPatching,
  });
  assetContext.report = report;
  assetContext.generatedAppMutation = capability;

  if (main != null) {
    const source = mainSource;
    const { patchedSource, requiredCoreWarnings } = applyMainBundlePatches(source, assetContext, report);
    await replaceMainBundleWithCapability(capability, main, patchedSource);
    recordPatch(
      report,
      "main-process-ui",
      patchStatusFromChange(patchedSource !== source, requiredCoreWarnings, REQUIRED_UPSTREAM),
      requiredCoreWarnings[0] ?? null,
      {
        phase: "main-bundle",
        ciPolicy: REQUIRED_UPSTREAM,
        sourceKind: "core",
        ...(requiredCoreWarnings.length > 0 ? { warnings: [...requiredCoreWarnings] } : {}),
      },
    );
  }

  applyExtractedAppPatchDescriptors(
    extractedDir,
    patchDescriptors,
    assetContext,
    report,
    PHASE_EXTRACTED_APP_PRE_WEBVIEW,
  );

  await applyWebviewAssetPatchDescriptors(
    extractedDir,
    patchDescriptors,
    assetContext,
    report,
  );

  applyExtractedAppPatchDescriptors(
    extractedDir,
    patchDescriptors,
    assetContext,
    report,
    PHASE_EXTRACTED_APP_POST_WEBVIEW,
  );

  const desktopName = assetContext.desktopName ?? report?.desktopName ?? null;
  console.log("Patched Linux window, shell, and appearance behavior:", {
    target: main == null ? null : `.vite/build/${main.mainBundle}`,
    mainBundle: main?.mainBundle ?? null,
    iconAsset,
    desktopName,
  });
}

async function patchExtractedApp(extractedDir, options = {}) {
  const capability = await openGeneratedAppMutationRoot(extractedDir, {
    brokerPath:
      options.mutationBrokerPath ??
      process.env.CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE,
    verifiedPrivateRoot: options.verifiedPrivateRoot ?? false,
  });
  try {
    await patchExtractedAppWithCapability(extractedDir, options, capability);
  } finally {
    await capability.close();
  }
  return Object.freeze({ brokerDigest: capability.brokerDigest });
}

function allPatchPolicies(options = {}) {
  return [
    ...corePatchDescriptors(options).map(({ id, name, ciPolicy, phase, appliesTo }) => ({
      name: name ?? id,
      ciPolicy,
      phase,
      appliesTo,
    })),
    ...featurePatchDescriptors(featurePatchOptions(options)).map(({ id, name, ciPolicy, phase, appliesTo }) => ({
      name: name ?? id,
      ciPolicy,
      phase,
      appliesTo,
    })),
    ...CUSTOM_PATCH_POLICIES,
  ];
}

function requiredPatchNamesForProfile(profile, options = {}) {
  if (profile !== "official-dmg-build" && profile !== "upstream-build") {
    return [];
  }
  const linux = options.linuxTarget ?? detectLinuxTargetContext(options.linuxTargetOptions);
  const context = { linux, linuxTarget: linux, computerUseSupportPatching: true };
  return allPatchPolicies(options)
    .filter((patch) => patch.ciPolicy === REQUIRED_UPSTREAM)
    .filter((patch) => patch.appliesTo == null || patch.appliesTo(context) !== false)
    .map((patch) => patch.name);
}

function exportedMainBundlePatches() {
  return corePatchDescriptors().filter((patch) => patch.phase === "main-bundle");
}

function exportedWebviewAssetPatches() {
  return corePatchDescriptors().filter((patch) => patch.phase === "webview-asset");
}

function exportedComputerUseUiAssetPatches() {
  return exportedWebviewAssetPatches().filter((patch) =>
    patch.id.startsWith("linux-computer-use-"),
  );
}

module.exports = {
  CUSTOM_PATCH_POLICIES,
  OPTIONAL,
  OPT_IN,
  REQUIRED_OFFICIAL_DMG,
  REQUIRED_UPSTREAM,
  allPatchPolicies,
  corePatchDescriptors,
  createMainBundleContext,
  featurePatchDescriptors,
  patchExtractedApp,
  patchMainBundleSource,
  requiredPatchNamesForProfile,
};

Object.defineProperties(module.exports, {
  COMPUTER_USE_UI_ASSET_PATCHES: {
    enumerable: true,
    get: exportedComputerUseUiAssetPatches,
  },
  MAIN_BUNDLE_PATCHES: {
    enumerable: true,
    get: exportedMainBundlePatches,
  },
  WEBVIEW_ASSET_PATCHES: {
    enumerable: true,
    get: exportedWebviewAssetPatches,
  },
});
