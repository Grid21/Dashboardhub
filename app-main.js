const { app, BrowserWindow, Menu, ipcMain, safeStorage, dialog, Tray, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// The portable .exe starts inside a temporary folder that it deletes when you
// quit. Any window opened from here (like the SSH window) would start inside
// that folder and keep it locked, so it would be left behind. Move out of it.
try { process.chdir(os.homedir()); } catch (e) { /* not important */ }
const { cleanServer, parseBackup } = require('./validate');

// Home-lab services (TrueNAS, etc.) often use self-signed HTTPS certificates. They are accepted ONLY for addresses on your own
// network (192.168.x.x, 10.x.x.x, .local names and so on) and for the exact websites you added as a panel. Any other website
// still gets a normal, strict certificate check, so a fake copy of a public site cannot slip in.

// Graphics card (GPU) use. On by default; the Settings menu can switch it off (needs a restart). This has to be decided
// before the app is ready, so the saved choice is read straight from settings.json here.
let gpuWanted = true;
try {
  const early = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  if (early && early.gpu === false) gpuWanted = false;
} catch (e) { /* no settings yet: the graphics card stays on */ }
if (!gpuWanted) { try { app.disableHardwareAcceleration(); } catch (e) { /* too late; ignored */ } }

const panelHosts = new Set();          // hosts of the panels you added (sent by the window)
function hostOf(u) { try { return new URL(u).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch (e) { return ''; } }
function isLanHost(h) {
  if (!h) return false;
  if (connectors.isPrivateIp(h)) return true;
  if (/^(::1|f[cd][0-9a-f]{2}:.*|fe80:.*)$/i.test(h)) return true;                       // IPv6 local, unique-local, link-local
  if (!h.includes('.') && !h.includes(':')) return true;                                   // a bare name like "nas"
  return /\.(local|lan|home|internal|localdomain|home\.arpa)$/.test(h);
}
function trustedHost(u) { const h = hostOf(u); return isLanHost(h) || panelHosts.has(h); }
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(security.get().certs === 'strict' ? false : trustedHost(url));
});
ipcMain.handle('panels:hosts', (event, urls) => {
  checkSender(event);
  if (!Array.isArray(urls)) return { ok: false };
  panelHosts.clear();
  urls.slice(0, 500).forEach((u) => { if (typeof u === 'string' && /^https?:\/\//i.test(u)) { const h = hostOf(u); if (h) panelHosts.add(h); } });
  return { ok: true };
});

let mainWindow = null;

// ---------- encrypted notes ----------
// Notes are encrypted with your Windows login (Electron safeStorage) and saved
// in notes.dat inside the app's data folder. The file is useless if copied to
// another PC or another Windows account.
function notesFile() {
  return path.join(app.getPath('userData'), 'notes.dat');
}

function readNotes() {
  try {
    const obj = JSON.parse(fs.readFileSync(notesFile(), 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function writeNotes(obj) {
  const file = notesFile();
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

// Is it safe to store notes? On Linux this needs a keyring (GNOME Keyring,
// KWallet, ...). Without one, Electron would fall back to a built-in password,
// which is not real protection, so in that case notes are switched off.
function notesEncryptionOk() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      const backend = safeStorage.getSelectedStorageBackend();
      if (backend === 'basic_text' || backend === 'unknown') return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function checkSender(event) {
  // Only our own main window may use the notes, never the web panels.
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Not allowed');
  }
}

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length < 100;
}

ipcMain.handle('notes:available', (event) => {
  checkSender(event);
  return notesEncryptionOk();
});

ipcMain.handle('notes:list', (event) => {
  checkSender(event);
  return Object.keys(readNotes());
});

ipcMain.handle('notes:get', (event, id) => {
  checkSender(event);
  if (!validId(id)) return { ok: false, error: 'Bad request' };
  try {
    const stored = readNotes()[id];
    if (!stored) return { ok: true, text: '' };
    const text = safeStorage.decryptString(Buffer.from(stored, 'base64'));
    return { ok: true, text: text };
  } catch (e) {
    return { ok: false, error: 'Could not decrypt the saved note' };
  }
});

ipcMain.handle('notes:set', (event, id, text) => {
  checkSender(event);
  if (!validId(id) || typeof text !== 'string') return { ok: false, error: 'Bad request' };
  try {
    const all = readNotes();
    if (text.trim() === '') {
      delete all[id];
    } else {
      if (!notesEncryptionOk()) {
        return { ok: false, error: 'Encryption is not available on this computer, so the note was not saved.' };
      }
      all[id] = safeStorage.encryptString(text).toString('base64');
    }
    writeNotes(all);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Could not save the note: ' + e.message };
  }
});

ipcMain.handle('notes:remove', (event, id) => {
  checkSender(event);
  if (!validId(id)) return { ok: false, error: 'Bad request' };
  try {
    const all = readNotes();
    delete all[id];
    writeNotes(all);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Look for a program in the usual places (the PATH can be short when an app is
// started from a desktop launcher).
function findInPath(name) {
  const extra = ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin'];
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(extra);
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      if (fs.statSync(full).isFile()) return full;
    } catch (e) { /* keep looking */ }
  }
  return null;
}

function openSshWindows(s) {
  const found = spawnSync('where.exe', ['ssh'], { windowsHide: true });
  if (found.error || found.status !== 0) {
    return {
      ok: false,
      error: 'The Windows OpenSSH Client is not installed. Open Settings > Apps > Optional features > ' +
             'Add a feature, install "OpenSSH Client", then try again.'
    };
  }
  try {
    // "SSH - name" always contains spaces, so it is passed as the window title
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', 'SSH - ' + s.name, 'cmd.exe', '/k', 'ssh', '-p', String(s.port), s.user + '@' + s.host],
      { detached: true, stdio: 'ignore', cwd: os.homedir() }
    );
    child.on('error', () => { /* nothing more to do */ });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Could not open the command window: ' + e.message };
  }
}

// Terminal programs we know how to start, in the order we try them.
// Each one is told to run: sh -c "<script>" sh -p PORT user@host
const LINUX_TERMINALS = [
  { bin: 'gnome-terminal',      args: (t, c) => ['--title', t, '--'].concat(c) },
  { bin: 'konsole',             args: (t, c) => ['-e'].concat(c) },
  { bin: 'xfce4-terminal',      args: (t, c) => ['--title', t, '-x'].concat(c) },
  { bin: 'mate-terminal',       args: (t, c) => ['--title', t, '-x'].concat(c) },
  { bin: 'kitty',               args: (t, c) => ['--title', t].concat(c) },
  { bin: 'alacritty',           args: (t, c) => ['--title', t, '-e'].concat(c) },
  { bin: 'xterm',               args: (t, c) => ['-T', t, '-e'].concat(c) },
  { bin: 'x-terminal-emulator', args: (t, c) => ['-e'].concat(c) }
];

// The host, user and port are passed as separate arguments (never glued into a
// command string). The window stays open only if ssh ends with an error, so you can read it.
const LINUX_SSH_SCRIPT =
  'ssh "$@"; status=$?; ' +
  'if [ "$status" -ne 0 ]; then echo; echo "ssh ended with code $status. Press Enter to close."; read _; fi';

function openSshLinux(s) {
  if (!findInPath('ssh')) {
    return {
      ok: false,
      error: 'The ssh program is not installed. Install it with your package manager, ' +
             'for example: sudo apt install openssh-client'
    };
  }

  const command = ['sh', '-c', LINUX_SSH_SCRIPT, 'sh', '-p', String(s.port), s.user + '@' + s.host];
  for (const term of LINUX_TERMINALS) {
    const full = findInPath(term.bin);
    if (!full) continue;
    try {
      const child = spawn(full, term.args('SSH - ' + s.name, command), { detached: true, stdio: 'ignore', cwd: os.homedir() });
      child.on('error', () => { /* nothing more to do */ });
      child.unref();
      return { ok: true };
    } catch (e) {
      // try the next terminal program
    }
  }
  return {
    ok: false,
    error: 'No terminal program was found. Install one (for example gnome-terminal, konsole or xterm) and try again.'
  };
}

// ---------- SSH to Linux servers ----------
// Opens a normal terminal window (Command Prompt on Windows, your desktop's
// terminal on Linux) running "ssh". You type your password (or use an SSH key)
// in that window; nothing is typed for you.
ipcMain.handle('ssh:connect', (event, server) => {
  checkSender(event);

  const checked = cleanServer(server);
  if (!checked.ok) return checked;
  const s = checked.value;

  if (process.platform === 'win32') return openSshWindows(s);
  if (process.platform === 'linux') return openSshLinux(s);
  return { ok: false, error: 'Opening a terminal is only supported on Windows and Linux.' };
});

// ---------- backup: export and import ----------
const BACKUP_FILTERS = [{ name: 'Dashboard Hub backup', extensions: ['json'] }];
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

// ---------- remember the last folder you used (like a browser remembers its download folder) ----------
function foldersFile() { return path.join(app.getPath('userData'), 'folders.json'); }
function lastFolder(kind, fallbackName) {
  try {
    const j = JSON.parse(fs.readFileSync(foldersFile(), 'utf8'));
    const d = j && typeof j[kind] === 'string' ? j[kind] : '';
    if (d && fs.statSync(d).isDirectory()) return d;                  // gone or moved? fall through to the default
  } catch (e) { /* nothing saved yet */ }
  try { return app.getPath(fallbackName || 'downloads'); } catch (e) { return os.homedir(); }
}
function rememberFolder(kind, file) {
  try {
    const dir = path.dirname(String(file));
    if (!dir || !fs.statSync(dir).isDirectory()) return;
    let j = {};
    try { j = JSON.parse(fs.readFileSync(foldersFile(), 'utf8')) || {}; } catch (e) { j = {}; }
    j[kind] = dir;
    const tmp = foldersFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(j)); fs.renameSync(tmp, foldersFile());
  } catch (e) { /* not important: the dialog just opens in the default folder next time */ }
}
// The "choose an update file" box belongs to the fixed starter program, which cannot be updated, so it is
// taught here instead: it opens in the folder you last picked an update from (your Downloads folder the first time).
let armedUpdateFile = '', armedUntil = 0;       // a downloaded update waiting to be handed to the starter's installer
(function () {
  const original = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = async function (a, b) {
    const hasWin = b !== undefined;
    const opts = hasWin ? b : a;
    if (!opts || opts.title !== 'Choose a Dashboard Hub update file') return original.apply(null, hasWin ? [a, b] : [a]);
    // an update the app just downloaded itself: an older starter program can only install from the file box, so the file is handed over here
    if (armedUpdateFile && Date.now() < armedUntil) {
      const f = armedUpdateFile; armedUpdateFile = '';
      if (fs.existsSync(f)) return { canceled: false, filePaths: [f] };
    }
    armedUpdateFile = '';
    const withFolder = Object.assign({}, opts, { defaultPath: lastFolder('update', 'downloads') });
    const res = hasWin ? await original(a, withFolder) : await original(withFolder);
    if (res && !res.canceled && res.filePaths && res.filePaths[0]) rememberFolder('update', res.filePaths[0]);
    return res;
  };
})();

// ---------- Network boot (PXE): boot another computer from this one. Off until Start is pressed; stops when the app quits ----------
const pxeLib = require('./pxe');
const pxeMod = pxeLib.create({ dataDir: app.getPath('userData') });
ipcMain.handle('pxe:status', (event) => { checkSender(event); try { return Object.assign({ ok: true }, pxeMod.status()); } catch (e) { return { ok: false, error: 'Could not read the network boot state.' }; } });
ipcMain.handle('pxe:start', async (event, o) => { checkSender(event); try { return await pxeMod.start({ ip: String(o && o.ip || '') }); } catch (e) { return { ok: false, error: 'Network boot could not start (' + (e && e.message || 'unknown') + ').' }; } });
ipcMain.handle('pxe:stop', async (event) => { checkSender(event); try { return await pxeMod.stop(); } catch (e) { return { ok: false }; } });
ipcMain.handle('pxe:allow', (event, o) => {
  checkSender(event);
  const macs = Array.isArray(o && o.macs) ? o.macs.slice(0, 50).map((m) => String(m).slice(0, 40)) : [];
  return pxeMod.setAllow({ macs, any: !!(o && o.any === true) });
});
ipcMain.handle('pxe:addIso', async (event) => {
  checkSender(event);
  try {
    const pick = await dialog.showOpenDialog(mainWindow, { title: 'Choose an ISO file to offer over the network', defaultPath: lastFolder('pxeIso', 'downloads'), properties: ['openFile'], filters: [{ name: 'ISO disc image', extensions: ['iso'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false, canceled: true };
    rememberFolder('pxeIso', pick.filePaths[0]);
    return pxeMod.addIso(pick.filePaths[0]);
  } catch (e) { return { ok: false, error: 'That file could not be added.' }; }
});
ipcMain.handle('pxe:answers', (event, o) => { checkSender(event); o = o || {}; return pxeMod.setAnswers({ username: String(o.username || '').slice(0, 40), password: String(o.password || '').slice(0, 130), hostname: String(o.hostname || '').slice(0, 40), timezone: String(o.timezone || '').slice(0, 42), keyboard: String(o.keyboard || '').slice(0, 12) }); });
ipcMain.handle('pxe:uefi', (event, v) => { checkSender(event); return pxeMod.setUefiLoader(String(v || '')); });
ipcMain.handle('pxe:choice', (event, mac, what) => { checkSender(event); return pxeMod.setChoice(String(mac || '').slice(0, 40), String(what || '').slice(0, 40)); });
ipcMain.handle('pxe:check', async (event, ip) => { checkSender(event); try { return await pxeMod.check(String(ip || '').slice(0, 40)); } catch (e) { return { ok: false, error: 'The check could not run.' }; } });
ipcMain.handle('pxe:removeIso', (event, id) => { checkSender(event); return pxeMod.removeIso(String(id || '')); });
ipcMain.handle('pxe:renameIso', (event, id, name) => { checkSender(event); return pxeMod.renameIso(String(id || ''), String(name || '').slice(0, 80)); });
app.on('before-quit', () => { try { pxeMod.stop(true); } catch (e) { /* closing anyway */ } });

// ---------- "Update file tools": unpack (decompile) and pack (compile) .hubupdate files ----------
const hubTools = require('./hubupdate-tools');
let lastToolsOutput = '';     // the last folder or file the tools made, for the "Show it" button
let pendingPackDir = '';      // the folder chosen to be packed (kept here, never taken from the window)
ipcMain.handle('tools:unpack', async (event) => {
  checkSender(event);
  try {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the update file to unpack',
      defaultPath: lastFolder('toolsFile', 'downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Dashboard Hub update', extensions: ['hubupdate', 'txt', 'json'] }]
    });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false, canceled: true };
    rememberFolder('toolsFile', pick.filePaths[0]);
    let meta;
    try { meta = hubTools.info(pick.filePaths[0]); } catch (e) { return { ok: false, error: e.message }; }
    const dest = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where to put the unpacked folder',
      defaultPath: lastFolder('toolsOut', 'documents'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (dest.canceled || !dest.filePaths || !dest.filePaths[0]) return { ok: false, canceled: true };
    rememberFolder('toolsOut', path.join(dest.filePaths[0], 'x'));
    const r = hubTools.unpack(pick.filePaths[0], dest.filePaths[0]);
    lastToolsOutput = r.folder;
    return { ok: true, folder: r.folder, version: r.version, notes: r.notes, count: r.written.length, skipped: r.skipped };
  } catch (e) { return { ok: false, error: 'Could not unpack that file: ' + e.message }; }
});
ipcMain.handle('tools:packPick', async (event) => {
  checkSender(event);
  try {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the folder to pack into an update file',
      defaultPath: lastFolder('toolsOut', 'documents'),
      properties: ['openDirectory']
    });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false, canceled: true };
    rememberFolder('toolsOut', path.join(pick.filePaths[0], 'x'));
    const d = hubTools.packDefaults(pick.filePaths[0]);
    if (!d.files.length) return { ok: false, error: 'That folder has no Dashboard Hub files in it.' };
    pendingPackDir = pick.filePaths[0];
    return { ok: true, folder: path.basename(pick.filePaths[0]), version: d.version, notes: d.notes, fileCount: d.files.length };
  } catch (e) { return { ok: false, error: 'Could not read that folder: ' + e.message }; }
});
ipcMain.handle('tools:pack', async (event, opts) => {
  checkSender(event);
  try {
    if (!pendingPackDir) return { ok: false, error: 'Choose a folder first.' };
    const version = String(opts && opts.version || '').trim(), notes = String(opts && opts.notes || '');
    const built = hubTools.pack(pendingPackDir, version, notes);
    const save = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the update file',
      defaultPath: path.join(lastFolder('toolsPack', 'documents'), built.fileName),
      filters: [{ name: 'Dashboard Hub update', extensions: ['hubupdate'] }]
    });
    if (save.canceled || !save.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(save.filePath, built.text);
    rememberFolder('toolsPack', save.filePath);
    lastToolsOutput = save.filePath;
    return { ok: true, file: save.filePath, fileCount: built.fileCount, version };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('tools:reveal', (event) => {
  checkSender(event);
  try { if (lastToolsOutput && fs.existsSync(lastToolsOutput)) { shell.showItemInFolder(lastToolsOutput); return { ok: true }; } } catch (e) { /* ignore */ }
  return { ok: false };
});

function defaultBackupPath() {
  const day = new Date().toISOString().slice(0, 10);
  const dir = lastFolder('backup', 'documents');
  return path.join(dir, 'dashboard-hub-backup-' + day + '.json');
}

ipcMain.handle('backup:export', async (event, data) => {
  checkSender(event);
  try {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Bad request' };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Dashboard Hub backup',
      defaultPath: defaultBackupPath(),
      filters: BACKUP_FILTERS
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    // mode 600: only you can read it (matters if it includes notes)
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    rememberFolder('backup', res.filePath);
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: 'Could not save the file: ' + e.message };
  }
});

ipcMain.handle('backup:import', async (event) => {
  checkSender(event);
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Dashboard Hub backup',
      defaultPath: lastFolder('backup', 'documents'),
      properties: ['openFile'],
      filters: BACKUP_FILTERS
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const file = res.filePaths[0];
    rememberFolder('backup', file);
    if (fs.statSync(file).size > MAX_BACKUP_BYTES) {
      return { ok: false, error: 'That file is too big to be a Dashboard Hub backup.' };
    }
    return parseBackup(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, error: 'Could not read the file: ' + e.message };
  }
});

// ---------- router / switch connections (logins are kept encrypted, never shown again) ----------
const connectors = require('./connectors');
const security = require('./security');
security.init(app.getPath('userData'));
connectors.setPolicy(security.get());
let connMemory = null;          // used when the computer cannot encrypt: kept only until the app closes
const connFile = () => path.join(app.getPath('userData'), 'connections.dat');

function readConnections() {
  if (connMemory) return connMemory;
  try {
    const raw = JSON.parse(fs.readFileSync(connFile(), 'utf8'));
    if (raw && typeof raw.enc === 'string' && notesEncryptionOk()) {
      const list = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
      if (Array.isArray(list)) return list.slice(0, 200);
    }
  } catch (e) { /* none saved yet, or unreadable */ }
  return [];
}
function writeConnections(list) {
  if (!notesEncryptionOk()) { connMemory = list; return false; }       // no real encryption here: do not write passwords to disk
  connMemory = null;
  const file = connFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ enc: safeStorage.encryptString(JSON.stringify(list)).toString('base64') }));
  fs.renameSync(tmp, file);
  return true;
}
function publicConn(c) {
  return { id: c.id, type: c.type, name: c.name, host: c.host, port: c.port, https: c.https, username: c.username, site: c.site, snmpVersion: c.snmpVersion, authProto: c.authProto, privProto: c.privProto, hasSecret: !!c.password, hasSecret2: !!c.secret2, lastOk: c.lastOk || null, lastError: c.lastError || '' };
}
// Every router / switch link and every server-management (BMC) login belongs to ONE network profile.
// The window tells us which profile is showing; only that profile's logins are listed, asked, saved or removed.
let activeProfile = '';
const inProf = (x) => !!x && !!activeProfile && x.profileId === activeProfile;
const validProfileId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
function newConnId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

ipcMain.handle('conn:types', (event) => {
  checkSender(event);
  const out = {};
  Object.keys(connectors.TYPES).forEach((k) => { const t = connectors.TYPES[k]; out[k] = { label: t.label, defaults: t.defaults, secretLabel: t.secretLabel, userLabel: t.userLabel, cloud: !!t.cloud }; });
  return { ok: true, types: out, canEncrypt: notesEncryptionOk() };
});
ipcMain.handle('conn:list', (event) => {
  checkSender(event);
  return { ok: true, list: readConnections().filter(inProf).map(publicConn), canEncrypt: notesEncryptionOk() };
});
// the window says which profile is showing. Logins saved before profiles owned them go to the first profile that is shown.
ipcMain.handle('conn:profile', (event, id) => {
  checkSender(event);
  if (!validProfileId(id)) return { ok: false, error: 'Bad request' };
  activeProfile = id;
  try {
    const c = readConnections();
    if (c.some((x) => !x.profileId)) { c.forEach((x) => { if (!x.profileId) x.profileId = id; }); writeConnections(c); }
    const b = readBmc();
    if (b.some((x) => !x.profileId)) { b.forEach((x) => { if (!x.profileId) x.profileId = id; }); writeBmc(b); }
  } catch (e) { /* the logins simply stay as they were */ }
  return { ok: true };
});
// a duplicated profile starts with its own copy of the links; a removed profile takes its links with it
ipcMain.handle('conn:profile:copy', (event, from, to) => {
  checkSender(event);
  if (!validProfileId(from) || !validProfileId(to) || from === to) return { ok: false, error: 'Bad request' };
  const c = readConnections();
  const bm = readBmc();
  const cc = c.filter((x) => x.profileId === from).map((x) => Object.assign({}, x, { id: newConnId(), profileId: to, lastOk: null, lastError: '' }));
  const bb = bm.filter((x) => x.profileId === from).map((x) => Object.assign({}, x, { id: newBmcId(), profileId: to }));
  if (cc.length) writeConnections(c.concat(cc));
  if (bb.length) writeBmc(bm.concat(bb));
  return { ok: true, links: cc.length, servers: bb.length };
});
ipcMain.handle('conn:profile:drop', (event, id) => {
  checkSender(event);
  if (!validProfileId(id) || id === activeProfile) return { ok: false, error: 'Bad request' };
  const c = readConnections(), bm = readBmc();
  if (c.some((x) => x.profileId === id)) writeConnections(c.filter((x) => x.profileId !== id));
  if (bm.some((x) => x.profileId === id)) writeBmc(bm.filter((x) => x.profileId !== id));
  return { ok: true };
});
ipcMain.handle('conn:save', (event, config) => {
  checkSender(event);
  sshPollMemory.clear();
  let clean;
  try { clean = connectors.cleanConfig(config); } catch (e) { return { ok: false, error: e.message }; }
  if (!activeProfile) return { ok: false, error: 'The network profile is still loading. Try again in a moment.' };
  const list = readConnections();
  const old = clean.id ? list.find((c) => c.id === clean.id && inProf(c)) : null;
  if (!old && list.filter(inProf).length >= 20) return { ok: false, error: 'That is the most connections you can keep for one network (20).' };
  if (old && !clean.password) clean.password = old.password;          // an empty password box means "keep the saved one"
  if (old && !clean.secret2) clean.secret2 = old.secret2 || '';
  const bad = connectors.checkLogin(clean);
  if (bad) return { ok: false, error: bad };
  clean.id = old ? old.id : newConnId();
  clean.profileId = activeProfile;
  const next = old ? list.map((c) => (c.id === old.id ? Object.assign({}, clean, { lastOk: old.lastOk, lastError: old.lastError }) : c)) : list.concat([clean]);
  const stored = writeConnections(next);
  return { ok: true, id: clean.id, stored: stored, list: next.filter(inProf).map(publicConn) };
});
ipcMain.handle('conn:remove', (event, id) => {
  checkSender(event);
  const next = readConnections().filter((c) => !(c.id === id && inProf(c)));
  writeConnections(next);
  return { ok: true, list: next.filter(inProf).map(publicConn) };
});
ipcMain.handle('conn:test', async (event, config) => {
  checkSender(event);
  if (!security.get().connectors) return { ok: false, error: 'Router and switch connections are turned off in Settings > Security.' };
  const c = config && typeof config === 'object' ? Object.assign({}, config) : {};
  if (typeof c.id === 'string' && (!c.password || !c.secret2)) { const old = readConnections().find((x) => x.id === c.id && inProf(x)); if (old) { if (!c.password) c.password = old.password; if (!c.secret2) c.secret2 = old.secret2 || ''; } }
  const res = await connectors.poll(c);
  if (!res.ok) return res;
  return { ok: true, count: res.clients.length, gear: res.gear.length, self: res.self, note: res.note };
});
let connPolling = false;
// SSH logins are heavier than a web request and can trip a device's lockout rules, so they are asked less often:
// a good answer is reused for a minute, and a refused login is not tried again for five minutes (editing the connection clears this).
const SSH_REUSE_MS = 60 * 1000, SSH_AUTH_BACKOFF_MS = 5 * 60 * 1000;
const sshPollMemory = new Map();
function pollOrReuse(c, force) {
  if (c.type !== 'ssh') return connectors.poll(c);
  const mem = sshPollMemory.get(c.id), now = Date.now();
  if (mem && !force) {
    if (mem.res.ok && now - mem.at < SSH_REUSE_MS) return Promise.resolve(mem.res);
    if (!mem.res.ok && mem.res.code === 'auth' && now - mem.at < SSH_AUTH_BACKOFF_MS) return Promise.resolve(Object.assign({}, mem.res, { error: mem.res.error + ' (Not tried again automatically for a few minutes, so the device does not lock the account. "Ask them now" tries at once.)' }));
  }
  return connectors.poll(c).then((res) => { sshPollMemory.set(c.id, { at: Date.now(), res: res }); return res; });
}
ipcMain.handle('conn:poll', async (event, opts) => {
  checkSender(event);
  const force = !!(opts && opts.force === true);
  if (!security.get().connectors) return { ok: true, results: [], disabled: true };
  if (connPolling) return { ok: true, results: [], busy: true };
  connPolling = true;
  try {
    const all = readConnections();
    const list = all.filter(inProf);
    // every device is asked at the same time, so one switch that is unplugged does not hold up the others
    const results = await Promise.all(list.map(async (c) => {
      let res;
      try {
        // a quick "is it even there" check (ping and a few ports), so an unplugged switch is noticed in seconds, not after a long timeout
        const guard = c.host && c.type !== 'meraki' ? (async () => {
          const probe = async () => {
            const sc = require('./scanner');
            const hits = await Promise.all([sc.pingHost(c.host).then((t) => t !== null).catch(() => false)].concat([80, 443, 22, 23, 8443].map((p) => sc.tcpProbe(c.host, p, 1500).then((r) => r === 'open' || r === 'closed').catch(() => false))));
            return hits.some(Boolean);
          };
          const t0 = Date.now();
          if (await probe()) return new Promise(() => {});            // it is there: let the real answer decide
          if (await probe()) return new Promise(() => {});
          await new Promise((r) => setTimeout(r, Math.max(0, 6000 - (Date.now() - t0))));   // give a slow answer a fair chance
          return { ok: false, code: 'timeout', unreachable: true, error: 'It does not answer at all (switched off or unplugged?).' };
        })() : new Promise(() => {});
        res = await Promise.race([
          pollOrReuse(c, force),
          guard,
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, code: 'timeout', error: 'No answer in time. It may be switched off or unplugged.' }), 25000))
        ]);
      } catch (e) { res = { ok: false, code: 'bad', error: 'Could not ask this device.' }; }
      c.lastOk = res.ok ? Date.now() : (c.lastOk || null);
      c.lastError = res.ok ? '' : res.error;
      return Object.assign({ id: c.id, name: c.name || connectors.TYPES[c.type].label, host: c.host }, res);
    }));
    if (list.length) {
      // a poll can take many seconds: links saved, removed or copied meanwhile must not be written over, so only the "last worked" notes are merged into a fresh read
      const fresh = readConnections();
      const polled = new Map(list.map((c) => [c.id, c]));
      fresh.forEach((c) => { const u = polled.get(c.id); if (u) { c.lastOk = u.lastOk; c.lastError = u.lastError; } });
      writeConnections(fresh);
    }
    return { ok: true, results: results, list: list.map(publicConn) };
  } finally { connPolling = false; }
});

