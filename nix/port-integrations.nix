{ lib }:
let
  supportedIntegrationIds = [
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
    "pet-overlay"
    "remote-control-ui"
    "remote-mobile-control"
    "shallow-repository-watches"
    "ssh-command-wrapper"
    "ui-tweaks"
  ];

  sortAndDeduplicate = integrationIds:
    lib.sort builtins.lessThan (lib.unique integrationIds);

  normalize = integrationIds:
    if !builtins.isList integrationIds then
      throw "Nix port integration IDs must be provided as a list"
    else if !(lib.all builtins.isString integrationIds) then
      throw "Nix port integration IDs must all be strings"
    else
      let
        normalized = sortAndDeduplicate integrationIds;
        unsupported = lib.filter (integrationId: !(lib.elem integrationId supportedIntegrationIds)) normalized;
      in
      if unsupported != [ ] then
        throw "Unsupported Nix port integration IDs: ${lib.concatStringsSep ", " unsupported}"
      else
        normalized;
in
{
  inherit normalize supportedIntegrationIds;

  optionType = lib.types.listOf (lib.types.enum supportedIntegrationIds);
}
