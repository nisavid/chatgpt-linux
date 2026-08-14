"use strict";

const {
  escapeRegExp,
  findExecutableJavaScriptSubstring,
  findMatchingBrace,
  requireName,
} = require("../lib/minified-js.js");

const COMPUTER_USE_CURSOR_HANDLER_MARKER =
  "setRemoteHostedPIPContentComputerUseCursorLocationHandler";
const LINUX_COMPUTER_USE_CURSOR_BRIDGE_MARKER =
  "chatgptLinuxRegisterComputerUseCursorHandler";
const LINUX_COMPUTER_USE_AUTHORITY_MARKER =
  "chatgptLinuxComputerUseAuthorityRuntime";
const LINUX_COMPUTER_USE_DISABLE_ORDERING_MARKER =
  "chatgpt-linux-computer-use-disable-before-write";

function linuxComputerUseAuthorityRuntimeSource() {
  return [
    "function chatgptLinuxComputerUseAuthorityRuntime(){}",
    "let chatgptLinuxComputerUseAuthorityState={active:null,cleanupRegistered:!1,generation:1,grantCallbacks:new Set,listPluginsArgument:null,listPluginsConnection:null,officialEligible:!1,officialMarketplaceRoot:null,revocationCallbacks:new Set,server:null,socketIdentity:null,socketPath:null,supportTrusted:process.platform===`linux`,token:require(`node:crypto`).randomBytes(32).toString(`hex`)}",
    "function chatgptLinuxComputerUseAuthorityComponent(e){return typeof e===`string`&&e!==`.`&&e!==`..`&&/^[A-Za-z0-9._-]+$/.test(e)}",
    "function chatgptLinuxComputerUseAuthoritySocketPath(){let e=process.env.XDG_RUNTIME_DIR?.trim();if(!e)return null;let t=require(`node:path`);if(!t.isAbsolute(e))return null;let n=(process.env.CHATGPT_LINUX_APP_ID||process.env.CHATGPT_APP_ID||`chatgpt`).trim();chatgptLinuxComputerUseAuthorityComponent(n)||(n=`chatgpt`);let r=process.env.CHATGPT_LINUX_INSTANCE_ID?.trim()||``;if(r&&!chatgptLinuxComputerUseAuthorityComponent(r))return null;let i=r?t.join(e,n,`instances`,r,`computer-use-authority.sock`):t.join(e,n,`computer-use-authority.sock`);return Buffer.byteLength(i,`utf8`)<=100?i:null}",
    "function chatgptLinuxRotateComputerUseAuthority(){let e=chatgptLinuxComputerUseAuthorityState;e.generation=e.generation>=Number.MAX_SAFE_INTEGER?1:e.generation+1,e.token=require(`node:crypto`).randomBytes(32).toString(`hex`),e.active=null}",
    "function chatgptLinuxNotifyComputerUseAuthority(e){for(let t of [...e])try{t()}catch{}}",
    "function chatgptLinuxInvalidateComputerUseAuthority(){let e=chatgptLinuxComputerUseAuthorityState;chatgptLinuxRotateComputerUseAuthority(),chatgptLinuxNotifyComputerUseAuthority(e.revocationCallbacks)}",
    "function chatgptLinuxRevokeComputerUseAuthority(){chatgptLinuxComputerUseAuthorityState.officialEligible=!1,chatgptLinuxInvalidateComputerUseAuthority()}",
    "function chatgptLinuxSetOfficialComputerUseEligibility(e){let t=chatgptLinuxComputerUseAuthorityState;if(e!==!0){chatgptLinuxRevokeComputerUseAuthority();return}if(t.officialEligible)return;t.officialEligible=!0,chatgptLinuxRotateComputerUseAuthority()}",
    "function chatgptLinuxComputerUseAuthorityTrustedDirectory(e,t,n){try{let r=t.lstatSync(e);return!r.isSymbolicLink()&&r.isDirectory()&&r.uid===n&&(r.mode&18)===0}catch{return!1}}",
    "function chatgptLinuxComputerUseAuthorityTrustedFile(e,t,n){try{let r=t.lstatSync(e);return!r.isSymbolicLink()&&r.isFile()&&r.uid===n&&(r.mode&18)===0}catch{return!1}}",
    "function chatgptLinuxComputerUseAuthorityTrustedLink(e,t,n){try{let r=t.lstatSync(e);return r.isSymbolicLink()&&r.uid===n}catch{return!1}}",
    "function chatgptLinuxComputerUseAuthoritySourceIsExact(e,t){try{let n=require(`node:path`),r=require(`node:fs`),i=typeof process.getuid===`function`?process.getuid():null,a=(process.env.CODEX_HOME||require(`node:os`).homedir()&&n.join(require(`node:os`).homedir(),`.codex`)||``).trim();if(i==null||typeof e!==`string`||!n.isAbsolute(e)||!n.isAbsolute(a)||typeof t!==`string`||!n.isAbsolute(t))return!1;a=n.resolve(a);let o=n.join(a,`.tmp`,`bundled-marketplaces`,`openai-bundled`);if(t!==o)return!1;let s=n.join(a,`plugins`,`cache`,`openai-bundled`,`computer-use`),l=n.join(s,`latest`),u=n.join(o,`plugins`,`computer-use`),c=n.join(o,`.agents`,`plugins`,`marketplace.json`),d=r.realpathSync(s),p=r.realpathSync(l),m=r.realpathSync(u),h=r.realpathSync(e),g=n.relative(d,h),f=n.join(s,g);if(h!==m||h!==p||!chatgptLinuxComputerUseAuthorityComponent(g)||e!==f&&e!==l&&e!==u||r.readlinkSync(l)!==g||r.readlinkSync(u)!==l)return!1;let v=[a,n.join(a,`.tmp`),n.join(a,`.tmp`,`bundled-marketplaces`),o,n.join(o,`.agents`),n.join(o,`.agents`,`plugins`),n.join(o,`plugins`),n.join(a,`plugins`),n.join(a,`plugins`,`cache`),n.join(a,`plugins`,`cache`,`openai-bundled`),s,h];return v.every(e=>chatgptLinuxComputerUseAuthorityTrustedDirectory(e,r,i))&&chatgptLinuxComputerUseAuthorityTrustedFile(c,r,i)&&chatgptLinuxComputerUseAuthorityTrustedLink(l,r,i)&&chatgptLinuxComputerUseAuthorityTrustedLink(u,r,i)}catch{return!1}}",
    "function chatgptLinuxComputerUsePluginIsExact(e){if(e==null||typeof e!==`object`||!Array.isArray(e.marketplaces))return!1;let t=chatgptLinuxComputerUseAuthorityState.officialMarketplaceRoot?.();if(typeof t!==`string`||!require(`node:path`).isAbsolute(t))return!1;let n=require(`node:path`).join(t,`.agents`,`plugins`,`marketplace.json`),r=[];for(let t of e.marketplaces){if(t==null||typeof t!==`object`||!Array.isArray(t.plugins))return!1;for(let e of t.plugins)e?.name===`computer-use`&&r.push({marketplace:t,plugin:e})}if(r.length!==1)return!1;let{marketplace:i,plugin:o}=r[0];return i.name===`openai-bundled`&&i.path===n&&o.id===`computer-use@openai-bundled`&&o.installed===!0&&o.enabled===!0&&o.source!=null&&typeof o.source===`object`&&o.source.type===`local`&&chatgptLinuxComputerUseAuthoritySourceIsExact(o.source.path,t)}",
    "async function chatgptLinuxComputerUseFreshPluginRead(){let e=chatgptLinuxComputerUseAuthorityState,t=e.listPluginsConnection?.(),n=e.listPluginsArgument?.();if(t==null||typeof t.listPlugins!==`function`)throw Error(`local app-server plugin list unavailable`);let r,i=new Promise(t=>{r=setTimeout(()=>t({chatgptLinuxTimedOut:!0}),90)}),a=Promise.resolve().then(()=>t.listPlugins(n));try{return await Promise.race([a,i])}finally{clearTimeout(r)}}",
    "async function chatgptLinuxComputerUseCheckAuthorization(){let e=chatgptLinuxComputerUseAuthorityState,t=e.generation,n=e.token;if(!e.supportTrusted||!e.officialEligible)return{allowed:!1,generation:e.generation};let r;try{r=await chatgptLinuxComputerUseFreshPluginRead()}catch{chatgptLinuxInvalidateComputerUseAuthority();return{allowed:!1,generation:e.generation}}if(r?.chatgptLinuxTimedOut===!0||e.generation!==t||e.token!==n||!e.officialEligible||!e.supportTrusted||!chatgptLinuxComputerUsePluginIsExact(r)){e.generation===t&&chatgptLinuxInvalidateComputerUseAuthority();return{allowed:!1,generation:e.generation}}return e.active={generation:t,token:n},chatgptLinuxNotifyComputerUseAuthority(e.grantCallbacks),{allowed:!0,generation:t,token:n}}",
    "async function chatgptLinuxComputerUseAuthorizeRequest(){return(await chatgptLinuxComputerUseCheckAuthorization()).allowed===!0}",
    "function chatgptLinuxRegisterComputerUseRevocation(e){if(typeof e!==`function`)return()=>{};let t=chatgptLinuxComputerUseAuthorityState;return t.revocationCallbacks.add(e),()=>t.revocationCallbacks.delete(e)}",
    "function chatgptLinuxRegisterComputerUseGrant(e){if(typeof e!==`function`)return()=>{};let t=chatgptLinuxComputerUseAuthorityState;return t.grantCallbacks.add(e),()=>t.grantCallbacks.delete(e)}",
    "function chatgptLinuxComputerUseAuthorityPrivateDirectory(e,t,n){try{let r=t.lstatSync(e);return!r.isSymbolicLink()&&r.isDirectory()&&(n==null||r.uid===n)&&(r.mode&511)===448}catch{return!1}}",
    "function chatgptLinuxComputerUseAuthorityPrepareSocket(e){let t=require(`node:path`),n=require(`node:fs`),r=typeof process.getuid===`function`?process.getuid():null,i=process.env.XDG_RUNTIME_DIR.trim();if(r==null||!chatgptLinuxComputerUseAuthorityPrivateDirectory(i,n,r))return null;let a=t.relative(i,t.dirname(e)).split(t.sep).filter(Boolean),o=i;for(let e of a){o=t.join(o,e);try{n.mkdirSync(o,{mode:448})}catch(e){if(e?.code!==`EEXIST`)return null}if(!chatgptLinuxComputerUseAuthorityPrivateDirectory(o,n,r))return null}if(n.existsSync(e))return null;return{fs:n,uid:r}}",
    "function chatgptLinuxComputerUseAuthorityCleanupSocket(){let e=chatgptLinuxComputerUseAuthorityState,t=e.socketIdentity,n=e.socketPath;e.socketIdentity=null;if(t==null||n==null)return;try{let r=require(`node:fs`).lstatSync(n);r.dev===t.dev&&r.ino===t.ino&&r.isSocket()&&require(`node:fs`).unlinkSync(n)}catch{}}",
    "function chatgptLinuxStopComputerUseAuthorityServer(){let e=chatgptLinuxComputerUseAuthorityState,t=e.server;e.server=null;try{t?.close()}catch{}chatgptLinuxComputerUseAuthorityCleanupSocket()}",
    "function chatgptLinuxStartComputerUseAuthorityServer(){let e=chatgptLinuxComputerUseAuthorityState;if(!e.supportTrusted)return!1;if(e.server!=null)return!0;let t=chatgptLinuxComputerUseAuthoritySocketPath();if(t==null)return!1;let n=chatgptLinuxComputerUseAuthorityPrepareSocket(t);if(n==null)return!1;let r=require(`node:net`).createServer({allowHalfOpen:!0},t=>{let n=``,r=!1;t.setEncoding(`utf8`),t.setTimeout(125,()=>t.destroy()),t.on(`error`,()=>{}),t.on(`data`,e=>{if(r)return;n+=e,Buffer.byteLength(n,`utf8`)>128&&(r=!0,t.destroy())}),t.on(`end`,async()=>{if(r)return;r=!0;let i=n.match(/^CHATGPT-CUA-AUTH\\/1 CHECK ([0-9a-f]{32})\\n$/);if(i==null){t.destroy();return}let a=await chatgptLinuxComputerUseCheckAuthorization();if(t.destroyed)return;a.allowed?t.end(`CHATGPT-CUA-AUTH/1 ALLOW ${a.generation} ${a.token} ${i[1]}\\n`):t.end(`CHATGPT-CUA-AUTH/1 DENY ${a.generation} ${i[1]}\\n`)})});return e.server=r,e.socketPath=t,r.on(`error`,()=>{e.server===r&&(e.server=null),chatgptLinuxComputerUseAuthorityCleanupSocket()}),r.listen(t,()=>{try{n.fs.chmodSync(t,384);let i=n.fs.lstatSync(t);if(!i.isSocket()||i.uid!==n.uid||(i.mode&511)!==384)throw Error(`unsafe authority socket`);e.socketIdentity={dev:i.dev,ino:i.ino},r.unref()}catch{chatgptLinuxStopComputerUseAuthorityServer()}}),e.cleanupRegistered||(e.cleanupRegistered=!0,require(`electron`).app.once(`before-quit`,chatgptLinuxStopComputerUseAuthorityServer)),!0}",
    "function chatgptLinuxConfigureComputerUseAuthority(e,t,n){let r=chatgptLinuxComputerUseAuthorityState;return r.listPluginsConnection=typeof e===`function`?e:null,r.listPluginsArgument=typeof t===`function`?t:null,r.officialMarketplaceRoot=typeof n===`function`?n:null,chatgptLinuxStartComputerUseAuthorityServer()}",
  ].join(";");
}

