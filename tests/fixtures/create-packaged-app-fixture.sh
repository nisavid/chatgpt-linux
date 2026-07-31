#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="${1:-chatgpt}"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p \
    "$app_dir/.chatgpt-linux" \
    "$app_dir/content/webview" \
    "$app_dir/resources/node-runtime/bin" \
    "$app_dir/resources/node-runtime/lib/node_modules/npm/bin"

enabled_port_integrations_json="${CHATGPT_FIXTURE_PORT_INTEGRATIONS_JSON:-[]}"
printf '{"schemaVersion":1,"portIntegrations":{"enabled":%s}}\n' \
    "$enabled_port_integrations_json" \
    > "$app_dir/.chatgpt-linux/build-info.json"

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
