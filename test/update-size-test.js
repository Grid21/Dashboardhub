'use strict';
//   node test/update-size-test.js
// A built update must fit the rules of programs that are already installed, and must not be missing any file the program uses.
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const OLD_STARTER_LIMIT = 40;          // programs built before 1.18.1 refuse more files than this
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'us-'));
const r = spawnSync('node', ['tools/make-update.js', '--notes', 'size test', '--out', out], { cwd: ROOT, encoding: 'utf8' });
fs.rmSync(path.join(ROOT, 'update-files'), { recursive: true, force: true });
check('the update builds', r.status === 0, (r.stderr || '').slice(0, 300));
const f = fs.readdirSync(out).find((x) => x.endsWith('.hubupdate'));
const b = f ? JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) : { files: {} };
const names = Object.keys(b.files);
check('it holds ' + names.length + ' files, no more than the ' + OLD_STARTER_LIMIT + ' that installed programs accept', names.length > 0 && names.length <= OLD_STARTER_LIMIT, names.length);
// every file the pages and the program load must be inside the update
const have = new Set(names), missing = [];
const need = (from, ref) => { const p = path.posix.normalize(path.posix.join(path.posix.dirname(from), ref)); if (p !== 'manifest.json' && !have.has(p)) missing.push(from + ' -> ' + p); };
names.filter((n) => n.endsWith('.html')).forEach((h) => {
  const t = fs.readFileSync(path.join(ROOT, h), 'utf8');
  for (const m of t.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|json))"/g)) need(h, m[1]);
});
names.filter((n) => n.endsWith('.js') && !n.startsWith('vendor/')).forEach((j) => {
  const t = fs.readFileSync(path.join(ROOT, j), 'utf8');
  for (const m of t.matchAll(/require\('(\.\/[A-Za-z0-9._-]+)'\)/g)) need(j, m[1].endsWith('.js') || m[1].endsWith('.json') ? m[1] : m[1] + '.js');
  for (const m of t.matchAll(/path\.join\(__dirname,\s*'([A-Za-z0-9._\/-]+\.(?:js|html|json))'\)/g)) need(j, m[1]);
  for (const m of t.matchAll(/loadFile\(path\.join\(__dirname,\s*'([^']+)'/g)) need(j, m[1]);
});
check('no file used by a page or by the program is missing from the update', missing.length === 0, missing.join('; '));
check('the file names are all plain (as the starter requires)', names.every((n) => /^(vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(js|json|html|css)$/.test(n)));
console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); process.exit(failed ? 1 : 0);
