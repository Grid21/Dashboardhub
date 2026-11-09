'use strict';
//   xvfb-run -a node test/ports2-test.js      (ports of a UniFi switch and gateway, shown in the device pane)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cn = require(path.join(ROOT, 'connectors.js'));
  const SW = 'aa:bb:cc:00:00:10', GW = 'aa:bb:cc:00:00:01', PC = 'aa:bb:cc:00:00:21', NAS = 'aa:bb:cc:00:00:22';
  const data = {
    '/stat/sta': [{ mac: PC, ip: '10.7.0.21', name: 'Desk PC', is_wired: true, sw_mac: SW, sw_port: 2, wired_rate_mbps: 1000 }, { mac: NAS, ip: '10.7.0.22', name: 'NAS', is_wired: true, sw_mac: SW, sw_port: 3 }],
    '/stat/device': [
      { mac: SW, ip: '10.7.0.2', name: 'Core switch', type: 'usw', model: 'US8', port_table: [{ port_idx: 1, name: 'Uplink', up: true, speed: 2500, is_uplink: true }, { port_idx: 2, name: 'Desk', up: true, speed: 1000 }, { port_idx: 3, name: 'NAS', up: true, speed: 10000 }, { port_idx: 4, up: false, speed: 0 }] },
      { mac: GW, ip: '10.7.0.1', name: 'Gateway', type: 'udm', model: 'UDM', port_table: [{ port_idx: 1, name: 'WAN', up: true, speed: 1000 }, { port_idx: 2, name: 'LAN 1', up: true, speed: 2500 }, { port_idx: 3, up: false }] }]
  };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (x) => { b += x; });
    req.on('end', () => {
      if (req.url === '/api/auth/login') { res.statusCode = 404; res.end('{}'); return; }
      if (req.url === '/api/login') { res.setHeader('set-cookie', 'unifises=abc; path=/'); res.end('{"meta":{"rc":"ok"}}'); return; }
      const m = /^\/api\/s\/default(\/.*)$/.exec(req.url);
      if (m && /unifises=abc/.test(req.headers.cookie || '') && data[m[1]]) { res.end(JSON.stringify({ data: data[m[1]] })); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const res = await cn.poll({ type: 'unifi', host: '127.0.0.1', port: srv.address().port, https: false, username: 'u', password: 'p' });
  const sw = res.ok && res.gear.find((g) => g.mac === SW);
  check('UniFi poll carries every port of each switch with link state and speed', sw && sw.portTable.length === 4 && sw.portTable[0].uplink === true && sw.portTable[2].speed === 10000 && sw.portTable[3].up === false && sw.portTable[3].speed === null, JSON.stringify(sw && sw.portTable));

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'p2-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); }); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const dev = (mac, ip, label) => ({ key: mac, mac: mac, ip: ip, label: label, online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true, mac: GW }, [SW]: Object.assign(dev(SW, '10.7.0.2', 'Core switch'), { osOverride: 'switch' }), [PC]: dev(PC, '10.7.0.21', 'Desk PC'), [NAS]: dev(NAS, '10.7.0.22', 'NAS') },
    links: [{ a: 'router', b: SW, auto: true }, { a: SW, b: PC, auto: true }, { a: SW, b: NAS, auto: true }] });
  await sleep(500);
  await page.evaluate((r) => window.hubNetmap.applyConnector(r), res); await sleep(500);
  await page.evaluate(() => window.__hubMap.sync()); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1200); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  const read = async (key) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), key); await page.mouse.click(p.x, p.y); await sleep(500); return page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' ')); };
  const t = await read(SW);
  try { await (await page.$('#mapSide')).screenshot({ path: path.join(ROOT, 'test', 'ports-shot.png') }); } catch (e) { /* picture is optional */ }
  check('switch pane: ports with speeds, 3 in use of 4', /Ports \(3 in use of 4\)/.test(t) && /2\.5 Gbps/.test(t) && /10 Gbps/.test(t), t.slice(0, 500));
  check('switch pane: names what is plugged into port 2 and 3', /2 .*1 Gbps.*Desk PC/.test(t) && /3 .*10 Gbps.*NAS/.test(t), t);
  check('switch pane: port 1 is tagged as the uplink', /uplink/i.test(t));
  const g = await read('router');
  check('main router (gateway) pane: its own ports, WAN and LAN speeds', /Ports \(2 in use of 3\)/.test(g) && /2\.5 Gbps/.test(g), g.slice(0, 500));
  const exp = JSON.stringify(await page.evaluate(() => window.hubNetmap.exportData()));
  const v = require(path.join(ROOT, 'validate.js')).cleanNetwork(JSON.parse(exp));
  check('backup keeps the ports and the uplink port', v.devices[SW].portTable.length === 4 && v.devices[SW].uplinkPort === '1' && v.devices.router.portTable.length === 3, JSON.stringify([v.devices[SW].uplinkPort, v.devices.router.portTable.length]));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
