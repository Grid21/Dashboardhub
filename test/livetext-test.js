'use strict';
//   xvfb-run -a node test/livetext-test.js
// The green dot always has words next to it.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'lt-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForSelector('#tabMap');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await app.evaluate(({ ipcMain, BrowserWindow }) => { global.__send = (m) => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', m); } catch (e) {} }; ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => ({ ok: true, cidr: '10.8.0.0/24' })); });
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(300);
  const txt = () => page.evaluate(() => document.getElementById('mapLiveText').textContent);
  const E = 'aa:bb:cc:00:00:41';
  await page.evaluate((E) => window.hubNetmap.importData({ router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true, autoSeconds: 0, devices: { router: { key: 'router', ip: '10.8.0.1', isRouter: true }, [E]: { key: E, mac: E, ip: '10.8.0.41', label: 'x', online: true } }, links: [{ a: 'router', b: E, auto: true }] }, true), E); await sleep(500);
  check('live update off: no dot text, dot is grey', (await txt()) === '' && await page.evaluate(() => document.getElementById('mapLiveDot').classList.contains('off')));
  await page.selectOption('#mapLive', '15'); await sleep(600);
  check('turning live update on says so', /^Auto scan on: every 15 seconds/.test(await txt()), await txt());
  // a real automatic check
  await page.evaluate(() => window.__hubMap && 0); 
  await app.evaluate(() => global.__send({ type: 'progress', pct: 10 }));
  const started = await page.evaluate(() => { try { return typeof window.hubNetmap.liveNow === 'function'; } catch (e) { return false; } });
  if (started) await page.evaluate(() => window.hubNetmap.liveNow()); else await sleep(16500);
  await sleep(700);
  const during = await txt();
  check('while the dot blinks it says an auto scan is in progress', /Auto scan in progress/.test(during), during);
  await app.evaluate(() => global.__send({ type: 'done', count: 1 })); await sleep(900);
  const after = await txt();
  check('when done it shows the last auto scan time', /^Last auto scan: \d/.test(after), after);
  check('the dot stopped blinking', await page.evaluate(() => !document.getElementById('mapLiveDot').classList.contains('busy')));
  await page.selectOption('#mapLive', '0'); await sleep(400);
  check('turning it off clears the text', (await txt()) === '', await txt());
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
