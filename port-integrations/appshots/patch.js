"use strict";

const { escapeRegExp } = require("../../scripts/patches/lib/minified-js.js");

const APPSHOT_HELPER_MARKER = "chatgptLinuxAppshotStartCapture";
const LINUX_APPSHOT_X11_HOTKEYS = [
  { hotkey: "DoubleOption", label: "Alt + Alt" },
  { hotkey: "DoubleShift", label: "Shift + Shift" },
  { hotkey: "Ctrl+Super+A", label: "Ctrl + Super + A" },
];
const LINUX_APPSHOT_WAYLAND_HOTKEYS = [
  { hotkey: "Ctrl+Super+A", label: "Ctrl + Super + A" },
];

function warn(message, patchName) {
  console.warn(`WARN: ${message} - skipping ${patchName}`);
}

function applyLinuxAppshotAvailabilityPatch(currentSource) {
  const patchedGatePattern =
    /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{return \1===`linux`\|\|\1===`macOS`\|\|\1===`windows`&&\2!=null&&[A-Za-z_$][\w$]*\.isInternal\(\2\)\}/;
  if (patchedGatePattern.test(currentSource)) {
    return currentSource;
  }

  const currentGatePattern =
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{return \2===`macOS`\|\|\2===`windows`&&\3!=null&&([A-Za-z_$][\w$]*)\.isInternal\(\3\)\}/g;
  const matches = [...currentSource.matchAll(currentGatePattern)];
  if (matches.length === 1) {
    return currentSource.replace(
      currentGatePattern,
      (_match, functionName, platformVar, buildFlavorVar, buildFlavorModule) =>
        `function ${functionName}(${platformVar},${buildFlavorVar}){return ${platformVar}===\`linux\`||${platformVar}===\`macOS\`||${platformVar}===\`windows\`&&${buildFlavorVar}!=null&&${buildFlavorModule}.isInternal(${buildFlavorVar})}`,
    );
  }

  if (currentSource.includes("macOS") || currentSource.includes("appshot")) {
    warn("Could not find AppShots availability gate", "Linux AppShots availability patch");
  }
  return currentSource;
}

