"use strict";

const MAX_WRAPPER_TEXT_LENGTH = 4096;
const MAX_WRAPPER_ARGS = 64;
const WRAPPER_PROPERTY = "chatgptLinuxSshCommandWrapper";
const WRAPPER_TEXT_PROPERTY = "chatgptLinuxSshCommandWrapperText";
const MAIN_MARKER = "function chatgptLinuxSshCommandWrapperArgs(";
const WEBVIEW_MARKER = "function chatgptLinuxParseSshCommandWrapper(";
const MAIN_HELPER_MARKERS = [
  MAIN_MARKER,
  "function chatgptLinuxSshCommandWrapperQuote(",
  "function chatgptLinuxSshWrapRemoteCommand(",
];
const WEBVIEW_HELPER_MARKERS = [
  WEBVIEW_MARKER,
  "function chatgptLinuxFormatSshCommandWrapper(",
];

function wrapperError(message) {
  const error = new Error(message);
  error.code = "invalidSshCommandWrapper";
  return error;
}

function parseCommandWrapper(input) {
  if (typeof input !== "string") {
    throw wrapperError("Remote command wrapper must be text");
  }
  if (input.length > MAX_WRAPPER_TEXT_LENGTH) {
    throw wrapperError(`Remote command wrapper must be at most ${MAX_WRAPPER_TEXT_LENGTH} characters`);
  }
  if (input.includes("\0") || /[\r\n]/u.test(input)) {
    throw wrapperError("Remote command wrapper cannot contain NUL or newlines");
  }

  const args = [];
  let value = "";
  let quote = null;
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else value += char;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\") {
        index += 1;
        if (index >= input.length) throw wrapperError("Remote command wrapper has a trailing escape");
        const escaped = input[index];
        value += '$`"\\'.includes(escaped) ? escaped : `\\${escaped}`;
      } else {
        value += char;
      }
      started = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\") {
      index += 1;
      if (index >= input.length) throw wrapperError("Remote command wrapper has a trailing escape");
      value += input[index];
      started = true;
      continue;
    }
    if (/\s/u.test(char)) {
      if (started) {
        args.push(value);
        value = "";
        started = false;
        if (args.length > MAX_WRAPPER_ARGS) {
          throw wrapperError(`Remote command wrapper must have at most ${MAX_WRAPPER_ARGS} arguments`);
        }
      }
      continue;
    }
    if (/[;&|<>]/u.test(char)) {
      throw wrapperError(`Remote command wrapper contains an unquoted shell operator: ${char}`);
    }
    value += char;
    started = true;
  }
  if (quote != null) throw wrapperError("Remote command wrapper has an unterminated quote");
  if (started) args.push(value);
  return validateCommandWrapperArgs(args);
}

function quoteShellArg(value) {
  if (typeof value !== "string" || value.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function formatCommandWrapper(args) {
  const valid = validateCommandWrapperArgs(args);
  return valid.map(quoteShellArg).join(" ");
}

function validateCommandWrapperArgs(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_WRAPPER_ARGS) {
    throw wrapperError("Remote command wrapper argv is invalid");
  }
  let totalLength = 0;
  const result = value.map((arg) => {
    if (typeof arg !== "string" || /[\0\r\n]/u.test(arg)) {
      throw wrapperError("Remote command wrapper argv is invalid");
    }
    totalLength += arg.length;
    return arg;
  });
  if (totalLength > MAX_WRAPPER_TEXT_LENGTH) {
    throw wrapperError("Remote command wrapper argv is too long");
  }
  if (result.length > 0 && result[0].length === 0) {
    throw wrapperError("Remote command wrapper executable cannot be empty");
  }
  const formattedLength = result.reduce(
    (length, arg, index) => length + quoteShellArg(arg).length + (index === 0 ? 0 : 1),
    0,
  );
  if (formattedLength > MAX_WRAPPER_TEXT_LENGTH) {
    throw wrapperError(`Remote command wrapper must format to at most ${MAX_WRAPPER_TEXT_LENGTH} characters`);
  }
  return result;
}

function wrapRemoteCommand(command, args) {
  const valid = validateCommandWrapperArgs(args);
  if (valid.length === 0) return command;
  return `exec ${valid.map(quoteShellArg).join(" ")} ${quoteShellArg(command)}`;
}

function countOccurrences(source, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    index = source.indexOf(needle, index);
    if (index < 0) return count;
    count += 1;
    index += needle.length;
  }
}

