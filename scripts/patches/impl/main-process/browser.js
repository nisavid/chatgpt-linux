"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  escapeRegExp,
  findExecutableJavaScriptSubstring,
  findMatchingBrace,
  requireName,
} = require("../../lib/minified-js.js");

const BUNDLED_PLUGIN_ANCESTOR_HELPER = "chatgptLinuxValidateBundledPluginAncestors";
const BUNDLED_PLUGIN_SOURCE_HELPER = "chatgptLinuxValidateBundledPluginSource";
const BUNDLED_PLUGIN_STAGE_HELPER = "chatgptLinuxPrepareBundledPluginStage";
const BUNDLED_PLUGIN_WRITABLE_HELPER = "chatgptLinuxMakeBundledPluginTreeWritable";

function executableRegexMatches(source, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].filter(
    (match) => match.index != null &&
      findExecutableJavaScriptSubstring(source, match[0], match.index) === match.index,
  );
}

function bundledPluginCopyPermissionHelpers(pathVar) {
  return [
    `async function ${BUNDLED_PLUGIN_ANCESTOR_HELPER}(e,t){let n=await t.realpath(e),r=process.geteuid?.();if(!Number.isInteger(r))throw Error(\`Linux bundled plugin path is not trusted\`);for(let e=n;;){let n=await t.lstat(e),i=n.mode;if(n.isSymbolicLink()||!n.isDirectory()||n.uid!==r&&n.uid!==0||i&18&&!(n.uid===0&&i&512))throw Error(\`Linux bundled plugin path is not trusted\`);let a=(0,${pathVar}.dirname)(e);if(a===e)break;e=a}return n}`,
    `async function ${BUNDLED_PLUGIN_SOURCE_HELPER}(e,t){let n=await ${BUNDLED_PLUGIN_ANCESTOR_HELPER}(e,t),r=process.geteuid(),i=async e=>{let n=await t.lstat(e);if(n.isSymbolicLink()||!n.isDirectory()&&!n.isFile()||n.uid!==r&&n.uid!==0||n.mode&18)throw Error(\`Linux bundled plugin source is not trusted\`);if(n.isDirectory())for(let n of await t.readdir(e))await i((0,${pathVar}.join)(e,n))};return await i(n),n}`,
    `async function ${BUNDLED_PLUGIN_STAGE_HELPER}(e,t){let n=(0,${pathVar}.dirname)(e),r=n;for(;;)try{await t.lstat(r);break}catch(e){if(e?.code!==\`ENOENT\`)throw e;let t=(0,${pathVar}.dirname)(r);if(t===r)throw e;r=t}await ${BUNDLED_PLUGIN_ANCESTOR_HELPER}(r,t),await t.mkdir(n,{recursive:!0,mode:448}),await ${BUNDLED_PLUGIN_ANCESTOR_HELPER}(n,t),await t.mkdir(e,{mode:448});let i=process.geteuid(),a=await t.lstat(e);if(a.isSymbolicLink()||!a.isDirectory()||a.uid!==i)throw Error(\`Linux bundled plugin staging root is not private\`);await t.chmod(e,448),a=await t.lstat(e);if((a.mode&511)!==448)throw Error(\`Linux bundled plugin staging root is not private\`)}`,
    `async function ${BUNDLED_PLUGIN_WRITABLE_HELPER}(e,t){let n=await t.lstat(e);if(n.isSymbolicLink())throw Error(\`Linux bundled plugin copy contains a symbolic link\`);await t.chmod(e,(n.mode|128)&~18);if(n.isDirectory())for(let n of await t.readdir(e))await ${BUNDLED_PLUGIN_WRITABLE_HELPER}((0,${pathVar}.join)(e,n),t)}`,
  ].join("");
}

function containingAsyncFunctionName(source, index) {
  const pattern = /async function ([A-Za-z_$][\w$]*)\([^)]*\)\{/g;
  let containing = null;
  for (const match of source.matchAll(pattern)) {
    if (match.index == null || match.index > index) break;
    if (findExecutableJavaScriptSubstring(source, match[0], match.index) !== match.index) {
      continue;
    }
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    if (openIndex < index && closeIndex >= index) containing = match[1];
  }
  return containing;
}

function hasLinuxBundledPluginCopyPermissionsContract(source) {
  const copyBranches = executableRegexMatches(
    source,
    /if\(([A-Za-z_$][\w$]*)\.default\.platform!==`win32`\)\{if\(process\.platform===`linux`\)\{await ([A-Za-z_$][\w$]*)\.default\.cp\(await chatgptLinuxValidateBundledPluginSource\(([A-Za-z_$][\w$]*),\2\.default\),([A-Za-z_$][\w$]*),\{recursive:!0,verbatimSymlinks:!0\}\);await chatgptLinuxMakeBundledPluginTreeWritable\(\4,\2\.default\);return\}await \2\.default\.cp\(\3,\4,\{recursive:!0,verbatimSymlinks:!0\}\);return\}/g,
  );
  const stageCalls = executableRegexMatches(
    source,
    /await chatgptLinuxPrepareBundledPluginStage\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\.default\),await \2\.default\.mkdir\(\(0,([A-Za-z_$][\w$]*)\.join\)\(\1,\.\.\.([A-Za-z_$][\w$]*)\.slice\(0,-1\)\),\{recursive:!0,mode:448\}\)/g,
  );
  const parentCalls = executableRegexMatches(
    source,
    /await ([A-Za-z_$][\w$]*)\.default\.mkdir\(\(0,([A-Za-z_$][\w$]*)\.dirname\)\(([A-Za-z_$][\w$]*)\),\{recursive:!0,mode:448\}\),await ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),\3\)/g,
  );
  if (copyBranches.length !== 1 || stageCalls.length !== 1 || parentCalls.length !== 1) {
    return false;
  }

  const copy = copyBranches[0];
  const stage = stageCalls[0];
  const parent = parentCalls[0];
  const stageFunction = containingAsyncFunctionName(source, stage.index);
  if (
    copy.index == null ||
    stage.index == null ||
    parent.index == null ||
    containingAsyncFunctionName(source, copy.index) !== parent[4] ||
    stageFunction == null ||
    stageFunction !== containingAsyncFunctionName(source, parent.index) ||
    stage.index >= parent.index ||
    copy[2] !== stage[2] ||
    copy[2] !== parent[1] ||
    stage[3] !== parent[2]
  ) {
    return false;
  }
  const helpers = bundledPluginCopyPermissionHelpers(stage[3]);
  return findExecutableJavaScriptSubstring(source, helpers) >= 0;
}

