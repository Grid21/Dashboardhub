// Dashboard Hub starter.
//
// This small file never changes between updates. Its jobs:
//   1. start the app's real code (app-main.js), either the copy that came with
//      this program or a newer one you installed with "Updates > Install update
//      from file";
//   2. install and remove those update files, safely;
//   3. fall back to the built-in version if an update is damaged or fails to start.
//
// An update replaces the app's own files only (app-main.js, renderer.js, the page
// and so on). It cannot replace this starter or the Electron engine itself.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const vm = require('vm');
const crypto = require('crypto');

const STUB_API = 3;                         // bumped only when this starter gains abilities updates depend on
const BUILTIN_DIR = __dirname;
const MAX_BUNDLE_BYTES = 40 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
// Updates may hold at most this many files. Programs built before 1.18.1 stop at 40, so tools/make-update.js keeps updates at 40 or fewer.
const MAX_FILES = 120;
const REQUIRED = ['app-main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'];
const NAME_RE = /^(vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(js|json|html|css)$/;
const RESERVED = new Set(['main.js', 'package.json', 'manifest.json']);

// ---------- small helpers ----------
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function isVersion(v) { return typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v); }

function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const updatesRoot = () => path.join(app.getPath('userData'), 'updates');
const pointerFile = () => path.join(updatesRoot(), 'active.json');

const builtInVersion = (() => {
  const pkg = readJson(path.join(BUILTIN_DIR, 'package.json'));
  return pkg && isVersion(pkg.version) ? pkg.version : '0.0.0';
})();

// ---------- which copy of the app runs? ----------
const running = { dir: BUILTIN_DIR, version: builtInVersion, source: 'built-in', note: '' };
const DIR_RE = /^v\d{1,4}\.\d{1,4}\.\d{1,4}(-b[a-z0-9]{1,6})?$/;
let firstProblem = null;     // the first thing that went wrong during this start

// Checks that an installed update folder is complete and unchanged. Throws if not.
function verifyUpdateDir(dirName, version) {
  if (typeof dirName !== 'string' || !DIR_RE.test(dirName) || !isVersion(version)) throw Object.assign(new Error('bad entry'), { kind: 'incomplete' });
  const dir = path.join(updatesRoot(), dirName);
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest || manifest.version !== version || !manifest.files || typeof manifest.files !== 'object') throw Object.assign(new Error('manifest.json is missing or does not match'), { kind: 'incomplete' });
  for (const name of Object.keys(manifest.files)) {
    if (!NAME_RE.test(name) || RESERVED.has(name)) throw Object.assign(new Error('unexpected file name'), { kind: 'damaged' });
    let data;
    try { data = fs.readFileSync(path.join(dir, name)); } catch (e) { throw Object.assign(new Error(name + ' is missing'), { kind: 'incomplete' }); }
    if (sha256(data) !== manifest.files[name]) throw Object.assign(new Error(name + ' was changed after it was installed'), { kind: 'damaged' });
  }
  for (const req of REQUIRED) if (!manifest.files[req]) throw Object.assign(new Error(req + ' is missing'), { kind: 'incomplete' });
  return dir;
}

const PROBLEM_TEXT = {
  damaged: {
    what: 'A file of this update was changed or damaged after it was installed.',
    tips: ['This can be caused by a disk problem, or by antivirus software touching the files.',
           'Install the update file again: Updates > Install update from file.',
           'If it keeps happening, send me the technical details below.']
  },
  incomplete: {
    what: 'The installed update is missing some of its files.',
    tips: ['This can happen if the app or the computer was shut down while the update was being installed.',
           'Install the update file again: Updates > Install update from file.']
  },
  noload: {
    what: 'The update started, but its window did not finish opening. This happened two times in a row.',
    tips: ['Make sure there is only one copy of Dashboard Hub open, then try again.',
           'Install the update file again, in case it was damaged. If it still fails, send me the technical details below.']
  },
  crash: {
    what: 'The update has a bug that stops it from starting on this computer.',
    tips: ['Nothing is lost. Your panels, notes, SSH servers and map are safe.',
           'Ask for a fixed update file, and send me the technical details below.',
           'You can keep using the version you are on now.']
  }
};

