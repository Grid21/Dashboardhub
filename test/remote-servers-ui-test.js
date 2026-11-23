'use strict';
//   xvfb-run -a node test/remote-servers-ui-test.js
// Dashboard Hub Desktop managing a Dashboard Hub Docker server: add, check, scan now, open, edit, remove.
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), net = require('net');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
(async () => {
  const dkPort = await freePort(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'rsdk-')), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsui-'));
  const dk = spawn(process.execPath, [path.join(ROOT, 'docker', 'server.js')], { env: Object.assign({}, process.env, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_PORT: String(dkPort), DASHBOARD_HUB_CODE: 'server code 1', DASHBOARD_HUB_NAME: 'Docker box', DASHBOARD_HUB_PANELS: 'Alpha=http://10.0.0.5:9000' }), stdio: 'ignore' });
  await sleep(9000);
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  const page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(1200);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.click('#settingsBtn'); await page.click('#hubsMenuBtn'); await sleep(500);
  check('the Remote servers window opens, empty', await page.isVisible('#hubsDialog') && /No servers yet/.test(await page.textContent('#hubsList')));
  await page.fill('#hubName', 'Home server'); await page.fill('#hubUrl', 'ftp://nope'); await page.fill('#hubCode', 'server code 1'); await page.click('#hubSave'); await sleep(300);
  check('a wrong kind of address gets a plain message', /http/.test(await page.textContent('#hubsMsg')));
  await page.fill('#hubUrl', 'http://127.0.0.1:' + dkPort); await page.fill('#hubCode', 'abc'); await page.click('#hubSave'); await sleep(300);
  check('an empty or short code is asked for', /access code/i.test(await page.textContent('#hubsMsg')));
  await page.fill('#hubCode', 'wrong code!'); await page.click('#hubSave'); await sleep(1500);
  check('a server can be saved, and a wrong code is explained when checked', /not right/.test(await page.textContent('#hubsList')), await page.textContent('#hubsList'));
  const id = await page.evaluate(async () => (await window.hubsApi.list()).list[0].id);
  await page.evaluate((id) => document.querySelector('.hub-row button:nth-child(4)').click(), id); await sleep(200);
  await page.fill('#hubCode', 'server code 1'); await page.click('#hubSave'); await sleep(300);
  await page.click('.hub-row button:nth-child(1)'); await sleep(2500);
  const txt = await page.textContent('#hubsList');
  check('after fixing the code Check shows it is online with the counts', /Online/.test(txt) && /devices: \d+ online, \d+ offline/.test(txt) && /network 127\.0\.0\.0\/24/.test(txt) && /last scan/.test(txt), txt);
  check('the address and the name are shown', /Home server/.test(txt) && txt.indexOf('127.0.0.1:' + dkPort) > 0);
  check('the code is never given back to the window', await page.evaluate(async () => JSON.stringify(await window.hubsApi.list()).indexOf('server code 1') < 0));
  await page.click('.hub-row button:nth-child(2)'); await sleep(1200);
  check('Scan now starts a scan on the server', /Scan started|already running/.test(await page.textContent('#hubsList')), await page.textContent('#hubsList'));
  await sleep(500);
  await page.click('.hub-row button:nth-child(1)'); await sleep(2000);
  check('Check afterwards shows it scanning or finished', /scanning now|last scan/.test(await page.textContent('#hubsList')));
  await page.click('.hub-row button:nth-child(3)'); await sleep(2500);
  const win = app.windows().find((w) => w.url().indexOf(':' + dkPort) > 0);
  check('Open shows the server\'s own page, already signed in', !!win && await win.evaluate(() => !document.getElementById('app').hidden), win ? win.url() : 'no window');
  if (win) { await sleep(800); check('and it shows the Docker server\'s panels', /Alpha/.test(await win.textContent('#t-panels'))); await win.close().catch(() => {}); }
  // page not reachable
  await page.evaluate(() => window.hubsApi.save({ name: 'Gone', url: 'http://127.0.0.1:1', code: 'whatever1' }));
  await page.evaluate(() => document.getElementById('hubsMenuBtn').click()).catch(() => {}); await sleep(300);
  const gone = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; const h = l.find((x) => x.name === 'Gone'); return window.hubsApi.status(h.id); });
  check('a server that is not there gets a plain explanation', gone.ok === false && /Nothing is listening|did not answer|reached/.test(gone.error), gone.error);
  const sc = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; return window.hubsApi.scan(l.find((x) => x.name === 'Gone').id); });
  check('and so does asking it to scan', sc.ok === false && !!sc.error);
  // the desktop's own phone page cannot be told to scan
  const wcfg = await page.evaluate(async () => { await window.webApi.setCode('desktop phone code'); return (await window.webApi.setOn(true)).port; });
  const r = await page.evaluate(async (p) => { const l = await fetch('http://127.0.0.1:' + p + '/api/login', { method: 'POST', body: JSON.stringify({ code: 'desktop phone code' }) }); return l.status; }, wcfg).catch(() => 0);
  const hubsDesktop = await new Promise((res) => { const h = require('http'); const q = h.request({ host: '127.0.0.1', port: wcfg, method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' } }, (rs) => { const ck = (rs.headers['set-cookie'] || [])[0] || ''; rs.resume(); const q2 = h.request({ host: '127.0.0.1', port: wcfg, method: 'POST', path: '/api/action/scan', headers: { Cookie: ck.split(';')[0], 'X-Dashboard-Hub': '1' } }, (r2) => { r2.resume(); res(r2.statusCode); }); q2.end(); }); q.write(JSON.stringify({ code: 'desktop phone code' })); q.end(); });
  check('the desktop\'s own phone page stays view only (no scan action)', hubsDesktop === 405, hubsDesktop);
  await page.evaluate(() => window.webApi.setOn(false));
  const ids = await page.evaluate(async () => (await window.hubsApi.list()).list.map((x) => x.id));
  for (const i of ids) await page.evaluate((i) => window.hubsApi.remove(i), i);
  check('servers can be removed', (await page.evaluate(async () => (await window.hubsApi.list()).list.length)) === 0);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await app.close(); dk.kill('SIGTERM');
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
