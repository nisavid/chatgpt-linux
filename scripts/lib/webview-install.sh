#!/bin/bash
# Webview asset extraction and patched app.asar install into the chatgpt/ tree.
#
# Sourced by install.sh. Do not run directly.
# shellcheck shell=bash

replace_linux_webview_icon_assets() {
    local assets_dir="$INSTALL_DIR/content/webview/assets"
    local -a icon_assets=()
    local icon_asset linux_icon_source

    linux_icon_source="${LINUX_ICON_SOURCE:-${CHATGPT_LINUX_ICON_SOURCE:-$SCRIPT_DIR/assets/chatgpt-linux.png}}"
    [ -f "$linux_icon_source" ] || linux_icon_source="$ICON_SOURCE"

    [ -f "$linux_icon_source" ] || {
        warn "Linux icon not found at $linux_icon_source; leaving upstream webview icon assets unchanged"
        return 0
    }
    [ -d "$assets_dir" ] || return 0

    while IFS= read -r -d '' icon_asset; do
        icon_assets+=("$icon_asset")
    done < <(find "$assets_dir" -maxdepth 1 -type f -name 'app-*.png' -print0 | sort -z)

    if [ "${#icon_assets[@]}" -eq 0 ]; then
        warn "Could not find webview app icon assets in $assets_dir; leaving upstream icon unchanged"
        return 0
    fi

    for icon_asset in "${icon_assets[@]}"; do
        cp "$linux_icon_source" "$icon_asset"
    done
    info "Linux app icon applied to ${#icon_assets[@]} webview asset(s)"
}

require_webview_entrypoint() {
    local webview_index="$INSTALL_DIR/content/webview/index.html"

    [ -f "$webview_index" ] || error "Missing webview entrypoint: $webview_index. Upstream ASAR layout may have changed."
}

# ---- Extract webview files ----
extract_webview() {
    local install_dir="$1"
    local target_webview="$install_dir/content/webview"
    mkdir -p "$target_webview"

    # Webview files are inside the extracted asar at webview/
    local asar_extracted="$WORK_DIR/app-extracted"
    [ -d "$asar_extracted/webview" ] || error "Webview directory not found in extracted asar: $asar_extracted/webview"

    cp -aT "$asar_extracted/webview" "$target_webview"
    require_webview_entrypoint

    # Replace transparent startup background with an opaque color for Linux.
    # The official OpenAI app bundle relies on macOS vibrancy for the transparent effect;
    # on Linux the transparent background causes flickering.
    sed -i 's/--startup-background: transparent/--startup-background: #1e1e1e/' "$target_webview/index.html"
    replace_linux_webview_icon_assets
    write_webview_integrity_manifest "$install_dir" || return $?
    info "Webview files copied"
}

