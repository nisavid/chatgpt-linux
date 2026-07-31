"use strict";

const fs = require("node:fs");
const path = require("node:path");

function requireName(source, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`([A-Za-z_$][\\w$]*)=require\\("${escaped}"\\)`));
  return match?.[1] ?? null;
}

const DEVICE_KEY_CLIENT_MARKER = "chatgptLinuxRemoteControlDeviceKeyClient";
const DEVICE_KEY_GUARD =
  "if(process.platform!==`darwin`)throw Error(`Remote control device keys are only available on macOS`);";
const DEVICE_KEY_GUARD_REPLACEMENT =
  "if(process.platform===`linux`)return chatgptLinuxRemoteControlDeviceKeyClient();if(process.platform!==`darwin`)throw Error(`Remote control device keys are only available on macOS`);";
const DEVICE_KEY_REQUIRE_NEEDLE =
  /(?:var|let|const)\s+[A-Za-z_$][\w$]*=\(0,[A-Za-z_$][\w$]*\.createRequire\)\(__filename\),[A-Za-z_$][\w$]*=`remote-control-device-key\.node`/u;
const REMOTE_CONTROL_SETTINGS_VISIBILITY_NEEDLE =
  /function ([A-Za-z_$][\w$]*)\(\{remoteControlConnectionsState:([A-Za-z_$][\w$]*),slingshotEnabled:([A-Za-z_$][\w$]*)\}\)\{return \3&&\(\2\?\.available\?\?!0\)(?:&&\2\?\.accessRequired!==!0)?\}/u;
const REMOTE_CONTROL_SETTINGS_UX_MARKER = "chatgptLinuxRemoteControlSettingsTabs";
const REMOTE_CONTROL_SETTINGS_TABS_HELPER =
  "function chatgptLinuxRemoteControlSettingsTabs(e){return e}";
const REMOTE_CONTROL_SSH_INSTALL_ACTION_MARKER = "chatgptLinuxRemoteControlSshInstallActions";
const REMOTE_CONTROL_SSH_INSTALL_RELEASE_MARKER = "chatgptLinuxRemoteControlSshInstallRelease";
const REMOTE_CONNECTIONS_REFRESH_MARKER = "chatgptLinuxRemoteConnectionsRefreshNow";
const REMOTE_MOBILE_CHROME_BRIDGE_MARKER = "chatgptLinuxRemoteMobileBrowserBackends";
const REMOTE_CONTROL_LOAD_GATE_MARKER = "chatgptLinuxRemoteControlLoadGateEnabled";
const REMOTE_CONTROL_FEATURE_SYNC_MARKER = "chatgptLinuxRemoteControlIntegrationSyncEnabled";
const REMOTE_CONTROL_LOAD_GATE_NEEDLE =
  /function ([A-Za-z_$][\w$]*)\(\)\{return ([A-Za-z_$][\w$]*)\(`1042620455`\)\}/u;
const REMOTE_MOBILE_THREAD_RUNTIME_MARKER = "chatgptLinuxRemoteMobileThreadRuntimeStatus";
const REMOTE_MOBILE_UNKNOWN_TURN_MARKER = "chatgptLinuxRemoteMobileHydrateUnknownTurn";
const REMOTE_MOBILE_NOTIFICATION_QUEUE_MARKER = "chatgptLinuxRemoteMobileNotificationQueue";
const REMOTE_MOBILE_IN_FLIGHT_HYDRATION_MARKER = "chatgptLinuxRemoteMobileHydrationInFlight";
const REMOTE_MOBILE_LATE_EVENT_HYDRATION_MARKER = "chatgptLinuxRemoteMobileHydrateLateEvent";
const REMOTE_MOBILE_REASONING_SUMMARY_MARKER = "chatgptLinuxRemoteMobileReasoningSummaryNone";
const REMOTE_MOBILE_COMPLETED_ITEM_MARKER = "chatgptLinuxCompletedItemExists=";
const REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER = "chatgptLinuxRemoteControlEnablementBridge";
const REMOTE_CONTROL_ENABLE_FOR_HOST_PARAMS_MARKER = "chatgptLinuxRemoteControlEnableForHostParams";
const REMOTE_CONTROL_AUTO_CONNECT_CLEANUP_MARKER = "chatgptLinuxRemoteControlAutoConnectCleanup";
const REMOTE_CONTROL_SELF_AUTO_CONNECT_MARKER = "chatgptLinuxRemoteControlSelfAutoConnect";
const REMOTE_MOBILE_ACTIVE_STATUS_MARKER = "chatgptLinuxRemoteMobileActiveStatus";
const REMOTE_CONTROL_STATUS_READ_GUARD_MARKER = "chatgptLinuxRemoteControlShouldReadStatus";
const REMOTE_CONTROL_STATUS_WAIT_MARKER = "chatgptLinuxRemoteControlStatusWaitMs";
const REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER = "chatgptLinuxRemoteControlResetMobileSetupAfterRevoke";
const REMOTE_CONTROL_VISIBILITY_MARKER = "chatgptLinuxRemoteControlVisibilityEnabled";
const REMOTE_CONTROL_COPY_MARKER = "chatgptLinuxRemoteControlCopy";
const REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER = "chatgptLinuxRemoteMobileAppServerArgs";
const REMOTE_MOBILE_APP_SERVER_ARGS_NEEDLE =
  "[`-c`,`features.code_mode_host=true`,`app-server`,`--analytics-default-enabled`]";
const REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN = /^app-initial-[^.]+\.js$/u;
const REMOTE_CONTROL_LINUX_COPY_REPLACEMENTS = [
  ["defaultMessage:`Mac`", "defaultMessage:`Linux`"],
  ["Keep this Mac awake", "Keep this Linux desktop awake"],
  ["Devices that can control this Mac", "Devices that can control this Linux desktop"],
  ["Control this Mac from your phone or other device", "Control this Linux desktop from your phone or other device"],
  ["Add device to control this Mac remotely", "Add device to control this Linux desktop remotely"],
  ["Control other devices from this Mac", "Control other devices from this Linux desktop"],
  ["Authorize this Mac to control other devices signed in to your ChatGPT account", "Authorize this Linux desktop to control other devices signed in to your ChatGPT account"],
  ["Allow this Mac to be discovered and controlled", "Allow this Linux desktop to be discovered and controlled"],
  ["Control this Mac", "Control this Linux desktop"],
  ["Devices you can control from this Mac", "Devices you can control from this Linux desktop"],
  ["SSH connections from this Mac", "SSH connections from this Linux desktop"],
  ["Use your Mac apps while locked", "Use your Linux apps while locked"],
  ["Control Mac apps from your phone", "Control Linux apps from your phone"],
  ["Let Codex control the apps on your Mac.", "Let Codex control apps on this Linux desktop."],
  ["Let Codex control the apps on your Mac", "Let Codex control apps on this Linux desktop"],
  ["Let ChatGPT control apps on your Mac", "Let ChatGPT control apps on this Linux desktop"],
  ["connected to ChatGPT on a Mac", "connected to ChatGPT on this Linux desktop"],
  ["Connect a device to this Mac", "Connect a device to this Linux desktop"],
  ["Connect your phone to this Mac", "Connect your phone to this Linux desktop"],
  ["Add device to control this Mac remotely", "Add a device to control this Linux desktop remotely"],
  ["Keep Mac awake", "Keep Linux desktop awake"],
  ["this Mac", "this Linux desktop"],
  ["local Mac", "local Linux desktop"],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOnce(source, needle, replacement) {
  if (!source.includes(needle)) {
    return null;
  }
  return source.replace(needle, replacement);
}

function linuxDeviceKeyProviderSource({ childProcessVar, cryptoVar, fsVar, pathVar }) {
  return [
    "const chatgptLinuxRemoteControlKeyStoreVersion=2,chatgptLinuxRemoteControlKeyStoreMaxBytes=1048576,chatgptLinuxRemoteControlKeyStoreMaxKeys=64;",
    "function chatgptLinuxRemoteControlAssertOwnedRegularStat(e){if(!e.isFile())throw Error(`Linux remote control key state must be a regular file`);if(typeof process.getuid==`function`&&e.uid!==process.getuid())throw Error(`Linux remote control key state is owned by another user`);if((e.mode&511)!==384)throw Error(`Linux remote control key state permissions must be 0600`);return e}",
    "function chatgptLinuxRemoteControlAssertOwnedRegularFile(e,t){let n=t.lstatSync(e);if(n.isSymbolicLink())throw Error(`Linux remote control key state must be a regular file`);return chatgptLinuxRemoteControlAssertOwnedRegularStat(n)}",
    "function chatgptLinuxRemoteControlDeviceKeyStorePath(){",
    `let chatgptLinuxRemoteControlConfigRoot=process.env.XDG_CONFIG_HOME&&process.env.XDG_CONFIG_HOME.trim()?process.env.XDG_CONFIG_HOME.trim():process.env.HOME?${pathVar}.join(process.env.HOME,\`.config\`):null;`,
    "if(chatgptLinuxRemoteControlConfigRoot==null)throw Error(`Linux remote control device keys require HOME or XDG_CONFIG_HOME`);",
    `if(!${pathVar}.isAbsolute(chatgptLinuxRemoteControlConfigRoot))throw Error(\`Linux remote control device key config root must be absolute\`);`,
    `let chatgptLinuxRemoteControlSharedConfigDirectory=${pathVar}.join(chatgptLinuxRemoteControlConfigRoot,\`chatgpt\`);${fsVar}.mkdirSync(chatgptLinuxRemoteControlSharedConfigDirectory,{recursive:!0});`,
    `let chatgptLinuxRemoteControlSharedConfigDirectoryStat=${fsVar}.lstatSync(chatgptLinuxRemoteControlSharedConfigDirectory);if(chatgptLinuxRemoteControlSharedConfigDirectoryStat.isSymbolicLink()||!chatgptLinuxRemoteControlSharedConfigDirectoryStat.isDirectory())throw Error(\`Linux remote control shared config path must be a regular directory\`);`,
    "if(typeof process.getuid==`function`&&chatgptLinuxRemoteControlSharedConfigDirectoryStat.uid!==process.getuid())throw Error(`Linux remote control shared config directory is owned by another user`);",
    `let chatgptLinuxRemoteControlKeyStoreDirectory=${pathVar}.join(chatgptLinuxRemoteControlSharedConfigDirectory,\`remote-control-device-keys\`);${fsVar}.mkdirSync(chatgptLinuxRemoteControlKeyStoreDirectory,{recursive:!0,mode:448});`,
    `let chatgptLinuxRemoteControlKeyStoreDirectoryStat=${fsVar}.lstatSync(chatgptLinuxRemoteControlKeyStoreDirectory);if(chatgptLinuxRemoteControlKeyStoreDirectoryStat.isSymbolicLink()||!chatgptLinuxRemoteControlKeyStoreDirectoryStat.isDirectory())throw Error(\`Linux remote control device key directory must be a regular directory\`);`,
    "if(typeof process.getuid==`function`&&chatgptLinuxRemoteControlKeyStoreDirectoryStat.uid!==process.getuid())throw Error(`Linux remote control device key directory is owned by another user`);",
    "if((chatgptLinuxRemoteControlKeyStoreDirectoryStat.mode&511)!==448)throw Error(`Linux remote control device key directory permissions must be 0700`);",
    `let chatgptLinuxRemoteControlKeyStorePath=${pathVar}.join(chatgptLinuxRemoteControlKeyStoreDirectory,\`remote-control-device-keys-v1.json\`),chatgptLinuxRemoteControlLegacyKeyStorePath=${pathVar}.join(chatgptLinuxRemoteControlSharedConfigDirectory,\`remote-control-device-keys-v1.json\`);`,
    `if(!${fsVar}.existsSync(chatgptLinuxRemoteControlKeyStorePath)&&${fsVar}.existsSync(chatgptLinuxRemoteControlLegacyKeyStorePath)){let chatgptLinuxRemoteControlLegacyKeyStoreStat=chatgptLinuxRemoteControlAssertOwnedRegularFile(chatgptLinuxRemoteControlLegacyKeyStorePath,${fsVar});if(chatgptLinuxRemoteControlLegacyKeyStoreStat.size>chatgptLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);${fsVar}.renameSync(chatgptLinuxRemoteControlLegacyKeyStorePath,chatgptLinuxRemoteControlKeyStorePath)}`,
    "return chatgptLinuxRemoteControlKeyStorePath",
    "}",
    "function chatgptLinuxRemoteControlValidateDeviceKeyRecord(e,t){if(e==null||typeof e!=`object`||Array.isArray(e))throw Error(`Linux remote control device key record is invalid`);let n=[[e.keyId,128],[e.publicKeySpkiDerBase64,8192],[e.createdAt,64]],r=typeof e.privateKeyPkcs8Pem==`string`&&e.privateKeyPkcs8Pem.length>0&&e.privateKeyPkcs8Pem.length<=16384,i=typeof e.privateKeyCiphertextBase64==`string`&&e.privateKeyCiphertextBase64.length>0&&e.privateKeyCiphertextBase64.length<=32768,a=e.storageBackend==null||typeof e.storageBackend==`string`&&e.storageBackend.length>0&&e.storageBackend.length<=64,o=e.detectedBackend==null||typeof e.detectedBackend==`string`&&e.detectedBackend.length>0&&e.detectedBackend.length<=64;if(n.some(([e,t])=>typeof e!=`string`||e.length===0||e.length>t)||(!r&&!i)||r&&i||!a||!o||e.keyId!==t||e.algorithm!==`ecdsa_p256_sha256`||e.protectionClass!==`os_protected_nonextractable`||!Number.isFinite(Date.parse(e.createdAt)))throw Error(`Linux remote control device key record is invalid`)}",
    "function chatgptLinuxRemoteControlValidateDeviceKeyStore(e){if(e==null||typeof e!=`object`||Array.isArray(e)||e.version!==chatgptLinuxRemoteControlKeyStoreVersion||e.keys==null||typeof e.keys!=`object`||Array.isArray(e.keys))throw Error(`Linux remote control device key store schema is invalid`);let t=Object.entries(e.keys);if(t.length>chatgptLinuxRemoteControlKeyStoreMaxKeys)throw Error(`Linux remote control device key store exceeds key limit`);for(let[n,r]of t)chatgptLinuxRemoteControlValidateDeviceKeyRecord(r,n);return e}",
    "function chatgptLinuxRemoteControlPublicDeviceKey(chatgptLinuxRemoteControlKeyRecord){",
    "return{algorithm:chatgptLinuxRemoteControlKeyRecord.algorithm,keyId:chatgptLinuxRemoteControlKeyRecord.keyId,protectionClass:chatgptLinuxRemoteControlKeyRecord.protectionClass,publicKeySpkiDerBase64:chatgptLinuxRemoteControlKeyRecord.publicKeySpkiDerBase64}",
    "}",
    "function chatgptLinuxRemoteControlStorage(){",
    "let chatgptLinuxRemoteControlSafeStorage=null,chatgptLinuxRemoteControlDetectedBackend=`unavailable`;",
    "try{let chatgptLinuxRemoteControlElectron=require(`electron`),chatgptLinuxRemoteControlCandidate=chatgptLinuxRemoteControlElectron?.safeStorage;if(chatgptLinuxRemoteControlCandidate!=null){chatgptLinuxRemoteControlDetectedBackend=typeof chatgptLinuxRemoteControlCandidate.getSelectedStorageBackend===`function`?chatgptLinuxRemoteControlCandidate.getSelectedStorageBackend():`unknown`;if(chatgptLinuxRemoteControlDetectedBackend!==`unknown`&&chatgptLinuxRemoteControlDetectedBackend!==`basic_text`&&(typeof chatgptLinuxRemoteControlCandidate.isEncryptionAvailable!==`function`||chatgptLinuxRemoteControlCandidate.isEncryptionAvailable()))chatgptLinuxRemoteControlSafeStorage=chatgptLinuxRemoteControlCandidate}}catch{}",
    "return{safeStorage:chatgptLinuxRemoteControlSafeStorage,detectedBackend:chatgptLinuxRemoteControlDetectedBackend}",
    "}",
    "function chatgptLinuxRemoteControlStorageFields(chatgptLinuxRemoteControlPrivateKeyPem){",
    "let chatgptLinuxRemoteControlStorageState=chatgptLinuxRemoteControlStorage();",
    "if(chatgptLinuxRemoteControlStorageState.safeStorage==null){console.warn(`WARN: Linux remote control keychain unavailable; storing device key with file permissions 0600 (detected backend: ${chatgptLinuxRemoteControlStorageState.detectedBackend})`);return{privateKeyPkcs8Pem:chatgptLinuxRemoteControlPrivateKeyPem,storageBackend:`file_0600`,detectedBackend:chatgptLinuxRemoteControlStorageState.detectedBackend}}",
    "return{privateKeyCiphertextBase64:chatgptLinuxRemoteControlStorageState.safeStorage.encryptString(chatgptLinuxRemoteControlPrivateKeyPem).toString(`base64`),storageBackend:chatgptLinuxRemoteControlStorageState.detectedBackend,detectedBackend:chatgptLinuxRemoteControlStorageState.detectedBackend}",
    "}",
    "function chatgptLinuxRemoteControlPrivateKeyPem(chatgptLinuxRemoteControlKeyRecord){",
    "if(typeof chatgptLinuxRemoteControlKeyRecord.privateKeyPkcs8Pem===`string`)return chatgptLinuxRemoteControlKeyRecord.privateKeyPkcs8Pem;",
    "if(typeof chatgptLinuxRemoteControlKeyRecord.privateKeyCiphertextBase64!==`string`)throw Error(`Linux remote control device key has no private key material`);",
    "let chatgptLinuxRemoteControlStorageState=chatgptLinuxRemoteControlStorage();if(chatgptLinuxRemoteControlStorageState.safeStorage==null)throw Error(`Linux remote control device keychain is unavailable`);",
    "try{return chatgptLinuxRemoteControlStorageState.safeStorage.decryptString(Buffer.from(chatgptLinuxRemoteControlKeyRecord.privateKeyCiphertextBase64,`base64`))}catch(chatgptLinuxRemoteControlDecryptError){throw Error(`Failed to decrypt Linux remote control device key`)}",
    "}",
    "function chatgptLinuxReadRemoteControlDeviceKeyStore(){",
    "let chatgptLinuxRemoteControlKeyStorePath=chatgptLinuxRemoteControlDeviceKeyStorePath();",
    `if(!${fsVar}.existsSync(chatgptLinuxRemoteControlKeyStorePath))return{version:chatgptLinuxRemoteControlKeyStoreVersion,keys:{}};`,
    `let chatgptLinuxRemoteControlKeyStoreStat=chatgptLinuxRemoteControlAssertOwnedRegularFile(chatgptLinuxRemoteControlKeyStorePath,${fsVar});if(chatgptLinuxRemoteControlKeyStoreStat.size>chatgptLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);`,
    `let chatgptLinuxRemoteControlKeyStoreFd=${fsVar}.openSync(chatgptLinuxRemoteControlKeyStorePath,${fsVar}.constants.O_RDONLY|${fsVar}.constants.O_NOFOLLOW),chatgptLinuxRemoteControlKeyStoreText;try{chatgptLinuxRemoteControlKeyStoreStat=chatgptLinuxRemoteControlAssertOwnedRegularStat(${fsVar}.fstatSync(chatgptLinuxRemoteControlKeyStoreFd));if(chatgptLinuxRemoteControlKeyStoreStat.size>chatgptLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);let chatgptLinuxRemoteControlKeyStoreBuffer=Buffer.alloc(chatgptLinuxRemoteControlKeyStoreStat.size),chatgptLinuxRemoteControlKeyStoreOffset=0,chatgptLinuxRemoteControlKeyStoreBytesRead;while(chatgptLinuxRemoteControlKeyStoreOffset<chatgptLinuxRemoteControlKeyStoreBuffer.length&&(chatgptLinuxRemoteControlKeyStoreBytesRead=${fsVar}.readSync(chatgptLinuxRemoteControlKeyStoreFd,chatgptLinuxRemoteControlKeyStoreBuffer,chatgptLinuxRemoteControlKeyStoreOffset,chatgptLinuxRemoteControlKeyStoreBuffer.length-chatgptLinuxRemoteControlKeyStoreOffset,chatgptLinuxRemoteControlKeyStoreOffset))>0)chatgptLinuxRemoteControlKeyStoreOffset+=chatgptLinuxRemoteControlKeyStoreBytesRead;chatgptLinuxRemoteControlKeyStoreText=chatgptLinuxRemoteControlKeyStoreBuffer.subarray(0,chatgptLinuxRemoteControlKeyStoreOffset).toString(\`utf8\`)}finally{${fsVar}.closeSync(chatgptLinuxRemoteControlKeyStoreFd)}`,
    "let chatgptLinuxRemoteControlKeyStore;try{chatgptLinuxRemoteControlKeyStore=JSON.parse(chatgptLinuxRemoteControlKeyStoreText)}catch{throw Error(`Linux remote control device key store contains invalid JSON`)}",
    "if(chatgptLinuxRemoteControlKeyStore&&(chatgptLinuxRemoteControlKeyStore.version==null||chatgptLinuxRemoteControlKeyStore.version===1))chatgptLinuxRemoteControlKeyStore={version:chatgptLinuxRemoteControlKeyStoreVersion,keys:chatgptLinuxRemoteControlKeyStore.keys};return chatgptLinuxRemoteControlValidateDeviceKeyStore(chatgptLinuxRemoteControlKeyStore)",
    "}",
    "function chatgptLinuxRemoteControlMigrateDeviceKeyStore(e){let t=chatgptLinuxRemoteControlStorage();if(t.safeStorage==null)return null;let n={version:chatgptLinuxRemoteControlKeyStoreVersion,keys:{...e.keys}},r=!1;for(let [e,i] of Object.entries(n.keys))if(typeof i.privateKeyPkcs8Pem===`string`)try{let a=chatgptLinuxRemoteControlStorageFields(i.privateKeyPkcs8Pem);n.keys[e]={...i,...a};delete n.keys[e].privateKeyPkcs8Pem;r=!0}catch{console.warn(`WARN: Could not migrate Linux remote control device key to safeStorage; retaining legacy file-backed key`)}return r?n:null}",
    `function chatgptLinuxRemoteControlOpenKeyStoreLock(){let e=chatgptLinuxRemoteControlDeviceKeyStorePath()+\`.lock\`,t,n=!1;try{try{t=${fsVar}.openSync(e,${fsVar}.constants.O_RDWR|${fsVar}.constants.O_CREAT|${fsVar}.constants.O_EXCL|${fsVar}.constants.O_NOFOLLOW,384),n=!0}catch(r){if(r?.code!==\`EEXIST\`)throw r;t=${fsVar}.openSync(e,${fsVar}.constants.O_RDWR|${fsVar}.constants.O_NOFOLLOW)}n&&${fsVar}.fchmodSync(t,384),chatgptLinuxRemoteControlAssertOwnedRegularStat(${fsVar}.fstatSync(t));return t}catch(r){try{t!=null&&${fsVar}.closeSync(t)}catch{}throw r}}`,
    `function chatgptLinuxRemoteControlResolveExecutable(chatgptLinuxRemoteControlExecutableName){let chatgptLinuxRemoteControlSearchDirectories=[...(process.env.PATH??\`\`).split(${pathVar}.delimiter),\`/run/current-system/sw/bin\`,\`/nix/var/nix/profiles/default/bin\`,\`/usr/local/bin\`,\`/usr/bin\`,\`/bin\`],chatgptLinuxRemoteControlSeenDirectories=new Set;for(let chatgptLinuxRemoteControlDirectory of chatgptLinuxRemoteControlSearchDirectories){if(!chatgptLinuxRemoteControlDirectory||!${pathVar}.isAbsolute(chatgptLinuxRemoteControlDirectory)||chatgptLinuxRemoteControlSeenDirectories.has(chatgptLinuxRemoteControlDirectory))continue;chatgptLinuxRemoteControlSeenDirectories.add(chatgptLinuxRemoteControlDirectory);try{let chatgptLinuxRemoteControlExecutablePath=${fsVar}.realpathSync(${pathVar}.join(chatgptLinuxRemoteControlDirectory,chatgptLinuxRemoteControlExecutableName)),chatgptLinuxRemoteControlExecutableStat=${fsVar}.statSync(chatgptLinuxRemoteControlExecutablePath);if(!chatgptLinuxRemoteControlExecutableStat.isFile())continue;${fsVar}.accessSync(chatgptLinuxRemoteControlExecutablePath,${fsVar}.constants.X_OK);return chatgptLinuxRemoteControlExecutablePath}catch{}}return null}`,
    `function chatgptLinuxWithRemoteControlKeyStoreLock(chatgptLinuxRemoteControlLockedOperation){let chatgptLinuxRemoteControlLockFd=chatgptLinuxRemoteControlOpenKeyStoreLock(),chatgptLinuxRemoteControlFlockPath=chatgptLinuxRemoteControlResolveExecutable(\`flock\`),chatgptLinuxRemoteControlShellPath=chatgptLinuxRemoteControlResolveExecutable(\`sh\`);if(chatgptLinuxRemoteControlFlockPath==null||chatgptLinuxRemoteControlShellPath==null){${fsVar}.closeSync(chatgptLinuxRemoteControlLockFd);throw Error(\`Linux remote control device key store requires flock and sh\`)}return new Promise((chatgptLinuxRemoteControlResolve,chatgptLinuxRemoteControlReject)=>{let chatgptLinuxRemoteControlLockProcess;try{chatgptLinuxRemoteControlLockProcess=${childProcessVar}.spawn(chatgptLinuxRemoteControlFlockPath,[\`-x\`,\`-w\`,\`5\`,\`/proc/self/fd/3\`,chatgptLinuxRemoteControlShellPath,\`-c\`,\`printf 'ready\\n'; cat >/dev/null\`],{stdio:[\`pipe\`,\`pipe\`,\`pipe\`,chatgptLinuxRemoteControlLockFd]})}finally{${fsVar}.closeSync(chatgptLinuxRemoteControlLockFd)}let chatgptLinuxRemoteControlStdout=\`\`,chatgptLinuxRemoteControlStderr=\`\`,chatgptLinuxRemoteControlResult,chatgptLinuxRemoteControlReady=!1,chatgptLinuxRemoteControlOperationDone=!1,chatgptLinuxRemoteControlProcessDone=!1,chatgptLinuxRemoteControlExitCode=null,chatgptLinuxRemoteControlFailure=null,chatgptLinuxRemoteControlTimer=setTimeout(()=>{chatgptLinuxRemoteControlReady||(chatgptLinuxRemoteControlFailure=Error(\`Timed out waiting for Linux remote control device key store lock\`),chatgptLinuxRemoteControlOperationDone=!0,chatgptLinuxRemoteControlLockProcess.kill())},5500),chatgptLinuxRemoteControlSettle=()=>{if(!chatgptLinuxRemoteControlOperationDone||!chatgptLinuxRemoteControlProcessDone)return;chatgptLinuxRemoteControlFailure?chatgptLinuxRemoteControlReject(chatgptLinuxRemoteControlFailure):chatgptLinuxRemoteControlExitCode===0?chatgptLinuxRemoteControlResolve(chatgptLinuxRemoteControlResult):chatgptLinuxRemoteControlReject(Error(\`Linux remote control device key store lock failed\`))};chatgptLinuxRemoteControlLockProcess.stderr.on(\`data\`,chatgptLinuxRemoteControlChunk=>{chatgptLinuxRemoteControlStderr=(chatgptLinuxRemoteControlStderr+String(chatgptLinuxRemoteControlChunk)).slice(-4096)}),chatgptLinuxRemoteControlLockProcess.on(\`error\`,chatgptLinuxRemoteControlError=>{clearTimeout(chatgptLinuxRemoteControlTimer),chatgptLinuxRemoteControlFailure=chatgptLinuxRemoteControlError,chatgptLinuxRemoteControlOperationDone=!0,chatgptLinuxRemoteControlProcessDone=!0,chatgptLinuxRemoteControlSettle()}),chatgptLinuxRemoteControlLockProcess.on(\`close\`,chatgptLinuxRemoteControlCode=>{clearTimeout(chatgptLinuxRemoteControlTimer),chatgptLinuxRemoteControlExitCode=chatgptLinuxRemoteControlCode,chatgptLinuxRemoteControlProcessDone=!0,chatgptLinuxRemoteControlReady||(chatgptLinuxRemoteControlFailure=Error(chatgptLinuxRemoteControlStderr.trim()||\`Timed out waiting for Linux remote control device key store lock\`),chatgptLinuxRemoteControlOperationDone=!0),chatgptLinuxRemoteControlSettle()}),chatgptLinuxRemoteControlLockProcess.stdout.on(\`data\`,chatgptLinuxRemoteControlChunk=>{if(chatgptLinuxRemoteControlReady)return;chatgptLinuxRemoteControlStdout+=String(chatgptLinuxRemoteControlChunk);if(!chatgptLinuxRemoteControlStdout.includes(\`ready\\n\`))return;chatgptLinuxRemoteControlReady=!0,clearTimeout(chatgptLinuxRemoteControlTimer),Promise.resolve().then(chatgptLinuxRemoteControlLockedOperation).then(chatgptLinuxRemoteControlValue=>{chatgptLinuxRemoteControlResult=chatgptLinuxRemoteControlValue,chatgptLinuxRemoteControlOperationDone=!0,chatgptLinuxRemoteControlLockProcess.stdin.end(),chatgptLinuxRemoteControlSettle()},chatgptLinuxRemoteControlError=>{chatgptLinuxRemoteControlFailure=chatgptLinuxRemoteControlError,chatgptLinuxRemoteControlOperationDone=!0,chatgptLinuxRemoteControlLockProcess.stdin.end(),chatgptLinuxRemoteControlSettle()})})})}`,
    "function chatgptLinuxWriteRemoteControlDeviceKeyStore(chatgptLinuxRemoteControlKeyStore){",
    `chatgptLinuxRemoteControlValidateDeviceKeyStore(chatgptLinuxRemoteControlKeyStore);let chatgptLinuxRemoteControlKeyStorePath=chatgptLinuxRemoteControlDeviceKeyStorePath(),chatgptLinuxRemoteControlKeyStoreDirectory=${pathVar}.dirname(chatgptLinuxRemoteControlKeyStorePath),chatgptLinuxRemoteControlTempPath=chatgptLinuxRemoteControlKeyStorePath+\`.tmp-\`+${cryptoVar}.randomUUID(),chatgptLinuxRemoteControlKeyStoreText=JSON.stringify(chatgptLinuxRemoteControlKeyStore,null,2)+\`\\n\`,chatgptLinuxRemoteControlTempFd=null,chatgptLinuxRemoteControlDirectoryFd=null,chatgptLinuxRemoteControlTempCreated=!1;if(Buffer.byteLength(chatgptLinuxRemoteControlKeyStoreText,\`utf8\`)>chatgptLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);`,
    `try{chatgptLinuxRemoteControlTempFd=${fsVar}.openSync(chatgptLinuxRemoteControlTempPath,${fsVar}.constants.O_WRONLY|${fsVar}.constants.O_CREAT|${fsVar}.constants.O_EXCL|${fsVar}.constants.O_NOFOLLOW,384),chatgptLinuxRemoteControlTempCreated=!0,${fsVar}.writeFileSync(chatgptLinuxRemoteControlTempFd,chatgptLinuxRemoteControlKeyStoreText,\`utf8\`),${fsVar}.fsyncSync(chatgptLinuxRemoteControlTempFd),${fsVar}.closeSync(chatgptLinuxRemoteControlTempFd),chatgptLinuxRemoteControlTempFd=null;${fsVar}.existsSync(chatgptLinuxRemoteControlKeyStorePath)&&chatgptLinuxRemoteControlAssertOwnedRegularFile(chatgptLinuxRemoteControlKeyStorePath,${fsVar});${fsVar}.renameSync(chatgptLinuxRemoteControlTempPath,chatgptLinuxRemoteControlKeyStorePath),chatgptLinuxRemoteControlTempCreated=!1;try{chatgptLinuxRemoteControlDirectoryFd=${fsVar}.openSync(chatgptLinuxRemoteControlKeyStoreDirectory,${fsVar}.constants.O_RDONLY),${fsVar}.fsyncSync(chatgptLinuxRemoteControlDirectoryFd),${fsVar}.closeSync(chatgptLinuxRemoteControlDirectoryFd),chatgptLinuxRemoteControlDirectoryFd=null}catch(chatgptLinuxRemoteControlDirectorySyncError){try{chatgptLinuxRemoteControlDirectoryFd!=null&&${fsVar}.closeSync(chatgptLinuxRemoteControlDirectoryFd)}catch{}chatgptLinuxRemoteControlDirectoryFd=null;console.warn(\`WARN: Linux remote control device-key store rename committed but directory fsync failed; crash durability is not confirmed\`)}}catch(chatgptLinuxRemoteControlWriteError){try{chatgptLinuxRemoteControlTempFd!=null&&${fsVar}.closeSync(chatgptLinuxRemoteControlTempFd)}catch{}try{chatgptLinuxRemoteControlDirectoryFd!=null&&${fsVar}.closeSync(chatgptLinuxRemoteControlDirectoryFd)}catch{}try{chatgptLinuxRemoteControlTempCreated&&${fsVar}.rmSync(chatgptLinuxRemoteControlTempPath,{force:!0})}catch{}throw chatgptLinuxRemoteControlWriteError}`,
    "}",
    "function chatgptLinuxRemoteControlDeviceKeyClient(){return{",
    "createDeviceKey:async chatgptLinuxRemoteControlProtectionClass=>{",
    `let chatgptLinuxRemoteControlKeyPair=(0,${cryptoVar}.generateKeyPairSync)(\`ec\`,{namedCurve:\`P-256\`}),chatgptLinuxRemoteControlPublicKey=chatgptLinuxRemoteControlKeyPair.publicKey,chatgptLinuxRemoteControlSigningKey=chatgptLinuxRemoteControlKeyPair[\`private\`+\`Key\`];`,
    `let chatgptLinuxRemoteControlKeyId=(0,${cryptoVar}.randomUUID)(),chatgptLinuxRemoteControlPublicKeySpkiDerBase64=chatgptLinuxRemoteControlPublicKey.export({type:\`spki\`,format:\`der\`}).toString(\`base64\`),chatgptLinuxRemoteControlSigningKeyPkcs8Pem=chatgptLinuxRemoteControlSigningKey.export({type:\`pkcs8\`,format:\`pem\`});`,
    "let chatgptLinuxRemoteControlKeyRecord={algorithm:`ecdsa_p256_sha256`,keyId:chatgptLinuxRemoteControlKeyId,protectionClass:`os_protected_nonextractable`,publicKeySpkiDerBase64:chatgptLinuxRemoteControlPublicKeySpkiDerBase64,...chatgptLinuxRemoteControlStorageFields(chatgptLinuxRemoteControlSigningKeyPkcs8Pem),createdAt:new Date().toISOString()};",
    "await chatgptLinuxWithRemoteControlKeyStoreLock(()=>{let e=chatgptLinuxReadRemoteControlDeviceKeyStore(),t=chatgptLinuxRemoteControlMigrateDeviceKeyStore(e)??e;t.version=chatgptLinuxRemoteControlKeyStoreVersion,t.keys={...t.keys,[chatgptLinuxRemoteControlKeyId]:chatgptLinuxRemoteControlKeyRecord},chatgptLinuxWriteRemoteControlDeviceKeyStore(t)});",
    "return chatgptLinuxRemoteControlPublicDeviceKey(chatgptLinuxRemoteControlKeyRecord)",
    "},",
    "deleteDeviceKey:async chatgptLinuxRemoteControlKeyId=>chatgptLinuxWithRemoteControlKeyStoreLock(()=>{let e=chatgptLinuxReadRemoteControlDeviceKeyStore(),t=chatgptLinuxRemoteControlMigrateDeviceKeyStore(e)??e;delete t.keys[chatgptLinuxRemoteControlKeyId],chatgptLinuxWriteRemoteControlDeviceKeyStore(t)}),",
    "getDeviceKeyPublic:async chatgptLinuxRemoteControlKeyId=>chatgptLinuxWithRemoteControlKeyStoreLock(()=>{let e=chatgptLinuxReadRemoteControlDeviceKeyStore(),t=chatgptLinuxRemoteControlMigrateDeviceKeyStore(e)??e;t!==e&&chatgptLinuxWriteRemoteControlDeviceKeyStore(t);let n=t.keys?.[chatgptLinuxRemoteControlKeyId];if(n==null)throw Error(`Linux remote control device key not found`);return chatgptLinuxRemoteControlPublicDeviceKey(n)}),",
    `signDeviceKey:async(chatgptLinuxRemoteControlKeyId,chatgptLinuxRemoteControlPayload)=>chatgptLinuxWithRemoteControlKeyStoreLock(()=>{let e=chatgptLinuxReadRemoteControlDeviceKeyStore(),t=chatgptLinuxRemoteControlMigrateDeviceKeyStore(e)??e;t!==e&&chatgptLinuxWriteRemoteControlDeviceKeyStore(t);let n=t.keys?.[chatgptLinuxRemoteControlKeyId];if(n==null)throw Error(\`Linux remote control device key not found\`);let r=(0,${cryptoVar}.createPrivateKey)(chatgptLinuxRemoteControlPrivateKeyPem(n)),i=(0,${cryptoVar}.sign)(\`sha256\`,chatgptLinuxRemoteControlPayload,r).toString(\`base64\`);return{algorithm:n.algorithm,signatureDerBase64:i}})`,
    "}}",
  ].join("");
}

function applyLinuxRemoteControlDeviceKeyPatch(source) {
  if (source.includes(DEVICE_KEY_CLIENT_MARKER)) {
    return source;
  }

  const cryptoVar = requireName(source, "node:crypto");
  const fsVar = requireName(source, "node:fs");
  const pathVar = requireName(source, "node:path");
  const childProcessVar = "require(`node:child_process`)";
  if (cryptoVar == null || fsVar == null || pathVar == null) {
    console.warn("WARN: Could not find Node module aliases - skipping Linux remote-control device-key patch");
    return source;
  }

  const insertionNeedle = source.match(DEVICE_KEY_REQUIRE_NEEDLE)?.[0] ?? null;
  if (insertionNeedle == null || !source.includes(DEVICE_KEY_GUARD)) {
    console.warn("WARN: Could not find remote-control device-key bundle needles - skipping Linux remote-control device-key patch");
    return source;
  }

  const provider = linuxDeviceKeyProviderSource({ childProcessVar, cryptoVar, fsVar, pathVar });
  return source
    .replace(insertionNeedle, `${provider}${insertionNeedle}`)
    .replace(DEVICE_KEY_GUARD, DEVICE_KEY_GUARD_REPLACEMENT);
}

function applyLinuxRemoteControlClientRevocationRecoveryPatch(source) {
  if (
    source.includes("e.message===`Remote-control client key material missing`") &&
    source.includes("e.message===`Remote-control client has been revoked`")
  ) {
    return source;
  }

  const recoverableErrorNeedle =
    /e\.message===`Remote control request failed \(403\): Remote-control client key material missing`(?:\|\|e\.message===`Remote-control client key material missing`)?(?:\|\|e\.message===`Remote-control client has been revoked`)?:!1/u;
  if (!recoverableErrorNeedle.test(source)) {
    if (!source.includes("Remote-control client key material missing")) {
      return source;
    }
    console.warn("WARN: Could not find remote-control recoverable error predicate - skipping revoked-client recovery patch");
    return source;
  }

  return source.replace(
    recoverableErrorNeedle,
    "e.message===`Remote control request failed (403): Remote-control client key material missing`||e.message===`Remote-control client key material missing`||e.message===`Remote-control client has been revoked`:!1",
  );
}

function applyLinuxRemoteMobileAppServerRemoteControlPatch(source) {
  if (source.includes(REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER)) {
    return source;
  }
  if (!source.includes(REMOTE_MOBILE_APP_SERVER_ARGS_NEEDLE)) {
    return source;
  }

  const helper =
    "function chatgptLinuxRemoteMobileAppServerArgs(){return process.platform===`linux`?[`-c`,`features.code_mode_host=true`,`app-server`,`--remote-control`,`--analytics-default-enabled`]:[`-c`,`features.code_mode_host=true`,`app-server`,`--analytics-default-enabled`]}";
  const replaced = source
    .split(REMOTE_MOBILE_APP_SERVER_ARGS_NEEDLE)
    .join("chatgptLinuxRemoteMobileAppServerArgs()");
  // Insert after a leading "use strict" so prepending the helper does not
  // demote the directive to a plain expression and de-strict the bundle.
  const insertAt = replaced.startsWith('"use strict";')
    ? '"use strict";'.length
    : replaced.startsWith("'use strict';")
      ? "'use strict';".length
      : 0;
  return `${replaced.slice(0, insertAt)}${helper}${replaced.slice(insertAt)}`;
}

function applyLinuxRemoteMobileAppServerRemoteControlExtractedAppPatch(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    const reason = `missing build directory ${buildDir}`;
    console.warn(`WARN: Could not find app-server launch bundle - skipping remote mobile app-server remote-control patch`);
    return { matched: 0, changed: 0, reason };
  }

  const candidates = fs
    .readdirSync(buildDir)
    .filter((name) => /\.m?js$/u.test(name))
    .sort();

  let matched = 0;
  let changed = 0;
  for (const candidate of candidates) {
    const filePath = path.join(buildDir, candidate);
    const source = fs.readFileSync(filePath, "utf8");
    if (
      !source.includes(REMOTE_MOBILE_APP_SERVER_ARGS_NEEDLE) &&
      !source.includes(REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER)
    ) {
      continue;
    }
    matched += 1;
    const patched = applyLinuxRemoteMobileAppServerRemoteControlPatch(source);
    if (patched !== source) {
      fs.writeFileSync(filePath, patched, "utf8");
      changed += 1;
    }
  }

  if (matched === 0) {
    const reason = "no default app-server launch args found";
    console.warn("WARN: Could not find default app-server launch args - skipping remote mobile app-server remote-control patch");
    return { matched, changed, reason };
  }
  return { matched, changed };
}

