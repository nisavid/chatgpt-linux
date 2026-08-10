"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { GeneratedAppIntegrityError } = require("./generated-app-mutation-client.js");
const { findExportedAlias } = require("./minified-js.js");

const MAIN_BUILD_COMPONENTS = [Buffer.from(".vite"), Buffer.from("build")];
const WEBVIEW_ASSET_COMPONENTS = [Buffer.from("webview"), Buffer.from("assets")];
const REGULAR_FILE_TYPE = 0o100000;
const FILE_TYPE_MASK = 0o170000;
const OFFICIAL_ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAIN_BUNDLE_NAME_PATTERN = /^main(?:-[A-Za-z0-9_-]+)?\.js$/;
const ICON_ASSET_NAME_PATTERN = /^app-[A-Za-z0-9_-]+\.png$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const originalAssetBytes = Symbol("originalAssetBytes");

function copyComponents(components) {
  return components.map((component) => Buffer.from(component));
}

function validMetadata(metadata) {
  return metadata != null &&
    typeof metadata === "object" &&
    Number.isInteger(metadata.mode) &&
    metadata.mode >= 0 &&
    metadata.mode <= 0xffff_ffff;
}

function isRegularFileMetadata(metadata) {
  return validMetadata(metadata) && (metadata.mode & FILE_TYPE_MASK) === REGULAR_FILE_TYPE;
}

function invalidCapabilityResult(reason, operation, code = "protocol", cause) {
  return new GeneratedAppIntegrityError(reason, { code, operation, cause });
}

function officialAssetEntry(entry) {
  if (!Buffer.isBuffer(entry?.name) || !validMetadata(entry?.metadata)) {
    throw invalidCapabilityResult("invalid asset directory entry", "list");
  }
  if (!isRegularFileMetadata(entry.metadata)) {
    return null;
  }
  const name = entry.name.toString("ascii");
  if (!Buffer.from(name, "ascii").equals(entry.name) || !OFFICIAL_ASSET_NAME_PATTERN.test(name)) {
    return null;
  }
  return Object.freeze({ name, nameBytes: Buffer.from(entry.name) });
}

async function listOfficialAssetEntries(capability, directoryComponents) {
  const listed = await capability.list(copyComponents(directoryComponents));
  if (!Array.isArray(listed)) {
    throw invalidCapabilityResult("invalid asset directory listing", "list");
  }
  return listed
    .map(officialAssetEntry)
    .filter((entry) => entry != null)
    .sort((left, right) => Buffer.compare(left.nameBytes, right.nameBytes));
}

function decodeUtf8Source(content) {
  if (!Buffer.isBuffer(content)) {
    throw invalidCapabilityResult("asset read returned non-byte content", "read");
  }
  try {
    return utf8Decoder.decode(content);
  } catch (error) {
    throw invalidCapabilityResult("asset source is not valid UTF-8", "read", "integrity", error);
  }
}

async function readUtf8AssetSource(capability, directoryComponents, asset) {
  const read = await capability.read([
    ...copyComponents(directoryComponents),
    Buffer.from(asset.nameBytes),
  ]);
  if (read == null || typeof read !== "object" || !validMetadata(read.metadata)) {
    throw invalidCapabilityResult("asset read returned invalid metadata", "read");
  }
  if (!isRegularFileMetadata(read.metadata)) {
    throw invalidCapabilityResult("asset read target is not a regular file", "read", "integrity");
  }
  if (!Buffer.isBuffer(read.operationId) || read.operationId.length !== 16) {
    throw invalidCapabilityResult("asset read returned an invalid identity token", "read");
  }
  const source = decodeUtf8Source(read.content);
  return Object.freeze({
    assetName: asset.name,
    operationId: Buffer.from(read.operationId),
    [originalAssetBytes]: Buffer.from(read.content),
    source,
  });
}

async function findMainBundleWithCapability(capability) {
  const entries = await listOfficialAssetEntries(capability, MAIN_BUILD_COMPONENTS);
  const main = entries.find(({ name }) => MAIN_BUNDLE_NAME_PATTERN.test(name));
  if (main == null) {
    return null;
  }
  const read = await readUtf8AssetSource(capability, MAIN_BUILD_COMPONENTS, main);
  return Object.freeze({
    mainBundle: read.assetName,
    operationId: read.operationId,
    [originalAssetBytes]: read[originalAssetBytes],
    source: read.source,
  });
}

