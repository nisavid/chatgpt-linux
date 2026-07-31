"use strict";

const UPSTREAM_DMG_RELEASE_PROFILE = Object.freeze({
  id: "upstream-release",
  corePatchProfile: "upstream-build",
  rejectEnabledIntegrationDrift: true,
});

module.exports = { UPSTREAM_DMG_RELEASE_PROFILE };