function applyLinuxRemoteControlClientRevokeSetupResetPatch(source) {
  if (source.includes(REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER)) {
    return source;
  }
  if (!source.includes("remote-control-client-revoke-success")) {
    return source;
  }

  const currentStateKeysMatch = source.match(/([A-Za-z_$][\w$]*)\.CODEX_MOBILE_SETUP_COMPLETED/u);
  const currentStateSetterMatch = source.match(
    /([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.keepRemoteControlAwakeWhilePluggedIn,/u,
  );
  const currentStateKeysVar = currentStateKeysMatch?.[1] ?? null;
  const currentStateSetterVar = currentStateSetterMatch?.[1] ?? null;
  const currentRevokePattern =
    /onRevoked:([A-Za-z_$][\w$]*)=>\{([A-Za-z_$][\w$]*)\.setData\(([A-Za-z_$][\w$]*)=>\3\?\.filter\(\3=>\3\.clientId!==\1\)\),\2\.invalidate\(\)\},onRevokeResult:([A-Za-z_$][\w$]*)=>\{([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),\{result:\4\}\)\}/u;
  const currentRevokeMatch = source.match(currentRevokePattern);
  if (currentStateKeysVar != null && currentStateSetterVar != null && currentRevokeMatch != null) {
    const ownerFunctionStart = source.lastIndexOf("function ", currentRevokeMatch.index);
    if (
      ownerFunctionStart < 0 ||
      !/^function [A-Za-z_$][\w$]*\(/u.test(source.slice(ownerFunctionStart, ownerFunctionStart + 128))
    ) {
      console.warn("WARN: Could not find remote-control revoke helper insertion point - skipping setup reset patch");
      return source;
    }
    const ownerPrefix = source.slice(ownerFunctionStart, currentRevokeMatch.index);
    const localClientIdMatch = ownerPrefix.match(
      /\[([A-Za-z_$][\w$]*)\]=[A-Za-z_$][\w$]*\(`local_remote_control_client_id`\)/u,
    );
    if (localClientIdMatch == null) {
      console.warn("WARN: Could not find local remote-control client id - skipping setup reset patch");
      return source;
    }
    const localClientIdVar = localClientIdMatch[1];
    const anchorPositions = [
      currentStateKeysMatch.index,
      currentStateSetterMatch.index,
      currentRevokeMatch.index,
      ownerFunctionStart,
      ownerFunctionStart + localClientIdMatch.index,
    ];
    if (Math.max(...anchorPositions) - Math.min(...anchorPositions) > 16_384) {
      console.warn("WARN: Remote-control revoke setup-reset anchors are too far apart - skipping setup reset patch");
      return source;
    }
    const helper = [
      `function ${REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER}(e,t,n,r,i,o){`,
      "let a=e?.filter(e=>(e.clientId??e.client_id)!==t);",
      "let s=a?.filter(e=>(e.clientId??e.client_id)!==o);",
      "return s?.length===0&&i(n,r.CODEX_MOBILE_SETUP_COMPLETED,!1),a",
      "}",
    ].join("");
    return `${source.slice(0, ownerFunctionStart)}${helper}${source.slice(ownerFunctionStart)}`
      .replace(
        currentRevokePattern,
        (_needle, clientIdVar, querySnapshotVar, dataVar, resultVar, trackFn, desktopHostVar, revokeEventVar) =>
          `onRevoked:${clientIdVar}=>{${querySnapshotVar}.setData(${dataVar}=>${REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER}(${dataVar},${clientIdVar},${desktopHostVar},${currentStateKeysVar},${currentStateSetterVar},${localClientIdVar})),${querySnapshotVar}.invalidate()},onRevokeResult:${resultVar}=>{${trackFn}(${desktopHostVar},${revokeEventVar},{result:${resultVar}})}`,
      );
  }
  console.warn("WARN: Could not find remote-control revoke success handler - skipping setup reset patch");
  return source;
}

function applyLinuxRemoteControlLoadGatePatch(source) {
  if (source.includes(REMOTE_CONTROL_LOAD_GATE_MARKER)) {
    return source;
  }
  if (!source.includes("`1042620455`")) {
    return source;
  }

  const match = source.match(REMOTE_CONTROL_LOAD_GATE_NEEDLE);
  if (match == null) {
    console.warn("WARN: Could not find remote-control loader rollout gate - skipping Linux remote-control load gate patch");
    return source;
  }

  const [, functionName, statsigFn] = match;
  return source.replace(
    REMOTE_CONTROL_LOAD_GATE_NEEDLE,
    [
      `function ${functionName}(){return chatgptLinuxRemoteControlLoadGateEnabled()||${statsigFn}(\`1042620455\`)}`,
      "function chatgptLinuxRemoteControlLoadGateEnabled(){",
      "return typeof navigator!=`undefined`&&navigator.userAgent.includes(`Linux`)",
      "}",
    ].join(""),
  );
}

function applyLinuxRemoteControlIntegrationSyncPatch(source) {
  if (!source.includes("set-experimental-feature-enablement-for-host")) {
    return source;
  }
  if (source.includes(`function ${REMOTE_CONTROL_FEATURE_SYNC_MARKER}(`)) {
    return source;
  }

  const id = "[A-Za-z_$][\\w$]*";
  const syncSetupRegex = new RegExp(
    `let (${id})=(${id})\\((${id}),(${id}),(${id})\\),` +
      `(${id})=(${id})\\.get\\((${id})\\),(${id})=new Set\\(`,
    "u",
  );
  const setupMatch = source.match(syncSetupRegex);
  const enablementVar = setupMatch?.[1];
  const localHostVar = setupMatch?.[6];
  const activeHostsVar = setupMatch?.[9];
  if (enablementVar == null || localHostVar == null || activeHostsVar == null) {
    console.warn("WARN: Could not find app-server feature sync setup - skipping Linux remote-control feature sync patch");
    return source;
  }

  const flatMapRegex = new RegExp(
    `Array\\.from\\(${activeHostsVar}\\)\\.flatMap\\((${id})=>` +
      `\\(0,(${id})\\.default\\)\\((${id})\\.get\\(\\1\\),${enablementVar}\\)\\?\\[\\]:` +
      `\\(\\3\\.set\\(\\1,${enablementVar}\\),\\[(${id})\\(\\x60set-experimental-feature-enablement-for-host\\x60,` +
      `\\{hostId:\\1,enablement:${enablementVar}\\}\\)`,
    "u",
  );
  const match = source.match(flatMapRegex);
  if (match == null) {
    console.warn("WARN: Could not find app-server feature sync list - skipping Linux remote-control feature sync patch");
    return source;
  }

  const [needle, hostVar, compareNamespaceVar, cacheMapVar, requestFnVar] = match;
  const scopedEnablement =
    `${REMOTE_CONTROL_FEATURE_SYNC_MARKER}(${enablementVar},${localHostVar},${hostVar})`;
  const replacement =
    `Array.from(${activeHostsVar}).flatMap(${hostVar}=>(0,${compareNamespaceVar}.default)` +
    `(${cacheMapVar}.get(${hostVar}),${scopedEnablement})?[]:` +
    `(${cacheMapVar}.set(${hostVar},${scopedEnablement}),[${requestFnVar}(\`set-experimental-feature-enablement-for-host\`,` +
    `{hostId:${hostVar},enablement:${scopedEnablement}})`;
  const helper =
    `function ${REMOTE_CONTROL_FEATURE_SYNC_MARKER}(e,t,n){return ` +
    `typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)&&t===n` +
    `?{...e,remote_control:!0}:e}`;

  return `${source.replace(needle, replacement)}\n${helper}`;
}

function applyLinuxRemoteControlVisibilityPatch(source) {
  if (!source.includes("remoteControlConnectionsState")) {
    return source;
  }

  const settingsVisibilityMatch = source.match(REMOTE_CONTROL_SETTINGS_VISIBILITY_NEEDLE);
  if (settingsVisibilityMatch == null) {
    if (source.includes(REMOTE_CONTROL_VISIBILITY_MARKER)) {
      return source;
    }
    console.warn("WARN: Could not find remote-control visibility gate - skipping Linux remote-control visibility patch");
    return source;
  }

  const [, functionName, stateVar, slingshotVar] = settingsVisibilityMatch;
  return source.replace(
    REMOTE_CONTROL_SETTINGS_VISIBILITY_NEEDLE,
    `function ${functionName}({remoteControlConnectionsState:${stateVar},slingshotEnabled:${slingshotVar}}){let n=typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`);/*${REMOTE_CONTROL_VISIBILITY_MARKER}*/return(n||${slingshotVar})&&(n||(${stateVar}?.available??!0))&&${stateVar}?.accessRequired!==!0}`,
  );
}

function wrapRemoteControlTabs(source, firstKey) {
  const key = firstKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `tabs:(\\[\\{key:\`${key}\`[\\s\\S]*?\\}\\]),selectedKey:([A-Za-z_$][\\w$]*),variant:\`underline\`,onSelect:([A-Za-z_$][\\w$]*)\\}`,
    "g",
  );
  return source.replace(
    pattern,
    "tabs:chatgptLinuxRemoteControlSettingsTabs($1),selectedKey:$2,variant:`underline`,onSelect:$3}",
  );
}

function replaceLinuxRemoteControlCopy(source) {
  let patched = source;
  let changed = false;
  for (const [macCopy, linuxCopy] of REMOTE_CONTROL_LINUX_COPY_REPLACEMENTS) {
    if (patched.includes(macCopy)) {
      patched = patched.split(macCopy).join(linuxCopy);
      changed = true;
    }
  }
  return { patched, changed };
}

function applyLinuxRemoteControlCopyPatch(source) {
  const hasMarker = source.includes(REMOTE_CONTROL_COPY_MARKER);
  const { patched, changed } = replaceLinuxRemoteControlCopy(source);
  if (!changed) {
    if (hasMarker) {
      return source;
    }
    if (
      !source.includes("this Mac") &&
      !source.includes("Keep this Mac awake") &&
      !source.includes("Control this Mac") &&
      !source.includes("local Mac") &&
      !source.includes("settings.remoteConnections")
    ) {
      return source;
    }
    console.warn("WARN: Could not find remote-control Mac copy - skipping Linux remote-control copy patch");
    return source;
  }
  return hasMarker ? patched : `/*${REMOTE_CONTROL_COPY_MARKER}*/${patched}`;
}

function applyLinuxRemoteControlSshInstallActionPatch(source) {
  if (source.includes(REMOTE_CONTROL_SSH_INSTALL_ACTION_MARKER)) {
    return source;
  }
  if (!source.includes("remote-codex-not-found") && !source.includes("update-required")) {
    return source;
  }

  const actionGateRegex =
    /let ([A-Za-z_$][\w$]*)=\([^;]{1,160}\)&&\(([A-Za-z_$][\w$]*)\?\.code===`remote-codex-not-found`\|\|\2\?\.code===`update-required`\)(?=,[A-Za-z_$][\w$]*;)/u;
  const match = source.match(actionGateRegex);
  if (match == null) {
    console.warn("WARN: Could not find remote-control SSH install action gate - skipping Linux install action patch");
    return source;
  }

  const [, gateVar] = match;
  return source.replace(
    actionGateRegex,
    `let ${gateVar}=/*${REMOTE_CONTROL_SSH_INSTALL_ACTION_MARKER}*/!1`,
  );
}

function applyLinuxRemoteControlSshInstallReleasePatch(source) {
  if (source.includes(REMOTE_CONTROL_SSH_INSTALL_RELEASE_MARKER)) {
    return source;
  }
  if (!source.includes("install-remote-codex") || !source.includes("install-codex")) {
    return source;
  }

  const id = "[A-Za-z_$][\\w$]*";
  const currentActionBuilderRegex = new RegExp(
    `function (${id})\\(\\{action:(${id}),disabled:(${id}),hostId:(${id}),` +
      `installCodexPending:(${id}),onAuthenticate:(${id}),onInstallCodex:(${id}),` +
      `onReconnect:(${id}),onRestart:(${id})\\}\\)\\{if\\(\\2==null\\)return null;` +
      `switch\\(\\2\\.kind\\)\\{case\\x60install-codex\\x60:return\\{disabled:\\3,label:\\2\\.label,` +
      `loading:\\5,loadingLabel:\\2\\.loadingLabel,renderInElectronOnly:!0,` +
      `tooltipText:\\2\\.tooltipText,onClick:\\(\\)=>\\7\\(\\4\\)\\}`,
    "u",
  );
  const currentActionCallRegex = new RegExp(
    `(${id})\\(\\{action:(${id})\\.action,disabled:(${id}),hostId:(${id})\\.hostId,` +
      `installCodexPending:(${id}),onReconnect:(${id}),onRestart:(${id}),` +
      `onAuthenticate:(${id}),onInstallCodex:(${id})\\}\\)`,
    "u",
  );
  const currentLocalVersionRegex = new RegExp(
    `\\{appServerVersion:(${id}),error:(${id}),installedCodexVersion:(${id}),state:(${id})\\}` +
      `=(${id})\\((${id})\\.hostId\\),(${id})=\\6\\.displayName`,
    "u",
  );
  const currentMutationRegex = new RegExp(
    `(${id})=(${id})=>\\{(${id})\\.mutate\\(\\{hostId:\\2\\},` +
      `\\{onSuccess:\\(\\{state:(${id}),error:(${id})\\}\\)=>\\{(${id})\\(\\2,\\4,\\5\\)\\}\\}\\)\\}`,
    "u",
  );
  const currentActionBuilderMatch = source.match(currentActionBuilderRegex);
  const currentActionCallMatch = source.match(currentActionCallRegex);
  const currentLocalVersionMatch = source.match(currentLocalVersionRegex);
  const currentMutationMatch = source.match(currentMutationRegex);
  if (
    currentActionBuilderMatch == null ||
    currentActionCallMatch == null ||
    currentLocalVersionMatch == null ||
    currentMutationMatch == null
  ) {
    console.warn("WARN: Could not find remote-control SSH install release needles - skipping Linux install release patch");
    return source;
  }

  const [
    ,
    builderFn,
    actionVar,
    disabledVar,
    hostVar,
    pendingVar,
    authenticateVar,
    installVar,
    reconnectVar,
    restartVar,
  ] = currentActionBuilderMatch;
  const actionBuilderReplacement =
    `function ${builderFn}({action:${actionVar},disabled:${disabledVar},hostId:${hostVar},` +
    `installCodexPending:${pendingVar},installCodexRelease:chatgptLinuxRemoteControlSshInstallReleaseTarget,` +
    `onAuthenticate:${authenticateVar},onInstallCodex:${installVar},onReconnect:${reconnectVar},onRestart:${restartVar}}){` +
    `if(${actionVar}==null)return null;switch(${actionVar}.kind){case\`install-codex\`:return{` +
    `disabled:${disabledVar},label:${actionVar}.label,loading:${pendingVar},loadingLabel:${actionVar}.loadingLabel,` +
    `renderInElectronOnly:!0,tooltipText:${actionVar}.tooltipText,` +
    `onClick:()=>${installVar}(${hostVar},chatgptLinuxRemoteControlSshInstallReleaseTarget)}`;

  const [
    ,
    actionFn,
    connectionActionVar,
    callDisabledVar,
    connectionVar,
    callPendingVar,
    callReconnectVar,
    callRestartVar,
    callAuthenticateVar,
    callInstallVar,
  ] = currentActionCallMatch;
  const actionCallReplacement =
    `${actionFn}({action:${connectionActionVar}.action,disabled:${callDisabledVar},` +
    `hostId:${connectionVar}.hostId,installCodexPending:${callPendingVar},` +
    `installCodexRelease:${REMOTE_CONTROL_SSH_INSTALL_RELEASE_MARKER}(chatgptLinuxRemoteControlSshInstallError),` +
    `onReconnect:${callReconnectVar},onRestart:${callRestartVar},` +
    `onAuthenticate:${callAuthenticateVar},onInstallCodex:${callInstallVar}})`;

  const [
    ,
    appServerVersionVar,
    errorVar,
    installedVersionVar,
    stateVar,
    connectionStateFn,
    localConnectionVar,
    displayNameVar,
  ] = currentLocalVersionMatch;
  const localVersionReplacement =
    `{appServerVersion:${appServerVersionVar},error:${errorVar},` +
    `installedCodexVersion:${installedVersionVar},state:${stateVar}}=` +
    `${connectionStateFn}(${localConnectionVar}.hostId),` +
    `{appServerVersion:chatgptLinuxRemoteControlSshInstallLocalVersion}=${connectionStateFn}(\`local\`),` +
    `chatgptLinuxRemoteControlSshInstallError=${errorVar},` +
    `${displayNameVar}=(chatgptLinuxRemoteControlSshInstallDefaultRelease=` +
    `chatgptLinuxRemoteControlValidRelease(chatgptLinuxRemoteControlSshInstallLocalVersion)??` +
    `chatgptLinuxRemoteControlSshInstallDefaultRelease,${localConnectionVar}.displayName)`;

  const [
    ,
    mutationHandlerVar,
    mutationHostVar,
    mutationVar,
    mutationStateVar,
    mutationErrorVar,
    syncStateFn,
  ] = currentMutationMatch;
  const mutationReplacement =
    `${mutationHandlerVar}=(${mutationHostVar},chatgptLinuxRemoteControlSshInstallTargetRelease)=>{` +
    `let chatgptLinuxRemoteControlSshInstallRequest={hostId:${mutationHostVar}},` +
    `chatgptLinuxRemoteControlSshInstallResolvedRelease=` +
    `chatgptLinuxRemoteControlSshInstallTargetRelease??chatgptLinuxRemoteControlSshInstallDefaultRelease;` +
    `chatgptLinuxRemoteControlSshInstallResolvedRelease!=null&&` +
    `(chatgptLinuxRemoteControlSshInstallRequest.release=chatgptLinuxRemoteControlSshInstallResolvedRelease),` +
    `${mutationVar}.mutate(chatgptLinuxRemoteControlSshInstallRequest,{onSuccess:({state:${mutationStateVar},` +
    `error:${mutationErrorVar}})=>{${syncStateFn}(${mutationHostVar},${mutationStateVar},${mutationErrorVar})}})}`;

  const helper = [
    "let chatgptLinuxRemoteControlSshInstallDefaultRelease=null,chatgptLinuxRemoteControlSshInstallError=null;",
    "function chatgptLinuxRemoteControlValidRelease(e){return typeof e==`string`&&e.trim().length>0?e.trim():null}",
    `function ${REMOTE_CONTROL_SSH_INSTALL_RELEASE_MARKER}(e){return e?.code===\`update-required\`?chatgptLinuxRemoteControlValidRelease(e.minRequiredVersion):null}`,
  ].join("");

  return helper + source
    .replace(currentLocalVersionRegex, localVersionReplacement)
    .replace(currentActionBuilderRegex, actionBuilderReplacement)
    .replace(currentActionCallRegex, actionCallReplacement)
    .replace(currentMutationRegex, mutationReplacement);
}

function applyLinuxRemoteControlSettingsUxPatch(source) {
  let patched = applyLinuxRemoteControlSshInstallReleasePatch(replaceLinuxRemoteControlCopy(source).patched);
  patched = applyLinuxRemoteControlSshInstallActionPatch(patched);

  if (!patched.includes(REMOTE_CONTROL_SETTINGS_UX_MARKER)) {
    const helperNeedle = /function ([A-Za-z_$][\w$]*)\(e,t\)\{return e\.displayName\.localeCompare\(t\.displayName\)\}/u;
    const helperMatch = patched.match(helperNeedle);
    if (helperMatch == null) {
      console.warn("WARN: Could not find remote-control settings helper needle - skipping Linux remote-control settings UX patch");
      return patched;
    }
    patched = patched.replace(helperNeedle, `${REMOTE_CONTROL_SETTINGS_TABS_HELPER}${helperMatch[0]}`);
  }

  patched = wrapRemoteControlTabs(patched, "control-this-mac");
  patched = wrapRemoteControlTabs(patched, "access-other-devices");

  return patched;
}

function applyLinuxRemoteConnectionsRefreshPatch(source) {
  if (source.includes(REMOTE_CONNECTIONS_REFRESH_MARKER)) {
    return source;
  }

  let patched = source;
  const intervalConstantRegex = /(^|[,\s;])([A-Za-z_$][\w$]*)=15e3(?=[,;])/u;
  if (patched.includes("Qn=15e3")) {
    patched = patched.replace("Qn=15e3", "Qn=5e3");
  } else if (intervalConstantRegex.test(patched) && patched.includes("refresh-remote-connections")) {
    patched = patched.replace(intervalConstantRegex, "$1$2=5e3");
  } else if (patched.includes("15e3") && patched.includes("refresh-remote-connections")) {
    console.warn("WARN: Could not find remote-connections refresh interval constant - skipping interval patch");
  }

  const effectPattern =
    /\(0,([A-Za-z_$][\w$]*)\.useEffect\)\(\(\)=>\{let ([A-Za-z_$][\w$]*)=null,([A-Za-z_$][\w$]*)=!1,([A-Za-z_$][\w$]*)=async\(\)=>\{if\(![A-Za-z_$][\w$]*\)\{[A-Za-z_$][\w$]*=!0,[A-Za-z_$][\w$]*=new AbortController;try\{await ([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\.signal\)\}finally\{[A-Za-z_$][\w$]*=null,[A-Za-z_$][\w$]*=!1\}\}\},([A-Za-z_$][\w$]*)=window\.setInterval\(\(\)=>\{[A-Za-z_$][\w$]*\(\)\},([A-Za-z_$][\w$]*)\);return\(\)=>\{[A-Za-z_$][\w$]*\?\.abort\(\),window\.clearInterval\([A-Za-z_$][\w$]*\)\}\},\[\]\);/;
  const match = patched.match(effectPattern);
  if (match == null) {
    if (patched.includes("refresh-remote-connections") && patched.includes("setInterval")) {
      console.warn("WARN: Could not find remote-connections auto-refresh effect - skipping resume refresh patch");
    }
    return patched;
  }

  const [
    needle,
    reactVar,
    abortVar,
    pendingVar,
    refreshVar,
    refreshEventVar,
    intervalVar,
    intervalConstantVar,
  ] = match;
  const replacement =
    `(0,${reactVar}.useEffect)(()=>{let ${abortVar}=null,${pendingVar}=!1,${refreshVar}=async()=>{if(!${pendingVar}){${pendingVar}=!0,${abortVar}=new AbortController;try{await ${refreshEventVar}(${abortVar}.signal)}finally{${abortVar}=null,${pendingVar}=!1}}},` +
    `chatgptLinuxRemoteConnectionsRefreshTimer=null,chatgptLinuxRemoteConnectionsRefreshLast=0,${REMOTE_CONNECTIONS_REFRESH_MARKER}=()=>{if(document.visibilityState===\`hidden\`)return;let e=Date.now(),t=()=>{chatgptLinuxRemoteConnectionsRefreshLast=Date.now(),chatgptLinuxRemoteConnectionsRefreshTimer=null,${refreshVar}()};if(e-chatgptLinuxRemoteConnectionsRefreshLast<1e3){chatgptLinuxRemoteConnectionsRefreshTimer!=null&&window.clearTimeout(chatgptLinuxRemoteConnectionsRefreshTimer),chatgptLinuxRemoteConnectionsRefreshTimer=window.setTimeout(t,1e3-(e-chatgptLinuxRemoteConnectionsRefreshLast));return}t()},` +
    `${intervalVar}=window.setInterval(()=>{${refreshVar}()},${intervalConstantVar});` +
    `document.addEventListener(\`visibilitychange\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.addEventListener(\`focus\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.addEventListener(\`online\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.addEventListener(\`resume\`,${REMOTE_CONNECTIONS_REFRESH_MARKER});` +
    `return()=>{${abortVar}?.abort(),window.clearInterval(${intervalVar}),` +
    `chatgptLinuxRemoteConnectionsRefreshTimer!=null&&window.clearTimeout(chatgptLinuxRemoteConnectionsRefreshTimer),` +
    `document.removeEventListener(\`visibilitychange\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.removeEventListener(\`focus\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.removeEventListener(\`online\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.removeEventListener(\`resume\`,${REMOTE_CONNECTIONS_REFRESH_MARKER})}},[]);`;

  return patched.replace(needle, replacement);
}

function applyLinuxRemoteMobileChromeBridgePatch(source) {
  if (source.includes(REMOTE_MOBILE_CHROME_BRIDGE_MARKER)) {
    return source;
  }

  if (browserClientHasNativeChromeBackendPreferenceRouting(source)) {
    return source;
  }

  // 26.527.x moved the browser-use backend allowlist from the
  // x-codex-browser-use-available-backends request-meta header to the
  // BROWSER_USE_AVAILABLE_BACKENDS config value (var dy), renamed the allowlist
  // (X6->e2 / rE->ly) and reader (yC->_y), and dropped the native-pipe diagnostic.
  const backendNeedle =
    "var e2=[\"chrome\",\"iab\",\"cdp\"];function ly(e){return e2.some(t=>t===e)}";
  const backendReplacement =
    "var e2=[\"chrome\",\"iab\",\"cdp\"];function ly(e){return e2.some(t=>t===e)}function chatgptLinuxRemoteMobileBrowserBackends(e){if(e==null)return null;if(!Array.isArray(e))return[];let t=e.filter(ly);return typeof process!=`undefined`&&process.platform===`linux`&&!t.includes(`chrome`)?[`chrome`,...t]:t}";
  const currentBackendNeedle =
    "function _y(){let e=Su(dy);return e==null?null:vy(e).filter(ly)}";
  const currentBackendReplacement =
    "function _y(){let e=Su(dy);return chatgptLinuxRemoteMobileBrowserBackends(e==null?null:vy(e))}";

  if (source.includes(backendNeedle) && source.includes(currentBackendNeedle)) {
    return source
      .replace(backendNeedle, backendReplacement)
      .replace(currentBackendNeedle, currentBackendReplacement);
  }

  const backendAllowlistPattern =
    /var ([A-Za-z_$][\w$]*)=\["chrome","iab","cdp"\];function ([A-Za-z_$][\w$]*)\(e\)\{return \1\.some\(t=>t===e\)\}/u;
  const readerPattern =
    /function ([A-Za-z_$][\w$]*)\(\)\{let e=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\);return e==null\?null:([A-Za-z_$][\w$]*)\(e\)\.filter\(([A-Za-z_$][\w$]*)\)\}/u;
  const allowlistMatch = source.match(backendAllowlistPattern);
  const readerMatch = source.match(readerPattern);
  if (allowlistMatch != null && readerMatch != null && readerMatch[5] === allowlistMatch[2]) {
    const [, allowlistVar, allowlistFn] = allowlistMatch;
    const [, readerFn, envReaderFn, backendsEnvVar, parseBackendsFn] = readerMatch;
    return source
      .replace(
        backendAllowlistPattern,
        `var ${allowlistVar}=["chrome","iab","cdp"];function ${allowlistFn}(e){return ${allowlistVar}.some(t=>t===e)}function chatgptLinuxRemoteMobileBrowserBackends(e){if(e==null)return null;if(!Array.isArray(e))return[];let t=e.filter(${allowlistFn});return typeof process!=\`undefined\`&&process.platform===\`linux\`&&!t.includes(\`chrome\`)?[\`chrome\`,...t]:t}`,
      )
      .replace(
        readerPattern,
        `function ${readerFn}(){let e=${envReaderFn}(${backendsEnvVar});return chatgptLinuxRemoteMobileBrowserBackends(e==null?null:${parseBackendsFn}(e))}`,
      );
  }

  console.warn("WARN: Could not find Chrome browser-client backend allowlist needles - skipping remote-mobile Chrome bridge patch");
  return source;
}

function browserClientHasNativeChromeBackendPreferenceRouting(source) {
  return (
    source.includes("BROWSER_USE_AVAILABLE_BACKENDS") &&
    source.includes("browserPreference") &&
    source.includes("preferredWindowIdFor") &&
    /var [A-Za-z_$][\w$]*=\["chrome","iab","cdp"\];function [A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\)\{return [A-Za-z_$][\w$]*\.some\([A-Za-z_$][\w$]*=>[A-Za-z_$][\w$]*===[A-Za-z_$][\w$]*\)\}/u.test(source)
  );
}

function buildLateUnknownConversationHydrationReplacement(
  eventName,
  conversationIdVar,
  loggerVar,
  unknownConversationPrelude = "",
) {
  const pendingMapVar = "chatgptLinuxRemoteMobilePendingMap";
  const queueVar = "chatgptLinuxRemoteMobileQueue";
  const inFlightVar = "chatgptLinuxRemoteMobileInFlight";
  const readVar = "chatgptLinuxRemoteMobileRead";
  return (
    `if(!this.conversations.get(${conversationIdVar})){/*${REMOTE_MOBILE_LATE_EVENT_HYDRATION_MARKER}*/${unknownConversationPrelude}${unknownConversationPrelude.length > 0 ? ";" : ""}` +
    `let ${pendingMapVar}=this.chatgptLinuxRemoteMobilePendingNotifications??=new Map,${queueVar}=${pendingMapVar}.get(${conversationIdVar});` +
    `${queueVar}||(${queueVar}=[],${pendingMapVar}.set(${conversationIdVar},${queueVar})),${queueVar}.push(n);` +
    `let ${inFlightVar}=this.chatgptLinuxRemoteMobileInFlightHydrations??=new Set;` +
    `if(${inFlightVar}.has(${conversationIdVar})){${loggerVar}.warning(\`Queueing ${eventName} for hydrating conversation\`,{safe:{queuedNotificationCount:${queueVar}.length},sensitive:{conversationId:${conversationIdVar}}});break}` +
    `${loggerVar}.warning(\`Hydrating conversation for ${eventName}\`,{safe:{queuedNotificationCount:${queueVar}.length},sensitive:{conversationId:${conversationIdVar}}});` +
    `let ${readVar}=(s=0)=>this.readThread(${conversationIdVar},{includeTurns:!0}).then(e=>{let t=e?.thread??e,c=this.chatgptLinuxRemoteMobilePendingNotifications?.get(${conversationIdVar})??[],chatgptLinuxRemoteMobileTurns=Array.isArray(e?.turns)?e.turns:Array.isArray(t?.turns)?t.turns:null;` +
    `if(!t||!Array.isArray(chatgptLinuxRemoteMobileTurns)||chatgptLinuxRemoteMobileTurns.length===0){if(s<12){${loggerVar}.warning(\`Retrying hydration for missing conversation\`,{safe:{queuedNotificationCount:c.length,attempt:s+1},sensitive:{conversationId:${conversationIdVar}}}),setTimeout(()=>${readVar}(s+1),250);return}` +
    `this.chatgptLinuxRemoteMobilePendingNotifications?.delete(${conversationIdVar}),this.chatgptLinuxRemoteMobileInFlightHydrations?.delete(${conversationIdVar}),${loggerVar}.warning(\`Skipping hydration for missing conversation\`,{safe:{queuedNotificationCount:c.length},sensitive:{conversationId:${conversationIdVar}}});return}` +
    `this.upsertConversationFromThread(t),this.chatgptLinuxRemoteMobilePendingNotifications?.delete(${conversationIdVar}),this.chatgptLinuxRemoteMobileInFlightHydrations?.delete(${conversationIdVar});for(let e of c)this.onNotification(e.method,e.params)})` +
    `.catch(e=>{if(s<12){${loggerVar}.warning(\`Retrying hydration for ${eventName}\`,{safe:{attempt:s+1},sensitive:{conversationId:${conversationIdVar},error:e}}),setTimeout(()=>${readVar}(s+1),250);return}` +
    `this.chatgptLinuxRemoteMobilePendingNotifications?.delete(${conversationIdVar}),this.chatgptLinuxRemoteMobileInFlightHydrations?.delete(${conversationIdVar}),${loggerVar}.error(\`Failed to hydrate conversation for ${eventName}\`,{safe:{},sensitive:{conversationId:${conversationIdVar},error:e}})});` +
    `${inFlightVar}.add(${conversationIdVar}),${readVar}();break}`
  );
}

function applyLinuxRemoteMobileConversationHydrationPatch(source) {
  let patched = source;

  if (!patched.includes(REMOTE_MOBILE_THREAD_RUNTIME_MARKER)) {
    const runtimeReplacement =
      (_needle, conversationVar, runtimeVar) =>
        `/*${REMOTE_MOBILE_THREAD_RUNTIME_MARKER}*/(${conversationVar}.resumeState===\`needs_resume\`||${runtimeVar}?.type===\`active\`||${runtimeVar}?.type===\`idle\`)&&(${conversationVar}.threadRuntimeStatus=${runtimeVar})`;
    const runtimeNeedle =
      /([A-Za-z_$][\w$]*)\.resumeState===`needs_resume`&&\(\1\.threadRuntimeStatus=([A-Za-z_$][\w$]*)\)/u;
    if (runtimeNeedle.test(patched)) {
      patched = patched.replace(runtimeNeedle, runtimeReplacement);
    } else if (
      patched.includes("threadRuntimeStatus:e.threadRuntimeStatus") &&
      patched.includes("t===`needs_resume`?n?.type===`active`")
    ) {
      // Current upstream preserves threadRuntimeStatus on thread summaries and
      // already treats active needs-resume threads as live in the sidebar model.
    } else if (patched.includes("threadRuntimeStatus") && patched.includes("resumeState")) {
      console.warn("WARN: Could not find thread/list runtime-status needle - skipping remote mobile runtime-status patch");
    }
  }

  // Hydrate on turn/started and queue later events while that read is in flight.
  if (!patched.includes(REMOTE_MOBILE_NOTIFICATION_QUEUE_MARKER)) {
    const unknownTurnNeedle =
      /(let\{threadId:([A-Za-z_$][\w$]*),turn:[A-Za-z_$][\w$]*\}=([A-Za-z_$][\w$]*)\.params,([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\);)if\(!this\.conversations\.get\(\4\)\)\{([A-Za-z_$][\w$]*)\.error\(`Received turn\/started for unknown conversation`,\{safe:\{conversationId:\4\},sensitive:\{\}\}\);break\}/u;
    const unknownTurnReplacement =
      (_needle, prefix, _threadIdParamVar, notificationVar, conversationIdVar, normalizerFn, loggerVar) =>
        `${prefix}if(!this.conversations.get(${conversationIdVar})){/*${REMOTE_MOBILE_UNKNOWN_TURN_MARKER}*//*${REMOTE_MOBILE_NOTIFICATION_QUEUE_MARKER}*//*${REMOTE_MOBILE_IN_FLIGHT_HYDRATION_MARKER}*/let l=${notificationVar}.params?.turn?.threadId??${notificationVar}.params?.thread?.id,d=l!=null?${normalizerFn}(l):null,u=${notificationVar}.params?.turn?.id??${notificationVar}.params?.turnId;if(d==null||u!=null&&d===${normalizerFn}(u)){${loggerVar}.warning(\`Skipping hydration for ambiguous turn/started\`,{safe:{},sensitive:{conversationId:${conversationIdVar},resolvedConversationId:d,turnId:u??null}});break}${notificationVar}={...${notificationVar},params:{...${notificationVar}.params,threadId:l}};if(this.conversations.get(d)){this.onNotification(${notificationVar}.method,${notificationVar}.params);break}let i=this.chatgptLinuxRemoteMobilePendingNotifications??=new Map,a=i.get(d);a||(a=[],i.set(d,a));let p=u!=null?a.findIndex(e=>{let t=e.params?.turn?.id??e.params?.turnId;return e.method===${notificationVar}.method&&t!=null&&${normalizerFn}(t)===${normalizerFn}(u)}):-1;p>=0?a[p]=${notificationVar}:a.push(${notificationVar});let h=this.chatgptLinuxRemoteMobileInFlightHydrations??=new Set;if(h.has(d)){${loggerVar}.warning(\`Queueing turn/started for hydrating conversation\`,{safe:{queuedNotificationCount:a.length,dedupedNotification:p>=0},sensitive:{conversationId:d}});break}${loggerVar}.warning(\`Hydrating conversation for turn/started\`,{safe:{queuedNotificationCount:a.length},sensitive:{conversationId:d}});let o=(s=0)=>this.readThread(d,{includeTurns:!0}).then(e=>{let t=e?.thread??e,c=this.chatgptLinuxRemoteMobilePendingNotifications?.get(d)??[],chatgptLinuxRemoteMobileTurns=Array.isArray(e?.turns)?e.turns:Array.isArray(t?.turns)?t.turns:null;if(!t||!Array.isArray(chatgptLinuxRemoteMobileTurns)||chatgptLinuxRemoteMobileTurns.length===0){if(s<12){${loggerVar}.warning(\`Retrying hydration for missing conversation\`,{safe:{queuedNotificationCount:c.length,attempt:s+1},sensitive:{conversationId:d}}),setTimeout(()=>o(s+1),250);return}this.chatgptLinuxRemoteMobilePendingNotifications?.delete(d),this.chatgptLinuxRemoteMobileInFlightHydrations?.delete(d),${loggerVar}.warning(\`Skipping hydration for missing conversation\`,{safe:{queuedNotificationCount:c.length},sensitive:{conversationId:d}});return}this.upsertConversationFromThread(t),this.chatgptLinuxRemoteMobilePendingNotifications?.delete(d),this.chatgptLinuxRemoteMobileInFlightHydrations?.delete(d);for(let e of c)this.onNotification(e.method,e.params)}).catch(e=>{if(s<12){${loggerVar}.warning(\`Retrying hydration for turn/started\`,{safe:{attempt:s+1},sensitive:{conversationId:d,error:e}}),setTimeout(()=>o(s+1),250);return}this.chatgptLinuxRemoteMobilePendingNotifications?.delete(d),this.chatgptLinuxRemoteMobileInFlightHydrations?.delete(d),${loggerVar}.error(\`Failed to hydrate conversation for turn/started\`,{safe:{},sensitive:{conversationId:d,error:e}})});h.add(d),o();break}`;
    if (unknownTurnNeedle.test(patched)) {
      patched = patched.replace(unknownTurnNeedle, unknownTurnReplacement);
    } else if (patched.includes("Received turn/started for unknown conversation")) {
      console.warn("WARN: Could not find unknown turn/started needle - skipping remote mobile hydration patch");
    }

    const itemStartedNeedle =
      /if\(!this\.conversations\.get\(([A-Za-z_$][\w$]*)\)\)\{([A-Za-z_$][\w$]*)\.error\(`Received item\/started for unknown conversation`,\{safe:\{conversationId:\1\},sensitive:\{\}\}\);break\}/u;
    if (itemStartedNeedle.test(patched)) {
      patched = patched.replace(
        itemStartedNeedle,
        (_needle, conversationIdVar, loggerVar) =>
          buildLateUnknownConversationHydrationReplacement("item/started", conversationIdVar, loggerVar),
      );
    } else if (patched.includes("Received item/started for unknown conversation")) {
      console.warn("WARN: Could not find unknown item/started needle - skipping remote mobile item queue patch");
    }

    const itemCompletedNeedle =
      /if\(([^{};]*clearItemTerminalInputBuffer\([^{};]*\)),!this\.conversations\.get\(([A-Za-z_$][\w$]*)\)\)\{([A-Za-z_$][\w$]*)\.error\(`Received item\/completed for unknown conversation`,\{safe:\{conversationId:\2\},sensitive:\{\}\}\);break\}/u;
    if (itemCompletedNeedle.test(patched)) {
      patched = patched.replace(
        itemCompletedNeedle,
        (_needle, completionPrelude, conversationIdVar, loggerVar) =>
          `${completionPrelude};${buildLateUnknownConversationHydrationReplacement("item/completed", conversationIdVar, loggerVar)}`,
      );
    } else if (patched.includes("Received item/completed for unknown conversation")) {
      console.warn("WARN: Could not find unknown item/completed needle - skipping remote mobile item queue patch");
    }

    const turnCompletedNeedle =
      /if\(!this\.conversations\.get\(([A-Za-z_$][\w$]*)\)\)\{([^{};]*),([A-Za-z_$][\w$]*)\.error\(`Received turn\/completed for unknown conversation`,\{safe:\{conversationId:\1\},sensitive:\{\}\}\);break\}/u;
    const turnCompletedReplacement =
      (_needle, conversationIdVar, completionPrelude, loggerVar) =>
        buildLateUnknownConversationHydrationReplacement(
          "turn/completed",
          conversationIdVar,
          loggerVar,
          completionPrelude,
        );
    if (turnCompletedNeedle.test(patched)) {
      patched = patched.replace(turnCompletedNeedle, turnCompletedReplacement);
    } else if (patched.includes("Received turn/completed for unknown conversation")) {
      console.warn("WARN: Could not find unknown turn/completed needle - skipping remote mobile turn queue patch");
    }
  }

  return patched;
}

function applyLinuxRemoteMobileCompletedItemRecoveryPatch(source) {
  if (source.includes(REMOTE_MOBILE_COMPLETED_ITEM_MARKER)) {
    return source;
  }

  const completedItemDropPattern =
    /([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)&&\(([A-Za-z_$][\w$]*)\.firstTurnWorkItemStartedAtMs=\3\.firstTurnWorkItemStartedAtMs\?\?Date\.now\(\)\),!\(\2\.type!==`subAgentActivity`&&!([A-Za-z_$][\w$]*)\(\3,\2\.id,\2\.type\)\)&&\(\2\.type,([A-Za-z_$][\w$]*)\(\3,([A-Za-z_$][\w$]*)\)\)/u;

  if (completedItemDropPattern.test(source)) {
    return source.replace(
      completedItemDropPattern,
      (
        _match,
        workItemPredicate,
        completedItemVar,
        turnVar,
        findItemFn,
        upsertItemFn,
        viewItemVar,
      ) =>
        `${workItemPredicate}(${completedItemVar})&&(${turnVar}.firstTurnWorkItemStartedAtMs=${turnVar}.firstTurnWorkItemStartedAtMs??Date.now());let chatgptLinuxCompletedItemExists=${turnVar}.items.some(e=>e.id===${viewItemVar}.id);if(${completedItemVar}.type!==\`subAgentActivity\`&&chatgptLinuxCompletedItemExists&&!${findItemFn}(${turnVar},${completedItemVar}.id,${completedItemVar}.type))return;${upsertItemFn}(${turnVar},${viewItemVar})`,
    );
  }

  if (
    source.includes("Item not found in turn state") &&
    source.includes("case`item/completed`") &&
    source.includes("item/agentMessage/delta")
  ) {
    console.warn(
      "WARN: Could not find completed item recovery insertion point - skipping remote mobile completed item recovery patch",
    );
  }

  return source;
}

function applyLinuxRemoteTerminalStatusRecoveryPatch(source) {
  if (
    source.includes("chatgptLinuxRemoteTerminalStatusWaitingOnUserInput") &&
    source.includes("hasUserInputRequest:chatgptLinuxRemoteHasUserInputRequest") &&
    source.includes("&&chatgptLinuxRemoteHasUserInputRequest")
  ) {
    return source;
  }

  if (
    !source.includes("hasInProgressSideChat") ||
    !source.includes("isResponseInProgress") ||
    !source.includes("threadRuntimeStatus") ||
    !source.includes("pendingRequestType")
  ) {
    return source;
  }

  const userInputRequestHelper =
    "function chatgptLinuxRemoteHasUserInputRequest(e){try{return Array.isArray(e)&&e.some(e=>e?.method===`item/tool/requestUserInput`||e?.method===`item/tool/requestOptionPicker`||e?.method===`item/tool/requestSetupCodexContextPicker`||e?.method===`item/tool/call`&&(e?.params?.tool===`request_onboarding_input`||e?.params?.tool===`request_option_picker`||e?.params?.tool===`setup_codex_context_picker`||e?.params?.tool===`setup_codex_step`))}catch{return!1}}";
  const buildTerminalStatusReplacement = (
    fnName,
    sideChatVar,
    responseProgressVar,
    systemErrorVar,
    resumeStateVar,
    runtimeStatusVar,
  ) =>
    `function ${fnName}({hasInProgressSideChat:${sideChatVar},isResponseInProgress:${responseProgressVar},latestTurnHasSystemError:${systemErrorVar},resumeState:${resumeStateVar},threadRuntimeStatus:${runtimeStatusVar},hasUserInputRequest:chatgptLinuxRemoteHasUserInputRequestPending=!0}){let chatgptLinuxRemoteTerminalStatusActive=${runtimeStatusVar}?.type===\`active\`,chatgptLinuxRemoteTerminalStatusActiveFlags=Array.isArray(${runtimeStatusVar}?.activeFlags)?${runtimeStatusVar}.activeFlags:null,chatgptLinuxRemoteTerminalStatusWaitingOnUserInput=chatgptLinuxRemoteTerminalStatusActiveFlags?.includes(\`waitingOnUserInput\`)===!0,chatgptLinuxRemoteTerminalStatusLoading=chatgptLinuxRemoteTerminalStatusActive&&(${responseProgressVar}===!0||chatgptLinuxRemoteTerminalStatusActiveFlags==null||chatgptLinuxRemoteTerminalStatusActiveFlags.length>0&&(!chatgptLinuxRemoteTerminalStatusWaitingOnUserInput||chatgptLinuxRemoteHasUserInputRequestPending===!0));return ${sideChatVar}?\`loading\`:${runtimeStatusVar}?.type===\`systemError\`?\`error\`:chatgptLinuxRemoteTerminalStatusLoading?\`loading\`:${resumeStateVar}===\`needs_resume\`?\`idle\`:${systemErrorVar}?\`error\`:${responseProgressVar}===!0?\`loading\`:\`idle\`}`;

  const terminalStatusPattern =
    /function ([A-Za-z_$][\w$]*)\(\{hasInProgressSideChat:([A-Za-z_$][\w$]*),isResponseInProgress:([A-Za-z_$][\w$]*),latestTurnHasSystemError:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \2\?`loading`:\6\?\.type===`systemError`\?`error`:\6\?\.type===`active`\?`loading`:\5===`needs_resume`\?`idle`:\4\?`error`:\3===!0\?`loading`:`idle`\}/u;
  const terminalStatusMatch = source.match(terminalStatusPattern);
  if (terminalStatusMatch == null) {
    console.warn(
      "WARN: Could not find remote terminal status function - skipping Linux remote terminal status recovery patch",
    );
    return source;
  }
  const [
    ,
    terminalStatusFnName,
    sideChatVar,
    responseProgressVar,
    systemErrorVar,
    resumeStateVar,
    runtimeStatusVar,
  ] = terminalStatusMatch;

  const pendingRequestPattern =
    /function ([A-Za-z_$][\w$]*)\(\{pendingRequestType:([A-Za-z_$][\w$]*),requests:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \3==null\|\|\4==null\?null:\4===`needs_resume`\?\5\?\.type===`active`&&\5\.activeFlags\.includes\(`waitingOnApproval`\)&&([A-Za-z_$][\w$]*)\(\3\)\?`approval`:\5\?\.type===`active`&&\5\.activeFlags\.includes\(`waitingOnUserInput`\)\?`response`:null:([A-Za-z_$][\w$]*)\(\2\)\?`approval`:\2===`userInput`\?`response`:null\}/u;
  const pendingRequestMatch = source.match(pendingRequestPattern);
  if (pendingRequestMatch == null) {
    console.warn(
      "WARN: Could not find remote pending-request function - skipping Linux remote terminal status recovery patch",
    );
    return source;
  }
  const [
    ,
    pendingRequestFnName,
    pendingTypeVar,
    requestsVar,
    pendingResumeStateVar,
    pendingRuntimeStatusVar,
    approvalRequestFn,
    approvalTypeFn,
  ] = pendingRequestMatch;

  const pendingCallPattern = new RegExp(
    `${escapeRegExp(pendingRequestFnName)}\\(\\{pendingRequestType:[^{}]+?,requests:([^{}]*\\([^{}]*\\)[^{}]*?),resumeState:[^{}]+?,threadRuntimeStatus:[^{}]+?\\}\\)`,
    "u",
  );
  const requestExpression = source.match(pendingCallPattern)?.[1] ?? null;
  const terminalCallPattern = new RegExp(
    `${escapeRegExp(terminalStatusFnName)}\\(\\{hasInProgressSideChat:([^{}]+?),isResponseInProgress:([^{}]+?),resumeState:([^{}]+?),threadRuntimeStatus:([^{}]+?),latestTurnHasSystemError:([^{}]+?)\\}\\)`,
    "u",
  );
  if (requestExpression == null || !terminalCallPattern.test(source)) {
    console.warn(
      "WARN: Could not wire remote terminal status to pending user-input requests - skipping Linux remote terminal status recovery patch",
    );
    return source;
  }

  let patched = source.replace(
    terminalStatusPattern,
    `${userInputRequestHelper}${buildTerminalStatusReplacement(
      terminalStatusFnName,
      sideChatVar,
      responseProgressVar,
      systemErrorVar,
      resumeStateVar,
      runtimeStatusVar,
    )}`,
  );
  patched = patched.replace(
    pendingRequestPattern,
    `function ${pendingRequestFnName}({pendingRequestType:${pendingTypeVar},requests:${requestsVar},resumeState:${pendingResumeStateVar},threadRuntimeStatus:${pendingRuntimeStatusVar}}){return ${requestsVar}==null||${pendingResumeStateVar}==null?null:${pendingResumeStateVar}===\`needs_resume\`?${pendingRuntimeStatusVar}?.type===\`active\`&&Array.isArray(${pendingRuntimeStatusVar}?.activeFlags)&&${pendingRuntimeStatusVar}.activeFlags.includes(\`waitingOnApproval\`)&&${approvalRequestFn}(${requestsVar})?\`approval\`:${pendingRuntimeStatusVar}?.type===\`active\`&&Array.isArray(${pendingRuntimeStatusVar}?.activeFlags)&&${pendingRuntimeStatusVar}.activeFlags.includes(\`waitingOnUserInput\`)&&chatgptLinuxRemoteHasUserInputRequest(${requestsVar})?\`response\`:null:${approvalTypeFn}(${pendingTypeVar})?\`approval\`:${pendingTypeVar}===\`userInput\`?\`response\`:null}`,
  );
  patched = patched.replace(
    terminalCallPattern,
    `${terminalStatusFnName}({hasInProgressSideChat:$1,isResponseInProgress:$2,resumeState:$3,threadRuntimeStatus:$4,latestTurnHasSystemError:$5,hasUserInputRequest:chatgptLinuxRemoteHasUserInputRequest(${requestExpression})})`,
  );

  return patched;
}

function applyLinuxRemoteControlStatusReadGuardPatch(source) {
  if (source.includes(REMOTE_CONTROL_STATUS_READ_GUARD_MARKER)) {
    return source;
  }
  if (!source.includes("remoteControl/status/read")) {
    return source;
  }

  const statusReadPattern =
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=\3\.getHostId\(\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2,\4\),([A-Za-z_$][\w$]*)=\2\.get\(([A-Za-z_$][\w$]*),\4\);\3\.addNotificationCallback\(`remoteControl\/status\/changed`,\(\{params:([A-Za-z_$][\w$]*)\}\)=>\{([A-Za-z_$][\w$]*)\(\2,\4,\5\)&&([A-Za-z_$][\w$]*)\(\2,\4,\9\)\}\),\3\.sendRequest\(`remoteControl\/status\/read`,void 0\)\.then\(([A-Za-z_$][\w$]*)=>\{\2\.get\(\8,\4\)===\7&&\10\(\2,\4,\5\)&&\11\(\2,\4,\12\)\}\)\.catch\(([A-Za-z_$][\w$]*)=>\{\10\(\2,\4,\5\)&&([A-Za-z_$][\w$]*)\.error\(`Failed to read remote-control status`,\{safe:\{\},sensitive:\{error:\13\}\}\)\}\)\}/u;
  const match = source.match(statusReadPattern);
  if (match == null) {
    console.warn("WARN: Could not find remote-control status read needle - skipping Linux remote-control status guard patch");
    return source;
  }

  const [
    needle,
    functionName,
    storeVar,
    clientVar,
    hostVar,
    generationVar,
    generationFn,
    initialValueVar,
    statusAtomVar,
    notificationParamsVar,
    isCurrentFn,
    statusSetterFn,
    readResultVar,
    errorVar,
    loggerVar,
  ] = match;
  const replacement =
    `function ${REMOTE_CONTROL_STATUS_READ_GUARD_MARKER}(e){return !(typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)&&typeof e==\`string\`&&(e.startsWith(\`remote-ssh\`)||e.startsWith(\`remote-control:\`)))}` +
    `function ${functionName}(${storeVar},${clientVar}){let ${hostVar}=${clientVar}.getHostId(),${generationVar}=${generationFn}(${storeVar},${hostVar}),${initialValueVar}=${storeVar}.get(${statusAtomVar},${hostVar});` +
    `${clientVar}.addNotificationCallback(\`remoteControl/status/changed\`,({params:${notificationParamsVar}})=>{${isCurrentFn}(${storeVar},${hostVar},${generationVar})&&${statusSetterFn}(${storeVar},${hostVar},${notificationParamsVar})});` +
    `if(!${REMOTE_CONTROL_STATUS_READ_GUARD_MARKER}(${hostVar})){${isCurrentFn}(${storeVar},${hostVar},${generationVar})&&${statusSetterFn}(${storeVar},${hostVar},{status:\`disabled\`,available:!1,accessRequired:!1});return}` +
    `${clientVar}.sendRequest(\`remoteControl/status/read\`,void 0).then(${readResultVar}=>{${storeVar}.get(${statusAtomVar},${hostVar})===${initialValueVar}&&${isCurrentFn}(${storeVar},${hostVar},${generationVar})&&${statusSetterFn}(${storeVar},${hostVar},${readResultVar})}).catch(${errorVar}=>{${isCurrentFn}(${storeVar},${hostVar},${generationVar})&&${loggerVar}.error(\`Failed to read remote-control status\`,{safe:{},sensitive:{error:${errorVar}}})})}`;

  return source.replace(needle, replacement);
}

function applyLinuxRemoteControlStatusWaitPatch(source) {
  if (source.includes(REMOTE_CONTROL_STATUS_WAIT_MARKER)) {
    return source;
  }
  if (
    !source.includes("Timed out waiting for remote control to connect") ||
    !source.includes("remoteControl/status/changed")
  ) {
    return source;
  }

  const timeoutVariableMatch = source.match(
    /setTimeout\(\(\)=>\{[^}]{0,300}Timed out waiting for remote control to connect[^}]{0,300}\},([A-Za-z_$][\w$]*)\)/u,
  );
  if (timeoutVariableMatch == null) {
    console.warn("WARN: Could not find remote-control status timeout variable - skipping Linux remote-control status wait patch");
    return source;
  }

  const timeoutVariable = timeoutVariableMatch[1];
  const statusWaitRegex = new RegExp(
    `\\b${escapeRegExp(timeoutVariable)}=5e3(?=,[A-Za-z_$][\\w$]*=([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*),e=>null\\),[A-Za-z_$][\\w$]*=\\1\\(\\2,e=>!1\\),[A-Za-z_$][\\w$]*=[A-Za-z_$][\\w$]*\\(\\2,)`,
    "u",
  );
  if (!statusWaitRegex.test(source)) {
    console.warn("WARN: Could not find remote-control status wait needle - skipping Linux remote-control status wait patch");
    return source;
  }

  return source.replace(
    statusWaitRegex,
    `${timeoutVariable}=typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)?3e4:5e3/*${REMOTE_CONTROL_STATUS_WAIT_MARKER}*/`,
  );
}

function applyLinuxRemoteControlEnablementBridgePatch(source) {
  let patched = source;

  patched = applyLinuxRemoteControlEnableForHostParamsPatch(patched);

  const markerIndex = patched.indexOf("[remote-connections/gate-bridge]");
  const enablementIndex = patched.indexOf("set-remote-control-connections-enabled");
  if (markerIndex < 0 || enablementIndex < 0) {
    if (
      !patched.includes(REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER) ||
      !patched.includes(REMOTE_CONTROL_SELF_AUTO_CONNECT_MARKER)
    ) {
      console.warn("WARN: Could not find current remote-control enablement bridge anchors - skipping Linux remote-control bridge patch");
    }
    return patched;
  }
  if (Math.abs(markerIndex - enablementIndex) > 4_500) {
    console.warn("WARN: Remote-control enablement bridge anchors are too far apart - skipping Linux remote-control bridge patch");
    return patched;
  }

  const regionStart = Math.max(0, Math.min(markerIndex, enablementIndex) - 1_000);
  const regionEnd = Math.min(patched.length, Math.max(markerIndex, enablementIndex) + 4_500);
  const prefix = patched.slice(0, regionStart);
  const suffix = patched.slice(regionEnd);
  let region = patched.slice(regionStart, regionEnd);

  if (!patched.includes(REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER)) {
    const currentBridgePattern =
      /function ([A-Za-z_$][\w$]*)\(\)\{let ([A-Za-z_$][\w$]*)=\(0,([A-Za-z_$][\w$]*)\.c\)\(6\),\{checkGate:([A-Za-z_$][\w$]*),isLoading:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\(\),([A-Za-z_$][\w$]*);\2\[0\]===\4\?\7=\2\[1\]:\(\7=\4\(`1042620455`\)\|\|\4\(`2055603567`\),\2\[0\]=\4,\2\[1\]=\7\);let ([A-Za-z_$][\w$]*)=\7,([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*);return /u;
    let patchedRegion = region.replace(
      currentBridgePattern,
      (needle, _functionName, _cacheVar, _compilerVar, _checkGateVar, _isLoadingVar, _gateHookVar, gateValueVar, enabledVar) =>
        needle.replace(
          `let ${enabledVar}=${gateValueVar},`,
          `let ${enabledVar}=${gateValueVar}||/*${REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER}*/typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`),`,
        ),
    );
    if (patchedRegion === region) {
      console.warn("WARN: Could not find remote-control enablement bridge needle - skipping Linux remote-control bridge patch");
      return patched;
    }

    region = patchedRegion;
  }

  if (region.includes(REMOTE_CONTROL_SELF_AUTO_CONNECT_MARKER)) {
    return prefix + region + suffix;
  }

  const selfAutoConnectReplacement = (desktopHostRequestFn, enabledVar, errorVar, loggerVar, logPrefixVar) =>
    `${desktopHostRequestFn}(\`set-remote-control-connections-enabled\`,{params:{enabled:${enabledVar}}}).then(async e=>{if(${enabledVar}&&typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)){let t=e?.remoteControlConnections??e?.sharedObjects?.remote_control_connections??e?.connections??[],n=e?.sharedObjects?.local_remote_control_installation_id??e?.local_remote_control_installation_id??e?.localRemoteControlInstallationId??e?.installationId??e?.installation_id??null;if(t.length===0)try{let e=await ${desktopHostRequestFn}(\`refresh-remote-control-connections\`,{params:{}});t=e?.remoteControlConnections??e?.sharedObjects?.remote_control_connections??e?.connections??[],n=n??e?.sharedObjects?.local_remote_control_installation_id??e?.local_remote_control_installation_id??e?.localRemoteControlInstallationId??e?.installationId??e?.installation_id??null}catch(e){${loggerVar}.warning(\`\${${logPrefixVar}} self_auto_connect_refresh_failed\`,{safe:{},sensitive:{error:e}})}if(n==null)try{let e=await ${desktopHostRequestFn}(\`get-global-state\`,{params:{key:\`electron-local-remote-control-installation-id\`}});n=e?.value??e?.state?.value??e?.globalState?.[\`electron-local-remote-control-installation-id\`]??null}catch(e){${loggerVar}.warning(\`\${${logPrefixVar}} self_auto_connect_identity_failed\`,{safe:{},sensitive:{error:e}})}let r=t.filter(e=>typeof e?.hostId==\`string\`&&e.hostId.startsWith(\`remote-control:\`)),i=new Set(r.filter(e=>n!=null&&(e.installationId??e.installation_id)===n).map(e=>e.hostId));await Promise.all(r.filter(e=>i.has(e.hostId)).map(e=>${desktopHostRequestFn}(\`set-remote-connection-auto-connect\`,{params:{hostId:e.hostId,autoConnect:!0}}).catch(t=>{${loggerVar}.warning(\`\${${logPrefixVar}} self_auto_connect_failed\`,{safe:{autoConnect:!0},sensitive:{hostId:e.hostId,error:t}})})))}}/*${REMOTE_CONTROL_SELF_AUTO_CONNECT_MARKER}*/).catch(${errorVar}=>{${loggerVar}.warning(\`\${${logPrefixVar}} sync_failed\`,{safe:{enabled:${enabledVar}},sensitive:{error:${errorVar}}})})`;

  const selfAutoConnectPattern =
    /([A-Za-z_$][\w$]*)\(`set-remote-control-connections-enabled`,\{params:\{enabled:([A-Za-z_$][\w$]*)\}\}\)\.catch\(([A-Za-z_$][\w$]*)=>\{([A-Za-z_$][\w$]*)\.warning\(`\$\{([A-Za-z_$][\w$]*)\} sync_failed`,\{safe:\{remoteControlConnectionsEnabled:\2\},sensitive:\{error:\3\}\}\)\}\)/u;
  const selfAutoConnectRegion = region.replace(
    selfAutoConnectPattern,
    (_needle, desktopHostRequestFn, enabledVar, errorVar, loggerVar, logPrefixVar) =>
      selfAutoConnectReplacement(desktopHostRequestFn, enabledVar, errorVar, loggerVar, logPrefixVar),
  );

  if (selfAutoConnectRegion === region) {
    console.warn("WARN: Could not find remote-control self auto-connect needle - skipping Linux remote-control auto-connect patch");
    return prefix + region + suffix;
  }

  return prefix + selfAutoConnectRegion + suffix;
}

function applyLinuxRemoteControlEnableForHostParamsPatch(source) {
  let patched = source;

  if (!patched.includes(REMOTE_CONTROL_ENABLE_FOR_HOST_PARAMS_MARKER)) {
    const enabledForHostNullParamsPattern =
      /("set-remote-control-enabled-for-host":[A-Za-z_$][\w$]*\(\([A-Za-z_$][\w$]*,\{enabled:[A-Za-z_$][\w$]*\}\)=>[A-Za-z_$][\w$]*\.sendRequest\([A-Za-z_$][\w$]*\?`remoteControl\/enable`:`remoteControl\/disable`,)null(\)\))/u;
    const beforeEnableForHostParamsPatch = patched;
    patched = patched.replace(
      enabledForHostNullParamsPattern,
      `$1void 0/*${REMOTE_CONTROL_ENABLE_FOR_HOST_PARAMS_MARKER}*/$2`,
    );
    if (
      patched === beforeEnableForHostParamsPatch &&
      patched.includes("set-remote-control-enabled-for-host")
    ) {
      console.warn("WARN: Could not find remote-control enable-for-host params needle - skipping Linux remote-control host params patch");
    }
  }

  return patched;
}

function applyLinuxRemoteMobileActiveStatusPatch(source) {
  if (source.includes(REMOTE_MOBILE_ACTIVE_STATUS_MARKER)) {
    return source;
  }
  if (
    source.includes("e.resumeState===`needs_resume`?e.threadRuntimeStatus:null") &&
    source.includes("?`running`:e.hasUnreadTurn?`review`:`idle`")
  ) {
    return source;
  }

  const statusPattern =
    /function ([A-Za-z_$][\w$]*)\(\{latestTurnStatus:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),streamRole:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \4==null\?\3===`needs_resume`\?`needs-resume`:`read-only`:\4\.role===`follower`\?`follower`:\5\?\.type===`active`\|\|\2===`inProgress`\?`active`:`inactive`\}/u;
  if (!statusPattern.test(source)) {
    if (source.includes("latestTurnStatus:") && source.includes("streamRole:") && source.includes("threadRuntimeStatus:")) {
      console.warn("WARN: Could not find active-status renderer needle - skipping remote mobile active-status patch");
    }
    return source;
  }

  return source.replace(
    statusPattern,
    `function $1({latestTurnStatus:$2,resumeState:$3,streamRole:$4,threadRuntimeStatus:$5}){/*${REMOTE_MOBILE_ACTIVE_STATUS_MARKER}*/return $4?.role===\`follower\`?\`follower\`:$5?.type===\`active\`||$2===\`inProgress\`?\`active\`:$4==null?$3===\`needs_resume\`?\`needs-resume\`:\`read-only\`:\`inactive\`}`,
  );
}

function applyLinuxRemoteMobileReasoningSummaryPatch(source) {
  if (source.includes(REMOTE_MOBILE_REASONING_SUMMARY_MARKER)) {
    return source;
  }

  const logMarker = "Reasoning summary turn-start config resolved";
  const logIndex = source.indexOf(logMarker);
  if (logIndex === -1) {
    console.warn(
      "WARN: Could not find reasoning-summary turn-start log marker - skipping Linux remote mobile summary patch",
    );
    return source;
  }

  const functionStart = source.lastIndexOf("async function ", logIndex);
  const turnStartPrefix = functionStart === -1 ? "" : source.slice(functionStart, logIndex);
  const summaryPattern =
    /(?<prefix>let |,)(?<featureOverride>[A-Za-z_$][\w$]*)=(?<manager>[A-Za-z_$][\w$]*)\.getDefaultFeatureOverride\([A-Za-z_$][\w$]*\)===!0,(?<summary>[A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\?\.summary\?\?`none`;(?<latestSettings>[A-Za-z_$][\w$]*)\?\.summary!==void 0&&\(\k<summary>=\k<latestSettings>\.summary\),\k<featureOverride>&&\(\k<summary>=`detailed`\),(?<request>[A-Za-z_$][\w$]*)\.summary!==void 0&&\(\k<summary>=\k<request>\.summary\);/u;
  const summaryMatch = turnStartPrefix.match(summaryPattern);
  if (summaryMatch == null) {
    console.warn(
      "WARN: Could not find reasoning-summary turn-start resolver - skipping Linux remote mobile summary patch",
    );
    return source;
  }

  const {
    featureOverride: featureOverrideVar,
    manager: managerVar,
    request: requestVar,
    summary: summaryVar,
  } = summaryMatch.groups;
  const localHostPattern = new RegExp(
    `!([A-Za-z_$][\\w$]*)\\(${escapeRegExp(managerVar)}\\.getHostId\\(\\)\\)`,
    "u",
  );
  const localHostMatch = turnStartPrefix.match(localHostPattern);
  if (localHostMatch == null) {
    console.warn(
      "WARN: Could not find local-host turn-start guard - skipping Linux remote mobile summary patch",
    );
    return source;
  }

  const localHostClassifier = localHostMatch[1];
  const replacement =
    `${summaryMatch[0]}/*${REMOTE_MOBILE_REASONING_SUMMARY_MARKER}*/` +
    `navigator.userAgent.includes(\`Linux\`)&&!${localHostClassifier}(${managerVar}.getHostId())&&${requestVar}.summary===void 0&&(${featureOverrideVar}=!1,${summaryVar}=\`none\`);`;
  const absoluteMatchStart = functionStart + summaryMatch.index;
  return `${source.slice(0, absoluteMatchStart)}${replacement}${source.slice(absoluteMatchStart + summaryMatch[0].length)}`;
}

module.exports = [
  {
    id: "linux-remote-control-device-key",
    phase: "main-bundle",
    order: 20_100,
    ciPolicy: "optional",
    apply: applyLinuxRemoteControlDeviceKeyPatch,
  },
  {
    id: "linux-remote-control-client-revocation-recovery",
    phase: "main-bundle",
    order: 20_116,
    ciPolicy: "optional",
    apply: applyLinuxRemoteControlClientRevocationRecoveryPatch,
  },
  {
    id: "linux-remote-mobile-app-server-remote-control",
    phase: "extracted-app:post-webview",
    order: 20_117,
    ciPolicy: "optional",
    apply: applyLinuxRemoteMobileAppServerRemoteControlExtractedAppPatch,
  },
  {
    id: "linux-remote-control-load-gate",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_118,
    ciPolicy: "optional",
    missingDescription: "remote-control loader gate bundle",
    skipDescription: "Linux remote-control load gate patch",
    apply: applyLinuxRemoteControlLoadGatePatch,
  },
  {
    id: "linux-remote-control-integration-sync",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_119,
    ciPolicy: "optional",
    missingDescription: "webview app main bundle",
    skipDescription: "Linux remote-control integration sync patch",
    apply: applyLinuxRemoteControlIntegrationSyncPatch,
  },
  {
    id: "linux-remote-control-visibility",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_120,
    ciPolicy: "optional",
    missingDescription: "remote-control connections visibility bundle",
    skipDescription: "Linux remote-control visibility patch",
    apply: applyLinuxRemoteControlVisibilityPatch,
  },
  {
    id: "linux-remote-control-copy",
    phase: "webview-asset",
    pattern: /^(?:codex-mobile-setup-dialog|remote-connections-settings)-.*\.js$/,
    order: 20_130,
    ciPolicy: "optional",
    missingDescription: "remote-control settings or mobile setup bundle",
    skipDescription: "Linux remote-control copy patch",
    apply: applyLinuxRemoteControlCopyPatch,
  },
  {
    id: "linux-remote-control-settings-ux",
    phase: "webview-asset",
    pattern: /^remote-connections-settings-.*\.js$/,
    order: 20_135,
    ciPolicy: "optional",
    missingDescription: "remote connections settings bundle",
    skipDescription: "Linux remote-control settings UX patch",
    apply: applyLinuxRemoteControlSettingsUxPatch,
  },
  {
    id: "linux-remote-control-client-revoke-setup-reset",
    phase: "webview-asset",
    pattern: /^remote-connections-settings-.*\.js$/,
    order: 20_138,
    ciPolicy: "optional",
    missingDescription: "remote connections settings bundle",
    skipDescription: "Linux remote-control client revoke setup reset patch",
    apply: applyLinuxRemoteControlClientRevokeSetupResetPatch,
  },
  {
    id: "linux-remote-connections-refresh",
    phase: "webview-asset",
    pattern: /^remote-connections-settings-.*\.js$/,
    order: 20_140,
    ciPolicy: "optional",
    missingDescription: "remote connections settings bundle",
    skipDescription: "Linux remote-connections refresh patch",
    apply: applyLinuxRemoteConnectionsRefreshPatch,
  },
  {
    id: "linux-remote-mobile-reasoning-summary-none",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_149,
    ciPolicy: "optional",
    missingDescription: "turn-start reasoning summary resolver",
    skipDescription: "Linux remote-mobile reasoning summary patch",
    apply: applyLinuxRemoteMobileReasoningSummaryPatch,
  },
  {
    id: "linux-remote-mobile-conversation-hydration",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_150,
    ciPolicy: "optional",
    missingDescription: "app-server manager signals bundle",
    skipDescription: "Linux remote-mobile conversation hydration patch",
    apply: applyLinuxRemoteMobileConversationHydrationPatch,
  },
  {
    id: "linux-remote-mobile-completed-item-recovery",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_151,
    ciPolicy: "optional",
    missingDescription: "app-server conversation manager bundle",
    skipDescription: "Linux remote-mobile completed item recovery patch",
    apply: applyLinuxRemoteMobileCompletedItemRecoveryPatch,
  },
  {
    id: "linux-remote-terminal-status-recovery",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_152,
    ciPolicy: "optional",
    missingDescription: "app-server conversation manager bundle",
    skipDescription: "Linux remote terminal status recovery patch",
    apply: applyLinuxRemoteTerminalStatusRecoveryPatch,
  },
  {
    id: "linux-remote-control-status-read-guard",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_153,
    ciPolicy: "optional",
    missingDescription: "app-server manager signals bundle",
    skipDescription: "Linux remote-control status read guard patch",
    apply: applyLinuxRemoteControlStatusReadGuardPatch,
  },
  {
    id: "linux-remote-control-status-wait",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_154,
    ciPolicy: "optional",
    missingDescription: "app-server manager signals bundle",
    skipDescription: "Linux remote-control status wait patch",
    apply: applyLinuxRemoteControlStatusWaitPatch,
  },
  {
    id: "linux-remote-control-enable-for-host-params",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_155,
    ciPolicy: "optional",
    missingDescription: "app main remote-control host toggle bundle",
    skipDescription: "Linux remote-control host toggle params patch",
    apply: applyLinuxRemoteControlEnableForHostParamsPatch,
  },
  {
    id: "linux-remote-control-enablement-bridge",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_156,
    ciPolicy: "optional",
    missingDescription: "app main bundle",
    skipDescription: "Linux remote-control enablement bridge patch",
    apply: applyLinuxRemoteControlEnablementBridgePatch,
  },
  {
    id: "linux-remote-mobile-active-status",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN,
    order: 20_160,
    ciPolicy: "optional",
    missingDescription: "app main bundle",
    skipDescription: "Linux remote-mobile active status patch",
    apply: applyLinuxRemoteMobileActiveStatusPatch,
  },
];

module.exports.applyLinuxRemoteControlDeviceKeyPatch = applyLinuxRemoteControlDeviceKeyPatch;
module.exports.applyLinuxRemoteMobileAppServerRemoteControlPatch =
  applyLinuxRemoteMobileAppServerRemoteControlPatch;
module.exports.applyLinuxRemoteMobileChromeBridgePatch = applyLinuxRemoteMobileChromeBridgePatch;
module.exports.applyLinuxRemoteMobileCompletedItemRecoveryPatch =
  applyLinuxRemoteMobileCompletedItemRecoveryPatch;
module.exports.applyLinuxRemoteMobileConversationHydrationPatch = applyLinuxRemoteMobileConversationHydrationPatch;
module.exports.applyLinuxRemoteMobileReasoningSummaryPatch = applyLinuxRemoteMobileReasoningSummaryPatch;
module.exports.applyLinuxRemoteTerminalStatusRecoveryPatch = applyLinuxRemoteTerminalStatusRecoveryPatch;
module.exports.applyLinuxRemoteControlStatusReadGuardPatch = applyLinuxRemoteControlStatusReadGuardPatch;
module.exports.applyLinuxRemoteControlStatusWaitPatch = applyLinuxRemoteControlStatusWaitPatch;
module.exports.applyLinuxRemoteControlEnablementBridgePatch = applyLinuxRemoteControlEnablementBridgePatch;
module.exports.applyLinuxRemoteControlEnableForHostParamsPatch =
  applyLinuxRemoteControlEnableForHostParamsPatch;
module.exports.applyLinuxRemoteMobileActiveStatusPatch = applyLinuxRemoteMobileActiveStatusPatch;
module.exports.applyLinuxRemoteControlClientRevocationRecoveryPatch =
  applyLinuxRemoteControlClientRevocationRecoveryPatch;
module.exports.applyLinuxRemoteControlClientRevokeSetupResetPatch =
  applyLinuxRemoteControlClientRevokeSetupResetPatch;
module.exports.applyLinuxRemoteControlLoadGatePatch = applyLinuxRemoteControlLoadGatePatch;
module.exports.applyLinuxRemoteConnectionsRefreshPatch = applyLinuxRemoteConnectionsRefreshPatch;
module.exports.applyLinuxRemoteControlIntegrationSyncPatch = applyLinuxRemoteControlIntegrationSyncPatch;
module.exports.applyLinuxRemoteControlVisibilityPatch = applyLinuxRemoteControlVisibilityPatch;
module.exports.applyLinuxRemoteControlCopyPatch = applyLinuxRemoteControlCopyPatch;
module.exports.applyLinuxRemoteControlSshInstallActionPatch = applyLinuxRemoteControlSshInstallActionPatch;
module.exports.applyLinuxRemoteControlSshInstallReleasePatch = applyLinuxRemoteControlSshInstallReleasePatch;
module.exports.applyLinuxRemoteControlSettingsUxPatch = applyLinuxRemoteControlSettingsUxPatch;