function replacementState(source, config) {
  const before = config.replacements.map(([needle]) => countOccurrences(source, needle));
  const after = config.replacements.map(([, replacement]) => countOccurrences(source, replacement));
  const helpers = config.helperMarkers.map((marker) => countOccurrences(source, marker));
  const helperSource = countOccurrences(source, config.helperSource());
  const anchors = config.requiredAnchors.map((anchor) => countOccurrences(source, anchor));
  const fresh =
    helpers.every((count) => count === 0) &&
    anchors.every((count) => count === 1) &&
    before.every((count) => count === 1) &&
    after.every((count) => count === 0);
  const complete =
    helpers.every((count) => count === 1) &&
    helperSource === 1 &&
    anchors.every((count) => count === 1) &&
    before.every((count) => count === 0) &&
    after.every((count) => count === 1);
  return { fresh, complete, before, after, helpers, helperSource, anchors };
}

function warnUnexpectedPatchState(label, state) {
  console.warn(
    `WARN: SSH command-wrapper ${label} patch is partial, ambiguous, or drifted ` +
    `(before=[${state.before.join(",")}], after=[${state.after.join(",")}], ` +
    `helpers=[${state.helpers.join(",")}], helperSource=${state.helperSource}, ` +
    `anchors=[${state.anchors.join(",")}])`,
  );
}

function replaceExactlyOnce(source, needle, replacement, label) {
  const count = countOccurrences(source, needle);
  if (count !== 1) {
    console.warn(`WARN: Expected exactly one ${label}; found ${count} - skipping SSH command-wrapper patch`);
    return null;
  }
  return source.replace(needle, replacement);
}

function applyCompletePatch(source, config) {
  const initialState = replacementState(source, config);
  if (initialState.complete) return source;
  if (!initialState.fresh) {
    warnUnexpectedPatchState(config.label, initialState);
    return source;
  }

  let patched = replaceExactlyOnce(
    source,
    config.helperAnchor,
    `${config.helperSource()}${config.helperAnchor}`,
    `${config.label} helper insertion`,
  );
  if (patched == null) return source;

  for (const [needle, replacement, label] of config.replacements) {
    patched = replaceExactlyOnce(patched, needle, replacement, label);
    if (patched == null) return source;
  }

  const finalState = replacementState(patched, config);
  if (!finalState.complete) {
    warnUnexpectedPatchState(config.label, finalState);
    return source;
  }
  return patched;
}

function mainHelperSource() {
  return [
    "function chatgptLinuxSshCommandWrapperArgs(e){if(e==null)return[];if(!Array.isArray(e)||e.length>64)throw Error(`Invalid SSH remote command wrapper`);let t=0,n=e.map(e=>{if(typeof e!=`string`||/[\\0\\r\\n]/u.test(e))throw Error(`Invalid SSH remote command wrapper`);if(t+=e.length,t>4096)throw Error(`Invalid SSH remote command wrapper`);return e});if(n.length>0&&n[0].length===0||n.map(chatgptLinuxSshCommandWrapperQuote).join(` `).length>4096)throw Error(`Invalid SSH remote command wrapper`);return n}",
    "function chatgptLinuxSshCommandWrapperQuote(e){return e.length>0&&/^[A-Za-z0-9_@%+=:,./-]+$/u.test(e)?e:`'${e.replaceAll(`'`,`'\\\\''`)}'`}",
    "function chatgptLinuxSshWrapRemoteCommand(e,t){let n=chatgptLinuxSshCommandWrapperArgs(t);return n.length===0?e:`exec ${n.map(chatgptLinuxSshCommandWrapperQuote).join(` `)} ${chatgptLinuxSshCommandWrapperQuote(e)}`}",
  ].join("");
}

