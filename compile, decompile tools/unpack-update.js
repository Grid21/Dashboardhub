'use strict';
// Decompiles / unpacks a Dashboard Hub update file (.hubupdate).
// Usage: node tools/unpack-update.js <file.hubupdate> [--out <dir>] [--info-only]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(`
Usage: node tools/unpack-update.js <file.hubupdate> [options]
Options:
  --out <dir>            Directory to extract into (default: ./decompiled-update-v<version>)
  --apply-to-project     Extract directly into project root in-place
  --info-only            Show details and notes without extracting
`);
  process.exit(0);
}

const fileArg = args.find((a) => !a.startsWith('-'));
if (!fileArg) {
  console.error('Error: Please provide a .hubupdate file path.');
  process.exit(1);
}

const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

// Same rule the app's own installer uses: only plain file names (and vendor/...) are allowed.
// A damaged or hostile update file can never write outside the output folder.
const NAME_RE = /^(vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(js|json|html|css)$/;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let bundle;
try {
  const rawText = fs.readFileSync(filePath, 'utf8').trim().replace(/^\uFEFF/, '');
  bundle = JSON.parse(rawText);
} catch (e) {
  console.error(`Error: Failed to parse update file as JSON: ${e.message}`);
  process.exit(1);
}

if (!bundle || bundle.app !== 'dashboard-hub') {
  console.error('Error: Invalid .hubupdate container (not dashboard-hub).');
  process.exit(1);
}

const version = bundle.version || '0.0.0';
const notes = bundle.notes || '(no notes)';
const created = bundle.created || '(unknown)';
const stubApi = bundle.stubApi !== undefined ? bundle.stubApi : 2;
const fileEntries = bundle.files || {};
const fileNames = Object.keys(fileEntries);

console.log('=============================================================');
console.log('  Dashboard Hub Update Decompiler');
console.log('=============================================================');
console.log(`Version:       ${version}`);
console.log(`Created:       ${created}`);
console.log(`Stub API:      ${stubApi}`);
console.log(`File Count:    ${fileNames.length} files`);
console.log(`Release Notes: \n  ${notes.split('\n').join('\n  ')}`);
console.log('-------------------------------------------------------------');

if (hasFlag('--info-only')) {
  fileNames.sort().forEach((name) => console.log(`  • ${name}`));
  process.exit(0);
}

let outDir = hasFlag('--apply-to-project')
  ? path.resolve(__dirname, '..')
  : (opt('--out') ? path.resolve(opt('--out')) : path.resolve(process.cwd(), `decompiled-update-v${version}`));

console.log(`Decompiling to: ${outDir}\n`);
fs.mkdirSync(outDir, { recursive: true });

let extractedCount = 0;
let totalBytes = 0;

for (const name of fileNames.sort()) {
  const entry = fileEntries[name];
  if (!entry || !entry.gz || !entry.sha256) continue;
  if (!NAME_RE.test(name)) { console.error(`  [SKIPPED] "${String(name).slice(0, 60)}": not an allowed file name`); continue; }
  try {
    const raw = zlib.gunzipSync(Buffer.from(entry.gz, 'base64'));
    if (sha256(raw) !== entry.sha256) {
      console.error(`  [FAIL] ${name}: Hash mismatch!`);
      continue;
    }
    const target = path.join(outDir, name);
    if (path.relative(outDir, target).startsWith('..') || path.isAbsolute(path.relative(outDir, target))) { console.error(`  [SKIPPED] ${name}: outside the output folder`); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw);
    totalBytes += raw.length;
    extractedCount++;
    console.log(`  ✓ ${name.padEnd(30)} ${(raw.length / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

try {
  fs.writeFileSync(path.join(outDir, 'decompile-manifest.json'), JSON.stringify({
    version, notes, created, fileCount: extractedCount, files: fileNames
  }, null, 2));
} catch (e) {}

console.log('-------------------------------------------------------------');
console.log(`Successfully decompiled ${extractedCount} files (${(totalBytes / 1024).toFixed(1)} KB total).`);
console.log(`Output folder: ${outDir}`);
