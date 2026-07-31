"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { linuxSettingsKeys } = require("../../scripts/patches/lib/settings-keys.js");

const HANDLER_NAME = "chatgpt-linux-wrapper-updater";
const RUNTIME_VERSION = "chatgpt-wrapper-updater-v4";
const LINUX_DESKTOP_SETTINGS_ASSET = "linux-desktop-settings-linux.js";
const WRAPPER_UPDATES_SETTING_KEY = linuxSettingsKeys.wrapperUpdates;
const FEATURE_PICKER_ON_UPDATE_SETTING_KEY = linuxSettingsKeys.integrationPickerOnUpdate;

function warn(message, patchName) {
  console.warn(`WARN: ${message} - skipping ${patchName}`);
}

function applyMainBundlePatch(source) {
  if (source.includes(`"${HANDLER_NAME}":async`)) {
    return source;
  }

  const helper = [
    `function chatgptLinuxWrapFs(){return require(\`node:fs\`)}`,
    `function chatgptLinuxWrapPath(){return require(\`node:path\`)}`,
    `function chatgptLinuxWrapChildProcess(){return require(\`node:child_process\`)}`,
    `function chatgptLinuxWrapHome(){return process.env.HOME||\`\`}`,
    `function chatgptLinuxWrapAppId(){let i=process.env.CHATGPT_LINUX_APP_ID||process.env.CHATGPT_APP_ID||\`chatgpt\`;return /^[A-Za-z0-9._-]+$/.test(i)?i:\`chatgpt\`}`,
    `function chatgptLinuxWrapAppStateDir(){let __codexWrapExplicitStateDir=process.env.CHATGPT_LINUX_APP_STATE_DIR;if(typeof __codexWrapExplicitStateDir===\`string\`&&__codexWrapExplicitStateDir.trim())return __codexWrapExplicitStateDir;let __codexWrapHome=chatgptLinuxWrapHome();let __codexWrapStateRoot=process.env.XDG_STATE_HOME||(__codexWrapHome&&chatgptLinuxWrapPath().join(__codexWrapHome,\`.local\`,\`state\`));return __codexWrapStateRoot?chatgptLinuxWrapPath().join(__codexWrapStateRoot,chatgptLinuxWrapAppId()):null}`,
    `function chatgptLinuxWrapStatePath(){let __codexWrapHome=chatgptLinuxWrapHome();let __codexWrapStateRoot=process.env.XDG_STATE_HOME||(__codexWrapHome&&chatgptLinuxWrapPath().join(__codexWrapHome,\`.local\`,\`state\`));return __codexWrapStateRoot?chatgptLinuxWrapPath().join(__codexWrapStateRoot,\`chatgpt-updater\`,\`state.json\`):null}`,
    `function chatgptLinuxWrapMarkerPath(){let __codexWrapStateDir=chatgptLinuxWrapAppStateDir();return __codexWrapStateDir?chatgptLinuxWrapPath().join(__codexWrapStateDir,\`chatgpt-wrapper-updater\`,\`pending\`):null}`,
    `function chatgptLinuxWrapReadStatus(){try{let __codexWrapStatePath=chatgptLinuxWrapStatePath();if(!__codexWrapStatePath||!chatgptLinuxWrapFs().existsSync(__codexWrapStatePath))return null;return JSON.parse(chatgptLinuxWrapFs().readFileSync(__codexWrapStatePath,\`utf8\`))}catch{return null}}`,
    `function chatgptLinuxWrapShouldShow(s){return !!(s&&typeof s===\`object\`&&s.wrapper_dev_mode!==!0&&typeof s.candidate_wrapper_commit===\`string\`&&s.candidate_wrapper_commit.length>0)}`,
    `function chatgptLinuxWrapStatusPayload(){let e=chatgptLinuxWrapWrapperUpdatesEnabled(),a=e&&chatgptLinuxWrapManagerAvailable(),s=a?chatgptLinuxWrapReadStatus():null;return{ok:!0,enabled:e,available:a,show:e&&a&&chatgptLinuxWrapShouldShow(s),dev_mode:!!(s&&s.wrapper_dev_mode===!0),changelog:s?s.wrapper_changelog||\`\`:\`\`,commit:s?s.candidate_wrapper_commit||\`\`:\`\`,installed_commit:s?s.installed_wrapper_commit||\`\`:\`\`}}`,
    `function chatgptLinuxWrapManagerPath(){for(let e of [process.env.CHATGPT_UPDATER_PATH])if(typeof e===\`string\`&&e.trim().length>0)return e;return\`chatgpt-updater\`}`,
    `function chatgptLinuxWrapPackageHasUpdater(){let v=process.env.CHATGPT_PACKAGE_HAS_UPDATER;if(v==null||String(v).trim()===\`\`){let a=process.env.APPIMAGE;return!(a&&String(a).trim())}return!([\`0\`,\`false\`,\`no\`,\`off\`].includes(String(v).trim().toLowerCase()))}`,
    `function chatgptLinuxWrapIsExecutable(p){try{chatgptLinuxWrapFs().accessSync(p,chatgptLinuxWrapFs().constants.X_OK);return!0}catch{return!1}}`,
    `function chatgptLinuxWrapFindOnPath(c){let p=process.env.PATH||\`\`;for(let d of p.split(\`:\`)){if(!d)continue;let f=chatgptLinuxWrapPath().join(d,c);if(chatgptLinuxWrapIsExecutable(f))return f}return null}`,
    `function chatgptLinuxWrapManagerAvailable(){if(!chatgptLinuxWrapPackageHasUpdater())return!1;let m=chatgptLinuxWrapManagerPath();if(!m)return!1;if(m.includes(\`/\`))return chatgptLinuxWrapIsExecutable(m);return chatgptLinuxWrapFindOnPath(m)!=null}`,
    `function chatgptLinuxWrapSpawnCheck(){if(!chatgptLinuxWrapWrapperUpdatesEnabled()||!chatgptLinuxWrapManagerAvailable())return;try{let __codexWrapCheckProcess=chatgptLinuxWrapChildProcess().spawn(chatgptLinuxWrapManagerPath(),[\`check-wrapper\`],{stdio:\`ignore\`,detached:!0,env:process.env});__codexWrapCheckProcess.on(\`error\`,()=>{});__codexWrapCheckProcess.unref()}catch{}}`,
    // Integration picker on update: resolve settings.json the same way the launcher
    // and launch-actions do, and gate the on-click picker on the
    // `chatgpt-linux-integration-picker-on-update` toggle (absent ⇒ ask) plus a live
    // display. The picker runs synchronously here, at click time, because the
    // detached apply runs after the app exits with no display.
    `function chatgptLinuxWrapSettingsAppId(){let e=process.env.CHATGPT_LINUX_APP_ID||process.env.CHATGPT_APP_ID||\`chatgpt\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`chatgpt\`}`,
    `function chatgptLinuxWrapSettingsPath(){let __codexWrapSettingsFile=process.env.CHATGPT_LINUX_SETTINGS_FILE;if(typeof __codexWrapSettingsFile===\`string\`&&__codexWrapSettingsFile.length>0)return __codexWrapSettingsFile;let __codexWrapHome=chatgptLinuxWrapHome();let __codexWrapConfigRoot=process.env.XDG_CONFIG_HOME||(__codexWrapHome&&chatgptLinuxWrapPath().join(__codexWrapHome,\`.config\`));return __codexWrapConfigRoot?chatgptLinuxWrapPath().join(__codexWrapConfigRoot,chatgptLinuxWrapSettingsAppId(),\`settings.json\`):null}`,
    `function chatgptLinuxWrapBooleanSetting(k,d){try{let p=chatgptLinuxWrapSettingsPath();if(!p||!chatgptLinuxWrapFs().existsSync(p))return d;let s=JSON.parse(chatgptLinuxWrapFs().readFileSync(p,\`utf8\`));if(!s||typeof s!==\`object\`)return d;let v=s[k];if(v==null)return d;if(typeof v===\`boolean\`)return v;if(typeof v===\`number\`)return v!==0;if(typeof v===\`string\`){let n=v.trim().toLowerCase();return!([\`0\`,\`false\`,\`no\`,\`off\`].includes(n))}return d}catch{return d}}`,
    `function chatgptLinuxWrapWrapperUpdatesEnabled(){return chatgptLinuxWrapBooleanSetting(\`chatgpt-linux-wrapper-updates-enabled\`,!1)}`,
    `function chatgptLinuxWrapPickerEnabled(){try{let __codexWrapSettingsPath=chatgptLinuxWrapSettingsPath();if(!__codexWrapSettingsPath||!chatgptLinuxWrapFs().existsSync(__codexWrapSettingsPath))return!0;let s=JSON.parse(chatgptLinuxWrapFs().readFileSync(__codexWrapSettingsPath,\`utf8\`));if(!s||typeof s!==\`object\`)return!0;let v=s[\`chatgpt-linux-integration-picker-on-update\`];if(v==null)return!0;if(typeof v===\`boolean\`)return v;if(typeof v===\`number\`)return v!==0;if(typeof v===\`string\`){let n=v.trim().toLowerCase();return!([\`0\`,\`false\`,\`no\`,\`off\`].includes(n))}return!0}catch{return!0}}`,
    `function chatgptLinuxWrapHasDisplay(){let d=process.env.DISPLAY,w=process.env.WAYLAND_DISPLAY;return!!((d&&d.trim())||(w&&w.trim()))}`,
    `function chatgptLinuxWrapRunPicker(){if(!chatgptLinuxWrapManagerAvailable())return;try{chatgptLinuxWrapChildProcess().spawnSync(chatgptLinuxWrapManagerPath(),[\`pick-integrations\`,\`--json\`],{stdio:\`ignore\`,env:process.env})}catch{}}`,
    `function chatgptLinuxWrapWriteMarker(){let __codexWrapMarkerPath=chatgptLinuxWrapMarkerPath();if(!__codexWrapMarkerPath)return{ok:!1,reason:\`no-marker-path\`};try{chatgptLinuxWrapFs().mkdirSync(chatgptLinuxWrapPath().dirname(__codexWrapMarkerPath),{recursive:!0});chatgptLinuxWrapFs().writeFileSync(__codexWrapMarkerPath,new Date().toISOString());return{ok:!0,path:__codexWrapMarkerPath}}catch(e){return{ok:!1,error:String(e?.message||e)}}}`,
    `function chatgptLinuxWrapInstallNow(){if(!chatgptLinuxWrapWrapperUpdatesEnabled())return{ok:!1,reason:\`wrapper-updates-disabled\`};if(!chatgptLinuxWrapManagerAvailable())return{ok:!1,reason:\`updater-unavailable\`};if(chatgptLinuxWrapHasDisplay()&&chatgptLinuxWrapPickerEnabled())chatgptLinuxWrapRunPicker();let __codexWrapMarker=chatgptLinuxWrapWriteMarker();if(!__codexWrapMarker.ok)return __codexWrapMarker;try{let __codexWrapElectronApp=require(\`electron\`).app;setTimeout(()=>__codexWrapElectronApp.exit(0),120);return{ok:!0,path:__codexWrapMarker.path}}catch(e){return{ok:!1,error:String(e?.message||e)}}}`,
    `function chatgptLinuxWrapHandle(e={}){let action=e&&e.action;if(action===\`status\`)return chatgptLinuxWrapStatusPayload();if(action===\`check\`){chatgptLinuxWrapSpawnCheck();return{ok:!0}}if(action===\`install\`)return chatgptLinuxWrapInstallNow();return{ok:!1,reason:\`unknown-action\`}}`,
    `(()=>{if(process.env.CHATGPT_LINUX_MULTI_LAUNCH!==\`1\`)chatgptLinuxWrapSpawnCheck()})();`,
  ].join("");

  const handler = `"${HANDLER_NAME}":async(e)=>chatgptLinuxWrapHandle(e),`;
  const needle = `"native-desktop-apps":`;
  const handlerIndex = source.indexOf(needle);
  if (handlerIndex === -1) {
    warn(`Could not find ${needle} handler map needle`, "chatgpt wrapper updater main-bundle patch");
    return source;
  }

  const withHandler = source.slice(0, handlerIndex) + handler + source.slice(handlerIndex);
  const useStrictDouble = `"use strict";`;
  const useStrictSingle = `'use strict';`;
  const helperInsertAt = withHandler.startsWith(useStrictDouble)
    ? useStrictDouble.length
    : withHandler.startsWith(useStrictSingle)
      ? useStrictSingle.length
      : 0;
  return withHandler.slice(0, helperInsertAt) + helper + withHandler.slice(helperInsertAt);
}

