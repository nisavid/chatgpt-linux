const fs = require("fs");
const path = require("path");

function requireName(source, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`([A-Za-z_$][\\w$]*)=require\\([\\\`'"]${escaped}[\\\`'"]\\)`))?.[1] ?? null;
}

function buildUpdateManagerEnvSource() {
  return "function chatgptLinuxUpdateManagerEnv(){let e={...process.env},t=process.env.CHATGPT_LINUX_ORIGINAL_LD_LIBRARY_PATH_STATE,n=t==null?void 0:process.env.CHATGPT_LINUX_HOST_LD_LIBRARY_PATH_STATE??t,r=process.env.CHATGPT_LINUX_HOST_LD_LIBRARY_PATH_STATE==null?process.env.CHATGPT_LINUX_ORIGINAL_LD_LIBRARY_PATH_VALUE:process.env.CHATGPT_LINUX_HOST_LD_LIBRARY_PATH_VALUE;n===`unset`?delete e.LD_LIBRARY_PATH:n===`empty`?e.LD_LIBRARY_PATH=``:n===`value`&&typeof r==`string`&&(e.LD_LIBRARY_PATH=r);for(let t of[`CHATGPT_LINUX_ORIGINAL_LD_LIBRARY_PATH_STATE`,`CHATGPT_LINUX_ORIGINAL_LD_LIBRARY_PATH_VALUE`,`CHATGPT_LINUX_HOST_LD_LIBRARY_PATH_STATE`,`CHATGPT_LINUX_HOST_LD_LIBRARY_PATH_VALUE`])delete e[t];return e}";
}

function buildInstallAfterQuitSource(childProcessVar) {
  return `function chatgptLinuxInstallAfterQuit(){try{let e=${childProcessVar}.spawn(\`/bin/sh\`,[\`-c\`,\`for i in 1 2 3 4 5 6 7 8 9 10;do sleep 1;s="$("$1" status 2>/dev/null||true)";echo "$s"|grep -q "^status: WaitingForAppExit"&&continue;echo "$s"|grep -q "^status: Installing"&&continue;"$1" install-ready||exit $?;s="$("$1" status 2>/dev/null||true)";echo "$s"|grep -q "^status: WaitingForAppExit"&&continue;echo "$s"|grep -q "^status: Installing"&&continue;if echo "$s"|grep -q "^status: Installed";then (/usr/bin/chatgpt >/dev/null 2>&1 &);fi;exit 0;done\`,\`chatgpt-linux-update-install\`,chatgptLinuxUpdateManagerPath()],{detached:!0,stdio:\`ignore\`,windowsHide:!0,env:chatgptLinuxUpdateManagerEnv()});e.unref?.()}catch{}}`;
}

function buildElectronResolverSource() {
  return "function chatgptLinuxGetElectronModule(){try{return require(`electron`)}catch{return null}}";
}

function buildQuitForUpdateSource(callInstallAfterQuit) {
  const prefix = callInstallAfterQuit ? "chatgptLinuxInstallAfterQuit();" : "";
  return `function chatgptLinuxQuitForUpdate(){try{${prefix}let t=chatgptLinuxGetElectronModule();if(!t)return;let e=setTimeout(()=>t.app?.exit?.(0),1500);e.unref?.(),t.app?.quit?.()}catch{}}`;
}

