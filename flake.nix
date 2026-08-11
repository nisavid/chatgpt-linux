{
  description = "ChatGPT for Linux installer";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        rewriteCratesIoDownloadUrl = url:
          if ! builtins.isString url then
            url
          else
            let
              match = builtins.match
                "https://crates[.]io/api/v1/crates/([^/]+)/([^/]+)/download"
                url;
            in
            if match == null then
              url
            else
              let
                crateName = builtins.elemAt match 0;
                version = builtins.elemAt match 1;
              in
              "https://static.crates.io/crates/${crateName}/${crateName}-${version}.crate";

        rewriteCratesIoFetchurlArgs = lib: args:
          if ! builtins.isAttrs args then
            args
          else
            args
            // lib.optionalAttrs (args ? url) {
              url =
                if builtins.isList args.url then
                  map rewriteCratesIoDownloadUrl args.url
                else
                  rewriteCratesIoDownloadUrl args.url;
            }
            // lib.optionalAttrs (args ? urls) {
              urls = map rewriteCratesIoDownloadUrl args.urls;
            };

        pkgs = import nixpkgs {
          inherit system;
          overlays = [
            (_final: prev: {
              fetchurl = args:
                prev.fetchurl (rewriteCratesIoFetchurlArgs prev.lib args);
            })
          ];
        };
        stagedSourceInfoPath = ./. + "/.chatgpt-linux/source-info.json";
        stagedSourceInfo =
          if builtins.pathExists stagedSourceInfoPath then
            builtins.fromJSON (builtins.readFile stagedSourceInfoPath)
          else
            { };
        flakeSourceCommit = self.rev or (self.dirtyRev or (stagedSourceInfo.commit or ""));
        flakeSourceRemote = "https://github.com/nisavid/chatgpt-linux.git";
        flakeSourceDateEpoch = toString (stagedSourceInfo.sourceDateEpoch or (self.lastModified or 1));
        releaseSandboxCanaryPathFile = ./. + "/.chatgpt-linux/release-sandbox-canary-path";
        releaseSandboxCanaryPath =
          if builtins.pathExists releaseSandboxCanaryPathFile then
            pkgs.lib.removeSuffix "\n" (builtins.readFile releaseSandboxCanaryPathFile)
          else
            "";
        releaseSandboxCanaryPathIsValid =
          builtins.match "/var/tmp/chatgpt-release-nix-sandbox-canary-[A-Za-z0-9-]+" releaseSandboxCanaryPath != null;
        sourceRoot = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            pkgs.lib.cleanSourceFilter path type
            && (let
              pathStr = toString path;
            in
              !(pkgs.lib.hasSuffix "/.codex" pathStr || pkgs.lib.hasInfix "/.codex/" pathStr)
              && !(pkgs.lib.hasSuffix "/.chatgpt-linux/release-sandbox-canary-path" pathStr));
        };
        nixPortIntegrations = import ./nix/port-integrations.nix { lib = pkgs.lib; };
        computerUseBuildSource = pkgs.runCommandLocal "chatgpt-computer-use-linux-source" { } ''
          mkdir -p "$out"
          cp ${./Cargo.lock} "$out/Cargo.lock"
          cat > "$out/Cargo.toml" <<'EOF'
          [workspace]
          members = ["computer-use-linux"]
          resolver = "2"
          EOF
          cp -R ${./computer-use-linux} "$out/computer-use-linux"
          chmod -R u+w "$out"
        '';
        releaseHelpersBuildSource = pkgs.runCommandLocal "chatgpt-release-helpers-source" { } ''
          mkdir -p "$out"
          cp ${./Cargo.lock} "$out/Cargo.lock"
          cat > "$out/Cargo.toml" <<'EOF'
          [workspace]
          members = ["generated-app-mutation-broker", "updater"]
          resolver = "2"
          EOF
          cp -R ${./generated-app-mutation-broker} "$out/generated-app-mutation-broker"
          cp -R ${./updater} "$out/updater"
          chmod -R u+w "$out"
        '';
        notificationActionsBuildSource = pkgs.runCommandLocal "chatgpt-notification-actions-linux-source" { } ''
          mkdir -p "$out"
          cp ${./Cargo.lock} "$out/Cargo.lock"
          cat > "$out/Cargo.toml" <<'EOF'
          [workspace]
          members = ["notification-actions-linux"]
          resolver = "2"
          EOF
          cp -R ${./notification-actions-linux} "$out/notification-actions-linux"
          chmod -R u+w "$out"
        '';
        nativeModulesBuildSupport = pkgs.runCommandLocal "codex-native-modules-build-support" { } ''
          mkdir -p "$out/scripts/lib"
          cp ${./scripts/lib/native-modules.sh} "$out/scripts/lib/native-modules.sh"
        '';

        chatgptDmg = pkgs.fetchurl {
          url = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg";
          hash = "sha256-+5OiOcgRx2Oc9FqQ/zbCYvoCkGQBQM0S2j/cYLYiVa4=";
        };

        chatgptVersion = "26.727.40816";
        electronVersion = "42.3.0";
        electronPlatform =
          {
            x86_64-linux = {
              arch = "x64";
              hash = "sha256-SHpmfKanNLlYwWz/HfdNnUTSwYpszNtN1R9jAaNWxCA=";
            };
            aarch64-linux = {
              arch = "arm64";
              hash = "sha256-Kjdf+XP7e93FOKT2eyFBlH6dclE6G6or6r7Cp/Zc0PA=";
            };
          }.${system} or (throw "chatgpt-linux Nix package is not supported on ${system}");

        electronZip = pkgs.fetchurl {
          url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-${electronPlatform.arch}.zip";
          hash = electronPlatform.hash;
        };

        runtimeNodePlatform =
          {
            x86_64-linux = {
              managedNodeArch = "x64";
              managedNodeSha256 = "88fd1ce767091fd8d4a99fdb2356e98c819f93f3b1f8663853a2dee9b438068a";
              sharp = "linux-x64";
              sharpLibvips = "linux-x64";
              canvas = "linux-x64-gnu";
            };
            aarch64-linux = {
              managedNodeArch = "arm64";
              managedNodeSha256 = "e9e1930fd321a470e29bb68f30318bf58e3ecb4acb4f1533fb19c58328a091fe";
              sharp = "linux-arm64";
              sharpLibvips = "linux-arm64";
              canvas = "linux-arm64-gnu";
            };
          }.${system} or (throw "chatgpt-linux runtime library paths are not supported on ${system}");

        managedNodeVersion = "v22.22.2";
        managedNodeArchive = pkgs.fetchurl {
          url = "https://nodejs.org/dist/${managedNodeVersion}/node-${managedNodeVersion}-linux-${runtimeNodePlatform.managedNodeArch}.tar.xz";
          sha256 = runtimeNodePlatform.managedNodeSha256;
        };
        managedPortableNode = pkgs.runCommandLocal "chatgpt-managed-node-${managedNodeVersion}-${runtimeNodePlatform.managedNodeArch}" {
          nativeBuildInputs = [ pkgs.gnutar pkgs.xz ];
        } ''
          mkdir -p "$out"
          tar -xJf ${managedNodeArchive} --strip-components=1 -C "$out"
          test -x "$out/bin/node"
          test -x "$out/bin/npm"
          test -x "$out/bin/npx"
        '';

        electronHeaders = pkgs.fetchurl {
          url = "https://artifacts.electronjs.org/headers/dist/v${electronVersion}/node-v${electronVersion}-headers.tar.gz";
          hash = "sha256-ghAJ+cGDAFDYlK755hkGywpTeyAAstm77ZmF//HV4NA=";
        };

        codexMicroNodeHidArchive = pkgs.fetchurl {
          name = "node-hid-3.3.0.tgz";
          url = "https://registry.npmjs.org/node-hid/-/node-hid-3.3.0.tgz";
          hash = "sha512-j+dFgJLRAE0nufQKXk3IfS6T6YuHhCgMvz4TrG0sgtb6DSCdYpfJ1etcdmeCmPQjUgO+yo32ktVrRliNs/+fmg==";
        };

        browserUseNodeReplRuntime = pkgs.fetchurl {
          url = "https://persistent.oaistatic.com/codex-primary-runtime/26.426.12240/codex-primary-runtime-linux-x64-26.426.12240.tar.xz";
          hash = "sha256-21Yk6276NrZuxvbdBIjO+5ZuSWNoYqq2IJpDNsHKkMQ=";
        };

        browserUseNodeRepl = if system == "x86_64-linux" then pkgs.stdenv.mkDerivation {
          pname = "codex-browser-use-node-repl";
          version = "26.426.12240";
          src = browserUseNodeReplRuntime;

          dontConfigure = true;
          dontBuild = true;

          installPhase = ''
            runHook preInstall
            mkdir -p "$out/bin"
            tar -xJf "$src" -C "$TMPDIR" codex-primary-runtime/dependencies/bin/node_repl
            install -m 0755 "$TMPDIR/codex-primary-runtime/dependencies/bin/node_repl" "$out/bin/node_repl"
            runHook postInstall
          '';
        } else null;

        chatgptComputerUseBinaries = pkgs.rustPlatform.buildRustPackage {
          pname = "chatgpt-computer-use-linux-binaries";
          version = "0.1.2-linux-alpha2";
          src = computerUseBuildSource;

          cargoLock = {
            lockFile = ./Cargo.lock;
          };

          buildAndTestSubdir = "computer-use-linux";
          cargoBuildFlags = [
            "-p"
            "chatgpt-computer-use-linux"
            "--bins"
          ];
          doCheck = false;

          installPhase = ''
            runHook preInstall
            release_dir="target/''${CARGO_BUILD_TARGET:-${pkgs.stdenv.hostPlatform.rust.rustcTarget}}/release"
            if [ ! -d "$release_dir" ]; then
              release_dir="target/release"
            fi
            install -Dm0755 "$release_dir/chatgpt-computer-use-linux" "$out/bin/chatgpt-computer-use-linux"
            install -Dm0755 "$release_dir/chatgpt-computer-use-cosmic" "$out/bin/chatgpt-computer-use-cosmic"
            install -Dm0755 "$release_dir/chatgpt-chrome-extension-host" "$out/bin/chatgpt-chrome-extension-host"
            runHook postInstall
          '';
        };

        updaterManifest = builtins.fromTOML (builtins.readFile ./updater/Cargo.toml);
        releaseHelperMachine =
          if pkgs.stdenv.hostPlatform.isx86_64 then "Advanced Micro Devices X86-64"
          else if pkgs.stdenv.hostPlatform.isAarch64 then "AArch64"
          else throw "chatgpt release helpers are not supported on ${system}";
        portableElfInterpreter =
          if pkgs.stdenv.hostPlatform.isx86_64 then "/lib64/ld-linux-x86-64.so.2"
          else if pkgs.stdenv.hostPlatform.isAarch64 then "/lib/ld-linux-aarch64.so.1"
          else throw "chatgpt release app is not supported on ${system}";
        chatgptReleaseHelpers = pkgs.pkgsStatic.rustPlatform.buildRustPackage {
          pname = "chatgpt-release-helpers";
          version = updaterManifest.package.version;
          src = releaseHelpersBuildSource;

          cargoLock = {
            lockFile = ./Cargo.lock;
          };

          cargoBuildFlags = [
            "-p"
            "generated-app-mutation-broker"
            "-p"
            "chatgpt-updater"
            "--bins"
          ];
          doCheck = false;
          allowedReferences = [ pkgs.asar ];
          nativeBuildInputs = [
            pkgs.binutils
          ];

          installPhase = ''
            runHook preInstall
            release_dir="target/''${CARGO_BUILD_TARGET:-${pkgs.pkgsStatic.stdenv.hostPlatform.rust.rustcTarget}}/release"
            if [ ! -d "$release_dir" ]; then
              release_dir="target/release"
            fi
            install -Dm0755 \
              "$release_dir/chatgpt-updater" \
              "$out/bin/chatgpt-updater"
            install -Dm0755 \
              "$release_dir/chatgpt-generated-app-mutation-broker" \
              "$out/bin/chatgpt-generated-app-mutation-broker"
            ln -s ${pkgs.asar}/bin/asar "$out/bin/asar"
            for binary in \
              "$out/bin/chatgpt-updater" \
              "$out/bin/chatgpt-generated-app-mutation-broker"; do
              test -f "$binary"
              test ! -L "$binary"
              test -x "$binary"
              ${pkgs.binutils}/bin/readelf -h "$binary" \
                | grep -F "Machine:                           ${releaseHelperMachine}" >/dev/null
              if ${pkgs.binutils}/bin/readelf -l "$binary" | grep -F 'INTERP' >/dev/null; then
                echo "release helper has a dynamic ELF interpreter: $binary" >&2
                exit 1
              fi
              if ${pkgs.binutils}/bin/readelf -d "$binary" 2>/dev/null \
                  | grep -E '(NEEDED|RPATH|RUNPATH)' >/dev/null; then
                echo "release helper has dynamic library dependencies: $binary" >&2
                exit 1
              fi
            done
            runHook postInstall
          '';
        };
        chatgptGeneratedAppMutationBroker = chatgptReleaseHelpers;

        chatgptReadAloudMcpBinary = pkgs.rustPlatform.buildRustPackage {
          pname = "chatgpt-read-aloud-linux-binary";
          version = "0.1.0-linux-alpha1";
          src = sourceRoot;

          cargoLock = {
            lockFile = ./Cargo.lock;
            outputHashes = {
              "cosmic-protocols-0.2.0" = "sha256-ymn+BUTTzyHquPn4hvuoA3y1owFj8LVrmsPu2cdkFQ8=";
            };
          };

          buildAndTestSubdir = "read-aloud-linux";
          cargoBuildFlags = [
            "-p"
            "chatgpt-read-aloud-linux"
          ];

          doCheck = false;

          installPhase = ''
            runHook preInstall
            release_dir="target/''${CARGO_BUILD_TARGET:-${pkgs.stdenv.hostPlatform.rust.rustcTarget}}/release"
            if [ ! -d "$release_dir" ]; then
              release_dir="target/release"
            fi
            install -Dm0755 "$release_dir/chatgpt-read-aloud-linux" "$out/bin/chatgpt-read-aloud-linux"
            runHook postInstall
          '';
        };

        chatgptNotificationActionsBinary = pkgs.rustPlatform.buildRustPackage {
          pname = "chatgpt-notification-actions-linux";
          version = "0.1.0";
          src = notificationActionsBuildSource;

          cargoLock = {
            lockFile = ./Cargo.lock;
          };

          cargoBuildFlags = [
            "-p"
            "chatgpt-notification-actions-linux"
          ];

          doCheck = true;

          installPhase = ''
            runHook preInstall
            release_dir="target/''${CARGO_BUILD_TARGET:-${pkgs.stdenv.hostPlatform.rust.rustcTarget}}/release"
            if [ ! -d "$release_dir" ]; then
              release_dir="target/release"
            fi
            install -Dm0755 "$release_dir/chatgpt-notification-actions-linux" "$out/bin/chatgpt-notification-actions-linux"
            runHook postInstall
          '';
        };

        chatgptMcpHelperReaper = pkgs.rustPlatform.buildRustPackage {
          pname = "chatgpt-mcp-helper-reaper";
          version = "0.1.0";
          src = ./port-integrations/mcp-helper-reaper/reaper;

          cargoLock = {
            lockFile = ./port-integrations/mcp-helper-reaper/reaper/Cargo.lock;
          };
        };

        chatgptGlobalDictationBinary = pkgs.rustPlatform.buildRustPackage {
          pname = "chatgpt-global-dictation-linux";
          version = "0.1.0";
          src = ./global-dictation-linux;

          cargoLock = {
            lockFile = ./global-dictation-linux/Cargo.lock;
          };

          doCheck = false;

          installPhase = ''
            runHook preInstall
            release_dir="target/''${CARGO_BUILD_TARGET:-${pkgs.stdenv.hostPlatform.rust.rustcTarget}}/release"
            if [ ! -d "$release_dir" ]; then
              release_dir="target/release"
            fi
            install -Dm0755 "$release_dir/chatgpt-global-dictation-linux" "$out/bin/chatgpt-global-dictation-linux"
            runHook postInstall
          '';
        };

        nativeModulesNodeModules = pkgs.importNpmLock.buildNodeModules {
          npmRoot = ./nix/native-modules;
          inherit (pkgs) nodejs;
          derivationArgs = {
            npmRebuildFlags = [ "--ignore-scripts" ];
          };
        };

        chatgptNativeModules = pkgs.stdenv.mkDerivation {
          pname = "chatgpt-electron-native-modules";
          version = electronVersion;
          dontUnpack = true;

          nativeBuildInputs = [
            pkgs.bash
            pkgs.gcc
            pkgs.gnumake
            pkgs.nodejs
            pkgs.python3
          ];

          buildPhase = ''
            runHook preBuild

            cp -R ${nativeModulesNodeModules}/node_modules .
            cp ${nativeModulesNodeModules}/package.json .
            cp ${nativeModulesNodeModules}/package-lock.json .
            chmod -R u+w node_modules

            mkdir -p "$TMPDIR/electron-headers"
            tar -xzf ${electronHeaders} -C "$TMPDIR/electron-headers" --strip-components=1

            export SCRIPT_DIR=${nativeModulesBuildSupport}
            export WORK_DIR="$TMPDIR"
            export ARCH="${pkgs.stdenv.hostPlatform.uname.processor}"
            export ELECTRON_VERSION=${electronVersion}
            export MIN_BETTER_SQLITE3_VERSION_FOR_ELECTRON_41="12.9.0"
            export MIN_BETTER_SQLITE3_VERSION_FOR_ELECTRON_42="12.10.0"
            export npm_config_nodedir="$TMPDIR/electron-headers"
            export NPM_CONFIG_NODEDIR="$TMPDIR/electron-headers"

            # Reuse the installer's Electron 42 source compatibility patch without
            # sourcing install-helpers.sh, which owns the top-level installer traps.
            info() { echo "[INFO] $*" >&2; }
            warn() { echo "[WARN] $*" >&2; }
            error() { echo "[ERROR] $*" >&2; exit 1; }
            source ${nativeModulesBuildSupport}/scripts/lib/native-modules.sh
            patch_better_sqlite3_for_v8_external_pointer_api "$PWD/node_modules/better-sqlite3"
            apply_v8_nullptr_t_workaround_if_needed "$TMPDIR/native-nullptr-workaround"

            node "$PWD/node_modules/@electron/rebuild/lib/cli.js" \
              -v ${electronVersion} \
              --force \
              --module-dir "$PWD" \
              --dist-url "file://$TMPDIR/electron-headers"

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -R node_modules/better-sqlite3 "$out/better-sqlite3"
            cp -R node_modules/node-pty "$out/node-pty"
            cat > "$out/codex-native-modules.env" <<EOF
ELECTRON_VERSION=${electronVersion}
ELECTRON_ARCH=${electronPlatform.arch}
BETTER_SQLITE3_VERSION=12.10.0
NODE_PTY_VERSION=1.1.0
EOF
            find "$out/better-sqlite3/build" -type f ! -name "*.node" -delete 2>/dev/null || true
            find "$out/node-pty/build" -type f ! -name "*.node" -delete 2>/dev/null || true
            find "$out" -type d -empty -delete 2>/dev/null || true
            find "$out" -type f -name "*.target.mk" -delete 2>/dev/null || true
            runHook postInstall
          '';
        };

        electronLibs = with pkgs; [
          glib
          gtk3
          pango
          cairo
          gdk-pixbuf
          atk
          at-spi2-atk
          at-spi2-core
          nss
          nspr
          dbus
          cups
          expat
          libdrm
          mesa
          libgbm
          alsa-lib
          libX11
          libXcomposite
          libXdamage
          libXext
          libXfixes
          libXrandr
          libxcb
          libxkbcommon
          libxcursor
          libxi
          libxtst
          libxscrnsaver
          libnotify
          libglvnd
          systemd
          wayland
        ];

        electronLibPath = pkgs.lib.makeLibraryPath electronLibs;
        runtimeLibPath = pkgs.lib.makeLibraryPath (with pkgs; [
          libxcrypt-legacy
          stdenv.cc.cc.lib
          zlib
        ]);
        codexMicroRuntimeLibPath = pkgs.lib.makeLibraryPath (with pkgs; [
          systemd
          libusb1
          stdenv.cc.cc.lib
          glibc
        ]);
        gsettingsSchemaPackages = with pkgs; [
          gsettings-desktop-schemas
          gtk3
        ];
        gsettingsSchemaRoot = pkg:
          pkgs.lib.removeSuffix "/glib-2.0/schemas" (pkgs.glib.getSchemaPath pkg);
        gsettingsSchemaDataDirs =
          pkgs.lib.concatMapStringsSep ":" gsettingsSchemaRoot gsettingsSchemaPackages;
        xdgDefaultDataDirs = "/usr/local/share:/usr/share";
        launcherPath = pkgs.lib.makeBinPath (with pkgs; [
          bash
          coreutils
          curl
          findutils
          gawk
          gnugrep
          gnused
          nodejs
          procps
          python3
          systemd
          xdg-utils
        ]);
        globalDictationRuntimePath = pkgs.lib.makeBinPath (with pkgs; [
          xdotool
          xinput
          xmodmap
        ]);

        patchNixInstalledApp = installDir: ''
          # Patch generated scripts for NixOS systems without /bin/bash.
          if [ -f "${installDir}/start.sh" ]; then
            ${pkgs.gnused}/bin/sed -i '1s|^#!/bin/bash$|#!${pkgs.bash}/bin/bash|' "${installDir}/start.sh"
            if ! grep -q "NixOS Electron library path" "${installDir}/start.sh"; then
              # shellcheck disable=SC2016
              ${pkgs.gnused}/bin/sed -i '/^chatgpt_capture_original_ld_library_path$/a\
# NixOS Electron library path for dlopen()ed GL/EGL libraries.\
export LD_LIBRARY_PATH="${electronLibPath}:${runtimeLibPath}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\
chatgpt_nixos_add_runtime_library_dirs' "${installDir}/start.sh"
            fi
            if ! grep -q "chatgpt_nixos_add_runtime_library_dirs()" "${installDir}/start.sh"; then
              # shellcheck disable=SC2016
              ${pkgs.gnused}/bin/sed -i '/^set -euo pipefail$/a\
\
chatgpt_nixos_add_runtime_library_dirs() {\
    local cache_home="''${XDG_CACHE_HOME:-''${HOME:-}/.cache}"\
    local runtime_root="''${CHATGPT_PRIMARY_RUNTIME_ROOT:-''${CHATGPT_RUNTIME_ROOT:-$cache_home/codex-runtimes/codex-primary-runtime}}"\
    local dir\
\
    for dir in \\\
        "$runtime_root/dependencies/python/lib" \\\
        "$runtime_root/dependencies/python/lib/python${pkgs.python3.pythonVersion}/site-packages/pillow.libs" \\\
        "$runtime_root/dependencies/python/lib/python${pkgs.python3.pythonVersion}/site-packages/numpy.libs" \\\
        "$runtime_root/dependencies/node/node_modules/@img/sharp-libvips-${runtimeNodePlatform.sharpLibvips}/lib" \\\
        "$runtime_root/dependencies/node/node_modules/@img/sharp-${runtimeNodePlatform.sharp}/lib" \\\
        "$runtime_root/dependencies/node/node_modules/@napi-rs/canvas-${runtimeNodePlatform.canvas}"; do\
        if [ -d "$dir" ]; then\
            LD_LIBRARY_PATH="$dir:''${LD_LIBRARY_PATH:-}"\
        fi\
    done\
\
    export LD_LIBRARY_PATH\
}' "${installDir}/start.sh"
            fi
            if ! grep -q "Browser Use bundled marketplace metadata" "${installDir}/start.sh"; then
              ${pkgs.python3}/bin/python3 - "${installDir}/start.sh" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = '    [ -f "$source_client" ] || return 0\n\n'
