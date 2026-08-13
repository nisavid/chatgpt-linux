#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function warn(message) {
  process.stderr.write(`WARN: ${message}\n`);
}

function sourceIncludesAny(source, texts) {
  return (Array.isArray(texts) ? texts : [texts]).some(
    (text) => typeof text === "string" && text.length > 0 && source.includes(text),
  );
}

function shouldSkipPatch(source, skipIf) {
  if (typeof skipIf === "function") {
    return skipIf(source);
  }
  return sourceIncludesAny(source, skipIf);
}

function patchFile(filePath, patches) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    warn(`Could not read ${filePath}: ${error.message}`);
    return;
  }

  let changed = false;
  for (const {
    label,
    oldText,
    newText,
    alreadyText = newText,
    skipIf = null,
    skipDescription = "target no longer exists in this upstream bundle",
  } of patches) {
    if (source.includes(newText) || sourceIncludesAny(source, alreadyText)) {
      console.log(`${path.basename(filePath)} already patched: ${label}`);
      continue;
    }

    const matchIndex = source.indexOf(oldText);
    if (matchIndex === -1) {
      if (shouldSkipPatch(source, skipIf)) {
        console.log(`${path.basename(filePath)} skipped: ${label} (${skipDescription})`);
        continue;
      }
      warn(`${path.basename(filePath)} missing patch target for ${label}`);
      continue;
    }

    source = `${source.slice(0, matchIndex)}${newText}${source.slice(matchIndex + oldText.length)}`;
    changed = true;
    console.log(`Patched ${path.basename(filePath)}: ${label}`);
  }

  if (changed) {
    fs.writeFileSync(filePath, source, "utf8");
  }
}

function patchFileFirstMatch(filePath, {
  label,
  oldTexts,
  newText,
  alreadyText = newText,
  skipIf = null,
  skipDescription = "target no longer exists in this upstream bundle",
}) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    warn(`Could not read ${filePath}: ${error.message}`);
    return;
  }

  const candidates = oldTexts.map((candidate) =>
    typeof candidate === "string" ? { oldText: candidate, newText } : candidate,
  );
  const alreadyTexts = Array.isArray(alreadyText) ? alreadyText : [alreadyText];
  const alreadyPatched = [newText, ...alreadyTexts, ...candidates.map((candidate) => candidate.newText)]
    .filter((text) => typeof text === "string" && text.length > 0)
    .some((text) => source.includes(text));
  if (alreadyPatched) {
    console.log(`${path.basename(filePath)} already patched: ${label}`);
    return;
  }

  const match = candidates
    .map((candidate) => ({ ...candidate, index: source.indexOf(candidate.oldText) }))
    .find((candidate) => candidate.index !== -1);
  if (!match) {
    if (shouldSkipPatch(source, skipIf)) {
      console.log(`${path.basename(filePath)} skipped: ${label} (${skipDescription})`);
      return;
    }
    warn(`${path.basename(filePath)} missing patch target for ${label}`);
    return;
  }

  const replacement = match.newText ?? newText;
  fs.writeFileSync(
    filePath,
    `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match.oldText.length)}`,
    "utf8",
  );
  console.log(`Patched ${path.basename(filePath)}: ${label}`);
}

const pluginDir = process.argv[2];
if (!pluginDir) {
  throw new Error("Usage: patch-chrome-plugin.js /path/to/chrome/plugin");
}

const scriptsDir = path.resolve(pluginDir, "scripts");

function currentBrowserDiagnosticsContract() {
  const diagnosticsPath = path.join(scriptsDir, "extension-ids.json");
  const helperPath = path.join(scriptsDir, "chromium-browser-diagnostics.mjs");
  let config;
  let helper;
  try {
    config = JSON.parse(fs.readFileSync(diagnosticsPath, "utf8"));
    helper = fs.readFileSync(helperPath, "utf8");
  } catch {
    return false;
  }

  return (
    Array.isArray(config.browserDiagnostics) &&
    config.browserDiagnostics.some((browser) => browser.browserFamily === "chrome") &&
    config.browserDiagnostics.some((browser) => browser.browserFamily === "edge") &&
    helper.includes("export function getBrowserDiagnostics(config, browserFamily)") &&
    helper.includes("export function resolveBrowserUserDataDirectory({") &&
    helper.includes("export function resolveLinuxNativeMessagingManifestPath({")
  );
}

