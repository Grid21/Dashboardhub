'use strict';
// Security settings you can change. Everything not listed here (page isolation, update-file checks, "only addresses inside your own network") is fixed on purpose.
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  certs: 'local',            // 'local': accept self-signed certificates for your panels and local network; 'strict': only valid certificates
  allowMedia: true,          // panels may use camera / microphone / speakers (your own panels and local network only)
  allowNotifications: true,  // panels may show desktop notifications
  allowClipboard: true,      // panels may read the clipboard
  popups: true,              // panels may open new web windows (web addresses only)
  thoroughScan: true,        // the "thorough" scan (ports 1 to 1024) is available
  connectors: true,          // router / switch / controller connections may run
  meraki: true,              // Cisco Meraki (cloud) may be contacted
  snmpV3Only: false,         // refuse SNMP version 1 and 2c (they send the community name as plain text)
  snmpEnabled: true,         // false: SNMP is never used at all (connections of type SNMP, the SNMP finder, traffic counters over SNMP)
  scanProbe: true,           // scans may ping machines and check their ports (false = "quiet": only listen, no probing)
  scanMdns: true,            // scans may listen for mDNS / Bonjour announcements
  scanSsdp: true,            // scans may listen for SSDP / UPnP announcements
  scanNetbios: true,         // scans may ask Windows machines for their name (NetBIOS)
  scanReverseDns: true       // scans may look up machine names with your DNS server
});
// "Quiet" changes only how machines are found: nothing is pinged or port-checked, no NetBIOS questions, SNMP is off.
const QUIET = Object.freeze({ scanProbe: false, scanNetbios: false, snmpEnabled: false });
const STRICT = Object.freeze({ certs: 'strict', allowMedia: false, allowNotifications: false, allowClipboard: false, popups: false, thoroughScan: false, connectors: true, meraki: false, snmpV3Only: true });

function clean(o) {
  const out = Object.assign({}, DEFAULTS);
  if (!o || typeof o !== 'object') return out;
  if (o.certs === 'strict' || o.certs === 'local') out.certs = o.certs;
  Object.keys(DEFAULTS).forEach((k) => { if (typeof DEFAULTS[k] === 'boolean' && typeof o[k] === 'boolean') out[k] = o[k]; });
  return out;
}

