'use strict';
//   UPD_OLD=<old source zip> UPD_A=<update 1> UPD_B=<update 2> xvfb-run -a node test/update-e2e-test.js
// The REAL path an owner takes: an already-installed older program (with the old 40-file starter) is started, the update file is
// installed through the program's own "Install update" step, the program is closed and started again, and must come up as the new version.
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OLD = process.env.UPD_OLD, A = process.env.UPD_A, B = process.env.UPD_B;
if (!OLD || !A || !B) { console.log('Set UPD_OLD, UPD_A and UPD_B.'); process.exit(2); }
const verOf = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-'));
const inst = path.join(work, 'installed');
fs.mkdirSync(inst);
spawnSync('unzip', ['-q', OLD, '-d', inst], { stdio: 'ignore' });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(inst, 'node_modules'));
// the programs people already have were built with the old limit of 40 files
const mainJs = fs.readFileSync(path.join(inst, 'main.js'), 'utf8');
fs.writeFileSync(path.join(inst, 'main.js'), mainJs.replace(/const MAX_FILES = \d+;/, 'const MAX_FILES = 40;'));
const ud = path.join(work, 'data'); fs.mkdirSync(ud);
const oldVersion = JSON.parse(fs.readFileSync(path.join(inst, 'package.json'), 'utf8')).version;

async function launch() {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [inst, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.waitForSelector('#tabMap', { timeout: 40000 });
  return { app, page };
}
async function install(app, page, file) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, file);
  return page.evaluate(() => window.updateApi.install());
}
(async () => {
  console.log('installed program: ' + oldVersion + ', update files: ' + verOf(A) + ' then ' + verOf(B));
  let { app, page } = await launch();
  let info = await page.evaluate(() => window.updateApi.info());
  check('the installed older program starts as ' + oldVersion, info.ok && info.version === oldVersion && info.source !== 'update', JSON.stringify(info).slice(0, 200));

  // negative control: too many files must be refused with the 1.18.0 message (proves this test can catch that mistake)
  const big = JSON.parse(fs.readFileSync(B, 'utf8')); for (let i = 0; i < 6; i++) big.files['zz-extra' + i + '.js'] = big.files[Object.keys(big.files)[0]];
  const bigFile = path.join(work, 'big.hubupdate'); fs.writeFileSync(bigFile, JSON.stringify(big));
  const rBig = await install(app, page, bigFile);
  check('control: an update with more files than the old limit is refused (this is what broke 1.18.0)', rBig.ok === false && /unexpected number of files/.test(rBig.error || ''), JSON.stringify(rBig).slice(0, 200));

  const r1 = await install(app, page, A);
  check('the first update installs through the real "Install update" step', r1.ok === true && r1.version === verOf(A), JSON.stringify(r1).slice(0, 200));
  await app.close(); await sleep(800);
  ({ app, page } = await launch());
  info = await page.evaluate(() => window.updateApi.info());
  check('after closing and opening again it runs the first update (' + verOf(A) + ', from the update)', info.version === verOf(A) && info.source === 'update', JSON.stringify(info).slice(0, 200));
  await page.evaluate(() => window.updateApi.ready());

  const r2 = await install(app, page, B);
  check('the second update installs on top of the first', r2.ok === true && r2.version === verOf(B), JSON.stringify(r2).slice(0, 200));
  await app.close(); await sleep(800);
  ({ app, page } = await launch());
  info = await page.evaluate(() => window.updateApi.info());
  check('it now runs the second update (' + verOf(B) + ')', info.version === verOf(B) && info.source === 'update', JSON.stringify(info).slice(0, 200));
  await page.evaluate(() => window.updateApi.ready());
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  await page.click('#tabMap'); await sleep(600);
  check('the updated program really works (map tab, scan button, alert types button)', await page.locator('#mapScan').count() === 1 && await page.locator('#mapAlertTypes').count() === 1);
  // every file of the update on disk matches what was shipped
  const dirs = fs.readdirSync(path.join(ud, 'updates')).filter((d) => fs.statSync(path.join(ud, 'updates', d)).isDirectory());
  const bundle = JSON.parse(fs.readFileSync(B, 'utf8'));
  const newest = dirs.map((d) => path.join(ud, 'updates', d)).find((d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')).version === verOf(B); } catch (e) { return false; } });
  const missing = newest ? Object.keys(bundle.files).filter((n) => !fs.existsSync(path.join(newest, n))) : ['(update folder not found)'];
  check('every file of the update is on disk', missing.length === 0, JSON.stringify(missing.slice(0, 5)));

  const back = await page.evaluate(() => window.updateApi.revert('previous'));
  check('"go back to the previous version" works', back.ok === true && back.version === verOf(A), JSON.stringify(back).slice(0, 200));
  const log = (() => { try { return fs.readFileSync(path.join(ud, 'error-log.txt'), 'utf8'); } catch (e) { return ''; } })();
  check('no page errors and nothing in the error log', errors.length === 0 && log === '', JSON.stringify({ errors, log: log.slice(0, 200) }));
  await app.close();
  console.log(failed ? failed + ' failed' : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + e.message); process.exit(1); });
