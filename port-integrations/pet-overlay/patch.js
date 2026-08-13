"use strict";

const VALID_GRAVITIES = new Set(["bottom-right", "bottom-left", "top-right", "top-left"]);
const DESCRIPTOR_ID = "pet-overlay-main";
const AVATAR_SELECTION_REFRESH_MARKER = "chatgptPetOverlayRefreshAvatarWindows";

function findMatchingBrace(source, openIndex) {
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

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function integerSetting(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function booleanSetting(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function mergedPetOverlaySettings(context = {}) {
  const defaults = context.integration?.manifest?.petOverlay ?? {};
  const settingsRoot = context.integration?.settings ?? {};
  const overrides = settingsRoot.petOverlay ?? settingsRoot;
  const defaultGravity = VALID_GRAVITIES.has(defaults.gravity) ? defaults.gravity : "bottom-right";
  const gravity = VALID_GRAVITIES.has(overrides.gravity) ? overrides.gravity : defaultGravity;
  const defaultMode = defaults.mode === "passive" ? "passive" : "interactive";
  const mode = overrides.mode === "passive" || overrides.mode === "interactive"
    ? overrides.mode
    : defaultMode;

  return {
    allWorkspaces: booleanSetting(overrides.allWorkspaces, booleanSetting(defaults.allWorkspaces, true)),
    alwaysOnTop: booleanSetting(overrides.alwaysOnTop, booleanSetting(defaults.alwaysOnTop, true)),
    gravity,
    hyprland: booleanSetting(overrides.hyprland, booleanSetting(defaults.hyprland, true)),
    kwin: booleanSetting(overrides.kwin, booleanSetting(defaults.kwin, true)),
    lockPosition: booleanSetting(overrides.lockPosition, booleanSetting(defaults.lockPosition, false)),
    margin: integerSetting(overrides.margin ?? defaults.margin, 24, 0, 512),
    mode,
    niri: booleanSetting(overrides.niri, booleanSetting(defaults.niri, true)),
    skipTaskbar: booleanSetting(overrides.skipTaskbar, booleanSetting(defaults.skipTaskbar, true)),
  };
}

function boolLiteral(value) {
  return value ? "!0" : "!1";
}

function avatarOverlayRegionStart(source) {
  const routeIndex = source.indexOf("`/avatar-overlay`");
  if (routeIndex !== -1) {
    return routeIndex;
  }
  const stateIndex = source.indexOf("avatar-overlay-open-state-changed");
  return stateIndex === -1 ? 0 : stateIndex;
}

function findAvatarOverlayClass(source) {
  const classRegex = /class(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[A-Za-z_$][\w$.]*)?\{/g;
  classRegex.lastIndex = avatarOverlayRegionStart(source);

  let match;
  while ((match = classRegex.exec(source)) != null) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex === -1) {
      classRegex.lastIndex = openIndex + 1;
      continue;
    }
    const text = source.slice(match.index, closeIndex + 1);
    if (text.includes("appearance:`avatarOverlay`") || text.includes("avatar-overlay-open-state-changed")) {
      return { start: match.index, end: closeIndex + 1, text };
    }
    classRegex.lastIndex = closeIndex + 1;
  }
  return null;
}

function findMethodAfter(source, signatureRegex, startIndex, endIndex) {
  const match = source.slice(startIndex, endIndex).match(signatureRegex);
  if (match == null) {
    return null;
  }
  const absoluteIndex = startIndex + match.index;
  const openIndex = absoluteIndex + match[0].length - 1;
  const closeIndex = findMatchingBrace(source, openIndex);
  if (closeIndex === -1 || closeIndex + 1 > endIndex) {
    return null;
  }
  return {
    match,
    start: absoluteIndex,
    end: closeIndex + 1,
    text: source.slice(absoluteIndex, closeIndex + 1),
  };
}

function findAvatarOverlayMethod(source, signatureRegex) {
  const overlayClass = findAvatarOverlayClass(source);
  if (overlayClass == null) {
    return null;
  }
  return findMethodAfter(source, signatureRegex, overlayClass.start, overlayClass.end);
}

function replaceMethodText(source, method, replacement) {
  if (method == null || method.text === replacement) {
    return source;
  }
  return source.slice(0, method.start) + replacement + source.slice(method.end);
}

function firstMethodArgument(methodText, methodName, index) {
  const match = methodText.match(new RegExp(`${methodName}\\((.*)\\)\\{`));
  const rawArg = match?.[1]?.split(",")?.[index]?.trim() ?? "";
  return rawArg.match(/^([A-Za-z_$][\w$]*)/)?.[1] ?? null;
}

function buildPetOverlayMethods(settings) {
  return [
    `chatgptPetOverlaySettings(){let e={margin:${settings.margin},gravity:\`${settings.gravity}\`,allWorkspaces:${boolLiteral(settings.allWorkspaces)},alwaysOnTop:${boolLiteral(settings.alwaysOnTop)},skipTaskbar:${boolLiteral(settings.skipTaskbar)},lockPosition:${boolLiteral(settings.lockPosition)},mode:\`${settings.mode}\`,hyprland:${boolLiteral(settings.hyprland)},kwin:${boolLiteral(settings.kwin)},niri:${boolLiteral(settings.niri)}};try{let t=process.env.CHATGPT_PET_OVERLAY_MARGIN??process.env.CHATGPT_PET_LINUX_MARGIN,n=Number(t);Number.isFinite(n)&&(e.margin=Math.max(0,Math.min(512,Math.round(n))));let r=process.env.CHATGPT_PET_OVERLAY_GRAVITY??process.env.CHATGPT_PET_LINUX_GRAVITY;[\`bottom-right\`,\`bottom-left\`,\`top-right\`,\`top-left\`].includes(r)&&(e.gravity=r);let i=process.env.CHATGPT_PET_OVERLAY_MODE??process.env.CHATGPT_PET_LINUX_MODE;(i===\`interactive\`||i===\`passive\`)&&(e.mode=i);let a=process.env.CHATGPT_PET_OVERLAY_LOCK_POSITION??process.env.CHATGPT_PET_LINUX_LOCK_POSITION;a===\`1\`&&(e.lockPosition=!0),a===\`0\`&&(e.lockPosition=!1);let o=process.env.CHATGPT_PET_OVERLAY_HYPRLAND??process.env.CHATGPT_PET_LINUX_HYPRLAND;o===\`1\`&&(e.hyprland=!0),o===\`0\`&&(e.hyprland=!1);let s=process.env.CHATGPT_PET_OVERLAY_KWIN;s===\`1\`&&(e.kwin=!0),s===\`0\`&&(e.kwin=!1);let c=process.env.CHATGPT_PET_OVERLAY_NIRI;c===\`1\`&&(e.niri=!0),c===\`0\`&&(e.niri=!1)}catch{}return e}`,
    "chatgptPetOverlayRect(e){if(e==null)return null;let t=Number(e.x),n=Number(e.y),r=Number(e.width),i=Number(e.height);return[t,n,r,i].every(Number.isFinite)&&r>0&&i>0?{x:t,y:n,width:r,height:i}:null}",
    "chatgptPetOverlayDisplayRect(e){return this.chatgptPetOverlayRect(e?.workArea??e?.bounds??e)}",
    "chatgptPetOverlayWindowBounds(e){try{return this.chatgptPetOverlayRect(e?.getBounds?.()??e?.getContentBounds?.())}catch{return null}}",
    "chatgptPetOverlayMoved(e,t,n=8){return e!=null&&t!=null&&(Math.abs(Number(e.x)-Number(t.x))>n||Math.abs(Number(e.y)-Number(t.y))>n)}",
    "chatgptPetOverlayBoundsNearDisplay(e,t,n=64){if(e==null||t==null)return!1;let r=Number(e.x)+Number(e.width)/2,i=Number(e.y)+Number(e.height)/2,a=Number(t.x),o=Number(t.y),s=Number(t.width),c=Number(t.height);return[r,i,a,o,s,c].every(Number.isFinite)&&r>=a-n&&r<=a+s+n&&i>=o-n&&i<=o+c+n}",
    "chatgptPetOverlayMascotRect(e){let t=e?.mascot;if(t==null)return null;let n=Number(t.left),r=Number(t.top),i=Number(t.width),a=Number(t.height);return[n,r,i,a].every(Number.isFinite)&&i>0&&a>0?{left:n,top:r,width:i,height:a}:null}",
    "chatgptPetOverlayLayoutAtWindowPosition(e,t){if(e==null||t==null||t.windowBounds==null)return t;let n={...t.windowBounds,x:Math.round(e.x),y:Math.round(e.y)},r=this.chatgptPetOverlayMascotRect(t),i=r==null?{x:n.x,y:n.y,width:t.anchor?.width??n.width,height:t.anchor?.height??n.height}:{x:n.x+r.left,y:n.y+r.top,width:r.width,height:r.height},a=t.anchor==null?t.anchor:{...t.anchor,x:Math.round(i.x),y:Math.round(i.y),width:t.anchor.width??i.width,height:t.anchor.height??i.height};return{...t,anchor:a,windowBounds:n}}",
    "chatgptPetOverlayGravityBounds(e,t,n){if(e==null||t==null||t.windowBounds==null)return null;let r={...t.windowBounds},i=this.chatgptPetOverlayMascotRect(t)??{left:0,top:0,width:Number(r.width),height:Number(r.height)},a=Number(i.left),o=Number(i.top),s=Number(i.width),c=Number(i.height);if(![a,o,s,c].every(Number.isFinite)||s<=0||c<=0)return null;let l=Math.max(0,Math.min(512,Number(n?.margin)||0)),u=String(n?.gravity??`bottom-right`);return r.x=u.endsWith(`left`)?Math.round(e.x+l-a):Math.round(e.x+e.width-l-a-s),r.y=u.startsWith(`top`)?Math.round(e.y+l-o):Math.round(e.y+e.height-l-o-c),r}",
    "chatgptPetOverlayTrayAboveLeft(e){if(process.platform!==`linux`||e==null||e.windowBounds==null||e.mascot==null||e.tray==null)return e;let t=Number(e.windowBounds.width),n=Number(e.windowBounds.height),r=Number(e.mascot.width),i=Number(e.mascot.height),a=Number(e.tray.width),o=Number(e.tray.height);if(![t,n,r,i,a,o].every(Number.isFinite)||t<=0||n<=0||r<=0||i<=0||a<=0||o<=0)return e;let s=4,c=Math.max(0,Math.min(Math.round(t),Math.round(a))),l=Math.max(0,Math.min(Math.max(0,Math.round(n-i-s)),Math.round(o))),u=this.chatgptPetOverlayMascotLocalPosition,d=Number(u?.left),p=Number(u?.top),h=[d,p].every(Number.isFinite),m=Math.max(0,Math.min(Math.round(t-r),Math.round(h?d:t-r))),f=Math.max(0,Math.min(Math.round(n-i),Math.round(h?p:n-i))),g=Math.max(0,Math.round(n-i-s-l)),v=Math.max(0,Math.min(Math.round(n-i),Math.round(l+s)));if(g<v&&f>g&&f<v){f=Math.abs(f-g)<=Math.abs(v-f)?g:v,h&&(this.chatgptPetOverlayMascotLocalPosition={left:m,top:f})}let w=Math.max(0,Math.min(Math.round(t-c),Math.round(m+r-c))),x=f>=l+s?f-l-s:f+i+s;x=Math.max(0,Math.min(Math.round(n-l),Math.round(x)));let y=e.anchor??{x:Number(e.windowBounds.x)+(Number(e.mascot.left)||0),y:Number(e.windowBounds.y)+(Number(e.mascot.top)||0),width:r,height:i},b=h?{...e.windowBounds}:{...e.windowBounds,x:Math.round(Number(y.x)-m),y:Math.round(Number(y.y)-f)},k={...y,x:Math.round(Number(b.x)+m),y:Math.round(Number(b.y)+f),width:y.width??r,height:y.height??i};return{...e,anchor:k,mascot:{...e.mascot,left:m,top:f,width:r,height:i},tray:{...e.tray,left:w,top:x,width:c,height:l},placement:`top-end`,windowBounds:b}}",
    "chatgptPetOverlayDragFromCurrentRenderer(e){let t=this.window;return!(t==null||t.isDestroyed?.()||t.webContents?.id!==e)}",
    "chatgptPetOverlayStartLocalMascotDrag(e,t){if(!this.chatgptPetOverlayDragFromCurrentRenderer(e)||process.platform!==`linux`||this.chatgptPetOverlayShouldLockPosition())return!1;let n=this.layout,r=this.chatgptPetOverlayMascotRect(n),i=Number(t?.pointerWindowX),a=Number(t?.pointerWindowY);if(r==null||![i,a].every(Number.isFinite)||i<r.left||a<r.top||i>r.left+r.width||a>r.top+r.height)return!1;return this.chatgptPetOverlayMascotDragState={offsetX:i-r.left,offsetY:a-r.top},!0}",
    "chatgptPetOverlayMoveLocalMascotDrag(e,t){if(!this.chatgptPetOverlayDragFromCurrentRenderer(e))return!1;let n=this.chatgptPetOverlayMascotDragState,r=this.layout,i=this.window,a=this.chatgptPetOverlayMascotRect(r),o=this.chatgptPetOverlayWindowBounds(i);if(n==null||r==null||a==null||o==null)return!1;let s=Number(t?.pointerWindowX),c=Number(t?.pointerWindowY);if(![s,c].every(Number.isFinite)){let e=Number(t?.pointerScreenX),r=Number(t?.pointerScreenY);if(![e,r].every(Number.isFinite))return!0;s=e-o.x,c=r-o.y}let l=Math.max(0,Math.min(Math.round(o.width-a.width),Math.round(s-n.offsetX))),u=Math.max(0,Math.min(Math.round(o.height-a.height),Math.round(c-n.offsetY)));this.chatgptPetOverlayMascotLocalPosition={left:l,top:u};let d=this.chatgptPetOverlayTrayAboveLeft({...r,windowBounds:{...r.windowBounds,x:o.x,y:o.y,width:o.width,height:o.height}});this.layout=d;try{this.compositionHost.updateMascotRect?.(d.mascot)}catch{}try{this.sendLayoutToRenderer(i,null)}catch{}return!0}",
    "chatgptPetOverlayEndLocalMascotDrag(e){return!this.chatgptPetOverlayDragFromCurrentRenderer(e)||this.chatgptPetOverlayMascotDragState==null?!1:(this.chatgptPetOverlayMascotDragState=null,!0)}",
    "chatgptPetOverlayRememberLayout(e,t){let n=this.chatgptPetOverlayRect(t);this.chatgptPetOverlayDesiredDisplayBounds=n==null?null:{x:Math.round(n.x),y:Math.round(n.y),width:Math.round(n.width),height:Math.round(n.height)};let r=this.chatgptPetOverlayRect(e?.windowBounds);if(r!=null){let i={x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},a=this.chatgptPetOverlayDesiredWindowBounds,o=a==null||a.x!==i.x||a.y!==i.y||a.width!==i.width||a.height!==i.height;this.chatgptPetOverlayDesiredWindowBounds=i;if(o&&this.window!=null){let e=this.chatgptPetOverlaySettings();try{e.lockPosition===!0&&this.chatgptPetOverlayScheduleHyprlandHints(this.window)}catch{}try{this.dragState!=null?this.chatgptPetOverlayQueueKWinDrag(this.window):this.chatgptPetOverlayScheduleKWinHints(this.window)}catch{}try{this.dragState!=null?this.chatgptPetOverlayQueueNiriDrag(this.window):this.chatgptPetOverlayScheduleNiriHints(this.window)}catch{}}}return e}",
    "chatgptPetOverlayLayoutForDisplay(e,t,n){if(process.platform!==`linux`||t==null||t.windowBounds==null)return this.chatgptPetOverlayRememberLayout(this.chatgptPetOverlayTrayAboveLeft(t));let r=this.chatgptPetOverlayDisplayRect(e),i=this.chatgptPetOverlaySettings(),a=t;if(i.lockPosition===!0&&r!=null){let e=this.chatgptPetOverlayGravityBounds(r,a,i);e!=null&&(a=this.chatgptPetOverlayLayoutAtWindowPosition(e,a))}else if(this.dragState==null){let e=this.chatgptPetOverlayWindowBounds(n),o=!1;try{o=n?.isVisible?.()===!0}catch{}e!=null&&r!=null&&this.chatgptPetOverlayBoundsNearDisplay(e,r)&&(o||this.chatgptPetOverlayInitialPositionDone===!0||this.chatgptPetOverlayManualPosition===!0)?(this.chatgptPetOverlayInitialPositionDone=!0,this.chatgptPetOverlayMoved(e,a.windowBounds)&&(this.chatgptPetOverlayManualPosition=!0),a=this.chatgptPetOverlayLayoutAtWindowPosition(e,a)):this.chatgptPetOverlayInitialPositionDone=!0}return this.chatgptPetOverlayRememberLayout(this.chatgptPetOverlayTrayAboveLeft(a),r)}",
    "chatgptPetOverlayShouldUseWholeWindowInput(){return process.platform===`linux`&&this.chatgptPetOverlaySettings().lockPosition!==!0}",
    "chatgptPetOverlayInstallTransparentRenderer(e){try{this.chatgptLinuxWholeWindowInput=this.chatgptPetOverlayShouldUseWholeWindowInput();if(e.__chatgptPetOverlayTransparentRendererInstalled)return;e.__chatgptPetOverlayTransparentRendererInstalled=!0;let t=e.webContents,n=()=>{try{let n=`html,body,#root,main,[data-avatar-overlay-content-frame=\"true\"]{background:transparent!important;background-color:transparent!important;}[data-codex-window-type=\"electron\"].electron-opaque,[data-codex-window-type=\"electron\"].electron-opaque body{background:transparent!important;background-color:transparent!important;background-image:none!important;}`;this.chatgptLinuxWholeWindowInput=this.chatgptPetOverlayShouldUseWholeWindowInput(),this.chatgptLinuxWholeWindowInput&&(n+=`html,body,#root,main,[data-avatar-overlay-content-frame=\"true\"]{-webkit-app-region:drag!important;app-region:drag!important;user-select:none!important;-webkit-user-select:none!important;}[data-avatar-overlay-hit-region=\"mascot\"],[data-avatar-mascot=\"true\"],.no-drag,[data-avatar-overlay-hit-region=\"notification-tray\"],[data-avatar-overlay-hit-region=\"notification-scroll-control\"]{-webkit-app-region:no-drag!important;app-region:no-drag!important;}`),t==null||t.isDestroyed?.()||t.insertCSS?.(n,{cssOrigin:`author`}),t==null||t.isDestroyed?.()||t.executeJavaScript?.(`try{document.documentElement.style.background=\"transparent\";document.body&&(document.body.style.background=\"transparent\")}catch{}`,!0)}catch{}};t?.on?.(`did-finish-load`,n),n()}catch{}}",
    "chatgptPetOverlayRestoreFocusableAfterInactiveShow(e){try{let t=setTimeout(()=>{try{e==null||e.isDestroyed?.()||this.window!==e||this.chatgptPetOverlaySettings().mode===`passive`||e.setFocusable?.(!0)}catch{}},0);try{t.unref?.()}catch{}}catch{}}",
    "chatgptPetOverlaySyncWindow(e,t=!1){if(process.platform!==`linux`||e==null||e.isDestroyed?.())return;this.chatgptLinuxWholeWindowInput=this.chatgptPetOverlayShouldUseWholeWindowInput();let n=this.chatgptPetOverlaySettings(),r=n.mode!==`passive`;try{e.setTitle?.(`ChatGPT Pet Overlay`)}catch{}try{e.setFocusable?.(r&&!t)}catch{}try{t&&r&&this.chatgptPetOverlayRestoreFocusableAfterInactiveShow(e)}catch{}try{e.setSkipTaskbar?.(!!n.skipTaskbar)}catch{}try{e.setAlwaysOnTop?.(!!n.alwaysOnTop)}catch{}try{e.setBackgroundColor?.(`#00000000`)}catch{}try{this.chatgptPetOverlayInstallTransparentRenderer(e)}catch{}try{e.setOpacity?.(1)}catch{}try{e.setVisibleOnAllWorkspaces?.(!!n.allWorkspaces,{visibleOnFullScreen:!!n.allWorkspaces})}catch{try{e.setVisibleOnAllWorkspaces?.(!!n.allWorkspaces)}catch{}}try{n.alwaysOnTop&&e.moveTop?.()}catch{}try{this.chatgptPetOverlayScheduleHyprlandHints(e)}catch{}try{this.chatgptPetOverlayScheduleKWinHints(e)}catch{}try{this.chatgptPetOverlayScheduleNiriHints(e)}catch{}}",
    "chatgptPetOverlayHyprlandSession(){if(process.platform!==`linux`)return!1;let e=[process.env.HYPRLAND_INSTANCE_SIGNATURE,process.env.XDG_CURRENT_DESKTOP,process.env.DESKTOP_SESSION].filter(Boolean).join(`:`).toLowerCase();return e.includes(`hyprland`)}",
    "chatgptPetOverlayShouldUseHyprland(){return process.platform===`linux`&&this.chatgptPetOverlaySettings().hyprland===!0&&this.chatgptPetOverlayHyprlandSession()}",
    "chatgptPetOverlayHyprctl(e,t){if(this.chatgptPetOverlayHyprctlUnavailable)return;try{let n=typeof require==`function`?require(`node:child_process`):null;if(typeof n?.execFile!=`function`){this.chatgptPetOverlayHyprctlUnavailable=!0;return}n.execFile(`hyprctl`,e,{timeout:1200},(e,...n)=>{e?.code===`ENOENT`&&(this.chatgptPetOverlayHyprctlUnavailable=!0),typeof t==`function`&&t(e,...n)})}catch(e){e?.code===`ENOENT`&&(this.chatgptPetOverlayHyprctlUnavailable=!0);try{typeof t==`function`&&t(e)}catch{}}}",
    "chatgptPetOverlayLuaString(e){return String(e).replace(/\\\\/g,`\\\\\\\\`).replaceAll(`\"`,`\\\\\"`)}",
    "chatgptPetOverlayShouldFallbackHyprctl(e){return e!=null&&e.killed!==!0&&e.signal==null&&e.code!==`ETIMEDOUT`&&e.code!==`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`}",
    "chatgptPetOverlayHyprlandDispatch(e,t){this.chatgptPetOverlayHyprctl([`dispatch`,e],e=>{this.chatgptPetOverlayShouldFallbackHyprctl(e)&&Array.isArray(t)&&this.chatgptPetOverlayHyprctl([`dispatch`,...t])})}",
    "chatgptPetOverlayHyprlandSetProp(e,t,n){let r=this.chatgptPetOverlayLuaString(e),i=this.chatgptPetOverlayLuaString(t),a=this.chatgptPetOverlayLuaString(n);this.chatgptPetOverlayHyprlandDispatch(`hl.dsp.window.set_prop({ prop = \"${i}\", value = \"${a}\", window = \"${r}\" })`,[`setprop`,e,t,String(n)])}",
    "chatgptPetOverlaySelectHyprlandClient(e,t){if(!Array.isArray(e))return null;let n=this.chatgptPetOverlayRect(t),r=[];for(let i of e){if(i==null||typeof i.address!=`string`||!/^0x[0-9a-f]{1,16}$/i.test(i.address)||String(i.title??``)!==`ChatGPT Pet Overlay`||i.floating!==!0||!(i.fullscreen===0||i.fullscreen===!1)||Number(i.pid)!==Number(process.pid))continue;let t=i.size,a=i.at;if(!Array.isArray(t)||!Array.isArray(a))continue;let o=Number(t[0]),s=Number(t[1]),c=Number(a[0]),l=Number(a[1]);if(![o,s,c,l].every(Number.isFinite)||o<=0||s<=0)continue;r.push({client:i,sizeScore:n==null?0:Math.abs(o-n.width)+Math.abs(s-n.height),positionScore:n==null?0:Math.abs(c-n.x)+Math.abs(l-n.y),area:o*s})}if(n!=null){let e=r.filter(e=>e.sizeScore<=16);if(e.length===1)return e[0].client;let t=e.filter(e=>e.positionScore<=80);return t.length===1?t[0].client:null}let i=r.filter(e=>e.area<=300000);return i.length===1?i[0].client:null}",
    "chatgptPetOverlayFindHyprlandClient(e,t){if(!this.chatgptPetOverlayShouldUseHyprland())return;let n=this.chatgptPetOverlayWindowBounds(e);this.chatgptPetOverlayHyprctl([`clients`,`-j`],(e,r)=>{if(e)return;let i;try{i=JSON.parse(String(r??``))}catch{return}let a=this.chatgptPetOverlaySelectHyprlandClient(i,n);a!=null&&typeof t==`function`&&t(a)})}",
    "chatgptPetOverlayApplyHyprlandHints(e){let t=this.chatgptPetOverlaySettings();if(process.platform!==`linux`||e==null||e.isDestroyed?.()||!this.chatgptPetOverlayShouldUseHyprland())return;this.chatgptPetOverlayFindHyprlandClient(e,n=>{if(e.isDestroyed?.()||this.window!==e)return;let r=`address:${n.address}`,i=this.chatgptPetOverlayDesiredWindowBounds,a=Number(i?.x),o=Number(i?.y),s=Math.round(a),c=Math.round(o);t.lockPosition&&[a,o].every(Number.isFinite)&&this.chatgptPetOverlayHyprlandDispatch(`hl.dsp.window.move({ window = \"${r}\", x = ${s}, y = ${c} })`,[`movewindowpixel`,`exact ${s} ${c},${r}`]);t.allWorkspaces&&n.pinned!==!0&&this.chatgptPetOverlayHyprlandDispatch(`hl.dsp.window.pin({ action = \"on\", window = \"${r}\" })`,[`pin`,r]);this.chatgptPetOverlayHyprlandSetProp(r,`decorate`,`0`);this.chatgptPetOverlayHyprlandSetProp(r,`no_shadow`,`1`);this.chatgptPetOverlayHyprlandSetProp(r,`no_blur`,`1`);this.chatgptPetOverlayHyprlandSetProp(r,`no_anim`,`1`);this.chatgptPetOverlayHyprlandSetProp(r,`border_size`,`0`);this.chatgptPetOverlayHyprlandSetProp(r,`rounding`,`0`);this.chatgptPetOverlayHyprlandSetProp(r,`opacity`,`1.0 override 1.0 override 1.0 override`);this.chatgptPetOverlayHyprlandSetProp(r,`opaque`,`0`);this.chatgptPetOverlayHyprlandSetProp(r,`force_rgbx`,`0`);t.alwaysOnTop&&this.chatgptPetOverlayHyprlandDispatch(`hl.dsp.window.alter_zorder({ mode = \"top\", window = \"${r}\" })`,[`alterzorder`,`top,${r}`])})}",
    "chatgptPetOverlayScheduleHyprlandHints(e){if(!this.chatgptPetOverlayShouldUseHyprland())return;try{this.chatgptPetOverlayHyprlandTimers?.forEach(clearTimeout)}catch{}this.chatgptPetOverlayHyprlandTimers=[0,80,300,1000,2500,5000,10000].map(t=>{let n=setTimeout(()=>{try{e==null||e.isDestroyed?.()||this.chatgptPetOverlayApplyHyprlandHints(e)}catch{}},t);try{n.unref?.()}catch{}return n})}",
    "chatgptPetOverlayKWinSession(){if(process.platform!==`linux`)return!1;let e=String(process.env.KDE_FULL_SESSION??``).toLowerCase();if(process.env.KDE_SESSION_VERSION||e===`1`||e===`true`)return!0;let t=[process.env.XDG_CURRENT_DESKTOP,process.env.DESKTOP_SESSION].filter(Boolean).join(`:`).toLowerCase();return t.includes(`kde`)||t.includes(`plasma`)}",
    "chatgptPetOverlayShouldUseKWin(){return process.platform===`linux`&&this.chatgptPetOverlaySettings().kwin===!0&&this.chatgptPetOverlayKWinSession()}",
    "chatgptPetOverlayKWinQdbus(e,t,n=!1){if(this.chatgptPetOverlayKWinUnavailable){try{typeof t===`function`&&t({code:`ENOENT`})}catch{}return}let r=e;try{let i=typeof require===`function`?require(`node:child_process`):null;if(typeof i?.execFile!==`function`){this.chatgptPetOverlayKWinUnavailable=!0;try{typeof t===`function`&&t({code:`ENOENT`})}catch{}return}i.execFile(n?`qdbus`:`qdbus6`,r,{timeout:1500},(e,...i)=>{if(e?.code===`ENOENT`&&!n){this.chatgptPetOverlayKWinQdbus(r,t,!0);return}e?.code===`ENOENT`&&(this.chatgptPetOverlayKWinUnavailable=!0);try{typeof t===`function`&&t(e,...i)}catch{}})}catch(e){if(e?.code===`ENOENT`&&!n){this.chatgptPetOverlayKWinQdbus(r,t,!0);return}e?.code===`ENOENT`&&(this.chatgptPetOverlayKWinUnavailable=!0);try{typeof t===`function`&&t(e)}catch{}}}",
    "chatgptPetOverlayKWinScript(e,t){let n=this.chatgptPetOverlayRect(e),r=this.chatgptPetOverlaySettings(),i={pid:Number(process.pid),title:`ChatGPT Pet Overlay`,alwaysOnTop:!!r.alwaysOnTop,allWorkspaces:!!r.allWorkspaces,skipTaskbar:!!r.skipTaskbar,move:!!t,x:Math.round(Number(n?.x)),y:Math.round(Number(n?.y)),width:Math.round(Number(n?.width)),height:Math.round(Number(n?.height))};return `(function(){var d=${JSON.stringify(i)};function windows(){try{if(typeof workspace.windowList==='function')return workspace.windowList()}catch(e){}try{if(typeof workspace.clientList==='function')return workspace.clientList()}catch(e){}try{if(workspace.stackingOrder&&typeof workspace.stackingOrder.length==='number')return workspace.stackingOrder}catch(e){}return[]}var a=windows().filter(function(w){try{return String(w.caption||'')===d.title&&Number(w.pid)===d.pid}catch(e){return false}});if(a.length!==1)return;var w=a[0];try{w.keepAbove=d.alwaysOnTop}catch(e){}try{w.skipTaskbar=d.skipTaskbar}catch(e){}try{w.skipPager=d.skipTaskbar}catch(e){}try{w.onAllDesktops=d.allWorkspaces}catch(e){}try{w.noBorder=true}catch(e){}if(d.move&&isFinite(d.x)&&isFinite(d.y)){try{var g=w.frameGeometry;w.frameGeometry={x:d.x,y:d.y,width:isFinite(d.width)&&d.width>0?d.width:g.width,height:isFinite(d.height)&&d.height>0?d.height:g.height}}catch(e){}}if(d.alwaysOnTop){try{if(typeof workspace.raiseWindow==='function')workspace.raiseWindow(w)}catch(e){}}})()`}",
    "chatgptPetOverlayKWinRun(e,t,n){if(!this.chatgptPetOverlayShouldUseKWin()){try{typeof n===`function`&&n({code:`DISABLED`})}catch{}return}let r;try{let i=require(`node:fs`),a=require(`node:os`),o=require(`node:path`),s=(this.chatgptPetOverlayKWinScriptGeneration??0)+1;this.chatgptPetOverlayKWinScriptGeneration=s;let c=`codex_pet_overlay_${process.pid}_${Date.now()}_${s}`,l=o.join(a.tmpdir(),`${c}.js`);i.writeFileSync(l,this.chatgptPetOverlayKWinScript(e,t),{encoding:`utf8`,flag:`wx`,mode:384}),r=()=>{try{i.unlinkSync(l)}catch{}};let u=[`org.kde.KWin`,`/Scripting`,`org.kde.kwin.Scripting.loadScript`,l,c];this.chatgptPetOverlayKWinQdbus(u,e=>{if(e){r();try{typeof n===`function`&&n(e)}catch{}return}this.chatgptPetOverlayKWinQdbus([`org.kde.KWin`,`/Scripting`,`org.kde.kwin.Scripting.start`],e=>{this.chatgptPetOverlayKWinQdbus([`org.kde.KWin`,`/Scripting`,`org.kde.kwin.Scripting.unloadScript`,c],()=>{r();try{typeof n===`function`&&n(e)}catch{}})})})}catch(e){try{r?.()}catch{}try{typeof n===`function`&&n(e)}catch{}}}",
    "chatgptPetOverlayApplyKWinHints(e){if(e==null||e.isDestroyed?.()||this.window!==e||!this.chatgptPetOverlayShouldUseKWin()||this.dragState!=null||this.chatgptPetOverlayKWinDragState!=null||this.chatgptPetOverlayKWinHintInFlight)return;this.chatgptPetOverlayKWinHintInFlight=!0;let t=this.chatgptPetOverlaySettings();this.chatgptPetOverlayKWinRun(this.chatgptPetOverlayDesiredWindowBounds,t.lockPosition===!0,()=>{this.chatgptPetOverlayKWinHintInFlight=!1,this.chatgptPetOverlayKWinDragState==null&&this.window===e&&!e.isDestroyed?.()&&this.chatgptPetOverlayKWinPendingHints&&(this.chatgptPetOverlayKWinPendingHints=!1,this.chatgptPetOverlayScheduleKWinHints(e))})}",
    "chatgptPetOverlayScheduleKWinHints(e){if(!this.chatgptPetOverlayShouldUseKWin()||this.dragState!=null||this.chatgptPetOverlayKWinDragState!=null)return;if(this.chatgptPetOverlayKWinHintInFlight){this.chatgptPetOverlayKWinPendingHints=!0;return}this.chatgptPetOverlayKWinPendingHints=!1;try{this.chatgptPetOverlayKWinTimers?.forEach(clearTimeout)}catch{}this.chatgptPetOverlayKWinTimers=[0,80,300,1000,2500].map(t=>{let n=setTimeout(()=>{try{this.chatgptPetOverlayApplyKWinHints(e)}catch{}},t);try{n.unref?.()}catch{}return n})}",
    "chatgptPetOverlayKWinExecSync(e){if(this.chatgptPetOverlayKWinUnavailable||!this.chatgptPetOverlayShouldUseKWin())return!1;try{let t=typeof require===`function`?require(`node:child_process`):null;if(typeof t?.execFileSync!==`function`)return!1;for(let n of [`qdbus6`,`qdbus`])try{t.execFileSync(n,e,{timeout:750,stdio:`ignore`});return!0}catch(e){if(e?.code!==`ENOENT`)return!1}this.chatgptPetOverlayKWinUnavailable=!0}catch{}return!1}",
    "chatgptPetOverlayKWinDragScript(){let e={pid:Number(process.pid),title:`ChatGPT Pet Overlay`};return `(function(){var d=${JSON.stringify(e)};function windows(){try{if(typeof workspace.windowList==='function')return workspace.windowList()}catch(e){}try{if(typeof workspace.clientList==='function')return workspace.clientList()}catch(e){}return[]}var a=windows().filter(function(w){try{return String(w.caption||'')===d.title&&Number(w.pid)===d.pid}catch(e){return false}});if(a.length!==1)return;var w=a[0],p=workspace.cursorPos,g=w.frameGeometry,dx=Number(p.x)-Number(g.x),dy=Number(p.y)-Number(g.y),active=true;function move(){if(!active)return;try{var p=workspace.cursorPos,g=w.frameGeometry;w.frameGeometry={x:Math.round(Number(p.x)-dx),y:Math.round(Number(p.y)-dy),width:g.width,height:g.height}}catch(e){stop()}}function stop(){if(!active)return;active=false;try{workspace.cursorPosChanged.disconnect(move)}catch(e){}}try{workspace.cursorPosChanged.connect(move)}catch(e){return}try{workspace.windowRemoved.connect(function(v){if(v===w)stop()})}catch(e){}try{if(typeof workspace.raiseWindow==='function')workspace.raiseWindow(w)}catch(e){}})()`}",
    "chatgptPetOverlayReleaseKWinDrag(e){if(e==null)return;try{this.chatgptPetOverlayKWinExecSync([`org.kde.KWin`,`/Scripting`,`org.kde.kwin.Scripting.unloadScript`,e.pluginName])}catch{}try{require(`node:fs`).unlinkSync(e.scriptPath)}catch{}}",
    "chatgptPetOverlayStartKWinDrag(e){let t;try{let n=require(`node:fs`),r=require(`node:os`),i=require(`node:path`),a=(this.chatgptPetOverlayKWinDragGeneration??0)+1,o=`codex_pet_overlay_drag_${process.pid}_${Date.now()}_${a}`,s=i.join(r.tmpdir(),`${o}.js`);n.writeFileSync(s,this.chatgptPetOverlayKWinDragScript(),{encoding:`utf8`,flag:`wx`,mode:384}),t={generation:a,window:e,pluginName:o,scriptPath:s};let c=[`org.kde.KWin`,`/Scripting`,`org.kde.kwin.Scripting.loadScript`,s,o];if(!this.chatgptPetOverlayKWinExecSync(c)||!this.chatgptPetOverlayKWinExecSync([`org.kde.KWin`,`/Scripting`,`org.kde.kwin.Scripting.start`])){this.chatgptPetOverlayReleaseKWinDrag(t);return null}return t}catch(e){this.chatgptPetOverlayReleaseKWinDrag(t);return null}}",
    "chatgptPetOverlayBeginKWinDrag(e){if(e==null||e.isDestroyed?.()||this.window!==e||!this.chatgptPetOverlayShouldUseKWin())return;try{this.chatgptPetOverlayKWinTimers?.forEach(clearTimeout)}catch{}let t=this.chatgptPetOverlayKWinDragState;t!=null&&(this.chatgptPetOverlayKWinDragState=null,this.chatgptPetOverlayReleaseKWinDrag(t));let n=this.chatgptPetOverlayStartKWinDrag(e);if(n==null)return;let r=null;try{r=Number(e.getContentBounds?.().x)}catch{}this.chatgptPetOverlayKWinDragGeneration=n.generation,this.chatgptPetOverlayKWinDragState=n,this.windowServerDragActive=!0,Number.isFinite(r)&&(this.windowServerDragWindowX=r)}",
    "chatgptPetOverlayKWinDragCurrent(e){if(e==null||this.chatgptPetOverlayKWinDragState!==e||this.chatgptPetOverlayKWinDragGeneration!==e.generation)return!1;if(this.window===e.window&&!e.window?.isDestroyed?.())return!0;this.chatgptPetOverlayKWinDragState=null,this.chatgptPetOverlayReleaseKWinDrag(e);return!1}",
    "chatgptPetOverlayQueueKWinDrag(e){let t=this.chatgptPetOverlayKWinDragState;this.chatgptPetOverlayKWinDragCurrent(t)&&t.window===e&&(this.windowServerDragActive=!0)}",
    "chatgptPetOverlayEndKWinDrag(e,t){let n=this.chatgptPetOverlayKWinDragState;if(!this.chatgptPetOverlayKWinDragCurrent(n)||n.window!==e)return!1;this.chatgptPetOverlayKWinDragState=null,this.chatgptPetOverlayReleaseKWinDrag(n);try{typeof t===`function`&&t()}catch{}try{this.window!=null&&!this.window.isDestroyed?.()&&this.chatgptPetOverlayScheduleKWinHints(this.window)}catch{}return!0}",
    "chatgptPetOverlayNiriSession(){if(process.platform!==`linux`)return!1;let e=[process.env.NIRI_SOCKET,process.env.XDG_CURRENT_DESKTOP,process.env.DESKTOP_SESSION].filter(Boolean).join(`:`).toLowerCase();return e.includes(`niri`)}",
    "chatgptPetOverlayShouldUseNiri(){return process.platform===`linux`&&this.chatgptPetOverlaySettings().niri===!0&&this.chatgptPetOverlayNiriSession()}",
    "chatgptPetOverlayFinishNiriProcess(){this.chatgptPetOverlayNiriProcessCount=Math.max(0,(this.chatgptPetOverlayNiriProcessCount??1)-1);if(this.chatgptPetOverlayNiriProcessCount===0){let e=this.chatgptPetOverlayNiriDragState;if(e!=null)this.chatgptPetOverlayPumpNiriDrag(e);else{let e=this.chatgptPetOverlayNiriPendingHintsWindow;this.chatgptPetOverlayNiriPendingHintsWindow=null;try{e!=null&&!e.isDestroyed?.()&&this.window===e&&this.chatgptPetOverlayScheduleNiriHints(e)}catch{}}}}",
    "chatgptPetOverlayNiri(e,t){if(this.chatgptPetOverlayNiriUnavailable){try{typeof t==`function`&&t({code:`ENOENT`})}catch{}return}let n=!1;try{let r=typeof require==`function`?require(`node:child_process`):null;if(typeof r?.execFile!=`function`){this.chatgptPetOverlayNiriUnavailable=!0;try{typeof t==`function`&&t({code:`ENOENT`})}catch{}return}this.chatgptPetOverlayNiriProcessCount=(this.chatgptPetOverlayNiriProcessCount??0)+1,n=!0,r.execFile(`niri`,[`msg`,...e],{timeout:1200},(e,...n)=>{e?.code===`ENOENT`&&(this.chatgptPetOverlayNiriUnavailable=!0);try{typeof t==`function`&&t(e,...n)}finally{this.chatgptPetOverlayFinishNiriProcess()}})}catch(e){e?.code===`ENOENT`&&(this.chatgptPetOverlayNiriUnavailable=!0),n&&this.chatgptPetOverlayFinishNiriProcess();try{typeof t==`function`&&t(e)}catch{}}}",
    "chatgptPetOverlayNiriWindowSize(e){let t=e?.layout?.window_size??e?.layout?.windowSize??e?.window_size??e?.size;if(!Array.isArray(t))return null;let n=Number(t[0]),r=Number(t[1]);return[n,r].every(Number.isFinite)&&n>0&&r>0?{width:n,height:r}:null}",
    "chatgptPetOverlayNiriPositiveInteger(e){return typeof e==`number`&&Number.isSafeInteger(e)&&e>0?e:null}",
    "chatgptPetOverlayNiriLocalMove(){let e=this.chatgptPetOverlayRect(this.chatgptPetOverlayDesiredWindowBounds),t=this.chatgptPetOverlayRect(this.chatgptPetOverlayDesiredDisplayBounds);if(e==null||t==null)return null;let n=e.x-t.x,r=e.y-t.y;return[n,r].every(Number.isFinite)?{x:Math.round(n),y:Math.round(r)}:null}",
    "chatgptPetOverlaySelectNiriWindow(e,t){if(!Array.isArray(e))return null;let n=this.chatgptPetOverlayRect(t),r=[];for(let i of e){let e=this.chatgptPetOverlayNiriPositiveInteger(i?.id),t=this.chatgptPetOverlayNiriPositiveInteger(i?.pid);if(e==null||t!==process.pid||String(i?.title??``)!==`ChatGPT Pet Overlay`)continue;if(i.is_floating!=null&&typeof i.is_floating!=`boolean`)continue;let a=this.chatgptPetOverlayNiriWindowSize(i),o=a==null?0:Math.abs(a.width-Number(n?.width??a.width))+Math.abs(a.height-Number(n?.height??a.height)),s=a==null?0:a.width*a.height;r.push({window:i,id:e,sizeScore:o,area:s})}if(n!=null){let e=r.filter(e=>e.sizeScore<=16);return e.length===1?e[0].window:null}let i=r.filter(e=>e.area>0&&e.area<=300000);return i.length===1?i[0].window:r.length===1?r[0].window:null}",
    "chatgptPetOverlayFindNiriWindow(e,t){if(!this.chatgptPetOverlayShouldUseNiri()){try{typeof t==`function`&&t({code:`DISABLED`})}catch{}return}let n=this.chatgptPetOverlayWindowBounds(e);this.chatgptPetOverlayNiri([`--json`,`windows`],(e,r)=>{if(e){try{typeof t==`function`&&t(e)}catch{}return}let i;try{i=JSON.parse(String(r??``))}catch{try{typeof t==`function`&&t({code:`INVALID_JSON`})}catch{}return}let a=this.chatgptPetOverlaySelectNiriWindow(i,n);try{typeof t==`function`&&t(null,a)}catch{}})}",
    "chatgptPetOverlayApplyNiriHints(e,t=this.chatgptPetOverlayNiriEpoch){if(process.platform!==`linux`||e==null||e.isDestroyed?.()||!this.chatgptPetOverlayShouldUseNiri()||this.chatgptPetOverlayNiriDragState!=null||this.chatgptPetOverlayNiriDragCallOwner!=null)return;this.chatgptPetOverlayFindNiriWindow(e,(n,r)=>{if(n||e.isDestroyed?.()||this.window!==e||t!==this.chatgptPetOverlayNiriEpoch||this.chatgptPetOverlayNiriDragState!=null||this.chatgptPetOverlayNiriDragCallOwner!=null)return;let i=this.chatgptPetOverlayNiriPositiveInteger(r?.id);if(i==null)return;let a=()=>{if(e.isDestroyed?.()||this.window!==e||t!==this.chatgptPetOverlayNiriEpoch||this.chatgptPetOverlayNiriDragState!=null||this.chatgptPetOverlayNiriDragCallOwner!=null)return;let n=this.chatgptPetOverlayNiriLocalMove();n!=null&&this.chatgptPetOverlayNiri([`action`,`move-floating-window`,`--id`,String(i),`-x`,String(n.x),`-y`,String(n.y)])};r.is_floating===!0?a():this.chatgptPetOverlayNiri([`action`,`move-window-to-floating`,`--id`,String(i)],n=>{n||a()})})}",
    "chatgptPetOverlayScheduleNiriHints(e){let t=this.chatgptPetOverlayNiriDragState;if(t!=null&&(this.window!==t.window||t.window?.isDestroyed?.())){try{t.retryTimer!=null&&clearTimeout(t.retryTimer)}catch{}this.chatgptPetOverlayNiriDragState=null,this.chatgptPetOverlayNiriEpoch=(this.chatgptPetOverlayNiriEpoch??0)+1}if(this.chatgptPetOverlayNiriUnavailable||!this.chatgptPetOverlayShouldUseNiri()||this.dragState!=null||this.chatgptPetOverlayNiriDragState!=null)return;if(this.chatgptPetOverlayNiriDragCallOwner!=null||(this.chatgptPetOverlayNiriProcessCount??0)>0){this.chatgptPetOverlayNiriPendingHintsWindow=e;return}this.chatgptPetOverlayNiriPendingHintsWindow=null;try{this.chatgptPetOverlayNiriTimers?.forEach(clearTimeout)}catch{}let n=(this.chatgptPetOverlayNiriEpoch??0)+1;this.chatgptPetOverlayNiriEpoch=n,this.chatgptPetOverlayNiriTimers=[0,80,300,1000].map(t=>{let r=setTimeout(()=>{try{e==null||e.isDestroyed?.()||this.chatgptPetOverlayApplyNiriHints(e,n)}catch{}},t);try{r.unref?.()}catch{}return r})}",
    "chatgptPetOverlayBeginNiriDrag(e){if(e==null||e.isDestroyed?.()||this.window!==e||!this.chatgptPetOverlayShouldUseNiri())return;try{this.chatgptPetOverlayNiriTimers?.forEach(clearTimeout),this.chatgptPetOverlayNiriDragState?.retryTimer!=null&&clearTimeout(this.chatgptPetOverlayNiriDragState.retryTimer)}catch{}this.chatgptPetOverlayNiriEpoch=(this.chatgptPetOverlayNiriEpoch??0)+1;let t=(this.chatgptPetOverlayNiriDragGeneration??0)+1;this.chatgptPetOverlayNiriDragGeneration=t;let n=this.chatgptPetOverlayNiriLocalMove();this.chatgptPetOverlayNiriDragState={generation:t,window:e,id:null,floating:!1,latestTarget:n==null?null:{x:n.x,y:n.y},inFlight:!1,released:!1,persisted:!1,complete:null,retryIndex:0,retryTimer:null},this.chatgptPetOverlayPumpNiriDrag(this.chatgptPetOverlayNiriDragState)}",
    "chatgptPetOverlayNiriDragCurrent(e){if(e==null||this.chatgptPetOverlayNiriDragState!==e||this.chatgptPetOverlayNiriDragGeneration!==e.generation)return!1;if(this.window===e.window&&!e.window?.isDestroyed?.())return!0;try{e.retryTimer!=null&&clearTimeout(e.retryTimer)}catch{}this.chatgptPetOverlayNiriDragState=null,this.chatgptPetOverlayNiriEpoch=(this.chatgptPetOverlayNiriEpoch??0)+1;let t=this.window;try{t!=null&&!t.isDestroyed?.()&&this.chatgptPetOverlayScheduleNiriHints(t)}catch{}return!1}",
    "chatgptPetOverlayStartNiriDragCall(e){if(this.chatgptPetOverlayNiriDragCallOwner!=null)return!1;e.inFlight=!0,this.chatgptPetOverlayNiriDragCallOwner=e;return!0}",
    "chatgptPetOverlayFinishNiriDragCall(e){e.inFlight=!1,this.chatgptPetOverlayNiriDragCallOwner===e&&(this.chatgptPetOverlayNiriDragCallOwner=null);let t=this.chatgptPetOverlayNiriDragState;if(t!=null&&t!==e)this.chatgptPetOverlayPumpNiriDrag(t);else if(t==null){let e=this.window;try{e!=null&&!e.isDestroyed?.()&&this.chatgptPetOverlayScheduleNiriHints(e)}catch{}}}",
    "chatgptPetOverlayQueueNiriDrag(e){let t=this.chatgptPetOverlayNiriDragState;if(!this.chatgptPetOverlayNiriDragCurrent(t)||t.window!==e)return;let n=this.chatgptPetOverlayNiriLocalMove();n!=null&&(t.latestTarget={x:n.x,y:n.y}),this.chatgptPetOverlayPumpNiriDrag(t)}",
    "chatgptPetOverlayRetryNiriDrag(e,t){if(!this.chatgptPetOverlayNiriDragCurrent(e))return;if(t?.code===`ENOENT`){this.chatgptPetOverlayAbortNiriDrag(e);return}if(e.retryIndex>=3){this.chatgptPetOverlayAbortNiriDrag(e);return}let n=[0,80,300][e.retryIndex]??300;e.retryTimer=setTimeout(()=>{e.retryTimer=null,this.chatgptPetOverlayNiriDragCurrent(e)&&this.chatgptPetOverlayPumpNiriDrag(e)},n);try{e.retryTimer.unref?.()}catch{}}",
    "chatgptPetOverlayAbortNiriDrag(e){if(!this.chatgptPetOverlayNiriDragCurrent(e))return;try{e.retryTimer!=null&&clearTimeout(e.retryTimer)}catch{}e.inFlight=!1,e.retryTimer=null,e.released?this.chatgptPetOverlayFinalizeNiriDrag(e):this.chatgptPetOverlayNiriDragState=null}",
    "chatgptPetOverlayFinalizeNiriDrag(e){if(!this.chatgptPetOverlayNiriDragCurrent(e)||!e.released||e.persisted)return;e.persisted=!0;let t=e.complete;this.chatgptPetOverlayNiriDragState=null;try{typeof t==`function`&&t()}catch{}}",
    "chatgptPetOverlayPumpNiriDrag(e){if(!this.chatgptPetOverlayNiriDragCurrent(e)||e.inFlight||e.retryTimer!=null||this.chatgptPetOverlayNiriDragCallOwner!=null||(this.chatgptPetOverlayNiriProcessCount??0)>0)return;if(e.id==null){if(e.retryIndex>=3){this.chatgptPetOverlayAbortNiriDrag(e);return}e.retryIndex+=1;if(!this.chatgptPetOverlayStartNiriDragCall(e))return;this.chatgptPetOverlayFindNiriWindow(e.window,(t,n)=>{this.chatgptPetOverlayFinishNiriDragCall(e);if(!this.chatgptPetOverlayNiriDragCurrent(e))return;let r=this.chatgptPetOverlayNiriPositiveInteger(n?.id);if(t||r==null){this.chatgptPetOverlayRetryNiriDrag(e,t);return}e.id=r,e.floating=n.is_floating===!0,this.chatgptPetOverlayPumpNiriDrag(e)});return}if(!e.floating){if(!this.chatgptPetOverlayStartNiriDragCall(e))return;let t=e.id;this.chatgptPetOverlayNiri([`action`,`move-window-to-floating`,`--id`,String(t)],n=>{this.chatgptPetOverlayFinishNiriDragCall(e);if(!this.chatgptPetOverlayNiriDragCurrent(e))return;if(n){e.id=null,e.floating=!1,this.chatgptPetOverlayRetryNiriDrag(e,n);return}e.floating=!0,this.chatgptPetOverlayPumpNiriDrag(e)});return}let t=e.latestTarget;if(t!=null){e.latestTarget=null;if(!this.chatgptPetOverlayStartNiriDragCall(e)){e.latestTarget=t;return}let n=e.id;this.chatgptPetOverlayNiri([`action`,`move-floating-window`,`--id`,String(n),`-x`,String(t.x),`-y`,String(t.y)],n=>{this.chatgptPetOverlayFinishNiriDragCall(e);if(!this.chatgptPetOverlayNiriDragCurrent(e))return;if(n){e.latestTarget??=t,e.id=null,e.floating=!1,this.chatgptPetOverlayRetryNiriDrag(e,n);return}this.chatgptPetOverlayPumpNiriDrag(e)});return}e.released&&this.chatgptPetOverlayFinalizeNiriDrag(e)}",
    "chatgptPetOverlayEndNiriDrag(e,t){let n=this.chatgptPetOverlayNiriDragState;if(!this.chatgptPetOverlayNiriDragCurrent(n)||n.window!==e)return!1;n.released=!0,n.complete=t;let r=this.chatgptPetOverlayNiriLocalMove();r!=null&&(n.latestTarget={x:r.x,y:r.y}),this.chatgptPetOverlayPumpNiriDrag(n);return!0}",
    "chatgptPetOverlayShouldLockPosition(){return process.platform===`linux`&&this.chatgptPetOverlaySettings().lockPosition===!0}",
  ].join("");
}

function patchCreateWindowTitle(source) {
  if (source.includes("title:`ChatGPT Pet Overlay`,width:")) {
    return source;
  }
  const method = findAvatarOverlayMethod(source, /async createWindow\([^)]*\)\{/);
  if (method == null) {
    console.warn("WARN: Could not find avatar overlay createWindow - skipping pet overlay title patch");
    return source;
  }
  const replacement = method.text.replace(
    /title:[A-Za-z_$][\w$]*\.app\.getName\(\),width:/,
    "title:`ChatGPT Pet Overlay`,width:",
  );
  if (replacement === method.text) {
    console.warn("WARN: Could not identify avatar overlay title option - skipping pet overlay title patch");
    return source;
  }
  return replaceMethodText(source, method, replacement);
}

function patchCreateWindowFrame(source) {
  const method = findAvatarOverlayMethod(source, /async createWindow\([^)]*\)\{/);
  if (method == null) {
    console.warn("WARN: Could not find avatar overlay createWindow - skipping pet overlay frame patch");
    return source;
  }
  if (method.text.includes("frame:process.platform===`linux`?!1:!0")) {
    return source;
  }
  const replacement = method.text.replace(
    "appearance:`avatarOverlay`,",
    "appearance:`avatarOverlay`,frame:process.platform===`linux`?!1:!0,",
  );
  if (replacement === method.text) {
    console.warn("WARN: Could not identify avatar overlay appearance option - skipping pet overlay frame patch");
    return source;
  }
  return replaceMethodText(source, method, replacement);
}

function ensurePetOverlayMethods(source, settings) {
  if (source.includes("chatgptPetOverlaySettings(){")) {
    return source;
  }
  const insertionPoint =
    findAvatarOverlayMethod(source, /(?<![\w$.])applyLayout\([^{}]*\)\{/) ??
    findAvatarOverlayMethod(source, /showWindow\([A-Za-z_$][\w$]*\)\{/) ??
    findAvatarOverlayMethod(source, /startDrag\([^)]*\)\{/);
  if (insertionPoint == null) {
    console.warn("WARN: Could not find avatar overlay insertion point - skipping pet overlay patch");
    return source;
  }
  return source.slice(0, insertionPoint.start) +
    buildPetOverlayMethods(settings) +
    source.slice(insertionPoint.start);
}

function patchCompositorDragLifecycle(source) {
  let patched = source;
  const startMethod = findAvatarOverlayMethod(patched, /startDrag\([^)]*\)\{/);
  if (startMethod == null) {
    console.warn("WARN: Could not find avatar overlay startDrag for compositor transport - skipping pet overlay patch");
    return patched;
  }
  const needsKWinStart = !startMethod.text.includes("chatgptPetOverlayBeginKWinDrag(");
  const needsNiriStart = !startMethod.text.includes("chatgptPetOverlayBeginNiriDrag(");
  if (needsKWinStart || needsNiriStart) {
    const windowMatch = startMethod.text.match(/let ([A-Za-z_$][\w$]*)=this\.window;/);
    if (windowMatch == null || !startMethod.text.includes("this.dragState=")) {
      console.warn("WARN: Could not identify current avatar overlay drag start shape - skipping compositor transport hook");
      return patched;
    }
    const hooks = [
      needsKWinStart ? `this.chatgptPetOverlayBeginKWinDrag(${windowMatch[1]})` : null,
      needsNiriStart ? `this.chatgptPetOverlayBeginNiriDrag(${windowMatch[1]})` : null,
    ].filter(Boolean).join(",");
    patched = replaceMethodText(
      patched,
      startMethod,
      `${startMethod.text.slice(0, -1)},${hooks}}`,
    );
  }

  const endMethod = findAvatarOverlayMethod(patched, /endDrag\([^)]*\)\{/);
  if (endMethod == null) {
    console.warn("WARN: Could not find avatar overlay endDrag for compositor transport - skipping pet overlay patch");
    return patched;
  }
  if (
    endMethod.text.includes("chatgptPetOverlayEndKWinDrag(") &&
    endMethod.text.includes("chatgptPetOverlayEndNiriDrag(")
  ) {
    return patched;
  }
  const completionPattern = /[A-Za-z_$][\w$]*\?this\.persistWindowBounds\(([A-Za-z_$][\w$]*),[A-Za-z_$][\w$]*\?\?this\.getCurrentDisplay\(\)\):this\.reclampWindowToVisibleDisplay\(\{shouldPersist:!0\}\)/;
  const completionMatch = endMethod.text.match(completionPattern);
  if (completionMatch == null) {
    console.warn("WARN: Could not identify current avatar overlay drag completion shape - skipping compositor transport hook");
    return patched;
  }
  const windowVar = completionMatch[1];
  const completionNeedle = endMethod.text.slice(completionMatch.index, -1);
  return replaceMethodText(
    patched,
    endMethod,
    endMethod.text.slice(0, completionMatch.index) +
      `this.chatgptPetOverlayEndKWinDrag(${windowVar},()=>{${completionNeedle}})||this.chatgptPetOverlayEndNiriDrag(${windowVar},()=>{${completionNeedle}})||(()=>{${completionNeedle}})()` +
      "}",
  );
}

function patchApplyLayout(source) {
  if (
    source.includes("=this.chatgptPetOverlayLayoutForDisplay(") ||
    /let [A-Za-z_$][\w$]*=this\.chatgptPetOverlayLayoutForDisplay\(/.test(source)
  ) {
    return source;
  }

  const method = findAvatarOverlayMethod(source, /(?<![\w$.])applyLayout\([^{}]*\)\{/);
  if (method == null) {
    console.warn("WARN: Could not find avatar overlay applyLayout - skipping pet overlay layout patch");
    return source;
  }
  if (method.text.includes("chatgptPetOverlayLayoutForDisplay(")) {
    return source;
  }

  const windowArg = firstMethodArgument(method.text, "applyLayout", 0) ?? "null";
  const currentLayoutMatch = method.text.match(/let ([A-Za-z_$][\w$]*)=this\.getLayoutForDisplay\(([A-Za-z_$][\w$]*)\);/);
  if (currentLayoutMatch != null) {
    const [needle, layoutVar, displayArg] = currentLayoutMatch;
    const replacement = `let ${layoutVar}=this.chatgptPetOverlayLayoutForDisplay(${displayArg},this.getLayoutForDisplay(${displayArg}),${windowArg});`;
    return replaceMethodText(source, method, method.text.replace(needle, replacement));
  }

  console.warn("WARN: Could not identify avatar overlay layout variable - skipping pet overlay layout patch");
  return source;
}

function patchShowWindow(source) {
  if (source.includes("chatgptPetOverlaySyncWindow(")) {
    return source;
  }
  const method = findAvatarOverlayMethod(source, /showWindow\(([A-Za-z_$][\w$]*)\)\{/);
  if (method == null) {
    console.warn("WARN: Could not find avatar overlay showWindow - skipping pet overlay window sync");
    return source;
  }
  if (method.text.includes("chatgptPetOverlaySyncWindow")) {
    return source;
  }
  const windowArg = method.match[1];
  const needle = `${windowArg}.moveTop(),${windowArg}.showInactive(),`;
  if (!method.text.includes(needle)) {
    console.warn("WARN: Could not identify avatar overlay showWindow display point - skipping pet overlay window sync");
    return source;
  }
  const replacement = `process.platform===\`linux\`?this.chatgptPetOverlaySyncWindow(${windowArg},!0):${windowArg}.moveTop(),${windowArg}.showInactive(),`;
  return replaceMethodText(source, method, method.text.replace(needle, replacement));
}

function patchLockedDrag(source) {
  if (source.includes("if(this.chatgptPetOverlayShouldLockPosition())return;")) {
    return source;
  }
  const method = findAvatarOverlayMethod(source, /startDrag\([^)]*\)\{/);
  if (method == null) {
    console.warn("WARN: Could not find avatar overlay startDrag - skipping pet drag lock");
    return source;
  }
  return replaceMethodText(
    source,
    method,
    method.text.slice(0, method.match[0].length) +
      "if(this.chatgptPetOverlayShouldLockPosition())return;" +
      method.text.slice(method.match[0].length),
  );
}

function patchLocalMascotDrag(source) {
  if (source.includes("if(this.chatgptPetOverlayStartLocalMascotDrag(")) {
    return source;
  }
  const patches = [
    ["startDrag", "chatgptPetOverlayStartLocalMascotDrag"],
    ["moveDrag", "chatgptPetOverlayMoveLocalMascotDrag"],
    ["endDrag", "chatgptPetOverlayEndLocalMascotDrag"],
  ];
  let patched = source;
  for (const [methodName, helperName] of patches) {
    const method = findAvatarOverlayMethod(patched, new RegExp(`${methodName}\\([^)]*\\)\\{`));
    const callerArg = method == null ? null : firstMethodArgument(method.match[0], methodName, 0);
    const eventArg = method == null ? null : firstMethodArgument(method.match[0], methodName, 1);
    if (method == null || callerArg == null || (methodName !== "endDrag" && eventArg == null)) {
      if (methodName === "moveDrag") {
        return source;
      }
      console.warn(`WARN: Could not find avatar overlay ${methodName} - skipping local pet drag patch`);
      return source;
    }
    const call = methodName === "endDrag"
      ? `this.${helperName}(${callerArg})`
      : `this.${helperName}(${callerArg},${eventArg})`;
    patched = replaceMethodText(
      patched,
      method,
      method.text.slice(0, method.match[0].length) + `if(${call})return;` + method.text.slice(method.match[0].length),
    );
  }
  return patched;
}

function patchLocalMascotDragLifecycle(source) {
  if (source.includes("this.dragState=null,this.chatgptPetOverlayMascotDragState=null,")) {
    return source;
  }
  const method = findAvatarOverlayMethod(source, /async createWindow\([^)]*\)\{/);
  if (method == null || !method.text.includes("this.dragState=null,")) {
    console.warn("WARN: Could not find avatar overlay lifecycle state - skipping local pet drag cleanup");
    return source;
  }
  return replaceMethodText(
    source,
    method,
    method.text.replaceAll(
      "this.dragState=null,",
      "this.dragState=null,this.chatgptPetOverlayMascotDragState=null,",
    ),
  );
}

function patchPassiveCreateWindow(source, settings) {
  if (settings.mode !== "passive") {
    return source;
  }
  return source
    .split("appearance:`avatarOverlay`,frame:process.platform===`linux`?!1:!0,alwaysOnTop:process.platform===`linux`,skipTaskbar:process.platform===`linux`,focusable:process.platform===`linux`?!0:!1")
    .join("appearance:`avatarOverlay`,frame:process.platform===`linux`?!1:!0,alwaysOnTop:process.platform===`linux`,skipTaskbar:process.platform===`linux`,focusable:!1");
}

function patchAvatarSelectionRefresh(source) {
  if (source.includes(`function ${AVATAR_SELECTION_REFRESH_MARKER}(`)) {
    return source;
  }

  const handlerRegex = /"set-setting":async\(\{key:([A-Za-z_$][\w$]*),value:([A-Za-z_$][\w$]*)\}\)=>\(this\.setSettingValue\(\1,\2\),\{success:!0\}\)/;
  const match = source.match(handlerRegex);
  if (match == null) {
    console.warn("WARN: Could not find desktop set-setting handler - skipping pet selection refresh");
    return source;
  }

  const [handler, keyVar, valueVar] = match;
  const helper = `function ${AVATAR_SELECTION_REFRESH_MARKER}(){try{setTimeout(()=>{for(let e of require(\`electron\`).BrowserWindow.getAllWindows()){if(e?.isDestroyed?.()||String(e?.getTitle?.()??\`\`)!==\`ChatGPT Pet Overlay\`)continue;let t=e.webContents;t==null||t.isDestroyed?.()||t.reload?.()}},0)}catch{}}`;
  const replacement = `"set-setting":async({key:${keyVar},value:${valueVar}})=>(this.setSettingValue(${keyVar},${valueVar}),${keyVar}===\`selected-avatar-id\`&&${AVATAR_SELECTION_REFRESH_MARKER}(),{success:!0})`;
  return helper + source.replace(handler, replacement);
}

function hasCompletePetOverlayPatch(source, settings, avatarSelectionRefreshExpected, localMascotDragExpected) {
  const requiredMarkers = [
    source.includes("chatgptPetOverlaySettings(){"),
    /let [A-Za-z_$][\w$]*=this\.chatgptPetOverlayLayoutForDisplay\([A-Za-z_$][\w$]*,this\.getLayoutForDisplay\([A-Za-z_$][\w$]*\),[A-Za-z_$][\w$]*\);/.test(source),
    /process\.platform===`linux`\?this\.chatgptPetOverlaySyncWindow\([A-Za-z_$][\w$]*,!0\):[A-Za-z_$][\w$]*\.moveTop\(\),[A-Za-z_$][\w$]*\.showInactive\(\),/.test(source),
    source.includes("if(this.chatgptPetOverlayShouldLockPosition())return;"),
    source.includes("chatgptPetOverlayKWinQdbus("),
    source.includes("this.chatgptPetOverlayBeginKWinDrag("),
    source.includes("this.chatgptPetOverlayEndKWinDrag("),
    source.includes("this.chatgptPetOverlayBeginNiriDrag("),
    source.includes("this.chatgptPetOverlayEndNiriDrag("),
    source.includes("===`avatarOverlay`?{backgroundColor:`#00000000`,backgroundMaterial:null}:"),
    source.includes("title:`ChatGPT Pet Overlay`,width:"),
  ];
  if (localMascotDragExpected) {
    requiredMarkers.push(
      source.includes("if(this.chatgptPetOverlayStartLocalMascotDrag("),
      source.includes("if(this.chatgptPetOverlayMoveLocalMascotDrag("),
      source.includes("if(this.chatgptPetOverlayEndLocalMascotDrag("),
      source.includes("this.dragState=null,this.chatgptPetOverlayMascotDragState=null,"),
    );
  }
  if (avatarSelectionRefreshExpected) {
    requiredMarkers.push(
      source.includes(`function ${AVATAR_SELECTION_REFRESH_MARKER}(`),
      source.includes("===`selected-avatar-id`&&chatgptPetOverlayRefreshAvatarWindows()"),
    );
  }
  if (settings.mode === "passive") {
    requiredMarkers.push(
      source.includes("appearance:`avatarOverlay`,frame:process.platform===`linux`?!1:!0,alwaysOnTop:process.platform===`linux`,skipTaskbar:process.platform===`linux`,focusable:!1"),
    );
  }
  return requiredMarkers.every(Boolean);
}

function patchAvatarTransparentBackground(source) {
  if (source.includes("===`avatarOverlay`?{backgroundColor:`#00000000`,backgroundMaterial:null}:")) {
    return source;
  }
  const backgroundFunctionRegex =
    /function\s+([A-Za-z_$][\w$]*)\(\{platform:([A-Za-z_$][\w$]*),appearance:([A-Za-z_$][\w$]*),opaqueWindowSurfaceEnabled:([A-Za-z_$][\w$]*),prefersDarkColors:([A-Za-z_$][\w$]*)\}\)\{return\s+/;
  const match = source.match(backgroundFunctionRegex);
  if (match == null) {
    if (source.includes("opaqueWindowSurfaceEnabled") && source.includes("backgroundColor")) {
      console.warn("WARN: Could not find avatar overlay background function - skipping transparent pet background guard");
    }
    return source;
  }
  const appearanceParam = match[3];
  return source.slice(0, match.index) +
    `${match[0]}${appearanceParam}===\`avatarOverlay\`?{backgroundColor:\`#00000000\`,backgroundMaterial:null}:` +
    source.slice(match.index + match[0].length);
}

function applyPetOverlayPatch(source, context) {
  if (!source.includes("avatar-overlay") && !source.includes("avatarOverlay")) {
    console.warn("WARN: Avatar overlay markers not found - skipping pet overlay patch");
    return source;
  }
  const settings = mergedPetOverlaySettings(context);
  const avatarSelectionRefreshExpected = source.includes('"set-setting":async');
  const localMascotDragExpected = /moveDrag\([^)]*\)\{/.test(source);
  let patched = patchAvatarTransparentBackground(source);
  patched = patchCreateWindowTitle(patched);
  patched = patchCreateWindowFrame(patched);
  patched = patchApplyLayout(patched);
  patched = patchShowWindow(patched);
  patched = patchLockedDrag(patched);
  patched = patchCompositorDragLifecycle(patched);
  patched = ensurePetOverlayMethods(patched, settings);
  patched = patchLocalMascotDrag(patched);
  if (localMascotDragExpected) {
    patched = patchLocalMascotDragLifecycle(patched);
  }
  patched = patchPassiveCreateWindow(patched, settings);
  if (avatarSelectionRefreshExpected) {
    patched = patchAvatarSelectionRefresh(patched);
  }
  if (!hasCompletePetOverlayPatch(patched, settings, avatarSelectionRefreshExpected, localMascotDragExpected)) {
    console.warn("WARN: Pet overlay patch is incomplete - discarding all pet overlay changes");
    return source;
  }
  return patched;
}

const descriptors = [
  {
    id: DESCRIPTOR_ID,
    phase: "main-bundle",
    order: 20_500,
    ciPolicy: "optional",
    apply: applyPetOverlayPatch,
  },
];

module.exports = {
  DESCRIPTOR_ID,
  descriptors,
  applyPetOverlayPatch,
  mergedPetOverlaySettings,
};