function wrapperRuntimeSource() {
  return [
    `;(()=>{`,
    `const VERSION=${JSON.stringify(RUNTIME_VERSION)};`,
    `if(globalThis.chatgptLinuxWrapperUpdaterVersion===VERSION)return;`,
    `globalThis.chatgptLinuxWrapperUpdaterVersion=VERSION;`,
    `const METHOD=${JSON.stringify(HANDLER_NAME)};`,
    `let seq=0,pending=new Map,button=null,shaChip=null,busy=false;`,
    `function onMessage(e){let t=e?.data;if(!t||typeof t!=="object"||t.type!=="fetch-response")return;let n=pending.get(t.requestId);if(!n)return;pending.delete(t.requestId);if(t.responseType==="success"){let v=null;try{v=t.bodyJsonString?JSON.parse(t.bodyJsonString):null}catch{}n.resolve({status:t.status,body:v})}else n.reject(Error(t.error||"fetch failed"))}`,
    `window.addEventListener("message",onMessage);`,
    `function dispatch(payload){let bridge=window.electronBridge,ev=new CustomEvent("codex-message-from-view",{detail:payload});if(bridge?.sendMessageFromView){ev.__codexForwardedViaBridge=!0;bridge.sendMessageFromView(payload).catch(()=>{})}window.dispatchEvent(ev)}`,
    `function post(params,timeoutMs=4000){let requestId="chatgpt-linux-wrapper-updater-"+ ++seq;let payload={type:"fetch",hostId:"local",requestId,method:"POST",url:"vscode://codex/"+METHOD,body:JSON.stringify(params??{})};return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});setTimeout(()=>{pending.delete(requestId);reject(Error("timeout"))},timeoutMs);dispatch(payload)})}`,
    `function installStyle(){if(document.getElementById("chatgpt-linux-wrapper-update-style"))return;let s=document.createElement("style");s.id="chatgpt-linux-wrapper-update-style";s.textContent=".chatgpt-linux-wrapper-update-btn{height:22px;padding:0 10px;margin:0 8px;display:none;align-items:center;gap:5px;font:500 12px/1 -apple-system,BlinkMacSystemFont,\\"Segoe UI\\",Roboto,sans-serif;color:#fff;background:#3a7d44;border:1px solid #4a9d54;border-radius:4px;cursor:pointer;pointer-events:auto;-webkit-app-region:no-drag;box-shadow:0 1px 2px rgba(0,0,0,0.18);transition:background-color 120ms ease;vertical-align:middle;line-height:1}.chatgpt-linux-wrapper-update-btn[data-state=\\"available\\"],.chatgpt-linux-wrapper-update-btn[data-state=\\"dev-mode\\"]{display:inline-flex}.chatgpt-linux-wrapper-update-btn[data-state=\\"dev-mode\\"]{background:#6b5300;border-color:#a07c00;color:#ffe9a8;cursor:default}.chatgpt-linux-wrapper-update-btn[data-state=\\"dev-mode\\"]:hover{background:#6b5300}.chatgpt-linux-wrapper-update-btn.chatgpt-linux-wrapper-update-floating{position:fixed;top:6px;right:210px;z-index:2147483000}.chatgpt-linux-wrapper-update-btn:hover{background:#4a9d54}.chatgpt-linux-wrapper-update-btn:disabled{opacity:.85;cursor:default}.chatgpt-linux-wrapper-sha{height:22px;padding:0 7px;margin:0 4px;display:none;align-items:center;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#9aa0a6;background:rgba(120,120,120,.16);border:1px solid rgba(120,120,120,.28);border-radius:4px;pointer-events:auto;-webkit-app-region:no-drag;vertical-align:middle}.chatgpt-linux-wrapper-sha.chatgpt-linux-wrapper-sha-on{display:inline-flex}.chatgpt-linux-wrapper-sha.chatgpt-linux-wrapper-sha-floating{position:fixed;top:6px;right:290px;z-index:2147483000}.chatgpt-linux-wrapper-sha::before{content:\\"sha \\";opacity:.7;margin-right:3px}";document.head.appendChild(s)}`,
    `function findHeaderTarget(){const candidates=["header","[role=\\"banner\\"]","nav[aria-label]"];for(const sel of candidates){const el=document.querySelector(sel);if(el&&el.getBoundingClientRect().top<120&&el.offsetHeight>0)return el}return null}`,
    `function placeShaChip(){if(!shaChip||!button||!button.parentElement)return;if(button.classList.contains("chatgpt-linux-wrapper-update-floating")){shaChip.classList.add("chatgpt-linux-wrapper-sha-floating")}else{shaChip.classList.remove("chatgpt-linux-wrapper-sha-floating")}if(shaChip.parentElement!==button.parentElement||shaChip.nextSibling!==button){button.parentElement.insertBefore(shaChip,button)}}`,
    `function attachButton(b){if(b.parentElement){placeShaChip();return}let host=findHeaderTarget();if(host){b.classList.remove("chatgpt-linux-wrapper-update-floating");host.appendChild(b)}else{b.classList.add("chatgpt-linux-wrapper-update-floating");(document.body||document.documentElement).appendChild(b)}placeShaChip()}`,
    `function ensureButton(){if(button&&document.contains(button))return button;installStyle();let b=document.createElement("button");b.type="button";b.className="chatgpt-linux-wrapper-update-btn";b.setAttribute("aria-label","Update ChatGPT");b.title="A newer ChatGPT build is available";b.innerHTML='<span class="cdx-wrap-glyph">\\u2193</span><span class="cdx-wrap-label">Update</span>';b.addEventListener("click",onClick);button=b;attachButton(b);return b}`,
    `function ensureShaChip(commit){installStyle();if(!shaChip||!document.contains(shaChip)){let c=document.createElement("span");c.className="chatgpt-linux-wrapper-sha";c.setAttribute("aria-label","Installed ChatGPT build");shaChip=c}let sha=(typeof commit==="string"?commit:"").trim();if(sha.length>0){shaChip.textContent=sha.slice(0,7);shaChip.title="Installed build "+sha.slice(0,12);shaChip.classList.add("chatgpt-linux-wrapper-sha-on")}else{shaChip.textContent="";shaChip.classList.remove("chatgpt-linux-wrapper-sha-on")}placeShaChip();return shaChip}`,
    `let observer=null;function watchForHeader(){if(observer)return;observer=new MutationObserver(()=>{if(!button)return;if(button.classList.contains("chatgpt-linux-wrapper-update-floating")){let host=findHeaderTarget();if(host){button.classList.remove("chatgpt-linux-wrapper-update-floating");host.appendChild(button)}}else if(!button.parentElement||!document.contains(button.parentElement)){attachButton(button)}placeShaChip()});observer.observe(document.body||document.documentElement,{childList:!0,subtree:!0})}`,
    `function setBtn(b,glyph,label){b.innerHTML='<span class="cdx-wrap-glyph">'+glyph+'</span><span class="cdx-wrap-label">'+label+'</span>'}`,
    `function setState(payload){let b=ensureButton();ensureShaChip(payload&&payload.installed_commit);if(payload&&payload.dev_mode===true){b.dataset.state="dev-mode";setBtn(b,"\\u2699","dev mode");b.disabled=true;b.title="Local build ahead of upstream; updates disabled to avoid downgrade";return}if(payload&&payload.show){b.dataset.state="available";setBtn(b,"\\u2193","Update");b.disabled=false;let cl=(payload.changelog||"").trim();b.title=cl?("What's new:\\n"+cl.split("\\n").slice(0,12).join("\\n")):"A newer ChatGPT build is available";return}b.dataset.state="hidden";b.disabled=false}`,
    `async function onClick(){if(busy||button&&button.dataset.state==="dev-mode")return;busy=true;let b=ensureButton();b.disabled=true;setBtn(b,"\\u21bb","Restarting\\u2026");try{let r=await post({action:"install"});if(r&&r.body&&r.body.ok===false){setBtn(b,"\\u2193","Update");b.title=r.body.error||r.body.reason||"Update failed";setTimeout(()=>{b.title="A newer ChatGPT build is available"},2400)}}catch{setBtn(b,"\\u2193","Update")}finally{busy=false;b.disabled=false}}`,
    `async function refresh(){try{let r=await post({action:"status"},2500);setState(r?.body||null)}catch{}}`,
    `function start(){if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start,{once:!0});return}ensureButton();watchForHeader();post({action:"check"}).catch(()=>{});refresh();[2000,5000,9000,15000,22000].forEach(t=>setTimeout(refresh,t));setInterval(()=>{post({action:"check"}).catch(()=>{});setTimeout(refresh,4000)},30000)}`,
    `start();`,
    `})();`,
  ].join("");
}

