"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INTEGRATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const APP_CONFIG_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const LOCAL_INTEGRATIONS_DIR = "local";
const RESERVED_TOP_LEVEL_NAMES = new Set([
  LOCAL_INTEGRATIONS_DIR,
  "README.md",
  "integrations.example.json",
  "integrations.json",
  "features.example.json",
  "features.json",
]);
// Keep removed integration ids loadable so preserved update-builder configs still rebuild.
const LEGACY_INTEGRATION_ID_ALIASES = new Map([
  ["zed-opener", "open-target-discovery"],
]);

const RUNTIME_HOOK_DIRS = {
  env: { dir: "env.d", executable: false },
  prelaunch: { dir: "prelaunch.d", executable: true },
  electronArgs: { dir: "electron-args.d", executable: false },
  launcher: { dir: "launcher.d", executable: true },
  coldStart: { dir: "cold-start.d", executable: true },
  afterExit: { dir: "after-exit.d", executable: true },
};
const STAGED_INTEGRATION_MANIFEST_RELATIVE_PATH = ".codex-linux/port-integrations-staged.json";
const BUILD_INFO_RELATIVE_PATH = ".codex-linux/build-info.json";
const SUPPORTED_PACKAGE_FORMATS = new Set(["deb", "rpm", "pacman"]);
const PACKAGE_DEPENDENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+._:@()=<>~\/-]*$/;
const RPM_ELF_DEPENDENCY_SUFFIX = "%{codex_elf_suffix}";
const PACKAGE_PATH_COMPONENT_PATTERN = /^(?!-)(?!\.\.?$)[A-Za-z0-9._+@:-]+$/;
const PACMAN_RESERVED_PACKAGE_TARGETS = new Set([
  ".BUILDINFO",
  ".CHANGELOG",
  ".INSTALL",
  ".MTREE",
  ".PKGINFO",
]);

function defaultPortIntegrationsRoot() {
  return path.resolve(__dirname, "..", "..", "port-integrations");
}

function portIntegrationsRoot(options = {}) {
  if (options.integrationsRoot != null) {
    return path.resolve(options.integrationsRoot);
  }
  if (options.featuresRoot != null) {
    return path.resolve(options.featuresRoot);
  }
  if (process.env.CODEX_PORT_INTEGRATIONS_ROOT?.trim()) {
    return path.resolve(process.env.CODEX_PORT_INTEGRATIONS_ROOT.trim());
  }
  if (process.env.CODEX_LINUX_FEATURES_ROOT?.trim()) {
    return path.resolve(process.env.CODEX_LINUX_FEATURES_ROOT.trim());
  }
  return defaultPortIntegrationsRoot();
}

function portIntegrationsConfigPath(integrationsRoot, options = {}) {
  if (options.integrationsConfigPath != null && String(options.integrationsConfigPath).trim() !== "") {
    return path.resolve(options.integrationsConfigPath);
  }
  if (options.featuresConfigPath != null && String(options.featuresConfigPath).trim() !== "") {
    return path.resolve(options.featuresConfigPath);
  }
  if (process.env.CODEX_PORT_INTEGRATIONS_CONFIG?.trim()) {
    return path.resolve(process.env.CODEX_PORT_INTEGRATIONS_CONFIG.trim());
  }
  if (process.env.CODEX_LINUX_FEATURES_CONFIG?.trim()) {
    return path.resolve(process.env.CODEX_LINUX_FEATURES_CONFIG.trim());
  }
  const localConfig = path.join(integrationsRoot, "integrations.json");
  if (fs.existsSync(localConfig)) {
    return localConfig;
  }
  const legacyLocalConfig = path.join(integrationsRoot, "features.json");
  if (fs.existsSync(legacyLocalConfig)) {
    return legacyLocalConfig;
  }
  const legacyCheckoutConfig = legacyCheckoutPortIntegrationsConfigPath(integrationsRoot);
  if (legacyCheckoutConfig != null && fs.existsSync(legacyCheckoutConfig)) {
    return legacyCheckoutConfig;
  }
  const userConfig = isCheckoutPortIntegrationsRoot(integrationsRoot) ? null : portIntegrationsUserConfigPath();
  if (userConfig != null && fs.existsSync(userConfig)) {
    return userConfig;
  }
  const legacyUserConfig = isCheckoutPortIntegrationsRoot(integrationsRoot) ? null : legacyPortIntegrationsUserConfigPath();
  if (legacyUserConfig != null && fs.existsSync(legacyUserConfig)) {
    return legacyUserConfig;
  }
  const legacyExampleConfig = path.join(integrationsRoot, "features.example.json");
  if (fs.existsSync(legacyExampleConfig)) {
    return legacyExampleConfig;
  }
  return path.join(integrationsRoot, "integrations.example.json");
}

function portIntegrationsConfigAppId() {
  for (const value of [process.env.CODEX_APP_ID, process.env.CODEX_LINUX_APP_ID]) {
    const configured = value?.trim();
    if (configured && APP_CONFIG_ID_PATTERN.test(configured)) {
      return configured;
    }
  }
  return "codex-app";
}

function isCheckoutPortIntegrationsRoot(integrationsRoot) {
  const resolvedRoot = path.resolve(integrationsRoot);
  if (!["port-integrations", "linux-features"].includes(path.basename(resolvedRoot))) {
    return false;
  }
  const repoRoot = path.dirname(resolvedRoot);
  return fs.existsSync(path.join(repoRoot, ".git"));
}

function legacyCheckoutPortIntegrationsConfigPath(integrationsRoot) {
  const resolvedRoot = path.resolve(integrationsRoot);
  if (path.basename(resolvedRoot) !== "port-integrations") {
    return null;
  }
  const repoRoot = path.dirname(resolvedRoot);
  const legacyRoot = path.join(repoRoot, "linux-features");
  return path.join(legacyRoot, "features.json");
}

function portIntegrationsUserConfigPath() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  let configHome = null;
  if (xdgConfigHome && path.isAbsolute(xdgConfigHome)) {
    configHome = xdgConfigHome;
  } else if (process.env.HOME?.trim() && path.isAbsolute(process.env.HOME.trim())) {
    configHome = path.join(process.env.HOME.trim(), ".config");
  }
  if (configHome == null) {
    return null;
  }
  return path.join(configHome, portIntegrationsConfigAppId(), "port-integrations.json");
}

function legacyPortIntegrationsUserConfigPath() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  let configHome = null;
  if (xdgConfigHome && path.isAbsolute(xdgConfigHome)) {
    configHome = xdgConfigHome;
  } else if (process.env.HOME?.trim() && path.isAbsolute(process.env.HOME.trim())) {
    configHome = path.join(process.env.HOME.trim(), ".config");
  }
  if (configHome == null) {
    return null;
  }
  return path.join(configHome, portIntegrationsConfigAppId(), "linux-features.json");
}

