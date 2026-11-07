'use strict';
// Keeps a copy of every version of the app that has run (the newest few), so you can go back further than the starter program allows.
// The starter program (main.js) cannot be changed by updates and only remembers two, so this keeps its own archive in
// <your data>/version-archive. Going back copies a version out of the archive, checks it again, and points the starter at it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP_OLDER = 4;                                   // earlier versions kept besides the one running (the default; you can change it)
const KEEP_MIN = 1, KEEP_MAX = 10;
const DIR_RE = /^v\d{1,4}\.\d{1,4}\.\d{1,4}(-b[a-z0-9]{1,6})?$/;
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const NAME_RE = /^(vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(js|json|html|css)$/;
const RESERVED = new Set(['main.js', 'package.json', 'manifest.json']);
const REQUIRED = ['app-main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
function cmp(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; }

// Reads a version folder and checks every file against its manifest. Returns { version, installedAt, files:[names] } or null.
function verifiedFolder(dir) {
  const m = readJson(path.join(dir, 'manifest.json'));
  if (!m || !VER_RE.test(String(m.version)) || !m.files || typeof m.files !== 'object') return null;
  const names = Object.keys(m.files);
  if (!names.length || names.length > 40) return null;
  for (const n of names) {
    if (!NAME_RE.test(n) || RESERVED.has(n) || !/^[0-9a-f]{64}$/.test(String(m.files[n]))) return null;
    let d; try { d = fs.readFileSync(path.join(dir, n)); } catch (e) { return null; }
    if (sha(d) !== m.files[n]) return null;
  }
  if (!REQUIRED.every((r) => m.files[r])) return null;
  return { version: m.version, installedAt: typeof m.installedAt === 'string' ? m.installedAt : '', files: names };
}

function copyFolder(from, to, info) {
  const tmp = to + '.tmp-' + crypto.randomBytes(4).toString('hex');
  try {
    for (const n of info.files.concat(['manifest.json'])) {
      const target = path.join(tmp, n);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(from, n), target);
    }
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(tmp, to);
  } catch (e) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e2) { /* ignore */ } throw e; }
}

function create(userData) {
  const updatesRoot = path.join(userData, 'updates');
  const archiveRoot = path.join(userData, 'version-archive');
  const pointerFile = path.join(updatesRoot, 'active.json');
  const keepFile = path.join(userData, 'version-keep.json');

  // how many earlier versions to keep: 1 to 10, 4 unless you changed it
  function getKeep() {
    const j = readJson(keepFile);
    return j && Number.isInteger(j.keep) && j.keep >= KEEP_MIN && j.keep <= KEEP_MAX ? j.keep : KEEP_OLDER;
  }
  function setKeep(n) {
    const v = typeof n === 'number' ? n : (typeof n === 'string' && /^\d{1,2}$/.test(n) ? Number(n) : NaN);
    if (!Number.isInteger(v) || v < KEEP_MIN || v > KEEP_MAX) return { ok: false, error: 'Choose a number from ' + KEEP_MIN + ' to ' + KEEP_MAX + '.' };
    try {
      const tmp = keepFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ keep: v }), { mode: 0o600 });
      fs.renameSync(tmp, keepFile);
    } catch (e) { return { ok: false, error: 'The setting could not be saved.' }; }
    return { ok: true, keep: v };
  }

  // Copies every installed version that is complete and unchanged into the archive, then drops the oldest. Never throws.
  function archive(runningVersion) {
    try {
      fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
      let entries = []; try { entries = fs.readdirSync(updatesRoot); } catch (e) { /* nothing installed yet */ }
      for (const e of entries) {
        if (!DIR_RE.test(e)) continue;
        const from = path.join(updatesRoot, e);
        const info = verifiedFolder(from);
        if (!info) continue;
        const to = path.join(archiveRoot, 'v' + info.version);
        if (fs.existsSync(to) && verifiedFolder(to)) continue;          // already kept
        try { copyFolder(from, to, info); } catch (err) { /* try again next start */ }
      }
      prune(runningVersion);
    } catch (e) { /* the archive is a safety net: it must never stop the app */ }
  }

  function listArchive() {
    let names = []; try { names = fs.readdirSync(archiveRoot); } catch (e) { return []; }
    const out = [];
    for (const n of names) {
      if (!DIR_RE.test(n) || /-b/.test(n)) continue;
      const info = verifiedFolder(path.join(archiveRoot, n));
      if (info && n === 'v' + info.version) out.push({ version: info.version, installedAt: info.installedAt });
    }
    return out.sort((a, b) => cmp(b.version, a.version));
  }

  function prune(runningVersion) {
    const all = listArchive();
    const keep = new Set();
    if (runningVersion) keep.add(runningVersion);
    all.filter((v) => v.version !== runningVersion).slice(0, getKeep()).forEach((v) => keep.add(v.version));
    let names = []; try { names = fs.readdirSync(archiveRoot); } catch (e) { return; }
    for (const n of names) {
      const m = /^v(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(n);
      if (m && keep.has(m[1])) continue;
      try { fs.rmSync(path.join(archiveRoot, n), { recursive: true, force: true }); } catch (e) { /* ignore */ }   // also clears leftovers
    }
  }

  // Versions you can go back to: kept copies other than the running one, newest first, and newer than the built-in program (older ones cannot run from an update).
  function choices(runningVersion, builtInVersion) {
    return listArchive().filter((v) => v.version !== runningVersion && cmp(v.version, builtInVersion) > 0).slice(0, getKeep());
  }

  // Puts a kept version back in the updates folder and points the starter at it. The starter checks it again when it starts.
  function switchTo(version, runningDirName, runningVersion, builtInVersion) {
    if (typeof version !== 'string' || !VER_RE.test(version)) return { ok: false, error: 'That is not a version number.' };
    if (version === runningVersion) return { ok: false, error: 'You are already on version ' + version + '.' };
    if (cmp(version, builtInVersion) <= 0) return { ok: false, error: 'That version is not newer than the program itself. Use "Go back to built-in version".' };
    const from = path.join(archiveRoot, 'v' + version);
    const info = verifiedFolder(from);
    if (!info || info.version !== version) return { ok: false, error: 'The stored copy of version ' + version + ' is missing or damaged, so it cannot be used.' };
    try {
      fs.mkdirSync(updatesRoot, { recursive: true });
      let name = 'v' + version;
      if (runningDirName === name) name += '-b' + Date.now().toString(36).slice(-4);
      const to = path.join(updatesRoot, name);
      copyFolder(from, to, info);
      if (!verifiedFolder(to)) throw new Error('the copy did not check out');
      const old = readJson(pointerFile) || {};
      const history = (Array.isArray(old.history) ? old.history : []).filter((h) => h && h.dir !== old.dir && h.dir !== name);
      const tmp = pointerFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ dir: name, version: version, attempts: 0, disabled: false, reason: 'You switched back to version ' + version + '.', history: history, problem: null }, null, 2));
      fs.renameSync(tmp, pointerFile);
      return { ok: true, version: version };
    } catch (e) { return { ok: false, error: 'Could not switch to version ' + version + ': ' + String(e.message).slice(0, 100) }; }
  }

  return { archive, choices, switchTo, listArchive, prune, archiveRoot, getKeep, setKeep };
}

module.exports = { create, KEEP_OLDER, KEEP_MIN, KEEP_MAX, verifiedFolder };
