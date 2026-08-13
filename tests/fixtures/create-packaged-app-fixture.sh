#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="${1:-chatgpt}"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/generated-app-mutation-broker.sh
source "$repo_dir/scripts/lib/generated-app-mutation-broker.sh"

mkdir -p \
    "$app_dir/.chatgpt-linux" \
    "$app_dir/content/webview" \
    "$app_dir/resources/node-runtime/bin" \
    "$app_dir/resources/node-runtime/lib/node_modules/npm/bin"

enabled_port_integrations_json="${CHATGPT_FIXTURE_PORT_INTEGRATIONS_JSON:-[]}"
fixture_port_integrations_config="${CHATGPT_FIXTURE_PORT_INTEGRATIONS_CONFIG:-$app_dir.port-integrations.json}"
node - \
    "$repo_dir/scripts/lib/port-integrations.js" \
    "$enabled_port_integrations_json" \
    "$fixture_port_integrations_config" \
    "$app_dir/.chatgpt-linux/build-info.json" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const {
  enabledPortIntegrationIds,
  integrationsJsonSummary,
} = require(process.argv[2]);

const requested = JSON.parse(process.argv[3]);
if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string")) {
  throw new Error("CHATGPT_FIXTURE_PORT_INTEGRATIONS_JSON must be an array of integration ids");
}
if (new Set(requested).size !== requested.length) {
  throw new Error("CHATGPT_FIXTURE_PORT_INTEGRATIONS_JSON must not contain duplicates");
}

const configPath = path.resolve(process.argv[4]);
const buildInfoPath = path.resolve(process.argv[5]);
const available = integrationsJsonSummary().map(({ id }) => id);
const availableSet = new Set(available);
for (const id of requested) {
  if (!availableSet.has(id)) {
    throw new Error(`Unknown packaged-app fixture port integration: ${id}`);
  }
}

const config = {
  enabled: requested,
  disabled: available.filter((id) => !requested.includes(id)),
};
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
const enabled = enabledPortIntegrationIds({ integrationsConfigPath: configPath });
fs.writeFileSync(
  buildInfoPath,
  `${JSON.stringify({ schemaVersion: 1, portIntegrations: { enabled } })}\n`,
  "utf8",
);
NODE

printf '%s\n' '#!/usr/bin/env bash' 'echo "codex desktop fixture"' > "$app_dir/start.sh"
chmod +x "$app_dir/start.sh"
printf '%s\n' '<!doctype html><title>Codex fixture</title>' > "$app_dir/content/webview/index.html"
cp "$repo_dir/launcher/cli-launch-path.py" "$app_dir/.chatgpt-linux/cli-launch-path.py"

for binary in node npm-cli.js npx-cli.js; do
    cat > "$app_dir/resources/node-runtime/bin/$binary" <<'SCRIPT'
#!/usr/bin/env bash
case "$(basename "$0")" in
    node) echo v22.22.2 ;;
    *) echo 10.9.7 ;;
esac
SCRIPT
    chmod +x "$app_dir/resources/node-runtime/bin/$binary"
done

mv "$app_dir/resources/node-runtime/bin/npm-cli.js" \
    "$app_dir/resources/node-runtime/lib/node_modules/npm/bin/npm-cli.js"
mv "$app_dir/resources/node-runtime/bin/npx-cli.js" \
    "$app_dir/resources/node-runtime/lib/node_modules/npm/bin/npx-cli.js"
ln -s ../lib/node_modules/npm/bin/npm-cli.js "$app_dir/resources/node-runtime/bin/npm"
ln -s ../lib/node_modules/npm/bin/npx-cli.js "$app_dir/resources/node-runtime/bin/npx"

REPO_DIR="$repo_dir" resolve_generated_app_mutation_broker || {
    printf '%s\n' 'Could not resolve the packaged-app fixture mutation broker.' >&2
    exit 1
}
fixture_broker="$CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED"
fixture_broker_digest="$(generated_app_mutation_broker_sha256 "$fixture_broker")"
write_generated_app_mutation_broker_digest \
    "$app_dir" \
    "$fixture_broker" \
    "$fixture_broker_digest"
write_generation_bound_mutation_broker_receipt \
    "$app_dir" \
    "$fixture_broker" \
    "$fixture_broker_digest"
