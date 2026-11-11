'use strict';
// The Remote view window's only way to talk to the program.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('remoteApi', {
  list: () => ipcRenderer.invoke('remote:list'),
  save: (list) => ipcRenderer.invoke('remote:save', Array.isArray(list) ? list.slice(0, 100) : []),
  nx: (id) => ipcRenderer.invoke('remote:nx', String(id || '')),
  external: (id) => ipcRenderer.invoke('remote:external', String(id || '')),
  fullscreen: (on) => ipcRenderer.invoke('remote:fullscreen', on === true),
  nxStatus: () => ipcRenderer.invoke('remote:nxstatus'),
  nxDownload: () => ipcRenderer.invoke('remote:nxdownload')
});