function currentMainBundleSchema(source) {
  const schemaMatches = Array.from(
    source.matchAll(
      /var ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(\{sshAlias:\2\.([A-Za-z_$][\w$]*)\(\)\.nullable\(\),sshHost:\2\.\4\(\),sshPort:\2\.([A-Za-z_$][\w$]*)\(\)\.nullable\(\),identity:\2\.\4\(\)\.nullable\(\)(?:,chatgptLinuxSshCommandWrapper:\2\.[A-Za-z_$][\w$]*\(\2\.\4\(\)\)\.optional\(\))?\}\);/gu,
    ),
  );
  if (schemaMatches.length !== 1) {
    console.warn(
      "WARN: Expected one current main-bundle SSH host schema; found " +
      schemaMatches.length +
      " - skipping SSH command-wrapper patch",
    );
    return null;
  }
  const [, schemaName, namespace, objectFactory, stringFactory, numberFactory] = schemaMatches[0];
  const escapedNamespace = namespace.replaceAll("$", "\\$");
  const arrayFactories = new Set(
    Array.from(
      source.matchAll(
        new RegExp(
          `${escapedNamespace}\\.([A-Za-z_$][\\w$]*)\\(${escapedNamespace}\\.${stringFactory}\\(\\)\\)`,
          "gu",
        ),
      ),
      (match) => match[1],
    ),
  );
  if (arrayFactories.size !== 1) {
    console.warn(
      "WARN: Expected one current main-bundle array schema factory; found " +
      arrayFactories.size +
      " - skipping SSH command-wrapper patch",
    );
    return null;
  }
  const arrayFactory = arrayFactories.values().next().value;
  const cleanSchemaSource =
    `var ${schemaName}=${namespace}.${objectFactory}({sshAlias:${namespace}.${stringFactory}().nullable(),` +
    `sshHost:${namespace}.${stringFactory}(),sshPort:${namespace}.${numberFactory}().nullable(),` +
    `identity:${namespace}.${stringFactory}().nullable()});`;
  return {
    arrayFactory,
    cleanSchemaSource,
    namespace,
    patchedSchemaSource:
      cleanSchemaSource.slice(0, -3) +
      `,${WRAPPER_PROPERTY}:${namespace}.${arrayFactory}(${namespace}.${stringFactory}()).optional()});`,
    schemaName,
  };
}

function applyMainBundlePatch(source) {
  const schema = currentMainBundleSchema(source);
  if (schema == null) return source;
  const replacements = [
    [
      "n.Rn({args:[`ssh`,...cC(c),...uC(this.options.sshConnection),GS(e,s)],spawnInsideWsl:!1})",
      `n.Rn({args:[\`ssh\`,...cC(c),...uC(this.options.sshConnection),chatgptLinuxSshWrapRemoteCommand(GS(e,s),this.options.sshConnection.${WRAPPER_PROPERTY})],spawnInsideWsl:!1})`,
      "SSH management command",
    ],
    [
      "(0,x.spawn)(n.Wn.resolve(`ssh`)??`ssh`,[`-T`,...cC(this.options.getConnectTimeoutSeconds?.()),...uC(this.options.sshConnection),GS(r,a)],{env:i.t(process.env),stdio:[`pipe`,`pipe`,`pipe`]})",
      `(0,x.spawn)(n.Wn.resolve(\`ssh\`)??\`ssh\`,[\`-T\`,...cC(this.options.getConnectTimeoutSeconds?.()),...uC(this.options.sshConnection),chatgptLinuxSshWrapRemoteCommand(GS(r,a),this.options.sshConnection.${WRAPPER_PROPERTY})],{env:i.t(process.env),stdio:[\`pipe\`,\`pipe\`,\`pipe\`]})`,
      "SSH app-server proxy command",
    ],
    [
      "return t?{sshConnection:{alias:t.sshAlias,host:t.sshHost,port:t.sshPort,identity:t.identity}}:null",
      `return t?{sshConnection:{alias:t.sshAlias,host:t.sshHost,port:t.sshPort,identity:t.identity,${WRAPPER_PROPERTY}:t.${WRAPPER_PROPERTY}}}:null`,
      "SSH transport host mapping",
    ],
    [
      "function kse(e){let t=e.alias?.trim();return t?`alias:${t}`:[`direct`,e.host,String(e.port??``),e.identity?.trim()??``].join(`",
      `function kse(e){let t=e.alias?.trim(),n=JSON.stringify(chatgptLinuxSshCommandWrapperArgs(e.${WRAPPER_PROPERTY}));return t?\`alias:\${t}:\${n}\`:[\`direct\`,e.host,String(e.port??\`\`),e.identity?.trim()??\`\`,n].join(\``,
      "SSH startup-gate identity",
    ],
    [
      "displayName:e.displayName,autoConnect:!1})",
      `displayName:e.displayName,${WRAPPER_PROPERTY}:e.${WRAPPER_PROPERTY},autoConnect:!1})`,
      "saved alias runtime mapping",
    ],
    [
      "sshPort:e.sshPort,identity:e.identity}]),...t.filter",
      `sshPort:e.sshPort,identity:e.identity,${WRAPPER_PROPERTY}:e.${WRAPPER_PROPERTY}}]),...t.filter`,
      "saved hostname runtime mapping",
    ],
    [
      "sshPort:e.sshPort,identity:e.identity}:{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:`discovered`,alias:e.alias,hostname:null,sshPort:null,identity:null}",
      `sshPort:e.sshPort,identity:e.identity,${WRAPPER_PROPERTY}:e.${WRAPPER_PROPERTY}}:{hostId:e.hostId,connectionAnalyticsId:e.connectionAnalyticsId,displayName:e.displayName,source:\`discovered\`,alias:e.alias,hostname:null,sshPort:null,identity:null,${WRAPPER_PROPERTY}:e.${WRAPPER_PROPERTY}}`,
      "current saved connection normalization",
    ],
    [
      "sshPort:t.sshPort,identity:t.identity}:{hostId:t.hostId,connectionAnalyticsId:t.connectionAnalyticsId,displayName:t.displayName,source:`discovered`,alias:n,hostname:null,sshPort:null,identity:null}",
      `sshPort:t.sshPort,identity:t.identity,${WRAPPER_PROPERTY}:t.${WRAPPER_PROPERTY}}:{hostId:t.hostId,connectionAnalyticsId:t.connectionAnalyticsId,displayName:t.displayName,source:\`discovered\`,alias:n,hostname:null,sshPort:null,identity:null,${WRAPPER_PROPERTY}:t.${WRAPPER_PROPERTY}}`,
      "legacy saved connection normalization",
    ],
    [
      "identity:e.identity}};return e.homeDir",
      `identity:e.identity,${WRAPPER_PROPERTY}:e.${WRAPPER_PROPERTY}}};return e.homeDir`,
      "SSH host metadata",
    ],
    [
      schema.cleanSchemaSource,
      schema.patchedSchemaSource,
      "SSH host metadata schema",
    ],
    [
      "sshPort:e.sshPort,identity:e.identity,codexCliCommand:[]",
      `sshPort:e.sshPort,identity:e.identity,${WRAPPER_PROPERTY}:e.${WRAPPER_PROPERTY},codexCliCommand:[]`,
      "SSH host configuration",
    ],
  ];
  return applyCompletePatch(source, {
    label: "main bundle",
    helperAnchor: "function GS(",
    helperMarkers: MAIN_HELPER_MARKERS,
    requiredAnchors: ["function GS("],
    helperSource: mainHelperSource,
    replacements,
  });
}