function readJsonFile(filePath, label, options = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (options.strict === true) {
      throw new Error(`Could not read ${label} at ${filePath}: ${error.message}`);
    }
    console.warn(`WARN: Could not read ${label} at ${filePath}: ${error.message}`);
    return null;
  }
}

function readPortIntegrationsConfig(options = {}) {
  const integrationsRoot = portIntegrationsRoot(options);
  const configPath = portIntegrationsConfigPath(integrationsRoot, options);
  const strict = options.strictConfig === true;
  if (!fs.existsSync(configPath)) {
    if (strict) {
      throw new Error(`Could not read port integrations config at ${configPath}: file does not exist`);
    }
    return { config: null, configPath };
  }

  const config = readJsonFile(configPath, "port integrations config", { strict });
  if (config == null) {
    if (strict) {
      throw new Error(`port integrations config ${configPath} must be a JSON object`);
    }
    return { config: null, configPath };
  }
  if (typeof config !== "object" || Array.isArray(config)) {
    if (strict) {
      throw new Error(`port integrations config ${configPath} must be a JSON object`);
    }
    console.warn(`WARN: port integrations config ${configPath} must be a JSON object`);
    return { config: null, configPath };
  }
  return { config, configPath };
}

function assertIntegrationId(value, label) {
  if (typeof value !== "string" || !INTEGRATION_ID_PATTERN.test(value)) {
    throw new Error(`${label} must match ${INTEGRATION_ID_PATTERN}`);
  }
  return value;
}