async function replaceMainBundleWithCapability(capability, main, patchedSource) {
  if (
    main == null ||
    typeof main.mainBundle !== "string" ||
    !MAIN_BUNDLE_NAME_PATTERN.test(main.mainBundle) ||
    !Buffer.isBuffer(main.operationId) ||
    main.operationId.length !== 16 ||
    typeof main.source !== "string" ||
    typeof patchedSource !== "string"
  ) {
    throw new TypeError("Invalid capability-backed main bundle replacement");
  }
  const currentBytes = Buffer.isBuffer(main[originalAssetBytes])
    ? main[originalAssetBytes]
    : Buffer.from(main.source, "utf8");
  const replacement = Buffer.from(patchedSource, "utf8");
  if (replacement.equals(currentBytes)) {
    return false;
  }
  await capability.replace(
    [...copyComponents(MAIN_BUILD_COMPONENTS), Buffer.from(main.mainBundle, "ascii")],
    Buffer.from(main.operationId),
    replacement,
  );
  return true;
}

async function findIconAssetWithCapability(capability) {
  const entries = await listOfficialAssetEntries(capability, WEBVIEW_ASSET_COMPONENTS);
  return entries.find(({ name }) => ICON_ASSET_NAME_PATTERN.test(name))?.name ?? null;
}

async function readMatchingWebviewAssetSourcesWithCapability(capability, filenamePattern) {
  if (!(filenamePattern instanceof RegExp)) {
    throw new TypeError("Webview asset filename pattern must be a RegExp");
  }
  const entries = (await listOfficialAssetEntries(capability, WEBVIEW_ASSET_COMPONENTS))
    .filter(({ name }) => regexpTest(filenamePattern, name));
  const sources = [];
  for (const asset of entries) {
    sources.push(await readUtf8AssetSource(capability, WEBVIEW_ASSET_COMPONENTS, asset));
  }
  return Object.freeze(sources);
}

function replacementBytes(patchedSource, assetName) {
  if (typeof patchedSource !== "string") {
    throw new TypeError(`Asset patch for ${assetName} must return a string`);
  }
  return Buffer.from(patchedSource, "utf8");
}

async function replaceWebviewAssetSourceWithCapability(capability, asset, replacement) {
  await capability.replace(
    [...copyComponents(WEBVIEW_ASSET_COMPONENTS), Buffer.from(asset.assetName, "ascii")],
    Buffer.from(asset.operationId),
    replacement,
  );
}

async function patchAssetFilesWithCapability(
  capability,
  filenamePattern,
  patchFn,
  missingWarnMessage,
) {
  const sources = await readMatchingWebviewAssetSourcesWithCapability(capability, filenamePattern);
  if (sources.length === 0) {
    console.warn(missingWarnMessage);
    return { matched: 0, changed: 0 };
  }

  const pendingReplacements = [];
  for (const asset of sources) {
    const replacement = replacementBytes(await patchFn(asset.source), asset.assetName);
    if (!replacement.equals(asset[originalAssetBytes])) {
      pendingReplacements.push({ asset, replacement });
    }
  }
  for (const { asset, replacement } of pendingReplacements) {
    await replaceWebviewAssetSourceWithCapability(capability, asset, replacement);
  }
  return { matched: sources.length, changed: pendingReplacements.length };
}

async function patchUniqueAssetFileWithCapability(
  capability,
  filenamePattern,
  assetMatch,
  patchFn,
  missingWarnMessage,
  ambiguousWarnMessage,
) {
  const sources = await readMatchingWebviewAssetSourcesWithCapability(capability, filenamePattern);
  const matches = [];
  for (const asset of sources) {
    if (await assetMatch(asset.source, asset.assetName)) {
      matches.push(asset);
    }
  }
  if (matches.length === 0) {
    console.warn(missingWarnMessage);
    return { matched: 0, changed: 0, assetName: null };
  }
  if (matches.length !== 1) {
    console.warn(`${ambiguousWarnMessage}: ${matches.map(({ assetName }) => assetName).join(", ")}`);
    return { matched: matches.length, changed: 0, assetName: null };
  }

  const [asset] = matches;
  const replacement = replacementBytes(await patchFn(asset.source), asset.assetName);
  if (replacement.equals(asset[originalAssetBytes])) {
    return { matched: 1, changed: 0, assetName: asset.assetName };
  }
  await replaceWebviewAssetSourceWithCapability(capability, asset, replacement);
  return { matched: 1, changed: 1, assetName: asset.assetName };
}