write_webview_integrity_manifest() {
    local install_dir="$1"
    local target_webview="$install_dir/content/webview"
    local manifest_dir="$install_dir/.chatgpt-linux"
    local manifest_file="$manifest_dir/webview-integrity.sha256"

    mkdir -p "$manifest_dir"
    python3 - "$target_webview" "$manifest_file" <<'PY'
import hashlib
import html.parser
import pathlib
import posixpath
import re
import sys
import urllib.parse


webview_root = pathlib.Path(sys.argv[1]).resolve()
manifest_file = pathlib.Path(sys.argv[2])
index_path = webview_root / "index.html"
STATIC_ASSET_SUFFIXES = {
    ".avif",
    ".cjs",
    ".css",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".mjs",
    ".otf",
    ".png",
    ".svg",
    ".ttf",
    ".wasm",
    ".webp",
    ".woff",
    ".woff2",
}
STARTUP_LINK_RELS = {
    "modulepreload",
    "preload",
    "stylesheet",
}
STARTUP_SRC_TAGS = {
    "audio",
    "embed",
    "img",
    "script",
    "source",
    "track",
    "video",
}
JS_IMPORT_REF_RE = re.compile(
    r"""\bimport\s*\(\s*(?P<quote>["'])(?P<ref>[^"']+)(?P=quote)\s*(?:,[^)]*)?\)"""
)
JS_FROM_REF_RE = re.compile(
    r"""
    \b(?:import|export)\b[^;]*?\bfrom\s*
    (?P<quote>["'])(?P<ref>[^"']+)(?P=quote)
    """,
    re.VERBOSE,
)
JS_BARE_IMPORT_REF_RE = re.compile(
    r"""\bimport\s*(?P<quote>["'])(?P<ref>[^"']+)(?P=quote)"""
)
JS_NEW_URL_REF_RE = re.compile(
    r"""\bnew\s+URL\s*\(\s*(?P<quote>["'])(?P<ref>[^"']+)(?P=quote)\s*,\s*import\.meta\.url\s*,?\s*\)"""
)
JS_REQUIRE_REF_RE = re.compile(
    r"""\brequire\s*\(\s*(?P<quote>["'])(?P<ref>[^"']+)(?P=quote)\s*\)"""
)
RELATIVE_ASSET_REF_RE = re.compile(
    r"""(?P<quote>["'])(?P<ref>(?:\./|\../)[^"']+)(?P=quote)"""
)
CSS_IMPORT_REF_RE = re.compile(
    r"""@import\s+(?:url\(\s*)?(?P<quote>["']?)(?P<ref>[^"'\s;)]+)(?P=quote)\s*\)?"""
)
CSS_URL_REF_RE = re.compile(
    r"""url\(\s*(?P<quote>["']?)(?P<ref>[^"')]+)(?P=quote)\s*\)"""
)


class StartupAssetParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attr_map = {
            name.lower(): value
            for name, value in attrs
            if name and value is not None
        }

        values = []
        if tag in STARTUP_SRC_TAGS:
            values.append(attr_map.get("src"))
        elif tag == "link" and self.link_rel_is_startup(attr_map.get("rel", "")):
            values.append(attr_map.get("href"))

        for value in values:
            if not value:
                continue
            normalized = normalize_asset_reference(value, "index.html", allow_plain=True)
            if normalized is not None:
                self.paths.add(normalized)

    @staticmethod
    def link_rel_is_startup(rel_value):
        rel_tokens = {token.lower() for token in rel_value.split()}
        return bool(rel_tokens & STARTUP_LINK_RELS)


def normalize_asset_reference(reference, base_relative_path, allow_plain):
    parsed = urllib.parse.urlsplit(reference.strip())
    if parsed.scheme or parsed.netloc:
        return None
    path = urllib.parse.unquote(parsed.path)
    if not path or path.startswith("#"):
        return None
    if not allow_plain and not path.startswith(("/", "./", "../")):
        return None
    if "\\" in path or any(ord(ch) < 32 for ch in path):
        raise SystemExit(f"webview startup asset has unsafe path characters: {reference}")
    if path.startswith("/"):
        combined = path.lstrip("/")
    else:
        combined = posixpath.join(posixpath.dirname(base_relative_path), path)
    normalized = posixpath.normpath(combined)
    if normalized == "." or normalized.startswith("../") or normalized == "..":
        raise SystemExit(f"webview startup asset escapes content root: {reference}")
    if "\\" in normalized or any(ord(ch) < 32 for ch in normalized):
        raise SystemExit(f"webview startup asset has unsafe path characters: {reference}")
    return normalized


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def webview_asset_path(relative_path):
    asset_path = (webview_root / relative_path).resolve()
    try:
        asset_path.relative_to(webview_root)
    except ValueError:
        raise SystemExit(f"webview startup asset escapes content root: {relative_path}")
    return asset_path


def has_static_asset_suffix(reference):
    path = urllib.parse.urlsplit(reference).path
    return pathlib.PurePosixPath(path).suffix.lower() in STATIC_ASSET_SUFFIXES


def mask_js_comments_and_strings(text):
    chars = list(text)
    index = 0
    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if char == "/" and next_char == "/":
            chars[index] = " "
            chars[index + 1] = " "
            index += 2
            while index < len(text) and text[index] != "\n":
                chars[index] = " "
                index += 1
            continue

        if char == "/" and next_char == "*":
            chars[index] = " "
            chars[index + 1] = " "
            index += 2
            while index < len(text):
                if text[index] == "\n":
                    index += 1
                    continue
                if text[index] == "*" and index + 1 < len(text) and text[index + 1] == "/":
                    chars[index] = " "
                    chars[index + 1] = " "
                    index += 2
                    break
                chars[index] = " "
                index += 1
            continue

        if char in {"'", '"'}:
            quote = char
            index += 1
            while index < len(text):
                if text[index] == "\\":
                    chars[index] = " "
                    if index + 1 < len(text) and text[index + 1] != "\n":
                        chars[index + 1] = " "
                        index += 2
                    else:
                        index += 1
                    continue
                if text[index] == quote:
                    index += 1
                    break
                if text[index] != "\n":
                    chars[index] = " "
                index += 1
            continue

        if char == "`":
            chars[index] = " "
            index += 1
            while index < len(text):
                if text[index] == "\\":
                    chars[index] = " "
                    if index + 1 < len(text) and text[index + 1] != "\n":
                        chars[index + 1] = " "
                        index += 2
                    else:
                        index += 1
                    continue
                if text[index] == "`":
                    chars[index] = " "
                    index += 1
                    break
                if text[index] != "\n":
                    chars[index] = " "
                index += 1
            continue

        index += 1

    return "".join(chars)


def mask_css_comments(text):
    chars = list(text)
    index = 0
    while index < len(text):
        if text[index] == "/" and index + 1 < len(text) and text[index + 1] == "*":
            chars[index] = " "
            chars[index + 1] = " "
            index += 2
            while index < len(text):
                if text[index] == "\n":
                    index += 1
                    continue
                if text[index] == "*" and index + 1 < len(text) and text[index + 1] == "/":
                    chars[index] = " "
                    chars[index + 1] = " "
                    index += 2
                    break
                chars[index] = " "
                index += 1
            continue
        index += 1
    return "".join(chars)


def iter_js_dependency_references(text):
    code = mask_js_comments_and_strings(text)
    for pattern in (JS_IMPORT_REF_RE, JS_FROM_REF_RE, JS_BARE_IMPORT_REF_RE):
        for match in pattern.finditer(code):
            yield text[match.start("ref"):match.end("ref")], True, False
    for match in JS_NEW_URL_REF_RE.finditer(code):
        yield text[match.start("ref"):match.end("ref")], True, True
    for match in JS_REQUIRE_REF_RE.finditer(code):
        yield text[match.start("ref"):match.end("ref")], True, False
    for match in RELATIVE_ASSET_REF_RE.finditer(text):
        reference = match.group("ref")
        if has_static_asset_suffix(reference):
            yield reference, False, False


def iter_css_dependency_references(text):
    code = mask_css_comments(text)
    for pattern in (CSS_IMPORT_REF_RE, CSS_URL_REF_RE):
        for match in pattern.finditer(code):
            yield match.group("ref"), True, True


def iter_dependency_references(relative_path, asset_path):
    suffix = pathlib.PurePosixPath(relative_path).suffix.lower()
    if suffix not in {".js", ".mjs", ".cjs", ".css"}:
        return
    text = asset_path.read_text(encoding="utf-8", errors="ignore")
    if suffix == ".css":
        yield from iter_css_dependency_references(text)
    else:
        yield from iter_js_dependency_references(text)


def collect_startup_asset_graph(initial_paths):
    relative_paths = {"index.html"}
    pending = []

    def add_path(relative_path):
        if relative_path not in relative_paths:
            relative_paths.add(relative_path)
            pending.append(relative_path)

    for relative_path in sorted(initial_paths):
        add_path(relative_path)

    while pending:
        relative_path = pending.pop(0)
        asset_path = webview_asset_path(relative_path)
        if not asset_path.is_file():
            raise SystemExit(f"missing webview startup asset: {relative_path}")

        for reference, require_existing, allow_plain in iter_dependency_references(relative_path, asset_path):
            try:
                normalized = normalize_asset_reference(reference, relative_path, allow_plain)
            except SystemExit:
                if require_existing:
                    raise
                # Bundlers retain source-module IDs such as ../../../node_modules/...
                # as object keys. They are not runtime asset edges.
                continue
            if normalized is None:
                continue
            dependency_path = webview_asset_path(normalized)
            if dependency_path.is_file():
                add_path(normalized)
            elif require_existing:
                raise SystemExit(f"missing webview startup asset: {normalized}")

    return relative_paths


if not index_path.is_file():
    raise SystemExit(f"missing webview startup document: {index_path}")

parser = StartupAssetParser()
parser.feed(index_path.read_text(encoding="utf-8", errors="ignore"))
relative_paths = collect_startup_asset_graph(parser.paths)

lines = []
for relative_path in sorted(relative_paths):
    asset_path = webview_asset_path(relative_path)
    if not asset_path.is_file():
        raise SystemExit(f"missing webview startup asset: {relative_path}")
    lines.append(f"{digest_file(asset_path)}  {relative_path}\n")

manifest_file.write_text("".join(lines), encoding="utf-8")
PY
    local py_rc=$?
    [ "$py_rc" -eq 0 ] || return "$py_rc"
    info "Webview integrity manifest written"
}