function applyLinuxBundledPluginCopyPermissionsPatch(currentSource) {
  const ancestorHelperName = BUNDLED_PLUGIN_ANCESTOR_HELPER;
  const sourceHelperName = BUNDLED_PLUGIN_SOURCE_HELPER;
  const stageHelperName = BUNDLED_PLUGIN_STAGE_HELPER;
  const writableHelperName = BUNDLED_PLUGIN_WRITABLE_HELPER;
  if (hasLinuxBundledPluginCopyPermissionsContract(currentSource)) {
    return currentSource;
  }
  if (
    [ancestorHelperName, sourceHelperName, stageHelperName, writableHelperName].some(
      (name) => findExecutableJavaScriptSubstring(
        currentSource,
        `async function ${name}(`,
      ) >= 0,
    )
  ) {
    throw new Error(
      "Required Linux bundled plugin permissions patch is only partially present",
    );
  }

  const copyBranchRegex =
    /if\(([A-Za-z_$][\w$]*)\.default\.platform!==`win32`\)\{await ([A-Za-z_$][\w$]*)\.default\.cp\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),\{recursive:!0,verbatimSymlinks:!0\}\);return\}/;
  let patchedCopyBranch = false;
  const patchedSource = currentSource.replace(
    copyBranchRegex,
    (_match, platformVar, fsPromisesVar, sourceVar, targetVar) => {
      patchedCopyBranch = true;
      return `if(${platformVar}.default.platform!==\`win32\`){if(process.platform===\`linux\`){await ${fsPromisesVar}.default.cp(await ${sourceHelperName}(${sourceVar},${fsPromisesVar}.default),${targetVar},{recursive:!0,verbatimSymlinks:!0});await ${writableHelperName}(${targetVar},${fsPromisesVar}.default);return}await ${fsPromisesVar}.default.cp(${sourceVar},${targetVar},{recursive:!0,verbatimSymlinks:!0});return}`;
    },
  );
  if (!patchedCopyBranch) {
    if (currentSource.includes("verbatimSymlinks")) {
      console.warn(
        "WARN: Could not find bundled plugin copy branch — skipping Linux plugin permissions patch",
      );
    }
    return currentSource;
  }

  const stagingMkdirRegex =
    /await ([A-Za-z_$][\w$]*)\.default\.mkdir\(\(0,([A-Za-z_$][\w$]*)\.join\)\(([A-Za-z_$][\w$]*),\.\.\.([A-Za-z_$][\w$]*)\.slice\(0,-1\)\),\{recursive:!0\}\)/;
  let patchedStagingMkdir = false;
  let pathVar = null;
  const stagingPatchedSource = patchedSource.replace(
    stagingMkdirRegex,
    (_match, fsPromisesVar, matchedPathVar, stageRootVar, manifestPartsVar) => {
      patchedStagingMkdir = true;
      pathVar = matchedPathVar;
      return `await ${stageHelperName}(${stageRootVar},${fsPromisesVar}.default),await ${fsPromisesVar}.default.mkdir((0,${pathVar}.join)(${stageRootVar},...${manifestPartsVar}.slice(0,-1)),{recursive:!0,mode:448})`;
    },
  );
  if (!patchedStagingMkdir) {
    if (currentSource.includes("staging_marketplace")) {
      console.warn(
        "WARN: Could not find bundled marketplace staging creation — skipping Linux plugin permissions patch",
      );
    }
    return currentSource;
  }

  const pluginParentMkdirRegex = new RegExp(
    `await ([A-Za-z_$][\\w$]*)\\.default\\.mkdir\\(\\(0,${escapeRegExp(pathVar)}\\.dirname\\)\\(([A-Za-z_$][\\w$]*)\\),\\{recursive:!0\\}\\),await ([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*),([A-Za-z_$][\\w$]*)\\)`,
  );
  let patchedPluginParentMkdir = false;
  const fullyPatchedSource = stagingPatchedSource.replace(
    pluginParentMkdirRegex,
    (_match, fsPromisesVar, targetVar, copyFunctionVar, sourceVar, copyTargetVar) => {
      if (copyTargetVar !== targetVar) {
        return _match;
      }
      patchedPluginParentMkdir = true;
      return `await ${fsPromisesVar}.default.mkdir((0,${pathVar}.dirname)(${targetVar}),{recursive:!0,mode:448}),await ${copyFunctionVar}(${sourceVar},${targetVar})`;
    },
  );
  if (!patchedPluginParentMkdir) {
    if (currentSource.includes("copy_plugins")) {
      console.warn(
        "WARN: Could not find bundled plugin target parent creation — skipping Linux plugin permissions patch",
      );
    }
    return currentSource;
  }

  const helpers = bundledPluginCopyPermissionHelpers(pathVar);
  const strictDirective = '"use strict";';
  const helperInsertionIndex = currentSource.startsWith(strictDirective)
    ? strictDirective.length
    : 0;
  const result = (
    fullyPatchedSource.slice(0, helperInsertionIndex) +
    helpers +
    fullyPatchedSource.slice(helperInsertionIndex)
  );
  if (!hasLinuxBundledPluginCopyPermissionsContract(result)) {
    throw new Error(
      "Required Linux bundled plugin permissions patch did not produce a complete contract",
    );
  }
  return result;
}

