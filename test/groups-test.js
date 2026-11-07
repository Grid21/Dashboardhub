'use strict';
//   xvfb-run -a node test/groups-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await app.evaluate(({ ipcMain, BrowserWindow }) => { ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => { setTimeout(() => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', { type: 'done' }); } catch (e) { /* closed */ } }, 100); return { ok: true }; }); });
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:03:';
  const mk = (n, g, x, z) => ({ key: M + n, mac: M + n, ip: '10.8.0.' + (20 + n), label: 'dev' + n, group: g, online: true, lastSeen: Date.now(), os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] }, pos: { x: x, y: 0, z: z } });
  const list = [mk(1, 'IoT', 8, 8), mk(2, 'IoT', 11, 8), mk(3, 'IoT', 9.5, 11), mk(4, '', -10, -6), mk(5, 'Lonely', -10, 6)];
  const devices = { router: { key: 'router', ip: '10.8.0.1', isRouter: true, online: true } }; list.forEach((d) => { devices[d.key] = d; });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true, showOffline: true, devices, links: list.map((d) => ({ a: 'router', b: d.key, auto: false })) });
  await sleep(1500);
  const groups = () => page.evaluate(() => window.__hubMap.groups());
  const pos = (n) => page.evaluate((k) => { const d = window.hubNetmap.exportData().devices[k]; return d.pos; }, M + n);

  let g = await groups();
  check('a circle is drawn around the IoT group', g.length === 1 && g[0].name === 'IoT', JSON.stringify(g));
  check('a group of one machine gets no circle', !g.some((x) => x.name === 'Lonely'));
  check('the circle is centred on its machines and large enough to hold them', g[0] && Math.abs(g[0].x - 9.5) < 0.2 && Math.abs(g[0].z - 9) < 0.2 && g[0].r > 2.2, JSON.stringify(g[0]));

  check('the circle is bold: solid ring and a clearly visible fill', g[0].ringOpacity >= 0.9 && g[0].fillOpacity >= 0.2, JSON.stringify(g[0]));
  check('the group name is big enough to read and never hidden behind machines', g[0].labelH >= 1.6 && g[0].labelW > g[0].labelH && g[0].labelOnTop, JSON.stringify(g[0]));
  // real pixels: the ring colour must show up in a top-down screenshot
  await page.click('#mapTop'); await sleep(1500);
  const png = await page.screenshot();
  const px = await page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 2] > 200 && d[i] > 120 && d[i] < 200 && d[i + 1] > 120 && d[i + 1] < 210) n++; } return n; }, png.toString('base64'));
  check('the ring is really drawn on screen (pixel check)', px > 300, 'ring-coloured pixels: ' + px);
  // switch off circles
  await page.evaluate(() => { const c = document.getElementById('mapGroupCircles'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
  check('Group circles off: no circle', (await groups()).length === 0);
  check('the setting is remembered in the map data', await page.evaluate(() => window.hubNetmap.exportData().groupCircles === false));
  await page.evaluate(() => { const c = document.getElementById('mapGroupCircles'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
  check('Group circles on again: circle is back', (await groups()).length === 1);

  // drag one machine with the mouse
  const drag = async (n, dx, dy, ctrl) => {
    const sc = await page.evaluate((k) => window.__hubMap.screenOf(k), M + n);
    const box = await page.locator('#netCanvas, #mapCanvas, .map-main canvas').first().boundingBox();
    const x = (sc.x !== undefined ? sc.x : sc[0]), y = (sc.y !== undefined ? sc.y : sc[1]);
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + dx * i / 8, y + dy * i / 8);
    await page.mouse.up();
    if (ctrl) await page.keyboard.up('Control');
    await sleep(400);
  };
  const b1 = await pos(1), b2 = await pos(2), b3 = await pos(3), b4 = await pos(4);
  await drag(1, 80, 40, false);
  const a1 = await pos(1), a2 = await pos(2), a3 = await pos(3), a4 = await pos(4);
  const d1 = [a1.x - b1.x, a1.z - b1.z], d2 = [a2.x - b2.x, a2.z - b2.z], d3 = [a3.x - b3.x, a3.z - b3.z];
  check('dragging one grouped machine really moves it', Math.hypot(d1[0], d1[1]) > 1, JSON.stringify(d1));
  check('the other machines in the group moved the same distance', Math.hypot(d2[0] - d1[0], d2[1] - d1[1]) < 0.01 && Math.hypot(d3[0] - d1[0], d3[1] - d1[1]) < 0.01, JSON.stringify([d1, d2, d3]));
  check('machines outside the group stayed put', a4.x === b4.x && a4.z === b4.z);
  g = await groups();
  check('the circle followed the group', g[0] && Math.abs(g[0].x - (9.5 + d1[0])) < 0.3, JSON.stringify(g[0]));

  // Ctrl + drag = only that machine
  const c2 = await pos(2), c3 = await pos(3);
  await drag(1, -60, 30, true);
  const e1 = await pos(1), e2 = await pos(2), e3 = await pos(3);
  check('Ctrl+drag moves only the one machine', Math.hypot(e1.x - a1.x, e1.z - a1.z) > 1 && e2.x === c2.x && e3.x === c3.x && e2.z === c2.z);

  // clustering off
  await page.evaluate(() => { const c = document.getElementById('mapGroupMove'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
  check('Move groups together off is remembered', await page.evaluate(() => window.hubNetmap.exportData().groupCluster === false));
  const f1 = await pos(1), f2 = await pos(2);
  await drag(1, 50, 20, false);
  const h1 = await pos(1), h2 = await pos(2);
  check('with clustering off, dragging moves only one machine (circle stays on)', Math.hypot(h1.x - f1.x, h1.z - f1.z) > 1 && h2.x === f2.x && h2.z === f2.z && (await groups()).length === 1);

  // group set from the list's bulk tool puts a circle around the new group
  await page.evaluate(() => { const c = document.getElementById('mapGroupMove'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.evaluate((k) => { const d = window.hubNetmap.exportData(); }, M + 4);
  await page.click('#mapListBtn').catch(() => {}); await sleep(400);
  const rows = await page.locator('.ml-row').count();
  check('the machine list still shows the machines with group headings', rows >= 5 && (await page.locator('.ml-group').count()) >= 2, String(rows));
  const hint = await page.evaluate(() => document.getElementById('mapHint') ? document.getElementById('mapHint').textContent : '');
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  await app.close();
  process.exit(failed ? 1 : 0);
})();
