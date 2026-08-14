"use strict";

const { requireName } = require("../../lib/minified-js.js");

function findMatchingParenthesis(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote != null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findTrayConstructor(source) {
  const identifier = "[A-Za-z_$][\\w$]*";
  const shapes = [
    {
      retained: true,
      pattern: new RegExp(
        `(?<tray>${identifier})=chatgptLinuxRegisterTray\\(new (?<electron>${identifier})\\.Tray\\(`,
        "g",
      ),
    },
    {
      retained: false,
      pattern: new RegExp(
        `(?<tray>${identifier})=new (?<electron>${identifier})\\.Tray\\(`,
        "g",
      ),
    },
  ];
  const candidates = [];

  for (const shape of shapes) {
    for (const match of source.matchAll(shape.pattern)) {
      const openIndex = match.index + match[0].length - 1;
      const closeIndex = findMatchingParenthesis(source, openIndex);
      if (closeIndex === -1) {
        continue;
      }
      const end = closeIndex + (shape.retained && source[closeIndex + 1] === ")" ? 2 : 1);
      if (shape.retained && end !== closeIndex + 2) {
        continue;
      }
      candidates.push({
        start: match.index,
        end,
        trayVar: match.groups.tray,
        electronVar: match.groups.electron,
        constructorArgs: source.slice(openIndex + 1, closeIndex),
        retained: shape.retained,
      });
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function applyLinuxTrayPatch(currentSource, iconPathExpression) {
  let patchedSource = currentSource;

  const closeToTrayPattern =
    /if\(\(process\.platform===`win32`\|\|process\.platform===`linux`\)&&!this\.isAppQuitting&&this\.options\.canHideLastWindowToTray\?\.\(\)===!0&&!([A-Za-z_$][\w$]*)\)\{([A-Za-z_$][\w$]*)\.preventDefault\(\),([A-Za-z_$][\w$]*)\.hide\(\);return\}/;
  const guardedCloseToTrayPattern =
    /if\(\(process\.platform===`win32`\|\|process\.platform===`linux`\)&&!this\.isAppQuitting&&!\(typeof chatgptLinuxIsQuitInProgress===`function`&&chatgptLinuxIsQuitInProgress\(\)\)&&this\.options\.canHideLastWindowToTray\?\.\(\)===!0&&![A-Za-z_$][\w$]*\)/;
  if (!guardedCloseToTrayPattern.test(patchedSource)) {
    const match = patchedSource.match(closeToTrayPattern);
    if (match == null) {
      console.warn("WARN: Could not find current Linux close-to-tray condition — skipping Linux tray quit guard patch");
      return currentSource;
    }
    const [, hasOtherWindowVar, eventVar, windowVar] = match;
    patchedSource = patchedSource.replace(
      closeToTrayPattern,
      `if((process.platform===\`win32\`||process.platform===\`linux\`)&&!this.isAppQuitting&&!(typeof chatgptLinuxIsQuitInProgress===\`function\`&&chatgptLinuxIsQuitInProgress())&&this.options.canHideLastWindowToTray?.()===!0&&!${hasOtherWindowVar}){${eventVar}.preventDefault(),${windowVar}.hide();return}`,
    );
  }

  const providerPath = "[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*";
  const trayReadinessWrapperPattern = new RegExp(
    `isReady\\(\\)\\{return (${providerPath})\\(this\\.tray\\)\\}` +
      `waitForReady\\(\\)\\{return (${providerPath})\\(this\\.tray\\)\\}`,
  );
  const compatibleTrayReadinessWrapperPattern = new RegExp(
    `isReady\\(\\)\\{return process\\.platform===\`linux\`&&typeof this\\.tray\\.isReady!=\`function\`\\?!0:${providerPath}\\(this\\.tray\\)\\}` +
      `waitForReady\\(\\)\\{return process\\.platform===\`linux\`&&typeof this\\.tray\\.whenReady!=\`function\`\\?Promise\\.resolve\\(!0\\):${providerPath}\\(this\\.tray\\)\\}`,
  );
  if (!compatibleTrayReadinessWrapperPattern.test(patchedSource)) {
    const readinessMatch = patchedSource.match(trayReadinessWrapperPattern);
    if (readinessMatch == null) {
      console.warn("WARN: Could not find current Linux tray readiness wrappers — skipping Linux tray compatibility patch");
      return currentSource;
    }
    const [, isReadyProvider, waitForReadyProvider] = readinessMatch;
    patchedSource = patchedSource.replace(
      trayReadinessWrapperPattern,
      `isReady(){return process.platform===\`linux\`&&typeof this.tray.isReady!=\`function\`?!0:${isReadyProvider}(this.tray)}` +
        `waitForReady(){return process.platform===\`linux\`&&typeof this.tray.whenReady!=\`function\`?Promise.resolve(!0):${waitForReadyProvider}(this.tray)}`,
    );
  }

  if (
    iconPathExpression != null &&
    !patchedSource.includes("/*chatgpt-linux-project-tray-icon*/")
  ) {
    const linuxTrayIconPattern =
      /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.nativeImage\.createFromPath\(([^;]+)\);if\(\1\.isEmpty\(\)\)throw Error\(`Linux tray application icon is unavailable`\)/;
    const match = patchedSource.match(linuxTrayIconPattern);
    if (match == null) {
      console.warn("WARN: Could not find current Linux tray icon loader — skipping Linux tray compatibility patch");
      return currentSource;
    }
    const [iconLoader, imageVar, electronVar, upstreamIconPath] = match;
    patchedSource = patchedSource.replace(
      iconLoader,
      `${imageVar}=/*chatgpt-linux-project-tray-icon*/process.platform===\`linux\`?${electronVar}.nativeImage.createFromPath(${iconPathExpression}):${electronVar}.nativeImage.createFromPath(${upstreamIconPath});if(${imageVar}.isEmpty()&&process.platform===\`linux\`)${imageVar}=${electronVar}.nativeImage.createFromPath(${upstreamIconPath});if(${imageVar}.isEmpty())throw Error(\`Linux tray application icon is unavailable\`)`,
    );
  }

  const constructorMatch = findTrayConstructor(patchedSource);
  if (
    constructorMatch == null ||
    !patchedSource.includes("if(process.platform===`linux`){") ||
    !patchedSource.includes("updatePersistentTrayMenu(){process.platform===`linux`")
  ) {
    console.warn("WARN: Could not find current Linux tray factory — skipping Linux tray retention patch");
    return currentSource;
  }

  const { trayVar, electronVar, constructorArgs } = constructorMatch;
  const retainedConstructor =
    `${trayVar}=chatgptLinuxRegisterTray(new ${electronVar}.Tray(${constructorArgs}))`;
  if (!constructorMatch.retained) {
    patchedSource =
      patchedSource.slice(0, constructorMatch.start) +
      retainedConstructor +
      patchedSource.slice(constructorMatch.end);
  }

  if (!patchedSource.includes("chatgptLinuxRegisterTray=e=>")) {
    const constructorIndex = patchedSource.indexOf(retainedConstructor);
    const factoryIndex = patchedSource.lastIndexOf("async function ", constructorIndex);
    if (constructorIndex === -1 || factoryIndex === -1) {
      console.warn("WARN: Could not find current Linux tray helper insertion point — skipping Linux tray retention patch");
      return currentSource;
    }
    const retentionHelper =
      "let chatgptLinuxTray=null,chatgptLinuxRegisterTray=e=>(chatgptLinuxTray=e,e);";
    patchedSource =
      patchedSource.slice(0, factoryIndex) +
      retentionHelper +
      patchedSource.slice(factoryIndex);
  }

  return patchedSource;
}

function buildLinuxBuildInfoHelpers(electronVar, fsVar, pathVar) {
  return `function chatgptLinuxBuildInfoPaths(){let __chatgptBuildInfoPaths=[];try{__chatgptBuildInfoPaths.push((0,${pathVar}.join)(process.resourcesPath,\`chatgpt-linux-build-info.json\`)),__chatgptBuildInfoPaths.push((0,${pathVar}.join)(process.resourcesPath,\`..\`,\`.chatgpt-linux\`,\`build-info.json\`))}catch{}return __chatgptBuildInfoPaths}function chatgptLinuxReadBuildInfo(){for(let __chatgptBuildInfoPath of chatgptLinuxBuildInfoPaths())try{if(${fsVar}.existsSync(__chatgptBuildInfoPath)){let __chatgptBuildInfo=JSON.parse(${fsVar}.readFileSync(__chatgptBuildInfoPath,\`utf8\`));if(__chatgptBuildInfo&&typeof __chatgptBuildInfo===\`object\`&&!Array.isArray(__chatgptBuildInfo))return{info:__chatgptBuildInfo,path:__chatgptBuildInfoPath}}}catch{}return{info:null,path:null}}function chatgptLinuxBuildInfoValue(__chatgptBuildInfoValue,__chatgptBuildInfoFallback=\`unknown\`){return typeof __chatgptBuildInfoValue===\`string\`&&__chatgptBuildInfoValue.trim().length>0?__chatgptBuildInfoValue:Array.isArray(__chatgptBuildInfoValue)&&__chatgptBuildInfoValue.length>0?__chatgptBuildInfoValue.join(\`, \`):__chatgptBuildInfoValue==null?__chatgptBuildInfoFallback:String(__chatgptBuildInfoValue)}function chatgptLinuxBuildInfoCommitUrl(__chatgptBuildInfo){let __chatgptBuildInfoCommitUrl=__chatgptBuildInfo?.source?.commitUrl;return typeof __chatgptBuildInfoCommitUrl===\`string\`&&/^https:\\/\\/github\\.com\\/[^/\\s]+\\/[^/\\s]+\\/commit\\/[0-9a-f]{7,40}$/i.test(__chatgptBuildInfoCommitUrl)?__chatgptBuildInfoCommitUrl:null}function chatgptLinuxGetBuildInfo(){let __chatgptBuildInfoResult=chatgptLinuxReadBuildInfo();return{...__chatgptBuildInfoResult,commitUrl:chatgptLinuxBuildInfoCommitUrl(__chatgptBuildInfoResult.info)}}function chatgptLinuxBuildInfoDetail(__chatgptBuildInfo,__chatgptBuildInfoPath){if(!__chatgptBuildInfo)return\`No Linux build metadata file was found in this app install.\`;let __chatgptBuildInfoTarget=__chatgptBuildInfo.linuxTarget??{},__chatgptBuildInfoDistro=__chatgptBuildInfoTarget.distro??{},__chatgptBuildInfoDmg=__chatgptBuildInfo.officialDmg??{},__chatgptBuildInfoSource=__chatgptBuildInfo.source??{},__chatgptBuildInfoIntegrations=__chatgptBuildInfo.portIntegrations?.enabled??[],__chatgptBuildInfoProfile=__chatgptBuildInfo.packageProfile??{},__chatgptBuildInfoCommit=__chatgptBuildInfoSource.commit||__chatgptBuildInfoSource.shortCommit,__chatgptBuildInfoCommitValue=__chatgptBuildInfoCommit?__chatgptBuildInfoSource.dirty?\`\${__chatgptBuildInfoCommit} (dirty)\`:__chatgptBuildInfoCommit:\`unknown\`,__chatgptBuildInfoDistroValue=__chatgptBuildInfoDistro.prettyName||[__chatgptBuildInfoDistro.id,__chatgptBuildInfoDistro.versionId].filter(Boolean).join(\` \`)||\`unknown\`,__chatgptBuildInfoCommitLink=chatgptLinuxBuildInfoCommitUrl(__chatgptBuildInfo);return[\`Metadata file: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoPath)}\`,\`Linux package profile: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoProfile.label)}\`,\`Distro: \${__chatgptBuildInfoDistroValue}\`,\`Package manager: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoTarget.packageManager??__chatgptBuildInfoProfile.packageManager)}\`,\`Package format: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoTarget.packageFormat??__chatgptBuildInfoProfile.format)}\`,\`Enabled port integrations: \${__chatgptBuildInfoIntegrations.length>0?__chatgptBuildInfoIntegrations.join(\`, \`):\`none\`}\`,\`Official app version: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoDmg.appVersion)}\`,\`Official DMG SHA256: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoDmg.sha256)}\`,\`Electron: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfo.electronVersion)}\`,\`Linux source commit: \${__chatgptBuildInfoCommitValue}\`,...(__chatgptBuildInfoCommitLink?[\`Source commit URL: \${__chatgptBuildInfoCommitLink}\`]:[]),\`Source branch: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfoSource.branch)}\`,\`Generated: \${chatgptLinuxBuildInfoValue(__chatgptBuildInfo.generatedAt)}\`].join(\`\\n\`)}async function chatgptLinuxOpenBuildInfoCommit(){let __chatgptBuildInfoResult=chatgptLinuxGetBuildInfo();return __chatgptBuildInfoResult.commitUrl?(await ${electronVar}.shell?.openExternal(__chatgptBuildInfoResult.commitUrl),{success:!0}):{success:!1}}async function chatgptLinuxShowBuildInfo(){try{let __chatgptBuildInfoResult=chatgptLinuxGetBuildInfo(),__chatgptBuildInfoCommitUrl=__chatgptBuildInfoResult.commitUrl,__chatgptBuildInfoPath=__chatgptBuildInfoResult.path,__chatgptBuildInfoButtons=[],__chatgptBuildInfoButtonIndex=0;__chatgptBuildInfoCommitUrl&&__chatgptBuildInfoButtons.push(\`Open Source Commit\`),__chatgptBuildInfoPath&&__chatgptBuildInfoButtons.push(\`Open Metadata File\`),__chatgptBuildInfoButtons.push(\`OK\`);let __chatgptBuildInfoBoxResponse=await ${electronVar}.dialog?.showMessageBox({type:\`info\`,buttons:__chatgptBuildInfoButtons,defaultId:__chatgptBuildInfoButtons.length-1,cancelId:__chatgptBuildInfoButtons.length-1,message:\`ChatGPT for Linux build information\`,detail:chatgptLinuxBuildInfoDetail(__chatgptBuildInfoResult.info,__chatgptBuildInfoPath)});if(__chatgptBuildInfoCommitUrl&&__chatgptBuildInfoBoxResponse?.response===__chatgptBuildInfoButtonIndex++){await ${electronVar}.shell?.openExternal(__chatgptBuildInfoCommitUrl);return}if(__chatgptBuildInfoPath&&__chatgptBuildInfoBoxResponse?.response===__chatgptBuildInfoButtonIndex++)await ${electronVar}.shell?.openPath?.(__chatgptBuildInfoPath)}catch{}}`;
}

function addLinuxBuildInfoRequestHandler(currentSource) {
  const handler = "\"chatgpt-linux-get-build-info\":async()=>chatgptLinuxGetBuildInfo(),\"chatgpt-linux-open-build-info-commit\":async()=>chatgptLinuxOpenBuildInfoCommit(),\"chatgpt-linux-show-build-info\":async()=>{await chatgptLinuxShowBuildInfo();return{success:!0}},";
  const nestedHandler = `({${handler}`;
  let patchedSource = currentSource;
  let changed = false;
  if (patchedSource.includes(nestedHandler)) {
    patchedSource = patchedSource.replace(nestedHandler, "({");
    changed = true;
  } else if (patchedSource.includes(handler)) {
    return { source: patchedSource, changed: false };
  }

  const handlerKeyIndexes = [
    patchedSource.indexOf("\"set-global-state\":async"),
    patchedSource.indexOf("\"get-global-state\":async"),
  ].filter((index) => index !== -1);
  if (handlerKeyIndexes.length === 0) {
    return { source: patchedSource, changed };
  }

  const keyIndex = Math.min(...handlerKeyIndexes);
  return {
    source: `${patchedSource.slice(0, keyIndex)}${handler}${patchedSource.slice(keyIndex)}`,
    changed: true,
  };
}

function findLinuxBuildInfoHelperInsertionIndex(source, classMatch, helpMenuMatch) {
  if (classMatch?.index != null) {
    return classMatch.index;
  }
  if (helpMenuMatch?.index == null) {
    return null;
  }

  const statementStart = source.lastIndexOf(";", helpMenuMatch.index) + 1;
  const insertionIndex = statementStart === 0 ? 0 : statementStart;
  return insertionIndex <= helpMenuMatch.index ? insertionIndex : null;
}

function applyLinuxBuildInfoTrayPatch(currentSource) {
  const electronVar = requireName(currentSource, "electron");
  const fsVar = requireName(currentSource, "node:fs");
  const pathVar = requireName(currentSource, "node:path");
  const hasHelper = currentSource.includes("function chatgptLinuxShowBuildInfo()");
  if (!hasHelper && (electronVar == null || fsVar == null || pathVar == null)) {
    console.warn("WARN: Could not find build info module bindings — skipping Linux build info tray patch");
    return currentSource;
  }

  let patchedSource = currentSource;
  let changed = false;
  if (
    electronVar != null &&
    patchedSource.includes(`let ${electronVar}=await ${electronVar}.dialog?.showMessageBox`)
  ) {
    patchedSource = patchedSource
      .replace(
        `let ${electronVar}=await ${electronVar}.dialog?.showMessageBox`,
        `let __chatgptBuildInfoBoxResponse=await ${electronVar}.dialog?.showMessageBox`,
      )
      .replaceAll(
        `&&${electronVar}?.response===`,
        "&&__chatgptBuildInfoBoxResponse?.response===",
      );
    changed = true;
  }
  const trayMenuRegex = /getNativeTrayMenuItems\(\)\{[^]*?return\[/g;
  const classRegex = /var [A-Za-z_$][\w$]*=class\{[^]*?getNativeTrayMenuItems\(\)\{[^]*?return\[/;
  const helpMenuPattern = /role:`help`,id:[A-Za-z_$][\w$]*\.help,submenu:\[/;
  const helperInsertionIndex = findLinuxBuildInfoHelperInsertionIndex(
    currentSource,
    currentSource.match(classRegex),
    currentSource.match(helpMenuPattern),
  );
  const canInstallHelper = hasHelper || helperInsertionIndex != null;
  const trayMenuMatch = patchedSource.match(trayMenuRegex);
  if (trayMenuMatch == null && !patchedSource.includes("role:`help`")) {
    console.warn("WARN: Could not find tray menu items method — skipping Linux build info tray patch");
  } else if (
    trayMenuMatch != null &&
    !/getNativeTrayMenuItems\(\)\{[^]*?label:`Build Information`,click:\(\)=>\{chatgptLinuxShowBuildInfo\(\)\}/.test(patchedSource)
  ) {
    const menuPrefix =
      "...process.platform===`linux`?[{label:`Build Information`,click:()=>{chatgptLinuxShowBuildInfo()}},{type:`separator`}]:[],";
    patchedSource = patchedSource.replace(trayMenuRegex, (match) => `${match}${menuPrefix}`);
    changed = true;
  }

  const helpMenuRegex = /role:`help`,id:[A-Za-z_$][\w$]*\.help,submenu:\[/g;
  if (
    !/role:`help`,id:[A-Za-z_$][\w$]*\.help,submenu:\[\.\.\.process\.platform===`linux`\?\[\{label:`Build Information`,click:\(\)=>\{chatgptLinuxShowBuildInfo\(\)\}\},\{type:`separator`\}\]:\[\],/.test(patchedSource)
  ) {
    if (canInstallHelper) {
      let patchedHelpMenu = false;
      patchedSource = patchedSource.replace(helpMenuRegex, (match) => {
        patchedHelpMenu = true;
        return `${match}...process.platform===\`linux\`?[{label:\`Build Information\`,click:()=>{chatgptLinuxShowBuildInfo()}},{type:\`separator\`}]:[],`;
      });
      changed = changed || patchedHelpMenu;
      if (!patchedHelpMenu && patchedSource.includes("role:`help`")) {
        console.warn("WARN: Could not find Help menu insertion point — skipping Linux build info app menu patch");
      }
    } else if (patchedSource.includes("role:`help`")) {
      console.warn("WARN: Could not find Help menu insertion point — skipping Linux build info app menu patch");
    }
  }

  const handlerPatch = addLinuxBuildInfoRequestHandler(patchedSource);
  patchedSource = handlerPatch.source;
  changed = changed || handlerPatch.changed;

  if (!changed || hasHelper) {
    return patchedSource;
  }

  const classMatch = patchedSource.match(classRegex);
  const helpMenuMatch = patchedSource.match(helpMenuPattern);
  const helperIndex = findLinuxBuildInfoHelperInsertionIndex(patchedSource, classMatch, helpMenuMatch);
  if (helperIndex == null) {
    console.warn("WARN: Could not find build info helper insertion point — skipping Linux build info patch");
    return currentSource;
  }

  const helpers = buildLinuxBuildInfoHelpers(electronVar, fsVar, pathVar);
  return `${patchedSource.slice(0, helperIndex)}${helpers};${patchedSource.slice(helperIndex)}`;
}

function applyLinuxSingleInstancePatch(currentSource) {
  let patchedSource = currentSource;

  const singleInstanceLockNeedle =
    "agentRunId:process.env.CODEX_ELECTRON_AGENT_RUN_ID?.trim()||null}});let A=Date.now();await n.app.whenReady()";
  const singleInstanceLockPatch =
    "agentRunId:process.env.CODEX_ELECTRON_AGENT_RUN_ID?.trim()||null}});if(process.platform===`linux`&&process.env.CHATGPT_LINUX_MULTI_LAUNCH!==`1`&&!n.app.requestSingleInstanceLock()){n.app.quit();return}let A=Date.now();await n.app.whenReady()";
  const unguardedSingleInstanceLock =
    "process.platform===`linux`&&!n.app.requestSingleInstanceLock()";
  const guardedSingleInstanceLock =
    "process.platform===`linux`&&process.env.CHATGPT_LINUX_MULTI_LAUNCH!==`1`&&!n.app.requestSingleInstanceLock()";
  if (patchedSource.includes(guardedSingleInstanceLock)) {
    // Already patched.
  } else if (patchedSource.includes(unguardedSingleInstanceLock)) {
    patchedSource = patchedSource.replaceAll(unguardedSingleInstanceLock, guardedSingleInstanceLock);
  } else if (patchedSource.includes(singleInstanceLockNeedle)) {
    patchedSource = patchedSource.replace(singleInstanceLockNeedle, singleInstanceLockPatch);
  } else if (patchedSource.includes("setSecondInstanceArgsHandler")) {
    // Newer bundles take the single-instance lock in bootstrap.js and hand args into main here.
  } else {
    console.warn("WARN: Could not find startup handoff point — skipping Linux single-instance lock patch");
  }

  const secondInstanceHandlerNeedle =
    "l(e=>{R.deepLinks.queueProcessArgs(e)||ie()});let ae=";
  const secondInstanceHandlerExistingPatch =
    "let chatgptLinuxSecondInstanceHandler=(e,t)=>{R.deepLinks.queueProcessArgs(t)||ie()};process.platform===`linux`&&(n.app.on(`second-instance`,chatgptLinuxSecondInstanceHandler),k.add(()=>{n.app.off(`second-instance`,chatgptLinuxSecondInstanceHandler)})),l(e=>{R.deepLinks.queueProcessArgs(e)||ie()});let ae=";
  const secondInstanceHandlerPatch =
    "let chatgptLinuxSecondInstanceHandler=(e,t)=>{(typeof chatgptLinuxIsQuitInProgress===`function`&&chatgptLinuxIsQuitInProgress())?void 0:R.deepLinks.queueProcessArgs(t)||ie()},chatgptLinuxBeforeQuitHandler=()=>{typeof chatgptLinuxMarkQuitInProgress===`function`&&chatgptLinuxMarkQuitInProgress()};process.platform===`linux`&&(n.app.on(`before-quit`,chatgptLinuxBeforeQuitHandler),k.add(()=>{n.app.off(`before-quit`,chatgptLinuxBeforeQuitHandler)}),n.app.on(`second-instance`,chatgptLinuxSecondInstanceHandler),k.add(()=>{n.app.off(`second-instance`,chatgptLinuxSecondInstanceHandler)})),l(e=>{R.deepLinks.queueProcessArgs(e)||ie()});let ae=";
  if (
    patchedSource.includes("chatgptLinuxBeforeQuitHandler=()=>{typeof chatgptLinuxMarkQuitInProgress===`function`&&chatgptLinuxMarkQuitInProgress()}") &&
    patchedSource.includes("(typeof chatgptLinuxIsQuitInProgress===`function`&&chatgptLinuxIsQuitInProgress())?void 0:R.deepLinks.queueProcessArgs(t)||ie()")
  ) {
    // Already patched.
  } else if (patchedSource.includes(secondInstanceHandlerExistingPatch)) {
    patchedSource = patchedSource.replace(secondInstanceHandlerExistingPatch, secondInstanceHandlerPatch);
  } else if (patchedSource.includes(secondInstanceHandlerNeedle)) {
    patchedSource = patchedSource.replace(secondInstanceHandlerNeedle, secondInstanceHandlerPatch);
  } else if (patchedSource.includes("setSecondInstanceArgsHandler")) {
    // bootstrap.js owns the Electron second-instance event and calls this bundle's handler.
  } else {
    console.warn("WARN: Could not find second-instance handler — skipping Linux second-instance focus patch");
  }

  return patchedSource;
}

module.exports = {
  applyLinuxBuildInfoTrayPatch,
  applyLinuxSingleInstancePatch,
  applyLinuxTrayPatch,
};
