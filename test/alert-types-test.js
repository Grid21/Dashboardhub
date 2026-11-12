'use strict';
//   xvfb-run -a node test/alert-types-test.js
// Alerts can be limited to the kinds of device the person chooses.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  let app = await launch();
  let page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  const rig = () => app.evaluate(({ ipcMain, BrowserWindow }) => { global.__send = (m) => { try { BrowserWindow.getAllWindows()[0].webContents.send('net:event', m); } catch (e) {} }; ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => ({ ok: true })); });
  await rig();
  const host = (n, osid) => app.evaluate((_, a) => global.__send({ type: 'host', host: { ip: '10.8.0.' + a.n, mac: 'aa:bb:cc:02:00:' + String(a.n).padStart(2, '0'), hostname: a.os + a.n, online: true, ports: [], ttl: 64, os: { id: a.os, label: a.os, confidence: 'high', reasons: [] } } }), { n, os: osid });
  const done = () => app.evaluate(() => global.__send({ type: 'done', count: 5 }));
  const toasts = () => page.evaluate(() => Array.from(document.querySelectorAll('#mapToasts .map-toast')).map((t) => t.textContent));
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(300);
  check('the button starts as "All devices"', (await page.textContent('#mapAlertTypes')).trim() === 'Alerts for: All devices');
  // first scan sets the starting point (no alerts)
  await page.click('#mapScan'); await sleep(300); await host(5, 'linux'); await done(); await sleep(1200);
  // default: every kind raises an alert
  await page.click('#mapScan'); await sleep(300); await host(5, 'linux'); await host(6, 'windows'); await host(7, 'iot'); await done(); await sleep(1200);
  let t = await toasts();
  check('by default new Windows and IoT devices both raise alerts', t.length === 2, JSON.stringify(t));
  await page.evaluate(() => document.getElementById('mapToasts').textContent = '');
  // choose Linux only
  await page.click('#mapAlertTypes'); await sleep(300);
  check('the window opens with nine kinds, all ticked', await page.evaluate(() => { const c = document.querySelectorAll('#alertTypesList input'); return c.length === 9 && Array.from(c).every((x) => x.checked); }));
  await page.click('#alertTypesNone');
  await page.check('#alertTypesList input[value=linux]');
  await page.click('#alertTypesSave'); await sleep(300);
  check('the button now says 1 of 9 kinds', (await page.textContent('#mapAlertTypes')).trim() === 'Alerts for: 1 of 9 kinds', await page.textContent('#mapAlertTypes'));
  await page.click('#mapScan'); await sleep(300); await host(5, 'linux'); await host(6, 'windows'); await host(7, 'iot'); await host(8, 'windows'); await host(9, 'linux'); await host(10, 'iot'); await host(11, 'printer'); await done(); await sleep(1200);
  t = await toasts();
  check('only the Linux device raises an alert now', t.length === 1 && /10\.8\.0\.9/.test(t[0]), JSON.stringify(t));
  // routers/switches count as one kind
  await page.evaluate(() => document.getElementById('mapToasts').textContent = '');
  await page.click('#mapAlertTypes'); await sleep(300);
  await page.click('#alertTypesNone'); await page.check('#alertTypesList input[value=network]'); await page.click('#alertTypesSave'); await sleep(300);
  await page.click('#mapScan'); await sleep(300); for (const [n, o] of [[5,'linux'],[6,'windows'],[7,'iot'],[8,'windows'],[9,'linux'],[10,'iot'],[11,'printer']]) await host(n, o); await host(12, 'switch'); await host(13, 'linux'); await done(); await sleep(1200);
  t = await toasts();
  check('a switch counts as a network device and the Linux one is now quiet', t.length === 1 && /10\.8\.0\.12/.test(t[0]), JSON.stringify(t));
  // nothing ticked = silent
  await page.evaluate(() => document.getElementById('mapToasts').textContent = '');
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesNone'); await page.click('#alertTypesSave'); await sleep(300);
  check('nothing ticked shows "No devices"', (await page.textContent('#mapAlertTypes')).trim() === 'Alerts for: No devices');
  await page.click('#mapScan'); await sleep(300); for (const [n, o] of [[5,'linux'],[6,'windows'],[7,'iot'],[8,'windows'],[9,'linux'],[10,'iot'],[11,'printer'],[12,'switch'],[13,'linux']]) await host(n, o); await host(14, 'linux'); await done(); await sleep(1200);
  check('nothing ticked means no alerts', (await toasts()).length === 0);
  // cancel keeps the old choice
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesAll'); await page.click('#alertTypesCancel'); await sleep(200);
  check('Cancel changes nothing', (await page.textContent('#mapAlertTypes')).trim() === 'Alerts for: No devices');
  // choice survives a restart
  await page.click('#mapAlertTypes'); await sleep(300); await page.check('#alertTypesList input[value=iot]'); await page.click('#alertTypesSave'); await sleep(500);
  await app.close(); await sleep(500);
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await page.click('#tabMap'); await sleep(800);
  check('the choice is still there after restarting', (await page.textContent('#mapAlertTypes')).trim() === 'Alerts for: 1 of 9 kinds', await page.textContent('#mapAlertTypes'));
  await page.click('#mapAlertTypes'); await sleep(300);
  check('and only IoT is ticked', await page.evaluate(() => Array.from(document.querySelectorAll('#alertTypesList input')).filter((c) => c.checked).map((c) => c.value).join() === 'iot'));
  await page.click('#alertTypesAll'); await page.click('#alertTypesSave'); await sleep(300);
  check('Tick all goes back to "All devices"', (await page.textContent('#mapAlertTypes')).trim() === 'Alerts for: All devices');
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
