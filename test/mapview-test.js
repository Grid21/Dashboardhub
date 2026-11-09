'use strict';
//   xvfb-run -a node test/mapview-test.js
// The map cannot be pushed out of sight or zoomed out too far.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const devs = { router: { key: 'router', ip: '10.7.0.1', isRouter: true } }, links = [];
  for (let i = 0; i < 40; i++) { const k = 'aa:bb:cc:00:01:' + i.toString(16).padStart(2, '0'); devs[k] = { key: k, mac: k, ip: '10.7.0.' + (20 + i), label: 'm' + i, online: true }; links.push({ a: 'router', b: k, auto: true }); }
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true, devices: devs, links });
  await sleep(600); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1500);
  const ext = await page.evaluate(() => { const g = window.hubNetmap.exportData().devices; let m = 0; Object.values(g).forEach((d) => { if (d.pos) m = Math.max(m, Math.hypot(d.pos.x, d.pos.z)); }); return m; });
  const box = await page.evaluate(() => { const r = document.getElementById('mapWrap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.8 }; });
  // push the map away with the right mouse button, many times
  await page.mouse.move(box.x, box.y);
  for (let k = 0; k < 6; k++) { await page.mouse.down({ button: 'right' }); for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + i * 40, box.y - i * 10); await page.mouse.up({ button: 'right' }); await page.mouse.move(box.x, box.y); await sleep(150); }
  await sleep(500);
  let v = await page.evaluate(() => window.__hubMap.view());
  check('pushing the map sideways stops while it is still in sight', Math.abs(v.tx) <= ext + 12 + 0.2 * ext + 1 && Math.abs(v.tz) <= ext + 12 + 0.2 * ext + 1 && Math.abs(v.ty) <= 8.1, JSON.stringify(v) + ' ext ' + ext);
  // force far away (as if the mouse had dragged for a long time) -> it must be pulled back
  await page.evaluate(() => { /* nudge through the same controls the mouse uses */ });
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 600); await sleep(40); }
  await sleep(800);
  v = await page.evaluate(() => window.__hubMap.view());
  check('zooming out stops at a sensible distance', v.dist <= v.max + 0.5, JSON.stringify(v));
  check('that distance still leaves the map well in view (not 400)', v.max < 400 && v.max >= 70, v.max);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -600); await sleep(30); }
  await sleep(500);
  v = await page.evaluate(() => window.__hubMap.view());
  check('zooming in still works', v.dist < 30, JSON.stringify(v));
  await page.evaluate(() => document.getElementById('mapReset').click()); await sleep(600);
  v = await page.evaluate(() => window.__hubMap.view());
  check('Reset view still centres the map', Math.hypot(v.tx, v.tz) < 1, JSON.stringify(v));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
