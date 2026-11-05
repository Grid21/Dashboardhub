'use strict';
//   xvfb-run -a node test/filter-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ft-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const m = (n) => 'aa:bb:cc:00:00:' + n;
  const SW = m('10'), SW2 = m('11'), AP = m('12'), WIN = m('01'), WIN2 = m('02'), LIN = m('03'), LIN2 = m('04');
  const dev = (k, ip, osId, extra) => Object.assign({ key: k, mac: k, ip, label: k.slice(-2), online: true, osOverride: osId }, extra || {});
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true },
      [SW]: dev(SW, '10.7.0.10', 'switch', { online: false }), [SW2]: dev(SW2, '10.7.0.11', 'switch'), [AP]: dev(AP, '10.7.0.12', 'network'),
      [WIN]: dev(WIN, '10.7.0.2', 'windows'), [WIN2]: dev(WIN2, '10.7.0.5', 'windows'), [LIN]: dev(LIN, '10.7.0.3', 'linux'), [LIN2]: dev(LIN2, '10.7.0.4', 'linux') },
    links: [
      { a: 'router', b: SW, auto: true }, { a: SW, b: SW2, auto: true }, { a: SW2, b: WIN, auto: true },
      { a: 'router', b: WIN, auto: true },                    // the app also guessed a direct line to the router (cheaper than going through the switches)
      { a: 'router', b: AP, auto: true }, { a: AP, b: WIN2, auto: true },
      { a: SW, b: LIN, auto: true }, { a: 'router', b: LIN2, auto: true }] });
  await sleep(800); await page.evaluate(() => window.__hubMap.sync()); await sleep(900);
  const shown = (k) => page.evaluate((k) => window.__hubMap.isShown(k), k);
  check('before filtering, the online machines are shown', await shown(WIN) && await shown(LIN) && await shown(SW2));
  // tick "Windows" in the colour key
  await page.evaluate(() => { const cb = document.querySelector('#mapLegend [data-type="windows"] input'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(1500);
  check('filter on: the Windows machines stay', await shown(WIN) && await shown(WIN2));
  check('filter on: Linux machines are hidden', !(await shown(LIN)) && !(await shown(LIN2)));
  check('filter on: the router stays', await shown('router'));
  check('filter on: the switch in the path stays (even though a direct router line exists)', await shown(SW2));
  check('filter on: an OFFLINE switch stays too', await shown(SW));
  check('filter on: the access point / network gear stays', await shown(AP));
  check('filter on: the lines between the switches and the router stay', await page.evaluate(([a, b]) => window.__hubMap.linkShown('router', a) && window.__hubMap.linkShown(a, b), [SW, SW2]));
  // other kind
  await page.evaluate(() => { const w = document.querySelector('#mapLegend [data-type="windows"] input'); w.checked = false; w.dispatchEvent(new Event('change', { bubbles: true })); const l = document.querySelector('#mapLegend [data-type="linux"] input'); l.checked = true; l.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(1500);
  check('Linux filter: switches and gear stay, Windows hidden', await shown(SW) && await shown(SW2) && await shown(AP) && await shown(LIN) && !(await shown(WIN)) && !(await shown(WIN2)));
  // back to everything
  await page.evaluate(() => { const l = document.querySelector('#mapLegend [data-type="linux"] input'); l.checked = false; l.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(1500);
  check('filter off: everything online is shown again; the offline switch is hidden again as before', await shown(WIN) && await shown(LIN) && await shown(AP) && !(await shown(SW)));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
