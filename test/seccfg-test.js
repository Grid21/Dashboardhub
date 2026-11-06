'use strict';
//   xvfb-run -a node test/seccfg-test.js
const path = require('path'), fs = require('fs'), os = require('os'), https = require('https'), { spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/k.pem', '-out', dir + '/c.pem', '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const srv = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>lan-panel-ok</title><body>hello</body>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, url = 'https://127.0.0.1:' + port + '/';
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'scud-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  let app = await launch(); let page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  const secFile = path.join(ud, 'security.json');
  const guest = (code) => page.evaluate((c) => new Promise((res) => { const w = document.querySelector('webview'); if (!w) return res('nowebview'); w.executeJavaScript(c).then(res, (e) => res('ERR ' + e)); setTimeout(() => res('timeout'), 4000); }), code);
  const addPanel = async () => { await page.evaluate((u) => { state.panels = [{ id: 'p1', name: 'Lan', url: u }]; saveState(); render(); }, url); await sleep(2500); };
  const open = async () => { await page.click('#settingsBtn'); await page.click('#securityMenuBtn'); await sleep(400); };
  const flip = async (id, v) => { await page.evaluate(([i, val]) => { const e = document.getElementById(i); if (e.type === 'checkbox') e.checked = val; else e.value = val; e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]); await sleep(300); };
  const saved = () => JSON.parse(fs.readFileSync(secFile, 'utf8'));

  // ---- window and defaults ----
  await open();
  check('Settings menu opens the Security window', await page.evaluate(() => document.getElementById('securityDialog').open));
  const ids = ['secCerts', 'secPopups', 'secMedia', 'secNotif', 'secClip', 'secThorough', 'secConn', 'secMeraki', 'secV3'];
  check('standard settings on first start: everything works as before', await page.evaluate((ids) => document.getElementById('secCerts').value === 'local' && ids.slice(1, 8).every((i) => document.getElementById(i).checked) && !document.getElementById('secV3').checked, ids));
  check('no downloads option (the app is not for downloads)', !/download/i.test(await page.evaluate(() => document.getElementById('securityDialog').innerText)));
  await page.click('#secClose'); await sleep(200);

  // ---- certificates ----
  await addPanel();
  check('standard: a self-signed panel on your network loads', (await guest('document.title')) === 'lan-panel-ok');
  await open(); await flip('secCerts', 'strict'); await page.click('#secClose');
  check('saved to disk', saved().certs === 'strict');
  await addPanel();
  check('strict certificates: the same panel no longer loads', (await guest('document.title')) !== 'lan-panel-ok');
  await open(); await flip('secCerts', 'local'); await page.click('#secClose'); await addPanel();
  check('back to standard: it loads again', (await guest('document.title')) === 'lan-panel-ok');

  // ---- permissions (what a panel's page is told) ----
  const notif = () => guest('Notification.requestPermission().then((r) => r)');
  check('notifications allowed by default for a panel on your network', (await notif()) === 'granted', await notif());
  await open(); await flip('secNotif', false); await page.click('#secClose'); await addPanel();
  check('notifications switched off: refused', (await notif()) !== 'granted', await notif());
  const clip = () => guest('navigator.clipboard.readText().then(() => "allowed", (e) => "denied")');
  await open(); await flip('secClip', false); await page.click('#secClose'); await addPanel();
  check('clipboard switched off: refused', (await clip()) === 'denied', await clip());

  // ---- pop-ups ----
  const wins = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await open(); await flip('secPopups', true); await page.click('#secClose'); await addPanel();
  const w0 = await wins(); await guest('window.open("' + url + '", "_blank"); 1'); await sleep(1500);
  check('pop-ups allowed: a panel can open a web window', (await wins()) === w0 + 1, w0 + ' -> ' + await wins());
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().filter((w) => !/index\.html/.test(w.webContents.getURL())).forEach((w) => w.destroy()); });
  await open(); await flip('secPopups', false); await page.click('#secClose'); await addPanel();
  const w1 = await wins(); await guest('window.open("' + url + '", "_blank"); 1'); await sleep(1500);
  check('pop-ups off: nothing opens', (await wins()) === w1, w1 + ' -> ' + await wins());

  // ---- scanning and connections ----
  await open(); await flip('secThorough', false); await page.click('#secClose');
  const th = await page.evaluate(() => window.netApi.scan({ mode: 'thorough', cidr: '127.0.0.0/30', interfaceName: 'lo' }));
  check('thorough scan off: refused with a plain message', th.ok === false && /turned off in Settings/.test(th.error), JSON.stringify(th));
  await open(); await flip('secConn', false); await page.click('#secClose');
  const t1 = await page.evaluate(() => window.connApi.test({ type: 'snmp', host: '127.0.0.1', port: 1, password: 'x', snmpVersion: 2 }));
  const p1 = await page.evaluate(() => window.connApi.poll());
  const f1 = await page.evaluate(() => window.connApi.findSnmp({ ips: ['127.0.0.1'], communities: ['public'] }));
  check('router connections off: test, poll and the SNMP finder are all refused', t1.ok === false && p1.disabled === true && f1.ok === false, JSON.stringify([t1, p1, f1]).slice(0, 300));
  await open(); await flip('secConn', true); await flip('secV3', true); await page.click('#secClose');
  const t2 = await page.evaluate(() => window.connApi.test({ type: 'snmp', host: '127.0.0.1', port: 1, password: 'x', snmpVersion: 2 }));
  check('SNMP v3 only: a version 2c connection is refused', t2.ok === false && /version 1 or 2c/.test(t2.error), JSON.stringify(t2));
  const t3 = await page.evaluate(() => window.connApi.test({ type: 'snmp', host: '127.0.0.1', port: 1, password: 'x', snmpVersion: 3, user: 'u' }));
  check('SNMP v3 only: a version 3 connection is not blocked by this rule', !/version 1 or 2c/.test(String(t3.error || '')), JSON.stringify(t3).slice(0, 200));
  const f2 = await page.evaluate(() => window.connApi.findSnmp({ ips: ['127.0.0.1'], communities: ['public'] }));
  check('SNMP v3 only: the SNMP finder (version 2c) says why it is off', f2.ok === false && /do not allow/.test(f2.error), JSON.stringify(f2));
  await open(); await flip('secMeraki', false); await page.click('#secClose');
  const t4 = await page.evaluate(() => window.connApi.test({ type: 'meraki', host: 'api.meraki.com', password: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' }));
  check('Meraki off: refused without touching the internet', t4.ok === false && /Meraki is turned off/.test(t4.error), JSON.stringify(t4).slice(0, 200));

  // ---- presets, bad input, restart ----
  await open(); await page.click('#secStrict'); await sleep(300);
  let s = saved();
  check('"Strictest settings" turns everything restrictive on', s.certs === 'strict' && !s.allowMedia && !s.allowNotifications && !s.allowClipboard && !s.popups && !s.thoroughScan && !s.meraki && s.snmpV3Only && s.connectors === true, JSON.stringify(s));
  check('and the window shows it', await page.evaluate(() => document.getElementById('secCerts').value === 'strict' && document.getElementById('secV3').checked && !document.getElementById('secPopups').checked));
  const bad = await page.evaluate(() => window.securityApi.set({ certs: 'bogus', popups: 'yes', __proto__: { x: 1 }, evil: true }));
  check('odd values are ignored', bad.ok && bad.settings.certs === 'strict' && bad.settings.popups === false && bad.settings.evil === undefined, JSON.stringify(bad));
  await page.click('#secClose'); await app.close();
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(500);
  const again = await page.evaluate(() => window.securityApi.get());
  check('settings survive a restart', again.ok && again.settings.certs === 'strict' && again.settings.snmpV3Only === true, JSON.stringify(again.settings));
  check('the file is private (owner only)', process.platform === 'win32' || (fs.statSync(secFile).mode & 0o077) === 0);
  await page.click('#settingsBtn'); await page.click('#securityMenuBtn'); await sleep(300); await page.click('#secDefault'); await sleep(300);
  s = saved();
  check('"Standard settings" restores the defaults', s.certs === 'local' && s.popups && s.allowMedia && s.thoroughScan && s.meraki && !s.snmpV3Only, JSON.stringify(s));
  for (const size of [{ width: 900, height: 560 }, { width: 1400, height: 900 }]) {
    await page.setViewportSize(size); await sleep(300);
    check('the window fits on screen at ' + size.width + 'x' + size.height, await page.evaluate(() => { const b = document.getElementById('secClose').getBoundingClientRect(); const d = document.getElementById('securityDialog').getBoundingClientRect(); return b.bottom <= innerHeight && d.top >= 0 && d.right <= innerWidth; }));
  }
  await page.screenshot({ path: path.join(os.tmpdir(), 'sec-shot.png') });
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await app.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
