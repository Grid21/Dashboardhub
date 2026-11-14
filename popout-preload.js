'use strict';
// The pop-out windows' only way to talk to the program. One file serves both windows,
// and each window only gets its own API (chosen by which page it is showing).
const { contextBridge, ipcRenderer } = require('electron');
const page = String(location.pathname || '').split('/').pop();
const on = (channel, fn) => { ipcRenderer.on(channel, (e, a) => { try { fn(a); } catch (err) { /* keep listening */ } }); };

if (page === 'remote.html') {
  contextBridge.exposeInMainWorld('remoteApi', {
    list: () => ipcRenderer.invoke('remote:list'),
    save: (list) => ipcRenderer.invoke('remote:save', Array.isArray(list) ? list.slice(0, 100) : []),
    nx: (id) => ipcRenderer.invoke('remote:nx', String(id || '')),
    external: (id) => ipcRenderer.invoke('remote:external', String(id || '')),
    fullscreen: (on) => ipcRenderer.invoke('remote:fullscreen', on === true),
    nxStatus: () => ipcRenderer.invoke('remote:nxstatus'),
    nxDownload: () => ipcRenderer.invoke('remote:nxdownload')
  });
} else if (page === 'notifications.html') {
  contextBridge.exposeInMainWorld('notifApi', {
    data: (profileId) => ipcRenderer.invoke('notif:data', String(profileId || '')),
    clear: (profileId) => ipcRenderer.invoke('notif:clear', String(profileId || '')),
    export: (profileId, ids) => ipcRenderer.invoke('notif:export', String(profileId || ''), Array.isArray(ids) ? ids.slice(0, 20000).map(String) : []),
    onChanged: (fn) => on('notif:changed', fn),
    onProfile: (fn) => on('notif:profile', fn)
  });
}
