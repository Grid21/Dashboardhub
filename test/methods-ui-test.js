'use strict';
//   xvfb-run -a node test/methods-ui-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  const secFile = path.join(ud, 'security.json');
  const open = async () => { await page.click('#settingsBtn'); await page.click('#securityMenuBtn'); await sleep(400); };
  const ids = { secProbe: 'scanProbe', secMdns: 'scanMdns', secSsdp: 'scanSsdp', secNb: 'scanNetbios', secRdns: 'scanReverseDns', secSnmpOn: 'snmpEnabled' };
  const states = () => page.evaluate((ids) => Object.keys(ids).map((i) => document.getElementById(i).checked), ids);
  const saved = () => JSON.parse(fs.readFileSync(secFile, 'utf8'));
  const dlgFits = () => page.evaluate(() => { const d = document.getElementById('securityDialog'); const b = d.getBoundingClientRect(); const btn = document.getElementById('secClose').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1 && btn.bottom <= innerHeight && btn.top >= b.top; });

  await open();
  check('the Security window has all six new switches', (await states()).length === 6);
  check('standard: every method is on', (await states()).every(Boolean));
  check('the window still fits the screen and keeps its Close button visible', await dlgFits());
  check('there is a "Quiet scan, no SNMP" button', await page.evaluate(() => !!document.getElementById('secQuiet')));
  await page.click('#secQuiet'); await sleep(500);
  check('Quiet scan turns off pings/ports, NetBIOS and SNMP, and nothing else', JSON.stringify(await states()) === JSON.stringify([false, true, true, false, true, false]), JSON.stringify(await states()));
  const f = saved();
  check('the choice is saved to disk', f.scanProbe === false && f.scanNetbios === false && f.snmpEnabled === false && f.scanMdns === true);
  await page.evaluate(() => { const e = document.getElementById('secMdns'); e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(400);
  check('a single switch saves on its own', saved().scanMdns === false);

  // the scan really obeys the setting: a real scan of the loopback network against a real open port
  const net = require('net'); const srv = net.createServer((c) => c.end());
  let listening = true; try { await new Promise((r, j) => { srv.once('error', j); srv.listen(80, '127.0.0.1', r); }); } catch (e) { listening = false; }
  if (listening) {
    const scan = () => page.evaluate(() => new Promise((res) => { const hosts = {}; window.netApi.onEvent((m) => { if (m.type === 'host') hosts[m.host.ip] = m.host; if (m.type === 'done') res(hosts); }); window.netApi.scan({ cidr: '127.0.0.0/30', mode: 'quick', router: '' }).then((r) => { if (r && r.ok === false) res({ error: r.error }); }); }));
    let hs = await scan();
    check('with Quiet settings the scan checks no ports', hs['127.0.0.1'] && hs['127.0.0.1'].ports.length === 0, JSON.stringify(hs['127.0.0.1'] && hs['127.0.0.1'].ports));
    await page.evaluate(() => { const e = document.getElementById('secProbe'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
    hs = await scan();
    check('switching "ping and check ports" back on makes the scan check ports again', hs['127.0.0.1'] && hs['127.0.0.1'].ports.some((p) => p.port === 80), JSON.stringify(hs['127.0.0.1'] && hs['127.0.0.1'].ports));
    await page.evaluate(() => { const e = document.getElementById('secProbe'); e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500);
  } else console.log('  (skipped real scan test: port 80 not available)');
  srv.close();

  // restart: settings survive and are applied
  await app.close();
  const app2 = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const p2 = await app2.firstWindow(); await p2.waitForSelector('#tabMap');
  await p2.click('#settingsBtn'); await p2.click('#securityMenuBtn'); await sleep(500);
  const st2 = await p2.evaluate((ids) => Object.keys(ids).map((i) => document.getElementById(i).checked), ids);
  check('after a restart the choices are still there', JSON.stringify(st2) === JSON.stringify([false, false, true, false, true, false]), JSON.stringify(st2));
  // SNMP finder refuses with a clear message while SNMP is off
  const finder = await p2.evaluate(() => window.connApi && window.connApi.findSnmp ? window.connApi.findSnmp({ ips: ['192.168.0.5'], communities: ['public'] }) : 'no-api');
  check('the SNMP finder says plainly that SNMP is off', finder && finder.ok === false && /SNMP is turned off/.test(finder.error || ''), JSON.stringify(finder));
  await p2.click('#secDefault'); await sleep(500);
  check('"Standard settings" brings every method back', (await p2.evaluate((ids) => Object.keys(ids).map((i) => document.getElementById(i).checked), ids)).every(Boolean));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app2.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
