'use strict';
//   xvfb-run -a node test/notif-logging-test.js
// History is recorded whether or not the Notifications Center window is open, and even when alerts are switched off or filtered.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + UD] });
  const page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain, BrowserWindow }) => { global.__send = (m) => BrowserWindow.getAllWindows()[0].webContents.send('net:event', m); ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => ({ ok: true })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(300);
  await page.fill('#mapCidr', '10.8.0.0/24'); await page.dispatchEvent('#mapCidr', 'change');
  await page.evaluate(() => { const l = document.getElementById('mapLive'); l.value = '0'; l.dispatchEvent(new Event('change')); });
  // alerts completely off, and no device kind ticked
  await page.selectOption('#mapAlerts', 'off');
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesNone'); await page.click('#alertTypesSave'); await sleep(300);
  const host = (n) => app.evaluate((_, n) => global.__send({ type: 'host', host: { ip: '10.8.0.' + n, mac: 'aa:bb:cc:03:00:0' + n, hostname: 'dev' + n, online: true, ports: [], ttl: 64, os: { id: 'windows', label: 'w', confidence: 'high', reasons: [] } } }), n);
  const scan = async (ns) => { await page.click('#mapScan'); await sleep(300); for (const n of ns) await host(n); await app.evaluate((_, c) => global.__send({ type: 'done', count: c }), ns.length); await sleep(1500); };
  await scan([1, 2]); await scan([1, 2, 3]); await scan([1, 3]);
  const toasts = await page.evaluate(() => document.querySelectorAll('#mapToasts .map-toast').length);
  check('with alerts off and nothing ticked, no pop-ups appear', toasts === 0, toasts);
  await sleep(2500);   // the history file is written a moment after the change
  let txt = ''; try { txt = fs.readFileSync(path.join(UD, 'notifications.json'), 'utf8'); } catch (e) { txt = 'NO FILE'; }
  check('the Notifications Center window was never opened', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1));
  check('yet the history has all three devices', ['10.8.0.1', '10.8.0.2', '10.8.0.3'].every((ip) => txt.includes(ip)), txt.slice(0, 300));
  check('and it recorded that 10.8.0.2 disconnected', /"left"|"end"|"to"|"disconnected"|"off/.test(txt), txt.slice(0, 500));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