# ---- Install app.asar ----
install_git_repository_watcher_dependency() {
    local app_package_json="$WORK_DIR/app-extracted/package.json"
    local resources_dir="$INSTALL_DIR/resources"
    local managed_node="$CHATGPT_MANAGED_NODE_RUNTIME_DIR/bin/node"
    local managed_npm="$CHATGPT_MANAGED_NODE_RUNTIME_DIR/bin/npm"
    local worker_module_path="$resources_dir/app.asar/.vite/build/worker.js"
    local watcher_version

    [ -f "$app_package_json" ] || error "Missing extracted app package metadata: $app_package_json"
    [ -x "$managed_node" ] || error "Managed Node.js runtime is missing node: $managed_node"
    [ -x "$managed_npm" ] || error "Managed Node.js runtime is missing npm: $managed_npm"

    watcher_version="$("$managed_node" - "$app_package_json" <<'NODE'
const packageJson = require(process.argv[2]);
const version = packageJson.dependencies?.["@parcel/watcher"];
const exactSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
if (typeof version !== "string" || !exactSemver.test(version)) {
  process.exit(1);
}
process.stdout.write(version);
NODE
)" || error "Official app does not declare an exact @parcel/watcher dependency"

    info "Installing official Git repository watcher dependency: @parcel/watcher@$watcher_version"
    "$managed_npm" install \
        --prefix "$resources_dir" \
        --ignore-scripts \
        --no-save \
        --package-lock=false \
        --no-audit \
        --no-fund \
        "@parcel/watcher@$watcher_version" >&2 \
        || error "Failed to install @parcel/watcher@$watcher_version"

    [ -x "$INSTALL_DIR/electron" ] || error "Generated Electron runtime is missing: $INSTALL_DIR/electron"
    ELECTRON_RUN_AS_NODE=1 "$INSTALL_DIR/electron" - "$worker_module_path" "$watcher_version" <<'NODE' \
        || error "Generated app cannot load @parcel/watcher from its worker module path"
const { createRequire } = require("node:module");
const workerModulePath = process.argv[2];
const expectedVersion = process.argv[3];
const fromWorker = createRequire(workerModulePath);
const watcher = fromWorker("@parcel/watcher");
const watcherPackage = fromWorker("@parcel/watcher/package.json");
if (watcherPackage.version !== expectedVersion || typeof watcher.subscribe !== "function") {
  process.exit(1);
}
NODE

    info "Official Git repository watcher dependency installed"
}

install_app() {
    cp "$WORK_DIR/app.asar" "$INSTALL_DIR/resources/"
    if [ -d "$WORK_DIR/app.asar.unpacked" ]; then
        cp -r "$WORK_DIR/app.asar.unpacked" "$INSTALL_DIR/resources/"
    fi
    install_git_repository_watcher_dependency
    info "app.asar installed"
}
