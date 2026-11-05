'use strict';
//   xvfb-run -a node test/guard-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  // pretend network: we control what the "computer" reports
  await app.evaluate(({ ipcMain }) => {
    global.__net = { gateway: '10.50.0.1', gatewayMac: 'aa:aa:aa:00:00:01' }; global.__scans = 0;
    ipcMain.removeHandler('net:interfaces'); ipcMain.removeHandler('net:scan');
    ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.50.0.9', cidr: '10.50.0.0/24' }], gateway: global.__net.gateway, gatewayMac: global.__net.gatewayMac }));
    ipcMain.handle('net:scan', () => { global.__scans++; return { ok: false, error: 'mock' }; });
  });
  const setNet = (gw, mac) => app.evaluate((_, a) => { global.__net = { gateway: a[0], gatewayMac: a[1] }; }, [gw, mac]);
  const scans = () => app.evaluate(() => global.__scans);
  const guard = () => page.evaluate(() => window.hubNetmap.guardState());
  const banner = () => page.evaluate(() => { const e = document.getElementById('netGuard'); return e.classList.contains('hidden') ? '' : e.textContent; });
  await page.click('#tabMap'); await sleep(500);
  const M = 'aa:bb:cc:99:00:';
  const data = { router: '10.50.0.1', cidr: '10.50.0.0/24', scannedOnce: true, devices: { router: { key: 'router', ip: '10.50.0.1', isRouter: true }, [M + '20']: { key: M + '20', mac: M + '20', ip: '10.50.0.20', label: 'Office PC', online: true, os: { id: 'windows', label: 'windows', confidence: 'high', reasons: [] } } }, links: [{ a: 'router', b: M + '20', auto: true }] };
  await page.evaluate((d) => window.hubNetmap.importData(d, true), data); await sleep(300);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); });
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  let fp = await page.evaluate(() => JSON.parse(JSON.stringify(state.profiles[0].fp)));
  check('profile remembers its own network the first time', fp && fp.gw === '10.50.0.1' && fp.mac === 'aa:aa:aa:00:00:01', JSON.stringify(fp));
  check('same network: not blocked, no banner', !(await guard()).blocked && (await banner()) === '');
  await page.click('#mapScan'); await sleep(500);
  check('same network: scan goes ahead as before', (await scans()) === 1, await scans());
  const before = await page.evaluate(() => JSON.stringify(state.profiles[0].network || state.network));
  // different network, same numbers, different router hardware
  await setNet('10.50.0.1', 'bb:bb:bb:00:00:09');
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  check('same address but different router hardware is caught', (await guard()).blocked);
  check('notice is shown', /different network/.test(await banner()), await banner());
  await page.click('#mapScan'); await sleep(500);
  check('scan refused while blocked', (await scans()) === 1);
  const r = await page.evaluate(() => window.hubNetmap.applyConnector({ ok: true, host: '10.50.0.1', clients: [{ mac: 'de:ad:be:ef:00:01', ip: '10.50.0.77', name: 'Stranger', wireless: false }], gear: [] }));
  const ghost = await page.evaluate(() => Object.keys(state.network.devices).some((k) => /de:ad/.test(k)));
  check('router check results are not merged while blocked', !ghost && r.clients === 0);
  // different gateway entirely
  await setNet('192.168.8.1', 'cc:cc:cc:00:00:01');
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  check('different router address is caught', (await guard()).blocked && /192\.168\.8\.1/.test(await banner()));
  // new profile for this network
  await page.click('#netGuard button:has-text("New profile for this network")'); await sleep(700);
  const st = await page.evaluate(() => ({ n: state.profiles.length, active: state.profiles.findIndex((p) => p.id === state.activeProfileId), fp: state.profiles[1] && state.profiles[1].fp }));
  check('new profile created and active', st.n === 2 && st.active === 1, JSON.stringify(st));
  check('new profile learned the new network', st.fp && st.fp.gw === '192.168.8.1', JSON.stringify(st.fp));
  check('not blocked on the new profile', !(await guard()).blocked && (await banner()) === '');
  const orig = await page.evaluate(() => JSON.stringify(state.profiles[0].network));
  check('old profile map untouched', orig.includes('Office PC') && !/de:ad/.test(orig));
  // back at the office: banner offers the way back
  await setNet('10.50.0.1', 'aa:aa:aa:00:00:01');
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  check('going back to old network is noticed', (await guard()).blocked);
  check('asks the question about switching', /You\u2019re not on the right profile\. Would you like to automatically switch to the profile for this network/.test(await banner()), await banner());
  await page.click('#netGuard button:has-text("No, stay")'); await sleep(300);
  check('"No" keeps the profile, stays paused, does not ask again', (await guard()).blocked && /paused/.test(await banner()) && !/Would you like/.test(await banner()));
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  check('still not asked again on the next check', !/Would you like/.test(await banner()));
  const sw = await page.$('#netGuard button:has-text("Switch to")');
  check('banner still offers a manual switch', !!sw);
  if (sw) { await sw.click(); await sleep(700); }
  const a2 = await page.evaluate(() => ({ idx: state.profiles.findIndex((p) => p.id === state.activeProfileId), dev: Object.keys(state.network.devices).length }));
  check('switch lands on old profile with its map', a2.idx === 0 && a2.dev === 2, JSON.stringify(a2));
  check('no longer blocked', !(await guard()).blocked);
  await setNet('192.168.8.1', 'cc:cc:cc:00:00:01');
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  check('question shown again on another known network', /Would you like to automatically switch/.test(await banner()) && /Network 192/.test(await banner()), await banner());
  await page.click('#netGuard button:has-text("Yes, switch")'); await sleep(700);
  check('"Yes" switches by itself to that network\'s profile', (await page.evaluate(() => state.profiles.findIndex((p) => p.id === state.activeProfileId))) === 1 && !(await guard()).blocked);
  await page.evaluate(() => window.hubProfilesSwitch(state.profiles[0].id)); await sleep(600);
  // trust button
  await setNet('172.16.0.1', 'dd:dd:dd:00:00:01');
  await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  await page.click('#netGuard button:has-text("same network")'); await sleep(300);
  check('"same network" unblocks and relearns', !(await guard()).blocked && (await page.evaluate(() => state.profiles[0].fp.gw)) === '172.16.0.1');
  // lock
  await setNet('172.16.0.1', 'dd:dd:dd:00:00:01');
  await page.click('#profilesBtn'); await page.click('#profileLock'); await sleep(400);
  check('lock turns on', (await guard()).locked && /locked/.test(await banner()), await banner());
  const s0 = await scans(); await page.click('#mapScan'); await sleep(400);
  check('locked profile is not scanned', (await scans()) === s0);
  const r2 = await page.evaluate(() => window.hubNetmap.applyConnector({ ok: true, host: '10.50.0.1', clients: [{ mac: 'de:ad:be:ef:00:02', ip: '10.50.0.78', name: 'X', wireless: false }], gear: [] }));
  check('locked profile ignores router checks', r2.clients === 0);
  await page.click('#profilesBtn'); await page.click('#profileLock'); await sleep(400);
  check('unlock restores scanning', !(await guard()).locked && (await banner()) === '');
  await page.click('#mapScan'); await sleep(500);
  check('scan works again after unlock', (await scans()) === s0 + 1);
  // backup keeps lock + fingerprint
  const v = require(path.join(ROOT, 'validate.js'));
  const pb = v.parseBackup(JSON.stringify({ app: 'dashboard-hub', format: 1, panels: [], servers: [], profiles: [{ name: 'Client A', locked: true, fp: { gw: '10.1.1.1', mac: 'AA:BB:CC:00:11:22' }, network: null }, { name: 'Bad', fp: { gw: 'x' } }] }));
  const pp = pb.ok && pb.data.profiles;
  check('backup validation keeps lock and network fingerprint', pp && pp[0].locked === true && pp[0].fp.gw === '10.1.1.1' && pp[0].fp.mac === 'aa:bb:cc:00:11:22' && pp[1].fp === null, JSON.stringify(pb.ok ? pb.data.profiles : pb));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
