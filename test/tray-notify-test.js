'use strict';
//   xvfb-run -a node test/tray-notify-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(background) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ closeToTray: background, gpu: true }));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => {
    global.__scans = 0;
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} }));
    ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => { global.__scans++; return { ok: false, error: 'test' }; });
  });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:00:';
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true, autoSeconds: 15, alerts: 'desktop',
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [M + '01']: { key: M + '01', mac: M + '01', ip: '10.7.0.21', label: 'PC', online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } } }, links: [{ a: 'router', b: M + '01', auto: true }] });
  await sleep(500);
  const bg = await page.evaluate(() => window.hubBackground);
  const thr = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.backgroundThrottling);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide()); await sleep(300);
  // without a window manager the page never learns it is hidden, so say so the way a real hidden window does
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  await sleep(300);
  const hidden = await page.evaluate(() => document.hidden);
  const before = await app.evaluate(() => global.__scans);
  await sleep(36000);
  const after = await app.evaluate(() => global.__scans);
  // the notice itself: asked from the page while the window is hidden
  const note = await page.evaluate(() => window.settingsApi.notify('Test notice\nsecond line'));
  const supported = await app.evaluate(({ Notification }) => Notification.isSupported());
  const bad = await page.evaluate(() => window.settingsApi.notify('   '));
  await app.close();
  return { bg, thr, hidden, scans: after - before, note, supported, bad, errors };
}
(async () => {
  const on = await run(true);
  check('background setting reaches the page', on.bg === true, JSON.stringify(on));
  check('hidden window is not slowed down', on.thr === false, String(on.thr));
  check('window really is hidden in the test', on.hidden === true);
  check('live scans keep running while hidden in the tray', on.scans >= 1, String(on.scans));
  check('notice request is accepted while hidden (or the system has no notices)', on.note && (on.note.ok === true || on.supported === false), JSON.stringify(on.note) + ' supported=' + on.supported);
  check('empty notice is refused', on.bad && on.bad.ok === false);
  check('no page errors', on.errors.length === 0, on.errors.join(' | '));
  const off = await run(false);
  check('without the tray option, a hidden window still pauses scans (as before)', off.scans === 0 && off.bg === false, JSON.stringify(off));
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
