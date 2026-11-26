'use strict';
//   xvfb-run -a node test/identify-ui-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'su-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: { eth0: { mbps: 2500, wireless: false } } })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:00:';
  const dev = (n, ip, label, extra) => Object.assign({ key: M + n, mac: M + n, ip: ip, label: label, online: true, os: { id: 'unknown', label: 'unknown', confidence: 'low', reasons: [] } }, extra || {});
  await app.evaluate(({ ipcMain }) => {
    globalThis.__pings = 0; globalThis.__opened = [];
    ipcMain.removeHandler('net:ping'); ipcMain.handle('net:ping', () => { globalThis.__pings++; return { ok: true, alive: globalThis.__pings < 3 }; });
    ipcMain.removeHandler('net:maker'); ipcMain.handle('net:maker', () => ({ ok: true, name: 'Acme Gadgets Ltd' }));
    ipcMain.removeHandler('net:search'); ipcMain.handle('net:search', (e, q) => { globalThis.__opened.push(q); return { ok: true }; });
  });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true },
      [M + '01']: dev('01', '10.7.0.21', '', { mac: '44:17:93:00:00:01', vendor: 'Espressif Inc.', hostname: 'ESP-1A2B3C', ttl: 64 }),
      [M + '02']: dev('02', '10.7.0.22', '', { mac: 'd2:11:22:33:44:55', key: M + '02', ports: [{ port: 9100, service: 'JetDirect' }, { port: 80, service: 'HTTP', title: 'Lexmark X123' }] }) },
    links: [{ a: 'router', b: M + '01', auto: true }, { a: 'router', b: M + '02', auto: true }] });
  await sleep(800); await page.evaluate(() => window.__hubMap.sync()); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1200); await page.evaluate(() => window.__hubMap.sync()); await sleep(400);
  const pick = async (key) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), key); await page.mouse.click(p.x, p.y); await sleep(400); };
  await pick(M + '01');
  check('the identify button is on the machine pane', await page.isVisible('#idHelpBtn'));
  check('the help starts hidden', !(await page.isVisible('#idHelp')));
  await page.click('#idHelpBtn'); await sleep(200);
  const t1 = await page.innerText('#idHelp');
  check('it lists what is known (maker, name, TTL)', /Espressif/.test(t1) && /ESP-1A2B3C/.test(t1) && /TTL 64/.test(t1), t1.slice(0, 300));
  const g1 = await page.innerText('#idGuesses');
  check('it explains an Espressif chip is a gadget, not the product', /chip|gadget/i.test(g1), g1);
  await sleep(9000);
  check('the help stays open when the pane is redrawn', await page.isVisible('#idHelp') && /Espressif/.test(await page.innerText('#idHelp')));
  await page.click('text=Search the web for this'); await sleep(300);
  const opened = await app.evaluate(() => globalThis.__opened);
  check('the search button sends a sensible search', opened.length === 1 && /Espressif/.test(opened[0]) && /ESP-1A2B3C/.test(opened[0]), JSON.stringify(opened));
  await page.click('text=Ask an online maker list'); await sleep(500);
  check('the online lookup shows the answer and offers to use it', /Acme Gadgets Ltd/.test(await page.innerText('#idResult')));
  await page.click('text=Use as brand'); await sleep(500);
  const brand = await page.evaluate(() => { const i = Array.from(document.querySelectorAll('#mapSide input')).find((x) => x.value === 'Acme Gadgets Ltd'); return !!i; });
  check('"Use as brand" fills in the brand', brand);
  await page.evaluate(() => { const b = document.getElementById('idHelpBtn'); if (b) b.click(); });
  await pick(M + '02');
  await page.click('#idHelpBtn'); await sleep(200);
  const t2 = await page.innerText('#idHelp'), g2 = await page.innerText('#idGuesses');
  check('a made-up (private) address is explained', /private/i.test(t2) && /Private Wi-Fi address/.test(t2), t2.slice(0, 300));
  check('the online lookup is not offered for a made-up address', !/Ask an online maker list/.test(t2));
  check('open ports give hints (printer)', /printer/i.test(g2) && /Lexmark X123/.test(g2), g2);
  await app.evaluate(() => { globalThis.__pings = 0; });
  await page.click('#idUnplugBtn'); await sleep(9000);
  const u = await page.innerText('#idUnplug');
  check('the unplug test reports when the machine stops answering', /stopped answering/.test(u), u);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
