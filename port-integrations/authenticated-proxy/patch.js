"use strict";

const {
  inferModuleAlias,
} = require("../../scripts/patches/lib/minified-js.js");

const JS_IDENT = "[A-Za-z_$][\\w$]*";

function applyAuthenticatedProxyPatch(currentSource) {
  const electronVar = inferModuleAlias(currentSource, "electron");
  if (electronVar == null) {
    console.warn(
      "WARN: Could not find Electron alias - skipping Linux proxy authentication patch",
    );
    return currentSource;
  }

  const appLoginHelper =
    "function chatgptLinuxProxyAuthHost(e){return String(e??``).trim().replace(/^\\[|\\]$/g,``).toLowerCase()}" +
    "function chatgptLinuxProxyAuthEntry(e=process.env){if(process.platform!==`linux`)return null;let t=chatgptLinuxProxyAuthHost(e.CHATGPT_LINUX_PROXY_AUTH_HOST),n=String(e.CHATGPT_LINUX_PROXY_AUTH_PORT??``).trim(),r=e.CHATGPT_LINUX_PROXY_USERNAME;if(!t||r==null||String(r).length===0)return null;return{host:t,port:n,username:String(r),password:String(e.CHATGPT_LINUX_PROXY_PASSWORD??``)}}" +
    "function chatgptLinuxInstallProxyAuthHandler(e){let t=chatgptLinuxProxyAuthEntry();if(t==null)return;e.app.on(`login`,(n,r,i,a,o)=>{if(!a?.isProxy)return;let s=chatgptLinuxProxyAuthHost(a.host),l=String(a.port??``).trim();if(t.host!==s||t.port&&t.port!==l)return;n.preventDefault(),o(t.username,t.password)})}";
  const requestLoginHelper =
    "function chatgptLinuxAttachProxyAuthToRequest(e){let t=chatgptLinuxProxyAuthEntry();if(t==null||e==null)return;e.on(`login`,(n,r)=>{if(!n?.isProxy){r();return}let i=chatgptLinuxProxyAuthHost(n.host),a=String(n.port??``).trim();if(t.host!==i||t.port&&t.port!==a){r();return}r(t.username,t.password)})}";
  const installHandlerNeedle = "function chatgptLinuxInstallProxyAuthHandler(";
  let patchedSource = currentSource;

  if (!patchedSource.includes(installHandlerNeedle)) {
    const whenReadyNeedle = `await ${electronVar}.app.whenReady()`;
    if (!patchedSource.includes(whenReadyNeedle)) {
      if (patchedSource.includes(".app.whenReady()")) {
        console.warn(
          "WARN: Could not find Electron app ready point - skipping Linux proxy authentication patch",
        );
      }
      return patchedSource;
    }

    const strictDirective = '"use strict";';
    const helperInsertionIndex = patchedSource.startsWith(strictDirective)
      ? strictDirective.length
      : 0;
    patchedSource =
      patchedSource.slice(0, helperInsertionIndex) +
      appLoginHelper +
      requestLoginHelper +
      patchedSource.slice(helperInsertionIndex);

    patchedSource = patchedSource.replace(
      whenReadyNeedle,
      `chatgptLinuxInstallProxyAuthHandler(${electronVar});${whenReadyNeedle}`,
    );
  } else if (!patchedSource.includes("function chatgptLinuxAttachProxyAuthToRequest(")) {
    console.warn(
      "WARN: Found incomplete Linux proxy authentication helpers - skipping patch",
    );
    return patchedSource;
  }

  const fetchNeedle =
    `let f=i==null?await ${electronVar}.net.fetch(a,{method:r,headers:n,body:m(),signal:o,credentials:s?\`include\`:\`same-origin\`}):await this.performProgressRequest({body:m(),headers:n,method:r,onUploadProgress:i,resolvedUrl:a,signal:o,useSessionCookies:s});`;
  const fetchReplacement =
    `let f=i==null&&!chatgptLinuxProxyAuthEntry()?await ${electronVar}.net.fetch(a,{method:r,headers:n,body:m(),signal:o,credentials:s?\`include\`:\`same-origin\`}):await this.performProgressRequest({body:m(),headers:n,method:r,onUploadProgress:i,resolvedUrl:a,signal:o,useSessionCookies:s});`;
  if (patchedSource.includes(fetchNeedle)) {
    patchedSource = patchedSource.replace(fetchNeedle, fetchReplacement);
  } else if (
    patchedSource.includes("performDesktopFetch") &&
    !patchedSource.includes("!chatgptLinuxProxyAuthEntry()?await")
  ) {
    console.warn(
      "WARN: Could not route Linux proxy-auth desktop fetches through ClientRequest",
    );
  }

  const requestNeedle =
    `let u=${electronVar}.net.request({method:n,url:i,headers:t,useSessionCookies:o}),d=-1,f=()=>{let e=u.getUploadProgress();!e.started||e.current===d||(d=e.current,r({loaded:e.current,total:e.total}))}`;
  const requestReplacement =
    `let u=${electronVar}.net.request({method:n,url:i,headers:t,useSessionCookies:o});chatgptLinuxAttachProxyAuthToRequest(u);let d=-1,f=()=>{if(r==null)return;let e=u.getUploadProgress();!e.started||e.current===d||(d=e.current,r({loaded:e.current,total:e.total}))}`;
  if (patchedSource.includes(requestNeedle)) {
    patchedSource = patchedSource.replace(requestNeedle, requestReplacement);
  } else if (
    patchedSource.includes("performProgressRequest") &&
    !new RegExp(`chatgptLinuxAttachProxyAuthToRequest\\(${JS_IDENT}\\);`).test(patchedSource)
  ) {
    console.warn(
      "WARN: Could not attach Linux proxy authentication to ClientRequest fetch path",
    );
  }

  return patchedSource;
}

const descriptors = [
  {
    id: "main-process-proxy-auth",
    phase: "main-bundle",
    order: 125,
    ciPolicy: "optional",
    apply: applyAuthenticatedProxyPatch,
  },
];

module.exports = {
  applyAuthenticatedProxyPatch,
  descriptors,
};