function normalizeIntegrationIdList(value, label, integrationId) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`port integration '${integrationId}' ${label} must be an array`);
  }
  const seen = new Set();
  const result = [];
  for (const item of value) {
    assertIntegrationId(item, `port integration '${integrationId}' ${label} entry`);
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function normalizeEnabledIntegrationIds(value, sourcePath, options = {}) {
  if (!Array.isArray(value)) {
    if (options.strict === true) {
      throw new Error(`port integrations config ${sourcePath} must contain an enabled array`);
    }
    console.warn(`WARN: port integrations config ${sourcePath} must contain an enabled array`);
    return [];
  }

  const seen = new Set();
  const ids = [];
  for (const item of value) {
    if (typeof item !== "string" || !INTEGRATION_ID_PATTERN.test(item)) {
      if (options.strict === true) {
        throw new Error(`Invalid port integration id in ${sourcePath}: ${String(item)}`);
      }
      console.warn(`WARN: Invalid port integration id in ${sourcePath}: ${String(item)}`);
      continue;
    }
    const id = LEGACY_INTEGRATION_ID_ALIASES.get(item) ?? item;
    if (seen.has(id)) {
      if (options.strict === true) {
        throw new Error(`Duplicate port integration id in ${sourcePath}: ${item}`);
      }
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function enabledIntegrationIdsFromBuildInfo(appDir) {
  const buildInfoPath = path.join(path.resolve(appDir), BUILD_INFO_RELATIVE_PATH);
  let buildInfo;
  try {
    buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read packaged app build info at ${buildInfoPath}: ${error.message}`);
  }
  if (buildInfo == null || typeof buildInfo !== "object" || Array.isArray(buildInfo)) {
    throw new Error(`Packaged app build info at ${buildInfoPath} must be a JSON object`);
  }
  const enabled = buildInfo.portIntegrations?.enabled ?? buildInfo.linuxFeatures?.enabled;
  if (!Array.isArray(enabled)) {
    throw new Error(`Packaged app build info at ${buildInfoPath} must contain portIntegrations.enabled`);
  }

  const seen = new Set();
  const ids = [];
  for (const rawId of enabled) {
    const configuredId = assertIntegrationId(rawId, `port integration id in ${buildInfoPath}`);
    const id = LEGACY_INTEGRATION_ID_ALIASES.get(configuredId) ?? configuredId;
    if (seen.has(id)) {
      throw new Error(`Duplicate port integration id in ${buildInfoPath}: ${rawId}`);
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizePortIntegrationSettings(value, sourcePath) {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    console.warn(`WARN: port integrations config ${sourcePath} settings must be an object`);
    return {};
  }

  const settings = {};
  for (const [rawId, rawSettings] of Object.entries(value)) {
    if (typeof rawId !== "string" || !INTEGRATION_ID_PATTERN.test(rawId)) {
      console.warn(`WARN: Invalid port integration settings id in ${sourcePath}: ${String(rawId)}`);
      continue;
    }
    const id = LEGACY_INTEGRATION_ID_ALIASES.get(rawId) ?? rawId;
    if (rawSettings == null || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
      console.warn(`WARN: port integration '${rawId}' settings in ${sourcePath} must be an object`);
      continue;
    }
    settings[id] = rawSettings;
  }
  return settings;
}

function portIntegrationsConfig(options = {}) {
  const { config, configPath } = readPortIntegrationsConfig(options);
  if (config == null) {
    return { enabled: [], disabled: [], settings: {}, configPath };
  }
  return {
    enabled: normalizeEnabledIntegrationIds(
      config.enabled,
      configPath,
      { strict: options.strictConfig === true },
    ),
    disabled: config.disabled == null
      ? []
      : normalizeEnabledIntegrationIds(
        config.disabled,
        configPath,
        { strict: options.strictConfig === true },
      ),
    settings: normalizePortIntegrationSettings(config.settings, configPath),
    configPath,
  };
}

function enabledPortIntegrationIds(options = {}) {
  const integrationsRoot = portIntegrationsRoot(options);
  const config = portIntegrationsConfig({ ...options, integrationsRoot });
  const disabled = new Set(config.disabled);
  const integrationsById = portIntegrationManifestMap({ ...options, integrationsRoot });
  const seen = new Set();
  const ids = [];
  const addIntegration = (id) => {
    if (disabled.has(id) || seen.has(id) || !integrationsById.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  };

  for (const integration of integrationsById.values()) {
    if (integration.manifest.defaultEnabled === true) {
      addIntegration(integration.id);
    }
  }
  const missing = [];
  for (const id of config.enabled) {
    if (!integrationsById.has(id)) {
      missing.push(id);
    } else {
      addIntegration(id);
    }
  }
  if (options.strictConfig === true && missing.length > 0) {
    throw new Error(`Enabled port integration ids not found in this checkout: ${missing.join(", ")}`);
  }
  return ids;
}

function enabledPortIntegrationsConfig(options = {}) {
  const config = portIntegrationsConfig(options);
  const enabled = enabledPortIntegrationIds(options);
  const filteredSettings = {};
  for (const id of enabled) {
    if (Object.prototype.hasOwnProperty.call(config.settings, id)) {
      filteredSettings[id] = config.settings[id];
    }
  }
  const resolved = { enabled, disabled: config.disabled };
  if (Object.keys(filteredSettings).length > 0) {
    resolved.settings = filteredSettings;
  }
  return resolved;
}

function resolvedPortIntegrationsConfig(options = {}) {
  return enabledPortIntegrationsConfig(options);
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function integrationManifestCandidates(integrationsRoot) {
  if (!fs.existsSync(integrationsRoot)) {
    return [];
  }

  const candidates = [];
  for (const name of fs.readdirSync(integrationsRoot).sort()) {
    if (RESERVED_TOP_LEVEL_NAMES.has(name) || name.startsWith(".")) {
      continue;
    }
    const dir = path.join(integrationsRoot, name);
    if (isDirectory(dir) && fs.existsSync(path.join(dir, "integration.json"))) {
      candidates.push({ dir, manifestPath: path.join(dir, "integration.json"), origin: "repo" });
    }
  }

  const localRoot = path.join(integrationsRoot, LOCAL_INTEGRATIONS_DIR);
  if (isDirectory(localRoot)) {
    for (const name of fs.readdirSync(localRoot).sort()) {
      if (name.startsWith(".")) {
        continue;
      }
      const dir = path.join(localRoot, name);
      if (isDirectory(dir) && fs.existsSync(path.join(dir, "integration.json"))) {
        candidates.push({ dir, manifestPath: path.join(dir, "integration.json"), origin: "local" });
      }
    }
  }

  return candidates;
}

function normalizePortIntegrationManifest(integrationsRoot, candidate) {
  const manifest = readJsonFile(candidate.manifestPath, "port integration manifest");
  if (manifest == null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`port integration manifest ${candidate.manifestPath} must be a JSON object`);
  }

  const id = assertIntegrationId(manifest.id, `port integration id in ${candidate.manifestPath}`);
  const readmePath = path.join(candidate.dir, "README.md");
  if (!fs.existsSync(readmePath) || isDirectory(readmePath)) {
    throw new Error(`port integration '${id}' must include README.md next to integration.json`);
  }
  const relativeDir = path.relative(integrationsRoot, candidate.dir);
  return {
    id,
    dir: candidate.dir,
    manifestPath: candidate.manifestPath,
    readmePath,
    origin: candidate.origin,
    local: candidate.origin === "local",
    relativeDir,
    manifest: {
      ...manifest,
      defaultEnabled: manifest.defaultEnabled === true,
      requires: normalizeIntegrationIdList(manifest.requires, "requires", id),
      conflicts: normalizeIntegrationIdList(manifest.conflicts, "conflicts", id),
    },
  };
}

function discoverPortIntegrationManifests(options = {}) {
  const integrationsRoot = portIntegrationsRoot(options);
  const integrations = [];
  const seen = new Map();
  for (const candidate of integrationManifestCandidates(integrationsRoot)) {
    const integration = normalizePortIntegrationManifest(integrationsRoot, candidate);
    const previous = seen.get(integration.id);
    if (previous != null) {
      throw new Error(
        `Duplicate port integration id '${integration.id}' in ${integration.manifestPath} and ${previous.manifestPath}`,
      );
    }
    seen.set(integration.id, integration);
    integrations.push(integration);
  }
  return integrations.sort((left, right) => left.id.localeCompare(right.id));
}

function portIntegrationManifestMap(options = {}) {
  return new Map(discoverPortIntegrationManifests(options).map((integration) => [integration.id, integration]));
}

function loadPortIntegrationManifest(integrationsRoot, id, options = {}) {
  const integration = portIntegrationManifestMap({ ...options, integrationsRoot }).get(id);
  if (integration == null) {
    console.warn(`WARN: Enabled port integration '${id}' does not have integration.json`);
    return null;
  }
  return integration;
}

function validateEnabledIntegrationDependencies(integrations) {
  const enabled = new Set(integrations.map((integration) => integration.id));
  for (const integration of integrations) {
    for (const required of integration.manifest.requires) {
      if (!enabled.has(required)) {
        throw new Error(`port integration '${integration.id}' requires '${required}' to be enabled`);
      }
    }
    for (const conflict of integration.manifest.conflicts) {
      if (enabled.has(conflict)) {
        throw new Error(`port integration '${integration.id}' conflicts with '${conflict}'`);
      }
    }
  }
}

function loadEnabledPortIntegrations(options = {}) {
  const integrationsRoot = portIntegrationsRoot(options);
  const available = portIntegrationManifestMap({ ...options, integrationsRoot });
  const config = portIntegrationsConfig({ ...options, integrationsRoot });
  const enabled = options.enabledIntegrationIds ?? options.enabledFeatureIds ??
    enabledPortIntegrationIds({ ...options, integrationsRoot });
  const integrations = [];
  const missing = [];
  for (const id of enabled) {
    const integration = available.get(id);
    if (integration == null) {
      missing.push(id);
    } else {
      integrations.push({ ...integration, settings: config.settings[id] ?? {} });
    }
  }
  if (missing.length > 0) {
    throw new Error(`Enabled port integration ids not found in this checkout: ${missing.join(", ")}`);
  }
  validateEnabledIntegrationDependencies(integrations);
  return integrations;
}

function packageIntegrationOptions(appDir, options = {}) {
  const snapshotEnabled = enabledIntegrationIdsFromBuildInfo(appDir);
  const strictOptions = { ...options, strictConfig: true };
  const configuredEnabled = enabledPortIntegrationIds(strictOptions);
  if (
    snapshotEnabled.length !== configuredEnabled.length
    || snapshotEnabled.some((id, index) => id !== configuredEnabled[index])
  ) {
    throw new Error(
      [
        `Packaged app port integration snapshot does not match the current integration config: ${path.resolve(appDir)}`,
        `app snapshot: ${JSON.stringify(snapshotEnabled)}`,
        `current config: ${JSON.stringify(configuredEnabled)}`,
        "Rebuild the app with the current integration config before creating a native package.",
      ].join("\n"),
    );
  }
  return {
    ...strictOptions,
    enabledIntegrationIds: snapshotEnabled,
  };
}

function relativePathParts(relativePath) {
  return String(relativePath).split(/[\\/]+/).filter((part) => part.length > 0 && part !== ".");
}

function normalizeInstallRelativePath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
    throw new Error(`${label} must be a relative path`);
  }
  const parts = relativePathParts(relativePath);
  if (path.isAbsolute(relativePath) || parts.includes("..")) {
    throw new Error(`${label} must stay inside the install directory`);
  }
  if (parts.length === 0) {
    throw new Error(`${label} must not target the install directory root`);
  }
  return parts.join("/");
}

function resolveInstallRelativePath(installDir, relativePath, label) {
  const normalized = normalizeInstallRelativePath(relativePath, label);
  const resolved = path.resolve(installDir, normalized);
  const relative = path.relative(installDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the install directory`);
  }
  return { normalized, resolved };
}

function resolveIntegrationRelativePath(integration, relativePath, label, { mustExist = true } = {}) {
  if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
    throw new Error(`port integration '${integration.id}' has invalid ${label}`);
  }
  if (path.isAbsolute(relativePath) || relativePathParts(relativePath).includes("..")) {
    throw new Error(`port integration '${integration.id}' ${label} must stay inside the integration directory`);
  }
  const resolved = path.resolve(integration.dir, relativePath);
  const relative = path.relative(integration.dir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`port integration '${integration.id}' ${label} must stay inside the integration directory`);
  }
  if (mustExist && !fs.existsSync(resolved)) {
    throw new Error(`port integration '${integration.id}' ${label} not found: ${resolved}`);
  }
  return resolved;
}

function resolveIntegrationEntrypoint(integration, key) {
  const relativePath = integration.manifest.entrypoints?.[key];
  if (relativePath == null) {
    return null;
  }
  try {
    return resolveIntegrationRelativePath(integration, relativePath, `${key} entrypoint`);
  } catch (error) {
    console.warn(`WARN: ${error.message}`);
    return null;
  }
}

function loadIntegrationEntrypointModule(integration, key) {
  const entrypoint = resolveIntegrationEntrypoint(integration, key);
  if (entrypoint == null) {
    return null;
  }

  try {
    return {
      entrypoint,
      moduleExports: require(entrypoint),
    };
  } catch (error) {
    console.warn(`WARN: Could not load port integration '${integration.id}' ${key}: ${error.message}`);
    return null;
  }
}

function integrationContext(context, integration) {
  return { ...context, integration, feature: integration };
}

function prefixedIntegrationPatchId(integration, descriptorId) {
  return descriptorId.startsWith(`integration:${integration.id}`)
    ? descriptorId
    : `integration:${integration.id}:${descriptorId}`;
}

function wrapIntegrationPatchDescriptor(integration, descriptor, sourcePath, index, integrationIndex) {
  if (descriptor == null || typeof descriptor !== "object") {
    console.warn(`WARN: port integration '${integration.id}' patch descriptor ${index + 1} must be an object`);
    return null;
  }
  if (typeof descriptor.apply !== "function") {
    console.warn(`WARN: port integration '${integration.id}' patch descriptor ${index + 1} must export apply`);
    return null;
  }

  const descriptorId = descriptor.id ?? descriptor.name;
  if (typeof descriptorId !== "string" || descriptorId.length === 0) {
    console.warn(`WARN: port integration '${integration.id}' patch descriptor ${index + 1} must have id or name`);
    return null;
  }

  const wrappedId = prefixedIntegrationPatchId(integration, descriptorId);
  const wrapped = {
    ...descriptor,
    id: wrappedId,
    name: descriptor.name ?? wrappedId,
    ciPolicy: descriptor.ciPolicy ?? "optional",
    sourceKind: "integration",
    integrationId: integration.id,
    order: descriptor.order ?? 20_000 + integrationIndex * 100 + index * 10,
    sourcePath,
    apply: (target, context) => descriptor.apply(target, integrationContext(context, integration)),
  };

  if (typeof descriptor.appliesTo === "function") {
    wrapped.appliesTo = (context) => descriptor.appliesTo(integrationContext(context, integration));
  }
  if (typeof descriptor.enabled === "function") {
    wrapped.enabled = (context) => descriptor.enabled(integrationContext(context, integration));
  }
  if (typeof descriptor.assetMatch === "function") {
    wrapped.assetMatch = (source, assetName, context) =>
      descriptor.assetMatch(source, assetName, integrationContext(context, integration));
  }
  if (typeof descriptor.targetSummary === "function") {
    wrapped.targetSummary = (context) => descriptor.targetSummary(integrationContext(context, integration));
  }
  if (typeof descriptor.status === "function") {
    wrapped.status = (result, warnings, context) =>
      descriptor.status(result, warnings, integrationContext(context, integration));
  }

  return wrapped;
}

function integrationPatchDescriptorListFromExports(integration, moduleExports, sourcePath, integrationIndex) {
  const exported = moduleExports?.descriptors ??
    moduleExports;
  if (exported == null) {
    console.warn(`WARN: port integration '${integration.id}' patchDescriptors entrypoint must export descriptors`);
    return [];
  }

  const descriptors = Array.isArray(exported) ? exported : [exported];
  return descriptors
    .map((descriptor, index) =>
      wrapIntegrationPatchDescriptor(integration, descriptor, sourcePath, index, integrationIndex),
    )
    .filter(Boolean);
}

function loadPortIntegrationPatchDescriptors(options = {}) {
  const descriptors = [];
  for (const [integrationIndex, integration] of loadEnabledPortIntegrations(options).entries()) {
    const loaded = loadIntegrationEntrypointModule(integration, "patchDescriptors");
    if (loaded == null) {
      continue;
    }
    descriptors.push(
      ...integrationPatchDescriptorListFromExports(
        integration,
        loaded.moduleExports,
        loaded.entrypoint,
        integrationIndex,
      ),
    );
  }
  return descriptors;
}

function enabledPortIntegrationStageHooks(options = {}) {
  return loadEnabledPortIntegrations(options)
    .map((integration) => ({
      id: integration.id,
      path: resolveIntegrationEntrypoint(integration, "stageHook"),
    }))
    .filter((hook) => hook.path != null);
}

function disabledPortIntegrationCleanupHooks(options = {}) {
  const integrationsRoot = portIntegrationsRoot(options);
  const enabled = new Set(enabledPortIntegrationIds({ ...options, integrationsRoot }));
  return discoverPortIntegrationManifests({ ...options, integrationsRoot })
    .filter((integration) => !enabled.has(integration.id))
    .map((integration) => ({
      id: integration.id,
      path: resolveIntegrationEntrypoint(integration, "cleanupHook"),
    }))
    .filter((hook) => hook.path != null);
}

function normalizeEntryList(value, label, integration) {
  if (value == null) {
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry, index) => {
    if (typeof entry === "string") {
      return { source: resolveIntegrationRelativePath(integration, entry, `${label} ${index + 1}`) };
    }
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`port integration '${integration.id}' ${label} ${index + 1} must be a string or object`);
    }
    const source = resolveIntegrationRelativePath(integration, entry.source ?? entry.path, `${label} ${index + 1}`);
    const name = entry.name == null ? path.basename(source) : String(entry.name);
    if (name.length === 0 || path.isAbsolute(name) || relativePathParts(name).includes("..") || name.includes("/") || name.includes("\\")) {
      throw new Error(`port integration '${integration.id}' ${label} ${index + 1} has invalid name`);
    }
    return { ...entry, source, name };
  });
}