function applyLinuxAppshotMainProcessPatch(currentSource) {
  if (currentSource.includes(APPSHOT_HELPER_MARKER)) {
    return currentSource;
  }

  if (!currentSource.includes(".sendInlineMessageForView(")) {
    warn("Could not find inline renderer message sender", "Linux AppShots main-process patch");
    return currentSource;
  }

  const frontmostPattern =
    /"computer-use-frontmost-window":async\(\{origin:([A-Za-z_$][\w$]*),signal:([A-Za-z_$][\w$]*)\}\)=>process\.platform===`win32`\?([A-Za-z_$][\w$]*)\(\)\.appshotsEnabled\?this\.windowsCaptureNativeBridge\?\.getFrontmostWindow\(\1,\2\)\?\?null:null:process\.platform===`darwin`\?([A-Za-z_$][\w$]*)\(\):null/g;
  const capturePattern =
    /"computer-use-start-capture":async\(\{animationDestination:([A-Za-z_$][\w$]*),bundleIdentifier:([A-Za-z_$][\w$]*),origin:([A-Za-z_$][\w$]*),requestId:([A-Za-z_$][\w$]*),signal:([A-Za-z_$][\w$]*)\}\)=>\{if\(process\.platform!==`darwin`&&process\.platform!==`win32`\)return null;/g;
  if (
    [...currentSource.matchAll(frontmostPattern)].length !== 1 ||
    [...currentSource.matchAll(capturePattern)].length !== 1
  ) {
    if (currentSource.includes("computer-use-frontmost-window") || currentSource.includes("computer-use-start-capture")) {
      warn("Could not find AppShots main-process handlers", "Linux AppShots main-process patch");
    }
    return currentSource;
  }

  let patchedSource = currentSource.replace(
    frontmostPattern,
    (_match, originVar, signalVar, appshotsStateFn, macFrontmostFn) =>
      `"computer-use-frontmost-window":async({origin:${originVar},signal:${signalVar}})=>process.platform===\`linux\`?chatgptLinuxAppshotFrontmostWindow():process.platform===\`win32\`?${appshotsStateFn}().appshotsEnabled?this.windowsCaptureNativeBridge?.getFrontmostWindow(${originVar},${signalVar})??null:null:process.platform===\`darwin\`?${macFrontmostFn}():null`,
  );
  patchedSource = patchedSource.replace(
    capturePattern,
    (_match, animationDestinationVar, bundleIdentifierVar, originVar, requestIdVar, signalVar) =>
      `"computer-use-start-capture":async({animationDestination:${animationDestinationVar},bundleIdentifier:${bundleIdentifierVar},origin:${originVar},requestId:${requestIdVar},signal:${signalVar}})=>{if(process.platform===\`linux\`)return chatgptLinuxAppshotStartCapture({origin:${originVar},requestId:${requestIdVar},bundleIdentifier:${bundleIdentifierVar},windowManager:this.windowManager});if(process.platform!==\`darwin\`&&process.platform!==\`win32\`)return null;`,
  );

  return appendLinuxAppshotHelper(patchedSource);
}

function applyLinuxAppshotHotkeyPatch(currentSource) {
  const alreadyPatched = [
    /[A-Za-z_$][\w$]*===void 0\?this\.configuredHotkey=process\.platform===`linux`\?null:process\.platform===`win32`\?[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*:this\.configuredHotkey=[A-Za-z_$][\w$]*/,
    /supported:this\.enabled&&\(process\.platform===`linux`\|\|process\.platform===`darwin`\|\|process\.platform===`win32`&&this\.windowsCaptureNativeBridge!=null&&!this\.windowsCaptureNativeBridgeFailed\),configuredHotkey:this\.configuredHotkey,isActive:this\.registration!=null,linuxWayland:chatgptLinuxAppshotIsWayland\(\)/,
    /return [A-Za-z_$][\w$]*\.length===1\?\([A-Za-z_$][\w$]*===`darwin`\|\|[A-Za-z_$][\w$]*===`linux`\)\?/,
    /return \([A-Za-z_$][\w$]*===`darwin`\|\|[A-Za-z_$][\w$]*===`linux`&&!chatgptLinuxAppshotIsWayland\(\)\)&&/,
    /if\(process\.platform!==`darwin`&&process\.platform!==`linux`\)return null/,
    /new Set\(\[\.\.\.[A-Za-z_$][\w$]*,`shift`,`super`,`meta`,`win`\]\)/,
  ].every((pattern) => pattern.test(currentSource));
  if (alreadyPatched && currentSource.includes("function chatgptLinuxAppshotIsWayland")) {
    return currentSource;
  }

  let patchedSource = currentSource;
  const counts = [];
  function replaceRequired(pattern, replacement) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const count = [...patchedSource.matchAll(new RegExp(pattern.source, flags))].length;
    counts.push(count);
    if (count !== 1) {
      return;
    }
    patchedSource = patchedSource.replace(pattern, replacement);
  }

  replaceRequired(
    /([A-Za-z_$][\w$]*)===void 0\?this\.configuredHotkey=process\.platform===`win32`\?([A-Za-z_$][\w$]*):([A-Za-z_$][\w$]*):this\.configuredHotkey=\1/,
    (match, storedVar, windowsDefaultHotkeyVar, macDefaultHotkeyVar) =>
      `${storedVar}===void 0?this.configuredHotkey=process.platform===\`linux\`?null:process.platform===\`win32\`?${windowsDefaultHotkeyVar}:${macDefaultHotkeyVar}:this.configuredHotkey=${storedVar}`,
  );
  replaceRequired(
    /getState\(\)\{return\{supported:this\.enabled&&\(process\.platform===`darwin`\|\|process\.platform===`win32`&&this\.windowsCaptureNativeBridge!=null&&!this\.windowsCaptureNativeBridgeFailed\),configuredHotkey:this\.configuredHotkey,isActive:this\.registration!=null\}\}/,
    "getState(){return{supported:this.enabled&&(process.platform===`linux`||process.platform===`darwin`||process.platform===`win32`&&this.windowsCaptureNativeBridge!=null&&!this.windowsCaptureNativeBridgeFailed),configuredHotkey:this.configuredHotkey,isActive:this.registration!=null,linuxWayland:chatgptLinuxAppshotIsWayland()}}",
  );
  replaceRequired(
    /return ([A-Za-z_$][\w$]*)\.length===1\?([A-Za-z_$][\w$]*)===`darwin`\?([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),\2\)\?null:`This shortcut key is not supported\.`:`Choose a shortcut with Ctrl or Alt plus another key\.`:`Use Ctrl, Alt, or Command when combining with another key\.`/,
    (match, partsVar, platformVar, supportedBareModifierFn, hotkeyVar) =>
      `return ${partsVar}.length===1?(${platformVar}===\`darwin\`||${platformVar}===\`linux\`)?${supportedBareModifierFn}(${hotkeyVar},${platformVar})?null:\`This shortcut key is not supported.\`:\`Choose a shortcut with Ctrl or Alt plus another key.\`:\`Use Ctrl, Alt, or Command when combining with another key.\``,
  );
  replaceRequired(
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=process\.platform\)\{return \3===`darwin`&&([A-Za-z_$][\w$]*)\(\2\)!=null\}/,
    (match, fnName, hotkeyVar, platformVar, modifierFn) =>
      `function ${fnName}(${hotkeyVar},${platformVar}=process.platform){return (${platformVar}===\`darwin\`||${platformVar}===\`linux\`&&!chatgptLinuxAppshotIsWayland())&&${modifierFn}(${hotkeyVar})!=null}`,
  );
  replaceRequired(
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=`press`\)\{if\(process\.platform!==`darwin`\)return null;/,
    (match, fnName, hotkeyVar, handlerVar, triggerVar) =>
      `function ${fnName}(${hotkeyVar},${handlerVar},${triggerVar}=\`press\`){if(process.platform!==\`darwin\`&&process.platform!==\`linux\`)return null;`,
  );
  replaceRequired(
    /new Set\(\[\.\.\.([A-Za-z_$][\w$]*),`shift`\]\)/,
    (match, baseModifiersVar) =>
      `new Set([...${baseModifiersVar},\`shift\`,\`super\`,\`meta\`,\`win\`])`,
  );

  if (counts.every((count) => count === 1)) {
    return withLinuxAppshotWaylandHelper(patchedSource);
  }

  if (currentSource.includes("appshotHotkey") || currentSource.includes("appshot-hotkey-state")) {
    warn("Could not find current AppShots hotkey class", "Linux AppShots hotkey patch");
  }
  return currentSource;
}