// ---------- server management (iLO / iDRAC / BMC over Redfish; logins are kept encrypted, never shown again) ----------
const bmcLib = require('./bmc');
let bmcMemory = null;
const bmcFile = () => path.join(app.getPath('userData'), 'bmc.dat');
function readBmc() {
  if (bmcMemory) return bmcMemory;
  try {
    const raw = JSON.parse(fs.readFileSync(bmcFile(), 'utf8'));
    if (raw && typeof raw.enc === 'string' && notesEncryptionOk()) {
      const list = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
      if (Array.isArray(list)) return list.slice(0, 200);
    }
  } catch (e) { /* none saved yet, or unreadable */ }
  return [];
}
function writeBmc(list) {
  if (!notesEncryptionOk()) { bmcMemory = list; return false; }
  bmcMemory = null;
  const file = bmcFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ enc: safeStorage.encryptString(JSON.stringify(list)).toString('base64') }));
  fs.renameSync(tmp, file);
  return true;
}
const publicBmc = (b) => ({ id: b.id, name: b.name, host: b.host, port: b.port, https: b.https, username: b.username, mac: b.mac || '', hasPassword: !!b.password });
const newBmcId = () => 'b' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const validBmcId = (id) => typeof id === 'string' && /^b[a-z0-9]{6,24}$/.test(id);
ipcMain.handle('bmc:list', (event) => { checkSender(event); return { ok: true, list: readBmc().filter(inProf).map(publicBmc), canEncrypt: notesEncryptionOk() }; });
ipcMain.handle('bmc:save', async (event, cfg) => {
  checkSender(event);
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Bad request' };
  if (!activeProfile) return { ok: false, error: 'The network profile is still loading. Try again in a moment.' };
  const list = readBmc();
  const old = validBmcId(cfg.id) ? list.find((b) => b.id === cfg.id && inProf(b)) : null;
  if (!old && list.filter(inProf).length >= 20) return { ok: false, error: 'You can save up to 20 servers for one network.' };
  let clean;
  try { clean = bmcLib.cleanBmc(cfg); } catch (e) { return { ok: false, error: e.message }; }
  if (!clean.password && old) clean.password = old.password;
  if (!clean.username || !clean.password) return { ok: false, error: 'Type the BMC user name and password.' };
  const test = await bmcLib.status(clean);                       // only save a login that really works
  if (!test.ok) return { ok: false, error: test.error };
  clean.id = old ? old.id : newBmcId();
  clean.profileId = activeProfile;
  const next = old ? list.map((b) => (b.id === old.id ? clean : b)) : list.concat([clean]);
  writeBmc(next);
  return { ok: true, list: next.filter(inProf).map(publicBmc), status: test, id: clean.id };
});
ipcMain.handle('bmc:remove', (event, id) => {
  checkSender(event);
  if (!validBmcId(id)) return { ok: false, error: 'Bad request' };
  const next = readBmc().filter((b) => !(b.id === id && inProf(b)));
  writeBmc(next);
  return { ok: true, list: next.filter(inProf).map(publicBmc) };
});
ipcMain.handle('bmc:status', async (event, id) => {
  checkSender(event);
  const b = validBmcId(id) ? readBmc().find((x) => x.id === id && inProf(x)) : null;
  if (!b) return { ok: false, code: 'config', error: 'That server is not saved any more.' };
  return await bmcLib.status(b);
});
ipcMain.handle('bmc:power', async (event, id, action) => {
  checkSender(event);
  const b = validBmcId(id) ? readBmc().find((x) => x.id === id && inProf(x)) : null;
  if (!b) return { ok: false, code: 'config', error: 'That server is not saved any more.' };
  return await bmcLib.power(b, String(action));
});
// from a backup: the details come back, the passwords never do
ipcMain.handle('bmc:import', (event, items, replace) => {
  checkSender(event);
  if (!activeProfile) return { ok: false, error: 'The network profile is still loading.' };
  const incoming = Array.isArray(items) ? items.slice(0, 20) : [];
  let list = replace ? readBmc().filter((b) => !inProf(b)) : readBmc();
  let added = 0;
  incoming.forEach((i) => {
    if (list.filter(inProf).length >= 20) return;
    let clean;
    try { clean = bmcLib.cleanBmc(i); } catch (e) { return; }
    if (list.some((b) => inProf(b) && b.host === clean.host && b.port === clean.port)) return;
    clean.password = ''; clean.id = newBmcId(); clean.profileId = activeProfile;
    list.push(clean); added++;
  });
  writeBmc(list);
  return { ok: true, added: added, list: list.filter(inProf).map(publicBmc) };
});

