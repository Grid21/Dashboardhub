'use strict';
//   SOAK_MIN=12 xvfb-run -a node test/soak-test.js
// Runs the app for a long time with fast automatic scans and pretend devices that keep joining and leaving, and watches
// memory, the number of programs the app starts, page size and saved-file size. Fails if anything keeps growing.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const MIN = Number(process.env.SOAK_MIN || 12);
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ gpu: true }));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    global.__scans = 0;
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01' }));
    ipcMain.removeHandler('net:scan');
    ipcMain.handle('net:scan', (e, o) => {
      const n = ++global.__scans;
      setTimeout(() => {
        const w = BrowserWindow.getAllWindows()[0]; if (!w) return;
        for (let i = 1; i <= 60; i++) {
          // 50 steady machines; 10 that come and go (each leaves for 3 scans out of every 6)
          if (i > 50 && ((n + i) % 6) < 3) continue;
          const mac = 'aa:bb:cc:00:' + String(i >> 8).padStart(2, '0') + ':' + (i & 255).toString(16).padStart(2, '0');
          w.webContents.send('net:event', { type: 'host', host: { ip: '10.8.0.' + (10 + i), mac: mac, hostname: 'pc' + i, ports: [], os: { id: i % 3 ? 'windows' : 'linux', label: 'x', confidence: 'low', reasons: [] } } });
        }
        w.webContents.send('net:event', { type: 'done' });
      }, 200);
      return { ok: true, cidr: o.cidr };
    });
  });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  await page.evaluate(() => window.hubNetmap.importData({ router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true, autoSeconds: 15, alerts: 'desktop', devices: { router: { key: 'router', ip: '10.8.0.1', isRouter: true }, 'aa:bb:cc:00:00:01': { key: 'aa:bb:cc:00:00:01', mac: 'aa:bb:cc:00:00:01', ip: '10.8.0.11', label: 'pc1', online: true } }, links: [] }, true));
  await sleep(1000);
  const rows = [];
  const t0 = Date.now();
  async function sample() {
    const m = await app.evaluate(({ app: a }) => a.getAppMetrics().map((p) => ({ t: p.type, mb: Math.round((p.memory.workingSetSize || 0) / 1024) })));
    const pg = await page.evaluate(() => ({ heap: Math.round((performance.memory ? performance.memory.usedJSHeapSize : 0) / 1048576), nodes: document.getElementsByTagName('*').length, toasts: document.querySelectorAll('.toast, .map-toast, [class*="toast"]').length }));
    const scans = await app.evaluate(() => global.__scans);
    let nf = 0; try { nf = fs.statSync(path.join(ud, 'notifications.json')).size; } catch (e) { /* none yet */ }
    const total = m.reduce((a, p) => a + p.mb, 0);
    rows.push({ min: +((Date.now() - t0) / 60000).toFixed(1), procs: m.length, totalMB: total, heapMB: pg.heap, nodes: pg.nodes, toasts: pg.toasts, scans: scans, notifKB: Math.round(nf / 1024) });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  while (Date.now() - t0 < MIN * 60000) { await sleep(30000); await sample(); }
  fs.writeFileSync(process.env.SOAK_OUT || '/tmp/soak.json', JSON.stringify(rows));
  const q = (a, f) => a.map(f);
  const early = rows.slice(2, 5), late = rows.slice(-3);
  const avg = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
  const maxProcs = Math.max(...rows.map((r) => r.procs));
  check('scans really ran on their own (' + rows[rows.length - 1].scans + ')', rows[rows.length - 1].scans >= MIN * 60 / 15 * 0.5);
  check('number of app processes stays steady (max ' + maxProcs + ', first ' + rows[0].procs + ')', maxProcs <= rows[0].procs + 2);
  check('total memory does not keep growing (early ' + Math.round(avg(early, 'totalMB')) + ' MB -> late ' + Math.round(avg(late, 'totalMB')) + ' MB)', avg(late, 'totalMB') <= avg(early, 'totalMB') * 1.25 + 30);
  check('page memory does not keep growing (early ' + avg(early, 'heapMB').toFixed(0) + ' -> late ' + avg(late, 'heapMB').toFixed(0) + ' MB)', avg(late, 'heapMB') <= avg(early, 'heapMB') * 1.4 + 10);
  check('page size (elements) does not keep growing (' + avg(early, 'nodes').toFixed(0) + ' -> ' + avg(late, 'nodes').toFixed(0) + ')', avg(late, 'nodes') <= avg(early, 'nodes') * 1.3 + 100);
  check('pop-up messages do not pile up (' + rows[rows.length - 1].toasts + ')', rows[rows.length - 1].toasts <= 10);
  check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  let ok = false; try { ok = (await page.evaluate(() => typeof window.hubNetmap)) === 'object'; } catch (e) { /* dead */ }
  check('the app is still alive at the end', ok);
  await app.close();
  console.log(failed ? failed + ' failed' : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  FAIL  soak crashed: ' + e.message); process.exit(1); });
