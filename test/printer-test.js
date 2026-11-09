'use strict';
//   xvfb-run -a node test/printer-test.js
const path = require('path'), fs = require('fs'), os = require('os'), { spawn, spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const sc = require(path.join(ROOT, 'scanner.js')), cn = require(path.join(ROOT, 'connectors.js'));
  const g = sc.guessOs;
  const P = (n) => ({ port: n });
  check('raw printing port + IPP = printer', g({ ip: '10.0.0.40', ttl: 64, ports: [P(9100), P(631), P(80)], vendor: '', hostname: '' }, '10.0.0.1').id === 'printer');
  check('Epson with its name and a printing port = printer', g({ ip: '10.0.0.41', ttl: 64, ports: [P(80), P(9100)], vendor: 'Seiko Epson Corporation', hostname: 'EPSON-A1B2C3' }, '10.0.0.1').id === 'printer');
  check('Epson with only a web page (no printing port) is still a printer from its name', g({ ip: '10.0.0.42', ttl: 64, ports: [P(80)], vendor: 'Seiko Epson Corporation', hostname: 'EPSON-WF-3720' }, '10.0.0.1').id === 'printer');
  check('a web page that says "printer" counts', g({ ip: '10.0.0.43', ttl: 64, ports: [{ port: 80, title: 'Brother HL-L2350DW series' }], vendor: '', hostname: '' }, '10.0.0.1').id === 'printer');
  check('a Windows PC sharing a printer is not mistaken for one', g({ ip: '10.0.0.44', ttl: 128, ports: [P(135), P(139), P(445), P(3389), P(515)], vendor: 'Dell', hostname: 'DESKTOP-1' }, '10.0.0.1').id === 'windows');
  check('a switch with SNMP is still a switch', g({ ip: '10.0.0.2', ttl: 64, ports: [P(80), P(161)], vendor: 'Hewlett Packard Enterprise', hostname: 'OfficeConnect 1820' }, '10.0.0.1').id === 'switch');
  check('the router is still the router', g({ ip: '10.0.0.1', ttl: 64, ports: [P(80), P(53)], vendor: 'ASUSTek', hostname: '' }, '10.0.0.1').id === 'network');

  // an Epson answering SNMP
  if (spawnSync('python3', ['-c', 'import pysnmp']).status === 0) {
    const mib = { '1.3.6.1.2.1.1.5.0': ['s', 'EPSON123456'], '1.3.6.1.2.1.1.1.0': ['s', 'EPSON Built-in multifunction Print Server'], '1.3.6.1.2.1.2.2.1.3.1': ['i', 6], '1.3.6.1.2.1.2.2.1.8.1': ['i', 1], '1.3.6.1.2.1.31.1.1.1.1.1': ['s', 'eth0'], '1.3.6.1.2.1.31.1.1.1.15.1': ['i', 100] };
    const mf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-')), 'mib.json'); fs.writeFileSync(mf, JSON.stringify(mib));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const py = spawn('python3', [path.join(__dirname, 'snmp-mock.py'), String(port), 'public', mf]);
    await new Promise((r) => { py.stdout.on('data', (d) => { if (/ready/.test(String(d))) r(); }); setTimeout(r, 4000); });
    const r = await cn.poll({ type: 'snmp', host: '127.0.0.1', port: port, password: 'public', snmpVersion: 2 });
    check('SNMP poll of an Epson says it is a printer', r.ok && r.self.kind === 'printer' && r.self.brand === 'Epson', JSON.stringify(r.self && { k: r.self.kind, b: r.self.brand }));
    py.kill();
  }

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'pru-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); }); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const E = 'aa:bb:cc:00:00:30';
  // the Epson was earlier labelled a switch (by the old SNMP rule)
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [E]: { key: E, mac: E, ip: '10.7.0.30', label: 'EPSON123456', online: true, osOverride: 'switch', os: { id: 'switch', label: 'Switch', confidence: 'low', reasons: [] } } }, links: [{ a: 'router', b: E, auto: true }] });
  await sleep(500);
  await page.evaluate((E) => window.hubNetmap.applyConnector({ ok: true, host: '10.7.0.30', type: 'snmp', self: { name: 'EPSON123456', kind: 'printer', brand: 'Epson', portTable: [{ name: 'eth0', up: true, speed: 100 }] }, clients: [], gear: [] }), E);
  await sleep(300);
  const dd = await page.evaluate((E) => window.hubNetmap.exportData().devices[E], E);
  check('an SNMP printer that was labelled a switch is corrected to printer', dd.osOverride === 'printer', dd.osOverride);
  await page.evaluate(() => window.__hubMap.sync()); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1200); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  const p = await page.evaluate((k) => window.__hubMap.screenOf(k), E); await page.mouse.click(p.x, p.y); await sleep(500);
  const side = await page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' '));
  check('device pane says Printer', /System\s+Printer/.test(side), side.slice(0, 300));
  const opts = await page.evaluate(() => [...document.querySelectorAll('#mapTypeSel option')].map((o) => o.textContent));
  check('"Printer" can be chosen in the type menu', opts.some((o) => /^Printer/.test(o)), JSON.stringify(opts));
  check('legend has a Printer colour key', await page.evaluate(() => [...document.querySelectorAll('#mapLegend [data-type]')].some((x) => x.dataset.type === 'printer' && /Printer/.test(x.textContent))));
  await page.selectOption('#mapTypeSel', 'switch'); await sleep(300); await page.selectOption('#mapTypeSel', 'printer'); await sleep(300);
  const v = require(path.join(ROOT, 'validate.js')).cleanNetwork(JSON.parse(JSON.stringify(await page.evaluate(() => window.hubNetmap.exportData()))));
  check('backups keep the printer type', v.devices[E].osOverride === 'printer', v.devices[E].osOverride);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
