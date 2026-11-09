'use strict';
//   xvfb-run -a node test/mapbar-test.js
// The map toolbar must look the same before the first scan and after it.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'))] });
  const page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => { global.__send = (m) => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', m); } catch (e) {} }; ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => ({ ok: true })); });
  const pos = () => page.evaluate(() => ['mapBwBtn', 'mapIface', 'mapRouter', 'mapScan', 'mapLive', 'mapAlerts', 'mapMenuBtn', 'mapOffline', 'mapGroupMove', 'mapServices'].map((i) => { const r = document.getElementById(i).getBoundingClientRect(); return i + ':' + Math.round(r.left) + ',' + Math.round(r.top); }).join(' '));
  for (const w of [1900, 1600, 1400, 1100]) {
    await page.setViewportSize({ width: w, height: 900 }); await page.click('#tabMap'); await sleep(500);
    await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(300);
    const before = await pos();
    await page.click('#mapScan'); await sleep(300);
    await app.evaluate(() => { global.__send({ type: 'host', host: { ip: '10.8.0.5', mac: 'aa:bb:cc:02:00:05', hostname: 'h', online: true, ports: [], ttl: 64, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } } }); global.__send({ type: 'done', count: 39 }); });
    await sleep(1200);
    const txt = await page.textContent('#mapStatus');
    const after = await pos();
    check(w + 'px wide: toolbar looks the same before and after the first scan (' + txt.trim() + ')', before === after, before + '  =>  ' + after);
  }
  // Live update and Alerts sit side by side on the first row, the map controls start the second row
  await page.setViewportSize({ width: 1914, height: 900 }); await page.click('#tabMap'); await sleep(500);
  const g = await page.evaluate(() => { const r = (i) => document.getElementById(i).getBoundingClientRect(); return { lt: r('mapLive').top, at: r('mapAlerts').top, ar: r('mapAlerts').left - r('mapLive').right, mt: r('mapMenuBtn').top, ml: r('mapMenuBtn').left, st: r('mapScan').top }; });
  check('Live update and Alerts are next to each other on the first row', Math.abs(g.lt - g.at) < 4 && Math.abs(g.lt - g.st) < 12 && g.ar < 80, JSON.stringify(g));
  check('Map layout and hardware starts the second row, at the left', g.mt > g.at + 20 && g.ml < 40, JSON.stringify(g));
  check('the checkboxes follow it on the same row', await page.evaluate(() => Math.abs(document.getElementById('mapOffline').getBoundingClientRect().top - document.getElementById('mapMenuBtn').getBoundingClientRect().top) < 14));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
