const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..'); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'grs-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => { setTimeout(() => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', { type: 'done' }); } catch (e) {} }, 100); return { ok: true }; }); });
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:04:'; const devices = { router: { key: 'router', ip: '10.8.0.1', isRouter: true, online: true } }; const links = [];
  for (let i = 1; i <= 8; i++) { const k = M + '0' + i; devices[k] = { key: k, mac: k, ip: '10.8.0.' + (20 + i), label: 'iot' + i, online: true, lastSeen: Date.now(), os: { id: 'linux', label: 'l', confidence: 'high', reasons: [] }, pos: { x: 6 + (i % 4) * 3, y: 0, z: 6 + Math.floor(i / 4) * 3 } }; links.push({ a: 'router', b: k, auto: false }); }
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true, showOffline: true, devices, links });
  await sleep(1500);
  // group them the way a user does: through the list
  const open = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /machine list|devices/i.test(x.textContent)); return b ? b.textContent : null; });
  console.log('list button:', open);
  await page.click('text=☰ Devices'); await sleep(500);
  await page.screenshot({ path: process.argv[2] + '/list.png' });
  const chk = page.locator('.ml-row input[type=checkbox]'); const n = await chk.count(); console.log('rows', n);
  for (let i = 0; i < n; i++) await chk.nth(i).check();
  await page.fill('#mapBulkGroup', 'IoT'); await page.click('text=Set group'); await sleep(1200);
  await page.evaluate(() => document.getElementById('mapBulkUngroup').scrollIntoView({ block: 'center' })); await sleep(300); await page.screenshot({ path: process.argv[2] + '/bulk.png', clip: { x: 0, y: 220, width: 330, height: 680 } }); await page.evaluate(() => { const e = window.hubNetmap.exportData(); const ks = Object.keys(e.devices).filter((k) => k !== 'router'); ks.slice(0, 2).forEach((k, i) => { e.devices[k].group = 'Small'; e.devices[k].pos = { x: -25 + i * 3, y: 0, z: 10 }; }); window.hubNetmap.importData(e, true); }); await sleep(800); await page.screenshot({ path: process.argv[2] + '/after.png' }); await page.evaluate(() => document.getElementById('mapTop').click()); await sleep(1500); await page.screenshot({ path: process.argv[2] + '/after-top.png', clip: { x: 320, y: 220, width: 740, height: 680 } });
  console.log(JSON.stringify(await page.evaluate(() => window.__hubMap.groups())));
  await app.close();
})();