// ---------- network scan (for the Network Map tab) ----------
const scanner = require('./scanner');
let activeScan = null;

ipcMain.handle('net:interfaces', async (event) => {
  checkSender(event);
  try {
    const interfaces = scanner.listInterfaces();
    const gateway = await scanner.detectGateway();
    // the router's hardware address tells two networks with the same 192.168.x.x numbers apart
    let gatewayMac = null;
    if (gateway) {
      try {
        let arp = await scanner.readArpTable();
        if (!arp.get(gateway)) { await scanner.pingHost(gateway); arp = await scanner.readArpTable(); }
        gatewayMac = arp.get(gateway) || null;
      } catch (e) { gatewayMac = null; }
    }
    let speeds = {};
    try { speeds = await scanner.linkSpeeds(); } catch (e) { speeds = {}; }
    return { ok: true, interfaces: interfaces, gateway: gateway, gatewayMac: gatewayMac, speeds: speeds };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('net:scan', (event, options) => {
  checkSender(event);
  if (activeScan) return { ok: false, error: 'A scan is already running.' };
  if (!options || typeof options !== 'object') return { ok: false, error: 'Bad request' };
  if (options.mode === 'thorough' && !security.get().thoroughScan) return { ok: false, error: 'The thorough scan is turned off in Settings > Security. Use the quick scan, or turn it back on there.' };
  const send = (message) => {
    if (message.type === 'done') activeScan = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('net:event', message);
  };
  const result = scanner.startScan({
    cidr: String(options.cidr || ''),
    mode: options.mode === 'thorough' ? 'thorough' : options.mode === 'background' ? 'background' : 'quick',
    router: String(options.router || ''),
    methods: { probe: security.get().scanProbe, mdns: security.get().scanMdns, ssdp: security.get().scanSsdp, netbios: security.get().scanNetbios, reverseDns: security.get().scanReverseDns },
    known: Array.isArray(options.known) ? options.known.slice(0, 1100).filter((x) => typeof x === 'string' && x.length < 16) : []
  }, send);
  if (!result.ok) return result;
  activeScan = result.session;
  return { ok: true, cidr: result.cidr, total: result.total };
});

ipcMain.handle('net:wake', async (event, macs) => {
  checkSender(event);
  if (!Array.isArray(macs)) return { ok: false, error: 'Bad request' };
  try { return await scanner.wakeOnLan(macs.filter((m) => typeof m === 'string' && m.length < 20).slice(0, 100)); }
  catch (e) { return { ok: false, error: 'The wake-up signal could not be sent.' }; }
});

// ---------- SNMP finder ----------
ipcMain.handle('snmp:find', async (event, req) => {
  checkSender(event);
  if (!req || typeof req !== 'object') return { ok: false, error: 'Bad request' };
  if (security.get().snmpEnabled === false) return { ok: false, error: 'SNMP is turned off in the Security settings (Finding machines), so the SNMP finder is not available. Turn SNMP back on there to use it.' };
  if (security.get().snmpV3Only || !security.get().connectors) return { ok: false, error: 'The SNMP finder tries version 2c, which the Security settings do not allow right now (or router connections are off).' };
  const ips = Array.from(new Set((Array.isArray(req.ips) ? req.ips : []).filter((x) => typeof x === 'string' && connectors.isPrivateIp(x)))).slice(0, 40);
  const comms = Array.from(new Set((Array.isArray(req.communities) ? req.communities : []).map((x) => String(x).trim()).filter((x) => x && x.length <= 64 && !/[\u0000-\u001f\u007f]/.test(x)))).slice(0, 6);
  if (!ips.length) return { ok: true, found: [], silent: [] };
  if (!comms.length) return { ok: false, error: 'Type at least one community name to try (the usual one is "public").' };
  const found = [], silent = [];
  let next = 0;
  const worker = async () => {
    while (next < ips.length) {
      const ip = ips[next++];
      let r;
      try { r = await connectors.snmpProbe(ip, comms, 161); } catch (e) { r = { ok: false }; }
      if (r && r.ok) found.push(r); else silent.push(ip);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return { ok: true, found: found, silent: silent };
});

// ---------- Bandwidth Monitor ----------
// Router and switch numbers are asked for at most every 3 seconds however often the screen asks; this computer's own card every time.
const bwLib = require('./bandwidth');
let bwGear = { at: 0, busy: false, list: [] };
ipcMain.handle('bw:sample', async (event) => {
  checkSender(event);
  const at = Date.now();
  if (!bwGear.busy && at - bwGear.at > 3000) {
    bwGear.busy = true;
    const conns = readConnections().filter((c) => inProf(c) && ['snmp', 'hpe', 'asus'].includes(c.type));
    Promise.all(conns.map(async (c) => {
      let res;
      try { res = await Promise.race([connectors.counters(c), new Promise((r) => setTimeout(() => r({ ok: false, code: 'timeout', error: 'The device did not answer in time.' }), 12000))]); }
      catch (e) { res = { ok: false, code: 'bad', error: 'The device could not be asked.' }; }
      return Object.assign({ id: c.id, name: c.name || c.host, host: c.host, type: c.type }, res);
    })).then((list) => { bwGear = { at: Date.now(), busy: false, list: list }; }).catch(() => { bwGear.busy = false; });
  }
  let local = null;
  try { local = await bwLib.localCounters(); } catch (e) { /* not available */ }
  return { ok: true, at: at, local: local, gear: bwGear.list, gearAt: bwGear.at, saved: readConnections().filter((c) => inProf(c) && ['snmp', 'hpe', 'asus'].includes(c.type)).length };
});

ipcMain.handle('net:shares', async (event, ip) => {
  checkSender(event);
  try { return await scanner.listShares(String(ip || '')); } catch (e) { return { ok: false, error: 'The share list could not be read.' }; }
});

ipcMain.handle('net:dns', async (event, ips) => {
  checkSender(event);
  try {
    const list = (Array.isArray(ips) ? ips : []).filter((x) => typeof x === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(x) && connectors.isPrivateIp(x)).slice(0, 512);
    if (!list.length) return { ok: true, results: {} };
    return { ok: true, results: await require('./dns-probe').probeMany(list, 24) };
  } catch (e) { return { ok: false, error: 'DNS could not be checked.' }; }
});

ipcMain.handle('net:cancel', (event) => {
  checkSender(event);
  if (activeScan) activeScan.cancel();
  return { ok: true };
});

// ---------- reload and restart ----------
function reloadWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (activeScan) { try { activeScan.cancel(); } catch (e) { /* ignore */ } activeScan = null; }
  mainWindow.webContents.reload();
}

// Starts the program again (used after installing an update, so you do not have to close and open it by hand).
const RELAUNCHED_FLAG = '--hub-relaunched';       // tells the new copy that it was started by the old one and may wait for it to finish closing
function restartProgram() {
  // Give the single-instance lock back first. Otherwise the new copy can start while the old one still holds it,
  // decide "I am already running" and quit, and then the old one closes too: nothing comes back.
  try { app.releaseSingleInstanceLock(); } catch (e) { /* none held */ }
  const opts = { args: process.argv.slice(1).filter((a) => a !== '--builtin' && a !== RELAUNCHED_FLAG).concat([RELAUNCHED_FLAG]) };
  // the portable Windows .exe and the Linux AppImage unpack themselves; start the real file again, not the unpacked copy
  if (process.env.PORTABLE_EXECUTABLE_FILE) opts.execPath = process.env.PORTABLE_EXECUTABLE_FILE;
  else if (process.env.APPIMAGE) opts.execPath = process.env.APPIMAGE;
  app.relaunch(opts);
  app.exit(0);
}

ipcMain.handle('app:reload', (event) => {
  checkSender(event);
  setTimeout(reloadWindow, 50);
  return { ok: true };
});

ipcMain.handle('update:restart', (event) => {
  checkSender(event);
  setTimeout(restartProgram, 200);
  return { ok: true };
});

// ---------- looking for a newer version on GitHub (only when the person has said yes; never installs by itself) ----------
const updater = require('./updater');
function prefsFile() { return path.join(app.getPath('userData'), 'update-prefs.json'); }
function runningVersion() {
  for (const f of ['manifest.json', 'package.json']) {
    try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); if (j && /^\d+\.\d+\.\d+$/.test(j.version)) return j.version; } catch (e) { /* try the next */ }
  }
  return '0.0.0';
}
let lastUpdateResult = null, updateBusy = false;
ipcMain.handle('updater:status', (event) => {
  checkSender(event);
  const p = updater.loadPrefs(prefsFile());
  return { ok: true, configured: updater.repoReady(updater.UPDATE_REPO), asked: p.asked, enabled: p.enabled, current: runningVersion() };
});
ipcMain.handle('updater:setEnabled', (event, on) => {
  checkSender(event);
  const p = updater.loadPrefs(prefsFile());
  p.asked = true; p.enabled = on === true;
  try { updater.savePrefs(prefsFile(), p); } catch (e) { return { ok: false, error: 'Could not save that choice.' }; }
  return { ok: true, enabled: p.enabled };
});
ipcMain.handle('updater:check', async (event, manual) => {
  checkSender(event);
  const p = updater.loadPrefs(prefsFile());
  if (manual !== true && !p.enabled) return { ok: true, offer: false, disabled: true };
  if (updateBusy) return { ok: false, error: 'Already checking.' };
  updateBusy = true;
  try {
    const r = await updater.checkLatest({ current: runningVersion() });
    lastUpdateResult = r && r.ok && r.available ? r : null;      // kept here, with the download address, for the Install button
    const out = updater.publicResult(r);                           // the web page never sees (or chooses) the download address
    out.offer = manual === true ? !!out.available : updater.shouldOffer(out, p, Date.now());
    return out;
  } finally { updateBusy = false; }
});
ipcMain.handle('updater:skip', (event, version) => {
  checkSender(event);
  const p = updater.loadPrefs(prefsFile());
  if (typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) p.skipped = version;
  try { updater.savePrefs(prefsFile(), p); } catch (e) { return { ok: false }; }
  return { ok: true };
});
ipcMain.handle('updater:snooze', (event) => {
  checkSender(event);
  const p = updater.loadPrefs(prefsFile());
  p.snoozeUntil = Date.now() + 24 * 3600 * 1000;
  try { updater.savePrefs(prefsFile(), p); } catch (e) { return { ok: false }; }
  return { ok: true };
});
// Hands a downloaded update to an older starter program's installer (see the file box note above). Only a plain name in our own downloads folder counts.
ipcMain.handle('updater:armInstall', (event, name) => {
  checkSender(event);
  const dir = path.join(app.getPath('userData'), 'downloads');
  if (typeof name !== 'string' || !updater.ASSET_RE.test(name)) return { ok: false };
  const file = path.join(dir, name);
  if (path.dirname(path.resolve(file)) !== path.resolve(dir) || !fs.existsSync(file)) return { ok: false };
  armedUpdateFile = file; armedUntil = Date.now() + 120000;
  return { ok: true };
});
// Removes downloaded update files once they are installed (or not wanted).
ipcMain.handle('updater:tidy', (event) => {
  checkSender(event);
  armedUpdateFile = '';
  try { const dir = path.join(app.getPath('userData'), 'downloads'); for (const f of fs.readdirSync(dir)) if (/\.hubupdate(\.part)?$/.test(f)) fs.rmSync(path.join(dir, f), { force: true }); } catch (e) { /* nothing to tidy */ }
  return { ok: true };
});
// ---------- Security settings window ----------
ipcMain.handle('security:get', (event) => { checkSender(event); return { ok: true, settings: security.get(), defaults: security.DEFAULTS }; });
ipcMain.handle('security:set', (event, o) => {
  checkSender(event);
  if (!o || typeof o !== 'object') return { ok: false, error: 'Bad request' };
  const before = security.get().certs;
  const r = security.set(o); if (r.ok) { connectors.setPolicy(r.settings); if (r.settings.certs !== before) forgetCertDecisions(); }
  return r;
});
ipcMain.handle('security:preset', (event, name) => {
  checkSender(event);
  const before = security.get().certs;
  const r = security.preset(name === 'strict' ? 'strict' : name === 'quiet' ? 'quiet' : 'default'); if (r.ok) { connectors.setPolicy(r.settings); if (r.settings.certs !== before) forgetCertDecisions(); }
  return r;
});
// Chromium remembers "this certificate is fine" for a while: drop the open connections and cached answers so the new rule applies to the next load
function forgetCertDecisions() {
  try {
    const { session } = require('electron');
    [session.defaultSession, session.fromPartition('persist:panels')].forEach((ses) => {
      try { ses.closeAllConnections(); ses.clearHostResolverCache(); ses.clearCache(); } catch (e) { /* best effort */ }
    });
  } catch (e) { /* best effort */ }
}
// ---------- earlier versions: the app keeps copies of the last few versions that ran, so you can go back further ----------
const versionArchive = require('./version-archive').create(app.getPath('userData'));
const runningDirName = /^v\d{1,4}\.\d{1,4}\.\d{1,4}(-b[a-z0-9]{1,6})?$/.test(path.basename(__dirname)) && path.basename(path.dirname(__dirname)) === 'updates' ? path.basename(__dirname) : '';
// the version of the program itself (the starter's own package.json); 0.0.0 when it cannot be read, which only means nothing is filtered out
function builtInVersionNow() {
  try { const v = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).version; if (/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(v))) return v; } catch (e) { /* fall through */ }
  return '0.0.0';
}
function runningVersionNow() {
  try { if (runningDirName) { const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')); if (m && typeof m.version === 'string') return m.version; } } catch (e) { /* fall through */ }
  return builtInVersionNow();
}
ipcMain.handle('updater:versions', (event) => {
  checkSender(event);
  versionArchive.archive(runningVersionNow());
  return { ok: true, keep: versionArchive.getKeep(), running: runningVersionNow(), builtIn: builtInVersionNow(), list: versionArchive.choices(runningVersionNow(), builtInVersionNow()) };
});
ipcMain.handle('updater:setKeep', (event, n) => {
  checkSender(event);
  const r = versionArchive.setKeep(n);
  if (!r.ok) return r;
  versionArchive.archive(runningVersionNow());        // also deletes the copies beyond the new number
  return { ok: true, keep: r.keep, list: versionArchive.choices(runningVersionNow(), builtInVersionNow()) };
});
ipcMain.handle('updater:switchTo', (event, version) => {
  checkSender(event);
  return versionArchive.switchTo(version, runningDirName, runningVersionNow(), builtInVersionNow());
});
// Opens the folder where the app keeps its installed updates (made if it is not there yet) in the system's file manager.
ipcMain.handle('updater:openFolder', async (event) => {
  checkSender(event);
  const dir = path.join(app.getPath('userData'), 'updates');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { return { ok: false, error: 'Could not create the updates folder.' }; }
  const err = await shell.openPath(dir);
  return err ? { ok: false, error: 'Could not open the folder: ' + String(err).slice(0, 120) } : { ok: true, path: dir };
});
ipcMain.handle('updater:download', async (event) => {
  checkSender(event);
  const r = lastUpdateResult;
  if (!r || !r.assetUrl || !r.assetName) return { ok: false, error: 'There is no update file to download. Check for updates again.' };
  if (updateBusy) return { ok: false, error: 'Please wait a moment.' };
  updateBusy = true;
  try {
    const d = await updater.download({ url: r.assetUrl, name: r.assetName, dir: path.join(app.getPath('userData'), 'downloads') });
    if (d.ok) { rememberFolder('update', d.file); return { ok: true, name: d.name, version: r.latest }; }
    return d;
  } finally { updateBusy = false; }
});

// ---------- Ctrl+F inside any panel ----------
// A panel's web page keeps the keyboard to itself, so the keys are noticed here and passed on to the dashboard.
app.on('web-contents-created', (event, wc) => {
  if (wc.getType() !== 'webview') return;
  wc.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown' || !mainWindow || mainWindow.isDestroyed()) return;
    const key = String(input.key || '').toLowerCase();
    if ((input.control || input.meta) && !input.alt && key === 'f') {
      ev.preventDefault();
      mainWindow.webContents.send('find:open', { guestId: wc.id });
    } else if (key === 'escape') {
      mainWindow.webContents.send('find:esc', { guestId: wc.id });
    }
  });
});