function readDirectoryNames(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir);
}

function findMainBundle(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  const mainBundle = readDirectoryNames(buildDir).find((name) =>
    /^main(?:-[^.]+)?\.js$/.test(name),
  );

  return mainBundle == null ? null : { buildDir, mainBundle };
}

function findIconAsset(extractedDir) {
  const assetsDir = path.join(extractedDir, "webview", "assets");
  return readDirectoryNames(assetsDir).find((name) => /^app-.*\.png$/.test(name)) ?? null;
}

function regexpTest(filenamePattern, name) {
  filenamePattern.lastIndex = 0;
  return filenamePattern.test(name);
}

function patchAssetFiles(extractedDir, filenamePattern, patchFn, missingWarnMessage) {
  const webviewAssetsDir = path.join(extractedDir, "webview", "assets");
  if (!fs.existsSync(webviewAssetsDir)) {
    console.warn(
      `WARN: Could not find webview assets directory in ${webviewAssetsDir} — skipping asset patch`,
    );
    return { matched: 0, changed: 0 };
  }

  const candidates = fs
    .readdirSync(webviewAssetsDir)
    .filter((name) => regexpTest(filenamePattern, name))
    .sort();

  if (candidates.length === 0) {
    console.warn(missingWarnMessage);
    return { matched: 0, changed: 0 };
  }

  const pendingWrites = [];
  for (const candidate of candidates) {
    const filePath = path.join(webviewAssetsDir, candidate);
    const currentSource = fs.readFileSync(filePath, "utf8");
    const patchedSource = patchFn(currentSource);
    if (patchedSource !== currentSource) {
      pendingWrites.push({ filePath, patchedSource });
    }
  }
  for (const { filePath, patchedSource } of pendingWrites) {
    fs.writeFileSync(filePath, patchedSource, "utf8");
  }

  return { matched: candidates.length, changed: pendingWrites.length };
}

function patchUniqueAssetFile(
  extractedDir,
  filenamePattern,
  assetMatch,
  patchFn,
  missingWarnMessage,
  ambiguousWarnMessage,
) {
  const webviewAssetsDir = path.join(extractedDir, "webview", "assets");
  if (!fs.existsSync(webviewAssetsDir)) {
    console.warn(
      `WARN: Could not find webview assets directory in ${webviewAssetsDir} — skipping asset patch`,
    );
    return { matched: 0, changed: 0, assetName: null };
  }

  const matches = fs
    .readdirSync(webviewAssetsDir)
    .filter((name) => regexpTest(filenamePattern, name))
    .sort()
    .map((assetName) => ({
      assetName,
      source: fs.readFileSync(path.join(webviewAssetsDir, assetName), "utf8"),
    }))
    .filter(({ assetName, source }) => assetMatch(source, assetName));

  if (matches.length === 0) {
    console.warn(missingWarnMessage);
    return { matched: 0, changed: 0, assetName: null };
  }
  if (matches.length !== 1) {
    console.warn(`${ambiguousWarnMessage}: ${matches.map(({ assetName }) => assetName).join(", ")}`);
    return { matched: matches.length, changed: 0, assetName: null };
  }

  const [{ assetName, source }] = matches;
  const patchedSource = patchFn(source);
  if (patchedSource === source) {
    return { matched: 1, changed: 0, assetName };
  }
  fs.writeFileSync(path.join(webviewAssetsDir, assetName), patchedSource, "utf8");
  return { matched: 1, changed: 1, assetName };
}

function readWebviewAsset(webviewAssetsDir, assetName) {
  return fs.readFileSync(path.join(webviewAssetsDir, assetName), "utf8");
}

