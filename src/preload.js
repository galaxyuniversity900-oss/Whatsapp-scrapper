const {contextBridge,ipcRenderer}=require('electron');
const ALLOWED=['session:qr','session:status','campaign:progress','campaign:done','campaign:error','delivery:ack','message:received','message:stream','message:edited','message:revoked','data:sync:done'];
contextBridge.exposeInMainWorld('wa',{
 getSettings:()=>ipcRenderer.invoke('settings:get'),setSettings:v=>ipcRenderer.invoke('settings:set',v),
 getContacts:()=>ipcRenderer.invoke('contacts:get'),setContacts:v=>ipcRenderer.invoke('contacts:set',v),importContacts:()=>ipcRenderer.invoke('contacts:import'),
 createSession:(id,headless,browser,proxyUrl,proxyAuth)=>ipcRenderer.invoke('session:create',{id,headless,browser,proxyUrl,proxyAuth}),logoutSession:id=>ipcRenderer.invoke('session:logout',id),deleteSession:id=>ipcRenderer.invoke('session:delete',id),listSessions:()=>ipcRenderer.invoke('session:list'),listAccounts:()=>ipcRenderer.invoke('account:list'),listBrowsers:()=>ipcRenderer.invoke('browser:list'),
 start:p=>ipcRenderer.invoke('campaign:start',p),dryRun:p=>ipcRenderer.invoke('campaign:dry-run',p),pause:id=>ipcRenderer.invoke('campaign:pause',id),resume:id=>ipcRenderer.invoke('campaign:resume',id),stop:id=>ipcRenderer.invoke('campaign:stop',id),
 pickMedia:kind=>ipcRenderer.invoke('media:pick',kind),checkReadiness:id=>ipcRenderer.invoke('account:readiness',id),getDelivery:limit=>ipcRenderer.invoke('delivery:list',limit),getDeliverySummary:()=>ipcRenderer.invoke('delivery:summary'),
 suppressContact:p=>ipcRenderer.invoke('contacts:suppress',p),
 dataSummary:()=>ipcRenderer.invoke('data:summary'),getMessages:limit=>ipcRenderer.invoke('data:messages',limit),getChats:()=>ipcRenderer.invoke('data:chats'),getProfiles:()=>ipcRenderer.invoke('data:profiles'),getGroups:()=>ipcRenderer.invoke('data:groups'),getDirectoryContacts:()=>ipcRenderer.invoke('data:contacts'),syncContacts:p=>ipcRenderer.invoke('data:sync:contacts',p),syncGroups:p=>ipcRenderer.invoke('data:sync:groups',p),syncChats:p=>ipcRenderer.invoke('data:sync:chats',p),validateNumbers:p=>ipcRenderer.invoke('data:validate:numbers',p),getChannelSubscribers:p=>ipcRenderer.invoke('data:channel:subscribers',p),searchMessages:p=>ipcRenderer.invoke('data:search',p),exportData:p=>ipcRenderer.invoke('data:export',p),
 listAudit:limit=>ipcRenderer.invoke('audit:list',limit),listSchedules:()=>ipcRenderer.invoke('schedule:list'),addSchedule:j=>ipcRenderer.invoke('schedule:add',j),cancelSchedule:id=>ipcRenderer.invoke('schedule:cancel',id),
 on:(channel,callback)=>{if(ALLOWED.includes(channel))ipcRenderer.on(channel,(_,data)=>callback(data))}
});
