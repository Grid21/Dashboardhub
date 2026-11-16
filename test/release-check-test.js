'use strict';
// node test/release-check-test.js  - the uninstall scripts and the installer's uninstaller can never silently go missing again
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let r = spawnSync('node', [path.join(ROOT, 'tools/check-release.js')], { encoding: 'utf8' });
check('the real project passes the release check', r.status === 0, r.stdout);

// a copy with one thing removed must fail, and must say which
function without(what, mutate) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
  fs.mkdirSync(path.join(d, 'tools')); fs.mkdirSync(path.join(d, 'build'));
  for (const f of fs.readdirSync(ROOT)) { const p = path.join(ROOT, f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(d, f)); }
  fs.copyFileSync(path.join(ROOT, 'tools/check-release.js'), path.join(d, 'tools/check-release.js')); fs.copyFileSync(path.join(ROOT, 'build/installer.nsh'), path.join(d, 'build/installer.nsh'));
  mutate(d);
  return spawnSync('node', [path.join(d, 'tools/check-release.js')], { encoding: 'utf8' });
}
r = without('sh', (d) => fs.rmSync(path.join(d, 'UNINSTALL.sh')));
check('a missing UNINSTALL.sh is caught', r.status === 1 && /UNINSTALL\.sh/.test(r.stdout), r.stdout);
r = without('bat', (d) => fs.rmSync(path.join(d, 'UNINSTALL.bat')));
check('a missing UNINSTALL.bat is caught', r.status === 1 && /UNINSTALL\.bat/.test(r.stdout), r.stdout);
r = without('nsh', (d) => fs.rmSync(path.join(d, 'build/installer.nsh')));
check('a missing installer uninstaller question (installer.nsh) is caught', r.status === 1 && /installer\.nsh/.test(r.stdout), r.stdout);
r = without('cfg', (d) => { const p = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); delete p.build.nsis.include; fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(p)); });
check('removing the installer setting from package.json is caught', r.status === 1 && /nsis\.include/.test(r.stdout), r.stdout);
r = without('x', (d) => fs.chmodSync(path.join(d, 'UNINSTALL.sh'), 0o644));
check('an UNINSTALL.sh that cannot be run is caught', r.status === 1 && /not executable/.test(r.stdout), r.stdout);

// the "never silently remove a file" rule: any file from earlier releases that goes missing is caught unless written down on purpose
function full() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rcf-')); fs.cpSync(ROOT, d, { recursive: true, filter: (s) => !/node_modules|\/Dashboard Hub|update-files|\/\.git(\/|$)/.test(s) }); return d; }
const d3 = full(); fs.rmSync(path.join(d3, 'scanner.js'));
r = spawnSync('node', [path.join(d3, 'tools/check-release.js')], { encoding: 'utf8' });
check('a file that vanishes (scanner.js) is caught, and the message explains what to do', r.status === 1 && /earlier releases is gone: scanner\.js/.test(r.stdout) && /removed-files\.txt/.test(r.stdout), r.stdout);
const d4 = full(); fs.rmSync(path.join(d4, 'test/uninstall-test.sh'));
r = spawnSync('node', [path.join(d4, 'tools/check-release.js')], { encoding: 'utf8' });
check('a vanished test file is caught too', r.status === 1 && /uninstall-test\.sh/.test(r.stdout), r.stdout);
fs.appendFileSync(path.join(d3, 'tools/removed-files.txt'), 'scanner.js  # test: removed on purpose\n');
r = spawnSync('node', [path.join(d3, 'tools/check-release.js')], { encoding: 'utf8' });
check('a file written down in removed-files.txt (with a reason) is accepted', r.status === 0, r.stdout);
const d5 = full(); fs.writeFileSync(path.join(d5, 'brand-new.js'), '// new');
r = spawnSync('node', [path.join(d5, 'tools/check-release.js')], { encoding: 'utf8' });
check('adding a new file is fine', r.status === 0, r.stdout);
check('the standing rules file says it', /Never silently remove a file/.test(rd('DEVELOPMENT-RULES.md')));

// make-update must refuse to build while something is missing
const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rcu-'));
fs.cpSync(ROOT, d2, { recursive: true, filter: (s) => !/node_modules|\/Dashboard Hub|update-files|\/\.git(\/|$)/.test(s) });
fs.rmSync(path.join(d2, 'UNINSTALL.sh'));
r = spawnSync('node', [path.join(d2, 'tools/make-update.js'), '--notes', 'x', '--out', path.join(d2, 'o')], { encoding: 'utf8' });
check('an update cannot be made while the uninstall script is missing', r.status === 1 && /release is not complete/.test(r.stderr + r.stdout), (r.stderr + r.stdout).slice(0, 200));

// the Windows script: structure checks (it cannot be run on Linux)
const bat = rd('UNINSTALL.bat'), lines = bat.split(/\r?\n/);
check('UNINSTALL.bat has Windows line endings', /\r\n/.test(bat) && !/[^\r]\n/.test(bat));
check('UNINSTALL.bat looks for the installer\'s uninstaller and starts it', /Uninstall Dashboard Hub\.exe/.test(bat) && /Programs\\Dashboard Hub/.test(bat) && /CurrentVersion\\Uninstall/.test(bat));
check('every delete in UNINSTALL.bat comes right after a question', lines.every((l, i) => !/rmdir|\bdel\b/i.test(l) || lines.slice(Math.max(0, i - 3), i + 1).some((x) => /choice \/c YN/.test(x))));
check('UNINSTALL.bat asks about your data separately and defaults to No', /choice \/c YN \/d N .*Delete your data/.test(bat) && /dashboard-hub\\?"/.test(bat));
check('UNINSTALL.bat never deletes the source folder itself', !/rmdir[^\n]*"%~dp0"/i.test(bat) && !/rmdir[^\n]*%~dp0["\r\n]/i.test(bat));
check('the README, the manual and both build scripts point to the uninstall scripts', /UNINSTALL\.bat/.test(rd('README.md')) && /UNINSTALL\.bat/.test(rd('manual.js')) && /UNINSTALL\.bat/.test(rd('BUILD-APP.bat')) && /UNINSTALL\.sh/.test(rd('BUILD-APP.sh')));
check('README.md and FEATURES.md are identical', rd('README.md') === rd('FEATURES.md'));
console.log(fail ? fail + ' failed' : 'All ' + pass + ' passed'); process.exit(fail ? 1 : 0);
