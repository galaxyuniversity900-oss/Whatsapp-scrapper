const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('wa',{
 getSettings:()=>ipcRenderer.invoke('settings:get'),setSettings:v=>ipcRenderer.invoke('settings:set',v),
 getContacts:()=>ipcRenderer.invoke('contacts:get'),setContacts:v=>ipcRenderer.invoke('contacts:set',v),importContacts:()=>ipcRenderer.invoke('contacts:import'),
 createSession:(id,headless,browser)=>ipcRenderer.invoke('session:create',{id,headless,browser}),listSessions:()=>ipcRenderer.invoke('session:list'),listBrowsers:()=>ipcRenderer.invoke('browser:list'),
 start:p=>ipcRenderer.invoke('campaign:start',p),pause:id=>ipcRenderer.invoke('campaign:pause',id),resume:id=>ipcRenderer.invoke('campaign:resume',id),stop:id=>ipcRenderer.invoke('campaign:stop',id),pickMedia:()=>ipcRenderer.invoke('media:pick'),suppressContact:p=>ipcRenderer.invoke('contacts:suppress',p),listAudit:limit=>ipcRenderer.invoke('audit:list',limit),listSchedules:()=>ipcRenderer.invoke('schedule:list'),addSchedule:j=>ipcRenderer.invoke('schedule:add',j),cancelSchedule:id=>ipcRenderer.invoke('schedule:cancel',id),
 on:(channel,callback)=>{const allowed=['session:qr','session:status','campaign:progress','campaign:done','campaign:error'];if(allowed.includes(channel))ipcRenderer.on(channel,(_,data)=>callback(data))}
});