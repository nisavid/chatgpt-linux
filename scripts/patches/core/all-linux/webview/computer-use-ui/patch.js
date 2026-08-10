"use strict";

const {
  webviewAssetPatch,
} = require("../../../../descriptor.js");
const {
  applyLinuxComputerUseDisableOrderingPatch,
  applyLinuxComputerUseHostPlatformPatch,
  applyLinuxComputerUseRendererAvailabilityPatch,
  applyLinuxComputerUseInstallFlowPatch,
  matchesLinuxComputerUseHostPlatformContract,
  matchesLinuxComputerUseDisableOrderingContract,
  matchesLinuxComputerUseInstallFlowContract,
} = require("../../../../impl/computer-use.js");

module.exports = [
  webviewAssetPatch({
    id: "linux-computer-use-ui-availability",
    phase: "webview-asset",
    order: 1100,
    ciPolicy: "optional",
    enabled: (context) => context.computerUseSupportPatching !== false,
    pattern: /^computer-use-settings-[^.]+\.js$/,
    missingDescription: "Computer Use availability bundle",
    skipDescription: "Linux Computer Use UI availability patch",
    apply: applyLinuxComputerUseRendererAvailabilityPatch,
  }),
  webviewAssetPatch({
    id: "linux-computer-use-disable-before-write",
    phase: "webview-asset",
    order: 1108,
    ciPolicy: "required-official-dmg",
    pattern: /^app-initial-[^.]+\.js$/,
    assetMatch: matchesLinuxComputerUseDisableOrderingContract,
    missingDescription: "current Computer Use plugin config mutation contract",
    skipDescription: "Linux Computer Use disable-before-write patch",
    apply: applyLinuxComputerUseDisableOrderingPatch,
  }),
  webviewAssetPatch({
    id: "linux-computer-use-host-platform",
    phase: "webview-asset",
    order: 1105,
    ciPolicy: "optional",
    enabled: (context) => context.computerUseSupportPatching !== false,
    pattern: /^app-initial-[^.]+\.js$/,
    assetMatch: matchesLinuxComputerUseHostPlatformContract,
    missingDescription: "current Computer Use host-platform app-initial contract",
    skipDescription: "Linux Computer Use host-platform patch",
    apply: applyLinuxComputerUseHostPlatformPatch,
  }),
  webviewAssetPatch({
    id: "linux-computer-use-install-flow",
    phase: "webview-asset",
    order: 1110,
    ciPolicy: "optional",
    enabled: (context) => context.computerUseSupportPatching !== false,
    pattern: /^app-initial-[^.]+\.js$/,
    assetMatch: matchesLinuxComputerUseInstallFlowContract,
    missingDescription: "current Computer Use install flow app-initial contract",
    skipDescription: "Linux Computer Use install flow patch",
    apply: applyLinuxComputerUseInstallFlowPatch,
  }),
];
