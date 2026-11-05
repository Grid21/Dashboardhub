'use strict';
//   xvfb-run -a node test/speed-ui-test.js
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
  const dev = (n, ip, label, extra) => Object.assign({ key: M + n, mac: M + n, ip: ip, label: label, online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } }, extra || {});
  const at = (wireless, speed, speedRx) => ({ via: wireless ? '5 GHz Wi-Fi' : 'switch port 7', speed: speed, speedRx: speedRx, signal: null, by: 'Test', parentKey: 'router', parentName: 'Router', wireless: wireless, timestamp: Date.now() });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [M + '01']: dev('01', '10.7.0.21', 'Laptop', { attach: at(true, 866.7, 780) }), [M + '02']: dev('02', '10.7.0.22', 'NAS', { attach: at(false, 2500, null) }), [M + '03']: dev('03', '10.7.0.9', 'This PC', { self: true }), [M + '04']: dev('04', '10.7.0.24', 'Desk PC') },
    links: [{ a: 'router', b: M + '01', auto: true, wireless: true }, { a: 'router', b: M + '02', auto: true }, { a: 'router', b: M + '03', auto: true }, { a: 'router', b: M + '04', auto: false, cable: true }] });
  await sleep(800); await page.evaluate(() => window.__hubMap.sync()); await page.click('#mapTidy'); await sleep(1500); await page.evaluate(() => window.__hubMap.sync()); await sleep(500);
  const read = async (key) => {
    const p = await page.evaluate((k) => window.__hubMap.screenOf(k), key);
    await page.mouse.click(p.x, p.y); await sleep(400);
    return page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' '));
  };
  const t1 = await read(M + '01');
  check('Wi-Fi device pane shows both speeds', /Link speed.*866\.7 Mbps.*780 Mbps/.test(t1), t1.slice(0, 300));
  const t2 = await read(M + '02');
  check('wired device pane shows 2.5 Gbps', /Link speed 2\.5 Gbps/.test(t2), t2.slice(0, 300));
  const t3 = await read(M + '03');
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(500);
  const t3b = await read(M + '03');
  check('this computer shows its own link speed', /Link speed 2\.5 Gbps/.test(t3b), t3b.slice(0, 300));
  // a machine on a cable you drew (no router report): set the speed by hand
  const t4 = await read(M + '04');
  check('no report: says so and offers to set it', /Link speed Not reported/.test(t4), t4.slice(0, 260));
  await page.selectOption('#mapSpeedSel', '1000'); await sleep(300);
  const t4b = await page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' '));
  check('speed set by hand shows as set by you', /Link speed 1 Gbps \(set by you\)/.test(t4b), t4b.slice(0, 260));
  await page.selectOption('#mapSpeedSel', '2500'); await sleep(300);
  const t2b = await read(M + '02');
  check('hand-set speed beats the reported one only for that machine', /Link speed 2\.5 Gbps/.test(t2b));
  check('hand-set speed is kept in the saved map', await page.evaluate((k) => state.network.devices[k].speedSet === 2500 || window.hubNetmap.exportData().devices[k].speedSet === 2500, M + '04'));
  // a switch that is polled by SNMP and sees the router on its uplink port
  await page.evaluate((M) => { const d = window.hubNetmap.exportData(); d.devices[M + '05'] = { key: M + '05', mac: M + '05', ip: '10.7.0.5', label: 'Core switch', online: true, osOverride: 'switch', os: { id: 'switch', label: 'Switch', confidence: 'high', reasons: [] } }; d.devices.router.mac = 'aa:aa:aa:00:00:01'; d.links.push({ a: 'router', b: M + '05', auto: true }); window.hubNetmap.importData(d, true); state.network.devices.router.mac = 'aa:aa:aa:00:00:01'; }, M);
  await sleep(500);
  await page.evaluate((M) => window.hubNetmap.applyConnector({ ok: true, host: '10.7.0.5', type: 'snmp', self: { name: 'Core switch', kind: 'switch' }, clients: [{ mac: 'aa:aa:aa:00:00:01', ip: '10.7.0.1', viaPort: 'Gi24', speed: 10000, wireless: false, via: 'switch port Gi24' }], gear: [] }), M);
  await sleep(300);
  const up = await page.evaluate((M) => window.hubNetmap.exportData().devices[M + '05'].uplinkSpeed, M);
  check('a polled switch records the speed of its uplink port toward the router', up === 10000, String(up));
  await page.click('#mapTidy'); await sleep(900);
  const t5 = await read(M + '05');
  check('switch pane shows the uplink speed', /Uplink speed 10 Gbps/.test(t5), t5.slice(0, 300));
  const exp = await page.evaluate(() => JSON.stringify(window.hubNetmap.exportData()));
  const v = require(path.join(ROOT, 'validate.js')).cleanNetwork(JSON.parse(exp));
  check('backup keeps link speeds', v.devices[M + '01'].attach.speed === 866.7 && v.devices[M + '01'].attach.speedRx === 780 && v.devices[M + '03'].linkSpeed.mbps === 2500, JSON.stringify(v.devices[M + '01'].attach));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await sleep(100);
  await app.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
