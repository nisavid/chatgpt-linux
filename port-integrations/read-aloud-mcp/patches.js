"use strict";

const {
  findExecutableJavaScriptSubstring,
} = require("../../scripts/patches/lib/minified-js.js");

const READ_ALOUD_PLUGIN_NAME = "read-aloud";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasReadAloudPluginGate(source) {
  const pluginGateArray = findBundledPluginGateArray(source);
  if (pluginGateArray == null) {
    return false;
  }
  const descriptor = buildReadAloudDescriptor();
  const matchIndex = findExecutableJavaScriptSubstring(
    source,
    descriptor,
    pluginGateArray.start,
  );
  return matchIndex >= pluginGateArray.start && matchIndex + descriptor.length <= pluginGateArray.end;
}

function buildReadAloudDescriptor() {
  return `{installWhenMissing:!0,name:\`${READ_ALOUD_PLUGIN_NAME}\`,isAvailable:({platform:e})=>e===\`linux\`}`;
}

function findMatchingBracket(source, openIndex) {
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
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function executableRegexMatches(source, pattern, text = source, start = 0) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].filter((match) => {
    if (match.index == null) {
      return false;
    }
    const absoluteIndex = start + match.index;
    return findExecutableJavaScriptSubstring(source, match[0], absoluteIndex) === absoluteIndex;
  });
}

function findBundledPluginGateArray(source) {
  const spreadComputerUseRegex = /\.\.\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.computerUse\b/g;
  const candidates = new Map();

  for (const marker of executableRegexMatches(source, spreadComputerUseRegex)) {
    const registryExpression = marker[1];
    let openIndex = source.lastIndexOf("[", marker.index);
    let closeIndex = -1;
    while (openIndex !== -1) {
      closeIndex = findMatchingBracket(source, openIndex);
      if (closeIndex !== -1 && marker.index < closeIndex) {
        break;
      }
      openIndex = source.lastIndexOf("[", openIndex - 1);
      closeIndex = -1;
    }
    if (openIndex !== -1 && closeIndex !== -1) {
      const text = source.slice(openIndex + 1, closeIndex);
      const escapedRegistry = escapeRegExp(registryExpression);
      const latexDescriptorRegex = new RegExp(
        String.raw`\{\.\.\.${escapedRegistry}\.latex,isAvailable:\(\)=>!0\}`,
      );
      const computerUseDescriptorRegex = new RegExp(
        String.raw`\{\.\.\.${escapedRegistry}\.computerUse,[^{}]*isAvailable:\(\{features:[A-Za-z_$][\w$]*,platform:[A-Za-z_$][\w$]*\}\)=>[A-Za-z_$][\w$]*===\`(darwin|win32)\`&&[A-Za-z_$][\w$]*\.computerUse(?:,[^{}]*)?\}`,
        "g",
      );
      const computerUseMatches = executableRegexMatches(
        source,
        computerUseDescriptorRegex,
        text,
        openIndex + 1,
      );
      const computerUsePlatforms = new Set(
        computerUseMatches.map((match) => match[1]),
      );
      const latexMatches = executableRegexMatches(
        source,
        latexDescriptorRegex,
        text,
        openIndex + 1,
      );
      if (
        latexMatches.length === 1 &&
        computerUseMatches.length === 2 &&
        computerUsePlatforms.size === 2 &&
        computerUsePlatforms.has("darwin") &&
        computerUsePlatforms.has("win32")
      ) {
        candidates.set(`${openIndex}:${closeIndex}`, {
          start: openIndex + 1,
          end: closeIndex,
          text,
          registryExpression,
          insertionOffset: latexMatches[0].index,
        });
      }
    }
  }

  if (candidates.size > 1) {
    throw new Error("Required Linux Read Aloud plugin gate patch failed: bundled plugin descriptor array is ambiguous");
  }
  return candidates.values().next().value ?? null;
}

function applyLinuxReadAloudPluginGatePatch(currentSource) {
  if (hasReadAloudPluginGate(currentSource)) {
    return currentSource;
  }

  const pluginGateArray = findBundledPluginGateArray(currentSource);
  if (pluginGateArray == null) {
    if (findExecutableJavaScriptSubstring(currentSource, ".computerUse") >= 0) {
      throw new Error("Required Linux Read Aloud plugin gate patch failed: could not find bundled plugin descriptor array");
    }
    return currentSource;
  }

  const insertionIndex = pluginGateArray.start + pluginGateArray.insertionOffset;
  return `${currentSource.slice(0, insertionIndex)}${buildReadAloudDescriptor()},${currentSource.slice(insertionIndex)}`;
}

const descriptors = [
  {
    id: "linux-read-aloud-plugin-gate",
    phase: "main-bundle",
    order: 155,
    ciPolicy: "required-official-dmg",
    apply: applyLinuxReadAloudPluginGatePatch,
  },
];

module.exports = {
  READ_ALOUD_PLUGIN_NAME,
  applyLinuxReadAloudPluginGatePatch,
  descriptors,
};
