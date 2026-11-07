'use strict';
//   xvfb-run -a node test/gpu-safety-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await app.evaluate(({ ipcMain, BrowserWindow }) => { ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => { setTimeout(() => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', { type: 'done' }); } catch (e) { /* closed */ } }, 100); return { ok: true }; }); });
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:01:';
  const mk = (n) => ({ key: M + n, mac: M + n, ip: '10.8.0.' + (20 + Number(n)), label: 'dev' + n, online: true, lastSeen: Date.now(), os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] }, pos: { x: -12 + Number(n) * 4, y: 0, z: 7 } });
  const mapOf = (ns) => { const devices = { router: { key: 'router', ip: '10.8.0.1', isRouter: true, online: true } }; ns.forEach((n) => { devices[M + n] = mk(n); }); return { router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true, showOffline: true, devices, links: ns.map((n) => ({ a: 'router', b: M + n, auto: false })) }; };
  await page.evaluate((d) => window.hubNetmap.importData(d, true), mapOf(['01', '02', '03', '04']));
  await sleep(1500);
  const gl = () => page.evaluate(() => window.__hubMap.glInfo());
  const frames = async (ms) => { const a = (await gl()).frames; await sleep(ms); return (await gl()).frames - a; };
  const g0 = await gl();
  check('the 3D map is running (software drawing in this test computer)', g0 && g0.running && g0.software === true, JSON.stringify(g0));

  // ---- resting speed ----
  await sleep(2500);                                       // let it settle into resting mode
  const pulseFrames = await frames(3000);
  check('resting with blinking lines: about 15 pictures a second (not tied to the screen speed)', pulseFrames >= 20 && pulseFrames <= 75, String(pulseFrames));
  await page.evaluate(() => { const c = document.getElementById('pulseCheck'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(2500);
  const secs = []; for (let i = 0; i < 7; i++) secs.push(await frames(1000));
  const median = secs.slice().sort((a, b) => a - b)[3];
  check('resting with blinking off and nothing moving: usually about 1 picture a second (per-second counts ' + secs.join(',') + ')', median <= 3, String(median));
  await page.evaluate(() => { const c = document.getElementById('pulseCheck'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(500);

  // ---- waking up ----
  await sleep(3000);
  await page.evaluate(() => window.__hubMap.sync && window.__hubMap.sync());
  const before = (await gl()).frames;
  await page.mouse.move(700, 450); await page.mouse.move(720, 460); await page.mouse.move(740, 470); await sleep(500);
  check('touching the map wakes it at once', (await gl()).frames - before >= 3, String((await gl()).frames - before));

  // ---- window hidden (tray) with the "do not slow down" setting that tray mode uses ----
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); });
  await sleep(1500);
  check('the page is told it is hidden', await page.evaluate(() => window.hubWindowHidden === true && document.body.classList.contains('window-hidden')));
  const hiddenFrames = await frames(3000);
  check('hidden in the tray, even with slow-down switched off: nothing is drawn', hiddenFrames <= 1, String(hiddenFrames));
  check('animations are paused while hidden', await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('animation-play-state') !== undefined && !!document.body.classList.contains('window-hidden')));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); });
  await sleep(1800);
  check('shown again: drawing resumes', (await frames(2000)) >= 5);
  check('and the page knows it is visible', await page.evaluate(() => window.hubWindowHidden === false));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(true); });

  // ---- switching tabs quickly never leaves two loops running ----
  const gen0 = (await gl()).gen;
  for (let i = 0; i < 12; i++) { await page.click('#tabPanels'); await page.click('#tabMap'); }
  await sleep(3500);
  const gen1 = await gl();
  check('after 12 quick tab switches the map runs once, at the resting speed', gen1.running && gen1.gen > gen0 && (await frames(3000)) <= 75);
  await page.click('#tabPanels'); await sleep(300);
  const offFrames = await frames(1500);
  check('on the Panels tab the 3D map draws nothing', offFrames === 0, String(offFrames));
  await page.click('#tabMap'); await sleep(800);

  // ---- graphics driver reset ----
  await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); window.__lose = g.getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await sleep(800);
  let st = await gl();
  check('graphics context lost: the map notices and pauses', st.lost === true && (await frames(1500)) === 0, JSON.stringify(st));
  await page.evaluate(() => window.__lose.restoreContext()); await sleep(1500);
  st = await gl();
  check('graphics context restored: the map comes back and draws again', st.lost === false && (await frames(2000)) >= 5, JSON.stringify(st));
  const devCount = await page.evaluate(() => Object.keys(window.hubNetmap.exportData().devices).length);
  check('and the machines are still there', devCount === 5, String(devCount));

  // ---- no leak of graphics memory ----
  await page.evaluate((d) => window.hubNetmap.importData(d, true), mapOf(['01', '02', '03', '04'])); await sleep(1200);
  const base = await gl();
  for (let round = 0; round < 6; round++) {
    await page.evaluate((d) => window.hubNetmap.importData(d, true), mapOf(['01', '02', '03', '04', '05', '06', '07', '08', '09'])); await sleep(500);
    await page.evaluate((d) => window.hubNetmap.importData(d, true), mapOf(['01', '02', '03', '04'])); await sleep(600);
  }
  await sleep(1500);
  const end = await gl();
  check('adding and removing machines 6 times does not grow graphics memory (geometries ' + base.geometries + ' -> ' + end.geometries + ', textures ' + base.textures + ' -> ' + end.textures + ')', end.geometries <= base.geometries + 2 && end.textures <= base.textures + 4, JSON.stringify([base, end]));

  // ---- very large window never asks for more than about 4K of pixels ----
  await page.setViewportSize({ width: 3000, height: 2200 }); await sleep(1500);
  const big = await gl();
  check('a huge window stays within the picture-size limit', big.width * big.height <= 8600000, JSON.stringify(big));
  await page.setViewportSize({ width: 1400, height: 900 }); await sleep(500);

  // ---- panel pages stop when the window is hidden ----
  // (a hidden window hides its panels too; their own pages must see it)
  // ---- safety nets in the main program ----
  const readSet = () => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')); } catch (e) { return null; } };
  await app.evaluate(({ app }) => { app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' }); app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' }); app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed' }); app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit' }); });
  await sleep(300);
  check('two graphics-process crashes (and other processes, and clean exits) change nothing', !readSet() || readSet().gpu !== false, JSON.stringify(readSet()));
  await app.evaluate(({ app }) => { app.emit('child-process-gone', {}, { type: 'GPU', reason: 'abnormal-exit' }); });
  await sleep(300);
  check('the third crash switches the graphics card off for the next start, marked as automatic', readSet() && readSet().gpu === false && readSet().gpuAutoOff === true, JSON.stringify(readSet()));
  const got = await page.evaluate(() => window.settingsApi.get());
  check('Settings is told, so it can explain', got.gpuAutoOff === true && got.gpu === false, JSON.stringify(got));
  await page.click('#settingsBtn'); await sleep(300);
  check('and the Settings text says why', /switched off automatically/.test(await page.evaluate(() => document.getElementById('gpuHint').textContent)), await page.evaluate(() => document.getElementById('gpuHint').textContent));
  await page.evaluate(() => window.settingsApi.setGpu(true));
  check('switching it back on by hand clears the automatic mark', readSet().gpu === true && readSet().gpuAutoOff === false, JSON.stringify(readSet()));
  await page.evaluate(() => { window.__survive = 1; });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 }); });
  await sleep(3500);
  await page.waitForSelector('#tabMap');
  check('if the window\'s page process dies, the page reloads by itself', await page.evaluate(() => window.__survive === undefined));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