function findBundledPluginController(source) {
  const pattern = /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(source)) != null) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    const text = closeIndex < 0 ? "" : source.slice(match.index, closeIndex + 1);
    if (
      text.includes("bundled_plugins_reconcile_skipped_features_unavailable") &&
      text.includes(".getLocalAppServerConnection()") &&
      text.includes(".listPlugins(")
    ) {
      matches.push({ argumentVar: match[2], closeIndex, match, openIndex, text });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function hasLinuxComputerUseAuthorityIntegrations(source) {
  const controller = findBundledPluginController(source);
  if (controller == null) return false;
  const listArguments = [...controller.text.matchAll(/\.listPlugins\(([^()]*)\)/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
  const marketplaceRoots = [
    ...controller.text.matchAll(/runtimeMarketplaceRoot:([A-Za-z_$][\w$]*)/g),
  ]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
  if (
    listArguments.length !== 1 ||
    !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(listArguments[0]) ||
    marketplaceRoots.length !== 1
  ) {
    return false;
  }
  const configureExpression =
    `process.platform===\`linux\`&&chatgptLinuxConfigureComputerUseAuthority(()=>${controller.argumentVar}.getLocalAppServerConnection(),()=>${listArguments[0]},()=>${marketplaceRoots[0]});`;
  if (findExecutableJavaScriptSubstring(controller.text, configureExpression) < 0) return false;

  const featureMatches = [
    ...source.matchAll(/if\(([A-Za-z_$][\w$]*)\.type===`electron-desktop-features-changed`\)\{/g),
  ];
  if (featureMatches.length !== 1 || featureMatches[0].index == null) return false;
  const featureMatch = featureMatches[0];
  const messageVar = featureMatch[1];
  const featureOpenIndex = featureMatch.index + featureMatch[0].length - 1;
  const featureCloseIndex = findMatchingBrace(source, featureOpenIndex);
  if (featureCloseIndex < 0) return false;
  const featureSource = source.slice(featureMatch.index, featureCloseIndex + 1);
  const disableExpression =
    `if(${messageVar}.type===\`chatgpt-linux-computer-use-disable-requested\`){chatgptLinuxSetOfficialComputerUseEligibility(!1);return}`;
  const revokeExpression =
    `process.platform===\`linux\`&&${messageVar}.computerUse!==!0&&chatgptLinuxSetOfficialComputerUseEligibility(!1);`;
  const enableExpression =
    `process.platform===\`linux\`&&${messageVar}.computerUse===!0&&chatgptLinuxSetOfficialComputerUseEligibility(!0),`;
  const revokeIndex = findExecutableJavaScriptSubstring(featureSource, revokeExpression);
  const reconcileIndex = findExecutableJavaScriptSubstring(
    featureSource,
    `,${messageVar}.bundledPluginEligibilityReasons),`,
    revokeIndex + revokeExpression.length,
  );
  const enableIndex = findExecutableJavaScriptSubstring(
    featureSource,
    enableExpression,
    reconcileIndex + 1,
  );
  const disableIndex = featureMatch.index - disableExpression.length;
  const hasAdjacentDisableBranch = disableIndex >= 0 &&
    source.slice(disableIndex, featureMatch.index) === disableExpression;
  return hasAdjacentDisableBranch &&
    revokeIndex >= 0 && reconcileIndex > revokeIndex && enableIndex > reconcileIndex;
}

function hasCompleteLinuxComputerUseAuthorityPatch(source) {
  return findExecutableJavaScriptSubstring(
    source,
    linuxComputerUseAuthorityRuntimeSource(),
  ) >= 0 &&
    hasLinuxComputerUseAuthorityIntegrations(source) && [
    "/*chatgpt-linux-computer-use-authority-connection*/",
    "/*chatgpt-linux-computer-use-authority-event*/",
    "chatgpt-linux-computer-use-disable-requested",
  ].every((marker) => source.includes(marker));
}

function applyLinuxComputerUseAuthorityPatch(currentSource) {
  const hasRuntime = currentSource.includes(LINUX_COMPUTER_USE_AUTHORITY_MARKER);
  const hasConfigure = currentSource.includes("/*chatgpt-linux-computer-use-authority-connection*/");
  const hasEvent = currentSource.includes("/*chatgpt-linux-computer-use-authority-event*/");
  const hasDisable = currentSource.includes("chatgpt-linux-computer-use-disable-requested");
  if (hasCompleteLinuxComputerUseAuthorityPatch(currentSource)) return currentSource;
  if (hasRuntime || hasConfigure || hasEvent || hasDisable) {
    throw new Error("Required Linux Computer Use authority patch is only partially present");
  }

  const controller = findBundledPluginController(currentSource);
  if (controller == null) {
    throw new Error("Required Linux Computer Use authority patch failed: bundled plugin controller unavailable or ambiguous");
  }
  const listArguments = [...controller.text.matchAll(/\.listPlugins\(([^()]*)\)/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
  const marketplaceRoots = [
    ...controller.text.matchAll(/runtimeMarketplaceRoot:([A-Za-z_$][\w$]*)/g),
  ]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
  if (
    listArguments.length !== 1 ||
    !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(listArguments[0]) ||
    marketplaceRoots.length !== 1
  ) {
    throw new Error("Required Linux Computer Use authority patch failed: bundled marketplace contract unavailable or ambiguous");
  }

  const featureBlockPattern = /if\(([A-Za-z_$][\w$]*)\.type===`electron-desktop-features-changed`\)\{/g;
  const featureMatches = [...currentSource.matchAll(featureBlockPattern)];
  if (featureMatches.length !== 1 || featureMatches[0].index == null) {
    throw new Error("Required Linux Computer Use authority patch failed: validated desktop feature event unavailable or ambiguous");
  }
  const featureMatch = featureMatches[0];
  const messageVar = featureMatch[1];
  const featureOpenIndex = featureMatch.index + featureMatch[0].length - 1;
  const featureCloseIndex = findMatchingBrace(currentSource, featureOpenIndex);
  const featureText = currentSource.slice(featureMatch.index, featureCloseIndex + 1);
  if (
    featureCloseIndex < 0 ||
    !featureText.includes(`computerUse:${messageVar}.computerUse`) ||
    !featureText.includes(`${messageVar}.bundledPluginEligibilityReasons`)
  ) {
    throw new Error("Required Linux Computer Use authority patch failed: desktop feature payload contract drifted");
  }
  const setterPattern = new RegExp(
    `([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*),${messageVar}\\.bundledPluginEligibilityReasons\\),`,
  );
  const setterMatch = featureText.match(setterPattern);
  if (setterMatch == null) {
    throw new Error("Required Linux Computer Use authority patch failed: desktop feature reconciliation call unavailable");
  }

  const controllerInsertion =
    `/*chatgpt-linux-computer-use-authority-connection*/process.platform===\`linux\`&&chatgptLinuxConfigureComputerUseAuthority(()=>${controller.argumentVar}.getLocalAppServerConnection(),()=>${listArguments[0]},()=>${marketplaceRoots[0]});`;
  let patchedSource =
    currentSource.slice(0, controller.openIndex + 1) +
    controllerInsertion +
    currentSource.slice(controller.openIndex + 1);

  const adjustedFeatureIndex = featureMatch.index + controllerInsertion.length;
  const disableBranch =
    `if(${messageVar}.type===\`chatgpt-linux-computer-use-disable-requested\`){chatgptLinuxSetOfficialComputerUseEligibility(!1);return}`;
  patchedSource =
    patchedSource.slice(0, adjustedFeatureIndex) +
    disableBranch +
    patchedSource.slice(adjustedFeatureIndex);

  const adjustedFeatureOpenIndex =
    featureOpenIndex + controllerInsertion.length + disableBranch.length;
  const revokeBeforeReconcile =
    `/*chatgpt-linux-computer-use-authority-event*/process.platform===\`linux\`&&${messageVar}.computerUse!==!0&&chatgptLinuxSetOfficialComputerUseEligibility(!1);`;
  patchedSource =
    patchedSource.slice(0, adjustedFeatureOpenIndex + 1) +
    revokeBeforeReconcile +
    patchedSource.slice(adjustedFeatureOpenIndex + 1);

  const setterSource = setterMatch[0];
  const setterIndex = patchedSource.indexOf(
    setterSource,
    adjustedFeatureIndex + disableBranch.length,
  );
  if (setterIndex < 0) {
    throw new Error("Required Linux Computer Use authority patch failed: reconciliation insertion drifted");
  }
  const enableAfterReconcile =
    `${setterMatch[1]}(${setterMatch[2]},${messageVar}.bundledPluginEligibilityReasons),process.platform===\`linux\`&&${messageVar}.computerUse===!0&&chatgptLinuxSetOfficialComputerUseEligibility(!0),`;
  patchedSource =
    patchedSource.slice(0, setterIndex) +
    enableAfterReconcile +
    patchedSource.slice(setterIndex + setterSource.length);

  return insertAfterUseStrict(patchedSource, linuxComputerUseAuthorityRuntimeSource());
}

function matchesLinuxComputerUseAuthorityContract(currentSource) {
  return hasCompleteLinuxComputerUseAuthorityPatch(currentSource) ||
    (() => {
      try {
        return applyLinuxComputerUseAuthorityPatch(currentSource) !== currentSource;
      } catch {
        return false;
      }
    })();
}

function executableRegexMatches(currentSource, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...currentSource.matchAll(new RegExp(pattern.source, flags))].filter(
    (match) => match.index != null &&
      findExecutableJavaScriptSubstring(currentSource, match[0], match.index) === match.index,
  );
}

function findLinuxComputerUsePluginConfigMutations(currentSource, patched) {
  const pattern = patched
    ? /let\{pluginId:([A-Za-z_$][\w$]*),enabled:([A-Za-z_$][\w$]*)((?:,[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*)*)\}=([A-Za-z_$][\w$]*);if\(\1===`computer-use@openai-bundled`&&\2!==!0\)await ([A-Za-z_$][\w$]*)\.dispatchMessage\(`chatgpt-linux-computer-use-disable-requested`,\{\}\);\/\*chatgpt-linux-computer-use-disable-before-write\*\/let ([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\(([^()]*)\)(?:,([A-Za-z_$][\w$]*)=await |;await )([A-Za-z_$][\w$]*)\(`batch-write-config-value`,/g
    : /let\{pluginId:([A-Za-z_$][\w$]*),enabled:([A-Za-z_$][\w$]*)((?:,[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*)*)\}=([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\(([^()]*)\)(?:,([A-Za-z_$][\w$]*)=await |;await )([A-Za-z_$][\w$]*)\(`batch-write-config-value`,/g;
  const results = [];
  for (const match of executableRegexMatches(currentSource, pattern)) {
    if (match.index == null) continue;
    const optionsStart = match.index + match[0].length;
    if (currentSource[optionsStart] !== "{") continue;
    const optionsEnd = findMatchingBrace(currentSource, optionsStart);
    if (optionsEnd < optionsStart || currentSource[optionsEnd + 1] !== ")") continue;

    const idVar = match[1];
    const enabledVar = match[2];
    const readResultVar = patched ? match[6] : match[5];
    const options = currentSource.slice(optionsStart, optionsEnd + 1);
    const optionsPattern = new RegExp(
      `^\\{hostId:[A-Za-z_$][\\w$]*,edits:[A-Za-z_$][\\w$]*\\(\\{pluginId:${escapeRegExp(idVar)},enabled:${escapeRegExp(enabledVar)}\\}\\),` +
      `filePath:${escapeRegExp(readResultVar)}\\?\\.filePath\\?\\?null,` +
      `expectedVersion:${escapeRegExp(readResultVar)}\\?\\.expectedVersion\\?\\?null,reloadUserConfig:!0\\}$`,
    );
    if (!optionsPattern.test(options)) continue;

    results.push({
      argumentVar: match[4],
      dispatchVar: patched ? match[5] : null,
      enabledVar,
      end: optionsEnd + 2,
      extraBindings: match[3],
      idVar,
      index: match.index,
      options,
      readArguments: patched ? match[8] : match[7],
      readFunctionVar: patched ? match[7] : match[6],
      readResultVar,
      writeFunctionVar: patched ? match[10] : match[9],
      writeResultVar: patched ? match[9] : match[8],
    });
  }
  return results;
}

function findLinuxComputerUseDesktopFeatureDispatches(currentSource) {
  const pattern =
    /([A-Za-z_$][\w$]*)\.dispatchMessage\(`electron-desktop-features-changed`,/g;
  return [...currentSource.matchAll(pattern)].filter((match) => {
    if (match.index == null) return false;
    const containing = findContainingFunction(currentSource, match.index);
    if (containing == null) return false;
    const precedingStatement = currentSource.lastIndexOf(";", containing.start - 1);
    const contextStart = precedingStatement < 0 ? 0 : precedingStatement + 1;
    const context = currentSource.slice(contextStart, containing.closeIndex + 1);
    return findExecutableJavaScriptSubstring(
      context,
      match[0],
      match.index - contextStart,
    ) === match.index - contextStart;
  });
}

function hasLinuxComputerUseDisableOrderingContract(currentSource) {
  const dispatchMatches = findLinuxComputerUseDesktopFeatureDispatches(currentSource);
  const contractMatches = findLinuxComputerUsePluginConfigMutations(
    currentSource,
    true,
  );
  return dispatchMatches.length === 1 &&
    contractMatches.length === 1 &&
    contractMatches[0].dispatchVar === dispatchMatches[0][1];
}

function applyLinuxComputerUseDisableOrderingPatch(currentSource) {
  if (hasLinuxComputerUseDisableOrderingContract(currentSource)) return currentSource;
  const dispatchMatches = findLinuxComputerUseDesktopFeatureDispatches(currentSource);
  const dispatchVar = dispatchMatches.length === 1 ? dispatchMatches[0][1] : null;
  const matches = findLinuxComputerUsePluginConfigMutations(currentSource, false);
  if (dispatchVar == null || matches.length !== 1 || matches[0].index == null) {
    throw new Error("Required Linux Computer Use disable ordering patch failed: plugin config mutation unavailable or ambiguous");
  }
  const match = matches[0];
  const writePrefix = match.writeResultVar == null
    ? `;await ${match.writeFunctionVar}`
    : `,${match.writeResultVar}=await ${match.writeFunctionVar}`;
  const replacement =
    `let{pluginId:${match.idVar},enabled:${match.enabledVar}${match.extraBindings}}=${match.argumentVar};` +
    `if(${match.idVar}===\`computer-use@openai-bundled\`&&${match.enabledVar}!==!0)await ${dispatchVar}.dispatchMessage(\`chatgpt-linux-computer-use-disable-requested\`,{});` +
    `/*${LINUX_COMPUTER_USE_DISABLE_ORDERING_MARKER}*/let ${match.readResultVar}=await ${match.readFunctionVar}(${match.readArguments})${writePrefix}(\`batch-write-config-value\`,${match.options})`;
  const result = currentSource.slice(0, match.index) + replacement +
    currentSource.slice(match.end);
  if (!hasLinuxComputerUseDisableOrderingContract(result)) {
    throw new Error(
      "Required Linux Computer Use disable ordering patch did not produce a complete contract",
    );
  }
  return result;
}

function matchesLinuxComputerUseDisableOrderingContract(currentSource) {
  if (hasLinuxComputerUseDisableOrderingContract(currentSource)) return true;
  try {
    return applyLinuxComputerUseDisableOrderingPatch(currentSource) !== currentSource;
  } catch {
    return false;
  }
}

function linuxComputerUseCursorBridgeRuntimeSource() {
  return [
    "function chatgptLinuxComputerUseCursorComponent(e){return typeof e==`string`&&e!==`.`&&e!==`..`&&/^[A-Za-z0-9._-]+$/.test(e)}function chatgptLinuxComputerUseCursorSocketPath(){let e=process.env.XDG_RUNTIME_DIR?.trim();if(!e)return null;let t=require(`node:path`);if(!t.isAbsolute(e))return null;let n=(process.env.CHATGPT_LINUX_APP_ID||process.env.CHATGPT_APP_ID||`chatgpt`).trim();chatgptLinuxComputerUseCursorComponent(n)||(n=`chatgpt`);let r=process.env.CHATGPT_LINUX_INSTANCE_ID?.trim()||``;if(r&&!chatgptLinuxComputerUseCursorComponent(r))return null;let i=r?t.join(e,n,`instances`,r,`computer-use-cursor.sock`):t.join(e,n,`computer-use-cursor.sock`);return Buffer.byteLength(i,`utf8`)<=100?i:null}",
    "function chatgptLinuxStopComputerUseCursorBridge(){let e=chatgptLinuxRegisterComputerUseCursorHandler;e.timer!=null&&(clearTimeout(e.timer),e.timer=null);let t=e.server;e.server=null;try{t?.close()}catch{}let n=e.socketIdentity,r=e.socketPath;e.socketIdentity=null;if(n!=null&&r!=null)try{let e=require(`node:fs`).lstatSync(r);e.dev===n.dev&&e.ino===n.ino&&e.isSocket()&&require(`node:fs`).unlinkSync(r)}catch{}}",
    "function chatgptLinuxStartComputerUseCursorBridge(){let e=chatgptLinuxRegisterComputerUseCursorHandler;if(e.server!=null)return!0;let t=chatgptLinuxComputerUseCursorSocketPath();if(t==null||typeof e.handler!==`function`)return!1;try{let n=require(`node:path`),r=require(`node:fs`),i=require(`node:net`),a=require(`electron`),o=n.dirname(t),s=typeof process.getuid==`function`?process.getuid():null,l=r.lstatSync(process.env.XDG_RUNTIME_DIR.trim());if(!l.isDirectory()||l.isSymbolicLink()||s==null||l.uid!==s||(l.mode&511)!==448)return!1;r.mkdirSync(o,{recursive:!0,mode:448});let u=r.lstatSync(o);if(!u.isDirectory()||u.isSymbolicLink()||u.uid!==s||(u.mode&511)!==448||r.existsSync(t))return!1;let c=()=>{try{let t=e.handler;if(typeof t!=`function`)return;let n=a.screen.getCursorScreenPoint();t({isActive:!0,x:n.x,y:n.y}),e.timer!=null&&clearTimeout(e.timer),e.timer=setTimeout(()=>{try{let t=e.handler;typeof t==`function`&&t({isActive:!1,x:n.x,y:n.y})}catch{}finally{e.timer=null}},900),e.timer.unref?.()}catch{}},d=i.createServer(t=>{let n=``,r=!1;t.setEncoding(`utf8`),t.setTimeout(250,()=>t.destroy()),t.on(`error`,()=>{}),t.on(`data`,i=>{if(r)return;n+=i;if(n.length>64){r=!0,t.destroy();return}if(n.includes(`\\n`)){r=!0,n.trim()===`pointer`&&c(),t.end()}})});return e.server=d,e.socketPath=t,d.on(`error`,()=>{e.server===d&&(e.server=null),chatgptLinuxStopComputerUseCursorBridge()}),d.listen(t,()=>{try{r.chmodSync(t,384);let n=r.lstatSync(t);if(!n.isSocket()||n.uid!==s||(n.mode&511)!==384)throw Error(`unsafe cursor socket`);e.socketIdentity={dev:n.dev,ino:n.ino},d.unref()}catch{chatgptLinuxStopComputerUseCursorBridge()}}),!0}catch{return e.server=null,!1}}",
    "function chatgptLinuxRegisterComputerUseCursorHandler(e){let t=chatgptLinuxRegisterComputerUseCursorHandler;if(typeof chatgptLinuxRegisterComputerUseRevocation!==`function`||typeof chatgptLinuxRegisterComputerUseGrant!==`function`)return!1;t.handler=e,t.authorityHooksRegistered||(t.authorityHooksRegistered=!0,chatgptLinuxRegisterComputerUseRevocation(chatgptLinuxStopComputerUseCursorBridge),chatgptLinuxRegisterComputerUseGrant(chatgptLinuxStartComputerUseCursorBridge),require(`electron`).app.once(`before-quit`,chatgptLinuxStopComputerUseCursorBridge));return!0}",
  ].join("");
}

function findComputerUseCursorRegistrationFunction(source) {
  const markerIndex = source.indexOf(COMPUTER_USE_CURSOR_HANDLER_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const functionRegex = /function ([A-Za-z_$][\w$]*)\(([^)]*)\)\{/g;
  let candidate = null;
  let match;
  while ((match = functionRegex.exec(source)) != null && match.index < markerIndex) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex >= markerIndex) {
      candidate = {
        match,
        start: match.index,
        end: closeIndex + 1,
        text: source.slice(match.index, closeIndex + 1),
      };
    }
  }
  return candidate;
}

function hasCompleteLinuxComputerUseAvatarCursorPatch(source) {
  const runtime = linuxComputerUseCursorBridgeRuntimeSource();
  const externalOpenRuntime = runtime.replace(
    "a=require(`electron`)",
    "a=chatgptLinuxPatchExternalOpen(require(`electron`))",
  );
  const hasCanonicalRuntime = findExecutableJavaScriptSubstring(source, runtime) >= 0;
  const hasExternalOpenRuntime =
    findExecutableJavaScriptSubstring(
      source,
      "function chatgptLinuxPatchExternalOpen(",
    ) >= 0 &&
    findExecutableJavaScriptSubstring(source, externalOpenRuntime) >= 0;
  if (!hasCanonicalRuntime && !hasExternalOpenRuntime) return false;
  const registration = findComputerUseCursorRegistrationFunction(source);
  const handlerVar = registration?.match[2].match(/^\s*([A-Za-z_$][\w$]*)\s*,/)?.[1] ?? null;
  const platformVar = registration?.match[2].match(
    /platform:([A-Za-z_$][\w$]*)=process\.platform/,
  )?.[1] ?? null;
  return registration != null && handlerVar != null && platformVar != null &&
    findExecutableJavaScriptSubstring(
      registration.text,
      `if(${platformVar}===\`linux\`)return chatgptLinuxRegisterComputerUseCursorHandler(${handlerVar});`,
    ) >= 0;
}

function applyLinuxComputerUseAvatarCursorBridgePatch(currentSource) {
  if (hasCompleteLinuxComputerUseAvatarCursorPatch(currentSource)) return currentSource;
  if (currentSource.includes(LINUX_COMPUTER_USE_CURSOR_BRIDGE_MARKER)) {
    throw new Error("Required Linux Computer Use avatar cursor patch is only partially present");
  }

  const registration = findComputerUseCursorRegistrationFunction(currentSource);
  const handlerVar = registration?.match[2].match(/^\s*([A-Za-z_$][\w$]*)\s*,/)?.[1] ?? null;
  const platformVar = registration?.match[2].match(
    /platform:([A-Za-z_$][\w$]*)=process\.platform/,
  )?.[1] ?? null;
  if (registration == null || handlerVar == null || platformVar == null) {
    const reason = currentSource.includes(COMPUTER_USE_CURSOR_HANDLER_MARKER)
      ? "Could not identify the Computer Use cursor registration function"
      : "Could not find the Computer Use cursor handler marker";
    console.warn(`WARN: ${reason} - skipping Linux avatar cursor bridge patch`);
    return currentSource;
  }

  const darwinGuard = `if(${platformVar}!==\`darwin\`)return!1;`;
  if (!registration.text.includes(darwinGuard)) {
    console.warn(
      "WARN: Computer Use cursor registration no longer has the expected Darwin guard - skipping Linux avatar cursor bridge patch",
    );
    return currentSource;
  }

  const patchedRegistration = registration.text.replace(
    darwinGuard,
    `if(${platformVar}===\`linux\`)return chatgptLinuxRegisterComputerUseCursorHandler(${handlerVar});${darwinGuard}`,
  );
  return currentSource.slice(0, registration.start) +
    linuxComputerUseCursorBridgeRuntimeSource() +
    patchedRegistration +
    currentSource.slice(registration.end);
}

function matchesLinuxComputerUseAvatarCursorContract(currentSource) {
  if (hasCompleteLinuxComputerUseAvatarCursorPatch(currentSource)) return true;
  if (currentSource.includes(LINUX_COMPUTER_USE_CURSOR_BRIDGE_MARKER)) return false;
  const registration = findComputerUseCursorRegistrationFunction(currentSource);
  const handlerVar = registration?.match[2].match(/^\s*([A-Za-z_$][\w$]*)\s*,/)?.[1] ?? null;
  const platformVar = registration?.match[2].match(
    /platform:([A-Za-z_$][\w$]*)=process\.platform/,
  )?.[1] ?? null;
  return registration != null && handlerVar != null && platformVar != null &&
    registration.text.includes(`if(${platformVar}!==\`darwin\`)return!1;`);
}

// Lookback/lookahead windows used when searching for the nearest minified
// identifier or surrounding context around a regex anchor in the bundle.
// Sized empirically to the typical distance between a feature's anchor and
// the helper aliases it depends on.
const TRAY_GUARD_LOOKAHEAD = 1200;
const CLOSE_GATE_PREFIX_LOOKBACK = 8000;
const HANDLER_PREFIX_LOOKBACK = 12000;
const DIRECT_HANDLER_PROXIMITY = 1200;

const linuxSettingsKeys = {
  promptWindow: "chatgpt-linux-prompt-window-enabled",
  systemTray: "chatgpt-linux-system-tray-enabled",
  warmStart: "chatgpt-linux-warm-start-enabled",
};

function parseDestructuredParamAliases(paramsText) {
  const aliases = Object.create(null);
  for (const rawPart of paramsText.split(",")) {
    const part = rawPart.trim();
    const match = part.match(/^([A-Za-z_$][\w$]*)(?::([A-Za-z_$][\w$]*))?$/);
    if (match != null) {
      aliases[match[1]] = match[2] ?? match[1];
    }
  }
  return aliases;
}

function buildComputerUseGate({ nameExpr, availabilityProp, featuresVar, platformVar, migrateVar }) {
  return `{installWhenMissing:!0,name:${nameExpr},${availabilityProp}:({features:${featuresVar},platform:${platformVar}})=>(${platformVar}===\`linux\`||${platformVar}===\`darwin\`)&&${featuresVar}.computerUse,migrate:${migrateVar}}`;
}

function rewriteComputerUseMarketplaceSelector(currentSource) {
  const marketplaceGateRegex =
    /if\(!\(\s*([A-Za-z_$][\w$]*)\.platform!==`darwin`\|\|!\s*\1\.marketplacePluginNames\.includes\(`computer-use`\)\s*\)\)return\s*\1\.desktopFeatureAvailability\.computerUseNodeRepl\?`node-repl`:`legacy-mcp`/g;
  return currentSource.replace(
    marketplaceGateRegex,
    (_match, ref) =>
      `if(!((${ref}.platform!==\`darwin\`&&${ref}.platform!==\`linux\`)||!${ref}.marketplacePluginNames.includes(\`computer-use\`)))return ${ref}.platform===\`darwin\`&&${ref}.desktopFeatureAvailability.computerUseNodeRepl?\`node-repl\`:\`legacy-mcp\``,
  );
}

function hasPatchedComputerUseMarketplaceSelector(currentSource) {
  return /if\(!\(\(\s*([A-Za-z_$][\w$]*)\.platform!==`darwin`&&\1\.platform!==`linux`\)\|\|!\1\.marketplacePluginNames\.includes\(`computer-use`\)\)\)return\s+\1\.platform===`darwin`&&\1\.desktopFeatureAvailability\.computerUseNodeRepl\?`node-repl`:`legacy-mcp`/.test(currentSource);
}

function buildFlexibleComputerUseGate({
  availabilityProp,
  expressionSuffix,
  featuresVar,
  middleFields,
  nameExpr,
  platformVar,
  prefix,
}) {
  const installField = prefix.includes("installWhenMissing:!0,") ||
      middleFields.includes("installWhenMissing:!0,") ||
      expressionSuffix.includes("installWhenMissing:!0,")
    ? ""
    : "installWhenMissing:!0,";
  return `{${prefix}${installField}name:${nameExpr},${middleFields}${availabilityProp}:({features:${featuresVar},platform:${platformVar}})=>(${platformVar}===\`linux\`||${platformVar}===\`darwin\`)&&${featuresVar}.computerUse${expressionSuffix}}`;
}

function hasComputerUseLiteral(source) {
  return /(?:`computer-use`|"computer-use"|'computer-use')/.test(source);
}

function isComputerUseNameExpr(nameExpr, computerUseNameVar) {
  return /^(?:`computer-use`|"computer-use"|'computer-use')$/.test(nameExpr) ||
    nameExpr === computerUseNameVar ||
    /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(nameExpr);
}

function applyLinuxComputerUsePluginGatePatch(currentSource) {
  if (!hasComputerUseLiteral(currentSource)) {
    console.warn(
      "WARN: Could not find Computer Use plugin gate literal — skipping Linux Computer Use plugin gate patch",
    );
    return currentSource;
  }

  const sourceWithMarketplaceSelector = rewriteComputerUseMarketplaceSelector(currentSource);
  const hasMarketplaceSelectorPatch =
    sourceWithMarketplaceSelector !== currentSource ||
    hasPatchedComputerUseMarketplaceSelector(sourceWithMarketplaceSelector);

  const computerUseNameVar = sourceWithMarketplaceSelector.match(/([A-Za-z_$][\w$]*)=(?:`computer-use`|"computer-use"|'computer-use')/)?.[1] ?? null;
  const nameExpressionPattern = String.raw`(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?|` +
    String.raw`\`computer-use\`|"computer-use"|'computer-use')`;
  const gateRegex =
    new RegExp(String.raw`\{(installWhenMissing:!0,)?name:(${nameExpressionPattern}),(isEnabled|isAvailable):\(\{([^}]*)\}\)=>([^{}]*?\.computerUse),migrate:([A-Za-z_$][\w$]*)\}`, "g");
  let sawEnabledGate = false;
  let sawUnpatchableGate = false;
  let patchedGateCount = 0;
  const patchedSource = sourceWithMarketplaceSelector.replace(
    gateRegex,
    (gateSource, installWhenMissing, nameExpr, availabilityProp, paramsText, expression, migrateVar) => {
      if (!isComputerUseNameExpr(nameExpr, computerUseNameVar)) {
        return gateSource;
      }

      const aliases = parseDestructuredParamAliases(paramsText);
      const featuresVar = aliases.features;
      const platformVar = aliases.platform;
      if (featuresVar == null || platformVar == null) {
        sawUnpatchableGate = true;
        return gateSource;
      }

      const darwinOnlyExpression = `${platformVar}===\`darwin\`&&${featuresVar}.computerUse`;
      const linuxExpression = `(${platformVar}===\`darwin\`||${platformVar}===\`linux\`)&&${featuresVar}.computerUse`;
      const linuxRegisteredExpression = `(${platformVar}===\`linux\`||${platformVar}===\`darwin\`)&&${featuresVar}.computerUse`;
      const unsafeLinuxExpression = `${platformVar}===\`linux\`||${platformVar}===\`darwin\`&&${featuresVar}.computerUse`;
      if (installWhenMissing != null && expression === linuxRegisteredExpression) {
        sawEnabledGate = true;
        return gateSource;
      }
      if (
        expression === darwinOnlyExpression ||
        expression === linuxExpression ||
        expression === linuxRegisteredExpression ||
        expression === unsafeLinuxExpression
      ) {
        patchedGateCount += 1;
        return buildComputerUseGate({ nameExpr, availabilityProp, featuresVar, platformVar, migrateVar });
      }
      sawUnpatchableGate = true;
      return gateSource;
    },
  );

  if (patchedGateCount > 0) {
    return patchedSource;
  }

  const flexibleGateRegex =
    new RegExp(String.raw`\{([^{}]*?)name:(${nameExpressionPattern}),([^{}]*?)(isEnabled|isAvailable):\(\{([^}]*)\}\)=>([^{}]*?\.computerUse)([^{}]*?)\}`, "g");
  let flexiblePatchedCount = 0;
  const flexiblyPatchedSource = sourceWithMarketplaceSelector.replace(
    flexibleGateRegex,
    (gateSource, prefix, nameExpr, middleFields, availabilityProp, paramsText, expression, expressionSuffix) => {
      if (!isComputerUseNameExpr(nameExpr, computerUseNameVar)) {
        return gateSource;
      }

      const aliases = parseDestructuredParamAliases(paramsText);
      const featuresVar = aliases.features;
      const platformVar = aliases.platform;
      if (featuresVar == null || platformVar == null) {
        sawUnpatchableGate = true;
        return gateSource;
      }

      const darwinOnlyExpression = `${platformVar}===\`darwin\`&&${featuresVar}.computerUse`;
      const linuxExpression = `(${platformVar}===\`darwin\`||${platformVar}===\`linux\`)&&${featuresVar}.computerUse`;
      const linuxRegisteredExpression = `(${platformVar}===\`linux\`||${platformVar}===\`darwin\`)&&${featuresVar}.computerUse`;
      const unsafeLinuxExpression = `${platformVar}===\`linux\`||${platformVar}===\`darwin\`&&${featuresVar}.computerUse`;
      if (
        prefix.includes("installWhenMissing:!0,") &&
        expression === linuxRegisteredExpression
      ) {
        sawEnabledGate = true;
        return gateSource;
      }
      if (expression.includes("win32") || expression.includes("isInternal")) {
        return gateSource;
      }
      if (
        expression === darwinOnlyExpression ||
        expression === linuxExpression ||
        expression === linuxRegisteredExpression ||
        expression === unsafeLinuxExpression
      ) {
        flexiblePatchedCount += 1;
        return buildFlexibleComputerUseGate({
          availabilityProp,
          expressionSuffix,
          featuresVar,
          middleFields,
          nameExpr,
          platformVar,
          prefix,
        });
      }
      sawUnpatchableGate = true;
      return gateSource;
    },
  );

  if (flexiblePatchedCount > 0) {
    return flexiblyPatchedSource;
  }

  if (sawEnabledGate && !sawUnpatchableGate) {
    return sourceWithMarketplaceSelector;
  }

  if (hasMarketplaceSelectorPatch && !sawUnpatchableGate) {
    return sourceWithMarketplaceSelector;
  }

  if (hasComputerUseLiteral(sourceWithMarketplaceSelector) && sourceWithMarketplaceSelector.includes("computerUse")) {
    throw new Error("Required Linux Computer Use plugin gate patch failed: could not enable bundled Computer Use on Linux");
  }

  return sourceWithMarketplaceSelector;
}

function applyLinuxComputerUseFeaturePatch(currentSource, options = {}) {
  let changed = false;
  let patchedSource = currentSource.replace(
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),\{env:([A-Za-z_$][\w$]*)=process\.env,platform:([A-Za-z_$][\w$]*)=process\.platform\}=\{\}\)\{return \4===`linux`\?\{\.\.\.\2,computerUse:!0,computerUseNodeRepl:!0\}:(\4!==`win32`\|\|\3\.CHATGPT_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE!==`1`\?\2:\{\.\.\.\2,computerUse:!0,computerUseNodeRepl:!0\})\}/g,
    (_match, functionName, featuresVar, envVar, platformVar, officialExpression) => {
      changed = true;
      return `function ${functionName}(${featuresVar},{env:${envVar}=process.env,platform:${platformVar}=process.platform}={}){return ${officialExpression}}`;
    },
  );
  patchedSource = patchedSource.replace(
    /([,;]|let )([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)===`linux`\?\{\.\.\.([A-Za-z_$][\w$]*),computerUse:!0,computerUseNodeRepl:!0\}:\3===`win32`&&([A-Za-z_$][\w$]*)\.CHATGPT_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===`1`\?\{\.\.\.\4,computerUse:!0,computerUseNodeRepl:!0\}:\4,/g,
    (_match, prefix, gateVar, platformVar, featuresVar, envVar) => {
      changed = true;
      return `${prefix}${gateVar}=${platformVar}===\`win32\`&&${envVar}.CHATGPT_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===\`1\`?{...${featuresVar},computerUse:!0,computerUseNodeRepl:!0}:${featuresVar},`;
    },
  );

  if (
    !changed &&
    options.warn !== false &&
    /===`linux`\?\{\.\.\.[A-Za-z_$][\w$]*,computerUse:!0,computerUseNodeRepl:!0\}/.test(currentSource)
  ) {
    console.warn(
      "WARN: Could not remove a legacy Linux Computer Use desktop feature override",
    );
  }
  return patchedSource;
}

function matchesLinuxComputerUseFeatureContract(currentSource) {
  return !/===`linux`\?\{\.\.\.[A-Za-z_$][\w$]*,computerUse:!0,computerUseNodeRepl:!0\}/.test(
    applyLinuxComputerUseFeaturePatch(currentSource, { warn: false }),
  );
}

function findContainingFunction(source, targetIndex) {
  const functionPattern = /function ([A-Za-z_$][\w$]*)\(([^)]*)\)\{/g;
  let containing = null;
  let match;
  while ((match = functionPattern.exec(source)) != null && match.index < targetIndex) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex >= targetIndex) {
      containing = {
        closeIndex,
        match,
        openIndex,
        start: match.index,
        text: source.slice(match.index, closeIndex + 1),
      };
    }
  }
  return containing;
}

function applyComputerUseSettings26803Contract(currentSource) {
  const markerPattern =
    /let ([A-Za-z_$][\w$]*BundledMarketplaceDonor)=([A-Za-z_$][\w$]*)\.availablePlugins\.find\(e=>e\.marketplaceName===`openai-bundled`[\s\S]{0,600}?let ([A-Za-z_$][\w$]*OfficialPluginState)=\[\.\.\.\2\.availablePlugins,\.\.\.\(\2\.installedPlugins\?\?\[\]\)\]\.find\(e=>\1!=null&&e\.marketplaceName===`openai-bundled`&&e\.marketplacePath===\1\.marketplacePath&&e\.plugin\?\.id===`computer-use@openai-bundled`&&e\.plugin\?\.name===([A-Za-z_$][\w$]*)\);[\s\S]{0,500}?!\2\.availablePlugins\.some\(e=>e\.marketplaceName===`openai-bundled`&&e\.marketplacePath===\1\.marketplacePath&&e\.plugin\?\.id===`computer-use@openai-bundled`&&e\.plugin\?\.name===\4\)[\s\S]{0,800}?plugin:\{id:`computer-use@openai-bundled`,name:\4,installed:\3\?\.plugin\?\.installed===!0,enabled:\3\?\.plugin\?\.enabled===!0/;
  if (markerPattern.test(currentSource)) return currentSource;
  if (
    currentSource.includes("BundledMarketplaceDonor") ||
    currentSource.includes("OfficialPluginState")
  ) {
    return null;
  }

  const selectionPattern =
    /([A-Za-z_$][\w$]*)\[\d+\]!==([A-Za-z_$][\w$]*)\|\|\1\[\d+\]!==([A-Za-z_$][\w$]*)\.availablePlugins\?\(([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\3\.availablePlugins,([A-Za-z_$][\w$]*),\2\),\1\[\d+\]=\2,\1\[\d+\]=\3\.availablePlugins,\1\[\d+\]=\4\):\4=\1\[\d+\];/g;
  const candidates = [...currentSource.matchAll(selectionPattern)].filter((match) => {
    if (match.index == null) return false;
    const containing = findContainingFunction(currentSource, match.index);
    return containing?.text.includes("computerUseAvailability:") === true;
  });
  const computerUseSelections = candidates.filter((match) =>
    currentSource.includes(`${match[6]}=\`computer-use\``),
  );
  const selections = computerUseSelections.length === 1
    ? computerUseSelections
    : candidates.length === 1
      ? candidates
      : [];
  if (selections.length !== 1 || selections[0].index == null) return null;

  const selection = selections[0];
  const containing = findContainingFunction(currentSource, selection.index);
  if (containing == null) return null;
  const paramsVar = containing.match[2].trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(paramsVar)) return null;
  const platformVar = containing.text.match(
    new RegExp(
      String.raw`\{computerUseAvailability:[A-Za-z_$][\w$]*,platform:([A-Za-z_$][\w$]*)\}=${paramsVar}`,
    ),
  )?.[1];
  const marketplaceVar = selection[2];
  const pluginsVar = selection[3];
  const selectedPluginVar = selection[4];
  const pluginNameVar = selection[6];
  if (platformVar == null) return null;
  const queryInitialization = new RegExp(
    String.raw`let ${pluginsVar}=[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*),[A-Za-z_$][\w$]*\),${marketplaceVar}=[A-Za-z_$][\w$]*\(\1\),`,
  );
  if (!queryInitialization.test(containing.text)) return null;

  const donorVar = `${selectedPluginVar}BundledMarketplaceDonor`;
  const officialStateVar = `${selectedPluginVar}OfficialPluginState`;
  const insertion =
    `let ${donorVar}=${pluginsVar}.availablePlugins.find(e=>e.marketplaceName===\`openai-bundled\`&&typeof e.marketplacePath===\`string\`&&e.marketplacePath.startsWith(\`/\`)&&e.marketplacePath.endsWith(\`/.agents/plugins/marketplace.json\`));` +
    `let ${officialStateVar}=[...${pluginsVar}.availablePlugins,...(${pluginsVar}.installedPlugins??[])].find(e=>${donorVar}!=null&&e.marketplaceName===\`openai-bundled\`&&e.marketplacePath===${donorVar}.marketplacePath&&e.plugin?.id===\`computer-use@openai-bundled\`&&e.plugin?.name===${pluginNameVar});` +
    `${platformVar}===\`linux\`&&${donorVar}!=null&&!${pluginsVar}.availablePlugins.some(e=>e.marketplaceName===\`openai-bundled\`&&e.marketplacePath===${donorVar}.marketplacePath&&e.plugin?.id===\`computer-use@openai-bundled\`&&e.plugin?.name===${pluginNameVar})&&(${pluginsVar}={...${pluginsVar},availablePlugins:[...${pluginsVar}.availablePlugins,{marketplaceName:\`openai-bundled\`,marketplacePath:${donorVar}.marketplacePath,logoPath:new URL(\`computer-use-plugin-icon-linux.png\`,import.meta.url).href,logoDarkPath:new URL(\`computer-use-plugin-icon-linux.png\`,import.meta.url).href,plugin:{id:\`computer-use@openai-bundled\`,name:${pluginNameVar},installed:${officialStateVar}?.plugin?.installed===!0,enabled:${officialStateVar}?.plugin?.enabled===!0}}]});`;
  const patchedSource =
    currentSource.slice(0, selection.index) + insertion + currentSource.slice(selection.index);
  return markerPattern.test(patchedSource) ? patchedSource : null;
}

function applyCurrentComputerUseSettingsContract(currentSource) {
  return applyComputerUseSettings26803Contract(currentSource);
}

function matchesLinuxComputerUseRendererAvailabilityContract(currentSource) {
  return applyCurrentComputerUseSettingsContract(currentSource) != null;
}

function applyLinuxComputerUseRendererAvailabilityPatch(currentSource, options = {}) {
  const currentSettingsSource = applyCurrentComputerUseSettingsContract(currentSource);
  if (currentSettingsSource != null) {
    return currentSettingsSource;
  }

  if (options.warn !== false) {
    const reason = currentSource.includes("computerUseAvailability:") &&
        currentSource.includes("availablePlugins")
      ? "Could not find the complete current Computer Use settings contract"
      : "Could not find the current Computer Use settings contract";
    console.warn(
      `WARN: ${reason} — skipping Linux Computer Use UI availability patch`,
    );
  }
  return currentSource;
}

function matchesCurrentComputerUsePlatformPredicate(currentSource, predicateName) {
  const escapedName = predicateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`function ${escapedName}\(([A-Za-z_$][\w$]*)\)\{return (?:\1===\`macOS\`\|\|\1===\`windows\`|\1===\`windows\`\|\|\1===\`macOS\`)\}`,
  ).test(currentSource);
}

function applyCurrentComputerUseHostPlatformContract(currentSource) {
  let changed = false;
  const patchedSource = currentSource.replace(
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\{areRequiredFeaturesEnabled:([A-Za-z_$][\w$]*),enabled:([A-Za-z_$][\w$]*),isAnyFeatureLoading:([A-Za-z_$][\w$]*),isComputerUseGateEnabled:([A-Za-z_$][\w$]*),isHostCompatiblePlatform:([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\),isPlatformLoading:([A-Za-z_$][\w$]*),windowType:`electron`\}\)/g,
    (
      match,
      resultVar,
      helperVar,
      requiredFeaturesVar,
      enabledVar,
      featureLoadingVar,
      rolloutVar,
      platformPredicateVar,
      platformVar,
      platformLoadingVar,
      offset,
    ) => {
      const context = currentSource.slice(Math.max(0, offset - 1200), offset + match.length);
      if (
        !context.includes("featureName:`computer_use`") ||
        !matchesCurrentComputerUsePlatformPredicate(currentSource, platformPredicateVar)
      ) {
        return match;
      }
      changed = true;
      return `${resultVar}=${helperVar}({areRequiredFeaturesEnabled:${requiredFeaturesVar},enabled:${enabledVar},isAnyFeatureLoading:${featureLoadingVar},isComputerUseGateEnabled:${rolloutVar},isHostCompatiblePlatform:${platformVar}===\`linux\`||${platformPredicateVar}(${platformVar}),isPlatformLoading:${platformLoadingVar},windowType:\`electron\`})`;
    },
  );

  if (changed) {
    return patchedSource;
  }

  const patchedContractPattern =
    /featureName:`computer_use`[\s\S]{0,2200}?areRequiredFeaturesEnabled:[A-Za-z_$][\w$]*,enabled:[A-Za-z_$][\w$]*,isAnyFeatureLoading:[A-Za-z_$][\w$]*,isComputerUseGateEnabled:[A-Za-z_$][\w$]*,isHostCompatiblePlatform:([A-Za-z_$][\w$]*)===`linux`\|\|([A-Za-z_$][\w$]*)\(\1\),isPlatformLoading:/g;
  let patchedContract;
  while ((patchedContract = patchedContractPattern.exec(currentSource)) != null) {
    if (matchesCurrentComputerUsePlatformPredicate(currentSource, patchedContract[2])) {
      return currentSource;
    }
  }

  return null;
}

function matchesLinuxComputerUseHostPlatformContract(currentSource) {
  return applyCurrentComputerUseHostPlatformContract(currentSource) != null;
}

function applyLinuxComputerUseHostPlatformPatch(currentSource) {
  const patchedSource = applyCurrentComputerUseHostPlatformContract(currentSource);
  if (patchedSource != null) {
    return patchedSource;
  }

  console.warn(
    "WARN: Could not find current Computer Use host-platform gate — skipping Linux Computer Use host-platform patch",
  );
  return currentSource;
}

function applyCurrentComputerUseInstallFlowContract(currentSource) {
  if (currentSource.includes("plugin detail query requires pluginName")) {
    const markerPattern =
      /let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)!==`computer-use`,([A-Za-z_$][\w$]*);/;
    if (markerPattern.test(currentSource)) {
      return currentSource;
    }

    const needlePattern =
      /let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*);/g;
    let changed = false;
    const patchedSource = currentSource.replace(
      needlePattern,
      (match, gateVar, gateValueVar, nextVar, offset) => {
        const lookback = currentSource.slice(Math.max(0, offset - 900), offset);
        const nextSource = currentSource.slice(offset + match.length, offset + match.length + 1800);
        const pluginNameVar = lookback.match(/pluginName:([A-Za-z_$][\w$]*)/)?.[1];
        if (
          pluginNameVar == null ||
          !new RegExp(
            String.raw`&&\(!${gateVar}\|\|[A-Za-z_$][\w$]*\.available\)`,
          ).test(nextSource) ||
          !nextSource.includes("`read-plugin`")
        ) {
          return match;
        }
        changed = true;
        return `let ${gateVar}=${gateValueVar}&&${pluginNameVar}!==\`computer-use\`,${nextVar};`;
      },
    );

    if (changed && markerPattern.test(patchedSource)) {
      return patchedSource;
    }
  }

  return null;
}

function matchesLinuxComputerUseInstallFlowContract(currentSource) {
  return applyCurrentComputerUseInstallFlowContract(currentSource) != null;
}

function applyLinuxComputerUseInstallFlowPatch(currentSource) {
  const patchedSource = applyCurrentComputerUseInstallFlowContract(currentSource);
  if (patchedSource != null) {
    return patchedSource;
  }

  console.warn(
    "WARN: Could not find current Computer Use plugin detail availability gate — skipping Linux Computer Use install flow patch",
  );
  return currentSource;
}

function findHandlerValue(source, methodName) {
  const key = `${JSON.stringify(methodName)}:`;
  const keyIndex = source.indexOf(key);
  if (keyIndex === -1) {
    return null;
  }
  const valueStart = keyIndex + key.length;
  const valueEnd = findExpressionEnd(source, valueStart);
  if (valueEnd == null || valueEnd <= valueStart) {
    return null;
  }
  return {
    key,
    keyIndex,
    value: source.slice(valueStart, valueEnd),
    valueEnd,
    valueStart,
  };
}

function findExpressionEnd(source, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote != null) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "{" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "}" || char === "]") {
      if (depth > 0) {
        depth -= 1;
      } else {
        return index;
      }
    } else if (char === "," && depth === 0) {
      return index;
    }
  }
  return source.length;
}

function replaceHandlerValue(source, methodName, replacement) {
  const handler = findHandlerValue(source, methodName);
  if (handler == null) {
    return { changed: false, source };
  }
  const nextValue = typeof replacement === "function"
    ? replacement(handler.value)
    : replacement;
  return {
    changed: nextValue !== handler.value,
    source: source.slice(0, handler.valueStart) + nextValue + source.slice(handler.valueEnd),
  };
}

function insertAfterUseStrict(source, insertion) {
  const doubleStrict = "\"use strict\";";
  const singleStrict = "'use strict';";
  const insertAt = source.startsWith(doubleStrict)
    ? doubleStrict.length
    : source.startsWith(singleStrict)
      ? singleStrict.length
      : 0;
  return source.slice(0, insertAt) + insertion + source.slice(insertAt);
}

function linuxNativeDesktopAppsHelper({ childProcessVar, fsVar, osVar, pathVar }) {
  return [
    `function chatgptLinuxNativeDesktopAppsPayload(e){return e?.params??e??{}}`,
    `function chatgptLinuxNativeDesktopAppsHome(){return process.env.HOME||${osVar}.homedir?.()||\`\`}`,
    `function chatgptLinuxNativeDesktopAppsExecutable(e){if(!e)return null;if(e.includes(\`/\`)){try{return ${fsVar}.existsSync(e)&&(${fsVar}.accessSync(e,${fsVar}.constants.X_OK),!0)?e:null}catch{return null}}for(let t of(process.env.PATH||\`\`).split(\`:\`)){if(!t||!${pathVar}.isAbsolute(t))continue;let n=${pathVar}.join(t,e);try{if(${fsVar}.existsSync(n)&&(${fsVar}.accessSync(n,${fsVar}.constants.X_OK),!0))return n}catch{}}return null}`,
    `function chatgptLinuxNativeDesktopAppsBackendPath(){let e=process.env.CHATGPT_LINUX_COMPUTER_USE_BACKEND_SOURCE?.trim(),t=process.env.CHATGPT_ELECTRON_RESOURCES_PATH||process.resourcesPath,n=process.env.CODEX_HOME||(chatgptLinuxNativeDesktopAppsHome()?${pathVar}.join(chatgptLinuxNativeDesktopAppsHome(),\`.codex\`):\`\`),r=[e,t&&${pathVar}.join(t,\`plugins\`,\`openai-bundled\`,\`plugins\`,\`computer-use\`,\`bin\`,\`chatgpt-computer-use-linux\`),n&&${pathVar}.join(n,\`plugins\`,\`cache\`,\`openai-bundled\`,\`computer-use\`,\`latest\`,\`bin\`,\`chatgpt-computer-use-linux\`),\`chatgpt-computer-use-linux\`];for(let e of r){if(typeof e!==\`string\`||e.length===0)continue;let t=chatgptLinuxNativeDesktopAppsExecutable(e);if(t)return t}return null}`,
    `function chatgptLinuxNativeDesktopAppsRun(e){let t=chatgptLinuxNativeDesktopAppsBackendPath();if(t==null)return null;try{let n=${childProcessVar}.spawnSync(t,e,{encoding:\`utf8\`,env:process.env,maxBuffer:1048576,timeout:2500});if(n.error||n.status!==0)return null;return JSON.parse(n.stdout||\`null\`)}catch{return null}}`,
    `function chatgptLinuxNativeDesktopAppsDataDirs(){let e=chatgptLinuxNativeDesktopAppsHome(),t=process.env.XDG_DATA_HOME||(e&&${pathVar}.join(e,\`.local\`,\`share\`)),n=(process.env.XDG_DATA_DIRS||\`/usr/local/share:/usr/share\`).split(\`:\`).filter(Boolean);return[...t?[t]:[],...n]}`,
    `function chatgptLinuxNativeDesktopAppsUnescape(e){return String(e??\`\`).replace(/\\\\s/g,\` \`).replace(/\\\\n/g,\`\\n\`).replace(/\\\\t/g,\`\\t\`).replace(/\\\\r/g,\`\\r\`).replace(/\\\\\\\\/g,\`\\\\\`)}`,
    `function chatgptLinuxNativeDesktopAppsParseDesktopFile(e){try{let t=${fsVar}.readFileSync(e,\`utf8\`).split(/\\r?\\n/),n=!1,r={id:${pathVar}.basename(e,\`.desktop\`),path:e};for(let e of t){let t=e.trim();if(!t||t.startsWith(\`#\`))continue;if(t.startsWith(\`[\`)&&t.endsWith(\`]\`)){n=t===\`[Desktop Entry]\`;continue}if(!n)continue;let i=t.indexOf(\`=\`);if(i<1)continue;let a=t.slice(0,i),o=chatgptLinuxNativeDesktopAppsUnescape(t.slice(i+1));a===\`Name\`?r.name=o:a===\`Icon\`?r.icon=o:a===\`StartupWMClass\`?r.startupWmClass=o:a===\`Exec\`?r.exec=o:a===\`NoDisplay\`?r.noDisplay=o:a===\`Hidden\`&&(r.hidden=o)}return r.hidden===\`true\`?null:r}catch{return null}}`,
    `function chatgptLinuxNativeDesktopAppsDesktopEntries(){let e=[];for(let t of chatgptLinuxNativeDesktopAppsDataDirs()){let n=${pathVar}.join(t,\`applications\`);if(!${fsVar}.existsSync(n))continue;let r=[n],i=0;for(;r.length>0&&i<2500;){let t=r.pop();i+=1;let n;try{n=${fsVar}.readdirSync(t,{withFileTypes:!0})}catch{continue}for(let i of n){let n=${pathVar}.join(t,i.name);if(i.isDirectory())r.push(n);else if(i.isFile()&&i.name.endsWith(\`.desktop\`)){let t=chatgptLinuxNativeDesktopAppsParseDesktopFile(n);t&&e.push(t)}}}}return e}`,
    `function chatgptLinuxNativeDesktopAppsNorm(e){return String(e??\`\`).trim().toLowerCase()}`,
    `function chatgptLinuxNativeDesktopAppsDesktopScore(e,t){let n=[t.app_id,t.wm_class,t.name].map(chatgptLinuxNativeDesktopAppsNorm).filter(Boolean),r=chatgptLinuxNativeDesktopAppsNorm(e.id),i=chatgptLinuxNativeDesktopAppsNorm(e.startupWmClass),a=chatgptLinuxNativeDesktopAppsNorm(e.name);let o=0;for(let e of n){r===e&&(o=Math.max(o,90));r===\`\${e}.desktop\`&&(o=Math.max(o,90));r.endsWith(\`.\${e}\`)&&(o=Math.max(o,70));i===e&&(o=Math.max(o,100));a===e&&(o=Math.max(o,45))}return o}`,
    `function chatgptLinuxNativeDesktopAppsDesktopFor(e,t){let n=null,r=0;for(let i of t){let t=chatgptLinuxNativeDesktopAppsDesktopScore(i,e);t>r&&(n=i,r=t)}return n}`,
    `function chatgptLinuxNativeDesktopAppsTitle(e){let t=String(e??\`\`).trim().split(/[._-]+/).filter(Boolean).map(e=>e.charAt(0).toUpperCase()+e.slice(1)).join(\` \`);return t||\`Desktop app\`}`,
    `function chatgptLinuxNativeDesktopAppsCandidate(e,t){let n=chatgptLinuxNativeDesktopAppsDesktopFor(e,t),r=String(e.app_id??\`\`).trim(),i=String(e.wm_class??\`\`).trim(),a=n?.id||r||i||(e.pid!=null?\`pid:\${e.pid}\`:\`\`);if(!a)return null;let o=n?.name||chatgptLinuxNativeDesktopAppsTitle(r||i||e.name||e.title),s=n?.path||\`linux:\${a}\`;return{bundleId:a,appPath:s,displayName:o,description:e.title?\`Window: \${e.title}\`:\`Linux desktop app\`,iconSmall:\`\`,linuxAppId:r||null,wmClass:i||null,pid:e.pid??null,windowId:e.window_id??null,focused:e.focused===!0,backend:e.backend??null,clientType:e.client_type??null}}`,
    `function chatgptLinuxNativeDesktopAppsAdd(e,t){if(t==null)return;let n=chatgptLinuxNativeDesktopAppsNorm(t.bundleId||t.appPath||t.displayName),r=e.get(n);if(r==null||t.focused&&!r.focused||r.appPath.startsWith(\`linux:\`)&&!t.appPath.startsWith(\`linux:\`))e.set(n,t)}`,
    `function chatgptLinuxNativeDesktopAppsFromWindows(e,t){let n=new Map;for(let r of Array.isArray(e)?e:[])chatgptLinuxNativeDesktopAppsAdd(n,chatgptLinuxNativeDesktopAppsCandidate(r,t));return[...n.values()].sort((e,t)=>Number(t.focused)-Number(e.focused)||e.displayName.localeCompare(t.displayName)).slice(0,20)}`,
    `async function chatgptLinuxNativeDesktopApps(){let e=chatgptLinuxNativeDesktopAppsRun([\`windows\`]),t=chatgptLinuxNativeDesktopAppsDesktopEntries(),n=chatgptLinuxNativeDesktopAppsFromWindows(e?.windows,t);return{apps:n}}`,
    `function chatgptLinuxNativeDesktopAppsIconDirs(){let e=chatgptLinuxNativeDesktopAppsHome(),t=chatgptLinuxNativeDesktopAppsDataDirs(),n=[];for(let r of t)n.push(${pathVar}.join(r,\`icons\`)),n.push(${pathVar}.join(r,\`pixmaps\`));e&&n.push(${pathVar}.join(e,\`.icons\`));return n}`,
    `function chatgptLinuxNativeDesktopAppsResolveIcon(e){if(!e)return null;if(${pathVar}.isAbsolute(e)){try{return ${fsVar}.existsSync(e)?e:null}catch{return null}}let t=e.match(/\\.(png|svg|xpm)$/i)?[e]:[\`\${e}.png\`,\`\${e}.svg\`,\`\${e}.xpm\`],n=[\`hicolor/512x512/apps\`,\`hicolor/256x256/apps\`,\`hicolor/128x128/apps\`,\`hicolor/64x64/apps\`,\`hicolor/48x48/apps\`,\`hicolor/scalable/apps\`,\`hicolor/symbolic/apps\`,\`.\`];for(let e of chatgptLinuxNativeDesktopAppsIconDirs())for(let r of n)for(let n of t){let t=${pathVar}.join(e,r,n);try{if(${fsVar}.existsSync(t))return t}catch{}}return null}`,
    `function chatgptLinuxNativeDesktopAppsIconDataUrl(e){try{let t=${pathVar}.extname(e).toLowerCase(),n=t===\`.svg\`?\`image/svg+xml\`:t===\`.xpm\`?\`image/x-xpixmap\`:\`image/png\`;return\`data:\${n};base64,\${${fsVar}.readFileSync(e).toString(\`base64\`)}\`}catch{return\`\`}}`,
    `async function chatgptLinuxNativeDesktopAppIcon(e){let t=chatgptLinuxNativeDesktopAppsPayload(e),n=String(t.appPath??\`\`),r=null;if(n.endsWith(\`.desktop\`)&&${fsVar}.existsSync(n))r=chatgptLinuxNativeDesktopAppsParseDesktopFile(n)?.icon??null;let i=chatgptLinuxNativeDesktopAppsResolveIcon(r);return{iconSmall:i?chatgptLinuxNativeDesktopAppsIconDataUrl(i):\`\`}}`,
  ].join("");
}

function applyLinuxNativeDesktopAppsHandlerPatch(currentSource) {
  if (currentSource.includes("chatgptLinuxNativeDesktopApps(")) {
    return currentSource;
  }

  if (findHandlerValue(currentSource, "native-desktop-apps") == null) {
    if (currentSource.includes("native-desktop-apps") || currentSource.includes("handleVSCodeRequest")) {
      console.warn(
        "WARN: Could not find native-desktop-apps handler — skipping Linux native desktop apps patch",
      );
    }
    return currentSource;
  }

  const childProcessVar =
    requireName(currentSource, "node:child_process") ?? requireName(currentSource, "child_process");
  const fsVar = requireName(currentSource, "node:fs");
  const osVar = requireName(currentSource, "node:os") ?? requireName(currentSource, "os");
  const pathVar = requireName(currentSource, "node:path");
  if (childProcessVar == null || fsVar == null || osVar == null || pathVar == null) {
    console.warn(
      "WARN: Could not find node:child_process/node:fs/node:os/node:path dependencies — skipping Linux native desktop apps patch",
    );
    return currentSource;
  }

  let patchedSource = insertAfterUseStrict(
    currentSource,
    linuxNativeDesktopAppsHelper({ childProcessVar, fsVar, osVar, pathVar }),
  );

  const nativeHandler = findHandlerValue(patchedSource, "native-desktop-apps");
  if (nativeHandler == null) {
    console.warn(
      "WARN: Could not find native-desktop-apps handler after helper insertion — skipping Linux native desktop apps patch",
    );
    return currentSource;
  }
  const nativeHandlerKeyIndex = nativeHandler.keyIndex;

  const nativeAppsReplacement = replaceHandlerValue(
    patchedSource,
    "native-desktop-apps",
    (handler) => `async(...e)=>process.platform===\`linux\`?(typeof chatgptLinuxComputerUseAuthorizeRequest===\`function\`&&await chatgptLinuxComputerUseAuthorizeRequest()?chatgptLinuxNativeDesktopApps(e[0]):{apps:[]}):await(${handler})(...e)`,
  );
  if (!nativeAppsReplacement.changed) {
    console.warn(
      "WARN: Could not wrap native-desktop-apps handler — skipping Linux native desktop apps patch",
    );
    return currentSource;
  }
  patchedSource = nativeAppsReplacement.source;

  if (findHandlerValue(patchedSource, "computer-use-native-desktop-app-icon") == null) {
    const iconHandler =
      `"computer-use-native-desktop-app-icon":async(e)=>process.platform===\`linux\`?(typeof chatgptLinuxComputerUseAuthorizeRequest===\`function\`&&await chatgptLinuxComputerUseAuthorizeRequest()?chatgptLinuxNativeDesktopAppIcon(e):{iconSmall:\`\`}):{iconSmall:\`\`},`;
    patchedSource =
      patchedSource.slice(0, nativeHandlerKeyIndex) +
      iconHandler +
      patchedSource.slice(nativeHandlerKeyIndex);
  } else {
    const iconReplacement = replaceHandlerValue(
      patchedSource,
      "computer-use-native-desktop-app-icon",
      (handler) => `async(...e)=>process.platform===\`linux\`?(typeof chatgptLinuxComputerUseAuthorizeRequest===\`function\`&&await chatgptLinuxComputerUseAuthorizeRequest()?chatgptLinuxNativeDesktopAppIcon(e[0]):{iconSmall:\`\`}):await(${handler})(...e)`,
    );
    patchedSource = iconReplacement.source;
  }

  return patchedSource;
}

function matchesLinuxNativeDesktopAppsContract(currentSource) {
  if (currentSource.includes("chatgptLinuxNativeDesktopApps(")) {
    return findHandlerValue(currentSource, "native-desktop-apps")?.value.includes(
      "chatgptLinuxComputerUseAuthorizeRequest",
    ) === true &&
      findHandlerValue(currentSource, "computer-use-native-desktop-app-icon")?.value.includes(
        "chatgptLinuxComputerUseAuthorizeRequest",
      ) === true;
  }
  return findHandlerValue(currentSource, "native-desktop-apps") != null &&
    (requireName(currentSource, "node:child_process") ?? requireName(currentSource, "child_process")) != null &&
    requireName(currentSource, "node:fs") != null &&
    (requireName(currentSource, "node:os") ?? requireName(currentSource, "os")) != null &&
    requireName(currentSource, "node:path") != null;
}

module.exports = {
  applyLinuxComputerUseAuthorityPatch,
  applyLinuxComputerUseAvatarCursorBridgePatch,
  applyLinuxComputerUseDisableOrderingPatch,
  applyLinuxComputerUseFeaturePatch,
  applyLinuxComputerUseHostPlatformPatch,
  applyLinuxComputerUseInstallFlowPatch,
  applyLinuxNativeDesktopAppsHandlerPatch,
  applyLinuxComputerUsePluginGatePatch,
  applyLinuxComputerUseRendererAvailabilityPatch,
  linuxComputerUseCursorBridgeRuntimeSource,
  linuxComputerUseAuthorityRuntimeSource,
  matchesLinuxComputerUseAuthorityContract,
  matchesLinuxComputerUseAvatarCursorContract,
  matchesLinuxComputerUseDisableOrderingContract,
  matchesLinuxComputerUseFeatureContract,
  matchesLinuxComputerUseHostPlatformContract,
  matchesLinuxComputerUseInstallFlowContract,
  matchesLinuxComputerUseRendererAvailabilityContract,
  matchesLinuxNativeDesktopAppsContract,
};
