"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function cByteArray(value) {
  return [...Buffer.from(`${value}\0`, "utf8")].join(",");
}

function writeNativeNodeTestExecutable(outputPath, source) {
  if (!path.isAbsolute(outputPath)) {
    throw new TypeError("native Node test executable path must be absolute");
  }
  if (typeof source !== "string" || source.includes("\0")) {
    throw new TypeError("native Node test executable source must be a NUL-free string");
  }

  const wrapperSource = `
#include <unistd.h>

static char node_path[] = {${cByteArray(process.execPath)}};
static char node_source[] = {${cByteArray(source)}};
static char node_eval[] = "-e";
static char node_name[] = "test-broker";

int main(void) {
  char *const arguments[] = {node_path, node_eval, node_source, node_name, 0};
  char *const environment[] = {0};
  execve(node_path, arguments, environment);
  _exit(127);
}
`;
  const compiler = process.env.CC || "cc";
  const result = spawnSync(
    compiler,
    ["-x", "c", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-o", outputPath, "-"],
    { encoding: "utf8", input: wrapperSource },
  );
  if (result.error != null) {
    throw new Error(`failed to start the native test compiler: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `native test compiler exited with status ${result.status}: ${result.stderr.trim()}`,
    );
  }
  fs.chmodSync(outputPath, 0o700);
  return outputPath;
}

module.exports = { writeNativeNodeTestExecutable };
