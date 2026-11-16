'use strict';
//   xvfb-run -a node test/pxe-disk-ui-test.js
// The disk and layout choices in the Network boot window: they save, come back after a restart, and bad names are refused.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pdu-'));
async function launch() {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1300, height: 1000 }); await page.waitForSelector('#tabMap');
  for (let i = 0; i < 20; i++) {   // the button only works once the window has finished loading its scripts
    await page.evaluate(() => { const d = document.getElementById('pxeDialog'); if (!d.open) document.getElementById('pxeMenuBtn').click(); });
    if (await page.evaluate(() => document.getElementById('pxeDialog').open)) break; await sleep(500);
  }
  await sleep(1200);
  await page.evaluate(() => { document.getElementById('pxeAuto').open = true; });
  return { app, page };
}
const fill = async (page, o) => {
  await page.fill('#pxeAnUser', 'admin'); await page.fill('#pxeAnPass', 'secret-pass-1'); await page.fill('#pxeAnHost', 'srv1'); await page.fill('#pxeAnTz', 'UTC'); await page.fill('#pxeAnKb', 'us');
  await page.selectOption('#pxeAnDisk', o.disk); if (o.name !== undefined) await page.fill('#pxeAnDiskName', o.name);
  await page.selectOption('#pxeAnLayout', o.layout); await page.click('#pxeAnSave'); await sleep(700);
};
(async () => {
  let { app, page } = await launch();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  check('the name box is hidden until "A disk I name" is chosen', await page.evaluate(() => document.getElementById('pxeAnDiskNameRow').classList.contains('hidden')));
  await page.selectOption('#pxeAnDisk', 'name');
  check('...and shows when it is chosen', !(await page.evaluate(() => document.getElementById('pxeAnDiskNameRow').classList.contains('hidden'))));
  await fill(page, { disk: 'name', name: 'sda; reboot', layout: 'simple' });
  let st = await page.evaluate(() => window.pxeApi ? window.pxeApi.status() : null);
  check('a bad disk name is refused and nothing is saved', !st || !st.answers, JSON.stringify(st && st.answers));
  check('the refusal is explained on screen', /disk name looks like/i.test(await page.evaluate(() => document.body.innerText)));
  await fill(page, { disk: 'name', name: 'nvme0n1', layout: 'simple' });
  st = await page.evaluate(() => window.pxeApi.status());
  check('a good disk name and the simple layout are saved', st.answers && st.answers.disk === 'nvme0n1' && st.answers.layout === 'simple', JSON.stringify(st.answers));
  await app.close(); await sleep(800);
  ({ app, page } = await launch());
  await sleep(1500); st = await page.evaluate(() => window.pxeApi.status());
  check('after closing and opening the app they are still saved', st.answers && st.answers.disk === 'nvme0n1' && st.answers.layout === 'simple', JSON.stringify(st.answers));
  await page.waitForFunction(() => document.getElementById('pxeAnDisk').value === 'name' && document.getElementById('pxeAnLayout').value === 'simple', null, { timeout: 15000 }).catch(() => {});
  check('the window shows them again', await page.evaluate(() => document.getElementById('pxeAnDisk').value === 'name' && document.getElementById('pxeAnDiskName').value === 'nvme0n1' && document.getElementById('pxeAnLayout').value === 'simple'));
  await fill(page, { disk: 'largest', layout: 'auto' });
  st = await page.evaluate(() => window.pxeApi.status());
  check('"only the largest disk" and automatic layout save too', st.answers && st.answers.disk === 'largest' && st.answers.layout === 'auto', JSON.stringify(st.answers));
  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await app.close();
  console.log(failed ? failed + ' failed' : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + e.message); process.exit(1); });
