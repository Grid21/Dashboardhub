'use strict';
//   xvfb-run -a node test/web-access-ui-test.js
// Phone and browser access inside the real app: the Settings window, turning it on, what the page receives, restart.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), net = require('net');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
function req(port, method, p, body, cookie) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Cookie: cookie || '', 'Content-Type': 'application/json' } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ code: res.statusCode, headers: res.headers, json: j }); }); });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  let app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(1200);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const port = await freePort();
  check('it is off by default: nothing listens on the usual port', await req(8787, 'GET', '/').then(() => false, () => true));
  await page.click('#settingsBtn'); await page.click('#webMenuBtn'); await sleep(400);
  check('the window opens, with the turn-on box locked until there is a code', await page.isVisible('#webDialog') && await page.evaluate(() => document.getElementById('webOn').disabled));
  await page.fill('#webCode', 'abc'); await page.click('#webSetCode'); await sleep(300);
  check('a short code gets a plain message', /at least 6/.test(await page.textContent('#webMsg')));
  await page.fill('#webCode', 'my phone code'); await page.click('#webSetCode'); await sleep(400);
  check('a good code unlocks the box', await page.evaluate(() => !document.getElementById('webOn').disabled) && /saved/.test(await page.textContent('#webMsg')));
  await page.fill('#webPort', String(port)); await page.click('#webSetPort'); await sleep(300);
  await page.check('#webOn'); await sleep(800);
  check('turning it on shows the address to type into the phone', /On\./.test(await page.textContent('#webState')) && new RegExp(':' + port + '/').test(await page.textContent('#webUrls')) || /no network address/.test(await page.textContent('#webUrls')));
  // give the app something to share
  await page.evaluate(() => { state.panels = [{ id: 'a1', name: 'Alpha panel', url: 'http://10.1.1.1:3000' }, { id: 'a2', name: 'Beta panel', url: 'https://example.org/' }]; saveState(); render(); });
  await sleep(2500);
  let r = await req(port, 'POST', '/api/login', { code: 'my phone code' });
  const cookie = ((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
  check('the real app answers the page and signs in', r.code === 200 && !!cookie);
  r = await req(port, 'GET', '/api/state', null, cookie);
  const names = r.json && r.json.snapshot ? r.json.snapshot.panels.map((p) => p.name).join(',') : '';
  check('the panels in the app are what the page shows', names === 'Alpha panel,Beta panel', names);
  check('the page gets the app version', r.json && /^\d+\.\d+\.\d+$/.test(r.json.version));
  // a device on the map
  await page.evaluate(() => { const n = window.hubNetmap.exportData(); return n; });
  const wd = await page.evaluate(() => window.hubNetmap.webData());
  check('the map data is available to share', Array.isArray(wd.devices) && Array.isArray(wd.links));
  r = await req(port, 'GET', '/api/uptime?days=1', null, cookie);
  check('uptime answers (empty is fine when nothing was watched yet)', r.code === 200 && r.json.ok === true);
  await page.click('#webSignOut'); await sleep(300);
  check('"Sign everyone out" works', (await req(port, 'GET', '/api/state', null, cookie)).code === 401);
  await page.click('#webClose'); await sleep(200);
  // restart: still on
  await app.close(); await sleep(1200);
  check('closing the app closes the page', await req(port, 'GET', '/').then(() => false, () => true));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(2500);
  check('after a restart it starts again by itself, with the same code', (await req(port, 'POST', '/api/login', { code: 'my phone code' })).code === 200);
  await page.click('#settingsBtn'); await page.click('#webMenuBtn'); await sleep(500);
  await page.uncheck('#webOn'); await sleep(700);
  check('turning it off stops it at once', await req(port, 'GET', '/').then(() => false, () => true));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