function normalizeInstallTarget(target, integrationId) {
  return normalizeInstallRelativePath(target, `port integration '${integrationId}' resource target`);
}

function parseFileMode(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid file mode: ${String(value)}; file mode must be a quoted octal string`);
  }
  const raw = value.trim();
  if (!/^[0-7]{3,4}$/.test(raw)) {
    throw new Error(`Invalid file mode: ${String(value)}; file mode must be a quoted octal string`);
  }
  return Number.parseInt(raw, 8);
}

function parsePackageResourceMode(value) {
  const mode = parseFileMode(value, 0o644);
  if ((mode & 0o7000) !== 0) {
    throw new Error(
      `Invalid package resource file mode: ${String(value)}; special permission bits are not allowed`,
    );
  }
  return mode;
}

function modeString(mode) {
  return mode == null ? null : mode.toString(8).padStart(4, "0");
}

function enabledPortIntegrationInstallPlan(options = {}) {
  const resources = [];
  const runtimeHooks = [];
  const installTargetOwners = new Map([
    [STAGED_INTEGRATION_MANIFEST_RELATIVE_PATH, "port integration staging framework"],
  ]);
  const claimInstallTarget = (target, owner) => {
    for (const [existingTarget, existingOwner] of installTargetOwners) {
      const duplicate = target === existingTarget;
      const overlap = duplicate
        || target.startsWith(`${existingTarget}/`)
        || existingTarget.startsWith(`${target}/`);
      if (overlap) {
        const kind = duplicate ? "Duplicate" : "Overlapping";
        throw new Error(`${kind} port integration install target '${target}': ${owner} conflicts with '${existingTarget}' from ${existingOwner}`);
      }
    }
    installTargetOwners.set(target, owner);
  };
  for (const integration of loadEnabledPortIntegrations(options)) {
    for (const [index, resource] of normalizeEntryList(integration.manifest.resources, "resource", integration).entries()) {
      const target = normalizeInstallTarget(resource.target, integration.id);
      claimInstallTarget(target, `resource ${index + 1} for integration '${integration.id}'`);
      resources.push({
        id: integration.id,
        source: resource.source,
        target,
        mode: resource.mode == null ? null : parseFileMode(resource.mode, 0o644),
        index,
      });
    }

    const hooks = integration.manifest.runtimeHooks ?? {};
    if (hooks != null && (typeof hooks !== "object" || Array.isArray(hooks))) {
      throw new Error(`port integration '${integration.id}' runtimeHooks must be an object`);
    }
    for (const [hookKey, hookSpec] of Object.entries(hooks ?? {})) {
      const runtimeHook = RUNTIME_HOOK_DIRS[hookKey];
      if (runtimeHook == null) {
        throw new Error(`port integration '${integration.id}' has unsupported runtime hook '${hookKey}'`);
      }
      for (const [index, entry] of normalizeEntryList(hookSpec, `runtimeHooks.${hookKey}`, integration).entries()) {
        const name = `${integration.id}-${entry.name ?? path.basename(entry.source)}`;
        const target = [".codex-linux", runtimeHook.dir, name].join("/");
        claimInstallTarget(target, `runtimeHooks.${hookKey} ${index + 1} for integration '${integration.id}'`);
        runtimeHooks.push({
          id: integration.id,
          key: hookKey,
          source: entry.source,
          name,
          mode: parseFileMode(entry.mode, runtimeHook.executable ? 0o755 : 0o644),
          dir: runtimeHook.dir,
          target,
          index,
        });
      }
    }
  }
  return { resources, runtimeHooks };
}

function chmodRecursive(target, mode) {
  const directory = isDirectory(target);
  const targetMode = directory
    ? mode |
      ((mode & 0o400) ? 0o100 : 0) |
      ((mode & 0o040) ? 0o010 : 0) |
      ((mode & 0o004) ? 0o001 : 0)
    : mode;
  fs.chmodSync(target, targetMode);
  if (!directory) {
    return;
  }
  for (const name of fs.readdirSync(target)) {
    chmodRecursive(path.join(target, name), mode);
  }
}

function pathStaysInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function assertNoSymbolicLinks(target, label) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not contain symbolic links`);
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const name of fs.readdirSync(target)) {
    assertNoSymbolicLinks(path.join(target, name), label);
  }
}