insert = "\n".join([
    "    # Browser Use bundled marketplace metadata for app-server plugin discovery.",
    "    local source_marketplace=\"$SCRIPT_DIR/resources/plugins/openai-bundled/.agents/plugins/marketplace.json\"",
    "    local marketplace_root=\"$codex_home/.tmp/bundled-marketplaces/openai-bundled\"",
    "    local marketplace_plugins_dir=\"$marketplace_root/.agents/plugins\"",
    "    if [ -f \"$source_marketplace\" ]; then",
    "        mkdir -p \"$marketplace_plugins_dir\"",
    "        rm -f \"$marketplace_plugins_dir/marketplace.json\"",
    "        cp \"$source_marketplace\" \"$marketplace_plugins_dir/marketplace.json\" && \\",
    "            chmod u+w \"$marketplace_plugins_dir/marketplace.json\" || \\",
    "            echo \"Browser Use bundled marketplace sync failed; continuing with existing marketplace cache.\"",
    "    fi",
    "",
    "",
])
if insert not in text:
    if needle not in text:
        raise SystemExit("Browser Use plugin cache insertion point not found")
    text = text.replace(needle, needle + insert, 1)
    path.write_text(text)
PY
            fi
          fi

          # Patch the Electron binary for NixOS.
          if [ -f "${installDir}/electron" ]; then
            echo "[NIX] Patching Electron binary for NixOS..."
            patchelf --set-interpreter "$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)" \
                     --set-rpath "${installDir}:${electronLibPath}" \
                     "${installDir}/electron"

            if [ -f "${installDir}/chrome_crashpad_handler" ]; then
              patchelf --set-interpreter "$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)" \
                       "${installDir}/chrome_crashpad_handler" || true
            fi

            if [ -f "${installDir}/chrome-sandbox" ]; then
              patchelf --set-interpreter "$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)" \
                       "${installDir}/chrome-sandbox" || true
            fi

            find "${installDir}" -maxdepth 1 -name "*.so*" -type f | while read -r so; do
              patchelf --set-rpath "${electronLibPath}" "$so" 2>/dev/null || true
            done

            echo "[NIX] Electron patched successfully"
          fi
        '';

        patchNixGeneratedScripts = installDir: ''
          # Patch generated scripts for NixOS systems without /bin/bash.
          if [ -f "${installDir}/start.sh" ]; then
            ${pkgs.gnused}/bin/sed -i '1s|^#!/bin/bash$|#!${pkgs.bash}/bin/bash|' "${installDir}/start.sh"
          fi
        '';

        portIntegrationsConfigFile = config:
          pkgs.writeText "codex-port-integrations.json" (builtins.toJSON config);

        portIntegrationsConfig = portIntegrationIds:
          portIntegrationsConfigFile {
            enabled = portIntegrationIds;
          };

        normalizePortIntegrationsConfig = config:
          let
            enabled = nixPortIntegrations.normalize (config.enabled or [ ]);
          in
          config // {
            inherit enabled;
          };

        portIntegrationEnabled = config: integrationId:
          let
            manifestPath = ./. + "/port-integrations/${integrationId}/integration.json";
            manifest =
              if builtins.pathExists manifestPath then
                builtins.fromJSON (builtins.readFile manifestPath)
              else
                throw "Missing port integration manifest: ${integrationId}";
            explicitlyEnabled = builtins.elem integrationId (config.enabled or [ ]);
            explicitlyDisabled = builtins.elem integrationId (config.disabled or [ ]);
          in
          !explicitlyDisabled && (explicitlyEnabled || (manifest.defaultEnabled or false));

        watchdogPortIntegrationsConfig = normalizePortIntegrationsConfig (
          builtins.fromJSON (builtins.readFile ./scripts/ci/watchdog-port-integrations.json)
        );

        enabledIntegrationIds = { portIntegrationIds ? [ ] }:
          nixPortIntegrations.normalize portIntegrationIds;

        packageSuffix = args:
          let
            integrationIds = enabledIntegrationIds args;
          in
          if integrationIds == [ ] then "" else "-${pkgs.lib.concatStringsSep "-" integrationIds}";

        mkChatGPTReleaseApp = { portIntegrationIds ? [ ], portIntegrationsConfigOverride ? null }:
        let
          effectivePortIntegrationsConfig =
            if portIntegrationsConfigOverride == null then
              normalizePortIntegrationsConfig { enabled = portIntegrationIds; }
            else
              normalizePortIntegrationsConfig portIntegrationsConfigOverride;
          effectivePortIntegrationIds = effectivePortIntegrationsConfig.enabled;
          codexMicroEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "codex-micro";
          globalDictationEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "global-dictation";
          mcpHelperReaperEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "mcp-helper-reaper";
        in
        pkgs.stdenv.mkDerivation {
          pname = "chatgpt-release-app";
          version = chatgptVersion;
          src = sourceRoot;
          __structuredAttrs = true;

          nativeBuildInputs = [
            pkgs.bash
            pkgs.cargo
            pkgs.curl
            pkgs.file
            pkgs.gcc
            pkgs.gnumake
            pkgs.gnused
            pkgs.nodejs
            pkgs.asar
            pkgs._7zz
            pkgs.patchelf
            pkgs.python3
            pkgs.unzip
            pkgs.util-linux
          ];

          dontConfigure = true;
          dontBuild = true;
          dontFixup = true;
          allowedReferences = [ ];

          installPhase = ''
            runHook preInstall

            export HOME="$TMPDIR/home"
            export npm_config_cache="$TMPDIR/npm-cache"
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"
            export npm_config_cafile="$SSL_CERT_FILE"
            export CARGO_HOME="$TMPDIR/cargo-home"
            export CARGO_BUILD_JOBS=1
            export SOURCE_DATE_EPOCH="${flakeSourceDateEpoch}"
            export CHATGPT_LINUX_TARGET_ID="generic-linux"
            export CHATGPT_LINUX_TARGET_ID_LIKE=""
            export CHATGPT_LINUX_TARGET_VERSION_ID=""
            export CHATGPT_LINUX_TARGET_PRETTY_NAME="Generic Linux"
            export CHATGPT_LINUX_TARGET_PACKAGE_FORMAT="unknown"
            export CHATGPT_LINUX_TARGET_PACKAGE_MANAGER="unknown"
            export CHATGPT_LINUX_TARGET_ARCH="${runtimeNodePlatform.managedNodeArch}"
            export CHATGPT_LINUX_TARGET_KERNEL_RELEASE="linux"
            export CHATGPT_LINUX_TARGET_DESKTOP=""
            export CHATGPT_LINUX_TARGET_SESSION_TYPE=""
            export CHATGPT_LINUX_TARGET_ATOMIC=0
            ${pkgs.lib.optionalString (flakeSourceCommit != "") ''
            export CHATGPT_LINUX_SOURCE_COMMIT="${flakeSourceCommit}"
            export CHATGPT_LINUX_SOURCE_REMOTE="${flakeSourceRemote}"
            ''}
            export CFLAGS="''${CFLAGS:-} -ffile-prefix-map=$TMPDIR=/build -fdebug-prefix-map=$TMPDIR=/build -fmacro-prefix-map=$TMPDIR=/build"
            export CXXFLAGS="''${CXXFLAGS:-} -ffile-prefix-map=$TMPDIR=/build -fdebug-prefix-map=$TMPDIR=/build -fmacro-prefix-map=$TMPDIR=/build"
            export RUSTFLAGS="''${RUSTFLAGS:-} --remap-path-prefix=$TMPDIR=/build -C link-arg=-Wl,--build-id=none"
            managed_node_build="$TMPDIR/managed-node-runtime"
            cp -a ${managedPortableNode} "$managed_node_build"
            chmod -R u+w "$managed_node_build"
            ${pkgs.patchelf}/bin/patchelf \
              --set-interpreter "${pkgs.stdenv.cc.bintools.dynamicLinker}" \
              --set-rpath "${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.glibc ]}" \
              "$managed_node_build/bin/node"
            export CHATGPT_MANAGED_NODE_SOURCE="$managed_node_build"
            export CHATGPT_PORT_INTEGRATIONS_CONFIG="${portIntegrationsConfigFile effectivePortIntegrationsConfig}"
            export CHATGPT_ELECTRON_ZIP_SOURCE="${electronZip}"
            export CHATGPT_NATIVE_MODULES_SOURCE="${chatgptNativeModules}"
            ${pkgs.lib.optionalString codexMicroEnabled ''
            export CHATGPT_MICRO_NODE_HID_ARCHIVE="${codexMicroNodeHidArchive}"
            ''}
            ${pkgs.lib.optionalString (browserUseNodeRepl != null) ''
            export CHATGPT_LINUX_NODE_REPL_SOURCE="${browserUseNodeRepl}/bin/node_repl"
            ''}
            export CHATGPT_LINUX_COMPUTER_USE_BACKEND_SOURCE="${chatgptComputerUseBinaries}/bin/chatgpt-computer-use-linux"
            export CHATGPT_LINUX_COMPUTER_USE_COSMIC_SOURCE="${chatgptComputerUseBinaries}/bin/chatgpt-computer-use-cosmic"
            export CHATGPT_CHROME_EXTENSION_HOST_SOURCE="${chatgptComputerUseBinaries}/bin/chatgpt-chrome-extension-host"
            export CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="${chatgptReleaseHelpers}/bin/chatgpt-generated-app-mutation-broker"
            export CHATGPT_LINUX_READ_ALOUD_MCP_SOURCE="${chatgptReadAloudMcpBinary}/bin/chatgpt-read-aloud-linux"
            export CHATGPT_NOTIFICATION_ACTIONS_SOURCE="${chatgptNotificationActionsBinary}/bin/chatgpt-notification-actions-linux"
            ${pkgs.lib.optionalString mcpHelperReaperEnabled ''
            export CHATGPT_MCP_HELPER_REAPER_SOURCE="${chatgptMcpHelperReaper}/bin/chatgpt-mcp-helper-reaper"
            ''}
            ${pkgs.lib.optionalString globalDictationEnabled ''
            export CHATGPT_GLOBAL_DICTATION_LINUX_SOURCE="${chatgptGlobalDictationBinary}/bin/chatgpt-global-dictation-linux"
            ''}
            mkdir -p "$HOME" "$npm_config_cache" "$CARGO_HOME"

            source_dir="$TMPDIR/chatgpt-release-source"
            mkdir -p "$source_dir"
            cp -R ./. "$source_dir/"
            chmod -R u+w "$source_dir"
            cp ${chatgptDmg} "$source_dir/ChatGPT.dmg"

            substituteInPlace "$source_dir/scripts/lib/asar-patch.sh" \
              --replace-fail "npx --yes asar" "asar"
            substituteInPlace "$source_dir/scripts/lib/dmg.sh" \
              --replace-fail "npx --yes asar" "asar"

            export CHATGPT_INSTALL_TRANSACTION_ACTIVE=1
            export CHATGPT_INSTALL_DIR="$out/opt/chatgpt"
            export CHATGPT_PATCH_REPORT_JSON="$TMPDIR/release-patch-report.json"
            export CHATGPT_REBUILD_REPORT_JSON="$TMPDIR/release-rebuild-report.json"
            ${pkgs.bash}/bin/bash "$source_dir/install.sh" "$source_dir/ChatGPT.dmg"

            generation_receipt_root="$out/opt/.chatgpt-generation-receipts"
            rm -rf -- "$generation_receipt_root"
            test ! -e "$generation_receipt_root"

            test -f "$CHATGPT_INSTALL_DIR/resources/app.asar"
            test ! -e "$CHATGPT_INSTALL_DIR/resources/app-extracted"

            while IFS= read -r -d $'\0' link; do
              target="$(readlink "$link")"
              case "$target" in
                /nix/store/*)
                  echo "release app contains a Nix-store symlink: $link -> $target" >&2
                  exit 1
                  ;;
              esac
            done < <(find "$CHATGPT_INSTALL_DIR" -type l -print0)

            while IFS= read -r -d $'\0' file; do
              if ${pkgs.file}/bin/file -b "$file" | grep -Fq ELF; then
                interpreter="$(${pkgs.patchelf}/bin/patchelf --print-interpreter "$file" 2>/dev/null || true)"
                case "$interpreter" in
                  /nix/store/*)
                    ${pkgs.patchelf}/bin/patchelf --set-interpreter "${portableElfInterpreter}" "$file"
                    ;;
                esac
                rpath="$(${pkgs.patchelf}/bin/patchelf --print-rpath "$file" 2>/dev/null || true)"
                if [[ "$rpath" == *'/nix/store/'* ]]; then
                  portable_rpath="$(printf '%s' "$rpath" | awk -v RS=: '
                    index($0, "/nix/store/") != 1 {
                      if (count++ > 0) printf ":"
                      printf "%s", $0
                    }
                  ')"
                  if [ -n "$portable_rpath" ]; then
                    ${pkgs.patchelf}/bin/patchelf --set-rpath "$portable_rpath" "$file"
                  else
                    ${pkgs.patchelf}/bin/patchelf --remove-rpath "$file"
                  fi
                fi
                interpreter="$(${pkgs.patchelf}/bin/patchelf --print-interpreter "$file" 2>/dev/null || true)"
                rpath="$(${pkgs.patchelf}/bin/patchelf --print-rpath "$file" 2>/dev/null || true)"
                [[ "$interpreter" != *'/nix/store/'* ]]
                [[ "$rpath" != *'/nix/store/'* ]]
              elif grep -Iq . "$file" && grep -Fq '/nix/store/' "$file"; then
                echo "release app text file contains a Nix-store path: $file" >&2
                exit 1
              fi
            done < <(find "$CHATGPT_INSTALL_DIR" -type f -print0)

            runHook postInstall

            find "$CHATGPT_INSTALL_DIR" -type d -exec chmod 0555 {} +
            while IFS= read -r -d $'\0' file; do
              if [ -x "$file" ]; then
                chmod 0555 "$file"
              else
                chmod 0444 "$file"
              fi
            done < <(find "$CHATGPT_INSTALL_DIR" -type f -print0)

            rm -rf -- "$generation_receipt_root"
            test ! -e "$generation_receipt_root"
            broker_digest="$(sed -n \
              's/^\([0-9a-f]\{64\}\)  chatgpt-generated-app-mutation-broker$/\1/p' \
              "$CHATGPT_INSTALL_DIR/.chatgpt-linux/generated-app-mutation-broker.sha256")"
            test -n "$broker_digest"
            ${pkgs.python3}/bin/python3 \
              "$source_dir/scripts/lib/package-provenance.py" \
              write-generation-receipt \
              --app "$CHATGPT_INSTALL_DIR" \
              --broker-sha256 "$broker_digest" >/dev/null
            ${pkgs.python3}/bin/python3 \
              "$source_dir/scripts/lib/package-provenance.py" \
              validate-generation-receipt \
              --app "$CHATGPT_INSTALL_DIR" >/dev/null
          '';
        };

        chatgptReleaseApp = mkChatGPTReleaseApp { };
        chatgptReleaseAppReceiptValidation = pkgs.runCommand
          "chatgpt-release-app-generation-receipt-check"
          { nativeBuildInputs = [ pkgs.python3 ]; }
          ''
            ${pkgs.python3}/bin/python3 \
              ${sourceRoot}/scripts/lib/package-provenance.py \
              validate-generation-receipt \
              --app ${chatgptReleaseApp}/opt/chatgpt >/dev/null
            touch "$out"
          '';
        releaseSandboxCanary = pkgs.runCommandLocal "chatgpt-release-sandbox-canary" { } ''
          if [ "${if releaseSandboxCanaryPathIsValid then "1" else "0"}" != 1 ]; then
            echo "release sandbox canary path is missing or invalid" >&2
            exit 1
          fi
          if [ -e ${pkgs.lib.escapeShellArg releaseSandboxCanaryPath} ]; then
            echo "release sandbox canary escaped the Nix build sandbox" >&2
            exit 1
          fi
          mkdir "$out"
        '';

        mkChatGPTPayload = { portIntegrationIds ? [ ], portIntegrationsConfigOverride ? null }:
        let
          effectivePortIntegrationsConfig =
            if portIntegrationsConfigOverride == null then
              normalizePortIntegrationsConfig { enabled = portIntegrationIds; }
            else
              normalizePortIntegrationsConfig portIntegrationsConfigOverride;
          effectivePortIntegrationIds = effectivePortIntegrationsConfig.enabled;
          codexMicroEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "codex-micro";
          globalDictationEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "global-dictation";
          mcpHelperReaperEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "mcp-helper-reaper";
        in
        pkgs.stdenv.mkDerivation {
          pname = "chatgpt${packageSuffix { portIntegrationIds = effectivePortIntegrationIds; }}-payload";
          version = chatgptVersion;
          src = sourceRoot;
          __structuredAttrs = true;

          nativeBuildInputs = [
            pkgs.bash
            pkgs.cargo
            pkgs.curl
            pkgs.gcc
            pkgs.gnumake
            pkgs.gnused
            pkgs.makeWrapper
            pkgs.nodejs
            pkgs.asar
            pkgs._7zz
            pkgs.patchelf
            pkgs.python3
            pkgs.unzip
            pkgs.util-linux
          ];

          dontConfigure = true;
          dontBuild = true;

          installPhase = ''
            runHook preInstall

            export HOME="$TMPDIR/home"
            export npm_config_cache="$TMPDIR/npm-cache"
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"
            export npm_config_cafile="$SSL_CERT_FILE"
            export CARGO_HOME="$TMPDIR/cargo-home"
            export CARGO_BUILD_JOBS=1
            export SOURCE_DATE_EPOCH="${flakeSourceDateEpoch}"
            ${pkgs.lib.optionalString (flakeSourceCommit != "") ''
            export CHATGPT_LINUX_SOURCE_COMMIT="${flakeSourceCommit}"
            export CHATGPT_LINUX_SOURCE_REMOTE="${flakeSourceRemote}"
            ''}
            export CFLAGS="''${CFLAGS:-} -ffile-prefix-map=$TMPDIR=/build -fdebug-prefix-map=$TMPDIR=/build -fmacro-prefix-map=$TMPDIR=/build"
            export CXXFLAGS="''${CXXFLAGS:-} -ffile-prefix-map=$TMPDIR=/build -fdebug-prefix-map=$TMPDIR=/build -fmacro-prefix-map=$TMPDIR=/build"
            export RUSTFLAGS="''${RUSTFLAGS:-} --remap-path-prefix=$TMPDIR=/build -C link-arg=-Wl,--build-id=none"
            export CHATGPT_MANAGED_NODE_SOURCE="${pkgs.nodejs}"
            export CHATGPT_PORT_INTEGRATIONS_CONFIG="${portIntegrationsConfigFile effectivePortIntegrationsConfig}"
            export CHATGPT_ELECTRON_ZIP_SOURCE="${electronZip}"
            export CHATGPT_NATIVE_MODULES_SOURCE="${chatgptNativeModules}"
            ${pkgs.lib.optionalString codexMicroEnabled ''
            export CHATGPT_MICRO_NODE_HID_ARCHIVE="${codexMicroNodeHidArchive}"
            ''}
            ${pkgs.lib.optionalString (browserUseNodeRepl != null) ''
            export CHATGPT_LINUX_NODE_REPL_SOURCE="${browserUseNodeRepl}/bin/node_repl"
            ''}
            export CHATGPT_LINUX_COMPUTER_USE_BACKEND_SOURCE="${chatgptComputerUseBinaries}/bin/chatgpt-computer-use-linux"
            export CHATGPT_LINUX_COMPUTER_USE_COSMIC_SOURCE="${chatgptComputerUseBinaries}/bin/chatgpt-computer-use-cosmic"
            export CHATGPT_CHROME_EXTENSION_HOST_SOURCE="${chatgptComputerUseBinaries}/bin/chatgpt-chrome-extension-host"
            export CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="${chatgptGeneratedAppMutationBroker}/bin/chatgpt-generated-app-mutation-broker"
            export CHATGPT_LINUX_READ_ALOUD_MCP_SOURCE="${chatgptReadAloudMcpBinary}/bin/chatgpt-read-aloud-linux"
            export CHATGPT_NOTIFICATION_ACTIONS_SOURCE="${chatgptNotificationActionsBinary}/bin/chatgpt-notification-actions-linux"
            ${pkgs.lib.optionalString mcpHelperReaperEnabled ''
            export CHATGPT_MCP_HELPER_REAPER_SOURCE="${chatgptMcpHelperReaper}/bin/chatgpt-mcp-helper-reaper"
            ''}
            ${pkgs.lib.optionalString globalDictationEnabled ''
            export CHATGPT_GLOBAL_DICTATION_LINUX_SOURCE="${chatgptGlobalDictationBinary}/bin/chatgpt-global-dictation-linux"
            ''}
            mkdir -p "$HOME" "$npm_config_cache" "$CARGO_HOME"

            source_dir="$TMPDIR/chatgpt-source"
            mkdir -p "$source_dir"
            cp -R ./. "$source_dir/"
            chmod -R u+w "$source_dir"
            cp ${chatgptDmg} "$source_dir/ChatGPT.dmg"

            substituteInPlace "$source_dir/scripts/lib/asar-patch.sh" \
              --replace-fail "npx --yes asar" "asar"
            substituteInPlace "$source_dir/scripts/lib/dmg.sh" \
              --replace-fail "npx --yes asar" "asar"

            export CHATGPT_INSTALL_DIR="$out/opt/chatgpt"
            ${pkgs.bash}/bin/bash "$source_dir/install.sh" "$source_dir/ChatGPT.dmg"

            asar extract "$CHATGPT_INSTALL_DIR/resources/app.asar" "$CHATGPT_INSTALL_DIR/resources/app-extracted"
            rm -f "$CHATGPT_INSTALL_DIR/resources/app.asar"
            rm -rf "$CHATGPT_INSTALL_DIR/resources/app.asar.unpacked"

            ${patchNixGeneratedScripts "$out/opt/chatgpt"}

            runHook postInstall
          '';
        };

        buildChatGPT = { portIntegrationIds ? [ ], portIntegrationsConfigOverride ? null }:
        let
          effectivePortIntegrationsConfig =
            if portIntegrationsConfigOverride == null then
              normalizePortIntegrationsConfig { enabled = portIntegrationIds; }
            else
              normalizePortIntegrationsConfig portIntegrationsConfigOverride;
          normalizedPortIntegrationIds = effectivePortIntegrationsConfig.enabled;
          codexMicroEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "codex-micro";
          globalDictationEnabled = portIntegrationEnabled effectivePortIntegrationsConfig "global-dictation";
          integrationArgs = {
            portIntegrationIds = normalizedPortIntegrationIds;
          };
          payload = mkChatGPTPayload {
            portIntegrationIds = normalizedPortIntegrationIds;
            portIntegrationsConfigOverride = effectivePortIntegrationsConfig;
          };
          payloadLauncherPath = launcherPath + pkgs.lib.optionalString
            globalDictationEnabled
            ":${globalDictationRuntimePath}";
        in
        pkgs.stdenv.mkDerivation {
          pname = "chatgpt${packageSuffix integrationArgs}";
          version = chatgptVersion;
          src = payload;

          nativeBuildInputs = [
            pkgs.asar
            pkgs.makeWrapper
            pkgs.patchelf
          ];

          dontConfigure = true;
          dontBuild = true;

          installPhase = ''
            runHook preInstall

            mkdir -p "$out/opt"
            cp -aT "$src/opt/chatgpt" "$out/opt/chatgpt"
            chmod -R u+w "$out/opt/chatgpt"
            rm -rf "$out/opt/chatgpt/resources/node-runtime"
            ln -s ${pkgs.nodejs} "$out/opt/chatgpt/resources/node-runtime"
            if [ -e "$out/opt/chatgpt/update-builder/node-runtime" ]; then
              rm -rf "$out/opt/chatgpt/update-builder/node-runtime"
              ln -s ${pkgs.nodejs} "$out/opt/chatgpt/update-builder/node-runtime"
            fi

            resources_dir="$out/opt/chatgpt/resources"
            (cd "$resources_dir/app-extracted" && find . -type f | LC_ALL=C sort | sed 's#^\./##') > "$TMPDIR/app.asar.ordering"
            asar pack "$resources_dir/app-extracted" "$resources_dir/app.asar" \
              --ordering "$TMPDIR/app.asar.ordering" \
              --unpack "{*.node,*.so,*.dylib}"
            rm -rf "$resources_dir/app-extracted"

            ${pkgs.lib.optionalString codexMicroEnabled ''
            codex_micro_node_count=0
            while IFS= read -r codex_micro_node; do
              codex_micro_node_count=$((codex_micro_node_count + 1))
              patchelf --set-rpath "${codexMicroRuntimeLibPath}" "$codex_micro_node"
              actual_rpath="$(patchelf --print-rpath "$codex_micro_node")"
              if [ "$actual_rpath" != "${codexMicroRuntimeLibPath}" ]; then
                echo "codex-micro node-hid RPATH verification failed: $actual_rpath" >&2
                exit 1
              fi
            done < <(
              find "$resources_dir/app.asar.unpacked" -type f \
                -path '*/node-hid/prebuilds/HID_hidraw-linux-*/node-napi-v4.node' \
                -print
            )
            if [ "$codex_micro_node_count" -ne 1 ]; then
              echo "expected exactly one codex-micro node-hid Linux binding, found $codex_micro_node_count" >&2
              exit 1
            fi

            install -Dm0644 \
              "$out/opt/chatgpt/.chatgpt-linux/integrations/codex-micro/70-codex-micro.rules" \
              "$out/lib/udev/rules.d/70-codex-micro.rules"
            ''}

            for node_repl_binary in \
              "$resources_dir/node_repl" \
              "$resources_dir/node_repl.chatgpt-linux-original"; do
              if [ -f "$node_repl_binary" ] \
                  && [ "$(dd if="$node_repl_binary" bs=1 count=4 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "7f454c46" ]; then
                patchelf --set-interpreter "$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)" \
                  --set-rpath "${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.glibc ]}" \
                  "$node_repl_binary"
              fi
            done

            if [ -f "$resources_dir/node_repl.chatgpt-linux-original" ]; then
              node_repl_interpreter="$(patchelf --print-interpreter \
                "$resources_dir/node_repl.chatgpt-linux-original")"
              node_repl_rpath="$(patchelf --print-rpath \
                "$resources_dir/node_repl.chatgpt-linux-original")"
              case "$node_repl_interpreter" in
                /nix/store/*) ;;
                *) echo "node_repl backup has non-Nix interpreter: $node_repl_interpreter" >&2; exit 1 ;;
              esac
              case "$node_repl_rpath" in
                *"/nix/store/"*) ;;
                *) echo "node_repl backup has non-Nix RPATH: $node_repl_rpath" >&2; exit 1 ;;
              esac
            fi

            ${patchNixInstalledApp "$out/opt/chatgpt"}

            install -Dm0644 "$out/opt/chatgpt/.chatgpt-linux/chatgpt.png" \
              "$out/share/icons/hicolor/256x256/apps/chatgpt.png"

            install -Dm0644 ${sourceRoot}/packaging/linux/chatgpt.desktop \
              "$out/share/applications/chatgpt.desktop"
            substituteInPlace "$out/share/applications/chatgpt.desktop" \
              --replace-fail "/usr/bin/chatgpt" "$out/bin/chatgpt" \
              --replace-fail "/usr/share/applications/chatgpt.desktop" "$out/share/applications/chatgpt.desktop"

            makeWrapper "$out/opt/chatgpt/start.sh" "$out/bin/chatgpt" \
              --prefix PATH : "${payloadLauncherPath}" \
              --run 'export XDG_DATA_DIRS="''${XDG_DATA_DIRS:-${xdgDefaultDataDirs}}"' \
              --prefix XDG_DATA_DIRS : "${gsettingsSchemaDataDirs}" \
              --prefix LD_LIBRARY_PATH : "${electronLibPath}" \
              --prefix LD_LIBRARY_PATH : "${runtimeLibPath}" \
              --prefix PATH : "/run/current-system/sw/bin" \
              --prefix PATH : "/etc/profiles/per-user/\$USER/bin"

            leaked_mutation_broker="$(find \
              "$out/opt/chatgpt" \
              "$out/bin" \
              "$out/share" \
              -type f -name chatgpt-generated-app-mutation-broker -print -quit)"
            if [ -n "$leaked_mutation_broker" ]; then
              echo "build-only generated-app mutation broker leaked into runtime payload: $leaked_mutation_broker" >&2
              exit 1
            fi

            runHook postInstall
          '';

          meta = {
            description =
              let
                integrationIds = enabledIntegrationIds integrationArgs;
              in
              if integrationIds == [ ] then
                "ChatGPT for Linux"
              else
                "ChatGPT for Linux with ${pkgs.lib.concatStringsSep ", " integrationIds} enabled";
            homepage = "https://github.com/nisavid/chatgpt-linux";
            license = pkgs.lib.licenses.mit;
            platforms = pkgs.lib.platforms.linux;
            mainProgram = "chatgpt";
          };
        };

        chatgpt = pkgs.lib.makeOverridable buildChatGPT { };

        chatgptRemoteMobileControl = chatgpt.override {
          portIntegrationIds = [ "remote-mobile-control" ];
        };

        chatgptWatchdogIntegrationCheck = chatgpt.override {
          portIntegrationsConfigOverride = watchdogPortIntegrationsConfig;
        };

        installer = pkgs.writeShellApplication {
          name = "chatgpt-installer";
          runtimeInputs = [
            pkgs.bash
            pkgs.nodejs
            pkgs.python3
            pkgs._7zz
            pkgs.curl
            pkgs.unzip
            pkgs.gnumake
            pkgs.gcc
            pkgs.patchelf
          ];
          text = ''
            set -euo pipefail

            root_dir="$(pwd)"
            workdir="$(mktemp -d)"
            source_dir="$workdir/source"
            cleanup() {
              rm -rf "$workdir"
            }
            trap cleanup EXIT

            mkdir -p "$source_dir"
            cp -R ${sourceRoot}/. "$source_dir"
            chmod -R u+w "$source_dir"
            cp ${chatgptDmg} "$source_dir/ChatGPT.dmg"
            chmod +x "$source_dir/install.sh"

            cd "$source_dir"
            export CHATGPT_INSTALL_DIR="''${CHATGPT_INSTALL_DIR:-$root_dir/chatgpt}"
            export CHATGPT_MANAGED_NODE_SOURCE="${pkgs.nodejs}"
            export CHATGPT_NOTIFICATION_ACTIONS_SOURCE="${chatgptNotificationActionsBinary}/bin/chatgpt-notification-actions-linux"
            export CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE="${chatgptGeneratedAppMutationBroker}/bin/chatgpt-generated-app-mutation-broker"
            ${pkgs.bash}/bin/bash "$source_dir/install.sh" "$source_dir/ChatGPT.dmg" "$@"

            install_dir="''${CHATGPT_INSTALL_DIR:-$root_dir/chatgpt}"

            ${patchNixInstalledApp "$install_dir"}
          '';
        };
      in
      {
        packages = {
          default = chatgpt;
          chatgpt = chatgpt;
          chatgpt-dmg = chatgptDmg;
          chatgpt-remote-mobile-control = chatgptRemoteMobileControl;
          chatgpt-release-app = chatgptReleaseApp;
          release-helpers = chatgptReleaseHelpers;
          release-sandbox-canary = releaseSandboxCanary;
          installer = installer;
        };

        checks = {
          generated-app-mutation-broker = chatgptGeneratedAppMutationBroker;
          release-app-generation-receipt = chatgptReleaseAppReceiptValidation;
          release-helpers = chatgptReleaseHelpers;
          generated-app-mutation-broker-installer = pkgs.runCommand "chatgpt-generated-app-mutation-broker-installer-check" { } ''
            grep -F 'CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE=' ${installer}/bin/chatgpt-installer >/dev/null
            touch "$out"
          '';
          generated-app-mutation-broker-build-only = pkgs.runCommand "chatgpt-generated-app-mutation-broker-build-only-check" { } ''
            leaked_mutation_broker="$(find \
              ${chatgpt}/opt/chatgpt \
              ${chatgpt}/bin \
              ${chatgpt}/share \
              -type f -name chatgpt-generated-app-mutation-broker -print -quit)"
            test -z "$leaked_mutation_broker"
            touch "$out"
          '';
          notification-actions-linux = chatgptNotificationActionsBinary;
          notification-actions-installer = pkgs.runCommand "chatgpt-notification-actions-installer-check" { } ''
            grep -F 'CHATGPT_NOTIFICATION_ACTIONS_SOURCE=' ${installer}/bin/chatgpt-installer >/dev/null
            touch "$out"
          '';
          nix-gsettings-schema-wrapper = pkgs.runCommand "chatgpt-nix-gsettings-schema-wrapper-check" { } ''
            schema_data_dirs=${pkgs.lib.escapeShellArg gsettingsSchemaDataDirs}
            default_data_dirs=${pkgs.lib.escapeShellArg xdgDefaultDataDirs}
            explicit_data_dirs=/custom/share:/other/share

            run_wrapper() {
              case "$1" in
                unset) unset XDG_DATA_DIRS ;;
                empty) export XDG_DATA_DIRS= ;;
                populated) export XDG_DATA_DIRS="$explicit_data_dirs" ;;
                *) echo "unknown test case: $1" >&2; return 1 ;;
              esac

              exec() {
                printf '%s\n' "$XDG_DATA_DIRS"
              }

              source ${chatgpt}/bin/chatgpt
            }

            assert_data_dirs() {
              test_case="$1"
              expected="$2"
              actual="$(run_wrapper "$test_case")"
              if [ "$actual" != "$expected" ]; then
                printf '%s: expected <%s>, got <%s>\n' \
                  "$test_case" "$expected" "$actual" >&2
                return 1
              fi
            }

            expected_defaults="$schema_data_dirs:$default_data_dirs"
            assert_data_dirs unset "$expected_defaults"
            assert_data_dirs empty "$expected_defaults"
            assert_data_dirs populated "$schema_data_dirs:$explicit_data_dirs"
            touch "$out"
          '';
          nix-port-integrations-evaluation = import ./nix/port-integrations-test.nix {
            inherit pkgs self system;
          };
          watchdog-port-integrations = chatgptWatchdogIntegrationCheck;
          nix-port-integrations-multi-integration = chatgptWatchdogIntegrationCheck;
        };

        apps.default = {
          type = "app";
          program = "${chatgpt}/bin/chatgpt";
        };

        apps.remote-mobile-control = {
          type = "app";
          program = "${chatgptRemoteMobileControl}/bin/chatgpt";
        };

        apps.installer = {
          type = "app";
          program = "${installer}/bin/chatgpt-installer";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs
            pkgs.python3
            pkgs._7zz
            pkgs.curl
            pkgs.unzip
            pkgs.gnumake
            pkgs.gcc
          ];
        };
      }
    ) // {
      homeManagerModules = rec {
        default = import ./nix/home-manager-module.nix { inherit self; };
        chatgpt-linux = default;
      };

      nixosModules = rec {
        default = import ./nix/nixos-module.nix { inherit self; };
        chatgpt-linux = default;
      };
    };
}