// Something is wrong with the update that was meant to run. Mark it, remember what happened, and pick
// the newest earlier version that is known to work (or the built-in version).
function handleFailure(kind, detail) {
  const ptr = readJson(pointerFile()) || {};
  const failedVersion = running.source === 'update' ? running.version : (ptr.version || '?');
  const failedDir = running.dir !== BUILTIN_DIR ? path.basename(running.dir) : ptr.dir;
  const text = PROBLEM_TEXT[kind] || PROBLEM_TEXT.crash;
  if (!firstProblem) {
    firstProblem = {
      version: failedVersion,
      kind: kind,
      what: text.what,
      tips: text.tips,
      detail: String(detail || '').slice(0, 700) + '\n(Dashboard Hub ' + builtInVersion + ', update ' + failedVersion + ', ' + process.platform + ')',
      when: new Date().toISOString(),
      dismissed: false
    };
  }
  const history = (Array.isArray(ptr.history) ? ptr.history : []).filter((h) => h && h.dir !== failedDir);
  // newest known-good first
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    try {
      const dir = verifyUpdateDir(h.dir, h.version);
      if (compareVersions(h.version, builtInVersion) <= 0) continue;
      writeJsonAtomic(pointerFile(), { dir: h.dir, version: h.version, attempts: 1, disabled: false, reason: '', history: history, problem: firstProblem });
      running.dir = dir; running.version = h.version; running.source = 'update';
      running.note = 'Update ' + failedVersion + ' did not work, so you are on version ' + h.version + ', the last update that worked.';
      return;
    } catch (e) { history.splice(i, 1); }
  }
  const reason = 'Update ' + failedVersion + ' did not work, so you are on the built-in version (' + builtInVersion + ').';
  try { writeJsonAtomic(pointerFile(), { dir: ptr.dir, version: ptr.version, attempts: 0, disabled: true, reason: reason, history: [], problem: firstProblem }); } catch (e) { /* ignore */ }
  running.dir = BUILTIN_DIR; running.version = builtInVersion; running.source = 'built-in';
  running.note = reason;
}

function chooseCode() {
  if (process.argv.includes('--builtin')) {
    running.note = 'Started with --builtin, so installed updates were ignored.';
    return;
  }
  const ptr = readJson(pointerFile());
  if (!ptr || typeof ptr !== 'object') return;
  if (ptr.disabled) { running.note = ptr.reason || ''; return; }
  if (typeof ptr.dir !== 'string' || !DIR_RE.test(ptr.dir) || !isVersion(ptr.version)) return;

  if (compareVersions(ptr.version, builtInVersion) <= 0) {
    running.note = 'The installed update (' + ptr.version + ') is not newer than this program (' + builtInVersion + '), so the built-in version is used.';
    return;
  }
  running.source = 'update'; running.version = ptr.version;      // so handleFailure knows what failed
  if ((ptr.attempts || 0) >= 2) { handleFailure('noload', 'The update was started twice and never reported that it had opened properly.'); return; }
  let dir;
  try { dir = verifyUpdateDir(ptr.dir, ptr.version); }
  catch (e) { handleFailure(e.kind || 'damaged', e.message); return; }
  running.dir = dir;

  // count this start; the page reports back when it has loaded properly (update:ready)
  try { writeJsonAtomic(pointerFile(), Object.assign({}, ptr, { attempts: (ptr.attempts || 0) + 1 })); } catch (e) { /* ignore */ }
}

// ---------- reading and checking an update file ----------
function readBundle(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_BUNDLE_BYTES) throw new Error('That file is too big to be a Dashboard Hub update.');
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error('That is not a Dashboard Hub update file.'); }
  if (!b || typeof b !== 'object' || b.app !== 'dashboard-hub' || b.format !== 1) throw new Error('That is not a Dashboard Hub update file.');
  if (!isVersion(b.version)) throw new Error('The update file has no valid version number.');
  if (b.stubApi !== undefined && (!Number.isInteger(b.stubApi) || b.stubApi > STUB_API)) {
    throw new Error('This update needs a newer full version of Dashboard Hub. Install the new full download first, then use this update.');
  }
  if (!b.files || typeof b.files !== 'object') throw new Error('The update file has no files in it.');
  const names = Object.keys(b.files);
  if (names.length === 0 || names.length > MAX_FILES) throw new Error('The update file has an unexpected number of files.');

  const files = {};
  let total = 0;
  for (const name of names) {
    if (!NAME_RE.test(name) || RESERVED.has(name)) throw new Error('The update contains a file that is not allowed (' + name.slice(0, 40) + ').');
    const entry = b.files[name];
    if (!entry || typeof entry.gz !== 'string' || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('The update file is damaged (' + name + ').');
    let raw;
    try { raw = zlib.gunzipSync(Buffer.from(entry.gz, 'base64'), { maxOutputLength: MAX_FILE_BYTES }); }
    catch (e) { throw new Error('The update file is damaged or too big (' + name + ').'); }
    if (sha256(raw) !== entry.sha256) throw new Error('The update file is damaged (checksum does not match for ' + name + ').');
    total += raw.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('The update is bigger than expected.');
    if (name.endsWith('.js')) {
      try { new vm.Script(raw.toString('utf8'), { filename: name }); }                 // checks the code reads correctly without running it
      catch (e) { throw new Error('The update has an error in ' + name + ' (' + String(e.message).slice(0, 80) + ').'); }
    }
    if (name.endsWith('.json')) {
      try { JSON.parse(raw.toString('utf8')); } catch (e) { throw new Error('The update has a damaged data file (' + name + ').'); }
    }
    files[name] = raw;
  }
  for (const req of REQUIRED) if (!files[req]) throw new Error('The update is missing a needed file (' + req + ').');
  return { version: b.version, notes: typeof b.notes === 'string' ? b.notes.slice(0, 600) : '', files: files };
}

