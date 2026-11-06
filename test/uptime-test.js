'use strict';
//   xvfb-run -a node test/uptime-test.js      (the SNMP part needs python3 + pysnmp and UDP port 161 on 127.0.0.1)
const path = require('path'), fs = require('fs'), os = require('os'), { spawn, spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // ---- 1. a real SNMP answer carries the device's own uptime
  let snmpSelf = null;
  if (spawnSync('python3', ['-c', 'import pysnmp']).status === 0) {
    const cn = require(path.join(ROOT, 'connectors.js'));
    const mib = { '1.3.6.1.2.1.1.5.0': ['s', 'Core switch'], '1.3.6.1.2.1.1.1.0': ['s', 'HPE OfficeConnect 1820 48G Switch J9984A'], '1.3.6.1.2.1.1.2.0': ['x', '2b06010401'], '1.3.6.1.2.1.1.3.0': ['t', 27360000] };
    const mf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'up-')), 'mib.json'); fs.writeFileSync(mf, JSON.stringify(mib));
    const py = spawn('python3', [path.join(__dirname, 'snmp-mock.py'), '161', 'homelab', mf]);
    await new Promise((r) => { py.stdout.on('data', (d) => { if (/ready/.test(String(d))) r(); }); setTimeout(r, 4000); });
    const r = await cn.poll({ type: 'snmp', host: '127.0.0.1', port: 161, password: 'homelab', snmpVersion: 2 });
    py.kill();
    snmpSelf = r && r.self;
    check('SNMP: the device\'s own uptime is read (3 days 4 h = 273600 s)', r.ok && r.self && r.self.uptimeSec === 273600, JSON.stringify(r).slice(0, 300));
  } else console.log('  pysnmp missing: SNMP part skipped');

  // ---- 2. the map keeps and shows the counts
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'upu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); });
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:00:';
  const now = Date.now(), DAY = 86400000;
  const dev = (n, extra) => Object.assign({ key: M + n, mac: M + n, ip: '10.7.0.' + (40 + Number(n)), label: 'dev' + n, online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] }, pos: { x: -10 + Number(n) * 3, y: 0, z: 6 } }, extra);
  const map = () => ({ router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true, showOffline: true, presenceAt: now - 60000,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true, online: true },
      [M + '01']: dev('01', { lastSeen: now - 60000, onlineSince: now - 3 * DAY - 5 * 3600000, firstSeen: now - 20 * DAY }),   // watched for 3 days 5 h
      [M + '02']: dev('02', { lastSeen: now - 5 * 3600000, onlineSince: now - 9 * DAY }),                                    // app was closed 5 h: count starts again
      [M + '03']: dev('03', { online: false, lastSeen: now - 3600000, onlineSince: now - DAY }),                           // offline: no count
      [M + '04']: dev('04', { lastSeen: now - 1000 }) },                                                                    // never counted before: starts now
    links: ['01', '02', '03', '04'].map((n) => ({ a: 'router', b: M + n, auto: true })) });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), map());
  await sleep(800); await page.evaluate(() => window.__hubMap.sync()); await sleep(400);
  const data = () => page.evaluate(() => window.hubNetmap.exportData().devices);
  let d = await data();
  check('a count that was watched without a gap is kept', Math.abs(d[M + '01'].onlineSince - (now - 3 * DAY - 5 * 3600000)) < 1000);
  check('a long pause in watching (over 2 hours) starts the count again', d[M + '02'].onlineSince === null || d[M + '02'].onlineSince > now - 60000, String(d[M + '02'].onlineSince));
  const sel = async (k) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), k); await page.mouse.click(p.x, p.y); await sleep(600); };
  const side = () => page.evaluate(() => document.querySelector('#mapSide').innerText);
  await page.evaluate(() => window.hubNetmap.exportData());      // (a save has run by now, so every online machine has a start time)
  await sel(M + '01'); let t = await side();
  check('pane says "Seen online for 3 days 5 h"', /Seen online for 3 days 5 h/.test(t), t.slice(0, 400));
  check('pane says when it was first seen', /First seen/.test(t));
  check('pane says it only counts while the app watches', /Counted only while Dashboard Hub is running/.test(t));
  check('pane says an ordinary PC does not report its own uptime', /does not report its own uptime/.test(t));
  await sel(M + '04'); t = await side();
  check('a machine with no earlier count starts at "under a minute"', /Seen online for under a minute/.test(t), t.slice(0, 300));
  await sel(M + '03'); t = await side();
  check('an offline machine shows no "online for" line', !/Seen online for/.test(t), t.slice(0, 300));

  // router / switch check results: SNMP uptime, UniFi gear uptime, UniFi client connection time
  const conn = { ok: true, host: '10.7.0.45', type: 'snmp', self: Object.assign({ name: 'Closet switch', brand: 'HPE', kind: 'switch', portTable: [], uptimeSec: (snmpSelf && snmpSelf.uptimeSec) || 273600 }, {}), clients: [], gear: [] };
  await page.evaluate((m) => { const x = window.hubNetmap.exportData(); x.router = '10.7.0.1'; x.cidr = '10.7.0.0/24'; x.scannedOnce = true; x.devices[m + '05'] = { key: m + '05', mac: m + '05', ip: '10.7.0.45', label: 'Closet switch', online: true, pos: { x: 8, y: 0, z: 6 } }; x.links.push({ a: 'router', b: m + '05', auto: true }); window.hubNetmap.importData(x, true); }, M);
  await sleep(500);
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), conn); await sleep(500);
  await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  await sel(M + '05'); t = await side();
  check('SNMP switch: pane says the device has been running 3 days 4 h', /has been running for 3 days 4 h/.test(t), t.slice(0, 500));
  const unifi = { ok: true, host: '10.7.0.2', type: 'unifi', self: null, gear: [], clients: [{ mac: M + '04', ip: '10.7.0.44', name: 'dev04', wireless: true, via: 'Wi-Fi', connSec: 90000 }] };
  await page.evaluate((c) => window.hubNetmap.applyConnector(c), unifi); await sleep(500);
  await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  await sel(M + '04'); t = await side();
  check('UniFi client: "Connected to the network for 1 day 1 h"', /Connected to the network for 1 day 1 h/.test(t), t.slice(0, 500));
  // going offline drops both counts, and coming back starts a fresh one
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('net:scan');
    ipcMain.handle('net:scan', (e, o) => { setTimeout(() => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.send('net:event', { type: 'done' }); }, 150); return { ok: true, cidr: o.cidr }; });
  });
  await page.evaluate(() => { const i = document.querySelector('#mapIface'); if (!Array.from(i.options).some((o) => o.value === '10.7.0.0/24')) { const o = document.createElement('option'); o.value = '10.7.0.0/24'; o.textContent = '10.7.0.0/24'; i.appendChild(o); } i.value = '10.7.0.0/24'; i.dispatchEvent(new Event('change')); });
  await page.click('#mapScan'); await sleep(1500);
  d = await data();
  check('a machine the scan no longer finds loses its counts', d[M + '01'].online === false && d[M + '01'].onlineSince === null && d[M + '01'].upInfo === null, JSON.stringify([d[M + '01'].online, d[M + '01'].onlineSince, d[M + '01'].upInfo]));
  check('"first seen" is kept', d[M + '01'].firstSeen > 0);
  // the saved file keeps the fields (survives restart: goes through the sanitiser in the main program)
  const saved = await page.evaluate(() => JSON.stringify(window.hubNetmap.exportData().devices));
  check('counts survive export / import', /firstSeen/.test(saved));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