function webviewHelperSource() {
  return [
    "function chatgptLinuxParseSshCommandWrapper(e){if(typeof e!=`string`||e.length>4096||/[\\0\\r\\n]/u.test(e))throw Error(`invalid`);let t=[],n=``,r=null,i=!1;for(let a=0;a<e.length;a++){let o=e[a];if(r===`'`){o===`'`?r=null:n+=o,i=!0;continue}if(r===`\\\"`){if(o===`\\\"`)r=null;else if(o===`\\\\`){if(++a>=e.length)throw Error(`invalid`);let t=e[a];n+=`$\\\\\\\"`.includes(t)?t:`\\\\${t}`}else n+=o;i=!0;continue}if(o===`'`||o===`\\\"`){r=o,i=!0;continue}if(o===`\\\\`){if(++a>=e.length)throw Error(`invalid`);n+=e[a],i=!0;continue}if(/\\s/u.test(o)){if(i&&(t.push(n),n=``,i=!1,t.length>64))throw Error(`invalid`);continue}if(/[;&|<>]/u.test(o))throw Error(`invalid`);n+=o,i=!0}if(r!=null)throw Error(`invalid`);if(i&&t.push(n),t.length>64||t.length>0&&t[0].length===0||chatgptLinuxFormatSshCommandWrapper(t).length>4096)throw Error(`invalid`);return t}",
    "function chatgptLinuxFormatSshCommandWrapper(e){if(e==null)return``;if(!Array.isArray(e)||e.length>64)throw Error(`invalid`);let t=0,n=e.map(e=>{if(typeof e!=`string`||/[\\0\\r\\n]/u.test(e))throw Error(`invalid`);if(t+=e.length,t>4096)throw Error(`invalid`);return e.length>0&&/^[A-Za-z0-9_@%+=:,./-]+$/u.test(e)?e:`'${e.replaceAll(`'`,`'\\\\''`)}'`}).join(` `);if(n.length>4096||e.length>0&&e[0].length===0)throw Error(`invalid`);return n}",
  ].join("");
}