function installBundle(bundle) {
  const root = updatesRoot();
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, 'tmp-' + crypto.randomBytes(6).toString('hex'));
  const finalName = 'v' + bundle.version;
  const finalDir = path.join(root, finalName);
  try {
    const manifest = { version: bundle.version, installedAt: new Date().toISOString(), files: {} };
    for (const name of Object.keys(bundle.files)) {
      const target = path.join(tmp, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bundle.files[name]);
      manifest.files[name] = sha256(bundle.files[name]);
    }
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    // not in use right now? replace it. If this very folder is running, install under a fresh name instead.
    let useName = finalName;
    if (fs.existsSync(finalDir)) {
      if (path.resolve(running.dir) === path.resolve(finalDir)) useName = finalName + '-b' + Date.now().toString(36).slice(-4);
      else fs.rmSync(finalDir, { recursive: true, force: true });
    }
    const dest = path.join(root, useName);
    fs.renameSync(tmp, dest);
    const old = readJson(pointerFile()) || {};
    const history = (Array.isArray(old.history) ? old.history : []).filter((h) => h && h.dir !== useName);
    writeJsonAtomic(pointerFile(), { dir: useName, version: bundle.version, attempts: 0, disabled: false, reason: '', history: history, problem: null });
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
    throw new Error('Could not install the update: ' + e.message);
  }
  // tidy up older copies (not the one that is running right now)
  try {
    const p = readJson(pointerFile()) || {};
    const keep = new Set([p.dir].concat((p.history || []).map((h) => h && h.dir)));
    for (const entry of fs.readdirSync(root)) {
      if (entry === 'active.json' || keep.has(entry)) continue;
      if (path.resolve(path.join(root, entry)) === path.resolve(running.dir)) continue;
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }
  } catch (e) { /* leftovers are harmless */ }
}

// ---------- messages from the Updates dialog ----------
// Only the app's own window may use these, never a web panel.
function fromAppWindow(event) {
  try {
    return event.sender.getType() === 'window' && String(event.sender.getURL()).startsWith('file://');
  } catch (e) { return false; }
}

// The newest earlier update that is known to have worked, other than the one running now.
function previousGood(ptr) {
  const list = Array.isArray(ptr && ptr.history) ? ptr.history : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h && h.dir !== path.basename(running.dir) && h.version !== running.version && DIR_RE.test(h.dir) && isVersion(h.version) && compareVersions(h.version, builtInVersion) > 0) {
      return { dir: h.dir, version: h.version };
    }
  }
  return null;
}