function findRequiredWebviewAsset(webviewAssetsDir, filenamePattern, marker, description) {
  if (!fs.existsSync(webviewAssetsDir)) {
    throw new Error(`Missing webview assets directory ${webviewAssetsDir}`);
  }

  const candidates = fs
    .readdirSync(webviewAssetsDir)
    .filter((name) => regexpTest(filenamePattern, name))
    .sort();
  const matches = marker == null
    ? candidates
    : candidates.filter((name) => readWebviewAsset(webviewAssetsDir, name).includes(marker));

  if (matches.length === 0) {
    throw new Error(`Could not find ${description} in ${webviewAssetsDir}`);
  }

  return matches[0];
}

function findCodexRequestExportName(source) {
  let match = source.match(
    /async function\s+([A-Za-z_$][\w$]*)\(\.\.\.[^)]+\)\{let\[[^\]]+\]=[^;]+,\{params:[^}]+source:[^}]+\}=[^;]+;return\s+[A-Za-z_$][\w$]*\([^)]*\)\}/,
  );
  if (match != null) {
    return findExportedAlias(source, match[1]);
  }

  match = source.match(
    /function\s+([A-Za-z_$][\w$]*)\(\.\.\.[^)]+\)\{let\[[^\]]+\]=[^;]+,\{params:[^}]+select:[^}]+signal:[^}]+source:[^}]+\}=[^;]+;return\s+([A-Za-z_$][\w$]*)\([^)]*\)\}/,
  );
  if (match != null) {
    const [, wrapperName, rawRequestName] = match;
    const rawRequestPattern = new RegExp(
      `async function\\s+${rawRequestName}\\([^)]*\\)\\{[\\s\\S]{0,600}?vscode://codex/`,
    );
    if (rawRequestPattern.test(source)) {
      return findExportedAlias(source, wrapperName);
    }
  }

  return null;
}

function findCodexRequestWebviewAsset(webviewAssetsDir) {
  if (!fs.existsSync(webviewAssetsDir)) {
    throw new Error(`Missing webview assets directory ${webviewAssetsDir}`);
  }

  const settingStorageCandidates = fs
    .readdirSync(webviewAssetsDir)
    .filter((name) => regexpTest(/^setting-storage-.*\.js$/, name))
    .sort();
  const allRequestCandidates = fs
    .readdirSync(webviewAssetsDir)
    .filter((name) => regexpTest(/\.js$/, name))
    .sort()
    .filter((name) => !settingStorageCandidates.includes(name));
  const modernCandidates = [...settingStorageCandidates, ...allRequestCandidates];
  const matches = [];
  for (const candidate of modernCandidates) {
    const source = readWebviewAsset(webviewAssetsDir, candidate);
    if (!source.includes("vscode://codex/")) {
      continue;
    }
    const exportName = findCodexRequestExportName(source);
    if (exportName != null) {
      matches.push({ assetName: candidate, exportName });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Found multiple Codex request API assets (${matches.map(({ assetName }) => assetName).join(", ")})`,
    );
  }

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error(`Could not find Codex request API asset in ${webviewAssetsDir}`);
}

function findImportedAsset(webviewAssetsDir, importerAsset, description) {
  const importedAsset = readWebviewAsset(webviewAssetsDir, importerAsset).match(/from"\.\/([^"]+)"/)?.[1];
  if (!importedAsset || !fs.existsSync(path.join(webviewAssetsDir, importedAsset))) {
    throw new Error(`Could not find ${description} imported by ${importerAsset}`);
  }
  return importedAsset;
}

module.exports = {
  findCodexRequestWebviewAsset,
  findIconAsset,
  findIconAssetWithCapability,
  findImportedAsset,
  findMainBundle,
  findMainBundleWithCapability,
  findRequiredWebviewAsset,
  patchAssetFiles,
  patchAssetFilesWithCapability,
  patchUniqueAssetFile,
  patchUniqueAssetFileWithCapability,
  readDirectoryNames,
  readMatchingWebviewAssetSourcesWithCapability,
  readWebviewAsset,
  replaceMainBundleWithCapability,
};