function assertNoSymbolicLinksIfPresent(target, label) {
  try {
    assertNoSymbolicLinks(target, label);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function assertNoInstallPathSymbolicLinks(installDir, relativePath, label) {
  let current = installDir;
  for (const part of relativePathParts(relativePath)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`${label} must not contain symbolic links`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

function assertInstallParentInside(installDir, target, label) {
  const parent = path.dirname(target);
  const relativeParent = path.relative(installDir, parent);
  assertInstallPathInsideIfPresent(installDir, relativeParent, label);
  fs.mkdirSync(parent, { recursive: true });
  const installRoot = fs.realpathSync(installDir);
  const realParent = fs.realpathSync(parent);
  if (!pathStaysInside(installRoot, realParent)) {
    throw new Error(`${label} must stay inside the install directory`);
  }
  if (relativeParent !== "" && !relativeParent.startsWith("..") && !path.isAbsolute(relativeParent)) {
    assertNoInstallPathSymbolicLinks(installDir, relativeParent, label);
  }
}

function assertInstallPathInsideIfPresent(installDir, relativePath, label) {
  fs.mkdirSync(installDir, { recursive: true });
  const installRoot = fs.realpathSync(installDir);
  const parts = relativePathParts(relativePath);
  for (let index = parts.length; index >= 0; index -= 1) {
    const candidate = index === 0
      ? installDir
      : path.join(installDir, ...parts.slice(0, index));
    try {
      const realCandidate = fs.realpathSync(candidate);
      if (!pathStaysInside(installRoot, realCandidate)) {
        throw new Error(`${label} must stay inside the install directory`);
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  assertNoInstallPathSymbolicLinks(installDir, relativePath, label);
}

function installRelativeDirectoryExists(installDir, relativePath, label) {
  const { normalized, resolved } = resolveInstallRelativePath(installDir, relativePath, label);
  assertInstallPathInsideIfPresent(installDir, normalized, label);
  try {
    return fs.lstatSync(resolved).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function copyInstallFile(installDir, source, target, mode, labels = {}) {
  const sourceLabel = labels.source ?? "port integration source";
  const targetLabel = labels.target ?? "port integration target";
  assertNoSymbolicLinks(source, sourceLabel);
  assertInstallParentInside(installDir, target, targetLabel);
  assertNoSymbolicLinksIfPresent(target, targetLabel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  if (mode != null) {
    chmodRecursive(target, mode);
  }
}

function stagedManifestPath(installDir) {
  return path.join(installDir, STAGED_INTEGRATION_MANIFEST_RELATIVE_PATH);
}

function stagedArtifactEntries(manifest) {
  if (manifest == null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [];
  }
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  const runtimeHooks = Array.isArray(manifest.runtimeHooks) ? manifest.runtimeHooks : [];
  return [...resources, ...runtimeHooks].filter((entry) => entry != null && typeof entry === "object");
}

function readStagedIntegrationManifest(installDir) {
  const manifestPath = stagedManifestPath(installDir);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.warn(`WARN: Could not read port integration staged manifest at ${manifestPath}: ${error.message}`);
    return null;
  }
}

function writeStagedIntegrationManifest(installDir, plan) {
  const manifestPath = stagedManifestPath(installDir);
  const manifest = {
    version: 1,
    resources: plan.resources.map((resource) => ({
      id: resource.id,
      type: "resource",
      target: resource.target,
      mode: modeString(resource.mode),
    })),
    runtimeHooks: plan.runtimeHooks.map((hook) => ({
      id: hook.id,
      type: "runtimeHook",
      key: hook.key,
      target: hook.target,
      mode: modeString(hook.mode),
    })),
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function removeInstallRelativePath(installDir, relativePath) {
  const { normalized, resolved } = resolveInstallRelativePath(
    installDir,
    relativePath,
    "port integration staged artifact target",
  );
  if (normalized === STAGED_INTEGRATION_MANIFEST_RELATIVE_PATH) {
    return;
  }
  assertInstallPathInsideIfPresent(
    installDir,
    normalized,
    "port integration staged artifact target",
  );
  fs.rmSync(resolved, { recursive: true, force: true });
}

function removePreviouslyStagedArtifacts(installDir, manifest) {
  for (const entry of stagedArtifactEntries(manifest)) {
    if (typeof entry.target !== "string") {
      continue;
    }
    removeInstallRelativePath(installDir, entry.target);
  }
}

function removeLegacyDeclarativeRuntimeHooks(installDir, options = {}) {
  const integrationIds = discoverPortIntegrationManifests(options).map((integration) => integration.id);
  if (integrationIds.length === 0) {
    return;
  }
  for (const runtimeHook of Object.values(RUNTIME_HOOK_DIRS)) {
    const hookDirRelative = [".codex-linux", runtimeHook.dir].join("/");
    const hookDir = path.join(installDir, hookDirRelative);
    if (!installRelativeDirectoryExists(installDir, hookDirRelative, "port integration runtime hook directory")) {
      continue;
    }
    for (const name of fs.readdirSync(hookDir)) {
      if (integrationIds.some((id) => name.startsWith(`${id}-`))) {
        removeInstallRelativePath(installDir, path.join(hookDirRelative, name));
      }
    }
  }
}

function stagedPortIntegrationFiles(appDir) {
  const installDir = path.resolve(appDir);
  return stagedArtifactEntries(readStagedIntegrationManifest(installDir))
    .filter((entry) => typeof entry.target === "string" && typeof entry.mode === "string")
    .map((entry) => ({
      id: entry.id ?? null,
      type: entry.type ?? null,
      key: entry.key ?? null,
      target: normalizeInstallRelativePath(entry.target, "port integration staged artifact target"),
      mode: entry.mode,
    }));
}

function stageEnabledPortIntegrationInstall(appDir, options = {}) {
  const installDir = path.resolve(appDir);
  const plan = enabledPortIntegrationInstallPlan(options);
  const previousManifest = readStagedIntegrationManifest(installDir);
  if (previousManifest == null) {
    removeLegacyDeclarativeRuntimeHooks(installDir, options);
  } else {
    removePreviouslyStagedArtifacts(installDir, previousManifest);
  }
  for (const resource of plan.resources) {
    copyInstallFile(installDir, resource.source, path.join(installDir, resource.target), resource.mode);
    console.error(`Staged port integration resource: ${resource.id} -> ${resource.target}`);
  }
  for (const hook of plan.runtimeHooks) {
    const target = path.join(installDir, hook.target);
    copyInstallFile(installDir, hook.source, target, hook.mode);
    console.error(`Staged port integration ${hook.key} hook: ${hook.id} -> ${path.relative(installDir, target)}`);
  }
  writeStagedIntegrationManifest(installDir, plan);
  return plan;
}

function enabledPortIntegrationPackageHooks(options = {}) {
  const packageFormat = options.packageFormat ?? null;
  const selectedOptions = options.appDir == null
    ? options
    : packageIntegrationOptions(options.appDir, options);
  const hooks = [];
  for (const integration of loadEnabledPortIntegrations(selectedOptions)) {
    for (const [index, entry] of normalizeEntryList(integration.manifest.packageHooks, "packageHook", integration).entries()) {
      const formats = entry.formats == null
        ? []
        : normalizeIntegrationIdList(entry.formats, "packageHook formats", integration.id);
      if (packageFormat != null && formats.length > 0 && !formats.includes(packageFormat)) {
        continue;
      }
      hooks.push({
        id: integration.id,
        path: entry.source,
        formats,
        index,
      });
    }
  }
  return hooks;
}

function normalizePackageFormat(value, label = "package format") {
  if (typeof value !== "string" || !SUPPORTED_PACKAGE_FORMATS.has(value)) {
    throw new Error(`Unsupported ${label} '${String(value)}'`);
  }
  return value;
}

function normalizePackageFormats(value, integrationId, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`port integration '${integrationId}' ${label} formats must be an array`);
  }
  const formats = [];
  for (const rawFormat of value) {
    const format = normalizePackageFormat(rawFormat, `package format for port integration '${integrationId}'`);
    if (!formats.includes(format)) {
      formats.push(format);
    }
  }
  return formats.sort();
}

function normalizePackageTarget(value, integrationId) {
  const label = `port integration '${integrationId}' package resource target`;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a relative path inside the package root`);
  }
  const parts = relativePathParts(value);
  if (path.isAbsolute(value) || parts.includes("..")) {
    throw new Error(`${label} must stay inside the package root`);
  }
  if (parts.length === 0) {
    throw new Error(`${label} must not target the package root`);
  }
  for (const part of parts) {
    if (!PACKAGE_PATH_COMPONENT_PATTERN.test(part)) {
      throw new Error(`${label} contains an unsafe package path component: ${JSON.stringify(part)}`);
    }
  }
  return parts.join("/");
}

function assertNoSymbolicLinkAncestors(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the integration directory`);
  }
  let current = root;
  for (const part of relativePathParts(relative)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links`);
    }
  }
}

function normalizePackageDependencies(integration) {
  const value = integration.manifest.packageDependencies;
  if (value == null) {
    return new Map();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`port integration '${integration.id}' packageDependencies must be an object`);
  }

  const dependencies = new Map();
  for (const [rawFormat, entries] of Object.entries(value)) {
    const format = normalizePackageFormat(
      rawFormat,
      `package format in port integration '${integration.id}' packageDependencies`,
    );
    if (!Array.isArray(entries)) {
      throw new Error(`port integration '${integration.id}' dependencies for ${format} must be an array`);
    }
    const normalized = [];
    for (const entry of entries) {
      const dependencyToken = typeof entry === "string"
        && format === "rpm"
        && entry.endsWith(RPM_ELF_DEPENDENCY_SUFFIX)
        ? entry.slice(0, -RPM_ELF_DEPENDENCY_SUFFIX.length)
        : entry;
      if (
        typeof entry !== "string"
        || !PACKAGE_DEPENDENCY_PATTERN.test(dependencyToken)
      ) {
        throw new Error(`port integration '${integration.id}' has invalid ${format} package dependency '${String(entry)}'`);
      }
      if (!normalized.includes(entry)) {
        normalized.push(entry);
      }
    }
    dependencies.set(format, normalized.sort());
  }
  return dependencies;
}

function enabledPortIntegrationPackagePlan(options = {}) {
  const packageFormat = normalizePackageFormat(options.packageFormat);
  const selectedOptions = options.appDir == null
    ? options
    : packageIntegrationOptions(options.appDir, options);
  const resources = [];
  const dependencies = [];
  const targetOwners = new Map();

  for (const integration of loadEnabledPortIntegrations(selectedOptions)) {
    const integrationDependencies = normalizePackageDependencies(integration);
    dependencies.push(...(integrationDependencies.get(packageFormat) ?? []));

    const entries = integration.manifest.packageResources;
    if (entries == null) {
      continue;
    }
    if (!Array.isArray(entries)) {
      throw new Error(`port integration '${integration.id}' packageResources must be an array`);
    }
    for (const [index, entry] of entries.entries()) {
      if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`port integration '${integration.id}' package resource ${index + 1} must be an object`);
      }
      const source = resolveIntegrationRelativePath(
        integration,
        entry.source ?? entry.path,
        `package resource ${index + 1}`,
      );
      assertNoSymbolicLinkAncestors(
        integration.dir,
        source,
        `port integration '${integration.id}' package resource ${index + 1}`,
      );
      if (!fs.lstatSync(source).isFile()) {
        throw new Error(
          `port integration '${integration.id}' package resource ${index + 1} source must be a regular file`,
        );
      }
      const target = normalizePackageTarget(entry.target, integration.id);
      const formats = normalizePackageFormats(entry.formats, integration.id, `package resource ${index + 1}`);
      if (formats.length > 0 && !formats.includes(packageFormat)) {
        continue;
      }
      if (
        packageFormat === "deb"
        && (target === "DEBIAN" || target.startsWith("DEBIAN/"))
      ) {
        throw new Error(
          `port integration '${integration.id}' package resource target '${target}' uses the reserved Debian control namespace`,
        );
      }
      const targetRoot = target.split("/", 1)[0];
      if (
        packageFormat === "pacman"
        && PACMAN_RESERVED_PACKAGE_TARGETS.has(targetRoot)
      ) {
        throw new Error(
          `port integration '${integration.id}' package resource target '${target}' uses a reserved pacman package namespace`,
        );
      }
      for (const [existingTarget, previousOwner] of targetOwners) {
        const duplicate = target === existingTarget;
        const overlap = duplicate
          || target.startsWith(`${existingTarget}/`)
          || existingTarget.startsWith(`${target}/`);
        if (overlap) {
          const kind = duplicate ? "Duplicate" : "Overlapping";
          throw new Error(
            `${kind} port integration package target '${target}': integration '${integration.id}' conflicts with '${existingTarget}' from ${previousOwner}`,
          );
        }
      }
      targetOwners.set(target, `integration '${integration.id}'`);
      resources.push({
        id: integration.id,
        source,
        target,
        mode: parsePackageResourceMode(entry.mode),
        formats,
        index,
      });
    }
  }

  resources.sort((left, right) => left.target.localeCompare(right.target));
  return {
    resources,
    dependencies: [...new Set(dependencies)].sort(),
  };
}

function enabledPortIntegrationPackageDependencies(options = {}) {
  return enabledPortIntegrationPackagePlan(options).dependencies;
}

function enabledPortIntegrationPackageFiles(options = {}) {
  return enabledPortIntegrationPackagePlan(options).resources.map((resource) => `/${resource.target}`);
}

function assertPackageResourcesOutsideApp(packageRoot, appDir, plan) {
  const root = path.resolve(packageRoot);
  const app = path.resolve(appDir);
  const appRelative = path.relative(root, app).split(path.sep).join("/");
  if (
    appRelative === ""
    || appRelative === ".."
    || appRelative.startsWith("../")
    || path.isAbsolute(appRelative)
  ) {
    throw new Error(`Packaged app directory must stay inside the package root: ${app}`);
  }
  for (const resource of plan.resources) {
    if (
      resource.target === appRelative
      || resource.target.startsWith(`${appRelative}/`)
      || appRelative.startsWith(`${resource.target}/`)
    ) {
      throw new Error(
        `port integration package resource target must stay outside the packaged app directory: ${resource.target}`,
      );
    }
  }
}

function stageEnabledPortIntegrationPackageResources(packageRoot, options = {}) {
  const installDir = path.resolve(packageRoot);
  const plan = enabledPortIntegrationPackagePlan(options);
  if (options.appDir != null) {
    assertPackageResourcesOutsideApp(installDir, options.appDir, plan);
  }
  fs.mkdirSync(installDir, { recursive: true });
  for (const resource of plan.resources) {
    const targetPath = path.join(installDir, resource.target);
    if (fs.lstatSync(targetPath, { throwIfNoEntry: false }) != null) {
      throw new Error(
        `port integration package target conflicts with existing package payload: ${resource.target}`,
      );
    }
    try {
      copyInstallFile(
        installDir,
        resource.source,
        targetPath,
        resource.mode,
        {
          source: "port integration package source",
          target: "port integration package target",
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("inside the install directory")) {
        throw new Error(error.message.replace("inside the install directory", "inside the package root"));
      }
      throw error;
    }
    console.error(`Staged port integration package resource: ${resource.id} -> ${resource.target}`);
  }
  return plan;
}

function restoreEnabledPortIntegrationPackageResourcePermissions(packageRoot, options = {}) {
  const root = path.resolve(packageRoot);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`port integration package root must not be a symbolic link: ${root}`);
  }
  const realRoot = fs.realpathSync(root);
  const plan = enabledPortIntegrationPackagePlan(options);
  if (options.appDir != null) {
    assertPackageResourcesOutsideApp(root, options.appDir, plan);
  }
  for (const resource of plan.resources) {
    const targetPath = path.join(root, resource.target);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`port integration package resource is missing from payload: ${resource.target}`);
    }
    assertNoSymbolicLinkAncestors(
      root,
      targetPath,
      `port integration package resource '${resource.target}'`,
    );
    assertNoSymbolicLinks(
      targetPath,
      `port integration package resource '${resource.target}'`,
    );
    const realTarget = fs.realpathSync(targetPath);
    const relative = path.relative(realRoot, realTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `port integration package resource must stay inside the package root: ${resource.target}`,
      );
    }
    chmodRecursive(targetPath, resource.mode);
  }
  return plan;
}

function integrationsJsonSummary(options = {}) {
  return discoverPortIntegrationManifests(options).map((integration) => ({
    id: integration.id,
    title: integration.manifest.title ?? integration.manifest.name ?? integration.id,
    name: integration.manifest.name ?? integration.manifest.title ?? integration.id,
    description: integration.manifest.description ?? "",
    origin: integration.origin,
    local: integration.local,
    relativeDir: integration.relativeDir,
    requires: integration.manifest.requires,
    conflicts: integration.manifest.conflicts,
    defaultEnabled: integration.manifest.defaultEnabled === true,
    setup: integration.manifest.setup ?? null,
    cleanup: integration.manifest.cleanup ?? null,
  }));
}

function main() {
  const command = process.argv[2];
  if (command === "--stage-hooks") {
    for (const hook of enabledPortIntegrationStageHooks()) {
      process.stdout.write(`${hook.id}\t${hook.path}\n`);
    }
    return;
  }
  if (command === "--cleanup-hooks") {
    for (const hook of disabledPortIntegrationCleanupHooks()) {
      process.stdout.write(`${hook.id}\t${hook.path}\n`);
    }
    return;
  }
  if (command === "--package-hooks") {
    const packageFormat = process.argv[3] ?? "";
    const appDir = process.argv[4] ?? process.env.PACKAGE_APP_DIR;
    if (!appDir) {
      console.error("Usage: port-integrations.js --package-hooks <format> <app-dir>");
      process.exit(1);
    }
    for (const hook of enabledPortIntegrationPackageHooks({ packageFormat, appDir })) {
      process.stdout.write(`${hook.id}\t${hook.path}\n`);
    }
    return;
  }
  if (command === "--stage-package-resources") {
    const packageFormat = process.argv[3] ?? "";
    const packageRoot = process.argv[4] ?? process.env.PACKAGE_ROOT;
    const appDir = process.argv[5] ?? process.env.PACKAGE_APP_DIR;
    if (!packageRoot || !appDir) {
      console.error("Usage: port-integrations.js --stage-package-resources <format> <package-root> <app-dir>");
      process.exit(1);
    }
    stageEnabledPortIntegrationPackageResources(packageRoot, { packageFormat, appDir });
    return;
  }
  if (command === "--package-dependencies") {
    const packageFormat = process.argv[3] ?? "";
    const appDir = process.argv[4] ?? process.env.PACKAGE_APP_DIR;
    if (!appDir) {
      console.error("Usage: port-integrations.js --package-dependencies <format> <app-dir>");
      process.exit(1);
    }
    for (
      const dependency of enabledPortIntegrationPackageDependencies(
        { packageFormat, appDir },
      )
    ) {
      process.stdout.write(`${dependency}\n`);
    }
    return;
  }
  if (command === "--package-files") {
    const packageFormat = process.argv[3] ?? "";
    const appDir = process.argv[4] ?? process.env.PACKAGE_APP_DIR;
    if (!appDir) {
      console.error("Usage: port-integrations.js --package-files <format> <app-dir>");
      process.exit(1);
    }
    for (
      const file of enabledPortIntegrationPackageFiles(
        { packageFormat, appDir },
      )
    ) {
      process.stdout.write(`${file}\n`);
    }
    return;
  }
  if (command === "--restore-package-resource-permissions") {
    const packageFormat = process.argv[3] ?? "";
    const packageRoot = process.argv[4] ?? process.env.PACKAGE_ROOT;
    const appDir = process.argv[5] ?? process.env.PACKAGE_APP_DIR;
    if (!packageRoot || !appDir) {
      console.error("Usage: port-integrations.js --restore-package-resource-permissions <format> <package-root> <app-dir>");
      process.exit(1);
    }
    restoreEnabledPortIntegrationPackageResourcePermissions(
      packageRoot,
      { packageFormat, appDir },
    );
    return;
  }
  if (command === "--stage-install") {
    const appDir = process.argv[3] ?? process.env.INSTALL_DIR;
    if (!appDir) {
      console.error("Usage: port-integrations.js --stage-install <install-dir>");
      process.exit(1);
    }
    stageEnabledPortIntegrationInstall(appDir);
    return;
  }
  if (command === "--staged-files-json") {
    const appDir = process.argv[3] ?? process.env.INSTALL_DIR;
    if (!appDir) {
      console.error("Usage: port-integrations.js --staged-files-json <install-dir>");
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify(stagedPortIntegrationFiles(appDir), null, 2)}\n`);
    return;
  }
  if (command === "--enabled") {
    for (const id of enabledPortIntegrationIds()) {
      process.stdout.write(`${id}\n`);
    }
    return;
  }
  if (command === "--integrations-json" || command === "--features-json") {
    process.stdout.write(`${JSON.stringify(integrationsJsonSummary(), null, 2)}\n`);
    return;
  }
  if (command === "--resolved-config-json") {
    process.stdout.write(`${JSON.stringify(resolvedPortIntegrationsConfig(), null, 2)}\n`);
    return;
  }
  if (command === "--integrations-root" || command === "--features-root") {
    process.stdout.write(`${portIntegrationsRoot()}\n`);
    return;
  }
  console.error("Usage: port-integrations.js --enabled | --integrations-json | --integrations-root | --stage-install <install-dir> | --staged-files-json <install-dir> | --stage-hooks | --cleanup-hooks | --package-hooks <format> <app-dir> | --stage-package-resources <format> <package-root> <app-dir> | --restore-package-resource-permissions <format> <package-root> <app-dir> | --package-dependencies <format> <app-dir> | --package-files <format> <app-dir>");
  process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  disabledPortIntegrationCleanupHooks,
  discoverPortIntegrationManifests,
  enabledPortIntegrationsConfig,
  enabledPortIntegrationIds,
  enabledIntegrationIdsFromBuildInfo,
  enabledPortIntegrationInstallPlan,
  enabledPortIntegrationPackageDependencies,
  enabledPortIntegrationPackageFiles,
  enabledPortIntegrationPackageHooks,
  enabledPortIntegrationPackagePlan,
  enabledPortIntegrationStageHooks,
  integrationsJsonSummary,
  loadEnabledPortIntegrations,
  loadPortIntegrationPatchDescriptors,
  portIntegrationManifestMap,
  portIntegrationsConfigPath,
  portIntegrationsRoot,
  portIntegrationsUserConfigPath,
  resolvedPortIntegrationsConfig,
  resolveIntegrationEntrypoint,
  restoreEnabledPortIntegrationPackageResourcePermissions,
  stageEnabledPortIntegrationInstall,
  stageEnabledPortIntegrationPackageResources,
  stagedPortIntegrationFiles,
};