function linuxBrowserDiagnostics(chrome, browserFamily) {
  const common = {
    ...JSON.parse(JSON.stringify(chrome)),
    browserFamily,
  };
  if (browserFamily === "brave") {
    return {
      ...common,
      displayName: "Brave Browser",
      shortDisplayName: "Brave",
      extensionManagementUrl: "brave://extensions",
      linux: {
        commands: ["brave-browser", "brave"],
        configHomeEnvironmentVariables: ["XDG_CONFIG_HOME"],
        nativeMessagingManifestDirectories: [
          ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
        ],
        processNames: ["brave", "brave-browser"],
        userDataDirectorySegments: [
          ".config",
          "BraveSoftware",
          "Brave-Browser",
        ],
      },
    };
  }
  return {
    ...common,
    displayName: "Chromium",
    shortDisplayName: "Chromium",
    extensionManagementUrl: "chrome://extensions",
    linux: {
      commands: ["chromium", "chromium-browser"],
      configHomeEnvironmentVariables: ["XDG_CONFIG_HOME"],
      nativeMessagingManifestDirectories: [
        ".config/chromium/NativeMessagingHosts",
      ],
      processNames: ["chromium", "chromium-browser"],
      userDataDirectorySegments: [".config", "chromium"],
    },
  };
}

function patchCurrentBrowserDiagnostics() {
  if (!currentBrowserDiagnosticsContract()) return false;

  const diagnosticsPath = path.join(scriptsDir, "extension-ids.json");
  const config = JSON.parse(fs.readFileSync(diagnosticsPath, "utf8"));
  const chrome = config.browserDiagnostics.find(
    (browser) => browser.browserFamily === "chrome",
  );
  let changed = false;
  for (const browserFamily of ["brave", "chromium"]) {
    if (
      config.browserDiagnostics.some(
        (browser) => browser.browserFamily === browserFamily,
      )
    ) {
      continue;
    }
    const edgeIndex = config.browserDiagnostics.findIndex(
      (browser) => browser.browserFamily === "edge",
    );
    const insertionIndex = edgeIndex === -1 ? config.browserDiagnostics.length : edgeIndex;
    config.browserDiagnostics.splice(
      insertionIndex,
      0,
      linuxBrowserDiagnostics(chrome, browserFamily),
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(diagnosticsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log("Patched extension-ids.json: Linux Brave and Chromium diagnostics");
  } else {
    console.log("extension-ids.json already patched: Linux Brave and Chromium diagnostics");
  }

  const installManifestPath = path.join(scriptsDir, "installManifest.mjs");
  let installManifest = fs.readFileSync(installManifestPath, "utf8");
  const chromiumManifest = '".config/chromium/NativeMessagingHosts"';
  const braveManifest =
    '".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"';
  if (installManifest.includes(braveManifest)) {
    console.log("installManifest.mjs already patched: Linux Brave native host manifest");
  } else if (installManifest.includes(chromiumManifest)) {
    installManifest = installManifest.replace(
      chromiumManifest,
      `${chromiumManifest},${braveManifest}`,
    );
    fs.writeFileSync(installManifestPath, installManifest, "utf8");
    console.log("Patched installManifest.mjs: Linux Brave native host manifest");
  } else {
    warn(
      "installManifest.mjs current browser diagnostics contract lacks the Chromium native host manifest anchor",
    );
  }

  return true;
}

const usesCurrentBrowserDiagnostics = patchCurrentBrowserDiagnostics();

const linuxExtensionAwareUserDataFallback = `  const linuxChromeUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome");
  const linuxChromeBetaUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-beta");
  const linuxChromeUnstableUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-unstable");
  const linuxChromiumUserDataDirectory = path.join(os.homedir(), ".config", "chromium");
  const linuxBraveUserDataDirectory = path.join(
    os.homedir(),
    ".config",
    "BraveSoftware",
    "Brave-Browser",
  );
  const linuxUserDataCandidates = [
    linuxBraveUserDataDirectory,
    linuxChromeUserDataDirectory,
    linuxChromeBetaUserDataDirectory,
    linuxChromeUnstableUserDataDirectory,
    linuxChromiumUserDataDirectory,
  ].filter((candidate) => fs.existsSync(candidate));
  const linuxCandidateWithInstalledExtension = linuxUserDataCandidates.find(
    (candidate) => {
      try {
        const extensionId = loadRemoteChromeExtensionId();
        return findLatestChromeProfile(candidate) != null &&
          fs.existsSync(
            path.join(
              candidate,
              resolveChromeProfileDirectory(candidate),
              "Extensions",
              extensionId,
            ),
          );
      } catch {
        return false;
      }
    },
  );
  if (linuxCandidateWithInstalledExtension) {
    return linuxCandidateWithInstalledExtension;
  }

  if (linuxUserDataCandidates.length > 0) return linuxUserDataCandidates[0];

  return linuxChromeUserDataDirectory;`;

const linuxDefaultBrowserUserDataFallback = `  const linuxChromeUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome");
  const linuxChromeBetaUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-beta");
  const linuxChromeUnstableUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-unstable");
  const linuxChromiumUserDataDirectory = path.join(os.homedir(), ".config", "chromium");
  const linuxBraveUserDataDirectory = path.join(
    os.homedir(),
    ".config",
    "BraveSoftware",
    "Brave-Browser",
  );
  const defaultBrowser = runCommand(["xdg-settings", "get", "default-web-browser"]);
  if (
    defaultBrowser === "brave-browser.desktop" &&
    fs.existsSync(linuxBraveUserDataDirectory)
  ) {
    return linuxBraveUserDataDirectory;
  }
  if (
    defaultBrowser === "google-chrome-beta.desktop" &&
    fs.existsSync(linuxChromeBetaUserDataDirectory)
  ) {
    return linuxChromeBetaUserDataDirectory;
  }
  if (
    defaultBrowser === "google-chrome-unstable.desktop" &&
    fs.existsSync(linuxChromeUnstableUserDataDirectory)
  ) {
    return linuxChromeUnstableUserDataDirectory;
  }
  if (
    ["chromium.desktop", "chromium-browser.desktop"].includes(defaultBrowser) &&
    fs.existsSync(linuxChromiumUserDataDirectory)
  ) {
    return linuxChromiumUserDataDirectory;
  }

  if (fs.existsSync(linuxBraveUserDataDirectory)) return linuxBraveUserDataDirectory;
  if (fs.existsSync(linuxChromeUserDataDirectory)) return linuxChromeUserDataDirectory;
  if (fs.existsSync(linuxChromeBetaUserDataDirectory)) return linuxChromeBetaUserDataDirectory;
  if (fs.existsSync(linuxChromeUnstableUserDataDirectory)) return linuxChromeUnstableUserDataDirectory;
  if (fs.existsSync(linuxChromiumUserDataDirectory)) return linuxChromiumUserDataDirectory;

  return linuxChromeUserDataDirectory;`;

const linuxRunningProfileResolver = `function resolveChromeProfileDirectoryFromRunningProcess(userDataDirectory) {
  if (process.platform !== "linux") return null;

  const normalizedUserDataDirectory = path.resolve(userDataDirectory);
  const runningProfiles = [];
  for (const processDirectory of linuxProcessDirectories()) {
    const argv = readLinuxProcessArgv(processDirectory);
    if (argv.length === 0 || !isKnownLinuxBrowserCommand(argv[0])) continue;

    const userDataDirectoryArg = chromeArgumentValue(argv, "user-data-dir");
    const processUserDataDirectory = userDataDirectoryArg
      ? path.resolve(userDataDirectoryArg)
      : defaultLinuxUserDataDirectoryForCommand(argv[0]);
    if (processUserDataDirectory !== normalizedUserDataDirectory) continue;

    const profileDirectory = chromeArgumentValue(argv, "profile-directory");
    if (
      profileDirectory &&
      isUsableChromeProfile(userDataDirectory, profileDirectory)
    ) {
      runningProfiles.push(profileDirectory);
    }
  }

  return runningProfiles.at(-1) ?? null;
}

function linuxProcessDirectories() {
  try {
    return fs
      .readdirSync("/proc")
      .filter((entry) => /^\\d+$/.test(entry))
      .map((entry) => path.join("/proc", entry));
  } catch {
    return [];
  }
}

function readLinuxProcessArgv(processDirectory) {
  try {
    return fs
      .readFileSync(path.join(processDirectory, "cmdline"), "utf8")
      .split("\\0")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isKnownLinuxBrowserCommand(command) {
  return [
    "brave",
    "brave-browser",
    "chrome",
    "chrome_crashpad_handler",
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-beta",
    "google-chrome-stable",
    "google-chrome-unstable",
  ].includes(path.basename(command));
}

function defaultLinuxUserDataDirectoryForCommand(command) {
  const commandName = path.basename(command);
  if (["brave", "brave-browser"].includes(commandName)) {
    return path.join(os.homedir(), ".config", "BraveSoftware", "Brave-Browser");
  }
  if (["chromium", "chromium-browser"].includes(commandName)) {
    return path.join(os.homedir(), ".config", "chromium");
  }
  if (commandName === "google-chrome-beta") {
    return path.join(os.homedir(), ".config", "google-chrome-beta");
  }
  if (commandName === "google-chrome-unstable") {
    return path.join(os.homedir(), ".config", "google-chrome-unstable");
  }
  return path.join(os.homedir(), ".config", "google-chrome");
}

function chromeArgumentValue(argv, name) {
  const prefix = \`--\${name}=\`;
  const match = argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

`;

const linuxNativeHostManifestFallback = `  if (process.platform === "linux") {
    const manifestPaths = [
      path.join(
        os.homedir(),
        ".config",
        "google-chrome",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "google-chrome-beta",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "google-chrome-unstable",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "chromium",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
    ];

    return {
      manifestPath:
        manifestPaths.find((candidate) => fs.existsSync(candidate)) ||
        manifestPaths[0],
      registryKey: null,
      registryManifestPath: null,
      registryKeyExists: null,
    };
  }`;

patchFileFirstMatch(path.join(scriptsDir, "installManifest.mjs"), {
  label: "Linux browser native host manifest locations",
  oldTexts: [
    'linux:[".config/google-chrome/NativeMessagingHosts"]',
    'linux:[".config/google-chrome/NativeMessagingHosts",".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"]',
  ],
  newText:
    'linux:[".config/google-chrome/NativeMessagingHosts",".config/google-chrome-beta/NativeMessagingHosts",".config/google-chrome-unstable/NativeMessagingHosts",".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",".config/chromium/NativeMessagingHosts"]',
  skipIf: () => usesCurrentBrowserDiagnostics,
  skipDescription: "current declarative browser diagnostics contract is active",
});

patchFile(path.join(scriptsDir, "check-native-host-manifest.js"), [
  {
    label: "Linux native host manifest locations",
    oldText: `  if (process.platform === "win32") {
    const registryKey = \`\${WINDOWS_NATIVE_HOST_REGISTRY_KEY_PREFIX}\\\\\${expectedHostName}\`;
    const registryManifestPath = readWindowsRegistryDefaultValue(registryKey);

    return {
      manifestPath: registryManifestPath || getDefaultWindowsManifestPath(),
      registryKey,
      registryManifestPath,
      registryKeyExists: registryManifestPath != null,
    };
  }

  throw new Error(
    \`Unsupported platform for native host manifest check: \${process.platform}. This script supports macOS and Windows.\`,
  );`,
    newText: `  if (process.platform === "win32") {
    const registryKey = \`\${WINDOWS_NATIVE_HOST_REGISTRY_KEY_PREFIX}\\\\\${expectedHostName}\`;
    const registryManifestPath = readWindowsRegistryDefaultValue(registryKey);

    return {
      manifestPath: registryManifestPath || getDefaultWindowsManifestPath(),
      registryKey,
      registryManifestPath,
      registryKeyExists: registryManifestPath != null,
    };
  }

${linuxNativeHostManifestFallback}

  throw new Error(
    \`Unsupported platform for native host manifest check: \${process.platform}. This script supports macOS, Linux, and Windows.\`,
  );`,
    alreadyText: '"google-chrome-beta",\n        "NativeMessagingHosts"',
    skipIf: () => usesCurrentBrowserDiagnostics,
    skipDescription: "current declarative browser diagnostics contract is active",
  },
  {
    label: "Linux browser native host manifest fallback",
    oldText: `  if (process.platform === "linux") {
    return {
      manifestPath: path.join(
        os.homedir(),
        ".config",
        "google-chrome",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      registryKey: null,
      registryManifestPath: null,
      registryKeyExists: null,
    };
  }`,
    newText: linuxNativeHostManifestFallback,
    alreadyText: '"google-chrome-beta",\n        "NativeMessagingHosts"',
    skipIf: () => usesCurrentBrowserDiagnostics,
    skipDescription: "current declarative browser diagnostics contract is active",
  },
]);

patchFile(path.join(pluginDir, "skills", "control-chrome", "SKILL.md"), [
  {
    label: "Chrome profile launch guard",
    oldText: `Use the browser bound to \`browser\` for tasks in this skill.`,
    newText: `Use the browser bound to \`browser\` for tasks in this skill.

When more than one Chrome extension instance is connected, enumerate \`agent.browsers.list()\`, inspect each extension instance with \`browser.user.openTabs()\`, and bind by the active browser id that matches the user's visible tab, URL, title, or profile metadata. Ignore connected extension instances that have no user tabs when another profile has active user tabs.

Do not call \`browser.tabs.new()\` until the intended browser/profile has been selected. On Linux, creating a tab on the wrong extension backend can start a different Chrome or Brave profile instead of using the already-open user profile.`,
    alreadyText: "creating a tab on the wrong extension backend",
    skipIf: (source) =>
      source.includes("App-provided in-app-browser context is ambient UI state") &&
      source.includes('agent.browsers.get("extension")'),
    skipDescription: "current explicit browser-selection policy supersedes this guard",
  },
]);

patchFile(path.join(scriptsDir, "installed-browsers.js"), [
  {
    label: "Linux browser inventory",
    oldText: `const KNOWN_BROWSERS = [
  {
    name: "Google Chrome",
    bundleIds: ["com.google.Chrome"],
    appNames: ["Google Chrome.app"],
    commands: ["google-chrome", "chrome"],
    windowsExecutable: "chrome.exe",
  },
];`,
    newText: `const KNOWN_BROWSERS = [
  {
    name: "Google Chrome",
    bundleIds: ["com.google.Chrome"],
    appNames: ["Google Chrome.app"],
    commands: ["google-chrome", "chrome"],
    windowsExecutable: "chrome.exe",
  },
  {
    name: "Google Chrome Beta",
    bundleIds: ["com.google.Chrome.beta"],
    appNames: ["Google Chrome Beta.app"],
    commands: ["google-chrome-beta"],
    windowsExecutable: "chrome.exe",
  },
  {
    name: "Google Chrome Unstable",
    bundleIds: ["com.google.Chrome.canary"],
    appNames: ["Google Chrome Canary.app"],
    commands: ["google-chrome-unstable"],
    windowsExecutable: "chrome.exe",
  },
  {
    name: "Brave Browser",
    bundleIds: ["com.brave.Browser"],
    appNames: ["Brave Browser.app"],
    commands: ["brave-browser", "brave"],
    windowsExecutable: "brave.exe",
  },
  {
    name: "Chromium",
    bundleIds: ["org.chromium.Chromium"],
    appNames: ["Chromium.app"],
    commands: ["chromium", "chromium-browser"],
    windowsExecutable: "chrome.exe",
  },
];`,
    skipIf: () => usesCurrentBrowserDiagnostics,
    skipDescription: "current declarative browser inventory is active",
  },
]);

patchFile(path.join(scriptsDir, "chrome-is-running.js"), [
  {
    label: "Linux browser running-process detection",
    oldText: `const CHROME_PROCESS_NAMES_BY_PLATFORM = {
  darwin: new Set(["Google Chrome", "Google Chrome Helper"]),
  win32: new Set(["chrome.exe"]),
};`,
    newText: `const CHROME_PROCESS_NAMES_BY_PLATFORM = {
  darwin: new Set(["Google Chrome", "Google Chrome Helper"]),
  linux: new Set(["chrome", "google-chrome", "google-chrome-beta", "google-chrome-unstable", "brave", "brave-browser", "chromium", "chromium-browser"]),
  win32: new Set(["chrome.exe"]),
};`,
    skipIf: () => usesCurrentBrowserDiagnostics,
    skipDescription: "current declarative process inventory is active",
  },
]);

patchFileFirstMatch(path.join(scriptsDir, "check-extension-installed.js"), {
  label: "Linux extension-aware browser profile fallback",
  oldTexts: [
    `  return path.join(os.homedir(), ".config", "google-chrome");`,
    `  const linuxChromeUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome");
  if (fs.existsSync(linuxChromeUserDataDirectory)) return linuxChromeUserDataDirectory;

  const linuxBraveUserDataDirectory = path.join(
    os.homedir(),
    ".config",
    "BraveSoftware",
    "Brave-Browser",
  );
  if (fs.existsSync(linuxBraveUserDataDirectory)) return linuxBraveUserDataDirectory;

  return linuxChromeUserDataDirectory;`,
  ],
  newText: linuxExtensionAwareUserDataFallback,
  alreadyText: [
    "linuxChromiumUserDataDirectory",
    "resolveBrowserUserDataDirectory({",
  ],
  skipIf: () => usesCurrentBrowserDiagnostics,
  skipDescription: "current browser-family profile diagnostics are active",
});

patchFileFirstMatch(path.join(scriptsDir, "check-extension-installed.js"), {
  label: "Linux running browser extension profile preference",
  oldTexts: [
    `function resolveChromeProfileDirectory(userDataDirectory) {
  const localStateProfile =
    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);
  if (localStateProfile) return localStateProfile;
`,
  ],
  newText: `function resolveChromeProfileDirectory(userDataDirectory) {
  const runningProfile =
    resolveChromeProfileDirectoryFromRunningProcess(userDataDirectory);
  if (runningProfile) return runningProfile;

  const localStateProfile =
    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);
  if (localStateProfile) return localStateProfile;
`,
  alreadyText: `const runningProfile =
    resolveChromeProfileDirectoryFromRunningProcess(userDataDirectory);`,
});

patchFileFirstMatch(path.join(scriptsDir, "check-extension-installed.js"), {
  label: "Linux running browser extension profile resolver",
  oldTexts: [`function resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {`],
  newText: `${linuxRunningProfileResolver}function resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {`,
  alreadyText: "function linuxProcessDirectories()",
});

patchFileFirstMatch(path.join(scriptsDir, "open-chrome-window.js"), {
  label: "Linux default-browser profile fallback",
  oldTexts: [
    `  return path.join(os.homedir(), ".config", "google-chrome");`,
    `  const linuxChromeUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome");
  if (fs.existsSync(linuxChromeUserDataDirectory)) return linuxChromeUserDataDirectory;

  const linuxBraveUserDataDirectory = path.join(
    os.homedir(),
    ".config",
    "BraveSoftware",
    "Brave-Browser",
  );
  if (fs.existsSync(linuxBraveUserDataDirectory)) return linuxBraveUserDataDirectory;

  return linuxChromeUserDataDirectory;`,
  ],
  newText: linuxDefaultBrowserUserDataFallback,
  alreadyText: [
    "linuxChromiumUserDataDirectory",
    "resolveBrowserUserDataDirectory({",
  ],
  skipIf: () => usesCurrentBrowserDiagnostics,
  skipDescription: "current browser-family profile diagnostics are active",
});

patchFileFirstMatch(path.join(scriptsDir, "open-chrome-window.js"), {
  label: "Linux running browser profile preference",
  oldTexts: [
    `function resolveChromeProfileDirectory(userDataDirectory) {
  const localStateProfile =
    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);
  if (localStateProfile) return localStateProfile;
`,
  ],
  newText: `function resolveChromeProfileDirectory(userDataDirectory) {
  const runningProfile =
    resolveChromeProfileDirectoryFromRunningProcess(userDataDirectory);
  if (runningProfile) return runningProfile;

  const localStateProfile =
    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);
  if (localStateProfile) return localStateProfile;
`,
  alreadyText: `const runningProfile =
    resolveChromeProfileDirectoryFromRunningProcess(userDataDirectory);`,
});

patchFileFirstMatch(path.join(scriptsDir, "open-chrome-window.js"), {
  label: "Linux running browser profile resolver",
  oldTexts: [`function resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {`],
  newText: `${linuxRunningProfileResolver}function resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {`,
  alreadyText: "function linuxProcessDirectories()",
});

patchFile(path.join(scriptsDir, "open-chrome-window.js"), [
  {
    label: "Linux browser window command",
    oldText: `  return {
    command: "google-chrome",
    args: chromeArgs,
  };`,
    newText: `  const linuxUserDataDirectory = resolveChromeUserDataDirectory();
  let linuxCommand = commandPath("google-chrome") || commandPath("chrome") || "google-chrome";
  if (
    linuxUserDataDirectory.includes(
      path.join(".config", "BraveSoftware", "Brave-Browser"),
    )
  ) {
    linuxCommand = commandPath("brave-browser") || commandPath("brave") || "brave-browser";
  } else if (linuxUserDataDirectory.includes(path.join(".config", "google-chrome-beta"))) {
    linuxCommand = commandPath("google-chrome-beta") || "google-chrome-beta";
  } else if (linuxUserDataDirectory.includes(path.join(".config", "google-chrome-unstable"))) {
    linuxCommand = commandPath("google-chrome-unstable") || "google-chrome-unstable";
  } else if (linuxUserDataDirectory.includes(path.join(".config", "chromium"))) {
    linuxCommand = commandPath("chromium") || commandPath("chromium-browser") || "chromium";
  }

  return {
    command: linuxCommand,
    args: chromeArgs,
  };`,
    skipIf: () => usesCurrentBrowserDiagnostics,
    skipDescription: "current browser-family launch command is active",
  },
]);
