'use strict';
//   xvfb-run -a node test/printer-test.js
const path = require('path'), fs = require('fs'), os = require('os'), { spawn, spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'pru-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); }); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const E = 'aa:bb:cc:00:00:30';
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [E]: { key: E, mac: E, ip: '10.7.0.30', label: 'box', online: true } }, links: [{ a: 'router', b: E, auto: true }] });
  await sleep(500);
  await page.evaluate(() => window.__hubMap.sync()); await page.click('#mapTidy'); await sleep(1200); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  const p = await page.evaluate((k) => window.__hubMap.screenOf(k), E); await page.mouse.click(p.x, p.y); await sleep(500);
  const sel = '#mapSide input[type=text]';
  check('device pane has a text box', await page.locator(sel).count() > 0);
  await page.click(sel); await page.keyboard.type('hello', { delay: 20 });
  const mark = await page.evaluate((s) => { const i = document.querySelector(s); i.dataset.mark = 'same'; return i.value; }, sel);
  // live updates arrive while typing
  for (let i = 0; i < 3; i++) {
    await page.evaluate((E) => window.hubNetmap.applyConnector({ ok: true, host: '10.7.0.30', type: 'snmp', self: { name: 'box', kind: 'printer', brand: 'Epson', portTable: [{ name: 'eth0', up: true, speed: 100 }] }, clients: [], gear: [] }), E);
    await page.evaluate(() => window.hubNetmap.refresh && window.hubNetmap.refresh());
    await sleep(700);
  }
  await page.keyboard.type(' world', { delay: 20 });
  const after = await page.evaluate((s) => { const i = document.querySelector(s); return { v: i && i.value, same: i && i.dataset.mark === 'same', focus: document.activeElement === i }; }, sel);
  check('the box you were typing in was not rebuilt', after.same, JSON.stringify(after));
  check('it kept focus', after.focus, JSON.stringify(after));
  check('everything typed is still there', after.v === 'boxhello world', after.v + ' (before: ' + mark + ')');
  // leaving the box lets the waiting redraw happen, and keeps what you typed
  await page.click('#mapTitle, #mapHint, body', { position: { x: 5, y: 5 }, force: true }).catch(() => {}); await sleep(1500);
  const lab = await page.evaluate((E) => window.hubNetmap.exportData().devices[E].label, E);
  check('what you typed was saved', lab === 'boxhello world', lab);
  // your own clicks still redraw at once
  const p2 = await page.evaluate((k) => window.__hubMap.screenOf(k), E); await page.mouse.click(p2.x, p2.y); await sleep(400);
  await page.selectOption('#mapTypeSel', 'switch'); await sleep(300);
  const t = await page.evaluate((E) => window.hubNetmap.exportData().devices[E].osOverride, E);
  check('choosing from a menu still works instantly', t === 'switch', t);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
