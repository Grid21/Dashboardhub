'use strict';
// Unpack (decompile) and pack (compile) .hubupdate files. Used by the "Update file tools" window inside the app.
// The same rules as the app's own installer apply, so nothing odd can be written anywhere.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const NAME_RE = /^(vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(js|json|html|css)$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const SKIP = new Set(['main.js', 'package.json', 'package-lock.json', 'manifest.json', 'decompile-manifest.json']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readBundle(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_BUNDLE_BYTES) throw new Error('That file is too big to be a Dashboard Hub update.');
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new Error('That is not a Dashboard Hub update file.'); }
  if (!b || typeof b !== 'object' || b.app !== 'dashboard-hub' || !b.files || typeof b.files !== 'object') throw new Error('That is not a Dashboard Hub update file.');
  return b;
}

// What is in an update file? (nothing is written)
function info(file) {
  const b = readBundle(file);
  return { version: VERSION_RE.test(String(b.version)) ? String(b.version) : '0.0.0', notes: String(b.notes || ''), created: String(b.created || ''), files: Object.keys(b.files).filter((n) => NAME_RE.test(n)).sort() };
}

// Writes every file of the update into a NEW folder inside parentDir. Returns the folder and what happened to each file.
function unpack(file, parentDir) {
  const b = readBundle(file);
  const version = VERSION_RE.test(String(b.version)) ? String(b.version) : '0.0.0';
  let out = path.join(parentDir, 'decompiled-update-v' + version), n = 2;
  while (fs.existsSync(out)) out = path.join(parentDir, 'decompiled-update-v' + version + '-' + (n++));
  fs.mkdirSync(out, { recursive: true });
  const written = [], skipped = [];
  for (const name of Object.keys(b.files).sort()) {
    const e = b.files[name];
    if (!NAME_RE.test(name)) { skipped.push({ name: String(name).slice(0, 60), why: 'not an allowed file name' }); continue; }
    if (!e || typeof e.gz !== 'string' || typeof e.sha256 !== 'string') { skipped.push({ name, why: 'damaged entry' }); continue; }
    let raw;
    try { raw = zlib.gunzipSync(Buffer.from(e.gz, 'base64'), { maxOutputLength: MAX_FILE_BYTES }); } catch (err) { skipped.push({ name, why: 'damaged or too big' }); continue; }
    if (sha256(raw) !== e.sha256) { skipped.push({ name, why: 'checksum does not match' }); continue; }
    const target = path.join(out, name);
    const rel = path.relative(out, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { skipped.push({ name, why: 'outside the folder' }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw);
    written.push(name);
  }
  fs.writeFileSync(path.join(out, 'decompile-manifest.json'), JSON.stringify({ version, notes: String(b.notes || ''), created: String(b.created || ''), fileCount: written.length, files: written }, null, 2));
  return { folder: out, version, notes: String(b.notes || ''), written, skipped };
}

// Looks at a folder and suggests a version and notes (from the unpacked manifest or package.json).
function packDefaults(srcDir) {
  let version = '', notes = '';
  try { const m = JSON.parse(fs.readFileSync(path.join(srcDir, 'decompile-manifest.json'), 'utf8')); if (VERSION_RE.test(String(m.version))) version = m.version; notes = String(m.notes || ''); } catch (e) { /* none */ }
  try { const p = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8')); if (VERSION_RE.test(String(p.version))) version = p.version; } catch (e) { /* none */ }
  return { version, notes, files: listPackable(srcDir) };
}

function listPackable(srcDir) {
  const names = [];
  for (const f of fs.readdirSync(srcDir)) {
    let st; try { st = fs.statSync(path.join(srcDir, f)); } catch (e) { continue; }
    if (st.isFile() && NAME_RE.test(f) && !SKIP.has(f)) names.push(f);
  }
  const v = path.join(srcDir, 'vendor');
  if (fs.existsSync(v) && fs.statSync(v).isDirectory()) for (const f of fs.readdirSync(v)) { const n = 'vendor/' + f; try { if (NAME_RE.test(n) && fs.statSync(path.join(v, f)).isFile()) names.push(n); } catch (e) { /* skip */ } }
  return names.sort();
}

// Builds the update file's text from a folder.
function pack(srcDir, version, notes) {
  if (!VERSION_RE.test(String(version))) throw new Error('The version must look like 1.10.3 (three numbers with dots).');
  const names = listPackable(srcDir);
  for (const req of ['app-main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css']) {
    if (!names.includes(req)) throw new Error('That folder is missing ' + req + ', so it cannot be a Dashboard Hub update.');
  }
  const files = {};
  for (const name of names) {
    const raw = fs.readFileSync(path.join(srcDir, name));
    if (raw.length > MAX_FILE_BYTES) throw new Error(name + ' is too big.');
    files[name] = { sha256: sha256(raw), gz: zlib.gzipSync(raw, { level: 9 }).toString('base64') };
  }
  const text = JSON.stringify({ app: 'dashboard-hub', format: 1, stubApi: 2, version: String(version), created: new Date().toISOString(), notes: String(notes || '').slice(0, 2000), files }, null, 2);
  return { text, fileCount: names.length, fileName: 'Dashboard-Hub-update-' + version + '.hubupdate' };
}

module.exports = { info, unpack, packDefaults, pack, NAME_RE, VERSION_RE };
