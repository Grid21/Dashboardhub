'use strict';
//   xvfb-run -a node test/offline-lines-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ol-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} }));
    // a pretend scan that finds whatever the test says (global.__found) and then finishes
    ipcMain.removeHandler('net:scan');
    ipcMain.handle('net:scan', (e, o) => { setTimeout(() => { const w = BrowserWindow.getAllWindows()[0]; (global.__found || []).forEach((h) => w.webContents.send('net:event', { type: 'host', host: h })); w.webContents.send('net:event', { type: 'done' }); }, 150); return { ok: true, cidr: o.cidr }; });
  });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const D = 'aa:bb:cc:00:00:0d', E = 'aa:bb:cc:00:00:0e';
  const data = (links) => ({ router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true, showOffline: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true },
      [D]: { key: D, mac: D, ip: '10.7.0.40', label: 'old laptop', online: false, pos: { x: -7, y: 0, z: 5 } },
      [E]: { key: E, mac: E, ip: '10.7.0.41', label: 'phone', online: true, pos: { x: 7, y: 0, z: 5 } } }, links });
  const hasLink = (k) => page.evaluate((k) => window.hubNetmap.exportData().links.some((l) => l.a === k || l.b === k), k);
  await page.evaluate((d) => window.hubNetmap.importData(d, true), data([{ a: 'router', b: D, auto: true }, { a: 'router', b: E, auto: true }]));
  await sleep(700); await page.evaluate(() => window.__hubMap.sync()); await sleep(500);
  // delete the offline machine's line by clicking it and pressing Delete
  const id = await page.evaluate((k) => window.hubNetmap.exportData().links.map((l) => [l.a, l.b]).filter(([a, b]) => a === k || b === k)[0].sort().join('~'), D);
  const pt = await page.evaluate((i) => window.__hubMap.screenOfLink(i), id);
  await page.mouse.click(pt.x, pt.y); await sleep(400);
  await page.click('#mapSide button:has-text("Disconnect from router")'); // (selecting the machine's own pane, like you would) await sleep(400);
  check('the line is deleted', !(await hasLink(D)));
  // the router's list still names that old machine (wired, no proof it is there)
  const conn = (clients) => ({ ok: true, host: '10.7.0.1', type: 'asus', self: { name: 'router' }, clients, gear: [] });
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), conn([{ mac: D, ip: '10.7.0.40', name: 'old laptop', wireless: false }, { mac: E, ip: '10.7.0.41', name: 'phone', wireless: false }]));
  await sleep(400);
  check('a router check does NOT bring back the line of an offline machine', !(await hasLink(D)));
  check('and the machine is still offline', await page.evaluate((k) => window.hubNetmap.exportData().devices[k].online === false, D));
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), conn([{ mac: D, ip: '10.7.0.40', name: 'old laptop', wireless: false }]));
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), conn([{ mac: D, ip: '10.7.0.40', name: 'old laptop', wireless: false }]));
  check('...not after repeated checks either', !(await hasLink(D)));
  check('an online machine is unaffected (its line stays)', await hasLink(E));
  // a scan that does not find it: still no line
  await app.evaluate(() => { global.__found = [{ ip: '10.7.0.41', mac: 'aa:bb:cc:00:00:0e', hostname: 'phone', ports: [], os: { id: 'unknown', label: '', confidence: 'low', reasons: [] } }]; });
  await page.click('#mapScan'); await sleep(1500);
  check('a scan that does not find it keeps the line deleted', !(await hasLink(D)) && await page.evaluate((k) => window.hubNetmap.exportData().devices[k].online === false, D));
  // detected again by a scan: the line returns
  await app.evaluate(() => { global.__found = [{ ip: '10.7.0.40', mac: 'aa:bb:cc:00:00:0d', hostname: 'old laptop', ports: [], os: { id: 'unknown', label: '', confidence: 'low', reasons: [] } }, { ip: '10.7.0.41', mac: 'aa:bb:cc:00:00:0e', hostname: 'phone', ports: [], os: { id: 'unknown', label: '', confidence: 'low', reasons: [] } }]; });
  await page.click('#mapScan'); await sleep(1500);
  check('when a scan detects it again, it is online and its line is back', await hasLink(D) && await page.evaluate((k) => window.hubNetmap.exportData().devices[k].online === true, D));
  // wireless proof also brings it back
  await page.evaluate((d) => window.hubNetmap.importData(d, true), data([{ a: 'router', b: E, auto: true }]));
  await sleep(500);
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), conn([{ mac: D, ip: '10.7.0.40', name: 'old laptop', wireless: true, via: 'Wi-Fi' }]));
  await sleep(400);
  check('a router that says the machine is on Wi-Fi right now brings it back with a line', await hasLink(D) && await page.evaluate((k) => window.hubNetmap.exportData().devices[k].online === true, D));
  // connecting by hand always works
  await page.evaluate((d) => window.hubNetmap.importData(d, true), data([{ a: 'router', b: E, auto: true }, { a: 'router', b: D, cable: true }]));
  await sleep(300);
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), conn([{ mac: D, ip: '10.7.0.40', name: 'old laptop', wireless: false }]));
  check('a line you draw by hand stays, even for an offline machine', await hasLink(D));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