function applyLinuxAppshotSettingsHotkeyPatch(currentSource) {
  const linuxX11Options = `[${LINUX_APPSHOT_X11_HOTKEYS.map(
    (option) => `{hotkey:\`${option.hotkey}\`,label:\`${option.label}\`}`,
  ).join(",")}]`;
  const linuxWaylandOptions = `[${LINUX_APPSHOT_WAYLAND_HOTKEYS.map(
    (option) => `{hotkey:\`${option.hotkey}\`,label:\`${option.label}\`}`,
  ).join(",")}]`;
  if (currentSource.includes("chatgptLinuxAppshotHotkeyOptions")) {
    return currentSource;
  }

  const stateDataVar =
    currentSource.match(
      /(?:^|[{};,])(?:let|const|var)?\s*\{data:([A-Za-z_$][\w$]*)\}\s*=\s*[A-Za-z_$][\w$]*\(`appshot-hotkey-state`/,
    )?.[1] ??
    currentSource.match(/\b([A-Za-z_$][\w$]*)\?\.configuredHotkey\?\?null/)?.[1] ??
    null;
  if (stateDataVar == null) {
    if (currentSource.includes("appshot-hotkey-state") || currentSource.includes("DoubleCommand")) {
      warn("Could not find AppShots settings state binding", "Linux AppShots settings hotkey patch");
    }
    return currentSource;
  }

  const optionsPattern =
    /((?:var\s+|,)([A-Za-z_$][\w$]*)=)(\[\{hotkey:`DoubleCommand`,label:`[^`]+`\},\{hotkey:`DoubleOption`,label:`[^`]+`\},\{hotkey:`DoubleShift`,label:`[^`]+`\}\])(?=[,;)}])/g;
  const optionsMatches = [...currentSource.matchAll(optionsPattern)];
  if (optionsMatches.length !== 1) {
    if (currentSource.includes("appshot-hotkey-state") || currentSource.includes("DoubleCommand")) {
      warn("Could not find AppShots settings hotkey options", "Linux AppShots settings patch");
    }
    return currentSource;
  }

  const optionsVarName = optionsMatches[0][2];
  const macOptions = optionsMatches[0][3];
  const optionsVarPattern = escapeRegExp(optionsVarName);
  const selectionPattern = new RegExp(
    `let ([A-Za-z_$][\\w$]*)=([A-Za-z_$][\\w$]*)===\`windows\`\\?(\\[\\{hotkey:\`DoubleAlt\`,label:[^{}]+\\},\\{hotkey:\`DoubleShift\`,label:[^{}]+\\}\\]):${optionsVarPattern},([A-Za-z_$][\\w$]*)=\\1\\.find\\(`,
    "g",
  );
  const selectionMatches = [...currentSource.matchAll(selectionPattern)];
  if (selectionMatches.length !== 1) {
    warn("Could not find both AppShots settings hotkey option call sites", "Linux AppShots settings patch");
    return currentSource;
  }

  const [, optionsLocalVar, platformVar, windowsOptions, selectedOptionVar] =
    selectionMatches[0];
  const findCount = replaceIdentifierCall(
    currentSource,
    optionsLocalVar,
    "find",
    `${optionsLocalVar}.find(`,
  ).count;
  const mapCount = replaceIdentifierCall(
    currentSource,
    optionsLocalVar,
    "map",
    `${optionsLocalVar}.map(`,
  ).count;
  if (findCount !== 1 || mapCount !== 1) {
    warn("Could not find both AppShots settings hotkey option call sites", "Linux AppShots settings patch");
    return currentSource;
  }

  const patchedSource = currentSource.replace(
    selectionPattern,
    () =>
      `let ${optionsLocalVar}=chatgptLinuxAppshotHotkeyOptions(${stateDataVar},${platformVar},${windowsOptions}),${selectedOptionVar}=${optionsLocalVar}.find(`,
  );
  const helper =
    `function chatgptLinuxAppshotHotkeyOptions(e,t,n){return typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)?e?.linuxWayland?${linuxWaylandOptions}:${linuxX11Options}:t===\`windows\`?n:${macOptions}}`;
  const sourceMapIndex = patchedSource.lastIndexOf("\n//# sourceMappingURL=");
  if (sourceMapIndex >= 0) {
    return `${patchedSource.slice(0, sourceMapIndex)};${helper}${patchedSource.slice(sourceMapIndex)}`;
  }
  return `${patchedSource}\n;${helper}`;
}

