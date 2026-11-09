'use strict';
//   xvfb-run -a node test/refresh-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // the packaged map file must be real multi-line code, not one long line
  const nm = fs.readFileSync(path.join(ROOT, 'netmap.js'), 'utf8');
  check('netmap.js is normal multi-line code', nm.split('\n').length > 2000 && !/\\n\s*\(function/.test(nm.slice(0, 400)));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'rf-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => {
    global.__polls = 0; global.__conns = [];
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} }));
    ipcMain.removeHandler('conn:list'); ipcMain.handle('conn:list', () => ({ ok: true, list: global.__conns, types: {}, canEncrypt: true }));
    ipcMain.removeHandler('conn:poll'); ipcMain.handle('conn:poll', () => {
      global.__polls++;
      if (!global.__conns.length) return { ok: true, results: [], list: [] };
      return { ok: true, list: global.__conns, results: [{ ok: true, name: 'Test AP', host: '10.7.0.2', type: 'unifi', self: { name: 'Test AP', kind: 'ap' }, clients: [{ mac: 'aa:bb:cc:00:00:01', ip: '10.7.0.21', speed: 866.7, speedRx: 780, wireless: true, via: '5 GHz Wi-Fi' }], gear: [] }] };
    });
  });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:00:';
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [M + '01']: { key: M + '01', mac: M + '01', ip: '10.7.0.21', label: 'Laptop', online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } } }, links: [{ a: 'router', b: M + '01', auto: true }] });
  await sleep(500);
  check('Settings menu no longer has the speed check', await page.evaluate(() => !document.getElementById('speedTestTargets')));
  const read = async (key) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), key); await page.mouse.click(p.x, p.y); await sleep(500); };
  await page.evaluate(() => window.__hubMap.sync()); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1200); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  await read(M + '01');
  check('device pane has Run LAN speedtest', await page.evaluate(() => !!document.getElementById('mapLanBtn') && /Run LAN speedtest/.test(document.getElementById('mapLanBtn').textContent)));
  await page.click('#mapLanBtn'); await sleep(900);
  let m = await page.textContent('#mapLanMsg');
  check('with no saved routers it says how to add one', /No router, access point or switch connections/.test(m), m);
  await app.evaluate(() => { global.__conns = [{ id: 'c1', name: 'Test AP', type: 'unifi', host: '10.7.0.2' }]; });
  await page.click('#mapLanBtn'); await sleep(1800);
  m = await page.textContent('#mapLanMsg');
  check('pane shows the reported rate and who reported it', /Laptop: .*866\.7 Mbps/.test(m) && /reported by/.test(m), m);
  check('the pane also shows it in Link speed', /866\.7 Mbps/.test(await page.evaluate(() => document.getElementById('mapSide').innerText)));
  const sp = await page.evaluate((M) => window.hubNetmap.exportData().devices[M + '01'].attach, M);
  check('the map device holds the speed', sp && sp.speed === 866.7 && sp.speedRx === 780, JSON.stringify(sp));
  // device list: tick two machines
  await page.evaluate((M) => { const d = window.hubNetmap.exportData(); d.devices[M + '02'] = { key: M + '02', mac: M + '02', ip: '10.7.0.22', label: 'Silent box', online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } }; d.links.push({ a: 'router', b: M + '02', auto: true }); window.hubNetmap.importData(d, true); }, M);
  await sleep(500);
  await page.click('#mapListBtn'); await sleep(500);
  await page.click('#mapListAll'); await sleep(300);
  const bulkBtn = await page.evaluate(() => [...document.querySelectorAll('#mapListBulk button')].some((b) => /Run LAN speedtest/.test(b.textContent)));
  check('device list has Run LAN speedtest for ticked machines', bulkBtn);
  await page.evaluate(() => [...document.querySelectorAll('#mapListBulk button')].find((b) => /Run LAN speedtest/.test(b.textContent)).click()); await sleep(1800);
  const lm = await page.evaluate(() => document.querySelector('#mapListBulk .ml-msg') ? document.querySelector('#mapListBulk .ml-msg').innerText : '');
  check('list result names each machine, and says "not reported" for the silent one', /Laptop: .*866\.7/.test(lm) && /Silent box: not reported/.test(lm), lm);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
