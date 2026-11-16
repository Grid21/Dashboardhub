'use strict';
//   xvfb-run -a node test/pxe-sb-ui-test.js
// The "Secure Boot computers" part of the Network boot window: before the download the box cannot be ticked, after it can, and the
// choice is remembered after a restart. (The signed files are put in place by the test; the real download and the real boot with
// Secure Boot ON are in test/secureboot-vm-test.js.)
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sbu-'));
async function launch() {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1300, height: 1000 }); await page.waitForSelector('#tabMap');
  for (let i = 0; i < 20; i++) {   // the button only works once the window has finished loading its scripts
    await page.evaluate(() => { const d = document.getElementById('pxeDialog'); if (!d.open) document.getElementById('pxeMenuBtn').click(); });
    if (await page.evaluate(() => document.getElementById('pxeDialog').open)) break; await sleep(500);
  }
  await sleep(1200);
  await page.evaluate(() => { document.getElementById('pxeSb').open = true; });
  return { app, page };
}
(async () => {
  let { app, page } = await launch();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  check('before the download the box cannot be ticked', await page.evaluate(() => document.getElementById('pxeSbOn').disabled === true));
  check('...and the window says nothing was downloaded', /Not downloaded yet/.test(await page.textContent('#pxeSbInfo')));
  check('the download button is there', await page.locator('#pxeSbGet').count() === 1);
  const r0 = await page.evaluate(() => window.pxeApi.sbSet(true));
  check('switching it on without the files is refused', r0.ok === false && /files first/i.test(r0.error || ''), JSON.stringify(r0));
  await app.close(); await sleep(800);
  // the signed files, as the download would have left them
  const sbd = path.join(ud, 'secureboot'); fs.mkdirSync(sbd, { recursive: true });
  const fake = (n) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(n, 7)]);
  fs.writeFileSync(path.join(sbd, 'shimx64.efi'), fake(200000)); fs.writeFileSync(path.join(sbd, 'grubx64.efi'), fake(300000));
  fs.writeFileSync(path.join(sbd, 'info.json'), JSON.stringify({ from: 'Ubuntu archive', shim: '1.58+15.8', grub: '1.202.5+2.12', at: '2026-11-15' }));
  ({ app, page } = await launch());
  await page.waitForFunction(() => document.getElementById('pxeSbOn').disabled === false, null, { timeout: 15000 }).catch(() => {});
  check('with the files in place the box can be ticked', await page.evaluate(() => document.getElementById('pxeSbOn').disabled === false));
  check('the window shows the versions', /shim 1\.58\+15\.8/.test(await page.textContent('#pxeSbInfo')), await page.textContent('#pxeSbInfo'));
  await page.check('#pxeSbOn'); await sleep(800);
  let st = await page.evaluate(() => window.pxeApi.status());
  check('ticking it switches Secure Boot on', st.secureBoot && st.secureBoot.on === true && st.secureBoot.ready === true, JSON.stringify(st.secureBoot));
  await app.close(); await sleep(800);
  ({ app, page } = await launch()); await sleep(800);
  st = await page.evaluate(() => window.pxeApi.status());
  await page.waitForFunction(() => document.getElementById('pxeSbOn').checked === true, null, { timeout: 15000 }).catch(() => {});
  check('after closing and opening the app it is still on', st.secureBoot.on === true && await page.evaluate(() => document.getElementById('pxeSbOn').checked === true), JSON.stringify(st.secureBoot));
  await page.uncheck('#pxeSbOn'); await sleep(800);
  st = await page.evaluate(() => window.pxeApi.status());
  check('unticking it switches it off', st.secureBoot.on === false, JSON.stringify(st.secureBoot));
  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await app.close();
  console.log(failed ? failed + ' failed' : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + e.message); process.exit(1); });
