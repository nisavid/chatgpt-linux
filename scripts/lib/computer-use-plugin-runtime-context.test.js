const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(
  repositoryRoot,
  "plugins/openai-bundled/plugins/computer-use/.mcp.json",
);

test("Computer Use declares the runtime context required by its authorization client", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const server = manifest.mcpServers?.["computer-use"];

  assert.ok(server, "Computer Use MCP server manifest is missing");
  assert.ok(Array.isArray(server.env_vars), "Computer Use MCP server declares no env_vars");
  const requiredEnvVars = [
    "CODEX_HOME",
    "XDG_RUNTIME_DIR",
    "CHATGPT_LINUX_APP_ID",
    "CHATGPT_APP_ID",
    "CHATGPT_LINUX_INSTANCE_ID",
  ];
  assert.deepEqual([...server.env_vars].sort(), [...requiredEnvVars].sort());
});
