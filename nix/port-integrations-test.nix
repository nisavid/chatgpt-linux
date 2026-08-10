{
  pkgs,
  self,
  system,
}:
let
  inherit (pkgs) lib;
  packages = self.packages.${system};
  portIntegrations = import ./port-integrations.nix { inherit lib; };
  homeManagerModule = import ./home-manager-module.nix { inherit self; };
  nixosModule = import ./nixos-module.nix { inherit self; };

  testIntegrationIds = [
    "persistent-status-panel"
    "appshots"
    "codex-micro"
    "chatgpt-wrapper-updater"
    "directory-only-working-tree-watch"
    "frameless-titlebar"
    "global-dictation"
    "mcp-helper-reaper"
    "remote-mobile-control"
    "pet-overlay"
    "open-target-discovery"
    "remote-control-ui"
    "ui-tweaks"
    "appshots"
  ];
  normalizedTestIntegrationIds = [
    "appshots"
    "codex-micro"
    "chatgpt-wrapper-updater"
    "directory-only-working-tree-watch"
    "frameless-titlebar"
    "global-dictation"
    "mcp-helper-reaper"
    "open-target-discovery"
    "persistent-status-panel"
    "pet-overlay"
    "remote-control-ui"
    "remote-mobile-control"
    "ui-tweaks"
  ];
  watchdogIntegrationIds = (builtins.fromJSON (builtins.readFile ../scripts/ci/watchdog-port-integrations.json)).enabled;
  normalizedWatchdogIntegrationIds = [
    "appshots"
    "codex-micro"
    "chatgpt-wrapper-updater"
    "directory-only-working-tree-watch"
    "frameless-titlebar"
    "global-dictation"
    "mcp-helper-reaper"
    "node-repl-reaper"
    "open-target-discovery"
    "persistent-status-panel"
    "remote-control-ui"
    "remote-mobile-control"
    "ui-tweaks"
  ];

  evalHomeManager = moduleConfig:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        homeManagerModule
        ({ lib, ... }: {
          options = {
            assertions = lib.mkOption {
              type = lib.types.listOf lib.types.anything;
              default = [ ];
            };
            home.homeDirectory = lib.mkOption { type = lib.types.str; };
            home.profileDirectory = lib.mkOption { type = lib.types.str; };
            home.packages = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [ ];
            };
            home.sessionVariables = lib.mkOption {
              type = lib.types.attrsOf lib.types.anything;
              default = { };
            };
            systemd.user.sessionVariables = lib.mkOption {
              type = lib.types.attrsOf lib.types.anything;
              default = { };
            };
            systemd.user.services = lib.mkOption {
              type = lib.types.attrsOf lib.types.anything;
              default = { };
            };
          };
          config = {
            home.homeDirectory = "/home/tester";
            home.profileDirectory = "/home/tester/.nix-profile";
            programs.chatgptLinux = moduleConfig;
          };
        })
      ];
    };

  evalNixOS = moduleConfig:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        nixosModule
        ({ lib, ... }: {
          options = {
            assertions = lib.mkOption {
              type = lib.types.listOf lib.types.anything;
              default = [ ];
            };
            environment.systemPackages = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [ ];
            };
            environment.sessionVariables = lib.mkOption {
              type = lib.types.attrsOf lib.types.anything;
              default = { };
            };
            services.udev.packages = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [ ];
            };
            systemd.user.services = lib.mkOption {
              type = lib.types.attrsOf lib.types.anything;
              default = { };
            };
          };
          config.programs.chatgptLinux = moduleConfig;
        })
      ];
    };

  homePackage = moduleConfig:
    builtins.head (evalHomeManager moduleConfig).config.home.packages;
  nixosPackage = moduleConfig:
    builtins.head (evalNixOS moduleConfig).config.environment.systemPackages;

  defaultConfig = { enable = true; };
  codexMicroConfig = {
    enable = true;
    portIntegrations = [ "codex-micro" ];
  };
  disabledCodexMicroConfig = {
    enable = false;
    portIntegrations = [ "codex-micro" ];
  };
  legacyRemoteConfig = {
    enable = true;
    remoteMobileControl.enable = true;
  };
  combinedConfig = {
    enable = true;
    remoteMobileControl.enable = true;
    portIntegrations = testIntegrationIds;
  };

  expectedCombined = packages.chatgpt.override {
    portIntegrationIds = normalizedTestIntegrationIds;
  };
  expectedCodexMicro = packages.chatgpt.override {
    portIntegrationIds = [ "codex-micro" ];
  };
  reorderedCombined = packages.chatgpt.override {
    portIntegrationIds = [
      "remote-mobile-control"
      "frameless-titlebar"
      "codex-micro"
      "chatgpt-wrapper-updater"
      "directory-only-working-tree-watch"
      "global-dictation"
      "persistent-status-panel"
      "mcp-helper-reaper"
      "pet-overlay"
      "open-target-discovery"
      "remote-control-ui"
      "ui-tweaks"
      "appshots"
      "appshots"
      "codex-micro"
    ];
  };

  nixosDefault = evalNixOS defaultConfig;
  nixosCodexMicro = evalNixOS codexMicroConfig;
  nixosDisabledCodexMicro = evalNixOS disabledCodexMicroConfig;

  customPackage = pkgs.runCommand "chatgpt-custom-test-package" { } ''
    mkdir -p "$out"
  '';
  customConfig = combinedConfig // { package = customPackage; };
  nixosCustom = evalNixOS customConfig;
  remoteControlConfig = {
    enable = true;
    package = customPackage;
    remoteControl = {
      enable = true;
      package = pkgs.writeShellScriptBin "codex" "exit 0";
      environmentFile = "/run/secrets/chatgpt-remote-control.env";
    };
  };
  remoteControlConfigWithEnvironmentFile = environmentFile:
    remoteControlConfig
    // {
      remoteControl = remoteControlConfig.remoteControl // { inherit environmentFile; };
    };
  homeRemoteService =
    (evalHomeManager remoteControlConfig).config.systemd.user.services.chatgpt-remote-control;
  nixosRemoteService =
    (evalNixOS remoteControlConfig).config.systemd.user.services.chatgpt-remote-control;
  optionalHomeRemoteService =
    (evalHomeManager (
      remoteControlConfigWithEnvironmentFile "-/run/secrets/chatgpt-remote-control.env"
    )).config.systemd.user.services.chatgpt-remote-control;
  optionalNixOSRemoteService =
    (evalNixOS (
      remoteControlConfigWithEnvironmentFile "-/run/secrets/chatgpt-remote-control.env"
    )).config.systemd.user.services.chatgpt-remote-control;

  invalidBuilder = builtins.tryEval (
    (packages.chatgpt.override {
      portIntegrationIds = [ "not-nix-compatible" ];
    }).drvPath
  );
  shallowRepositoryWatchBuilder = builtins.tryEval (
    (packages.chatgpt.override {
      portIntegrationIds = [ "shallow-repository-watches" ];
    }).drvPath
  );
  invalidHomeManager = builtins.tryEval (
    builtins.deepSeq
      (evalHomeManager {
        enable = true;
        portIntegrations = [ "not-nix-compatible" ];
      }).config.home.packages
      true
  );
  invalidNixOS = builtins.tryEval (
    builtins.deepSeq
      (evalNixOS {
        enable = true;
        portIntegrations = [ "not-nix-compatible" ];
      }).config.environment.systemPackages
      true
  );
  invalidHomeManagerEnvironmentFile = builtins.tryEval (
    builtins.deepSeq
      (evalHomeManager (
        remoteControlConfigWithEnvironmentFile ./port-integrations-test.nix
      )).config.systemd.user.services.chatgpt-remote-control
      true
  );
  invalidNixOSEnvironmentFile = builtins.tryEval (
    builtins.deepSeq
      (evalNixOS (
        remoteControlConfigWithEnvironmentFile ./port-integrations-test.nix
      )).config.systemd.user.services.chatgpt-remote-control
      true
  );
  storeEnvironmentFiles = [
    "${./port-integrations-test.nix}"
    "-${./port-integrations-test.nix}"
  ];
  invalidRuntimeEnvironmentFiles = [
    ""
    "secrets.env"
    "-secrets.env"
    "//nix/store/example-secret"
    "/run/../nix/store/example-secret"
    "/nix//store/example-secret"
    "/run/secrets/./chatgpt-remote-control.env"
    "/run/secrets/"
  ];
  contextEnvironmentFiles = [
    "/run/secrets/${./port-integrations-test.nix}"
    "-/run/secrets/${./port-integrations-test.nix}"
  ];
  homeManagerStoreEnvironmentFileAssertions = map (
    environmentFile:
    (evalHomeManager (
      remoteControlConfigWithEnvironmentFile environmentFile
    )).config.assertions
  ) storeEnvironmentFiles;
  nixosStoreEnvironmentFileAssertions = map (
    environmentFile:
    (evalNixOS (
      remoteControlConfigWithEnvironmentFile environmentFile
    )).config.assertions
  ) storeEnvironmentFiles;
  homeManagerRuntimeEnvironmentFileAssertions = map (
    environmentFile:
    (evalHomeManager (
      remoteControlConfigWithEnvironmentFile environmentFile
    )).config.assertions
  ) invalidRuntimeEnvironmentFiles;
  nixosRuntimeEnvironmentFileAssertions = map (
    environmentFile:
    (evalNixOS (
      remoteControlConfigWithEnvironmentFile environmentFile
    )).config.assertions
  ) invalidRuntimeEnvironmentFiles;
  homeManagerContextEnvironmentFileAssertions = map (
    environmentFile:
    (evalHomeManager (
      remoteControlConfigWithEnvironmentFile environmentFile
    )).config.assertions
  ) contextEnvironmentFiles;
  nixosContextEnvironmentFileAssertions = map (
    environmentFile:
    (evalNixOS (
      remoteControlConfigWithEnvironmentFile environmentFile
    )).config.assertions
  ) contextEnvironmentFiles;