function buildBridgeSource({ childProcessVar, fsVar, pathVar }) {
  const showUpdateMessage =
    `async function chatgptLinuxShowUpdateMessage(chatgptLinuxMessage,chatgptLinuxDetail){try{let e=chatgptLinuxGetElectronModule();if(!e)return;await e.dialog?.showMessageBox({type:\`info\`,buttons:[\`OK\`],defaultId:0,noLink:!0,message:chatgptLinuxMessage,detail:chatgptLinuxDetail})}catch{}}`;
  const installAfterQuit = buildInstallAfterQuitSource(childProcessVar);
  const quitForUpdate = buildQuitForUpdateSource(true);
  return `${buildElectronResolverSource()}${buildUpdateManagerEnvSource()}function chatgptLinuxUpdateStatePath(){let e=process.env.XDG_STATE_HOME||process.env.HOME&&(0,${pathVar}.join)(process.env.HOME,\`.local\`,\`state\`);return e?(0,${pathVar}.join)(e,\`chatgpt-updater\`,\`state.json\`):null}function chatgptLinuxReadUpdateState(){let e=chatgptLinuxUpdateStatePath();if(!e||!${fsVar}.existsSync(e))return null;try{let t=JSON.parse(${fsVar}.readFileSync(e,\`utf8\`));return t&&typeof t===\`object\`&&!Array.isArray(t)?t:null}catch{return null}}function chatgptLinuxUpdateLifecycleState(e){switch(e){case\`ready_to_install\`:case\`waiting_for_app_exit\`:return\`ready\`;case\`installing\`:return\`installing\`;case\`checking_upstream\`:case\`update_detected\`:case\`downloading_dmg\`:case\`preparing_workspace\`:case\`patching_app\`:case\`building_package\`:return\`checking\`;default:return\`idle\`}}function chatgptLinuxUpdateManagerPath(){for(let e of [process.env.CHATGPT_UPDATER_PATH])if(typeof e===\`string\`&&e.trim().length>0)return e;return\`chatgpt-updater\`}${showUpdateMessage}${installAfterQuit}${quitForUpdate}function chatgptLinuxRunAppUpdater(e){return new Promise((t,n)=>{${childProcessVar}.execFile(chatgptLinuxUpdateManagerPath(),e,{encoding:\`utf8\`,windowsHide:!0,env:chatgptLinuxUpdateManagerEnv()},(e,r,i)=>{if(e){e.stdout=r,e.stderr=i,n(e);return}t({stdout:r??\`\`,stderr:i??\`\`})})})}async function chatgptLinuxProbeAppUpdater(){await chatgptLinuxRunAppUpdater([\`--help\`])}async function chatgptLinuxRefreshUpdateState(){return chatgptLinuxReadUpdateState()}`;
}

function buildBootstrapBridgeSource({ childProcessVar, fsVar, pathVar }) {
  return `${buildBridgeSource({ childProcessVar, fsVar, pathVar })};function chatgptLinuxCreatePackageAppUpdater(e){let t=!1,n=\`idle\`,r=null,i=()=>{try{let e=chatgptLinuxReadUpdateState(),r=e?.status;t=r===\`ready_to_install\`||r===\`waiting_for_app_exit\`,n=chatgptLinuxUpdateLifecycleState(r);return e}catch{return null}},a=()=>{try{e.send({type:\`app-update-ready-changed\`,isUpdateReady:t}),e.send({type:\`app-update-lifecycle-state-changed\`,lifecycleState:n}),e.send({type:\`app-update-install-progress-changed\`,installProgressPercent:r})}catch{}},s=!1,c=chatgptLinuxProbeAppUpdater().then(()=>{s=!0,i(),a();return!0}).catch(()=>{s=!1,t=!1,n=\`idle\`,a();return!1});let o=()=>{e.allowQuit?.();chatgptLinuxQuitForUpdate()};return{manager:{setAutomaticBackgroundDownloadsEnabled:()=>{},setSparkleQueryParams:()=>{},getDownloadProgressPercent:()=>null,getDownloadedUpdateAppBrand:()=>null,getIsUpdateReady:()=>s&&t,getUpdateLifecycleState:()=>s?n:\`idle\`,getInstallProgressPercent:()=>r,getRelaunchNotice:()=>null,hasUpdater:()=>s,getUnavailableReason:()=>s?null:\`Linux package update manager unavailable\`,checkForUpdates:async()=>{if(!await c)return;n=\`checking\`,a();try{await chatgptLinuxRunAppUpdater([\`check-now\`]),i(),a()}catch(e){n=t?\`ready\`:\`idle\`,a();throw e}},installUpdatesIfAvailable:async()=>{if(!await c){a();return}i();if(!t){a();return}r=0,n=\`installing\`,a();try{let e=await chatgptLinuxRunAppUpdater([\`install-ready\`]),s=i();if(s?.status===\`waiting_for_app_exit\`){r=null,n=\`ready\`,a(),o();return}r=null,a(),e.stdout?.includes(\`Manual install required:\`)?await chatgptLinuxShowUpdateMessage(\`ChatGPT update\`,e.stdout.trim()):e.stdout?.includes(\`already installed\`)?await chatgptLinuxShowUpdateMessage(\`ChatGPT update\`,\`The ready update is already installed.\`):e.stdout?.includes(\`No ChatGPT update is ready\`)&&await chatgptLinuxShowUpdateMessage(\`ChatGPT update\`,\`There is no rebuilt update waiting to install.\`)}catch(e){r=null,n=t?\`ready\`:\`idle\`,a();throw e}}},quitForUpdate:o,refresh:async()=>{if(await c){try{await chatgptLinuxRefreshUpdateState()}catch{}i()}else t=!1,n=\`idle\`;a()}}}`;
}

