'use strict';
// Makes an update file (.hubupdate) from this project folder or any decompiled folder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const defaultRoot = path.join(__dirname, '..');
// a folder given on its own (not as the value of --out / --notes / --version) is the source folder
const VALUE_OPTS = new Set(['--src', '--version', '--notes', '--out']);
const loose = args.find((a, i) => !a.startsWith('-') && !VALUE_OPTS.has(args[i - 1]) && fs.existsSync(a) && fs.statSync(a).isDirectory());
const srcArg = opt('--src') || loose;
const root = path.resolve(srcArg || defaultRoot);

let version = opt('--version');
let defaultNotes = '';

if (!version) {
  const pkgPath = path.join(root, 'package.json');
  const manifestPath = path.join(root, 'decompile-manifest.json');
  if (fs.existsSync(pkgPath)) {
    try { version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version; } catch (e) {}
  }
  if (!version && fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m && m.version) { version = m.version; defaultNotes = m.notes || ''; }
    } catch (e) {}
  }
}

if (!version || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) {
  console.error('Error: Please specify --version 1.10.3');
  process.exit(1);
}

const NAME_RE = /^(vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(js|json|html|css)$/;
const SKIP = new Set(['main.js', 'package.json', 'package-lock.json', 'manifest.json', 'decompile-manifest.json']);

const names = [];
for (const f of fs.readdirSync(root)) {
  const full = path.join(root, f);
  if (fs.statSync(full).isFile() && NAME_RE.test(f) && !SKIP.has(f)) names.push(f);
}
const vendor = path.join(root, 'vendor');
if (fs.existsSync(vendor)) {
  for (const f of fs.readdirSync(vendor)) {
    if (NAME_RE.test('vendor/' + f)) names.push('vendor/' + f);
  }
}

for (const req of ['app-main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css']) {
  if (!names.includes(req)) {
    console.error(`Error: Missing ${req}`);
    process.exit(1);
  }
}

// Programs built before 1.18.1 refuse an update with more than 40 files ("unexpected number of files").
// An update can't change that rule, so stay within it unless you really mean to need a newer full build.
const STARTER_LIMIT = 40;
if (names.length > STARTER_LIMIT && !process.env.ALLOW_MANY_FILES) {
  console.error(`Error: this update would hold ${names.length} files, but installed programs built before 1.18.1 only accept ${STARTER_LIMIT}.`);
  console.error('Merge some small files together, or set ALLOW_MANY_FILES=1 if the update should need the newer full build.');
  process.exit(1);
}

const files = {};
let rawTotal = 0;
for (const name of names.sort()) {
  const raw = fs.readFileSync(path.join(root, name));
  rawTotal += raw.length;
  files[name] = {
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    gz: zlib.gzipSync(raw, { level: 9 }).toString('base64')
  };
}

const notes = opt('--notes') || defaultNotes || `Update version ${version}`;
const bundle = {
  app: 'dashboard-hub',
  format: 1,
  stubApi: 2,
  version: version,
  created: new Date().toISOString(),
  notes: notes,
  files: files
};

const defaultOutDir = path.join(defaultRoot, 'update-files');
const outDir = path.resolve(opt('--out') || defaultOutDir);
fs.mkdirSync(outDir, { recursive: true });

const baseFileName = `Dashboard-Hub-update-${version}`;
const outFile = path.join(outDir, `${baseFileName}.hubupdate`);
const txtFile = path.join(outDir, `${baseFileName}.txt`);
const jsonString = JSON.stringify(bundle, null, 2);

fs.writeFileSync(outFile, jsonString);
fs.writeFileSync(txtFile, jsonString);

console.log('=============================================================');
console.log('  Dashboard Hub Update Compiler');
console.log('=============================================================');
console.log(`Version:       ${version}`);
console.log(`Generated:     ${outFile}`);
console.log(`Chat Copy:     ${txtFile}`);
console.log('=============================================================');