in
assert lib.assertMsg
  (lib.elem "codex-micro" (portIntegrations.normalize portIntegrations.supportedIntegrationIds))
  "codex-micro is missing from the normalized Nix-supported integration list";
assert lib.assertMsg
  (portIntegrations.normalize [ "codex-micro" "appshots" "codex-micro" ] == [
    "appshots"
    "codex-micro"
  ])
  "codex-micro was not accepted, sorted, and deduplicated";
assert lib.assertMsg
  (portIntegrations.normalize testIntegrationIds == normalizedTestIntegrationIds)
  "Nix port integration IDs must be sorted and deduplicated";
assert lib.assertMsg
  (portIntegrations.normalize watchdogIntegrationIds == normalizedWatchdogIntegrationIds)
  "the committed watchdog port integration profile drifted from the Nix-supported profile";
assert lib.assertMsg
  ((homePackage defaultConfig).drvPath == packages.chatgpt.drvPath)
  "the Home Manager default package changed";
assert lib.assertMsg
  ((nixosPackage defaultConfig).drvPath == packages.chatgpt.drvPath)
  "the NixOS default package changed";
assert lib.assertMsg
  ((homePackage codexMicroConfig).drvPath == expectedCodexMicro.drvPath)
  "Home Manager did not select the codex-micro package";