let dir = null, cache = null;
function file() { return path.join(dir, 'security.json'); }
function init(userDataDir) { dir = userDataDir; cache = null; }
function get() {
  if (cache) return cache;
  let v = null;
  try { v = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { /* none saved yet: the defaults apply */ }
  cache = clean(v);
  return cache;
}
// only known settings with valid values count; anything else is ignored, so junk can never loosen a setting
function validPatch(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (o.certs === 'strict' || o.certs === 'local') out.certs = o.certs;
  Object.keys(DEFAULTS).forEach((k) => { if (typeof DEFAULTS[k] === 'boolean' && typeof o[k] === 'boolean') out[k] = o[k]; });
  return out;
}
function set(o) {
  const next = clean(Object.assign({}, get(), validPatch(o)));
  try {
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) { return { ok: false, error: 'The security settings could not be saved.' }; }
  cache = next;
  return { ok: true, settings: next };
}
function preset(name) { return set(name === 'strict' ? STRICT : name === 'quiet' ? QUIET : DEFAULTS); }


// ---------- Password manager extension for the panels (kept in this file so an update stays under 40 files) ----------
const pmExt = (function () {
// Password manager extension for the panels (optional, off until the owner picks one).
// Dashboard Hub is not a browser and has no extension store. This only loads ONE extension folder that the owner chose
// (a folder, or a .zip / .crx file got from the password manager's own website) into the panels' own browsing session,
// so the panels (and nothing else in the app) can use its login filling. Dashboard Hub never reads or stores any password.
const zlib = require('zlib');

const CHOICES = [
  { key: 'proton', name: 'Proton Pass', cost: 'The browser extension works with a free Proton account.' },
  { key: 'bitwarden', name: 'Bitwarden', cost: 'The browser extension works with a free Bitwarden account.' },
  { key: 'other', name: 'Another one (advanced)', cost: 'Any password manager extension folder you trust. It may or may not work.' }
];
const LIMITS = { files: 6000, total: 250 * 1024 * 1024, one: 120 * 1024 * 1024 };

// ---------- reading a .zip (and .crx / .xpi, which are zips with a small header in front) ----------
function zipStart(buf) {
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'Cr24') {          // Chrome extension file
    const ver = buf.readUInt32LE(4);
    if (ver === 3) return 12 + buf.readUInt32LE(8);
    if (ver === 2) return 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
    throw new Error('This .crx file is a version Dashboard Hub cannot read.');
  }
  return 0;
}
function zipEntries(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('That file is not a zip file.');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('That zip file is too large or uses a format Dashboard Hub cannot read.');
  if (count > LIMITS.files) throw new Error('That zip file holds far too many files to be an extension.');
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('That zip file is damaged.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nl).replace(/\\/g, '/');
    out.push({ name, method, csize, usize, off });
    p += 46 + nl + el + cl;
  }
  return out;
}
function safeRel(name) {
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\0')) return null;
  const parts = name.split('/').filter((x) => x !== '' && x !== '.');
  if (parts.some((x) => x === '..')) return null;
  return parts.join('/');
}
function unzipTo(buf, dest) {
  const base = zipStart(buf) ? buf.subarray(zipStart(buf)) : buf;
  const entries = zipEntries(base).filter((x) => !x.name.endsWith('/'));
  let total = 0;
  const files = [];
  entries.forEach((x) => {
    const rel = safeRel(x.name);
    if (!rel) throw new Error('That zip file contains a file name that is not allowed (' + String(x.name).slice(0, 60) + ').');
    if (x.usize > LIMITS.one) throw new Error('That zip file contains a file that is far too large.');
    total += x.usize; if (total > LIMITS.total) throw new Error('That zip file is far too large to be an extension.');
    files.push({ rel, x });
  });
  // a zip often holds one top folder around everything: step into it
  let strip = '';
  if (!files.some((f) => f.rel === 'manifest.json')) {
    const tops = new Set(files.map((f) => f.rel.split('/')[0]));
    if (tops.size === 1 && files.some((f) => f.rel === Array.from(tops)[0] + '/manifest.json')) strip = Array.from(tops)[0] + '/';
  }
  if (!files.some((f) => f.rel === strip + 'manifest.json')) throw new Error('No manifest.json found: that is not an unpacked browser extension.');
  files.forEach(({ rel, x }) => {
    if (!rel.startsWith(strip)) return;
    if (base.readUInt32LE(x.off) !== 0x04034b50) throw new Error('That zip file is damaged.');
    const start = x.off + 30 + base.readUInt16LE(x.off + 26) + base.readUInt16LE(x.off + 28);
    const raw = base.subarray(start, start + x.csize);
    const data = x.method === 0 ? raw : x.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.one }) : null;
    if (!data) throw new Error('That zip file uses a compression Dashboard Hub cannot read.');
    const target = path.join(dest, rel.slice(strip.length));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  });
}
function copyFolder(src, dest) {
  let n = 0, total = 0;
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from, { withFileTypes: true }).forEach((d) => {
      const a = path.join(from, d.name), b = path.join(to, d.name);
      if (d.isSymbolicLink()) return;                                   // never follow links out of the folder
      if (d.isDirectory()) { if (d.name === 'node_modules' || d.name === '.git') return; walk(a, b); return; }
      if (!d.isFile()) return;
      if (++n > LIMITS.files) throw new Error('That folder holds far too many files to be an extension.');
      total += fs.statSync(a).size; if (total > LIMITS.total) throw new Error('That folder is far too large to be an extension.');
      fs.copyFileSync(a, b);
    });
  };
  walk(src, dest);
}