function applyLinuxBundledPluginReconcileStaleSnapshotPatch(currentSource) {
  const marker = "/*chatgpt-linux-skip-stale-bundled-plugin-reconcile*/";
  if (currentSource.includes(marker)) {
    return currentSource;
  }

  const reconcilerStartRegex =
    /([A-Za-z_$][\w$]*)=\(\{force:([A-Za-z_$][\w$]*),reason:([A-Za-z_$][\w$]*)\}\)=>\{if\(([A-Za-z_$][\w$]*)==null\)return [A-Za-z_$][\w$]*\(\)\.info\(`bundled_plugins_reconcile_skipped_features_unavailable`/;
  const match = currentSource.match(reconcilerStartRegex);
  if (match == null || match.index == null) {
    if (currentSource.includes("bundled_plugins_reconcile_skipped_features_unavailable")) {
      console.warn(
        "WARN: Could not find bundled plugin reconcile queue — skipping stale snapshot patch",
      );
    }
    return currentSource;
  }

  const featureSnapshotVar = match[4];
  const escapedFeatureSnapshotVar = escapeRegExp(featureSnapshotVar);
  const reconcilerPrefix = currentSource.slice(match.index);
  const snapshotMatch = reconcilerPrefix.match(
    new RegExp(`;let ([A-Za-z_$][\\w$]*)=${escapedFeatureSnapshotVar}(?:,|;)`),
  );
  const reconcileLogIndex = reconcilerPrefix.indexOf(
    "bundled_plugins_reconcile_started",
  );
  if (snapshotMatch == null || snapshotMatch.index == null || reconcileLogIndex < 0) {
    console.warn(
      "WARN: Could not find bundled plugin reconcile snapshot — skipping stale snapshot patch",
    );
    return currentSource;
  }

  const capturedSnapshotVar = snapshotMatch[1];
  const hashMatch = reconcilerPrefix.match(
    new RegExp(
      `;if\\(!${escapeRegExp(match[2])}&&([A-Za-z_$][\\w$]*)===([A-Za-z_$][\\w$]*)\\)return`,
    ),
  );
  if (hashMatch == null) {
    console.warn(
      "WARN: Could not find bundled plugin reconcile semantic hash — skipping stale snapshot patch",
    );
    return currentSource;
  }

  const latestHashVar = hashMatch[1];
  const capturedHashVar = hashMatch[2];
  const reconcileCallMatch = reconcilerPrefix.match(
    new RegExp(
      `await ([A-Za-z_$][\\w$]*)\\(\\{desktopFeatureAvailability:${escapeRegExp(capturedSnapshotVar)},`,
    ),
  );
  if (reconcileCallMatch == null) {
    console.warn(
      "WARN: Could not find bundled plugin reconcile worker — skipping stale snapshot patch",
    );
    return currentSource;
  }

  const reconcileWorkerVar = reconcileCallMatch[1];
  const workerDefinitionRegex = new RegExp(
    `${escapeRegExp(reconcileWorkerVar)}=async ([A-Za-z_$][\\w$]*)=>\\{`,
    "g",
  );
  const workerDefinitionMatches = [...reconcilerPrefix.matchAll(workerDefinitionRegex)];
  if (
    workerDefinitionMatches.length !== 1 ||
    workerDefinitionMatches[0].index == null
  ) {
    console.warn(
      "WARN: Expected one bundled plugin reconcile worker definition — skipping stale snapshot patch",
    );
    return currentSource;
  }
  const workerDefinitionMatch = workerDefinitionMatches[0];

  const workerArgumentVar = workerDefinitionMatch[1];
  const workerPrefix = reconcilerPrefix.slice(workerDefinitionMatch.index);
  const destructiveReconcileRegex =
    /try\{([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\(\{appServerConnection:/;
  const destructiveReconcileMatch = workerPrefix.match(destructiveReconcileRegex);
  if (destructiveReconcileMatch == null || destructiveReconcileMatch.index == null) {
    console.warn(
      "WARN: Could not find bundled plugin destructive reconcile boundary — skipping stale snapshot patch",
    );
    return currentSource;
  }

  const insertionIndex =
    match.index +
    workerDefinitionMatch.index +
    destructiveReconcileMatch.index +
    "try{".length;
  const reconcileCallIndex = match.index + reconcileCallMatch.index;
  const reconcileCallPrefix = `await ${reconcileWorkerVar}({`;
  const reconcilePropertyIndex = reconcileCallIndex + reconcileCallPrefix.length;
  const hashAssignment = `${latestHashVar}=${capturedHashVar};`;
  const hashAssignmentIndex = reconcilerPrefix.indexOf(hashAssignment);
  if (hashAssignmentIndex < 0) {
    console.warn(
      "WARN: Could not find bundled plugin reconcile hash assignment — skipping stale snapshot patch",
    );
    return currentSource;
  }
  const globalHashInsertionIndex =
    match.index + hashAssignmentIndex + hashAssignment.length;
  if (
    !(
      globalHashInsertionIndex < reconcilePropertyIndex &&
      reconcilePropertyIndex < insertionIndex
    )
  ) {
    console.warn(
      "WARN: Bundled plugin reconcile insertion order drifted — skipping stale snapshot patch",
    );
    return currentSource;
  }

  const guardedSource =
    currentSource.slice(0, insertionIndex) +
    `if(${workerArgumentVar}.chatgptLinuxReconcileSnapshot!==globalThis.__chatgptLinuxBundledPluginReconcileSnapshot)return;${marker}` +
    currentSource.slice(insertionIndex);
  const propertySource =
    guardedSource.slice(0, reconcilePropertyIndex) +
    `chatgptLinuxReconcileSnapshot:${capturedHashVar},` +
    guardedSource.slice(reconcilePropertyIndex);
  return (
    propertySource.slice(0, globalHashInsertionIndex) +
    `globalThis.__chatgptLinuxBundledPluginReconcileSnapshot=${capturedHashVar};` +
    propertySource.slice(globalHashInsertionIndex)
  );
}

function applyBrowserUseNodeReplApprovalPatch(currentSource) {
  let patchedSource = currentSource;
  let patchedTrustedHashes = false;
  const hasTrustedHashesRuntimeBuilder =
    /(?<!async )function [A-Za-z_$][\w$]*\(\{(?=[^{}]*nodePath:)(?=[^{}]*nodeReplPath:)(?=[^{}]*shouldUseWslPaths:)[^{}]*trustedBrowserClientSha256s:[A-Za-z_$][\w$]*(?:=\[\])?[^{}]*\}\)\{/.test(currentSource);

  const runtimeBuilderTrustedHashesRegex =
    /(?<!async )function ([A-Za-z_$][\w$]*)\(\{(?=[^{}]*nodePath:)(?=[^{}]*nodeReplPath:)(?=[^{}]*shouldUseWslPaths:)([^{}]*?trustedBrowserClientSha256s:)([A-Za-z_$][\w$]*)([^{}]*?\})\)\{(?![A-Za-z_$][\w$]*=chatgptLinuxTrustedBrowserClientSha256s\()/g;
  if (
    requireName(patchedSource, "node:fs") != null &&
    requireName(patchedSource, "node:path") != null &&
    requireName(patchedSource, "node:crypto") != null
  ) {
    patchedSource = patchedSource.replace(
      runtimeBuilderTrustedHashesRegex,
      (
        _match,
        functionName,
        configPrefix,
        trustedHashesVar,
        configSuffix,
      ) => {
        patchedTrustedHashes = true;
        return `function ${functionName}({${configPrefix}${trustedHashesVar}${configSuffix}){${trustedHashesVar}=chatgptLinuxTrustedBrowserClientSha256s(${trustedHashesVar});`;
      },
    );
  }

  // The node_repl MCP server config is a standalone object literal in a
  // separate build chunk. Insert the js auto-approval there.
  const mcpServerConfigRegex =
    /(\[`mcp_servers\.\$\{[A-Za-z_$][\w$]*\}`\]:\{args:\[\],command:[A-Za-z_$][\w$]*,env:[A-Za-z_$][\w$]*,)(startup_timeout_sec:120\})/g;
  const mcpServerConfigAlreadyApprovedRegex =
    /\[`mcp_servers\.\$\{[A-Za-z_$][\w$]*\}`\]:\{args:\[\],command:[A-Za-z_$][\w$]*,env:[A-Za-z_$][\w$]*,tools:\{js:\{approval_mode:`approve`\}\},startup_timeout_sec:120\}/;
  let patchedAnyMcpServerConfig = false;
  patchedSource = patchedSource.replace(
    mcpServerConfigRegex,
    (_match, configPrefix, configSuffix) => {
      patchedAnyMcpServerConfig = true;
      return `${configPrefix}tools:{js:{approval_mode:\`approve\`}},${configSuffix}`;
    },
  );

  if (
    patchedTrustedHashes &&
    !patchedSource.includes("function chatgptLinuxTrustedBrowserClientSha256s(")
  ) {
    const fsVar = requireName(patchedSource, "node:fs");
    const pathVar = requireName(patchedSource, "node:path");
    const cryptoVar = requireName(patchedSource, "node:crypto");
    if (fsVar == null || pathVar == null || cryptoVar == null) {
      console.warn(
        "WARN: Could not find fs/path/crypto aliases — skipping Linux Browser Use trusted hash patch",
      );
      return currentSource;
    } else {
      const helper =
        `function chatgptLinuxTrustedBrowserClientSha256s(__chatgptHashes,__chatgptResourcesPath=process.resourcesPath){if(process.platform!==\`linux\`)return __chatgptHashes;let __chatgptTrustedHashes=Array.isArray(__chatgptHashes)?[...__chatgptHashes]:[],__chatgptBasePath=__chatgptResourcesPath??"";if(__chatgptBasePath.length===0)return Array.from(new Set(__chatgptTrustedHashes));for(let __chatgptPluginName of[\`browser\`,\`chrome\`])try{let __chatgptBrowserClientPath=(0,${pathVar}.join)(__chatgptBasePath,\`plugins\`,\`openai-bundled\`,\`plugins\`,__chatgptPluginName,\`scripts\`,\`browser-client.mjs\`);(0,${fsVar}.existsSync)(__chatgptBrowserClientPath)&&__chatgptTrustedHashes.push((0,${cryptoVar}.createHash)(\`sha256\`).update((0,${fsVar}.readFileSync)(__chatgptBrowserClientPath)).digest(\`hex\`))}catch{}return Array.from(new Set(__chatgptTrustedHashes))}`;
      const strictDirective = '"use strict";';
      const helperInsertionIndex = patchedSource.startsWith(strictDirective)
        ? strictDirective.length
        : 0;
      patchedSource =
        patchedSource.slice(0, helperInsertionIndex) +
        helper +
        patchedSource.slice(helperInsertionIndex);
    }
  }

  if (
    !patchedTrustedHashes &&
    !patchedSource.includes("chatgptLinuxTrustedBrowserClientSha256s(") &&
    hasTrustedHashesRuntimeBuilder
  ) {
    console.warn(
      "WARN: Could not find Browser Use trusted hash insertion point — skipping Linux Browser Use trusted hash patch",
    );
  }

  if (
    patchedSource === currentSource &&
    patchedSource.includes("startup_timeout_sec:120") &&
    !patchedAnyMcpServerConfig &&
    !mcpServerConfigAlreadyApprovedRegex.test(patchedSource) &&
    !patchedTrustedHashes &&
    !patchedSource.includes("chatgptLinuxTrustedBrowserClientSha256s(")
  ) {
    console.warn(
      "WARN: Could not find Browser Use node_repl config insertion point — skipping node_repl approval patch",
    );
  }

  return patchedSource;
}

function applyBrowserUseNodeReplSecurityContextPatch(currentSource) {
  const helperName = "chatgptLinuxBrowserUseRequestMeta";
  if (currentSource.includes(`function ${helperName}(`)) {
    return currentSource;
  }

  const runtimeConfigPattern =
    /(?<![A-Za-z0-9_$])(?<!function )([A-Za-z_$][\w$]*\(\{codexCliPath:[^,]+,codexHome:)([A-Za-z_$][\w$]*)(,envVars:[^,]+,extraEnv:)([A-Za-z_$][\w$]*)(,nodeModuleDirs:[^,]+,nodePath:[^,]+,nodeReplPath:[^,]+,platform:[^,]+,requestMeta:)([A-Za-z_$][\w$]*)(,sentryUserId:)/g;
  const matches = [...currentSource.matchAll(runtimeConfigPattern)];
  if (matches.length !== 1) {
    if (
      currentSource.includes("BROWSER_USE_AVAILABLE_BACKENDS") ||
      currentSource.includes("browser_use_setup_failed")
    ) {
      console.warn(
        `WARN: Expected one Browser Use node_repl security-context producer, found ${matches.length} — leaving the main bundle unchanged`,
      );
    }
    return currentSource;
  }

  const helper =
    `function ${helperName}(__chatgptExisting,__chatgptEnv,__chatgptCodexHome){` +
    `let __chatgptMeta={};if(__chatgptExisting!=null){try{__chatgptMeta=JSON.parse(__chatgptExisting)}catch{throw Error(\`Browser node_repl request metadata is invalid\`)}if(typeof __chatgptMeta!==\`object\`||__chatgptMeta==null||Array.isArray(__chatgptMeta))throw Error(\`Browser node_repl request metadata is invalid\`)}` +
    `let __chatgptAllowed=new Set([\`BROWSER_AUTH_BROKER_SOCKET_PATH\`,\`BROWSER_USE_AVAILABLE_BACKENDS\`,\`BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED\`,\`BROWSER_USE_CODEX_APP_BUILD_FLAVOR\`,\`BROWSER_USE_CODEX_APP_VERSION\`,\`BROWSER_USE_DISABLE_AMBIENT_NETWORK\`,\`BROWSER_USE_DISABLE_API_MEMBERS\`,\`BROWSER_USE_DISABLE_BROWSER_CAPABILITIES\`,\`BROWSER_USE_DISABLE_TAB_CAPABILITIES\`,\`BROWSER_USE_SECURITY_MODE\`,\`CODEX_CHROME_USER_DATA_DIR\`,\`NODE_REPL_DISABLE_ANALYTICS\`,\`NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER\`,\`NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME\`]),__chatgptContext={};` +
    `for(let[__chatgptKey,__chatgptValue]of Object.entries(__chatgptEnv??{})){if(!__chatgptAllowed.has(__chatgptKey))continue;if(typeof __chatgptValue!==\`string\`)throw Error(\`Browser node_repl security context is invalid\`);__chatgptContext[__chatgptKey]=__chatgptValue}` +
    `if(typeof __chatgptCodexHome!==\`string\`||__chatgptCodexHome.length===0)throw Error(\`Browser node_repl security context is invalid\`);__chatgptContext.CODEX_HOME=__chatgptCodexHome;` +
    `let __chatgptFlavor=__chatgptContext.BROWSER_USE_CODEX_APP_BUILD_FLAVOR,__chatgptMode=__chatgptContext.BROWSER_USE_SECURITY_MODE;if(![\`dev\`,\`internal\`,\`prod\`].includes(__chatgptFlavor))throw Error(\`Browser node_repl security context is invalid\`);if(__chatgptMode!=null&&![\`\`,\`disabled-for-local-testing\`,\`gaas-browser-environment\`].includes(__chatgptMode))throw Error(\`Browser node_repl security context is invalid\`);if(__chatgptMode===\`disabled-for-local-testing\`&&__chatgptFlavor!==\`dev\`)throw Error(\`Browser node_repl security context is invalid\`);` +
    `return JSON.stringify({...__chatgptMeta,[\`chatgpt/browser-runtime-context\`]:{version:1,env:__chatgptContext}})}`;
  const strictDirective = '"use strict";';
  const helperInsertionIndex = currentSource.startsWith(strictDirective)
    ? strictDirective.length
    : 0;
  const patchedSource = currentSource.replace(
    runtimeConfigPattern,
    (_match, callPrefix, codexHome, envPrefix, extraEnv, requestPrefix, requestMeta, suffix) =>
      `${callPrefix}${codexHome}${envPrefix}${extraEnv}${requestPrefix}${helperName}(${requestMeta},${extraEnv},${codexHome})${suffix}`,
  );
  return (
    patchedSource.slice(0, helperInsertionIndex) +
    helper +
    patchedSource.slice(helperInsertionIndex)
  );
}

// The trusted-hash setup and node_repl config can live in different build chunks.
// Scan every chunk carrying either marker so each patch reaches its current host.
function applyBrowserUseNodeReplApprovalAssets(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    return { matched: 0, changed: 0 };
  }

  const candidates = fs
    .readdirSync(buildDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => path.join(buildDir, name))
    .filter((candidate) => {
      try {
        const source = fs.readFileSync(candidate, "utf8");
        return (
          source.includes("startup_timeout_sec:120") ||
          source.includes("trustedBrowserClientSha256s")
        );
      } catch {
        return false;
      }
    });

  let changed = 0;
  const pendingWrites = [];
  for (const candidate of candidates) {
    const currentSource = fs.readFileSync(candidate, "utf8");
    const patchedSource = applyBrowserUseNodeReplApprovalPatch(currentSource);
    if (patchedSource !== currentSource) {
      changed += 1;
      pendingWrites.push({ filePath: candidate, patchedSource });
    }
  }
  for (const { filePath, patchedSource } of pendingWrites) {
    fs.writeFileSync(filePath, patchedSource, "utf8");
  }

  return { matched: candidates.length, changed };
}

function applyLinuxBrowserUseRouteLivenessPatch(currentSource) {
  if (currentSource.includes("chatgptLinuxResolveLiveBrowserUseRouteWindow")) {
    return currentSource;
  }

  const routeWindowPattern =
    /function ([A-Za-z_$][\w$]*)\(\{ensureWindowState:([A-Za-z_$][\w$]*),windowId:([A-Za-z_$][\w$]*),windows:([A-Za-z_$][\w$]*)\}\)\{let ([A-Za-z_$][\w$]*)=\4\.get\(\3\)\?\?null;if\(\5==null\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.BrowserWindow\.fromId\(\3\);\6!=null&&!\6\.isDestroyed\(\)&&!\6\.webContents\.isDestroyed\(\)&&\(\5=\2\(\6,\6\.webContents\)\)\}return \5==null\|\|\5\.window\.isDestroyed\(\)\|\|\5\.owner\.isDestroyed\(\)\?\(([A-Za-z_$][\w$]*)\(\)\.warning\(`IAB_LIFECYCLE route window is not live`,\{safe:\{hasWindowState:\5!=null,ownerDestroyed:\5\?\.owner\.isDestroyed\(\)\?\?null,windowDestroyed:\5\?\.window\.isDestroyed\(\)\?\?null,windowId:\3\},sensitive:\{\}\}\),null\):\5\}/u;

  const match = currentSource.match(routeWindowPattern);
  if (match == null) {
    if (
      currentSource.includes("IAB_LIFECYCLE route window is not live") &&
      currentSource.includes("BrowserWindow.fromId")
    ) {
      console.warn(
        "WARN: Could not find Browser Use route liveness helper — skipping Linux route liveness fallback patch",
      );
    }
    return currentSource;
  }

  const [
    original,
    functionName,
    ensureWindowStateVar,
    windowIdVar,
    windowsVar,
    stateVar,
    browserWindowVar,
    electronVar,
    loggerVar,
  ] = match;

  // Fix: use windowId-based lookup instead of "first live" heuristic.
  // The old heuristic returned arbitrary live windows that may not match
  // the requested windowId, causing IAB_LIFECYCLE rebound loops where the
  // sidebar webview was created, destroyed, and re-created in a cycle.
  const helper = `function chatgptLinuxResolveLiveBrowserUseRouteWindow(e,t,n,r){if(process.platform!==\`linux\`)return null;let o=r.BrowserWindow.fromId(t);if(o!=null&&!o.isDestroyed()&&!o.webContents.isDestroyed())return e(o,o.webContents);let s=n.get(t)??null;return s!=null&&!s.window.isDestroyed()&&!s.owner.isDestroyed()?s:null}`;
  const replacement = `${helper}function ${functionName}({ensureWindowState:${ensureWindowStateVar},windowId:${windowIdVar},windows:${windowsVar}}){let ${stateVar}=${windowsVar}.get(${windowIdVar})??null;if(${stateVar}==null){let ${browserWindowVar}=${electronVar}.BrowserWindow.fromId(${windowIdVar});${browserWindowVar}!=null&&!${browserWindowVar}.isDestroyed()&&!${browserWindowVar}.webContents.isDestroyed()&&(${stateVar}=${ensureWindowStateVar}(${browserWindowVar},${browserWindowVar}.webContents))}${stateVar}==null&&(${stateVar}=chatgptLinuxResolveLiveBrowserUseRouteWindow(${ensureWindowStateVar},${windowIdVar},${windowsVar},${electronVar}));return ${stateVar}==null||${stateVar}.window.isDestroyed()||${stateVar}.owner.isDestroyed()?(${loggerVar}().warning(\`IAB_LIFECYCLE route window is not live\`,{safe:{hasWindowState:${stateVar}!=null,ownerDestroyed:${stateVar}?.owner.isDestroyed()??null,windowDestroyed:${stateVar}?.window.isDestroyed()??null,windowId:${windowIdVar}},sensitive:{}}),null):${stateVar}}`;

  return currentSource.replace(original, replacement);
}

function applyLinuxBrowserUseSocketDirectoryPatch(currentSource) {
  const helperName = "chatgptLinuxBrowserUseSocketDir";
  const socketModeMarker = "/*chatgptLinuxBrowserUseSocketMode*/";
  const hasHelper = currentSource.includes(`function ${helperName}(`);
  const hasSocketModePatch = currentSource.includes(socketModeMarker);
  if (hasHelper && hasSocketModePatch) {
    return currentSource;
  }
  if (hasHelper || hasSocketModePatch) {
    console.warn(
      "WARN: Browser Use socket directory patch is only partially present — leaving main bundle unchanged",
    );
    return currentSource;
  }

  const socketDirectoryPattern =
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)=>\2===`win32`\?(`(?:\\.|[^`\\])*codex-browser-use`):`\/tmp\/codex-browser-use`/g;
  const socketDirectoryMatches = [...currentSource.matchAll(socketDirectoryPattern)];
  const socketListenPattern =
    /this\.server\.listen\(this\.pipePath,\(\)=>\{this\.server\.off\(`error`,([A-Za-z_$][\w$]*)\),([A-Za-z_$][\w$]*)\(\)\}\)/g;
  const socketListenMatches = [...currentSource.matchAll(socketListenPattern)];
  if (socketDirectoryMatches.length !== 1 || socketListenMatches.length !== 1) {
    if (currentSource.includes("codex-browser-use")) {
      console.warn(
        `WARN: Expected one Browser Use socket directory and listener, found ${socketDirectoryMatches.length}/${socketListenMatches.length} — skipping Linux IAB socket alignment patch`,
      );
    }
    return currentSource;
  }

  const [directoryTarget, resolverName, platformName, windowsSocket] =
    socketDirectoryMatches[0];
  const [listenTarget, errorHandlerName, resolveName] = socketListenMatches[0];
  const helper =
    `function ${helperName}(){let e=process.env.CODEX_BROWSER_USE_SOCKET_DIR,t=typeof e===\`string\`&&e.length>0?e:null,n=typeof process.getuid===\`function\`?process.getuid():null;` +
    `if(t==null){if(!Number.isInteger(n)||n<0)throw Error(\`Browser Use cannot resolve a per-user Linux socket directory\`);t=\`/tmp/codex-browser-use-\${n}\`}` +
    `let r=require(\`node:fs\`);r.mkdirSync(t,{recursive:!0,mode:448});let i=r.lstatSync(t);` +
    `if(i.isSymbolicLink()||!i.isDirectory())throw Error(\`Browser Use socket directory is not a directory\`);` +
    `if(Number.isInteger(n)&&i.uid!==n)throw Error(\`Browser Use socket directory is not owned by the current user\`);` +
    `r.chmodSync(t,448);return t}`;
  const directoryReplacement = `${resolverName}=${platformName}=>${platformName}===\`win32\`?${windowsSocket}:${helperName}()`;
  const listenReplacement =
    `this.server.listen(this.pipePath,()=>{if(process.platform===\`linux\`)try{require(\`node:fs\`).chmodSync(this.pipePath,384)}catch(e){this.server.off(\`error\`,${errorHandlerName}),this.server.close(()=>{}),${errorHandlerName}(e);return}${socketModeMarker}` +
    `this.server.off(\`error\`,${errorHandlerName}),${resolveName}()})`;

  let patchedSource = currentSource.replace(directoryTarget, directoryReplacement);
  patchedSource = patchedSource.replace(listenTarget, listenReplacement);
  const strictDirective = '"use strict";';
  const helperInsertionIndex = patchedSource.startsWith(strictDirective)
    ? strictDirective.length
    : 0;
  return (
    patchedSource.slice(0, helperInsertionIndex) +
    helper +
    patchedSource.slice(helperInsertionIndex)
  );
}

function buildLinuxExternalOpenHelpers() {
  return (
    `function chatgptLinuxExternalOpenEnv(){let __chatgptEnv={...process.env};` +
    `for(let __chatgptKey of[\`LD_LIBRARY_PATH\`,\`LD_PRELOAD\`,\`NODE_OPTIONS\`,\`NODE_PATH\`,\`NODE_REPL_EXTERNAL_MODULE\`,\`ELECTRON_RUN_AS_NODE\`,\`ELECTRON_NO_ASAR\`,\`ELECTRON_ENABLE_LOGGING\`,\`VSCODE_NODE_OPTIONS\`,\`VSCODE_NODE_REPL_EXTERNAL_MODULE\`,\`npm_config_node_options\`,\`NPM_CONFIG_NODE_OPTIONS\`,\`CHROME_DESKTOP\`,\`ELECTRON_RENDERER_URL\`,\`CHATGPT_ELECTRON_RESOURCES_PATH\`,\`CHATGPT_ELECTRON_USER_DATA_DIR\`,\`CHATGPT_LINUX_APP_ID\`,\`CHATGPT_LINUX_APP_DISPLAY_NAME\`,\`CHATGPT_LINUX_WEBVIEW_PORT\`])delete __chatgptEnv[__chatgptKey];` +
    `return __chatgptEnv}` +
    `function chatgptLinuxLaunchExternalUrl(__chatgptUrl){return new Promise((__chatgptResolve,__chatgptReject)=>{let __chatgptSettled=!1,__chatgptTimer;try{let __chatgptChild=require(\`node:child_process\`).spawn(\`xdg-open\`,[__chatgptUrl],{detached:!0,stdio:\`ignore\`,windowsHide:!0,env:chatgptLinuxExternalOpenEnv()});__chatgptTimer=setTimeout(()=>{__chatgptSettled=!0,__chatgptChild.unref?.(),__chatgptResolve()},400),__chatgptTimer.unref?.(),__chatgptChild.on(\`error\`,__chatgptError=>{__chatgptSettled||(clearTimeout(__chatgptTimer),__chatgptReject(__chatgptError))}),__chatgptChild.on(\`close\`,__chatgptCode=>{__chatgptSettled||(clearTimeout(__chatgptTimer),__chatgptCode===0?__chatgptResolve():__chatgptReject(Error(\`Linux external open failed\`)))})}catch(__chatgptError){clearTimeout(__chatgptTimer),__chatgptReject(__chatgptError)}})}` +
    `function chatgptLinuxOpenExternalWithFallback(__chatgptOriginalOpenExternal,__chatgptUrl){return chatgptLinuxLaunchExternalUrl(__chatgptUrl).catch(()=>__chatgptOriginalOpenExternal(__chatgptUrl))}` +
    `function chatgptLinuxPatchExternalOpen(__chatgptElectron){if(process.platform!==\`linux\`||__chatgptElectron?.shell==null||typeof __chatgptElectron.shell.openExternal!==\`function\`)return __chatgptElectron;if(__chatgptElectron.shell.openExternal.__chatgptLinuxExternalOpenPatched)return __chatgptElectron;if(process.env.CHATGPT_LINUX_DISABLE_EXTERNAL_OPEN_PATCH===\`1\`)return __chatgptElectron;let __chatgptOriginalOpenExternal=__chatgptElectron.shell.openExternal.bind(__chatgptElectron.shell);async function __chatgptOpenExternal(__chatgptUrl,__chatgptOptions){if(typeof __chatgptUrl===\`string\`&&__chatgptOptions==null)return chatgptLinuxOpenExternalWithFallback(__chatgptOriginalOpenExternal,__chatgptUrl);return __chatgptOriginalOpenExternal(__chatgptUrl,__chatgptOptions)}__chatgptOpenExternal.__chatgptLinuxExternalOpenPatched=!0,__chatgptElectron.shell.openExternal=__chatgptOpenExternal;return __chatgptElectron}`
  );
}

function applyLinuxExternalOpenEnvPatch(currentSource) {
  const hasHelper = findExecutableJavaScriptSubstring(
    currentSource,
    "function chatgptLinuxPatchExternalOpen(",
  ) >= 0;
  const hasPatchedElectronRequire = ["`", "'", '"'].some((quote) =>
    findExecutableJavaScriptSubstring(
      currentSource,
      `chatgptLinuxPatchExternalOpen(require(${quote}electron${quote}))`,
    ) >= 0
  );
  let patchedAnyElectronRequire = false;
  const patchedSource = currentSource.replace(
    /([A-Za-z_$][\w$]*=)require\(([`'"])electron\2\)/g,
    (_match, prefix, quote) => {
      patchedAnyElectronRequire = true;
      return `${prefix}chatgptLinuxPatchExternalOpen(require(${quote}electron${quote}))`;
    },
  );

  if (!patchedAnyElectronRequire) {
    if (!hasPatchedElectronRequire) {
      console.warn(
        "WARN: Could not find Electron require initializer — skipping Linux external open environment patch",
      );
      return currentSource;
    }
    if (hasHelper) return currentSource;
  }

  if (hasHelper) {
    return patchedSource;
  }

  const strictDirective = '"use strict";';
  const helperInsertionIndex = currentSource.startsWith(strictDirective)
    ? strictDirective.length
    : 0;
  return (
    (patchedAnyElectronRequire ? patchedSource : currentSource).slice(0, helperInsertionIndex) +
    buildLinuxExternalOpenHelpers() +
    (patchedAnyElectronRequire ? patchedSource : currentSource).slice(helperInsertionIndex)
  );
}

module.exports = {
  applyBrowserUseNodeReplApprovalPatch,
  applyBrowserUseNodeReplApprovalAssets,
  applyBrowserUseNodeReplSecurityContextPatch,
  applyLinuxBundledPluginCopyPermissionsPatch,
  applyLinuxBundledPluginReconcileStaleSnapshotPatch,
  applyLinuxExternalOpenEnvPatch,
  applyLinuxBrowserUseRouteLivenessPatch,
  applyLinuxBrowserUseSocketDirectoryPatch,
};
