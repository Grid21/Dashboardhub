'use strict';
// Checks that nothing a release must contain has gone missing. Run:  node tools/check-release.js
// It is also run automatically by tools/make-update.js, so an update cannot be made while a file is missing.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const must = [
  ['UNINSTALL.bat', 'Windows uninstall script'], ['UNINSTALL.sh', 'Linux/macOS uninstall script'],
  ['RUN-APP.bat'], ['RUN-APP.sh'], ['BUILD-APP.bat'], ['BUILD-APP.sh'], ['RECOMPILE-UPDATE.bat'], ['RECOMPILE-UPDATE.sh'], ['UNPACK-UPDATE.bat'], ['UNPACK-UPDATE.sh'],
  ['ENSURE-NODE.bat'], ['ENSURE-NODE.sh'], ['ENSURE-NODE.ps1'],
  ['build/installer.nsh', 'Windows installer: the uninstaller\'s "delete your data?" question'],
  ['DEVELOPMENT-RULES.md', 'the owner\'s standing rules'], ['tools/release-files.txt', 'list of files that must not silently disappear'], ['tools/removed-files.txt', 'files removed on purpose, with the reason'],
  ['LICENSE'], ['README.md'], ['FEATURES.md'], ['CHANGELOG.md'], ['THIRD-PARTY-NOTICES.md']
];
const problems = [];
for (const [f, what] of must) if (!fs.existsSync(path.join(root, f))) problems.push('missing: ' + f + (what ? '  (' + what + ')' : ''));
const exe = (f) => { try { return (fs.statSync(path.join(root, f)).mode & 0o111) !== 0; } catch (e) { return false; } };
for (const f of must.map((m) => m[0]).filter((f) => f.endsWith('.sh') && f !== 'ENSURE-NODE.sh')) if (fs.existsSync(path.join(root, f)) && !exe(f)) problems.push('not executable: ' + f);
try {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), n = (p.build || {}).nsis || {};
  if (n.include !== 'build/installer.nsh') problems.push('package.json: build.nsis.include must be "build/installer.nsh" (the uninstaller question)');
  if (n.oneClick !== false) problems.push('package.json: build.nsis.oneClick must be false');
  if (!(((p.build || {}).win || {}).target === 'nsis')) problems.push('package.json: build.win.target must be "nsis" (the installer with the uninstaller)');
  if (n.deleteAppDataOnUninstall !== false) problems.push('package.json: build.nsis.deleteAppDataOnUninstall must be false (the uninstaller asks instead)');
} catch (e) { problems.push('package.json cannot be read: ' + e.message); }
try { const nsh = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8'); if (!/customUnInstall/.test(nsh) || !/dashboard-hub/.test(nsh)) problems.push('build/installer.nsh no longer has the uninstall data question'); } catch (e) { /* reported above */ }
for (const f of ['README.md', 'FEATURES.md']) { try { if (!/UNINSTALL\.bat/.test(fs.readFileSync(path.join(root, f), 'utf8'))) problems.push(f + ' does not mention UNINSTALL.bat / UNINSTALL.sh'); } catch (e) { /* reported above */ } }

// Any file that was in an earlier release must still be here, unless it was removed on purpose and written down.
const SKIP = /^(node_modules|Dashboard Hub|update-files|\.git)(\/|$)/;
function walk(dir, rel, out) { for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (SKIP.test(r)) continue; if (e.isDirectory()) walk(dir, r, out); else out.push(r); } return out; }
const list = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean); } catch (e) { return []; } };
const tree = walk(root, '', []);
if (process.argv.includes('--update')) {
  const have = new Set(list('tools/release-files.txt')); tree.forEach((f) => have.add(f));
  fs.writeFileSync(path.join(root, 'tools/release-files.txt'), Array.from(have).sort().join('\n') + '\n');
  console.log('tools/release-files.txt now lists ' + have.size + ' files.'); process.exit(0);
}
const removedOnPurpose = new Set(list('tools/removed-files.txt'));
for (const f of list('tools/release-files.txt')) if (!tree.includes(f) && !removedOnPurpose.has(f)) problems.push('a file from earlier releases is gone: ' + f + '  (if it was removed on purpose, because the owner asked or an update no longer needs it, add it to tools/removed-files.txt with the reason)');
module.exports = { problems };
if (require.main === module) {
  if (problems.length) { console.log('The release is NOT complete:'); problems.forEach((p) => console.log('  - ' + p)); process.exit(1); }
  console.log('Release check passed: all required files are present (' + must.length + ' files, installer + uninstaller settings).');
}