function create(opts) {
  const dataDir = opts.dataDir;
  const getSession = opts.getSession;                      // () => the panels' browsing session
  const openPopupWindow = opts.openPopupWindow;            // (session, url) => window
  const root = path.join(dataDir, 'extensions');
  const cfgFile = path.join(dataDir, 'extension.json');
  let cfg = { key: '', enabled: false };
  try { const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); if (j && typeof j.key === 'string' && CHOICES.some((c) => c.key === j.key)) cfg = { key: j.key, enabled: j.enabled === true }; } catch (e) { /* none saved */ }
  let ext = null, error = '';
  let popupWin = null;
  const dirOf = () => path.join(root, 'current');
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg), { mode: 0o600 }); } catch (e) { /* not saved */ } };
  const niceName = (dir, m) => {                           // real extensions often name themselves "__MSG_extName__": look it up
    const x = /^__MSG_(\w+)__$/.exec(m.name);
    if (!x) return m.name;
    for (const l of [m.default_locale, 'en', 'en_US'].filter(Boolean)) {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, '_locales', l, 'messages.json'), 'utf8').replace(/^\uFEFF/, '')); const k = Object.keys(j).find((q) => q.toLowerCase() === x[1].toLowerCase()); if (k && j[k].message) return String(j[k].message).slice(0, 60); } catch (e) { /* try the next */ }
    }
    return 'Extension';
  };
  const readManifest = (dir) => {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
    if (!m || (m.manifest_version !== 2 && m.manifest_version !== 3) || typeof m.name !== 'string') throw new Error('manifest.json is not a browser extension manifest.');
    return m;
  };
  async function unload() {
    if (popupWin) { try { popupWin.destroy(); } catch (e) { /* closed */ } popupWin = null; }
    if (ext) { try { await getSession().extensions.removeExtension(ext.id); } catch (e) { /* not loaded */ } ext = null; }
  }
  async function load() {
    error = '';
    if (!cfg.enabled) return { ok: true };
    try {
      const dir = dirOf();
      readManifest(dir);
      await unload();
      ext = await getSession().extensions.loadExtension(dir, { allowFileAccess: false });
      return { ok: true };
    } catch (e) { ext = null; error = 'The extension could not be loaded: ' + String((e && e.message) || e).slice(0, 200); return { ok: false, error }; }
  }
  // fromPath: a folder or a .zip/.crx/.xpi file the owner picked. Only one extension at a time.
  async function install(key, fromPath) {
    if (!CHOICES.some((c) => c.key === key)) return { ok: false, error: 'Pick one from the list first.' };
    const stage = path.join(root, 'staging');
    try {
      fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
      const st = fs.statSync(fromPath);
      if (st.isDirectory()) {
        let src = fromPath;
        if (!fs.existsSync(path.join(src, 'manifest.json'))) { const subs = fs.readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(src, d.name, 'manifest.json'))); if (subs.length === 1) src = path.join(src, subs[0].name); }
        if (!fs.existsSync(path.join(src, 'manifest.json'))) throw new Error('No manifest.json found in that folder: it is not an unpacked browser extension.');
        copyFolder(src, stage);
      } else {
        if (st.size > LIMITS.total) throw new Error('That file is far too large to be an extension.');
        unzipTo(fs.readFileSync(fromPath), stage);
      }
      const m = readManifest(stage);
      await unload();
      fs.rmSync(dirOf(), { recursive: true, force: true });
      fs.renameSync(stage, dirOf());
      cfg = { key, enabled: true }; save();
      const r = await load();
      if (!r.ok) return r;
      return { ok: true, name: niceName(dirOf(), m) };
    } catch (e) {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch (x) { /* ignore */ }
      return { ok: false, error: String((e && e.message) || e).slice(0, 220) };
    }
  }
  async function remove() {
    await unload();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    cfg = { key: '', enabled: false }; error = ''; save();
    return { ok: true };
  }
  async function setEnabled(on) {
    if (!cfg.key) return { ok: false, error: 'Install one first.' };
    cfg.enabled = !!on; save();
    if (!on) { await unload(); return { ok: true }; }
    return load();
  }
  function popupPath() {
    if (!ext) return '';
    try {
      const m = readManifest(dirOf());
      const a = m.action || m.browser_action || {};
      const p = typeof a.default_popup === 'string' ? a.default_popup : '';
      return /^[\w\-./]+$/.test(p) && !p.includes('..') ? p : '';
    } catch (e) { return ''; }
  }
  function openPopup() {
    const p = popupPath();
    if (!ext || !p) return { ok: false, error: 'This extension has no pop-up window to open.' };
    if (popupWin && !popupWin.isDestroyed()) { popupWin.focus(); return { ok: true }; }
    popupWin = openPopupWindow(getSession(), 'chrome-extension://' + ext.id + '/' + p.replace(/^\//, ''), ext.id);
    return { ok: true };
  }
  function status() {
    let name = '', version = '';
    if (cfg.key) { try { const m = readManifest(dirOf()); name = niceName(dirOf(), m); version = String(m.version || ''); } catch (e) { /* folder gone */ } }
    return { choices: CHOICES, key: cfg.key, enabled: cfg.enabled, installed: !!name, name, version, loaded: !!ext, hasPopup: !!popupPath(), error };
  }
  return { install, remove, setEnabled, load, openPopup, status, unload };
}


  return { create, unzipTo, zipStart, zipEntries, safeRel, CHOICES };
})();

module.exports = { DEFAULTS, STRICT, QUIET, clean, init, get, set, preset, pmExt };
