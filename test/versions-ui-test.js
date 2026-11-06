'use strict';
//   xvfb-run -a node test/versions-ui-test.js     (the Updates window, with the real starter program)
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// real, complete copies of the app under other version numbers (so the starter would accept them)
const FILES = ['app-main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'];
function makeVersion(upd, v) {
  const dir = path.join(upd, 'v' + v); fs.mkdirSync(dir, { recursive: true }); const files = {};
  const all = fs.readdirSync(ROOT).filter((f) => /\.(js|html|css)$/.test(f) && !['main.js', 'package.json'].includes(f));
  all.forEach((f) => { const b = fs.readFileSync(path.join(ROOT, f)); fs.writeFileSync(path.join(dir, f), b); files[f] = sha(b); });
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  fs.readdirSync(path.join(ROOT, 'vendor')).filter((f) => /\.(js|json)$/.test(f)).forEach((f) => { const b = fs.readFileSync(path.join(ROOT, 'vendor', f)); fs.writeFileSync(path.join(dir, 'vendor', f), b); files['vendor/' + f] = sha(b); });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: v, installedAt: '2026-11-0' + (Number(v.split('.')[2]) % 9 + 1) + 'T10:00:00Z', files }));
}
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'vu-')); const upd = path.join(ud, 'updates');
  ['1.11.62', '1.11.63', '1.11.64', '1.11.65', '1.11.66', '1.11.67'].forEach((v) => makeVersion(upd, v));
  fs.writeFileSync(path.join(upd, 'active.json'), JSON.stringify({ dir: 'v1.11.67', version: '1.11.67', attempts: 0, disabled: false, history: [{ dir: 'v1.11.66', version: '1.11.66' }, { dir: 'v1.11.67', version: '1.11.67' }] }));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [path.join(ROOT, 'test/upd-harness.js'), '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForSelector('#tabMap'); await sleep(1500);
  const info = await page.evaluate(() => window.updateApi.info());
  check('the app is running from the installed update 1.11.67', info.version === '1.11.67' && info.source === 'update', JSON.stringify(info).slice(0, 200));
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('#updatesBtn'); await sleep(900);
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('#updVersions li')).map((li) => li.innerText.replace(/\s+/g, ' ')));
  check('the Updates window lists the last 4 earlier versions, newest first', items.length === 4 && /1\.11\.66/.test(items[0]) && /1\.11\.63/.test(items[3]), JSON.stringify(items));
  check('each has a "Go back to this version" button', await page.evaluate(() => Array.from(document.querySelectorAll('#updVersions button')).every((b) => /Go back to this version/.test(b.textContent))));
  check('the running version is not in the list', !items.some((t) => /1\.11\.67/.test(t)));
  check('the list fits in the window', await page.evaluate(() => { const d = document.getElementById('updateDialog').getBoundingClientRect(); return d.top >= 0 && d.bottom <= innerHeight; }));
  check('copies were made in the archive folder', fs.readdirSync(path.join(ud, 'version-archive')).filter((n) => /^v\d/.test(n)).length === 5);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ver-shot.png') });
  // go back to 1.11.64
  await page.click('#updVersions li:nth-child(3) button'); await sleep(1200);
  const ptr = JSON.parse(fs.readFileSync(path.join(upd, 'active.json'), 'utf8'));
  check('"Go back to this version" points the starter at that version', ptr.version === '1.11.64' && ptr.dir === 'v1.11.64' && ptr.disabled === false, JSON.stringify(ptr));
  check('the window says to restart and offers "Restart now"', /Restart Dashboard Hub now to use version 1\.11\.64/.test(await page.textContent('#updateMsg')) && await page.evaluate(() => !document.getElementById('updateRestart').classList.contains('hidden')));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await app.close();

  // restart: the starter really runs the chosen version
  const app2 = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [path.join(ROOT, 'test/upd-harness.js'), '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const p2 = await app2.firstWindow(); await p2.waitForSelector('#tabMap'); await sleep(1500);
  const i2 = await p2.evaluate(() => window.updateApi.info());
  check('after a restart the app runs version 1.11.64', i2.version === '1.11.64' && i2.source === 'update', JSON.stringify(i2).slice(0, 200));
  await p2.click('#updatesBtn'); await sleep(900);
  const items2 = await p2.evaluate(() => Array.from(document.querySelectorAll('#updVersions li')).map((li) => li.innerText.replace(/\s+/g, ' ')));
  check('and the newer versions are still there to go forward to', items2.some((t) => /1\.11\.67/.test(t)) && !items2.some((t) => /1\.11\.64/.test(t)), JSON.stringify(items2));
  await app2.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
