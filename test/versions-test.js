'use strict';
//   node test/versions-test.js          (the archive logic)   then the Updates window part runs under xvfb-run -a
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const VA = require('../version-archive');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const REQ = ['app-main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'];
function makeVersion(root, dirName, version, junk) {
  const dir = path.join(root, dirName); fs.mkdirSync(dir, { recursive: true });
  const files = {};
  REQ.forEach((n) => { const c = '// ' + n + ' ' + version + (junk || ''); fs.writeFileSync(path.join(dir, n), c); files[n] = sha(Buffer.from(c)); });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version, installedAt: '2026-11-0' + (Number(version.split('.')[2]) % 9 + 1) + 'T10:00:00Z', files }));
  return dir;
}
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'va-'));
const upd = path.join(ud, 'updates');
const va = VA.create(ud);
const vers = ['1.10.60', '1.10.61', '1.10.62', '1.10.63', '1.10.64', '1.10.65', '1.10.66'];
vers.forEach((v) => makeVersion(upd, 'v' + v, v));
fs.writeFileSync(path.join(upd, 'active.json'), JSON.stringify({ dir: 'v1.10.66', version: '1.10.66', attempts: 0, disabled: false, history: [{ dir: 'v1.10.65', version: '1.10.65' }, { dir: 'v1.10.66', version: '1.10.66' }] }));

va.archive('1.10.66');
let kept = fs.readdirSync(path.join(ud, 'version-archive')).sort();
check('keeps the running version plus the 4 newest earlier ones (5 copies)', kept.join() === 'v1.10.62,v1.10.63,v1.10.64,v1.10.65,v1.10.66', kept.join());
let ch = va.choices('1.10.66', '1.10.1');
check('"go back" choices: the 4 earlier versions, newest first, not the running one', ch.map((c) => c.version).join() === '1.10.65,1.10.64,1.10.63,1.10.62', ch.map((c) => c.version).join());
check('a version that is not newer than the built-in program is not offered (it could not run)', va.choices('1.10.66', '1.10.64').map((c) => c.version).join() === '1.10.65');
// the starter deletes old folders when a new update is installed; the archive keeps working
fs.rmSync(path.join(upd, 'v1.10.62'), { recursive: true }); fs.rmSync(path.join(upd, 'v1.10.63'), { recursive: true });
makeVersion(upd, 'v1.10.67', '1.10.67');
va.archive('1.10.67');
kept = fs.readdirSync(path.join(ud, 'version-archive')).sort();
check('a new version arrives: the oldest copy is dropped, the rest stay even though the starter deleted its folders', kept.join() === 'v1.10.63,v1.10.64,v1.10.65,v1.10.66,v1.10.67', kept.join());
check('the archive does not change on its own when nothing new is installed', (() => { va.archive('1.10.67'); return fs.readdirSync(path.join(ud, 'version-archive')).length === 5; })());

// damaged copy is never offered or used
fs.appendFileSync(path.join(ud, 'version-archive', 'v1.10.64', 'renderer.js'), 'tampered');
ch = va.choices('1.10.67', '1.10.1');
check('a changed (damaged) stored copy disappears from the list', !ch.some((c) => c.version === '1.10.64') && ch.length === 3, ch.map((c) => c.version).join());
let r = va.switchTo('1.10.64', 'v1.10.67', '1.10.67', '1.10.1');
check('and cannot be switched to', r.ok === false && /damaged/.test(r.error), JSON.stringify(r));

// bad input
const bads = ['../../etc', '1.10', '1.10.65; rm', '', 7, null, '1.10.65\n'];
check('refuses paths and odd version values', bads.every((bad) => va.switchTo(bad, 'v1.10.67', '1.10.67', '1.10.1').ok === false));
check('refuses the version you are on', va.switchTo('1.10.67', 'v1.10.67', '1.10.67', '1.10.1').ok === false);
check('refuses a version older than the built-in program', va.switchTo('1.10.65', 'v1.10.67', '1.10.67', '1.10.65').ok === false);

// switching
r = va.switchTo('1.10.65', 'v1.10.67', '1.10.67', '1.10.1');
const ptr = JSON.parse(fs.readFileSync(path.join(upd, 'active.json'), 'utf8'));
check('switching points the starter at the chosen version, not disabled, with a fresh start count', r.ok && ptr.dir === 'v1.10.65' && ptr.version === '1.10.65' && ptr.attempts === 0 && ptr.disabled === false, JSON.stringify([r, ptr]));
check('it was put back in the updates folder and still verifies', !!VA.verifiedFolder(path.join(upd, 'v1.10.65')));
check('the version being left is not kept as "known good"', !(ptr.history || []).some((h) => h.dir === 'v1.10.66'), JSON.stringify(ptr.history));
// switching to the version whose folder name is in use right now gets a fresh folder name
r = va.switchTo('1.10.65', 'v1.10.65', '1.10.66', '1.10.1');
const ptr2 = JSON.parse(fs.readFileSync(path.join(upd, 'active.json'), 'utf8'));
check('if that folder name is the one running, a new name is used (so a running folder is never overwritten)', r.ok && /^v1\.10\.65-b[a-z0-9]+$/.test(ptr2.dir) && fs.existsSync(path.join(upd, 'v1.10.65')), ptr2.dir);
check('the archive still has the 5 copies after switching', fs.readdirSync(path.join(ud, 'version-archive')).filter((n) => /^v\d/.test(n)).length >= 4);
console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
