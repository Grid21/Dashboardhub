'use strict';
//   xvfb-run -a node test/security-test.js
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), https = require('https'), { spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // a self-signed https server on this computer (a "home-lab" panel)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
  spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/k.pem', '-out', dir + '/c.pem', '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const srv = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (q, r) => { r.end('<title>lan-panel-ok</title><body>hello</body>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'secu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = [], csp = [];
  page.on('pageerror', (e) => { errors.push(String(e)); });
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
  await page.waitForSelector('#tabMap');
  // 1. self-signed LAN panel loads
  await page.evaluate((u) => { state.panels.push({ id: 'sec1', name: 'Lan', url: u }); saveState(); render(); }, 'https://127.0.0.1:' + port + '/');
  await sleep(2500);
  const title = await page.evaluate(() => new Promise((res) => { const w = document.querySelector('webview'); if (!w) return res('nowebview'); w.executeJavaScript('document.title').then(res, (e) => res('err ' + e)); }));
  check('a self-signed panel on your own network still loads', title === 'lan-panel-ok', title);
  // 2. trust rules in the main process
  const rule = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; const out = {};
    return out;
  });
  // 3. the app window cannot open windows or leave its page
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await page.evaluate(() => { try { window.open('https://example.com'); } catch (e) {} });
  await sleep(500);
  const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check('the app window cannot open new windows', before === after, before + ' -> ' + after);
  // 4. a panel cannot get node access / preload
  const flags = await page.evaluate(() => { const w = document.createElement('webview'); return { node: typeof require, proc: typeof process }; });
  check('app pages have no direct system access', flags.node === 'undefined' && flags.proc === 'undefined', JSON.stringify(flags));
  const guestNode = await page.evaluate(() => new Promise((res) => { const w = document.querySelector('webview'); w.executeJavaScript('typeof require + "," + typeof process + "," + typeof window.settingsApi').then(res, (e) => res('err')); }));
  check('a panel page has no system access and no app APIs', guestNode === 'undefined,undefined,undefined', guestNode);
  // 5. panels with a non-web address are refused
  const bad = await page.evaluate(() => { const w = document.createElement('webview'); w.setAttribute('src', 'file:///etc/passwd'); w.setAttribute('partition', 'persist:panels'); document.body.appendChild(w); return new Promise((r) => setTimeout(() => r(w.getURL ? (function(){ try { return w.getURL(); } catch (e) { return 'blocked'; } })() : 'x'), 1200)); });
  check('a web view pointed at a file is refused', !/etc\/passwd/.test(String(bad)), bad);
  // 6. every tab opens with no content-security complaints
  for (const id of ['tabMap', 'tabPanels']) { await page.click('#' + id).catch(() => {}); await sleep(500); }
  await page.click('#tabMap'); await sleep(800);
  check('the page content policy blocked nothing the app needs', csp.length === 0, csp.join(' | '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  // 7. public website with a bad certificate is NOT accepted (no internet needed: use the check function through a fake)
  await page.evaluate(() => window.settingsApi.panelHosts(['https://nas.example.com:8443/x'])); await sleep(200);
  const trust = await app.evaluate(({ app }) => new Promise((resolve) => {
    const res = {}; const fake = (url) => new Promise((r) => { let got; const ev = { preventDefault() {} }; const ls = app.listeners('certificate-error'); ls[ls.length - 1](ev, null, url, 'ERR', {}, (ok) => { got = ok; r(ok); }); });
    Promise.all([fake('https://192.168.1.5/'), fake('https://nas.local/'), fake('https://printer/'), fake('https://example.com/'), fake('https://8.8.8.8/'), fake('https://nas.example.com:8443/')]).then(resolve);
  }));
  check('certificate rule: LAN ip / .local / bare name accepted', trust[0] === true && trust[1] === true && trust[2] === true, JSON.stringify(trust));
  check('certificate rule: a public name you added as a panel is accepted', trust[5] === true, JSON.stringify(trust));
  check('certificate rule: public website and public IP refused', trust[3] === false && trust[4] === false, JSON.stringify(trust));
  await page.evaluate(() => { try { location.href = 'https://example.com/'; } catch (e) {} }); await sleep(800);
  check('the app window cannot be sent to another website', /^file:/.test(page.url()), page.url());
  await app.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
