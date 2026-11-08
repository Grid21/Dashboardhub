'use strict';
//   xvfb-run -a node test/layout-shift-test.js
// The 3D map must not change size when small things appear in the toolbar (each change rebuilds the whole picture).
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => { global.__send = (m) => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', m); } catch (e) {} }; ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => ({ ok: true })); });
  await page.click('#tabMap'); await sleep(700);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(500);
  const resizes = () => page.evaluate(() => window.__sizes.slice());
  await page.evaluate(() => { window.__sizes = []; let first = true; new ResizeObserver((e) => { if (first) { first = false; return; } window.__sizes.push(Math.round(e[0].contentRect.width) + 'x' + Math.round(e[0].contentRect.height)); }).observe(document.getElementById('mapWrap')); });
  await sleep(300);

  await page.click('#mapScan'); await sleep(400);
  await app.evaluate(async () => { for (let i = 2; i <= 20; i++) { global.__send({ type: 'host', host: { ip: '10.8.0.' + i, mac: 'aa:bb:cc:02:00:' + i.toString(16).padStart(2, '0'), hostname: 'h' + i, online: true, ports: [], ttl: 64, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } } }); } });
  await sleep(600);
  check('starting a scan does not change the size of the map', (await resizes()).length === 0, JSON.stringify(await resizes()));
  await app.evaluate(() => global.__send({ type: 'done', count: 19 })); await sleep(900);
  check('finishing a scan does not change the size of the map', (await resizes()).length === 0, JSON.stringify(await resizes()));

  await page.evaluate(() => { const t = document.getElementById('mapLiveText'); t.textContent = 'checked 10:19:47 PM'; }); await sleep(500);
  check('the "checked 10:19:47 PM" label appearing does not change the size of the map', (await resizes()).length === 0, JSON.stringify(await resizes()));
  await page.evaluate(() => { document.getElementById('mapLiveText').textContent = ''; }); await sleep(500);
  check('...nor does it disappearing', (await resizes()).length === 0, JSON.stringify(await resizes()));

  const key = await page.evaluate(() => Object.keys(window.hubNetmap.exportData().devices).find((k) => k !== 'router'));
  const sc = await page.evaluate((k) => window.__hubMap.screenOf(k), key);
  await page.mouse.move(sc.x, sc.y); await page.mouse.down(); for (let i = 0; i < 10; i++) await page.mouse.move(sc.x + i * 3, sc.y + i); await page.mouse.up(); await sleep(500);
  check('grabbing and dragging a machine does not change the size of the map', (await resizes()).length === 0, JSON.stringify(await resizes()));

  // the picture must still follow a real change of the window size
  await page.setViewportSize({ width: 1150, height: 780 }); await sleep(1500);
  const after = await page.evaluate(() => ({ canvasW: document.querySelector('#mapWrap canvas').width, wrapW: document.getElementById('mapWrap').clientWidth, glW: window.__hubMap.glInfo().width }));
  check('a real window resize still resizes the picture', (await resizes()).length >= 1 && Math.abs(after.glW - after.wrapW) <= 2, JSON.stringify(after) + ' ' + JSON.stringify(await resizes()));
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); await app.close(); process.exit(failed ? 1 : 0);
})();
