"use strict";

const {
  HANDLER_PREFIX_LOOKBACK,
  escapeRegExp,
  findDisposableVar,
  findLastRegexMatch,
  findLinuxGlobalStateExpression,
  findMatchingBrace,
  inferModuleAlias,
} = require("../lib/minified-js.js");
const {
  linuxSettingsKeys,
} = require("../lib/settings-keys.js");

// Launch-action patches keep second launches, hotkey windows, and persisted
// Linux settings coordinated with the generated launcher.
const linuxQuitStateHelpers =
  "let chatgptLinuxQuitInProgress=!1,chatgptLinuxExplicitQuitApproved=!1,chatgptLinuxMarkQuitInProgress=()=>{chatgptLinuxQuitInProgress=!0},chatgptLinuxPrepareForExplicitQuit=()=>{chatgptLinuxExplicitQuitApproved=!0,chatgptLinuxMarkQuitInProgress()},chatgptLinuxShouldBypassQuitPrompt=()=>chatgptLinuxExplicitQuitApproved===!0,chatgptLinuxIsQuitInProgress=()=>chatgptLinuxQuitInProgress===!0,";

function persistedLinuxSettingsKeysSource() {
  return `[${Object.values(linuxSettingsKeys).map((key) => `\`${key}\``).join(",")}]`;
}

function applyLinuxSettingsPersistencePatch(currentSource) {
  let patchedSource = currentSource;

  if (!patchedSource.includes('"set-global-state"')) {
    return patchedSource;
  }

  if (!patchedSource.includes("function chatgptLinuxPersistSettingsState(")) {
    const pathVar = inferModuleAlias(patchedSource, "node:path");
    const fsVar = inferModuleAlias(patchedSource, "node:fs");
    if (pathVar == null || fsVar == null) {
      console.warn("WARN: Could not find Linux settings module bindings — skipping settings persistence patch");
      return patchedSource;
    }

    const settingsHelperSource =
      `function chatgptLinuxSettingsAppId(){let e=process.env.CHATGPT_LINUX_APP_ID||process.env.CHATGPT_APP_ID||\`chatgpt\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`chatgpt\`}function chatgptLinuxSettingsPath(){let e=process.env.CHATGPT_LINUX_SETTINGS_FILE;if(typeof e===\`string\`&&e.length>0)return e;let t=process.env.XDG_CONFIG_HOME||process.env.HOME&&${pathVar}.join(process.env.HOME,\`.config\`);return t?${pathVar}.join(t,chatgptLinuxSettingsAppId(),\`settings.json\`):null}function chatgptLinuxReadSettingsFile(){let e=chatgptLinuxSettingsPath();if(!e||!${fsVar}.existsSync(e))return{};try{let t=${fsVar}.readFileSync(e,\`utf8\`),n=JSON.parse(t);return n&&typeof n===\`object\`&&!Array.isArray(n)?n:{}}catch(e){return{}}}function chatgptLinuxPersistSettingsState(e,t){if(process.platform!==\`linux\`||!${persistedLinuxSettingsKeysSource()}.includes(e))return;try{let n=chatgptLinuxSettingsPath();if(!n)return;let r=chatgptLinuxReadSettingsFile();t===void 0?delete r[e]:r[e]=t,${fsVar}.mkdirSync(${pathVar}.dirname(n),{recursive:!0,mode:448}),${fsVar}.writeFileSync(n,JSON.stringify(r,null,2)+\`\\n\`,\`utf8\`)}catch(e){}}`;
    const strictDirective = '"use strict";';
    const helperInsertionIndex = patchedSource.startsWith(strictDirective)
      ? strictDirective.length
      : 0;
    patchedSource =
      patchedSource.slice(0, helperInsertionIndex) +
      settingsHelperSource +
      patchedSource.slice(helperInsertionIndex);
  }

  if (
    /"set-global-state":async\(\{key:[A-Za-z_$][\w$]*,value:[A-Za-z_$][\w$]*\}\)=>\([\s\S]{0,300}?chatgptLinuxPersistSettingsState\(/.test(patchedSource)
  ) {
    return patchedSource;
  }

  const setGlobalStateRegex =
    /"set-global-state":async\(\{key:([A-Za-z_$][\w$]*),value:([A-Za-z_$][\w$]*)\}\)=>\((this\.setGlobalStateValue\(\1,\2\)),/;
  if (!setGlobalStateRegex.test(patchedSource)) {
    console.warn("WARN: Could not find Linux set-global-state needle — skipping settings persistence hook");
    return patchedSource;
  }

  return patchedSource.replace(
    setGlobalStateRegex,
    (_match, keyVar, valueVar, setterCall) =>
      `"set-global-state":async({key:${keyVar},value:${valueVar}})=>(${setterCall},chatgptLinuxPersistSettingsState(${keyVar},${valueVar}),`,
  );
}

function buildSemanticLinuxLaunchActionPatch({
  setterVar,
  deepLinksVar,
  fallbackFn,
  openerFn,
  windowManagerVar,
  hostExpr,
  getPrimaryWindowCall,
  createFreshWindowMethod,
  currentWindowVar,
  createdWindowVar,
  routeVar,
  focusFn,
  notificationVar,
  globalStateExpr,
  reporterVar,
  disposableVar,
  appVar,
  freshWindowExpr,
}) {
  const notificationPrefix = notificationVar == null
    ? ""
    : `${notificationVar}.desktopNotificationManager.dismissByNavigationPath(e),`;
  const quitState = linuxQuitStateHelpers;
  const directHandler = appVar == null
    ? ""
    : `,chatgptLinuxSecondInstanceHandler=(e,t)=>{chatgptLinuxHandleLaunchActionArgsFallback(t,()=>{${fallbackFn}()})},chatgptLinuxBeforeQuitHandler=()=>{typeof chatgptLinuxMarkQuitInProgress===\`function\`&&chatgptLinuxMarkQuitInProgress()}`;
  const startup = appVar == null
    ? `process.platform===\`linux\`&&chatgptLinuxStartLaunchActionSocket();${setterVar}(e=>{chatgptLinuxHandleLaunchActionArgsFallback(e,()=>{${fallbackFn}()})});`
    : `process.platform===\`linux\`&&(${appVar}.app.on(\`before-quit\`,chatgptLinuxBeforeQuitHandler),${disposableVar}.add(()=>{${appVar}.app.off(\`before-quit\`,chatgptLinuxBeforeQuitHandler)}),chatgptLinuxStartLaunchActionSocket(),${appVar}.app.on(\`second-instance\`,chatgptLinuxSecondInstanceHandler),${disposableVar}.add(()=>{${appVar}.app.off(\`second-instance\`,chatgptLinuxSecondInstanceHandler)}));${setterVar}(e=>{chatgptLinuxHandleLaunchActionArgsFallback(e,()=>{${fallbackFn}()})});`;

  const ensureHostWindowCall = hostExpr == null ? `${windowManagerVar}.ensureHostWindow()` : `${windowManagerVar}.ensureHostWindow(${hostExpr})`;
  const createFreshWindow = freshWindowExpr ?? ((pathExpr) => `${windowManagerVar}.${createFreshWindowMethod}(${pathExpr})`);
  const defaultSocket =
    "chatgptLinuxDefaultLaunchActionSocket=()=>{let e=chatgptLinuxLaunchActionAppId(),t=chatgptLinuxLaunchActionInstanceId(),n=process.env.XDG_RUNTIME_DIR?.trim(),r=require(`node:path`);if(n&&n.length>0)return t?r.join(n,e,`instances`,t,`launch-action.sock`):r.join(n,e,`launch-action.sock`);let i=process.env.XDG_STATE_HOME?.trim(),a=process.env.HOME?.trim();if((!i||i.length===0)&&a&&a.length>0)i=r.join(a,`.local`,`state`);if(!i||i.length===0)return null;return t?r.join(i,e,`instances`,t,`launch-action.sock`):r.join(i,e,`launch-action.sock`)}";
  const startSocket =
    `chatgptLinuxStartLaunchActionSocket=()=>{if(process.platform!==\`linux\`)return;try{let e=process.env.CHATGPT_APP_LAUNCH_ACTION_SOCKET?.trim()||process.env.CHATGPT_DESKTOP_LAUNCH_ACTION_SOCKET?.trim()||chatgptLinuxDefaultLaunchActionSocket();if(!e||!chatgptLinuxIsWarmStartEnabled())return;let n=require(\`node:path\`),r=require(\`node:fs\`),i=require(\`node:net\`);r.mkdirSync(n.dirname(e),{recursive:!0,mode:448}),r.rmSync(e,{force:!0});let a=i.createServer(t=>{let n=\`\`,r=!1,i=()=>{if(r)return;r=!0;let i=[];try{let e=JSON.parse(n.trim());Array.isArray(e.argv)&&(i=e.argv.filter(e=>typeof e===\`string\`))}catch(e){t.end?.(\`error\\n\`);return}t.write?.(\`ok\\n\`),chatgptLinuxHandleLaunchActionArgs(i).then(e=>e?void 0:${fallbackFn}()).then(()=>{t.end?.()}).catch(e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to handle Linux launch action socket\`,{kind:\`linux-launch-action-socket-failed\`}),t.end?.()})};t.on(\`error\`,e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed Linux launch action socket client\`,{kind:\`linux-launch-action-socket-client-error\`})}),t.setEncoding?.(\`utf8\`),t.on(\`data\`,e=>{n+=e,n.includes(\`\\n\`)?i():n.length>65536&&t.destroy()}),t.on(\`end\`,i)});a.on(\`error\`,e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed Linux launch action socket\`,{kind:\`linux-launch-action-socket-error\`})}),a.listen(e),${disposableVar}.add(()=>{a.close(),r.rmSync(e,{force:!0})})}catch(e){${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to start Linux launch action socket\`,{kind:\`linux-launch-action-socket-start-failed\`})}}`;
  return `${quitState}chatgptLinuxGetSetting=e=>process.platform!==\`linux\`||${globalStateExpr}.get(e)!==!1,chatgptLinuxIsTrayEnabled=()=>chatgptLinuxGetSetting(\`${linuxSettingsKeys.systemTray}\`),chatgptLinuxIsWarmStartEnabled=()=>chatgptLinuxGetSetting(\`${linuxSettingsKeys.warmStart}\`),chatgptLinuxIsPromptWindowEnabled=()=>chatgptLinuxGetSetting(\`${linuxSettingsKeys.promptWindow}\`),chatgptLinuxLaunchActionAppId=()=>{let e=process.env.CHATGPT_LINUX_APP_ID||process.env.CHATGPT_APP_ID||\`chatgpt\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`chatgpt\`},chatgptLinuxLaunchActionInstanceId=()=>{let e=process.env.CHATGPT_LINUX_INSTANCE_ID?.trim();return e&&/^[A-Za-z0-9._-]+$/.test(e)?e:null},${defaultSocket},${openerFn}=async(e,t)=>{${windowManagerVar}.hotkeyWindowLifecycleManager.hide();let ${currentWindowVar}=${getPrimaryWindowCall},${createdWindowVar}=${currentWindowVar}??await ${createFreshWindow("e")};${createdWindowVar}!=null&&(${notificationPrefix}${currentWindowVar}!=null&&t.navigateExistingWindow&&${routeVar}.navigateToRoute(${createdWindowVar},e),${focusFn}(${createdWindowVar}))},chatgptLinuxGetHotkeyWindowController=()=>typeof ${windowManagerVar}.hotkeyWindowLifecycleManager.ensureHotkeyWindowController===\`function\`?${windowManagerVar}.hotkeyWindowLifecycleManager.ensureHotkeyWindowController():${windowManagerVar}.hotkeyWindowLifecycleManager,chatgptLinuxShowHotkeyWindow=async()=>{let e=chatgptLinuxGetHotkeyWindowController();typeof e.openHome===\`function\`?await e.openHome():typeof e.show===\`function\`?await e.show():await ${ensureHostWindowCall}},chatgptLinuxOpenQuickChat=async()=>{${windowManagerVar}.hotkeyWindowLifecycleManager.hide();let e=${getPrimaryWindowCall},t=e??await ${createFreshWindow("`/`")};t!=null&&(${windowManagerVar}.windowManager.sendMessageToWindow(t,{type:\`new-quick-chat\`}),${focusFn}(t))},chatgptLinuxHasDeepLink=e=>Array.isArray(e)&&e.some(e=>typeof e===\`string\`&&(e.startsWith(\`codex://\`)||e.startsWith(\`codex-browser-sidebar://\`))),chatgptLinuxHandleLaunchActionArgs=async e=>(typeof chatgptLinuxIsQuitInProgress===\`function\`&&chatgptLinuxIsQuitInProgress())?!0:chatgptLinuxHasDeepLink(e)&&${deepLinksVar}.deepLinks.queueProcessArgs(e)?!0:Array.isArray(e)&&(e.includes(\`--prompt-chat\`)||e.includes(\`--hotkey-window\`))?(chatgptLinuxIsPromptWindowEnabled()?(await chatgptLinuxShowHotkeyWindow(),!0):!1):Array.isArray(e)&&e.includes(\`--quick-chat\`)?(await chatgptLinuxOpenQuickChat(),!0):Array.isArray(e)&&e.includes(\`--new-chat\`)?(await ${openerFn}(\`/\`,{navigateExistingWindow:!0}),!0):!1,chatgptLinuxHandleLaunchActionArgsFallback=(e,t)=>{if(typeof chatgptLinuxIsQuitInProgress===\`function\`&&chatgptLinuxIsQuitInProgress())return;chatgptLinuxHandleLaunchActionArgs(e).then(e=>{e||t()}).catch(e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to handle Linux launch action\`,{kind:\`linux-launch-action-failed\`}),t()})},chatgptLinuxPrewarmHotkeyWindow=()=>{if(!chatgptLinuxIsPromptWindowEnabled())return;try{let e=chatgptLinuxGetHotkeyWindowController();typeof e.prewarm===\`function\`&&e.prewarm()}catch(e){${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to prewarm Linux hotkey window\`,{kind:\`linux-hotkey-window-prewarm-failed\`})}},${startSocket}${directHandler};${startup}`;
}

function applyCurrentSemanticLinuxLaunchActionArgsPatch(currentSource) {
  const handlerRegex =
    /([A-Za-z_$][\w$]*)\(e=>\{let ([A-Za-z_$][\w$]*)=[^;{}]+;if\(([A-Za-z_$][\w$]*)\.deepLinks\.queueProcessArgs\(e\)\)\{\2&&([A-Za-z_$][\w$]*)\(\);return\}if\(\2\)\{\4\(\);return\}\4\(\)\}\);let ([A-Za-z_$][\w$]*)=async\(e,t\)=>\{/g;
  let match;
  while ((match = handlerRegex.exec(currentSource)) != null) {
    const [, setterVar, , deepLinksVar, fallbackFn, openerFn] = match;
    const openerBraceIndex = match.index + match[0].length - 1;
    const openerLetIndex = openerBraceIndex - `let ${openerFn}=async(e,t)=>`.length;
    const openerEnd = findMatchingBrace(currentSource, openerBraceIndex);
    if (openerEnd === -1) {
      continue;
    }

    const separator = currentSource[openerEnd + 1];
    if (separator !== ";" && separator !== ",") {
      continue;
    }

    const openerText = currentSource.slice(openerLetIndex, openerEnd + 1);
    let openerVars = openerText.match(
      /([A-Za-z_$][\w$]*)\.hotkeyWindowLifecycleManager\.hide\(\);let ([A-Za-z_$][\w$]*)=\1\.getPrimaryWindow(?:\(([^)]*)\))?,([A-Za-z_$][\w$]*)=\2\?\?await \1\.(createFreshLocalWindow|createFreshWindow)\(e\);/,
    );
    let freshWindowExpr;
    if (openerVars == null) {
      const wrapperVars = openerText.match(
        /([A-Za-z_$][\w$]*)\.hotkeyWindowLifecycleManager\.hide\(\);let ([A-Za-z_$][\w$]*)=\1\.getPrimaryWindow(?:\(([^)]*)\))?,([A-Za-z_$][\w$]*)=\2\?\?await ([A-Za-z_$][\w$]*)\(e\);/,
      );
      if (wrapperVars != null) {
        const [, windowManagerVar, currentWindowVar, hostExprRaw, createdWindowVar, wrapperFn] = wrapperVars;
        const wrapperDefinition = new RegExp(
          `${escapeRegExp(wrapperFn)}=([A-Za-z_$][\\w$]*)=>[A-Za-z_$][\\w$]*\\?${escapeRegExp(windowManagerVar)}\\.createFresh(?:Local)?Window\\(\\1\\):Promise\\.resolve\\(null\\)`,
        );
        if (wrapperDefinition.test(currentSource.slice(Math.max(0, match.index - HANDLER_PREFIX_LOOKBACK), match.index))) {
          openerVars = [wrapperVars[0], windowManagerVar, currentWindowVar, hostExprRaw, createdWindowVar, "createFreshWindow"];
          freshWindowExpr = (pathExpr) => `${wrapperFn}(${pathExpr})`;
        }
      }
    }
    if (openerVars == null) {
      continue;
    }

    const [, windowManagerVar, currentWindowVar, hostExprRaw, createdWindowVar, createFreshWindowMethod] = openerVars;
    const routeVar = openerText.match(/([A-Za-z_$][\w$]*)\.navigateToRoute\([A-Za-z_$][\w$]*,e\)/)?.[1];
    const focusFn = openerText.match(new RegExp(`,([A-Za-z_$][\\w$]*)\\(${escapeRegExp(createdWindowVar)}\\)\\)\\}$`))?.[1];
    if (routeVar == null || focusFn == null) {
      continue;
    }

    const prefix = currentSource.slice(Math.max(0, match.index - HANDLER_PREFIX_LOOKBACK), match.index);
    const globalStateExpr = findLinuxGlobalStateExpression(prefix);
    const hostExpr =
      hostExprRaw?.trim() ||
      prefix.match(/localHost:([A-Za-z_$][\w$]*)/)?.[1] ||
      null;
    const getPrimaryWindowCall = hostExpr == null
      ? `${windowManagerVar}.getPrimaryWindow()`
      : `${windowManagerVar}.getPrimaryWindow(${hostExpr})`;
    const reporterVar = findLastRegexMatch(
      prefix,
      /([A-Za-z_$][\w$]*)\.reportNonFatal\(e instanceof Error\?e:`Failed to open window on second instance`/g,
    )?.[1] ?? findLastRegexMatch(prefix, /([A-Za-z_$][\w$]*)=\{reportNonFatal/g)?.[1];
    const appVar =
      findLastRegexMatch(prefix, /await ([A-Za-z_$][\w$]*)\.app\.whenReady\(\)/g)?.[1] ??
      findLastRegexMatch(prefix, /([A-Za-z_$][\w$]*)\.app\.requestSingleInstanceLock\(\)/g)?.[1] ??
      null;
    const disposableVar = findDisposableVar(prefix);
    if (globalStateExpr == null || reporterVar == null || disposableVar == null) {
      continue;
    }

    const notificationVar = openerText.match(
      /([A-Za-z_$][\w$]*)\.desktopNotificationManager\.dismissByNavigationPath\(e\)/,
    )?.[1] ?? null;
    const replacement = buildSemanticLinuxLaunchActionPatch({
      setterVar,
      deepLinksVar,
      fallbackFn,
      openerFn,
      windowManagerVar,
      hostExpr,
      getPrimaryWindowCall,
      createFreshWindowMethod,
      currentWindowVar,
      createdWindowVar,
      routeVar,
      focusFn,
      notificationVar,
      globalStateExpr,
      reporterVar,
      disposableVar,
      appVar,
      freshWindowExpr,
    });
    const suffix = separator === "," ? "let " : "";
    return currentSource.slice(0, match.index) + replacement + suffix + currentSource.slice(openerEnd + 2);
  }

  return currentSource;
}

function applyLinuxLaunchActionArgsPatch(currentSource) {
  let patchedSource = currentSource;

  if (
    patchedSource.includes("chatgptLinuxQuitInProgress=!1") &&
    patchedSource.includes("chatgptLinuxExplicitQuitApproved=!1") &&
    patchedSource.includes("chatgptLinuxMarkQuitInProgress=()=>{chatgptLinuxQuitInProgress=!0}") &&
    patchedSource.includes("chatgptLinuxPrepareForExplicitQuit=()=>{chatgptLinuxExplicitQuitApproved=!0,chatgptLinuxMarkQuitInProgress()}") &&
    patchedSource.includes("chatgptLinuxShouldBypassQuitPrompt=()=>chatgptLinuxExplicitQuitApproved===!0") &&
    patchedSource.includes("chatgptLinuxIsQuitInProgress=()=>chatgptLinuxQuitInProgress===!0") &&
    patchedSource.includes("chatgptLinuxGetSetting=e=>") &&
    patchedSource.includes("chatgptLinuxGetHotkeyWindowController=()=>") &&
    patchedSource.includes("chatgptLinuxPrewarmHotkeyWindow=()=>") &&
    patchedSource.includes("chatgptLinuxStartLaunchActionSocket=()=>") &&
    (
      /[A-Za-z_$][\w$]*\.app\.on\(`before-quit`,chatgptLinuxBeforeQuitHandler\)/.test(patchedSource) ||
      /process\.platform===`linux`&&chatgptLinuxStartLaunchActionSocket\(\);[A-Za-z_$][\w$]*\(e=>\{chatgptLinuxHandleLaunchActionArgsFallback\(e,\(\)=>\{[A-Za-z_$][\w$]*\(\)\}\)\}\)/.test(patchedSource)
    ) &&
    !patchedSource.includes("chatgptLinuxOpenNewChat")
  ) {
    return patchedSource;
  }

  const currentSemanticLaunchActionPatch = applyCurrentSemanticLinuxLaunchActionArgsPatch(patchedSource);
  if (currentSemanticLaunchActionPatch !== patchedSource) {
    return currentSemanticLaunchActionPatch;
  }

  if (
    patchedSource.includes("Launching app") &&
    patchedSource.includes("deepLinks")
  ) {
    console.warn("WARN: Could not find Linux launch action handler - skipping --new-chat/--quick-chat/--prompt-chat patch");
    return patchedSource;
  }

  if (patchedSource.includes("Launching app") && !patchedSource.includes("chatgptLinuxGetSetting=e=>")) {
    console.warn("WARN: Linux launch action patch was not settings-gated - skipping --new-chat/--quick-chat/--prompt-chat patch");
  }

  return patchedSource;
}

function applyLinuxHotkeyWindowPrewarmPatch(currentSource) {
  let patchedSource = currentSource;

  if (!patchedSource.includes("chatgptLinuxPrewarmHotkeyWindow=()=>")) {
    return patchedSource;
  }

  if (
    /process\.platform===`linux`&&chatgptLinuxPrewarmHotkeyWindow\(\),[A-Za-z_$][\w$]*=Date\.now\(\),await [A-Za-z_$][\w$]*\.deepLinks\.flushPendingDeepLinks\(\)/.test(patchedSource)
  ) {
    return patchedSource;
  }

  const dynamicStartupPrewarmRegex =
    /(([A-Za-z_$][\w$]*)\(`(?:local )?window ensured`,([A-Za-z_$][\w$]*),\{(?:hostId:[^,{}]+,localWindowVisible:[^}]+|windowVisible:[^}]+)\}\),)\3=Date\.now\(\),await ([A-Za-z_$][\w$]*)\.deepLinks\.flushPendingDeepLinks\(\)/;
  const dynamicStartupPrewarmMatch = patchedSource.match(dynamicStartupPrewarmRegex);
  if (dynamicStartupPrewarmMatch != null) {
    const [, prefix, _traceVar, timeVar, deepLinksVar] = dynamicStartupPrewarmMatch;
    patchedSource = patchedSource.replace(
      dynamicStartupPrewarmRegex,
      `${prefix}process.platform===\`linux\`&&chatgptLinuxPrewarmHotkeyWindow(),${timeVar}=Date.now(),await ${deepLinksVar}.deepLinks.flushPendingDeepLinks()`,
    );
  } else {
    console.warn("WARN: Could not find Linux hotkey window prewarm insertion point — skipping startup prewarm patch");
  }

  return patchedSource;
}

module.exports = {
  applyLinuxHotkeyWindowPrewarmPatch,
  applyLinuxLaunchActionArgsPatch,
  applyLinuxSettingsPersistencePatch,
};
