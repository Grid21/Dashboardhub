'use strict';
//   xvfb-run -a node test/wake-test.js     (Wake-on-LAN: the packet itself, then the buttons in the app)
const path = require('path'), fs = require('fs'), os = require('os'), dgram = require('dgram');
const sc = require('../scanner.js');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // ---- the packet ----
  const p = sc.magicPacket('AA-BB-CC-00-11-22');
  check('packet is 102 bytes', p && p.length === 102);
  check('starts with six 0xFF bytes', p && p.slice(0, 6).every((b) => b === 255));
  check('then the MAC 16 times', p && Array.from({ length: 16 }).every((_, i) => p.slice(6 + i * 6, 12 + i * 6).toString('hex') === 'aabbcc001122'));
  check('bad addresses give no packet', sc.magicPacket('nonsense') === null && sc.magicPacket('aa:bb:cc') === null && sc.magicPacket('') === null);
  // ---- really sent over UDP (to a local listener) ----
  const got = [];
  const srv = dgram.createSocket('udp4');
  await new Promise((r) => srv.bind(0, '127.0.0.1', r));
  srv.on('message', (m) => got.push(m));
  const r = await sc.wakeOnLan(['aa:bb:cc:00:11:22', 'de:ad:be:ef:00:01', 'zz'], { targets: [{ from: '127.0.0.1', to: '127.0.0.1', port: srv.address().port }] });
  await sleep(300); srv.close();
  check('two good machines woken, one bad skipped', r.ok && r.sent === 2 && r.bad === 1, JSON.stringify(r));
  check('the listener received both packets', got.length === 2 && got[0].length === 102 && got.some((g) => g.slice(6, 12).toString('hex') === 'deadbeef0001'), String(got.length));
  const none = await sc.wakeOnLan(['nope']);
  check('nothing valid: clear error', none.ok === false && /No valid/.test(none.error));
  // ---- the app ----
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'wk-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => {
    global.__wake = [];
    ipcMain.removeHandler('net:wake'); ipcMain.handle('net:wake', (e, macs) => { global.__wake.push(macs); return { ok: true, sent: macs.length, bad: 0 }; });
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [], gateway: null }));
  });
  await page.click('#tabMap'); await sleep(400);
  const M = 'aa:bb:cc:00:00:';
  const dev = (n, ip, label, extra) => Object.assign({ key: M + n, mac: M + n, ip: ip, label: label, online: true, os: { id: 'windows', label: 'Windows', confidence: 'high', reasons: [] } }, extra || {});
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.8.0.1', cidr: '10.8.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.8.0.1', isRouter: true }, [M + '01']: dev('01', '10.8.0.21', 'Sleeping PC', { online: false }), [M + '02']: dev('02', '10.8.0.22', 'Server') , ['manual:abc']: { key: 'manual:abc', label: 'Manual box', manual: true, online: true, os: { id: 'unknown', label: 'Unknown', confidence: 'low', reasons: [] } } },
    links: [{ a: 'router', b: M + '01', auto: true }, { a: 'router', b: M + '02', auto: true }] });
  await sleep(500); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1000);
  await page.evaluate(() => { document.getElementById('mapOffline').checked = true; document.getElementById('mapOffline').dispatchEvent(new Event('change')); }); await sleep(700);
  const read = async (key) => { const q = await page.evaluate((k) => window.__hubMap.screenOf(k), key); await page.mouse.click(q.x, q.y); await sleep(400); };
  await read(M + '01');
  check('offline machine has a "Wake up" button', await page.evaluate(() => !![...document.querySelectorAll('#mapSide .wake-btn')].find((b) => /Wake up/.test(b.textContent))));
  await page.click('#mapSide .wake-btn'); await sleep(600);
  const w1 = await app.evaluate(() => global.__wake.slice());
  check('the app sent that machine\'s hardware address', w1.length === 1 && w1[0].join() === M + '01', JSON.stringify(w1));
  check('status line confirms it', /Wake-up signal sent to Sleeping PC/.test(await page.evaluate(() => document.getElementById('mapStatus').textContent)));
  // it comes online -> "is awake"
  await page.evaluate((k) => { state.network.devices[k].online = true; state.network.devices[k].misses = 2; }, M + '01'); await sleep(6500);
  check('when it comes online the status says it is awake', /Sleeping PC is awake/.test(await page.evaluate(() => document.getElementById('mapStatus').textContent)), await page.evaluate(() => document.getElementById('mapStatus').textContent));
  await read(M + '02');
  check('online machine offers "Send wake-up signal"', await page.evaluate(() => !![...document.querySelectorAll('#mapSide .wake-btn')].find((b) => /Send wake-up/.test(b.textContent))));
  // bulk
  await page.click('#mapListBtn'); await sleep(500);
  for (let i = 0; i < 6; i++) { await page.evaluate(() => { const c = [...document.querySelectorAll('#mapList .ml-row input[type=checkbox]')].find((x) => !x.checked); if (c) c.click(); }); await sleep(150); }
  const bulkBtn = await page.evaluate(() => !![...document.querySelectorAll('#mapListBulk button')].find((b) => /Wake up selected/.test(b.textContent)));
  check('list has "Wake up selected"', bulkBtn);
  await page.evaluate(() => [...document.querySelectorAll('#mapListBulk button')].find((b) => /Wake up selected/.test(b.textContent)).click()); await sleep(700);
  const w2 = await app.evaluate(() => global.__wake.slice());
  check('bulk sends only machines that have a hardware address', w2.length === 2 && w2[1].length === 2 && !w2[1].some((m) => /manual/.test(m)), JSON.stringify(w2) + ' msg=' + await page.evaluate(() => (document.getElementById('mapListBulk') || {}).innerText));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
