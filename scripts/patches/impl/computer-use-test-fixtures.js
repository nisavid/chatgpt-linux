"use strict";

function currentComputerUseInstallFlowFixture() {
  return (
    "function currentPluginDetail(e){let t=cache(28),{hostId:n,marketplacePath:r,pluginName:i,remoteMarketplaceName:a,enabled:o}=e," +
    "s=o===void 0||o,c=n??`local`,scope=getScope();let u={enabled:!0,hostId:c},d=hostReady(u),f=queryClient(),p;" +
    "t[3]===i?p=t[4]:(p=i!=null&&isComputerUsePlugin(i),t[3]=i,t[4]=p);let m=p,h;" +
    "h={enabled:m,hostId:c};let g=useComputerUseAvailability(h),_=(r!=null||a!=null)&&i!=null," +
    "v=d&&s&&_&&m&&g.isLoading,y=d&&s&&_&&(!m||g.available),b=" +
    "pluginDetailQuery({scope:scope,accountId:null,hostId:c,marketplacePath:r,pluginName:i,queryClient:f,remoteMarketplaceName:a});" +
    "return useQuery({...b,enabled:y})}" +
    "function pluginDetailQuery({scope:e,accountId:t,hostId:n,marketplacePath:r,pluginName:i,queryClient:a,remoteMarketplaceName:o}){" +
    "return{queryFn:async()=>{if(i==null)throw Error(`plugin detail query requires pluginName`);" +
    "return client(e,n).sendRequest(`plugin/read`,{marketplacePath:r,pluginName:i,remoteMarketplaceName:o})}}}" +
    "var computerUsePluginName;computerUsePluginName=`computer-use`;" +
    "function isComputerUsePlugin(e){return pluginBaseName(e)===computerUsePluginName}"
  );
}

module.exports = {
  currentComputerUseInstallFlowFixture,
};
