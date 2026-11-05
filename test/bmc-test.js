'use strict';
//   xvfb-run -a node test/bmc-test.js     (server management: pretend Redfish chip, then the app)
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const B = require('../bmc.js');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let powerState = 'Off'; const posts = [];
  const GOOD = 'Basic ' + Buffer.from('admin:secret').toString('base64');
  const srv = http.createServer((req, res) => {
    const send = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== GOOD) return send({ error: 'no' }, 401);
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = req.url;
      if (req.method === 'POST' && u === '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset') { posts.push(JSON.parse(body)); if (JSON.parse(body).ResetType === 'On') powerState = 'On'; return send({}, 204 === 0 ? 204 : 200); }
      if (u === '/redfish/v1/' || u === '/redfish/v1') return send({ Systems: { '@odata.id': '/redfish/v1/Systems' }, Managers: { '@odata.id': '/redfish/v1/Managers' }, Chassis: { '@odata.id': '/redfish/v1/Chassis' } });
      if (u === '/redfish/v1/Systems') return send({ Members: [{ '@odata.id': '/redfish/v1/Systems/1' }] });
      if (u === '/redfish/v1/Systems/1') return send({ PowerState: powerState, Status: { Health: 'OK', HealthRollup: 'Warning' }, Manufacturer: 'HPE', Model: 'ProLiant DL360 Gen10', SerialNumber: 'CZ123', BiosVersion: 'U32 v2.60', ProcessorSummary: { Count: 2, Model: 'Intel Xeon Silver 4210' }, MemorySummary: { TotalSystemMemoryGiB: 128 }, Actions: { '#ComputerSystem.Reset': { target: '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset', 'ResetType@Redfish.AllowableValues': ['On', 'ForceOff', 'GracefulShutdown', 'GracefulRestart'] } } });
      if (u === '/redfish/v1/Managers') return send({ Members: [{ '@odata.id': '/redfish/v1/Managers/1' }] });
      if (u === '/redfish/v1/Managers/1') return send({ Model: 'iLO 5', FirmwareVersion: 'iLO 5 v2.78' });
      if (u === '/redfish/v1/Chassis') return send({ Members: [{ '@odata.id': '/redfish/v1/Chassis/1' }] });
      if (u === '/redfish/v1/Chassis/1') return send({ Thermal: { '@odata.id': '/redfish/v1/Chassis/1/Thermal' }, Power: { '@odata.id': '/redfish/v1/Chassis/1/Power' } });
      if (u === '/redfish/v1/Chassis/1/Thermal') return send({ Temperatures: [{ Name: '01-Inlet Ambient', ReadingCelsius: 22, Status: { Health: 'OK' } }, { Name: '02-CPU 1', ReadingCelsius: 41 }], Fans: [{ Name: 'Fan 1', Reading: 28, ReadingUnits: 'Percent', Status: { Health: 'OK' } }] });
      if (u === '/redfish/v1/Chassis/1/Power') return send({ PowerControl: [{ PowerConsumedWatts: 135 }] });
      send({}, 404);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const cfg = { host: '127.0.0.1', port: port, https: false, username: 'admin', password: 'secret', name: 'DL360' };
  // ---- the library ----
  const s = await B.status(cfg);
  check('status works', s.ok === true, JSON.stringify(s).slice(0, 200));
  check('power state, health, model', s.power === 'Off' && s.health === 'Warning' && /DL360/.test(s.model) && s.manufacturer === 'HPE');
  check('serial, BIOS, BMC firmware', s.serial === 'CZ123' && /U32/.test(s.bios) && s.bmc && /iLO 5/.test(s.bmc.model) && /2.78/.test(s.bmc.firmware));
  check('cpus and memory', /2 .* Xeon/.test(s.cpus) && s.memoryGiB === 128);
  check('temperatures, fans, watts', s.temps.length === 2 && s.temps[1].c === 41 && s.fans[0].reading === 28 && s.watts === 135);
  check('power actions offered', s.canOn && s.canShutdown && s.canRestart);
  const bad = await B.status(Object.assign({}, cfg, { password: 'wrong' }));
  check('wrong password: clear message', bad.ok === false && bad.code === 'auth' && /password/.test(bad.error));
  const gone = await B.status(Object.assign({}, cfg, { port: 1 }));
  check('nothing listening: clear message', gone.ok === false && /Nothing answered|No answer/.test(gone.error), JSON.stringify(gone));
  const pub = await B.status(Object.assign({}, cfg, { host: '8.8.8.8' }));
  check('public addresses are refused', pub.ok === false && pub.code === 'config');
  const stop = await B.power(cfg, 'shutdown');
  check('shutdown while off is refused politely', stop.ok === false && /off/.test(stop.error));
  const on = await B.power(cfg, 'on');
  check('power on sends ResetType On', on.ok === true && posts.length === 1 && posts[0].ResetType === 'On', JSON.stringify([on, posts]));
  const again = await B.power(cfg, 'on');
  check('power on when already on does nothing', again.ok === true && /already on/.test(again.message) && posts.length === 1);
  const sd = await B.power(cfg, 'shutdown');
  check('graceful shutdown sends GracefulShutdown', sd.ok === true && posts[1] && posts[1].ResetType === 'GracefulShutdown');
  check('unknown action refused', (await B.power(cfg, 'explode')).ok === false);
  // ---- the app ----
  powerState = 'Off'; posts.length = 0;
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [], gateway: null })); });
  await page.click('#tabMap'); await sleep(400);
  const M = 'aa:bb:cc:00:00:';
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.9.0.1', cidr: '10.9.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.9.0.1', isRouter: true }, [M + '01']: { key: M + '01', mac: M + '01', ip: '10.9.0.50', label: 'Dad\'s server', online: false, os: { id: 'linux', label: 'Linux', confidence: 'high', reasons: [] } } },
    links: [{ a: 'router', b: M + '01', auto: true }] });
  await sleep(400); await page.click('#mapTidy'); await sleep(700);
  await page.evaluate(() => { document.getElementById('mapOffline').checked = true; document.getElementById('mapOffline').dispatchEvent(new Event('change')); }); await sleep(700);
  // add the server (the dialog does the same call)
  const saved = await page.evaluate(async (a) => window.bmcApi.save(Object.assign({}, a.cfg, { mac: a.mac })), { cfg: cfg, mac: M + '01' });
  check('saving tests the login first and keeps it', saved.ok === true && saved.list.length === 1 && !('password' in saved.list[0]), JSON.stringify(saved).slice(0, 200));
  const badSave = await page.evaluate(async (cfg) => window.bmcApi.save(Object.assign({}, cfg, { password: 'nope', host: '127.0.0.1' })), cfg);
  check('a wrong login is not saved', badSave.ok === false);
  await page.evaluate(() => window.bmcApi.list().then(() => 0)); await page.evaluate(() => document.getElementById('bmcMenuBtn').click()); await sleep(600);
  await page.evaluate(() => document.getElementById('bmcClose').click()); await sleep(200);
  const q = await page.evaluate((k) => window.__hubMap.screenOf(k), M + '01'); await page.mouse.click(q.x, q.y); await sleep(1500);
  const pane = await page.evaluate(() => (document.querySelector('#mapSide .bmc-pane') || {}).innerText || '');
  check('the machine pane shows the server management section', /Power: Off/.test(pane) && /Health: Warning/.test(pane) && /DL360/.test(pane) && /135 W/.test(pane), pane.replace(/\s+/g, ' ').slice(0, 300));
  check('Power on button is offered', await page.evaluate(() => !![...document.querySelectorAll('#mapSide .bmc-pane button')].find((b) => /Power on/.test(b.textContent))));
  await page.evaluate(() => [...document.querySelectorAll('#mapSide .bmc-pane button')].find((b) => /Power on/.test(b.textContent)).click()); await sleep(1500);
  check('clicking Power on reaches the chip', posts.length === 1 && posts[0].ResetType === 'On', JSON.stringify(posts));
  // the Wake-on-LAN button also uses the management chip
  powerState = 'Off'; posts.length = 0;
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:wake'); ipcMain.handle('net:wake', () => ({ ok: true })); });
  await page.evaluate(() => { const d = state.network.devices['aa:bb:cc:00:00:01']; d.online = false; });
  await page.evaluate(() => window.hubNetmap.refresh()); await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll('#mapSide .wake-btn')][0] && [...document.querySelectorAll('#mapSide .wake-btn')][0].click()); await sleep(1500);
  check('the Wake up button also powers it on through the management chip', posts.length === 1 && posts[0].ResetType === 'On', JSON.stringify(posts));
  // backup keeps the server list without passwords
  const pb = require(path.join(ROOT, 'validate.js')).parseBackup(JSON.stringify({ app: 'dashboard-hub', format: 1, panels: [], servers: [], bmc: [{ name: 'DL360', host: '10.1.1.9', port: 443, https: true, username: 'admin', password: 'SHOULD-NOT-SURVIVE', mac: 'AA:BB:CC:00:00:01' }, { host: '8.8.8.8x' }] }));
  check('backup validation keeps the entry, drops the password and bad rows', pb.ok && pb.data.bmc.length === 1 && !JSON.stringify(pb.data.bmc).includes('SHOULD-NOT') && pb.data.bmc[0].mac === 'aa:bb:cc:00:00:01', JSON.stringify(pb.data && pb.data.bmc));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close(); srv.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
