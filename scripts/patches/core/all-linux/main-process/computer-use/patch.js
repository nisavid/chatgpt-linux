"use strict";

const {
  mainBundlePatch,
} = require("../../../../descriptor.js");
const {
  applyLinuxComputerUseAuthorityPatch,
  applyLinuxComputerUseAvatarCursorBridgePatch,
  applyLinuxComputerUseFeaturePatch,
  applyLinuxNativeDesktopAppsHandlerPatch,
  applyLinuxComputerUsePluginGatePatch,
} = require("../../../../impl/computer-use.js");

module.exports = [
  mainBundlePatch({
    id: "linux-computer-use-request-authority",
    phase: "main-bundle",
    order: 120,
    ciPolicy: "required-official-dmg",
    apply: applyLinuxComputerUseAuthorityPatch,
  }),
  mainBundlePatch({
    id: "linux-computer-use-avatar-cursor",
    phase: "main-bundle",
    order: 125,
    ciPolicy: "required-official-dmg",
    apply: applyLinuxComputerUseAvatarCursorBridgePatch,
  }),
  mainBundlePatch({
    id: "linux-computer-use-ui-feature",
    phase: "main-bundle",
    order: 130,
    ciPolicy: "required-official-dmg",
    apply: applyLinuxComputerUseFeaturePatch,
  }),
  mainBundlePatch({
    id: "linux-computer-use-plugin-gate",
    phase: "main-bundle",
    order: 140,
    ciPolicy: "optional",
    enabled: (context) => context.computerUseSupportPatching !== false,
    apply: applyLinuxComputerUsePluginGatePatch,
  }),
  mainBundlePatch({
    id: "linux-computer-use-native-desktop-apps",
    phase: "main-bundle",
    order: 150,
    ciPolicy: "required-official-dmg",
    apply: applyLinuxNativeDesktopAppsHandlerPatch,
  }),
];