assert lib.assertMsg
  ((nixosPackage codexMicroConfig).drvPath == expectedCodexMicro.drvPath)
  "NixOS did not select the codex-micro package";
assert lib.assertMsg
  (expectedCodexMicro.drvPath != packages.chatgpt.drvPath)
  "enabling codex-micro did not change the selected package";
assert lib.assertMsg
  (
    builtins.length nixosCodexMicro.config.services.udev.packages == 1
    && (builtins.head nixosCodexMicro.config.services.udev.packages).drvPath
      == expectedCodexMicro.drvPath
  )
  "NixOS did not register the codex-micro package as a udev rules source";
assert lib.assertMsg
  (nixosDefault.config.services.udev.packages == [ ])
  "the NixOS default unexpectedly installs codex-micro udev rules";
assert lib.assertMsg
  (nixosDisabledCodexMicro.config.services.udev.packages == [ ])
  "disabled NixOS unexpectedly installs codex-micro udev rules";
assert lib.assertMsg
  ((homePackage legacyRemoteConfig).drvPath == packages.chatgpt-remote-mobile-control.drvPath)
  "the Home Manager remoteMobileControl shorthand changed";
assert lib.assertMsg
  ((nixosPackage legacyRemoteConfig).drvPath == packages.chatgpt-remote-mobile-control.drvPath)
  "the NixOS remoteMobileControl shorthand changed";