function linuxAppshotWaylandHelperSource() {
  return "function chatgptLinuxAppshotIsWayland(){return process.platform===`linux`&&((process.env.XDG_SESSION_TYPE||``).toLowerCase()===`wayland`||!!process.env.WAYLAND_DISPLAY)}";
}

function prependLinuxAppshotHelper(source, helperSource) {
  const strictDirective = source.match(/^(?:"use strict";|'use strict';)/)?.[0] ?? null;
  if (strictDirective == null) {
    return `${helperSource}${source}`;
  }
  return `${strictDirective}${helperSource}${source.slice(strictDirective.length)}`;
}

function withLinuxAppshotWaylandHelper(source) {
  if (source.includes("function chatgptLinuxAppshotIsWayland")) {
    return source;
  }
  return prependLinuxAppshotHelper(source, linuxAppshotWaylandHelperSource());
}

function appendLinuxAppshotHelper(source) {
  return `${source}
;function chatgptLinuxAppshotRequire(e){return require(e)}
function chatgptLinuxAppshotBackendPath(){let e=chatgptLinuxAppshotRequire(\`node:fs\`),t=chatgptLinuxAppshotRequire(\`node:path\`),n=chatgptLinuxAppshotRequire(\`node:os\`),r=process.env.CHATGPT_ELECTRON_RESOURCES_PATH||process.resourcesPath,i=process.env.CODEX_HOME||(process.env.HOME?t.join(process.env.HOME,\`.codex\`):t.join(n.homedir(),\`.codex\`)),a=[process.env.CHATGPT_LINUX_COMPUTER_USE_BACKEND_SOURCE,r&&t.join(r,\`plugins\`,\`openai-bundled\`,\`plugins\`,\`computer-use\`,\`bin\`,\`chatgpt-computer-use-linux\`),i&&t.join(i,\`plugins\`,\`cache\`,\`openai-bundled\`,\`computer-use\`,\`latest\`,\`bin\`,\`chatgpt-computer-use-linux\`)];for(let t of a){if(typeof t!=\`string\`||t.length===0)continue;try{if(e.existsSync(t))return t}catch{}}return null}
function chatgptLinuxAppshotBackendJson(e,t=10000){let n=chatgptLinuxAppshotBackendPath();if(n==null)return Promise.reject(Error(\`Linux Computer Use backend is not installed\`));let r=chatgptLinuxAppshotRequire(\`node:child_process\`);return new Promise((i,a)=>{r.execFile(n,e,{encoding:\`utf8\`,timeout:t,maxBuffer:67108864},(e,t,n)=>{if(e!=null){a(Error((n||e.message||\`Linux Computer Use backend failed\`).trim()));return}try{i(JSON.parse(t))}catch(e){a(Error(\`Linux Computer Use backend returned invalid JSON\`))}})})}
function chatgptLinuxAppshotFirstString(...e){for(let t of e)if(typeof t==\`string\`&&t.trim().length>0)return t.trim();return null}
function chatgptLinuxAppshotWindowForRenderer(e){if(e==null||typeof e!=\`object\`)return null;let t=chatgptLinuxAppshotFirstString(e.app_id,e.wm_class,e.title,\`Linux app\`),n=chatgptLinuxAppshotFirstString(e.app_id,e.wm_class,e.pid!=null?\`pid:\${e.pid}\`:null,e.window_id!=null?\`window:\${e.window_id}\`:null,t),r=chatgptLinuxAppshotFirstString(e.title);return{name:t,appName:t,bundleIdentifier:n,windowTitle:r,iconSmallDataURL:null,appIconDataUrl:null}}
function chatgptLinuxAppshotFocusedWindowFromReport(e){let t=Array.isArray(e?.windows)?e.windows:[],n=t.find(e=>e?.focused)||null;return{focusedWindow:n,windows:t,backend:chatgptLinuxAppshotFirstString(e?.backend)}}
async function chatgptLinuxAppshotFocusedWindow(){let e=await chatgptLinuxAppshotBackendJson([\`windows\`],5000);return chatgptLinuxAppshotFocusedWindowFromReport(e)}
async function chatgptLinuxAppshotFrontmostWindow(){if(process.platform!==\`linux\`)return null;try{let e=await chatgptLinuxAppshotFocusedWindow();return chatgptLinuxAppshotWindowForRenderer(e.focusedWindow)}catch{return null}}
function chatgptLinuxAppshotSend(e,t,n,r){try{e.sendInlineMessageForView(t,{requestId:n,type:\`computer-use-capture-updated\`,update:r})}catch{}}
function chatgptLinuxAppshotStartCapture({origin:e,requestId:t,bundleIdentifier:n,windowManager:r}){if(process.platform!==\`linux\`)return null;setTimeout(()=>{chatgptLinuxAppshotCapture({origin:e,requestId:t,bundleIdentifier:n,windowManager:r}).catch(()=>chatgptLinuxAppshotSend(r,e,t,{type:\`failed\`}))},0);return{animationDuration:0,transitionSnapshotHeight:140,transitionSpringDampingFraction:1,transitionSpringResponse:0}}
async function chatgptLinuxAppshotCapture({origin:e,requestId:t,bundleIdentifier:n,windowManager:r}){let i=await chatgptLinuxAppshotFocusedWindow(),a=chatgptLinuxAppshotWindowForRenderer(i.focusedWindow);if(a==null){chatgptLinuxAppshotSend(r,e,t,{type:\`failed\`});return}chatgptLinuxAppshotSend(r,e,t,{type:\`metadata\`,app:{bundleIdentifier:a.bundleIdentifier,name:a.name,windowTitle:a.windowTitle,iconSmallDataURL:null}});let o=await chatgptLinuxAppshotAccessibilityNodes(i.focusedWindow,n),s=chatgptLinuxAppshotAccessibilityText(i.focusedWindow,o.nodes,o.error);typeof s==\`string\`&&s.length>0&&chatgptLinuxAppshotSend(r,e,t,{type:\`axText\`,text:s});let c=await chatgptLinuxAppshotScreenshot(i.focusedWindow,i.windows);if(c==null||typeof c.dataURL!=\`string\`||c.dataURL.length===0){chatgptLinuxAppshotSend(r,e,t,{type:\`failed\`});return}chatgptLinuxAppshotSend(r,e,t,{type:\`screenshot\`,screenshotDataURL:c.dataURL});chatgptLinuxAppshotSend(r,e,t,{type:\`completed\`,transitionSnapshotDataURL:c.dataURL})}
async function chatgptLinuxAppshotAccessibilityNodes(e,t){let n=[],r=new Set,a=o=>{let s=chatgptLinuxAppshotFirstString(o);s!=null&&!r.has(s)&&(r.add(s),n.push(s))};a(t),a(e?.app_id),a(e?.wm_class),a(e?.title),a(\`electron\`);let o=null;for(let e of n){try{let t=await chatgptLinuxAppshotBackendJson([\`state\`,e],10000);if(Array.isArray(t)&&t.length>0)return{nodes:t,candidate:e,error:null}}catch(e){o=e}}return{nodes:[],candidate:null,error:o instanceof Error?o.message:String(o||\`\`)}}
function chatgptLinuxAppshotAccessibilityText(e,t,n){let r=chatgptLinuxAppshotFirstString(e?.app_id,e?.wm_class,\`Linux app\`),i=chatgptLinuxAppshotFirstString(e?.title,\`\`),a=[\`Linux AppShot accessibility snapshot\`,\`Application: \${r}\`,\`Window: "\${i}"\`,\`\`,\`Elements:\`];if(!Array.isArray(t)||t.length===0){n&&a.push(\`- error text="\${String(n).slice(0,240)}"\`);return a.join(\`\\n\`)}for(let e of t.slice(0,120))a.push(chatgptLinuxAppshotNodeLine(e));return a.join(\`\\n\`)}
function chatgptLinuxAppshotNodeLine(e){let t=Number.isFinite(e?.depth)?Math.max(0,Math.min(12,e.depth)):0,n=\`  \`.repeat(t),r=chatgptLinuxAppshotFirstString(e?.role,\`node\`),i=chatgptLinuxAppshotFirstString(e?.name),a=chatgptLinuxAppshotFirstString(e?.text),o=Array.isArray(e?.states)?e.states.filter(Boolean).slice(0,8).join(\`,\`):null,s=e?.bounds?\` bounds=\${Math.round(Number(e.bounds.width)||0)}x\${Math.round(Number(e.bounds.height)||0)}+\${Math.round(Number(e.bounds.x)||0)}+\${Math.round(Number(e.bounds.y)||0)}\`:\`\`;return\`\${n}- \${r}\${i?\` name="\${chatgptLinuxAppshotCleanText(i,120)}"\`:\`\`}\${a?\` text="\${chatgptLinuxAppshotCleanText(a,160)}"\`:\`\`}\${s}\${o?\` states=\${o}\`:\`\`}\`}
function chatgptLinuxAppshotCleanText(e,t){return String(e).replace(/[\\r\\n\\t]+/g,\` \`).replace(/"/g,\`'\`).trim().slice(0,t)}
function chatgptLinuxAppshotScreenshotCommands(e){return[{source:\`grim\`,programs:[\`grim\`,\`/usr/bin/grim\`],args:[],output:\`append\`},{source:\`spectacle\`,programs:[\`spectacle\`,\`/usr/bin/spectacle\`],args:[\`-b\`,\`-n\`],output:[\`-o\`]},{source:\`gnome-screenshot\`,programs:[\`gnome-screenshot\`,\`/usr/bin/gnome-screenshot\`],args:[],output:[\`-f\`]},{source:\`maim\`,programs:[\`maim\`,\`/usr/bin/maim\`],args:[],output:\`append\`},{source:\`scrot\`,programs:[\`scrot\`,\`/usr/bin/scrot\`],args:[],output:\`append\`},{source:\`imagemagick-import\`,programs:[\`import\`,\`/usr/bin/import\`],args:[\`-window\`,\`root\`],output:\`append\`}]}
async function chatgptLinuxAppshotScreenshot(e,t){
let n=chatgptLinuxAppshotRequire(\`node:fs\`),r=chatgptLinuxAppshotRequire(\`node:os\`),i=chatgptLinuxAppshotRequire(\`node:path\`),a=chatgptLinuxAppshotRequire(\`node:child_process\`),o=chatgptLinuxAppshotRequire(\`electron\`).nativeImage,s=chatgptLinuxAppshotCropRects(e,t);
if(s.length===0)return chatgptLinuxAppshotWarn(\`screenshot-crop-missing\`,{hasBounds:e?.bounds!=null}),null;
for(let c of chatgptLinuxAppshotScreenshotCommands(e))for(let l of c.programs){
let u=null;
try{
u=n.mkdtempSync(i.join(r.tmpdir(),\`chatgptshot-\`));try{n.chmodSync(u,448)}catch{}let d=i.join(u,\`source.png\`),f=i.join(u,\`crop.png\`),p=c.output===\`append\`?[...c.args,d]:[...c.args,...c.output,d];
await chatgptLinuxAppshotExecFile(a,l,p,{timeout:15000,maxBuffer:8388608});
if(!n.existsSync(d)){chatgptLinuxAppshotWarn(\`screenshot-output-missing\`,{source:c.source,program:l});continue}
let e=n.statSync(d);if(e.size<=0){chatgptLinuxAppshotWarn(\`screenshot-output-empty\`,{source:c.source,program:l});continue}
let t=await chatgptLinuxAppshotCropWithImageMagick({childProcess:a,fs:n,sourcePath:d,tmpPath:f,cropRects:s});
if(t!=null)return{dataURL:t.dataURL,width:t.width,height:t.height,source:\`\${c.source}:imagemagick-window-crop\`};
let h=chatgptLinuxAppshotCropNativeImage(o,d,s);
if(h!=null)return{dataURL:h.image.toDataURL(),width:h.width,height:h.height,source:\`\${c.source}:integration-window-crop\`}
}catch(e){chatgptLinuxAppshotWarn(\`screenshot-command-failed\`,{source:c.source,program:l,message:e instanceof Error?e.message:String(e),stderr:typeof e?.codexStderr===\`string\`?e.codexStderr.slice(0,200):\`\`})}
finally{if(u!=null)try{n.rmSync(u,{recursive:true,force:true})}catch{}}
}
return chatgptLinuxAppshotWarn(\`screenshot-all-commands-failed\`,{commandCount:chatgptLinuxAppshotScreenshotCommands(e).length}),null
}
function chatgptLinuxAppshotExecFile(e,t,n,r){return new Promise((i,a)=>{e.execFile(t,n,r,(e,t,n)=>{if(e!=null){e.codexStderr=String(n||\`\`);a(e);return}i({stdout:t,stderr:n})})})}
function chatgptLinuxAppshotCropNativeImage(e,t,n){let r=e.createFromPath(t),i=r.getSize();if(i.width<=0||i.height<=0)return chatgptLinuxAppshotWarn(\`screenshot-native-image-empty\`,{}),null;let a=chatgptLinuxAppshotFirstValidCrop(n,i);if(a==null)return chatgptLinuxAppshotWarn(\`screenshot-native-crop-invalid\`,{width:i.width,height:i.height,cropCount:n.length}),null;let o=r.crop(a),s=o.getSize();return s.width<=0||s.height<=0?(chatgptLinuxAppshotWarn(\`screenshot-native-crop-empty\`,a),null):{image:o,width:s.width,height:s.height}}
async function chatgptLinuxAppshotCropWithImageMagick({childProcess:e,fs:t,sourcePath:n,tmpPath:r,cropRects:i}){try{let a=await chatgptLinuxAppshotExecFirst(e,[\`identify\`,\`/usr/bin/identify\`],[\`-format\`,\`%w %h\`,n],{timeout:5000,maxBuffer:1024},\`screenshot-identify-failed\`),o=String(a.stdout||\`\`).trim().split(/\\s+/).map(Number),s={width:o[0],height:o[1]},c=chatgptLinuxAppshotFirstValidCrop(i,s);if(c==null)return chatgptLinuxAppshotWarn(\`screenshot-identify-crop-invalid\`,{width:s.width,height:s.height,cropCount:i.length}),null;await chatgptLinuxAppshotExecFirst(e,[\`convert\`,\`/usr/bin/convert\`],[n,\`-crop\`,\`\${c.width}x\${c.height}+\${c.x}+\${c.y}\`,\`+repage\`,r],{timeout:10000,maxBuffer:8388608},\`screenshot-convert-failed\`);if(!t.existsSync(r)||t.statSync(r).size<=0)return chatgptLinuxAppshotWarn(\`screenshot-convert-output-empty\`,{}),null;return{dataURL:\`data:image/png;base64,\${t.readFileSync(r).toString(\`base64\`)}\`,width:c.width,height:c.height}}catch(e){return chatgptLinuxAppshotWarn(\`screenshot-imagemagick-crop-failed\`,{message:e instanceof Error?e.message:String(e),stderr:typeof e?.codexStderr===\`string\`?e.codexStderr.slice(0,200):\`\`}),null}}
async function chatgptLinuxAppshotExecFirst(e,t,n,r,i){let a=null;for(let o of t)try{return await chatgptLinuxAppshotExecFile(e,o,n,r)}catch(e){a=e;chatgptLinuxAppshotWarn(i,{program:o,message:e instanceof Error?e.message:String(e),stderr:typeof e?.codexStderr===\`string\`?e.codexStderr.slice(0,200):\`\`})}throw a??Error(\`No command available\`)}
function chatgptLinuxAppshotWarn(e,t={}){try{console.warn(\`[linux-appshots] \${e}\`,t)}catch{}}
function chatgptLinuxAppshotCropRects(e,t){let n=e?.bounds;if(n==null)return[];let r=[n.x,n.y,n.width,n.height].map(Number);if(!r.every(Number.isFinite)||r[2]<=0||r[3]<=0)return[];let i=Math.round(r[0]),a=Math.round(r[1]),o=Math.round(r[2]),s=Math.round(r[3]),c=[{x:i,y:a,width:o,height:s}],l=Array.isArray(t)?t:[],u=l.map(e=>Number(e?.bounds?.x)).filter(Number.isFinite),d=l.map(e=>Number(e?.bounds?.y)).filter(Number.isFinite);if(u.length>0||d.length>0){let e=u.length>0?Math.min(...u):0,t=d.length>0?Math.min(...d):0;c.push({x:Math.round(i-e),y:Math.round(a-t),width:o,height:s})}return c.push({x:0,y:0,width:o,height:s}),chatgptLinuxAppshotUniqueCropRects(c)}
function chatgptLinuxAppshotUniqueCropRects(e){let t=new Set,n=[];for(let r of e){let e=\`\${r.x}:\${r.y}:\${r.width}:\${r.height}\`;t.has(e)||(t.add(e),n.push(r))}return n}
function chatgptLinuxAppshotFirstValidCrop(e,t){for(let n of e){let e=chatgptLinuxAppshotClampCrop(n,t);if(e!=null)return e}return null}
function chatgptLinuxAppshotClampCrop(e,t){if(!Number.isFinite(t?.width)||!Number.isFinite(t?.height)||t.width<=0||t.height<=0)return null;let n=Math.max(0,e.x),r=Math.max(0,e.y),i=Math.min(e.width,t.width-n),a=Math.min(e.height,t.height-r);return!Number.isFinite(i)||!Number.isFinite(a)||i<=0||a<=0?null:{x:n,y:r,width:i,height:a}}
`;
}

