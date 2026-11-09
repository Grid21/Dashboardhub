'use strict';
//   xvfb-run -a node test/grouplist-test.js
// 1) typing a group name is not wiped by map updates  2) group name shown under the device in the list  3) panels reload themselves
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'gl-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const A = 'aa:bb:cc:00:00:31', B = 'aa:bb:cc:00:00:32';
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [A]: { key: A, mac: A, ip: '10.7.0.31', label: 'alpha', online: true }, [B]: { key: B, mac: B, ip: '10.7.0.32', label: 'beta', online: true } }, links: [{ a: 'router', b: A, auto: true }, { a: 'router', b: B, auto: true }] });
  await sleep(500);
  await page.click('#mapListBtn'); await sleep(500);
  check('device list opens', await page.evaluate(() => !document.getElementById('mapList').classList.contains('closed')));
  await page.locator('#mapList .ml-row').first().locator('input[type=checkbox]').check(); await sleep(300);
  const gsel = '#mapBulkGroup';
  check('group name box is there', (await page.locator(gsel).count()) === 1);
  await page.click(gsel); await page.keyboard.type('Ser', { delay: 20 });
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.hubNetmap.refresh && window.hubNetmap.refresh()); await page.evaluate(() => window.__hubMap.sync()); await sleep(500); }
  await page.keyboard.type('vers', { delay: 20 });
  const st = await page.evaluate((s) => { const i = document.querySelector(s); return { v: i.value, f: document.activeElement === i }; }, gsel);
  check('typing in the group box survives map updates', st.v === 'Servers', st.v);
  check('and it keeps focus', st.f);
  await page.locator('#mapList button', { hasText: 'Set group' }).click(); await sleep(500);
  const tags = await page.evaluate(() => [...document.querySelectorAll('#mapList .ml-grouptag')].map((e) => e.textContent));
  check('the group name shows under the machine in the list', tags.length === 1 && tags[0] === 'Group: Servers', JSON.stringify(tags));
  const inRow = await page.evaluate(() => { const t = document.querySelector('#mapList .ml-grouptag'); return !!t && !!t.closest('.ml-row') && t.closest('.ml-row').textContent.includes('alpha'); });
  check('it is under the right machine', inRow);

  // panels
  const base = await page.evaluate(() => localStorage.getItem('hubPanelAutoReload'));
  check('auto reload is on by default', base === null && (await page.evaluate(() => window.hubPanelAutoReload())) === true);
  const srv = http.createServer((q, r) => { r.end('<title>up</title>hello'); });
  const port = await new Promise((ok) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  await page.click('#tabPanels').catch(() => {}); await sleep(300);
  await page.evaluate((p) => { state.panels = [{ id: 'pz', name: 'Late panel', url: 'http://127.0.0.1:' + p }]; saveState(); render(); }, port); await sleep(1500);
  const msg = () => page.evaluate(() => (document.querySelector('#grid .panel .status, #grid .panel [class*=status]') || {}).textContent || '');
  const m1 = await msg();
  check('a failing panel says it will try again by itself', /trying again/.test(m1), m1);
  await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));
  let gone = false; for (let i = 0; i < 12 && !gone; i++) { await sleep(1000); gone = !/trying again|Could not/.test(await msg()); }
  check('when the server comes back, the panel loads by itself', gone, await msg());
  srv.close();

  // switched off
  await page.evaluate(() => { const c = document.getElementById('panelAutoCheck'); c.checked = false; c.dispatchEvent(new Event('change')); });
  check('the setting is saved as off', (await page.evaluate(() => localStorage.getItem('hubPanelAutoReload'))) === 'off');
  const port2 = await new Promise((ok) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  await page.evaluate((p) => { state.panels = [{ id: 'py', name: 'Off panel', url: 'http://127.0.0.1:' + p }]; saveState(); render(); }, port2); await sleep(2000);
  const m2 = await msg();
  check('with it off, the panel asks you to press reload', /press reload/.test(m2) && !/trying again/.test(m2), m2);
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
