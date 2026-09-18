const {contextBridge,ipcRenderer}=require('electron');
const ALLOWED=['session:qr','session:status','campaign:progress','campaign:done','campaign:error','delivery:ack','message:received'];
contextBridge.exposeInMainWorld('wa',{
 getSettings:()=>ipcRenderer.invoke('settings:get'),setSettings:v=>ipcRenderer.invoke('settings:set',v),
 getContacts:()=>ipcRenderer.invoke('contacts:get'),setContacts:v=>ipcRenderer.invoke('contacts:set',v),importContacts:()=>ipcRenderer.invoke('contacts:import'),
 createSession:(id,headless,browser)=>ipcRenderer.invoke('session:create',{id,headless,browser}),logoutSession:id=>ipcRenderer.invoke('session:logout',id),deleteSession:id=>ipcRenderer.invoke('session:delete',id),listSessions:()=>ipcRenderer.invoke('session:list'),listAccounts:()=>ipcRenderer.invoke('account:list'),listBrowsers:()=>ipcRenderer.invoke('browser:list'),
 start:p=>ipcRenderer.invoke('campaign:start',p),dryRun:p=>ipcRenderer.invoke('campaign:dry-run',p),pause:id=>ipcRenderer.invoke('campaign:pause',id),resume:id=>ipcRenderer.invoke('campaign:resume',id),stop:id=>ipcRenderer.invoke('campaign:stop',id),
 pickMedia:kind=>ipcRenderer.invoke('media:pick',kind),checkReadiness:id=>ipcRenderer.invoke('account:readiness',id),getDelivery:limit=>ipcRenderer.invoke('delivery:list',limit),getDeliverySummary:()=>ipcRenderer.invoke('delivery:summary'),
 suppressContact:p=>ipcRenderer.invoke('contacts:suppress',p),listAudit:limit=>ipcRenderer.invoke('audit:list',limit),listSchedules:()=>ipcRenderer.invoke('schedule:list'),addSchedule:j=>ipcRenderer.invoke('schedule:add',j),cancelSchedule:id=>ipcRenderer.invoke('schedule:cancel',id),
 on:(channel,callback)=>{if(ALLOWED.includes(channel))ipcRenderer.on(channel,(_,data)=>callback(data))}
});