// ---------- settings and the system tray ("close button keeps it running in the background") ----------
const TRAY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAaklEQVR42u3XzQoAEBAE4H0vb+edUS6Uq7+INWXU3tR8B2lHZHCM9enEyMo5FbqFuR0+RGiFNxHa4RUCEuBCnM7O3QrQ02kACoIAAgiABaj9hrAAvgECCPgH8Hwl41YMUUwgqhlEOX1RzzOrN4Ba/Ln20gAAAABJRU5ErkJggg==';
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try { const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); return { closeToTray: j && j.closeToTray === true, gpu: !(j && j.gpu === false), gpuAutoOff: !!(j && j.gpu === false && j.gpuAutoOff === true) }; } catch (e) { return { closeToTray: false, gpu: true, gpuAutoOff: false }; }
}
function writeSettings(s) {
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ closeToTray: s.closeToTray === true, gpu: s.gpu !== false, gpuAutoOff: s.gpu === false && s.gpuAutoOff === true }));
  fs.renameSync(tmp, settingsFile());
}
let settings = { closeToTray: false, gpu: true, gpuAutoOff: false };
let tray = null;
let quitting = false;
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function ensureTray() {
  if (tray) return true;
  try {
    let img = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64'));
    if (process.platform === 'win32') img = img.resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('Dashboard Hub');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Dashboard Hub', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', showWindow);
    app.hubTray = tray;
    return true;
  } catch (e) { tray = null; app.hubTray = null; return false; }
}
function removeTray() {
  if (tray) { try { tray.destroy(); } catch (e) { /* already gone */ } tray = null; app.hubTray = null; }
}
app.on('before-quit', () => { quitting = true; });
ipcMain.handle('app:settings:get', (event) => { checkSender(event); let gpuState = 'unknown';
  try {
    if (!gpuWanted) gpuState = 'off';
    else {
      const f = app.getGPUFeatureStatus() || {};
      const v = Object.keys(f).map((k) => String(f[k]));
      gpuState = v.some((x) => /^enabled/.test(x)) ? 'on' : (v.length ? 'software' : 'unknown');
    }
  } catch (e) { /* unknown */ }
  return { ok: true, closeToTray: settings.closeToTray, platform: process.platform, gpu: settings.gpu !== false, gpuRunning: gpuWanted, gpuState: gpuState, gpuAutoOff: settings.gpu === false && settings.gpuAutoOff === true };
});
// Desktop notices are sent from here (not from the page) so they still appear while the window is hidden in the tray.
let lastNoticeAt = 0;
ipcMain.handle('app:notify', (event, body) => {
  checkSender(event);
  const text = String(body || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 400);
  if (!text) return { ok: false };
  try {
    if (!Notification.isSupported()) return { ok: false };
    const n = new Notification({ title: 'Dashboard Hub', body: text, icon: nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64')) });
    n.on('click', showWindow);
    app.hubLastNotice = text; lastNoticeAt = Date.now();
    n.show();
    return { ok: true };
  } catch (e) { return { ok: false }; }
});
ipcMain.handle('app:gpu:set', (event, on) => {
  checkSender(event);
  settings.gpu = on !== false;
  settings.gpuAutoOff = false;
  try { writeSettings(settings); } catch (e) { return { ok: false, error: 'The setting could not be saved.' }; }
  return { ok: true, gpu: settings.gpu, needsRestart: settings.gpu !== gpuWanted };
});
ipcMain.handle('app:restart', (event) => {
  checkSender(event);
  quitting = true;
  restartProgram();          // same careful restart as after an update (portable .exe and AppImage included)
  return { ok: true };
});
ipcMain.handle('app:settings:set', (event, s) => {
  checkSender(event);
  if (!s || typeof s !== 'object') return { ok: false, error: 'Bad request' };
  const want = s.closeToTray === true;
  if (want && !ensureTray()) return { ok: false, error: 'This computer would not give the app a tray icon, so the setting was left off. (On Linux, the desktop needs a system tray; GNOME needs the "AppIndicator" extension.)' };
  if (!want) removeTray();
  settings.closeToTray = want;
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setBackgroundThrottling(!want); } catch (e) { /* ignore */ }
  try { writeSettings(settings); } catch (e) { return { ok: false, error: 'The setting could not be saved.' }; }
  return { ok: true, closeToTray: settings.closeToTray };
});

// ---------- window ----------
// If the graphics driver keeps crashing the graphics process (3 times in 10 minutes), switch the graphics card off for the next start and
// say so in Settings. Chromium also falls back to software drawing by itself during the session; this makes it stick, so the app does not
// keep running into the same driver fault every time it opens.
const gpuCrashes = [];
app.on('child-process-gone', (e, details) => {
  try {
    if (!details || details.type !== 'GPU' || details.reason === 'clean-exit' || details.reason === 'killed') return;
    const now = Date.now();
    while (gpuCrashes.length && now - gpuCrashes[0] > 600000) gpuCrashes.shift();
    gpuCrashes.push(now);
    if (gpuCrashes.length >= 3 && settings.gpu !== false) {
      settings.gpu = false; settings.gpuAutoOff = true;
      writeSettings(settings);
    }
  } catch (err) { /* a safety net must never cause a crash of its own */ }
});
const windowState = require('./window-state');
function windowStateFile() { return path.join(app.getPath('userData'), 'window-state.json'); }
function createWindow() {
  // open on the same screen, at the same size, as last time (an unplugged screen falls back to the main one)
  let place = { width: 1400, height: 900, maximized: false };
  try {
    const { screen } = require('electron');
    place = windowState.pickBounds(windowState.load(windowStateFile()), screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea })), { width: 1400, height: 900 });
  } catch (e) { /* default place */ }
  mainWindow = new BrowserWindow({
    width: place.width,
    height: place.height,
    x: place.bounds ? place.bounds.x : undefined,
    y: place.bounds ? place.bounds.y : undefined,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#14171c',
    title: 'Dashboard Hub',
    autoHideMenuBar: true,
    webPreferences: {
      webviewTag: true,          // lets us show each panel in its own <webview>
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (place.maximized) mainWindow.maximize();

  // ---- graphics safety net ----
  // 1) the page is told whenever the window cannot be seen (hidden in the tray, minimised), so it stops drawing
  const sendVisible = () => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:visible', mainWindow.isVisible() && !mainWindow.isMinimized()); } catch (e) { /* ignore */ }
  };
  ['show', 'hide', 'minimize', 'restore'].forEach((ev) => mainWindow.on(ev, sendVisible));
  mainWindow.webContents.on('did-finish-load', sendVisible);
  // 2) if the window's page process dies (out of memory, a graphics fault), bring it back by itself, but not in an endless loop
  const pageCrashes = [];
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    if (!details || details.reason === 'clean-exit' || details.reason === 'killed') return;
    const now = Date.now();
    while (pageCrashes.length && now - pageCrashes[0] > 120000) pageCrashes.shift();
    pageCrashes.push(now);
    if (pageCrashes.length <= 3 && mainWindow && !mainWindow.isDestroyed()) setTimeout(() => { try { mainWindow.webContents.reload(); } catch (e2) { /* ignore */ } }, 800);
  });
  let saveTimer = null;
  const rememberPlace = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
    const b = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    // when maximized, store a point on the screen it is maximized on so the right screen comes back
    const here = mainWindow.getBounds();
    windowState.save(windowStateFile(), mainWindow.isMaximized()
      ? { x: here.x + 40, y: here.y + 40, width: Math.max(200, b.width), height: Math.max(200, b.height), maximized: true, normal: b }
      : { x: b.x, y: b.y, width: b.width, height: b.height, maximized: false });
  };
  const rememberSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(rememberPlace, 500); };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((ev) => mainWindow.on(ev, rememberSoon));
  mainWindow.on('close', () => { clearTimeout(saveTimer); rememberPlace(); });

  // ---- guard rails ----
  // The app window itself never opens new windows or leaves its own page.
  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!/^file:/i.test(url)) e.preventDefault(); });
  // Every panel's web view is forced into a locked-down, normal-website setup, whatever the page asks for.
  wc.on('will-attach-webview', (e, webPreferences, params) => {
    delete webPreferences.preload; delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false; webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true; webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false; webPreferences.enableBlinkFeatures = '';
    webPreferences.sandbox = true;
    if (!/^https?:\/\//i.test(String(params.src || '')) || params.partition !== 'persist:panels') e.preventDefault();
  });
  wc.on('did-attach-webview', (e, guest) => {
    // pop-ups (for example "sign in with ..." windows) are fine for normal web addresses only
    guest.setWindowOpenHandler(({ url }) => (security.get().popups && /^https?:\/\//i.test(url) ? { action: 'allow' } : { action: 'deny' }));
  });
  // Cameras, microphones, location and the like: only the panels you added (and your own network) may ask. The app window may not.
  const allowedAlways = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
  const askable = new Set(['media', 'notifications', 'clipboard-read', 'speaker-selection']);
  const permissionHandler = (contents, permission, callback, details) => {
    if (allowedAlways.has(permission)) return callback(true);
    const isApp = contents === mainWindow.webContents;
    const sec = security.get();
    const wanted = permission === 'media' || permission === 'speaker-selection' ? sec.allowMedia : permission === 'notifications' ? sec.allowNotifications : permission === 'clipboard-read' ? sec.allowClipboard : false;
    callback(!isApp && askable.has(permission) && wanted && trustedHost((details && details.requestingUrl) || ''));
  };
  try {
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler(permissionHandler);
    session.fromPartition('persist:panels').setPermissionRequestHandler(permissionHandler);
  } catch (e) { /* the app still works; permissions then follow Electron's defaults */ }

  // When the app is set to keep running in the tray, the hidden window must not be slowed down, or live scans and notices would stall.
  try { mainWindow.webContents.setBackgroundThrottling(!settings.closeToTray); } catch (e) { /* ignore */ }
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // F12 opens developer tools (only useful for troubleshooting)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    } else if (input.key === 'F5' || ((input.control || input.meta) && !input.shift && !input.alt && String(input.key).toLowerCase() === 'r')) {
      event.preventDefault();
      reloadWindow();                // Ctrl+R or F5: reload, like a browser or Discord
    }
  });

  // the X button: with the tray setting on, hide the window and keep running (only if the tray icon really exists, so the window can never get lost)
  mainWindow.on('close', (e) => {
    if (quitting || !settings.closeToTray) return;
    if (!ensureTray()) return;
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  setTimeout(() => { try { versionArchive.archive(runningVersionNow()); } catch (e) { /* safety net only */ } }, 4000);
  settings = readSettings();
  startWithLock((locked) => {
    if (locked) { app.on('second-instance', showWindow); ensureTray(); }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
});

// With "keep running in the tray" only one copy may run (starting it again just brings the hidden window back).
// A copy started by a restart waits up to 20 seconds for the old one to finish closing instead of giving up at once.
function startWithLock(next) {
  if (!settings.closeToTray) { next(false); return; }
  if (app.requestSingleInstanceLock()) { next(true); return; }
  if (!process.argv.includes(RELAUNCHED_FLAG)) { app.quit(); return; }
  let tries = 0;
  const timer = setInterval(() => {
    if (app.requestSingleInstanceLock()) { clearInterval(timer); next(true); }
    else if (++tries >= 80) { clearInterval(timer); app.quit(); }
  }, 250);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