function applyWebviewRuntimePatch(source) {
  if (source.includes(`chatgptLinuxWrapperUpdaterVersion=`)) {
    return source;
  }
  return source.endsWith("\n") ? source + wrapperRuntimeSource() : `${source}\n${wrapperRuntimeSource()}`;
}

function applyWrapperUpdateSettingsPatch(source) {
  let next = source;
  if (!next.includes("wrapperUpdates:")) {
    const keyNeedle = `autoUpdateOnExit:"chatgpt-linux-auto-update-on-exit"`;
    if (!next.includes(keyNeedle)) {
      throw new Error("could not find Linux update settings keys");
    }
    next = next.replace(
      keyNeedle,
      `${keyNeedle},wrapperUpdates:${JSON.stringify(WRAPPER_UPDATES_SETTING_KEY)}`,
    );
  }
  if (!next.includes("integrationPickerOnUpdate:")) {
    const wrapperKey = `wrapperUpdates:${JSON.stringify(WRAPPER_UPDATES_SETTING_KEY)}`;
    if (!next.includes(wrapperKey)) {
      throw new Error("could not find wrapper update settings key");
    }
    next = next.replace(
      wrapperKey,
      `${wrapperKey},integrationPickerOnUpdate:${JSON.stringify(FEATURE_PICKER_ON_UPDATE_SETTING_KEY)}`,
    );
  }

  if (!next.includes("Check for ChatGPT updates")) {
    const toggleNeedle =
      `children:$.jsx(LinuxToggle,{settingKey:KEYS.autoUpdateOnExit,label:"Install updates when you close ChatGPT",description:"When on, a ready update waits for ChatGPT to close and then installs. When off, updates wait until you click Update."})`;
    if (!next.includes(toggleNeedle)) {
      throw new Error("could not find Linux update toggle");
    }
    const pickerToggle =
      `$.jsx(LinuxToggle,{settingKey:KEYS.integrationPickerOnUpdate,label:"Ask which integrations to enable on update",description:"When on, clicking Update opens a checklist to pick optional port integrations before rebuilding. Turn off to keep your current integration selection without prompting.",defaultValue:!0},"integrationPickerOnUpdate")`;
    const wrapperToggle =
      `children:[$.jsx(LinuxToggle,{settingKey:KEYS.autoUpdateOnExit,label:"Install updates when you close ChatGPT",description:"When on, a ready update waits for ChatGPT to close and then installs. When off, updates wait until you click Update."},"autoUpdateOnExit"),$.jsx(LinuxToggle,{settingKey:KEYS.wrapperUpdates,label:"Check for ChatGPT updates",description:"Check for Linux wrapper updates from chatgpt in addition to upstream ChatGPT app updates.",defaultValue:!1},"wrapperUpdates"),${pickerToggle}]`;
    next = next.replace(toggleNeedle, wrapperToggle);
  } else if (!next.includes("Ask which integrations to enable on update")) {
    const existingWrapperToggle =
      `$.jsx(LinuxToggle,{settingKey:KEYS.wrapperUpdates,label:"Check for ChatGPT updates",description:"Check for Linux wrapper updates from chatgpt in addition to upstream ChatGPT app updates.",defaultValue:!1},"wrapperUpdates")`;
    if (!next.includes(existingWrapperToggle)) {
      throw new Error("could not find wrapper update toggle");
    }
    const pickerToggle =
      `$.jsx(LinuxToggle,{settingKey:KEYS.integrationPickerOnUpdate,label:"Ask which integrations to enable on update",description:"When on, clicking Update opens a checklist to pick optional port integrations before rebuilding. Turn off to keep your current integration selection without prompting.",defaultValue:!0},"integrationPickerOnUpdate")`;
    next = next.replace(existingWrapperToggle, `${existingWrapperToggle},${pickerToggle}`);
  }

  return next;
}

