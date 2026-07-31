{
  cfg,
  flakePackages,
  lib,
}:
let
  portIntegrations = import ./port-integrations.nix { inherit lib; };
  requestedIntegrationIds = cfg.portIntegrations ++ lib.optional cfg.remoteMobileControl.enable "remote-mobile-control";
  normalizedIntegrationIds = portIntegrations.normalize requestedIntegrationIds;
in
{
  inherit normalizedIntegrationIds;

  package =
    if cfg.package != null then
      cfg.package
    else
      flakePackages.chatgpt.override {
        enableComputerUseUi = cfg.computerUseUi.enable;
        portIntegrationIds = normalizedIntegrationIds;
      };
}
