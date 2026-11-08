const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..'); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => { setTimeout(() => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', { type: 'done' }); } catch (e) {} }, 100); return { ok: true }; }); });
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(400);
  const N = 120, G = 6;
  await page.evaluate(([N, G]) => { const devices = { router: { key: 'router', ip: '10.8.0.1', isRouter: true, online: true } }; const links = [];
    for (let i = 1; i <= N; i++) { const k = 'aa:bb:cc:00:05:' + i; devices[k] = { key: k, mac: k, ip: '10.8.0.' + (10 + (i % 240)), label: 'dev' + i, online: true, lastSeen: Date.now(), group: 'G' + (i % G), os: { id: 'linux', label: 'l', confidence: 'high', reasons: [] }, pos: { x: -60 + (i % 20) * 6, y: 0, z: -30 + Math.floor(i / 20) * 10 } }; links.push({ a: 'router', b: k, auto: false }); }
    window.hubNetmap.importData({ router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true, showOffline: true, devices, links }, true); }, [N, G]);
  await sleep(2500);
  const t = await page.evaluate(() => { const M = window.__hubMap; const out = {}; let t0 = performance.now(); for (let i = 0; i < 40; i++) window.__hubMap.sync(); out.syncMs = (performance.now() - t0) / 40; out.groups = M.groups().length; out.info = M.glInfo(); return out; });
  console.log('PERF', JSON.stringify(t));
  // drag cost: move one grouped device 100 times and time the scene update the move triggers
  const drag = await page.evaluate(async () => { const M = window.__hubMap; const key = 'aa:bb:cc:00:05:7'; const sc = M.screenOf(key); return sc; });
  await page.mouse.move(drag.x, drag.y); await page.mouse.down();
  const dres = await page.evaluate(() => new Promise((res) => { let n = 0, longest = 0, total = 0; const t0 = performance.now(); const tick = () => { n++; res({ frames: n }); }; res({ ok: 1 }); }));
  const geoBefore = await page.evaluate(() => window.__hubMap.glInfo().geometries);
  const t1 = Date.now(); for (let i = 1; i <= 120; i++) { await page.mouse.move(drag.x + i * 2, drag.y + Math.sin(i / 8) * 40); }
  const dragMs = Date.now() - t1; await page.mouse.up(); await sleep(500);
  const geoAfter = await page.evaluate(() => window.__hubMap.glInfo().geometries);
  console.log('DRAG', JSON.stringify({ movesPerSec: Math.round(120000 / dragMs), geoBefore, geoAfter }));
  // group add / remove cycles: nothing may pile up
  const base = await page.evaluate(() => window.__hubMap.glInfo());
  for (let c = 0; c < 25; c++) {
    await page.evaluate((c) => { const e = window.hubNetmap.exportData(); Object.values(e.devices).forEach((d) => { if (!d.isRouter) d.group = (c % 2) ? ('G' + (Number(d.key.split(':').pop()) % 6)) : ''; }); window.hubNetmap.importData(e, true); }, c);
    await sleep(120);
  }
  await sleep(600);
  const end = await page.evaluate(() => window.__hubMap.glInfo());
  console.log('CYCLES', JSON.stringify({ base: [base.geometries, base.textures], end: [end.geometries, end.textures] }));
  // idle CPU with everything on
  await sleep(3000);
  const m1 = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ t: p.type, c: p.cpu.cumulativeCPUUsage })));
  await sleep(8000);
  const m2 = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ t: p.type, c: p.cpu.cumulativeCPUUsage })));
  const sum = (m) => m.reduce((a, p) => a + p.c, 0);
  const fr = await page.evaluate(() => new Promise((res) => { const f0 = window.__hubMap.glInfo().frames; setTimeout(() => res((window.__hubMap.glInfo().frames - f0) / 5), 5000); }));
  console.log('IDLE', JSON.stringify({ cpuSecPer8s: (sum(m2) - sum(m1)).toFixed(2), framesPerSec: fr }));
  await app.close();
})();
