'use strict';
//   xvfb-run -a node test/updater-ui-test.js
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // a real update file (labelled 9.9.9) made from the current program
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-out-'));
  spawnSync('node', ['tools/make-update.js', '--notes', 'Test notes', '--out', out], { cwd: ROOT, stdio: 'ignore' });
  fs.rmSync(path.join(ROOT, 'update-files'), { recursive: true, force: true });
  const built = fs.readdirSync(out).find((f) => f.endsWith('.hubupdate'));
  const bundle = JSON.parse(fs.readFileSync(path.join(out, built), 'utf8')); bundle.version = '9.9.9'; bundle.notes = 'Nine point nine';
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-ud-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [path.join(ROOT, 'test/upd-harness.js'), '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  const vis = (id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
  const txt = (id) => page.evaluate((i) => document.getElementById(i).textContent, id);

  // ---- 0. as shipped: the project's repository is set, but nothing is contacted until you say yes ----
  await sleep(800);
  const st0 = await page.evaluate(() => window.updaterApi.status());
  check('as shipped: the repository is set and checking is not switched on yet', st0.ok && st0.configured === true && st0.enabled !== true, JSON.stringify(st0));

  // ---- pretend GitHub is configured and has 9.9.9 ----
  await app.evaluate(({ ipcMain, app }) => {
    global.__calls = []; 
    const rec = (n, f) => { ipcMain.removeHandler(n); ipcMain.handle(n, async (e, ...a) => { global.__calls.push([n, ...a]); return f(...a); }); };
    global.__asked = false; global.__enabled = false;
    rec('updater:status', () => ({ ok: true, configured: true, asked: global.__asked, enabled: global.__enabled, current: '1.10.54' }));
    rec('updater:setEnabled', (on) => { global.__asked = true; global.__enabled = on; return { ok: true }; });
    rec('updater:check', (manual) => ({ ok: true, available: true, offer: true, current: '1.10.54', latest: '9.9.9', notes: 'Nine point nine', assetName: 'Dashboard-Hub-update-9.9.9.hubupdate', page: 'https://github.com/x/y/releases' }));
    rec('updater:skip', () => ({ ok: true }));
    rec('updater:snooze', () => ({ ok: true }));
    rec('updater:download', () => {
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
      const dir = path.join(app.getPath('userData'), 'downloads'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Dashboard-Hub-update-9.9.9.hubupdate'), global.__bundleText);
      return { ok: true, name: 'Dashboard-Hub-update-9.9.9.hubupdate', version: '9.9.9' };
    });
  });
  await app.evaluate((_, t) => { global.__bundleText = t; }, JSON.stringify(bundle));
  const calls = () => app.evaluate(() => global.__calls.map((c) => c.join(':')));

  // ---- 1. first launch: ask ----
  await page.reload(); await page.waitForSelector('#tabMap'); await sleep(900);
  check('first launch asks once, with Yes / No', (await vis('updateBanner')) && (await vis('ubYes')) && (await vis('ubNo')) && /automatically/i.test(await txt('ubTitle')));
  check('the question says nothing is installed without a click', /never installs/i.test(await txt('ubSub')));
  await page.click('#ubNo'); await sleep(200);
  check('"No thanks" hides it and saves "off"', !(await vis('updateBanner')) && (await app.evaluate(() => global.__enabled === false && global.__asked === true)));
  await page.reload(); await page.waitForSelector('#tabMap'); await sleep(900);
  check('after answering, it is not asked again', !(await vis('updateBanner')));
  check('and with checking off, nothing is checked by itself', !(await calls()).some((c) => c.startsWith('updater:check')));

  // ---- 2. manual check from Settings ----
  await page.evaluate(() => { document.getElementById('updCheckNow').click(); }); await sleep(500);
  check('"Check for updates now" shows the offer even though checking is off', (await vis('updateBanner')) && /9\.9\.9 is available/.test(await txt('ubTitle')));
  check('offer has Install now / Remind me later / Skip this version', (await vis('ubInstall')) && (await vis('ubLater')) && (await vis('ubSkip')));
  check('"What\'s new" notes are there', (await vis('ubNotes')) && /Nine point nine/.test(await txt('ubNotesText')));
  await page.click('#ubLater'); await sleep(200);
  check('"Remind me later" hides it and tells the app to hold it back', !(await vis('updateBanner')) && (await calls()).includes('updater:snooze'));
  await page.evaluate(() => { document.getElementById('updCheckNow').click(); }); await sleep(500);
  await page.click('#ubSkip'); await sleep(200);
  check('"Skip this version" hides it and records that exact version', !(await vis('updateBanner')) && (await calls()).includes('updater:skip:9.9.9'));

  // ---- 3. automatic checking turned on in Settings ----
  await page.evaluate(() => { const c = document.getElementById('updAuto'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(600);
  check('ticking "check automatically" saves it and checks right away', (await app.evaluate(() => global.__enabled === true)) && (await vis('updateBanner')));

  // ---- 4. Install now: download, then the starter installs after you confirm ----
  await app.evaluate(() => { global.__confirm = 1; global.__boxes = []; });                      // answer "Cancel" first
  await page.click('#ubInstall'); await sleep(1500);
  const boxes1 = await app.evaluate(() => global.__boxes.map((b) => b.message + ' | ' + b.detail));
  check('Install now shows the version and notes and asks you to confirm', boxes1.length === 1 && /9\.9\.9/.test(boxes1[0]) && /Nine point nine/.test(boxes1[0]), boxes1.join());
  check('cancelling installs nothing and keeps the choices', /not installed/i.test(await txt('ubTitle')) && !fs.existsSync(path.join(ud, 'updates', 'active.json')));
  await app.evaluate(() => { global.__confirm = 0; });                                              // now confirm
  await page.click('#ubInstall'); await sleep(2000);
  const ptr = fs.existsSync(path.join(ud, 'updates', 'active.json')) ? JSON.parse(fs.readFileSync(path.join(ud, 'updates', 'active.json'), 'utf8')) : null;
  check('confirming installs the update', ptr && ptr.version === '9.9.9' && !ptr.disabled, JSON.stringify(ptr));
  check('the bar offers "Restart now"', (await vis('ubRestart')) && /9\.9\.9 is installed/.test(await txt('ubTitle')));
  check('the downloaded file is tidied away', !fs.existsSync(path.join(ud, 'downloads', 'Dashboard-Hub-update-9.9.9.hubupdate')));

  // ---- 5. the starter refuses anything but a plain downloaded file name ----
  const bad = await page.evaluate(async () => [await window.updateApi.installFile('../../etc/passwd'), await window.updateApi.installFile('x.hubupdate'), await window.updateApi.installFile('a/b.hubupdate'), await window.updateApi.installFile(42)]);
  check('paths, missing files and odd values are refused', bad.every((r) => r.ok === false), JSON.stringify(bad));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