function applyWebviewPatch(source) {
  const replacements = [
    [
      "authMode:`none`,identity:``}}",
      `authMode:\`none\`,identity:\`\`,${WRAPPER_TEXT_PROPERTY}:\`\`}}`,
      "new connection draft",
    ],
    [
      "authMode:e.identity==null?`none`:`identity`,identity:e.identity??``}}",
      `authMode:e.identity==null?\`none\`:\`identity\`,identity:e.identity??\`\`,${WRAPPER_TEXT_PROPERTY}:chatgptLinuxFormatSshCommandWrapper(e.${WRAPPER_PROPERTY})}}`,
      "saved connection draft",
    ],
    [
      "identity:e.authMode===`identity`?e.identity.trim():null}:{hostId:",
      `identity:e.authMode===\`identity\`?e.identity.trim():null,${WRAPPER_PROPERTY}:chatgptLinuxParseSshCommandWrapper(e.${WRAPPER_TEXT_PROPERTY})}:{hostId:`,
      "hostname connection save",
    ],
    [
      "sshPort:null,identity:null}}function Xi(",
      `sshPort:null,identity:null,${WRAPPER_PROPERTY}:chatgptLinuxParseSshCommandWrapper(e.${WRAPPER_TEXT_PROPERTY})}}function Xi(`,
      "alias connection save",
    ],
    [
      "let r=[],i=e.displayName.trim();i.length===0&&",
      `let r=[],i=e.displayName.trim();try{chatgptLinuxParseSshCommandWrapper(e.${WRAPPER_TEXT_PROPERTY})}catch{r.push(\`invalidSshCommandWrapper\`)}i.length===0&&`,
      "wrapper validation",
    ],
    [
      // The official cache block tracks only k, j, and M. Replace it whole so
      // the injected field reads the current saving state from u on every render.
      "let N;t[47]!==k||t[48]!==j||t[49]!==M?(N=(0,q.jsx)(ln,{children:(0,q.jsxs)(`div`,{className:`grid grid-cols-1 gap-4`,children:[k,j,M]})}),t[47]=k,t[48]=j,t[49]=M,t[50]=N):N=t[50];",
      `let N=(0,q.jsx)(ln,{children:(0,q.jsxs)(\`div\`,{className:\`grid grid-cols-1 gap-4\`,children:[k,j,M,(0,q.jsx)(v.Field,{name:\`${WRAPPER_TEXT_PROPERTY}\`,children:e=>(0,q.jsx)(ra,{label:(0,q.jsxs)(q.Fragment,{children:[(0,q.jsx)(o,{id:\`settings.remoteConnections.dialog.field.commandWrapper\`,defaultMessage:\`Remote command wrapper\`,description:\`Label for the optional SSH remote command wrapper field\`}),\` \`,(0,q.jsx)(\`span\`,{className:\`font-normal text-secondary\`,children:(0,q.jsx)(o,{id:\`settings.remoteConnections.dialog.field.optional\`,defaultMessage:\`(optional)\`,description:\`Marker shown next to optional fields in the remote connection editor dialog\`})})]}),description:(0,q.jsx)(o,{id:\`settings.remoteConnections.dialog.field.commandWrapper.description\`,defaultMessage:\`Runs every Codex SSH operation through this argv command and appends the generated remote command as its final argument.\`,description:\`Description for the SSH remote command wrapper field\`}),placeholder:\`ssh -T target-host --\`,value:e.state.value,onChange:e.handleChange,onBlur:e.handleBlur,disabled:u})})]})});`,
      "wrapper settings field",
    ],
    [
      "function ia(e){switch(e){case`displayNameRequired`:",
      "function ia(e){switch(e){case`invalidSshCommandWrapper`:return(0,q.jsx)(o,{id:`settings.remoteConnections.dialog.field.commandWrapper.error`,defaultMessage:`Enter a valid command (quotes and escapes are supported; shell operators are not)`,description:`Error for an invalid SSH remote command wrapper`});case`displayNameRequired`:",
      "wrapper validation message",
    ],
  ];
  return applyCompletePatch(source, {
    label: "webview bundle",
    helperAnchor: "function qi(){",
    helperMarkers: WEBVIEW_HELPER_MARKERS,
    requiredAnchors: ["function qi(){", "function $i(e){"],
    helperSource: webviewHelperSource,
    replacements,
  });
}

module.exports = {
  MAX_WRAPPER_ARGS,
  MAX_WRAPPER_TEXT_LENGTH,
  applyMainBundlePatch,
  applyWebviewPatch,
  formatCommandWrapper,
  parseCommandWrapper,
  quoteShellArg,
  validateCommandWrapperArgs,
  wrapRemoteCommand,
  descriptors: [
    {
      id: "main-bundle-ssh-command-wrapper",
      phase: "main-bundle",
      order: 20700,
      ciPolicy: "opt-in",
      apply: applyMainBundlePatch,
    },
    {
      id: "webview-ssh-command-wrapper-settings",
      phase: "webview-asset",
      order: 20710,
      ciPolicy: "opt-in",
      pattern: /^remote-connections-settings-[^.]+\.js$/u,
      missingDescription: "remote-connections settings webview bundle",
      skipDescription: "SSH command-wrapper settings patch",
      apply: applyWebviewPatch,
    },
  ],
};
