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
    local approved_bundle_dir="$SCRIPT_DIR/scripts/lib/parcel-watcher"
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

    [ -d "$approved_bundle_dir" ] \
        || error "Approved @parcel/watcher offline bundle is missing: $approved_bundle_dir"
    [ ! -e "$resources_dir/node_modules" ] && [ ! -L "$resources_dir/node_modules" ] \
        || error "Generated app resources already contain node_modules"

    info "Installing approved offline Git repository watcher dependency: @parcel/watcher@$watcher_version"
    (
        set -Eeuo pipefail
        local staging_dir
        staging_dir="$(mktemp -d "$resources_dir/.parcel-watcher.XXXXXX")" \
            || error "Could not create private @parcel/watcher staging directory"
        trap 'rm -rf -- "$staging_dir"' EXIT

        mkdir -p "$staging_dir/archives" "$staging_dir/npm-cache"
        chmod 0700 "$staging_dir" "$staging_dir/archives" "$staging_dir/npm-cache"

        "$managed_node" - "$approved_bundle_dir" "$staging_dir" "$watcher_version" <<'NODE' \
            || error "Approved @parcel/watcher bundle verification failed"
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const bundleDir = path.resolve(process.argv[2]);
const stagingDir = path.resolve(process.argv[3]);
const expectedVersion = process.argv[4];
const archivesDir = path.join(stagingDir, "archives");

function fail(message) {
  throw new Error(message);
}

function readRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} must be a regular file`);
  }
  return fs.readFileSync(filePath);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function verifyDigest(bytes, expected, label) {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/u.test(expected)) {
    fail(`${label} has an invalid approved SHA-256`);
  }
  const actual = sha256(bytes);
  if (!crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))) {
    fail(`${label} does not match its approved SHA-256`);
  }
}

const manifestPath = path.join(bundleDir, "approved.json");
const manifest = JSON.parse(readRegularFile(manifestPath, "approval manifest").toString("utf8"));
if (manifest.schemaVersion !== 1) {
  fail("unsupported @parcel/watcher approval manifest schema");
}
if (manifest.watcherVersion !== expectedVersion) {
  fail(`official @parcel/watcher ${expectedVersion} is not approved (approved: ${manifest.watcherVersion})`);
}

const packageJsonBytes = readRegularFile(path.join(bundleDir, "package.json"), "approved package.json");
const packageLockBytes = readRegularFile(path.join(bundleDir, "package-lock.json"), "approved package-lock.json");
verifyDigest(packageJsonBytes, manifest.packageJsonSha256, "approved package.json");
verifyDigest(packageLockBytes, manifest.packageLockSha256, "approved package-lock.json");

const packageJson = JSON.parse(packageJsonBytes.toString("utf8"));
const packageLock = JSON.parse(packageLockBytes.toString("utf8"));
if (packageJson.dependencies?.["@parcel/watcher"] !== `file:archives/parcel-watcher-${expectedVersion}.tgz`) {
  fail("approved package.json does not bind the expected @parcel/watcher archive");
}
if (packageLock.lockfileVersion !== 3 || packageLock.packages?.[""] == null) {
  fail("approved package-lock.json must be a complete npm lockfile v3");
}

const dependencySpecs = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
};
const referencedArchives = new Set();
for (const [name, spec] of Object.entries(dependencySpecs)) {
  if (typeof spec !== "string" || !/^file:archives\/[A-Za-z0-9._-]+\.tgz$/u.test(spec)) {
    fail(`approved dependency ${name} is not bound to a local archive`);
  }
  referencedArchives.add(spec.slice("file:archives/".length));
}

if (!Array.isArray(manifest.archives) || manifest.archives.length === 0) {
  fail("approval manifest has no offline archives");
}
const approvedArchives = new Set();
for (const archive of manifest.archives) {
  if (
    archive == null ||
    typeof archive !== "object" ||
    typeof archive.encodedFile !== "string" ||
    !/^archives\/[A-Za-z0-9._-]+\.tgz\.base64$/u.test(archive.encodedFile) ||
    typeof archive.archiveFile !== "string" ||
    !/^[A-Za-z0-9._-]+\.tgz$/u.test(archive.archiveFile) ||
    archive.encodedFile !== `archives/${archive.archiveFile}.base64` ||
    approvedArchives.has(archive.archiveFile)
  ) {
    fail("approval manifest contains an invalid or duplicate archive entry");
  }
  const encodedBytes = readRegularFile(path.join(bundleDir, archive.encodedFile), archive.encodedFile);
  const encoded = encodedBytes.toString("ascii").replace(/\s+/gu, "");
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    fail(`${archive.encodedFile} is not canonical base64`);
  }
  const archiveBytes = Buffer.from(encoded, "base64");
  verifyDigest(archiveBytes, archive.sha256, archive.archiveFile);
  fs.writeFileSync(path.join(archivesDir, archive.archiveFile), archiveBytes, {
    flag: "wx",
    mode: 0o600,
  });
  approvedArchives.add(archive.archiveFile);
}

if (
  approvedArchives.size !== referencedArchives.size ||
  [...approvedArchives].some((name) => !referencedArchives.has(name))
) {
  fail("approved package manifest and offline archive set do not match");
}

for (const [packagePath, entry] of Object.entries(packageLock.packages)) {
  if (packagePath === "") {
    continue;
  }
  if (
    entry == null ||
    typeof entry !== "object" ||
    typeof entry.resolved !== "string" ||
    !/^file:archives\/[A-Za-z0-9._-]+\.tgz$/u.test(entry.resolved) ||
    typeof entry.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)
  ) {
    fail(`approved lock entry ${packagePath} is not integrity-bound to an offline archive`);
  }
  if (!approvedArchives.has(entry.resolved.slice("file:archives/".length))) {
    fail(`approved lock entry ${packagePath} references an unapproved archive`);
  }
}

fs.writeFileSync(path.join(stagingDir, "package.json"), packageJsonBytes, { flag: "wx", mode: 0o600 });
fs.writeFileSync(path.join(stagingDir, "package-lock.json"), packageLockBytes, { flag: "wx", mode: 0o600 });
NODE

        "$managed_npm" ci \
            --prefix "$staging_dir" \
            --cache "$staging_dir/npm-cache" \
            --offline \
            --ignore-scripts \
            --no-audit \
            --no-fund \
            --registry=http://127.0.0.1:9 >&2 \
            || error "Failed to install approved offline @parcel/watcher@$watcher_version"

        [ -x "$INSTALL_DIR/electron" ] || error "Generated Electron runtime is missing: $INSTALL_DIR/electron"
        ELECTRON_RUN_AS_NODE=1 "$INSTALL_DIR/electron" - "$staging_dir/package.json" "$watcher_version" <<'NODE' \
            || error "Generated app cannot load the approved offline @parcel/watcher"
const { createRequire } = require("node:module");
const stagedPackagePath = process.argv[2];
const expectedVersion = process.argv[3];
const fromStaging = createRequire(stagedPackagePath);
const watcher = fromStaging("@parcel/watcher");
const watcherPackage = fromStaging("@parcel/watcher/package.json");
if (watcherPackage.version !== expectedVersion || typeof watcher.subscribe !== "function") {
  process.exit(1);
}
NODE

        [ -d "$staging_dir/node_modules" ] \
            || error "Approved offline @parcel/watcher installation produced no node_modules"
        [ ! -e "$resources_dir/node_modules" ] && [ ! -L "$resources_dir/node_modules" ] \
            || error "Generated app resources gained node_modules before watcher promotion"
        mv "$staging_dir/node_modules" "$resources_dir/node_modules" \
            || error "Could not promote approved offline @parcel/watcher"
    ) || return $?

    info "Approved offline Git repository watcher dependency installed"
}

install_app() {
    cp "$WORK_DIR/app.asar" "$INSTALL_DIR/resources/"
    if [ -d "$WORK_DIR/app.asar.unpacked" ]; then
        cp -r "$WORK_DIR/app.asar.unpacked" "$INSTALL_DIR/resources/"
    fi
    install_git_repository_watcher_dependency || return $?
    info "app.asar installed"
}
