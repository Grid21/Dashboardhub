'use strict';
//   xvfb-run -a node test/ports-test.js     (the SNMP part needs python3 + pysnmp)
const path = require('path'), fs = require('fs'), os = require('os'), { spawn, spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cn = require(path.join(ROOT, 'connectors.js'));
  // ---- a switch answering over SNMP (independent pysnmp agent): port list with up/down and speed
  if (spawnSync('python3', ['-c', 'import pysnmp']).status === 0) {
    const mib = {};
    [[1, 'Gi1', 6, 1, 1000], [2, 'Gi2', 6, 1, 2500], [3, 'Gi3', 6, 2, 1000], [4, 'lo0', 24, 1, 0]].forEach(([i, n, ty, st, sp]) => {
      mib['1.3.6.1.2.1.2.2.1.3.' + i] = ['i', ty]; mib['1.3.6.1.2.1.2.2.1.8.' + i] = ['i', st];
      mib['1.3.6.1.2.1.31.1.1.1.1.' + i] = ['s', n]; mib['1.3.6.1.2.1.31.1.1.1.15.' + i] = ['i', sp];
    });
    mib['1.3.6.1.2.1.1.5.0'] = ['s', 'sw']; mib['1.3.6.1.2.1.1.1.0'] = ['s', 'test switch'];
    const mf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-')), 'mib.json'); fs.writeFileSync(mf, JSON.stringify(mib));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const py = spawn('python3', [path.join(__dirname, 'snmp-mock.py'), String(port), 'public', mf]);
    await new Promise((r) => { py.stdout.on('data', (d) => { if (/ready/.test(String(d))) r(); }); setTimeout(r, 4000); });
    const r = await cn.poll({ type: 'snmp', host: '127.0.0.1', port: port, password: 'public', snmpVersion: 2 });
    const pt = r.ok && r.self && r.self.portTable;
    check('SNMP poll returns the port table: names, up/down, speed (down ports have none)', pt && pt.length === 3 && pt[0].name === 'Gi1' && pt[0].up && pt[0].speed === 1000 && pt[1].speed === 2500 && !pt[2].up && pt[2].speed === null, JSON.stringify(r.self && r.self.portTable));
    py.kill();
  } else console.log('  (pysnmp not installed: SNMP part skipped)');

  // ---- the screen
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ptu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); }); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:00:';
  const os_ = { id: 'linux', label: 'linux', confidence: 'high', reasons: [] };
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true, mac: 'aa:aa:aa:00:00:01' },
      [M + '10']: { key: M + '10', mac: M + '10', ip: '10.7.0.2', label: 'Core switch', online: true, osOverride: 'switch', os: { id: 'switch', label: 'Switch', confidence: 'high', reasons: [] } },
      [M + '01']: { key: M + '01', mac: M + '01', ip: '10.7.0.21', label: 'NAS', online: true, os: os_ },
      [M + '02']: { key: M + '02', mac: M + '02', ip: '10.7.0.22', label: 'Desk PC', online: true, os: os_ },
      [M + '03']: { key: M + '03', mac: M + '03', ip: '10.7.0.23', label: 'Printer', online: true, os: os_ } },
    links: [{ a: 'router', b: M + '10', auto: true }, { a: M + '10', b: M + '01', auto: true }, { a: M + '10', b: M + '02', auto: true }, { a: M + '10', b: M + '03', auto: true }] });
  await sleep(600);
  // the switch answers: 6 ports, three machines on 1, 2 and 2 (one port shared), uplink on Gi6
  const res = { ok: true, host: '10.7.0.2', type: 'snmp', name: 'Core switch',
    self: { name: 'Core switch', kind: 'switch', brand: 'HPE', ports: 6, portTable: [{ name: 'Gi1', up: true, speed: 2500 }, { name: 'Gi2', up: true, speed: 1000 }, { name: 'Gi3', up: false, speed: null }, { name: 'Gi4', up: false, speed: null }, { name: 'Gi5', up: false, speed: null }, { name: 'Gi6', up: true, speed: 1000 }] },
    clients: [
      { mac: M + '01', ip: '10.7.0.21', viaPort: 'Gi1', speed: 2500, wireless: false, via: 'switch port Gi1', viaDeviceIp: '10.7.0.2' },
      { mac: M + '02', ip: '10.7.0.22', viaPort: 'Gi2', speed: 1000, wireless: false, via: 'switch port Gi2', viaDeviceIp: '10.7.0.2' },
      { mac: M + '03', ip: '10.7.0.23', viaPort: 'Gi2', speed: 1000, wireless: false, via: 'switch port Gi2', viaDeviceIp: '10.7.0.2' },
      { mac: 'aa:aa:aa:00:00:01', ip: '10.7.0.1', viaPort: 'Gi6', speed: 1000, wireless: false, via: 'switch port Gi6', viaDeviceIp: '10.7.0.2' }], gear: [] };
  await page.evaluate((r) => window.hubNetmap.applyConnector(r), res); await sleep(500);
  await page.evaluate(() => window.__hubMap.sync()); await page.click('#mapTidy'); await sleep(1300); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  const pick = async (key) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), key); await page.mouse.click(p.x, p.y); await sleep(500); };
  console.log('  (debug) portTable after tidy:', JSON.stringify(await page.evaluate((M) => window.hubNetmap.exportData().devices[M + '10'].portTable, M)));
  await pick(M + '10');
  const side = () => page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' '));
  let t = await side();
  check('switch pane shows Ports (3 in use of 6)', /Ports \(3 in use of 6\)/.test(t), t.slice(0, 500));
  const strip = await page.evaluate(() => [...document.querySelectorAll('#mapSide .port-sq')].map((b) => b.className.replace('port-sq ', '') + ':' + b.textContent));
  check('port strip: 6 squares, linked ones green, uplink marked', strip.length === 6 && /^up/.test(strip[0]) && /^down/.test(strip[2]) && /uplink/.test(strip[5]), JSON.stringify(strip));
  check('rows show port speeds', /Gi1 2\.5 Gbps/.test(t) && /Gi2 1 Gbps/.test(t), t.slice(0, 600));
  check('what is plugged into each port is named', /Gi1 2\.5 Gbps NAS/.test(t) && /Gi2 1 Gbps Desk PC Printer/.test(t), t.slice(0, 700));
  check('the uplink port is tagged', /Gi6 1 Gbps uplink/i.test(t), t.slice(0, 700));
  check('unused ports are hidden until asked', !/Gi4 no link/.test(t) && /Show 3 unused ports/.test(t));
  await page.evaluate(() => [...document.querySelectorAll('#mapSide button')].find((b) => /unused port/.test(b.textContent)).click()); await sleep(300);
  t = await side();
  check('"Show unused ports" lists the empty ones as "no link"', /Gi4 no link/.test(t) && /Hide unused ports/.test(t));
  await page.screenshot({ path: path.join(ROOT, 'test', 'ports-shot.png') });
  // click the NAS in the list -> its own pane
  await page.evaluate(() => [...document.querySelectorAll('#mapSide .port-dev')].find((b) => b.textContent === 'NAS').click()); await sleep(500);
  t = await side();
  check('clicking a name in a port row opens that machine', /NAS/.test(t.slice(0, 60)), t.slice(0, 120));
  check('the machine says which port it is plugged into, and its speed', /Connected to Core switch \(Cable\), port Gi1/.test(t) && /Link speed 2\.5 Gbps/.test(t), t.slice(0, 500));
  // backup keeps ports
  const exp = await page.evaluate(() => JSON.stringify(window.hubNetmap.exportData()));
  const v = require(path.join(ROOT, 'validate.js')).cleanNetwork(JSON.parse(exp));
  check('backup keeps the port table and the port a machine is on', v.devices[M + '10'].portTable.length === 6 && v.devices[M + '01'].attach.port === 'Gi1' && v.devices[M + '01'].attach.parentKey === M + '10', JSON.stringify(v.devices[M + '10'].portTable).slice(0, 80));
  // a device with no port list: built from what its clients said
  await page.evaluate((M) => { const d = window.hubNetmap.exportData(); d.devices[M + '10'].portTable = []; window.hubNetmap.importData(d, true); }, M);
  await sleep(500); await page.evaluate(() => window.__hubMap.sync()); await pick(M + '10'); t = await side();
  check('without a port table it still lists ports learned from machines on them, and says so', /Ports \(2 in use\)/.test(t) && /Built from what this device reported/.test(t), t.slice(0, 500));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