function applyCurrentBootstrapUpdaterBridgePatch(currentSource) {
  if (
    !currentSource.includes("setSparkleBridgeHandlers") ||
    !currentSource.includes("sparkleManager:") ||
    !currentSource.includes("onInstallUpdatesRequested")
  ) {
    return currentSource;
  }

  const childProcessVar = requireName(currentSource, "node:child_process");
  const fsVar = requireName(currentSource, "node:fs");
  const pathVar = requireName(currentSource, "node:path");
  if (childProcessVar == null || fsVar == null || pathVar == null) {
    console.warn("WARN: Could not find updater bridge module bindings - skipping Linux updater bridge patch");
    return currentSource;
  }

  let patchedSource = currentSource;
  if (!patchedSource.includes("function chatgptLinuxCreatePackageAppUpdater(")) {
    if (!patchedSource.includes("state:`disabled`")) {
      return currentSource;
    }
    const bootstrapMatch = patchedSource.match(/var [A-Za-z_$][\w$]*=\{enabled:!1,running:!1,state:`disabled`\};/);
    if (bootstrapMatch == null) {
      console.warn("WARN: Could not find current updater bridge insertion point - skipping Linux updater bridge patch");
      return currentSource;
    }
    patchedSource = patchedSource.replace(
      bootstrapMatch[0],
      `${buildBootstrapBridgeSource({ childProcessVar, fsVar, pathVar })};${bootstrapMatch[0]}`,
    );
  }

  const destructureRegex =
    /let\{startedAtMs:([A-Za-z_$][\w$]*),buildFlavor:([A-Za-z_$][\w$]*),desktopSentry:([A-Za-z_$][\w$]*),sparkleManager:([A-Za-z_$][\w$]*),productionAppcastStateStore:[A-Za-z_$][\w$]*,setSparkleBridgeHandlers:([A-Za-z_$][\w$]*),setSecondInstanceArgsHandler:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(\),/;
  const destructureMatch = patchedSource.match(destructureRegex);
  const sparkleVar = destructureMatch?.[4] ?? null;
  const setSparkleBridgeHandlersVar = destructureMatch?.[5] ?? null;
  if (sparkleVar == null) {
    console.warn("WARN: Could not identify current sparkleManager binding - skipping Linux updater bridge patch");
    return currentSource;
  }
  const bridgeHandlersStart = setSparkleBridgeHandlersVar == null
    ? -1
    : patchedSource.indexOf(`${setSparkleBridgeHandlersVar}({`, destructureMatch.index ?? 0);
  const bridgeHandlersSearchSource = bridgeHandlersStart === -1
    ? ""
    : patchedSource.slice(bridgeHandlersStart);
  const appUpdateStateBroadcasterVar = bridgeHandlersSearchSource.match(
    /([A-Za-z_$][\w$]*)\.broadcastAppUpdateState\(\)/,
  )?.[1] ?? null;
  const sendCallback = appUpdateStateBroadcasterVar == null
    ? null
    : `send:()=>${appUpdateStateBroadcasterVar}.broadcastAppUpdateState()`;
  if (sendCallback == null) {
    console.warn("WARN: Could not identify current updater window message dispatcher - skipping Linux updater bridge patch");
    return currentSource;
  }

  if (!patchedSource.includes("chatgptLinuxPackageUpdateBridge=process.platform===`linux`")) {
    const currentBridgeRegex =
      /let ([A-Za-z_$][\w$]*)=new [A-Za-z_$][\w$]*,(?:[A-Za-z_$][\w$]*=null,){2}([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*=>\{[^]*?\},(?=[A-Za-z_$][\w$]*=)/;
    const currentBridgeMatch = patchedSource.match(currentBridgeRegex);
    if (currentBridgeMatch == null) {
      console.warn("WARN: Could not find current updater callback bridge - skipping Linux updater bridge patch");
      return currentSource;
    }
    const [bridgeDeclaration, quitControllerVar, quitFnVar] = currentBridgeMatch;
    const bridgeSetup =
      `${bridgeDeclaration}chatgptLinuxPackageUpdateBridge=process.platform===\`linux\`?chatgptLinuxCreatePackageAppUpdater({allowQuit:()=>${quitControllerVar}.allowQuitTemporarilyForUpdateInstall(),${sendCallback}}):null;chatgptLinuxPackageUpdateBridge!=null&&(${sparkleVar}=chatgptLinuxPackageUpdateBridge.manager,${quitFnVar}=chatgptLinuxPackageUpdateBridge.quitForUpdate,setInterval(()=>chatgptLinuxPackageUpdateBridge.refresh(),3e4).unref?.());let `;
    patchedSource = patchedSource.replace(currentBridgeRegex, bridgeSetup);
  }

  return patchedSource;
}

function applyLinuxAppUpdaterBridgePatch(currentSource) {
  return applyCurrentBootstrapUpdaterBridgePatch(currentSource);
}

function applyLinuxAppUpdaterMenuPatch(currentSource) {
  if (/[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\.shouldIncludeSparkle\([A-Za-z_$][\w$]*,process\.platform,process\.env\)\|\|process\.platform===`linux`/.test(currentSource)) {
    return currentSource;
  }
  const menuRegex =
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.shouldIncludeSparkle\(([A-Za-z_$][\w$]*),process\.platform,process\.env\)/;
  if (!menuRegex.test(currentSource)) {
    if (currentSource.includes("enableSparkle") && currentSource.includes("shouldIncludeSparkle")) {
      console.warn("WARN: Could not find update menu feature gate - skipping Linux update menu patch");
    }
    return currentSource;
  }
  return currentSource.replace(menuRegex, "$1=$2.$3.shouldIncludeSparkle($4,process.platform,process.env)||process.platform===`linux`");
}

function patchLinuxAppUpdaterBridge(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    console.warn(`WARN: Could not find build directory in ${buildDir} - skipping Linux updater bridge patch`);
    return { matched: 0, changed: 0 };
  }

  let matched = 0;
  let changed = 0;
  for (const fileName of fs.readdirSync(buildDir).filter((name) => name.endsWith(".js")).sort()) {
    const filePath = path.join(buildDir, fileName);
    const source = fs.readFileSync(filePath, "utf8");
    const shouldPatchMenu = source.includes("shouldIncludeSparkle");
    const shouldPatchBridge = source.includes("exports.runMainAppStartup");
    if (!shouldPatchMenu && !shouldPatchBridge) {
      continue;
    }
    matched += 1;
    let patched = source;
    if (shouldPatchMenu) {
      patched = applyLinuxAppUpdaterMenuPatch(patched);
    }
    if (shouldPatchBridge) {
      patched = applyLinuxAppUpdaterBridgePatch(patched);
    }
    if (patched !== source) {
      fs.writeFileSync(filePath, patched, "utf8");
      changed += 1;
    }
  }

  return { matched, changed };
}

module.exports = {
  applyLinuxAppUpdaterBridgePatch,
  applyLinuxAppUpdaterMenuPatch,
  patchLinuxAppUpdaterBridge,
};