function registerUpdateHandlers() {
  ipcMain.handle('update:info', (event) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    const ptr = readJson(pointerFile()) || {};
    return {
      ok: true,
      version: running.version,
      source: running.source,
      builtIn: builtInVersion,
      note: running.note,
      hasUpdate: !!(ptr && ptr.dir && !ptr.disabled),
      previous: previousGood(ptr),
      problem: ptr.problem && !ptr.problem.dismissed ? ptr.problem : null,
      stubApi: STUB_API
    };
  });

  // Shows the version/notes box and installs. Shared by "pick a file" and "install the one the app downloaded".
  async function confirmAndInstall(win, file) {
    let bundle;
    try { bundle = readBundle(file); } catch (e) { return { ok: false, error: e.message }; }
    const cmp = compareVersions(bundle.version, running.version);
    const relation = cmp > 0 ? 'newer than' : cmp === 0 ? 'the same as' : 'OLDER than';
    const answer = await dialog.showMessageBox(win, {
      type: cmp < 0 ? 'warning' : 'question',
      buttons: ['Install update', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Install update',
      message: 'Install Dashboard Hub ' + bundle.version + '?',
      detail: 'You are running ' + running.version + '. This update is ' + relation + ' that.' +
              (bundle.notes ? '\n\nWhat is in it:\n' + bundle.notes : '') +
              '\n\nOnly install update files you got from someone you trust. Your panels, notes and settings are not touched.'
    });
    if (answer.response !== 0) return { ok: false, canceled: true };
    try { installBundle(bundle); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, version: bundle.version };
  }

  ipcMain.handle('update:install', async (event) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    const win = BrowserWindow.fromWebContents(event.sender);
    const pick = await dialog.showOpenDialog(win, {
      title: 'Choose a Dashboard Hub update file',
      properties: ['openFile'],
      filters: [{ name: 'Dashboard Hub update', extensions: ['hubupdate'] }]
    });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false, canceled: true };
    return confirmAndInstall(win, pick.filePaths[0]);
  });

  // Installs an update the app itself downloaded. Only a plain file name inside the app's own "downloads" folder is accepted,
  // never a path, and the same checks and the same confirmation box apply as for a file you pick by hand.
  ipcMain.handle('update:installFile', async (event, name) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.hubupdate$/.test(name)) return { ok: false, error: 'That is not a downloaded update.' };
    const dir = path.join(app.getPath('userData'), 'downloads');
    const file = path.join(dir, name);
    if (path.dirname(path.resolve(file)) !== path.resolve(dir) || !fs.existsSync(file)) return { ok: false, error: 'The downloaded update is no longer there. Please check for updates again.' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await confirmAndInstall(win, file);
    if (r.ok) { try { fs.rmSync(file, { force: true }); } catch (e) { /* tidy-up only */ } }
    return r;
  });

  ipcMain.handle('update:revert', (event, target) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    try {
      const ptr = readJson(pointerFile()) || {};
      if (target === 'previous') {
        const prev = previousGood(ptr);
        if (!prev) return { ok: false, error: 'There is no earlier working update to go back to.' };
        verifyUpdateDir(prev.dir, prev.version);
        const history = (ptr.history || []).filter((h) => h.dir !== ptr.dir);   // the one you are leaving is not "good" any more
        writeJsonAtomic(pointerFile(), { dir: prev.dir, version: prev.version, attempts: 0, disabled: false, reason: 'You switched back to version ' + prev.version + '.', history: history, problem: null });
        return { ok: true, version: prev.version };
      }
      writeJsonAtomic(pointerFile(), Object.assign({}, ptr, { disabled: true, reason: 'You switched back to the built-in version.', attempts: 0, history: [], problem: null }));
      return { ok: true };
    } catch (e) { return { ok: false, error: 'Could not switch back: ' + e.message }; }
  });

  ipcMain.handle('update:dismiss', (event) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    try {
      const ptr = readJson(pointerFile());
      if (ptr && ptr.problem) writeJsonAtomic(pointerFile(), Object.assign({}, ptr, { problem: Object.assign({}, ptr.problem, { dismissed: true }) }));
    } catch (e) { /* ignore */ }
    return { ok: true };
  });

  ipcMain.handle('update:ready', (event) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    try {
      // this version opened properly: remember it as "known good" (keep the newest two)
      const ptr = readJson(pointerFile());
      if (ptr && !ptr.disabled && running.source === 'update' && ptr.dir === path.basename(running.dir)) {
        const history = (Array.isArray(ptr.history) ? ptr.history : []).filter((h) => h && h.dir !== ptr.dir);
        history.push({ dir: ptr.dir, version: ptr.version });
        while (history.length > 2) history.shift();
        writeJsonAtomic(pointerFile(), Object.assign({}, ptr, { attempts: 0, history: history }));
      }
    } catch (e) { /* ignore */ }
    return { ok: true };
  });

  ipcMain.handle('update:quit', (event) => {
    if (!fromAppWindow(event)) throw new Error('Not allowed');
    setTimeout(() => app.quit(), 150);
    return { ok: true };
  });
}

// ---------- start ----------
registerUpdateHandlers();
chooseCode();

function loadCode(dir) {
  // remember which message handlers the code registers, so they can be undone if it fails halfway
  const registered = [];
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => { registered.push(channel); return original(channel, fn); };
  try {
    require(path.join(dir, 'app-main.js'));
  } catch (e) {
    registered.forEach((c) => { try { ipcMain.removeHandler(c); } catch (e2) { /* ignore */ } });
    throw e;
  } finally {
    ipcMain.handle = original;
  }
}

// start the chosen code; if an update crashes while loading, step back (last working update, then built-in)
for (;;) {
  try {
    loadCode(running.dir);
    break;
  } catch (e) {
    if (running.source !== 'update') throw e;
    handleFailure('crash', (e && e.stack) || (e && e.message) || String(e));
  }
}