assert lib.assertMsg
  ((homePackage combinedConfig).drvPath == expectedCombined.drvPath)
  "Home Manager did not select the normalized combined package";
assert lib.assertMsg
  ((nixosPackage combinedConfig).drvPath == expectedCombined.drvPath)
  "NixOS did not select the normalized combined package";
assert lib.assertMsg
  (expectedCombined.drvPath == reorderedCombined.drvPath)
  "equivalent integration lists produced different derivations";
assert lib.assertMsg
  ((homePackage customConfig).drvPath == customPackage.drvPath)
  "the Home Manager custom package override lost precedence";
assert lib.assertMsg
  ((nixosPackage customConfig).drvPath == customPackage.drvPath)
  "the NixOS custom package override lost precedence";
assert lib.assertMsg
  (nixosCustom.config.services.udev.packages == [ ])
  "the NixOS custom package override unexpectedly inherited codex-micro udev policy";
assert lib.assertMsg (!invalidBuilder.success) "the package builder accepted an unsupported integration";
assert lib.assertMsg
  shallowRepositoryWatchBuilder.success
  "the package builder rejected the shallow repository-watch integration";
assert lib.assertMsg (!invalidHomeManager.success) "Home Manager accepted an unsupported integration";
assert lib.assertMsg (!invalidNixOS.success) "NixOS accepted an unsupported integration";
assert lib.assertMsg
  (homeRemoteService.Service.EnvironmentFile == "/run/secrets/chatgpt-remote-control.env")
  "Home Manager changed the runtime remote-control environment-file path";
assert lib.assertMsg
  (nixosRemoteService.serviceConfig.EnvironmentFile == "/run/secrets/chatgpt-remote-control.env")
  "NixOS changed the runtime remote-control environment-file path";
assert lib.assertMsg
  (optionalHomeRemoteService.Service.EnvironmentFile == "-/run/secrets/chatgpt-remote-control.env")
  "Home Manager rejected or changed an optional absolute environment-file path";
assert lib.assertMsg
  (optionalNixOSRemoteService.serviceConfig.EnvironmentFile == "-/run/secrets/chatgpt-remote-control.env")
  "NixOS rejected or changed an optional absolute environment-file path";
assert lib.assertMsg
  (!invalidHomeManagerEnvironmentFile.success)
  "Home Manager accepted a Nix path that can copy remote-control secrets into the store";
assert lib.assertMsg
  (!invalidNixOSEnvironmentFile.success)
  "NixOS accepted a Nix path that can copy remote-control secrets into the store";
assert lib.assertMsg
  (lib.all (assertions: !lib.all (item: item.assertion) assertions) homeManagerStoreEnvironmentFileAssertions)
  "Home Manager accepted a store path for the remote-control environment file";
assert lib.assertMsg
  (lib.all (assertions: !lib.all (item: item.assertion) assertions) nixosStoreEnvironmentFileAssertions)
  "NixOS accepted a store path for the remote-control environment file";
assert lib.assertMsg
  (lib.all (assertions: !lib.all (item: item.assertion) assertions) homeManagerRuntimeEnvironmentFileAssertions)
  "Home Manager accepted an empty, relative, or non-canonical remote-control environment-file path";
assert lib.assertMsg
  (lib.all (assertions: !lib.all (item: item.assertion) assertions) nixosRuntimeEnvironmentFileAssertions)
  "NixOS accepted an empty, relative, or non-canonical remote-control environment-file path";
assert lib.assertMsg
  (lib.all (assertions: !lib.all (item: item.assertion) assertions) homeManagerContextEnvironmentFileAssertions)
  "Home Manager accepted a context-bearing remote-control environment-file path";
assert lib.assertMsg
  (lib.all (assertions: !lib.all (item: item.assertion) assertions) nixosContextEnvironmentFileAssertions)
  "NixOS accepted a context-bearing remote-control environment-file path";
pkgs.runCommand "nix-port-integrations-evaluation" { } ''
  touch "$out"
''
