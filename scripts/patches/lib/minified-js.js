"use strict";

const TRAY_GUARD_LOOKAHEAD = 1200;
const HANDLER_PREFIX_LOOKBACK = 12000;
const CONTROL_PAREN_KEYWORDS = new Set([
  "catch", "for", "if", "switch", "while", "with",
]);
const REGEX_PREFIX_KEYWORDS = new Set([
  "await", "break", "case", "continue", "debugger", "delete", "do",
  "default", "else", "extends", "in", "instanceof", "new", "of", "return", "throw",
  "typeof", "void", "yield",
]);

function requireName(source, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directMatch = source.match(
    new RegExp(`([A-Za-z_$][\\w$]*)=require\\(([\\\`"'])${escaped}\\2\\)`),
  );
  if (directMatch != null) {
    return directMatch[1];
  }

  if (moduleName === "electron") {
    const wrappedMatch = source.match(
      new RegExp(
        `([A-Za-z_$][\\w$]*)=chatgptLinuxPatchExternalOpen\\(require\\(([\\\`"'])${escaped}\\2\\)\\)`,
      ),
    );
    return wrappedMatch?.[1] ?? null;
  }

  return null;
}

function inferModuleAlias(source, moduleName) {
  const requiredName = requireName(source, moduleName);
  if (requiredName != null) {
    return requiredName;
  }

  if (moduleName === "electron") {
    return source.match(/(?:let|,)\s*([A-Za-z_$][\w$]*)=\{app:\{/u)?.[1] ?? null;
  }
  if (moduleName === "node:path") {
    return source.match(/(?:let|,)\s*([A-Za-z_$][\w$]*)=\{default:\{dirname\(/u)?.[1] ?? null;
  }
  if (moduleName === "node:fs") {
    return source.match(/(?:let|,)\s*([A-Za-z_$][\w$]*)=\{mkdirSync\(/u)?.[1] ?? null;
  }
  if (moduleName === "node:net") {
    return source.match(/(?:let|,)\s*([A-Za-z_$][\w$]*)=\{default:\{createServer\(/u)?.[1] ?? null;
  }

  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const JAVASCRIPT_LITERAL_ESCAPES = Object.freeze({
  "<": "\\u003c",
  ">": "\\u003e",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
});

function serializeJavaScriptValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("JavaScript source value is not serializable");
  }
  return serialized.replace(/[<>\u2028\u2029]/gu, (character) => JAVASCRIPT_LITERAL_ESCAPES[character]);
}

function findCallBlock(source, marker) {
  const markerStart = source.indexOf(marker);
  if (markerStart === -1) {
    return null;
  }

  const blockStart = Math.max(
    source.lastIndexOf("var ", markerStart),
    source.lastIndexOf("let ", markerStart),
    source.lastIndexOf("const ", markerStart),
  );
  const blockEnd = source.indexOf("});", markerStart);
  if (blockStart === -1 || blockEnd === -1) {
    return null;
  }

  return {
    start: blockStart,
    end: blockEnd + "});".length,
    text: source.slice(blockStart, blockEnd + "});".length),
  };
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
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

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function findExecutableJavaScriptSubstring(source, needle, fromIndex = 0) {
  let quote = null;
  let escaped = false;
  let canStartRegex = true;
  let pendingControlParen = false;
  let pendingBreakOrContinue = false;
  let pendingBreakOrContinueLabel = false;
  const parenContexts = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote != null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
        canStartRegex = false;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return -1;
      if (
        (pendingBreakOrContinue || pendingBreakOrContinueLabel) &&
        /[\r\n\u2028\u2029]/u.test(source.slice(index + 2, end))
      ) {
        pendingBreakOrContinue = false;
        pendingBreakOrContinueLabel = false;
        canStartRegex = true;
      }
      index = end + 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end < 0) return -1;
      if (pendingBreakOrContinue || pendingBreakOrContinueLabel) {
        pendingBreakOrContinue = false;
        pendingBreakOrContinueLabel = false;
        canStartRegex = true;
      }
      index = end;
      continue;
    }
    if (index >= fromIndex && source.startsWith(needle, index)) return index;
    if (/\s/.test(char)) {
      if (
        (pendingBreakOrContinue || pendingBreakOrContinueLabel) &&
        /[\r\n\u2028\u2029]/u.test(char)
      ) {
        pendingBreakOrContinue = false;
        pendingBreakOrContinueLabel = false;
        canStartRegex = true;
      }
      continue;
    }
    if (char === "/" && canStartRegex) {
      let inCharacterClass = false;
      let regexEscaped = false;
      for (index += 1; index < source.length; index += 1) {
        const regexChar = source[index];
        if (regexEscaped) {
          regexEscaped = false;
        } else if (regexChar === "\\") {
          regexEscaped = true;
        } else if (regexChar === "[") {
          inCharacterClass = true;
        } else if (regexChar === "]") {
          inCharacterClass = false;
        } else if (regexChar === "/" && !inCharacterClass) {
          while (/[A-Za-z]/.test(source[index + 1] ?? "")) index += 1;
          break;
        }
      }
      canStartRegex = false;
      continue;
    }
    if (char === "/") {
      if (next === "=") index += 1;
      canStartRegex = true;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1;
      while (/[A-Za-z0-9_$]/.test(source[end] ?? "")) end += 1;
      const token = source.slice(index, end);
      if (pendingBreakOrContinue) {
        pendingBreakOrContinue = false;
        pendingBreakOrContinueLabel = true;
        canStartRegex = false;
        index = end - 1;
        continue;
      }
      if (pendingControlParen && token === "await") {
        canStartRegex = true;
        index = end - 1;
        continue;
      }
      pendingControlParen = CONTROL_PAREN_KEYWORDS.has(token);
      pendingBreakOrContinue = token === "break" || token === "continue";
      pendingBreakOrContinueLabel = false;
      canStartRegex = pendingControlParen || REGEX_PREFIX_KEYWORDS.has(token);
      index = end - 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let end = index + 1;
      while (/[A-Za-z0-9._]/.test(source[end] ?? "")) end += 1;
      canStartRegex = false;
      index = end - 1;
      continue;
    }
    if (source.startsWith("...", index)) {
      index += 2;
      canStartRegex = true;
      continue;
    }
    if (char === "(") {
      parenContexts.push(pendingControlParen ? "control" : "expression");
      pendingControlParen = false;
      canStartRegex = true;
      continue;
    }
    pendingControlParen = false;
    pendingBreakOrContinue = false;
    pendingBreakOrContinueLabel = false;
    if (char === ")") {
      canStartRegex = parenContexts.pop() === "control";
      continue;
    }
    if (char === "]") {
      canStartRegex = false;
      continue;
    }
    if (char === "}") {
      canStartRegex = true;
      continue;
    }
    canStartRegex = "([{,;:?=+!*%&|^~<>-".includes(char);
  }
  return -1;
}

function findLastRegexMatch(source, regex) {
  regex.lastIndex = 0;
  let lastMatch = null;
  let match;
  while ((match = regex.exec(source)) != null) {
    lastMatch = match;
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }
  return lastMatch;
}

function findLinuxGlobalStateExpression(prefix) {
  const objectStateMatch = findLastRegexMatch(prefix, /(?:let|,)\s*([A-Za-z_$][\w$]*)=\{globalState:/g);
  const propertyStateMatch = findLastRegexMatch(prefix, /globalState:([A-Za-z_$][\w$]*)\.globalState/g);

  if (objectStateMatch != null && (propertyStateMatch == null || objectStateMatch.index > propertyStateMatch.index)) {
    return `${objectStateMatch[1]}.globalState`;
  }
  if (propertyStateMatch != null) {
    return `${propertyStateMatch[1]}.globalState`;
  }

  return null;
}

function findDisposableVar(prefix) {
  const explicitVar = findLastRegexMatch(prefix, /disposables:([A-Za-z_$][\w$]*)/g)?.[1];
  if (explicitVar != null) {
    return explicitVar;
  }

  const adjacentCtorVar = findLastRegexMatch(
    prefix,
    /([A-Za-z_$][\w$]*)=new [A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*;\1\.add\(/g,
  )?.[1];
  if (adjacentCtorVar != null) {
    return adjacentCtorVar;
  }

  const constructedVar = findLastRegexMatch(
    prefix,
    /([A-Za-z_$][\w$]*)=new [A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/g,
  )?.[1];
  if (constructedVar != null && prefix.includes(`${constructedVar}.add(`)) {
    return constructedVar;
  }

  return null;
}

function findExportedAlias(source, localName) {
  const exportList = source.match(/export\{([^}]*)\}/)?.[1];
  if (exportList == null) {
    return null;
  }

  for (const rawEntry of exportList.split(",")) {
    const entry = rawEntry.trim();
    const aliasMatch = entry.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (aliasMatch != null && aliasMatch[1] === localName) {
      return aliasMatch[2];
    }
    if (entry === localName) {
      return localName;
    }
  }

  return null;
}

module.exports = {
  HANDLER_PREFIX_LOOKBACK,
  TRAY_GUARD_LOOKAHEAD,
  escapeRegExp,
  findCallBlock,
  findDisposableVar,
  findExecutableJavaScriptSubstring,
  findExportedAlias,
  findLastRegexMatch,
  findLinuxGlobalStateExpression,
  findMatchingBrace,
  inferModuleAlias,
  requireName,
  serializeJavaScriptValue,
};
