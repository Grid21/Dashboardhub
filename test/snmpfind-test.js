'use strict';
//   xvfb-run -a node test/snmpfind-test.js      (needs python3 + pysnmp, and permission to listen on UDP port 161 on 127.0.0.1)
const path = require('path'), fs = require('fs'), os = require('os'), { spawn, spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (spawnSync('python3', ['-c', 'import pysnmp']).status !== 0) { console.log('  pysnmp missing: skipped'); process.exit(0); }
  const cn = require(path.join(ROOT, 'connectors.js'));
  const mib = { '1.3.6.1.2.1.1.5.0': ['s', 'Core switch'], '1.3.6.1.2.1.1.1.0': ['s', 'HPE OfficeConnect 1820 48G Switch J9984A, 1.0.0'], '1.3.6.1.2.1.1.2.0': ['x', '2b06010401'] };
  const mf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-')), 'mib.json'); fs.writeFileSync(mf, JSON.stringify(mib));
  const py = spawn('python3', [path.join(__dirname, 'snmp-mock.py'), '161', 'homelab', mf]);
  let err = ''; py.stderr.on('data', (d) => { err += d; });
  await new Promise((r) => { py.stdout.on('data', (d) => { if (/ready/.test(String(d))) r(); }); setTimeout(r, 4000); });
  let a = await cn.snmpProbe('127.0.0.1', ['public', 'homelab'], 161);
  check('finder: tries several names and finds the one that works', a.ok && a.community === 'homelab' && a.version === 2 && a.name === 'Core switch' && /HPE OfficeConnect/.test(a.descr), JSON.stringify(a) + err.slice(0, 200));
  a = await cn.snmpProbe('127.0.0.1', ['public'], 161);
  check('finder: wrong name stays silent (reported as no answer)', !a.ok, JSON.stringify(a));
  a = await cn.snmpProbe('8.8.8.8', ['public'], 161);
  check('finder: refuses addresses outside your own network', !a.ok && /own network/.test(a.error || ''), JSON.stringify(a));
  const t0 = Date.now(); a = await cn.snmpProbe('127.0.0.2', ['public'], 161);
  check('finder: a silent machine is given up on within about 6 seconds', !a.ok && Date.now() - t0 < 6500, String(Date.now() - t0));

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); }); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const mk = (n, ip, label) => ({ key: 'aa:bb:cc:00:00:' + n, mac: 'aa:bb:cc:00:00:' + n, ip: ip, label: label, online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, 'aa:bb:cc:00:00:01': mk('01', '127.0.0.1', 'Closet switch'), 'aa:bb:cc:00:00:02': mk('02', '127.0.0.2', 'Silent PC') }, links: [{ a: 'router', b: 'aa:bb:cc:00:00:01', auto: true }, { a: 'router', b: 'aa:bb:cc:00:00:02', auto: true }] });
  await sleep(500);
  await page.evaluate(() => document.getElementById('mapConnBtn').click()); await sleep(500);
  await page.click('#snmpFind summary'); await sleep(200);
  await page.fill('#snmpFindNames', 'public, homelab');
  await page.click('#snmpFindGo');
  await page.waitForFunction(() => /^(Done|Stopped)/.test(document.getElementById('snmpFindMsg').textContent), null, { timeout: 40000 });
  const msg = await page.textContent('#snmpFindMsg');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#snmpFindList .conn-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('search lists only the machine that answered, with its name, brand and community', rows.length === 1 && /127\.0\.0\.1/.test(rows[0]) && /Core switch/.test(rows[0]) && /HPE/.test(rows[0]) && /"homelab"/.test(rows[0]), JSON.stringify(rows));
  check('summary says 1 of 3 answered (router, switch, silent PC)', /1 of 3 machines answered SNMP/.test(msg), msg);
  await page.click('#snmpFindList .conn-row button'); await sleep(2500);
  const saved = await page.evaluate(() => window.connApi.list());
  check('"Add" saves it as an SNMP connection with that community name', saved.list.length === 1 && saved.list[0].type === 'snmp' && saved.list[0].host === '127.0.0.1', JSON.stringify(saved.list).slice(0, 300));
  check('it then shows in the connection list', /127\.0\.0\.1/.test(await page.evaluate(() => document.getElementById('connList').innerText)));
  await page.click('#snmpFindGo');
  await page.waitForFunction(() => /^(Done|Stopped)/.test(document.getElementById('snmpFindMsg').textContent), null, { timeout: 40000 });
  check('searching again marks it "Already added"', /Already added/.test(await page.evaluate(() => document.getElementById('snmpFindList').innerText)));
  const bad = await page.evaluate(() => window.connApi.findSnmp({ ips: ['8.8.8.8', '127.0.0.1'], communities: ['public'] }));
  check('the app side refuses outside addresses too', bad.ok && bad.found.length === 0 && bad.silent.length === 1, JSON.stringify(bad));
  const none = await page.evaluate(() => window.connApi.findSnmp({ ips: ['127.0.0.1'], communities: [] }));
  check('no community names gives a plain message', !none.ok && /community name/.test(none.error), JSON.stringify(none));
  check('no page errors', errors.length === 0, errors.join(' | '));
  py.kill(); await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