function replaceIdentifierCall(source, identifier, method, replacement) {
  const needle = `${identifier}.${method}(`;
  let count = 0;
  let cursor = 0;
  let output = "";

  while (cursor < source.length) {
    const matchIndex = source.indexOf(needle, cursor);
    if (matchIndex < 0) {
      output += source.slice(cursor);
      break;
    }
    const previous = matchIndex > 0 ? source[matchIndex - 1] : "";
    if (previous === "." || /[A-Za-z0-9_$]/.test(previous)) {
      const nextCursor = matchIndex + needle.length;
      output += source.slice(cursor, nextCursor);
      cursor = nextCursor;
      continue;
    }
    output += source.slice(cursor, matchIndex) + replacement;
    cursor = matchIndex + needle.length;
    count += 1;
  }

  return { source: output, count };
}

const descriptors = [
  {
    id: "linux-appshots-main-process",
    phase: "main-bundle",
    order: 142,
    apply: applyLinuxAppshotMainProcessPatch,
  },
  {
    id: "linux-appshots-availability",
    phase: "webview-asset",
    order: 1090,
    pattern: /^app-initial-[^.]+\.js$/,
    missingDescription: "AppShots availability bundle",
    skipDescription: "Linux AppShots availability patch",
    apply: applyLinuxAppshotAvailabilityPatch,
  },
  {
    id: "linux-appshots-hotkey",
    phase: "main-bundle",
    order: 143,
    apply: applyLinuxAppshotHotkeyPatch,
  },
  {
    id: "linux-appshots-settings-hotkey",
    phase: "webview-asset",
    order: 1091,
    pattern: /^appshots-settings-.*\.js$/,
    missingDescription: "AppShots settings bundle",
    skipDescription: "Linux AppShots settings hotkey patch",
    apply: applyLinuxAppshotSettingsHotkeyPatch,
  },
];

module.exports = {
  applyLinuxAppshotAvailabilityPatch,
  applyLinuxAppshotHotkeyPatch,
  applyLinuxAppshotMainProcessPatch,
  applyLinuxAppshotSettingsHotkeyPatch,
  descriptors,
};