function patchWrapperUpdateSettingsAssets(extractedDir) {
  try {
    const assetsDir = path.join(extractedDir, "webview", "assets");
    if (!fs.existsSync(assetsDir)) {
      return { matched: false, changed: 0, reason: `missing webview assets directory ${assetsDir}` };
    }

    const settingsPath = path.join(assetsDir, LINUX_DESKTOP_SETTINGS_ASSET);
    if (!fs.existsSync(settingsPath)) {
      return { matched: false, changed: 0, reason: `${LINUX_DESKTOP_SETTINGS_ASSET} is not present` };
    }

    const current = fs.readFileSync(settingsPath, "utf8");
    const patched = applyWrapperUpdateSettingsPatch(current);
    if (patched === current) {
      return { matched: true, changed: 0 };
    }
    fs.writeFileSync(settingsPath, patched, "utf8");
    return { matched: true, changed: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`WARN: Wrapper update settings patch skipped: ${message}`);
    return { matched: false, changed: 0, reason: message };
  }
}

module.exports = {
  HANDLER_NAME,
  RUNTIME_VERSION,
  FEATURE_PICKER_ON_UPDATE_SETTING_KEY,
  WRAPPER_UPDATES_SETTING_KEY,
  applyMainBundlePatch,
  applyWebviewRuntimePatch,
  applyWrapperUpdateSettingsPatch,
  patchWrapperUpdateSettingsAssets,
  descriptors: [
    {
      id: "main-handler",
      phase: "main-bundle",
      order: 20_920,
      ciPolicy: "optional",
      apply: applyMainBundlePatch,
    },
    {
      id: "webview-runtime",
      phase: "webview-asset",
      order: 20_921,
      ciPolicy: "optional",
      pattern: /^index-.*\.js$/,
      missingDescription: "webview index bundle",
      skipDescription: "chatgpt wrapper updater webview runtime patch",
      apply: applyWebviewRuntimePatch,
    },
    {
      id: "settings-toggle",
      phase: "extracted-app:post-webview",
      order: 20_922,
      ciPolicy: "optional",
      apply: (extractedDir) => patchWrapperUpdateSettingsAssets(extractedDir),
      status: (result, warnings) => {
        if (result?.matched === false) {
          return { status: "skipped-optional", reason: result.reason ?? warnings[0] ?? null };
        }
        return (result?.changed ?? 0) > 0 ? "applied" : "already-applied";
      },
    },
  ],
};
