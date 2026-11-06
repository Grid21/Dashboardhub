const { contextBridge, ipcRenderer } = require('electron');

// The only things the dashboard page is allowed to ask the app to do.
contextBridge.exposeInMainWorld('notesApi', {
  available: () => ipcRenderer.invoke('notes:available'),
  list: () => ipcRenderer.invoke('notes:list'),
  get: (id) => ipcRenderer.invoke('notes:get', id),
  set: (id, text) => ipcRenderer.invoke('notes:set', id, text),
  remove: (id) => ipcRenderer.invoke('notes:remove', id)
});

contextBridge.exposeInMainWorld('backupApi', {
  export: (data) => ipcRenderer.invoke('backup:export', data),
  import: () => ipcRenderer.invoke('backup:import')
});

contextBridge.exposeInMainWorld('settingsApi', {
  panelHosts: (urls) => ipcRenderer.invoke('panels:hosts', urls),
  get: () => ipcRenderer.invoke('app:settings:get'),
  set: (s) => ipcRenderer.invoke('app:settings:set', s),
  notify: (text) => ipcRenderer.invoke('app:notify', text),
  setGpu: (on) => ipcRenderer.invoke('app:gpu:set', on),
  restart: () => ipcRenderer.invoke('app:restart')
});

contextBridge.exposeInMainWorld('bmcApi', {
  list: () => ipcRenderer.invoke('bmc:list'),
  save: (cfg) => ipcRenderer.invoke('bmc:save', cfg),
  remove: (id) => ipcRenderer.invoke('bmc:remove', id),
  status: (id) => ipcRenderer.invoke('bmc:status', id),
  power: (id, action) => ipcRenderer.invoke('bmc:power', id, action),
  importList: (items, replace) => ipcRenderer.invoke('bmc:import', items, replace)
});

contextBridge.exposeInMainWorld('netApi', {
  interfaces: () => ipcRenderer.invoke('net:interfaces'),
  scan: (options) => ipcRenderer.invoke('net:scan', options),
  cancel: () => ipcRenderer.invoke('net:cancel'),
  wake: (macs) => ipcRenderer.invoke('net:wake', macs),
  bandwidth: () => ipcRenderer.invoke('bw:sample'),
  shares: (ip) => ipcRenderer.invoke('net:shares', ip),
  dns: (ips) => ipcRenderer.invoke('net:dns', Array.isArray(ips) ? ips.slice(0, 512).map(String) : []),
  onEvent: (callback) => {
    ipcRenderer.removeAllListeners('net:event');
    ipcRenderer.on('net:event', (event, message) => callback(message));
  }
});

contextBridge.exposeInMainWorld('connApi', {
  types: () => ipcRenderer.invoke('conn:types'),
  list: () => ipcRenderer.invoke('conn:list'),
  save: (config) => ipcRenderer.invoke('conn:save', config),
  remove: (id) => ipcRenderer.invoke('conn:remove', id),
  test: (config) => ipcRenderer.invoke('conn:test', config),
  poll: () => ipcRenderer.invoke('conn:poll'),
  findSnmp: (req) => ipcRenderer.invoke('snmp:find', req),
  setProfile: (id) => ipcRenderer.invoke('conn:profile', id),
  copyProfile: (from, to) => ipcRenderer.invoke('conn:profile:copy', from, to),
  dropProfile: (id) => ipcRenderer.invoke('conn:profile:drop', id)
});

// Ctrl+F while the keyboard is inside a panel's web page: the app tells the dashboard which panel it was
contextBridge.exposeInMainWorld('findApi', {
  onOpen: (callback) => { ipcRenderer.removeAllListeners('find:open'); ipcRenderer.on('find:open', (event, message) => callback(message && message.guestId)); },
  onEscape: (callback) => { ipcRenderer.removeAllListeners('find:esc'); ipcRenderer.on('find:esc', (event, message) => callback(message && message.guestId)); }
});

contextBridge.exposeInMainWorld('sshApi', {
  connect: (server) => ipcRenderer.invoke('ssh:connect', server)
});

contextBridge.exposeInMainWorld('toolsApi', {
  unpack: () => ipcRenderer.invoke('tools:unpack'),
  packPick: () => ipcRenderer.invoke('tools:packPick'),
  pack: (opts) => ipcRenderer.invoke('tools:pack', { version: String(opts && opts.version || ''), notes: String(opts && opts.notes || '') }),
  reveal: () => ipcRenderer.invoke('tools:reveal')
});

contextBridge.exposeInMainWorld('updaterApi', {
  status: () => ipcRenderer.invoke('updater:status'),
  setEnabled: (on) => ipcRenderer.invoke('updater:setEnabled', on === true),
  check: (manual) => ipcRenderer.invoke('updater:check', manual === true),
  skip: (version) => ipcRenderer.invoke('updater:skip', String(version || '')),
  snooze: () => ipcRenderer.invoke('updater:snooze'),
  download: () => ipcRenderer.invoke('updater:download'),
  openFolder: () => ipcRenderer.invoke('updater:openFolder'),
  versions: () => ipcRenderer.invoke('updater:versions'),
  switchTo: (v) => ipcRenderer.invoke('updater:switchTo', String(v || '')),
  armInstall: (name) => ipcRenderer.invoke('updater:armInstall', String(name || '')),
  tidy: () => ipcRenderer.invoke('updater:tidy')
});

contextBridge.exposeInMainWorld('updateApi', {
  info: () => ipcRenderer.invoke('update:info'),
  install: () => ipcRenderer.invoke('update:install'),
  installFile: (name) => ipcRenderer.invoke('update:installFile', name),
  revert: (target) => ipcRenderer.invoke('update:revert', target),
  dismiss: () => ipcRenderer.invoke('update:dismiss'),
  ready: () => ipcRenderer.invoke('update:ready'),
  quit: () => ipcRenderer.invoke('update:quit'),
  restart: () => ipcRenderer.invoke('update:restart'),
  reload: () => ipcRenderer.invoke('app:reload')
});

contextBridge.exposeInMainWorld('securityApi', {
  get: () => ipcRenderer.invoke('security:get'),
  set: (o) => ipcRenderer.invoke('security:set', o),
  preset: (name) => ipcRenderer.invoke('security:preset', name === 'strict' ? 'strict' : 'default')
});
