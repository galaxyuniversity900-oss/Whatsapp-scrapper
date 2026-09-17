const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wa', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: value => ipcRenderer.invoke('settings:set', value),
  getContacts: () => ipcRenderer.invoke('contacts:get'),
  setContacts: value => ipcRenderer.invoke('contacts:set', value),
  importContacts: () => ipcRenderer.invoke('contacts:import'),
  createSession: (id, headless) => ipcRenderer.invoke('session:create', { id, headless }),
  listSessions: () => ipcRenderer.invoke('session:list'),
  start: payload => ipcRenderer.invoke('campaign:start', payload),
  pause: id => ipcRenderer.invoke('campaign:pause', id),
  resume: id => ipcRenderer.invoke('campaign:resume', id),
  stop: id => ipcRenderer.invoke('campaign:stop', id),
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  on: (channel, callback) => {
    const allowed = ['session:qr','session:status','campaign:progress','campaign:done','campaign:error'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, data) => callback(data));
  }
});
