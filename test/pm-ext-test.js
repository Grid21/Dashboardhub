'use strict';
//   xvfb-run -a node test/pm-ext-test.js
// Password manager for panels: loads ONE extension into the panels' own session. The extension here is a small stand-in written
// for the test (it fills a login form like a password manager would). It proves the Dashboard Hub side (install from a zip, a .crx,
// a folder; load into panels; fill a panel's login; pop-up window; remove; survive a restart; refuse unsafe files).
// It does NOT prove that Proton Pass or Bitwarden work: that needs their real files and a real account.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), zlib = require('zlib');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const pm = require('../security.js').pmExt;
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pmx-'));

// ---- a tiny zip writer (stored + deflate) so the test needs nothing installed ----
function crc32(b) { let c, crc = ~0; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function makeZip(files, method) {
  const loc = [], cen = []; let off = 0;
  Object.keys(files).forEach((name) => {
    const data = Buffer.from(files[name]), comp = method === 0 ? data : zlib.deflateRawSync(data), nb = Buffer.from(name), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(method === 0 ? 0 : 8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method === 0 ? 0 : 8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    loc.push(l, nb, comp); cen.push(c, nb); off += 30 + nb.length + comp.length;
  });
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cen.length / 2, 8); e.writeUInt16LE(cen.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}
const EXT = {
  'manifest.json': JSON.stringify({ manifest_version: 3, name: '__MSG_extName__', default_locale: 'en', version: '1.2.3', background: { service_worker: 'bg.js' }, action: { default_popup: 'popup.html' }, permissions: ['storage'], host_permissions: ['http://127.0.0.3/*'], content_scripts: [{ matches: ['http://127.0.0.3/*'], js: ['content.js'], run_at: 'document_idle' }] }),
  '_locales/en/messages.json': JSON.stringify({ extName: { message: 'Test Password Manager' } }),
  'content.js': "chrome.runtime.sendMessage({ type: 'get-login' }, (r) => { document.documentElement.setAttribute('data-pm-ran', r && r.ok ? 'filled' : 'no'); if (!r || !r.ok) return; const u = document.querySelector('input[name=user]'), p = document.querySelector('input[type=password]'); u.value = r.user; p.value = r.pass; });",
  'bg.js': "chrome.runtime.onMessage.addListener((m, s, send) => { if (m && m.type === 'get-login') { chrome.storage.local.get({ pw: 'secret-from-extension' }, (v) => send({ ok: true, user: 'admin', pass: v.pw })); return true; } });",
  'popup.html': '<!doctype html><html><body><h1 id="t">Popup works</h1><script src="popup.js"></script></body></html>',
  'popup.js': "document.getElementById('t').textContent='popup-script-ran';"
};
const zipPath = path.join(work, 'ext.zip'); fs.writeFileSync(zipPath, makeZip(EXT, 8));
const wrapped = {}; Object.keys(EXT).forEach((k) => { wrapped['bundle/' + k] = EXT[k]; });
const wrappedZip = path.join(work, 'wrapped.zip'); fs.writeFileSync(wrappedZip, makeZip(wrapped, 0));
const crxPath = path.join(work, 'ext.crx'); { const h = Buffer.alloc(12); h.write('Cr24'); h.writeUInt32LE(3, 4); h.writeUInt32LE(0, 8); fs.writeFileSync(crxPath, Buffer.concat([h, makeZip(EXT, 8)])); }
const folderPath = path.join(work, 'folder'); Object.keys(EXT).forEach((k) => { const f = path.join(folderPath, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, EXT[k]); });

function unitTests() {
  console.log('\nUnpacking files safely');
  const t = (n, fn) => { try { fn(); } catch (e) { return e; } return null; };
  let d = fs.mkdtempSync(path.join(work, 'u-'));
  check('zip: unpacked, manifest present', !t('zip', () => pm.unzipTo(fs.readFileSync(zipPath), d)) && fs.existsSync(path.join(d, 'manifest.json')) && fs.existsSync(path.join(d, '_locales/en/messages.json')));
  d = fs.mkdtempSync(path.join(work, 'u-'));
  check('zip with one outer folder: stepped into', !t('wrap', () => pm.unzipTo(fs.readFileSync(wrappedZip), d)) && fs.existsSync(path.join(d, 'manifest.json')));
  d = fs.mkdtempSync(path.join(work, 'u-'));
  check('.crx (zip behind a header): unpacked', !t('crx', () => pm.unzipTo(fs.readFileSync(crxPath), d)) && fs.existsSync(path.join(d, 'popup.html')));
  const evil = makeZip({ 'manifest.json': '{}', '../escape.txt': 'x' }, 0); d = fs.mkdtempSync(path.join(work, 'u-'));
  check('a file name that climbs out of the folder is refused', /not allowed/.test(String((t('evil', () => pm.unzipTo(evil, d)) || {}).message)) && !fs.existsSync(path.join(path.dirname(d), 'escape.txt')));
  const abs = makeZip({ 'manifest.json': '{}', '/etc/hub-evil': 'x' }, 0);
  check('an absolute file name is refused', /not allowed/.test(String((t('abs', () => pm.unzipTo(abs, fs.mkdtempSync(path.join(work, 'u-')))) || {}).message)));
  check('a zip without manifest.json is refused', /manifest/.test(String((t('nom', () => pm.unzipTo(makeZip({ 'a.txt': 'x' }, 0), fs.mkdtempSync(path.join(work, 'u-')))) || {}).message)));
  check('something that is not a zip is refused', /not a zip/.test(String((t('junk', () => pm.unzipTo(Buffer.from('this is not a zip file at all, just text.......'), fs.mkdtempSync(path.join(work, 'u-')))) || {}).message)));
  check('a zip cut off half way is refused, not half-installed', (() => { const z = makeZip(EXT, 8); const e = t('cut', () => pm.unzipTo(z.subarray(0, Math.floor(z.length / 2)), fs.mkdtempSync(path.join(work, 'u-')))); return !!e && /not a zip|damaged/.test(e.message); })());
}

(async () => {
  unitTests();
  console.log('\nIn the app');
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html><body><form><input name=user><input type=password name=pw></form></body></html>'); });
  await new Promise((r) => srv.listen(3557, '127.0.0.3', r));
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pmx-ud-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud], env: Object.assign({}, process.env, { DASHBOARD_HUB_TEST_PICK: zipPath }) });
  let app = await launch(), page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  await page.waitForSelector('#addBtn'); await sleep(800);
  const guestInfo = () => app.evaluate(async ({ webContents }) => {
    const g = webContents.getAllWebContents().filter((w) => w.getType() === 'webview' && /127\.0\.0\.3/.test(w.getURL()));
    if (!g.length) return null;
    return g[0].executeJavaScript("({ ran: document.documentElement.getAttribute('data-pm-ran'), user: (document.querySelector('input[name=user]')||{}).value, pass: (document.querySelector('input[type=password]')||{}).value })");
  });
  const openDlg = async () => { for (let i = 0; i < 20; i++) { await page.evaluate(() => { const d = document.getElementById('pmDialog'); if (!d.open) document.getElementById('pmMenuBtn').click(); }); if (await page.evaluate(() => document.getElementById('pmDialog').open)) break; await sleep(400); } await sleep(500); };
  await openDlg();
  const choices = await page.evaluate(() => Array.from(document.querySelectorAll('#pmKey option')).map((o) => o.textContent));
  check('the list offers Proton Pass and Bitwarden', choices.includes('Proton Pass') && choices.includes('Bitwarden'), JSON.stringify(choices));
  check('it says nothing is installed and everything is switched off at first', /Nothing installed/.test(await page.textContent('#pmState')) && await page.evaluate(() => document.getElementById('pmOn').disabled && document.getElementById('pmPopup').disabled && document.getElementById('pmRemove').disabled));
  check('the window warns the extension can read every page in the panels', /read every page/.test(await page.textContent('#pmDialog')));
  await page.selectOption('#pmKey', 'proton');
  await page.click('#pmFile'); await sleep(1500);
  let s = await page.evaluate(() => window.pmApi.status());
  check('installing from a zip works and loads it', s.installed && s.loaded && s.enabled && s.key === 'proton', JSON.stringify(s));
  check('its real name is read from the language files (not __MSG_...)', s.name === 'Test Password Manager' && s.version === '1.2.3', s.name);
  check('the window says so', /Test Password Manager 1\.2\.3 is installed and in use/.test(await page.textContent('#pmState')), await page.textContent('#pmState'));
  await page.click('#pmClose'); await sleep(300);
  // a panel opened now gets the password manager's help
  await page.click('#addBtn'); await page.fill('#nameInput', 'Login test'); await page.fill('#urlInput', '127.0.0.3:3557/'); await page.click('#dialog button[type=submit]'); await sleep(3500);
  let g = await guestInfo();
  check('a panel with a login page gets filled in by the extension', g && g.ran === 'filled' && g.user === 'admin' && g.pass === 'secret-from-extension', JSON.stringify(g));
  // pop-up window
  await openDlg();
  check('the pop-up button is available', await page.evaluate(() => !document.getElementById('pmPopup').disabled));
  await page.click('#pmPopup'); await sleep(1500);
  const popup = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /^chrome-extension:/.test(x.webContents.getURL())); return w ? { url: w.webContents.getURL(), text: await w.webContents.executeJavaScript("document.getElementById('t').textContent") } : null; });
  check('its pop-up window opens and runs', popup && /popup\.html$/.test(popup.url) && popup.text === 'popup-script-ran', JSON.stringify(popup));
  // the main window is untouched by the extension, and no password is kept by Dashboard Hub
  const mainUrl = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => /index\.html$/.test(w.webContents.getURL())).length);
  check('the app window itself is not part of it', mainUrl === 1);
  const mine = fs.readdirSync(ud).filter((f) => /\.json$/.test(f)).map((f) => fs.readFileSync(path.join(ud, f), 'utf8')).join('');
  check('Dashboard Hub keeps no password in its own files', !/secret-from-extension/.test(mine) && !/admin/.test(fs.readFileSync(path.join(ud, 'extension.json'), 'utf8')));
  // switched off
  await page.uncheck('#pmOn'); await sleep(800);
  s = await page.evaluate(() => window.pmApi.status());
  check('switching it off unloads it but keeps it installed', s.installed && !s.enabled && !s.loaded);
  // restart: still there and active
  await page.evaluate(() => { const d = document.getElementById('pmDialog'); if (d.open) d.close(); });
  await page.evaluate(() => window.pmApi.enable(true)); await sleep(500);
  await app.close(); await sleep(1000);
  app = await launch(); page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 }); page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  await page.waitForSelector('#addBtn'); await sleep(4500);
  s = await page.evaluate(() => window.pmApi.status());
  check('after a restart it is loaded again by itself', s.installed && s.loaded && s.enabled, JSON.stringify(s));
  g = await guestInfo();
  check('...and the saved panel is filled in right at startup', g && g.ran === 'filled' && g.pass === 'secret-from-extension', JSON.stringify(g));
  // replace with a .crx, then a folder, then a wrapped zip: only ever one
  for (const [label, p] of [['.crx file', crxPath], ['folder', folderPath], ['zip with an outer folder', wrappedZip]]) {
    await app.evaluate((_, x) => { process.env.DASHBOARD_HUB_TEST_PICK = x; }, p);
    const r = await page.evaluate(() => window.pmApi.pick('bitwarden', 'file'));
    s = await page.evaluate(() => window.pmApi.status());
    check('installing from a ' + label + ' works and replaces the old one', r.ok && s.loaded && s.key === 'bitwarden' && fs.readdirSync(path.join(ud, 'extensions')).filter((x) => x !== 'staging').length === 1, JSON.stringify(r));
  }
  // refused inputs
  const bad = path.join(work, 'bad.zip'); fs.writeFileSync(bad, makeZip({ 'manifest.json': '{}', '../x': 'y' }, 0));
  await app.evaluate((_, x) => { process.env.DASHBOARD_HUB_TEST_PICK = x; }, bad);
  let r = await page.evaluate(() => window.pmApi.pick('proton', 'file'));
  s = await page.evaluate(() => window.pmApi.status());
  check('an unsafe zip is refused with a plain message and the working one stays', r.ok === false && /not allowed/.test(r.error) && s.loaded && s.key === 'bitwarden', JSON.stringify(r));
  const notExt = path.join(work, 'notext.zip'); fs.writeFileSync(notExt, makeZip({ 'readme.txt': 'hello' }, 0));
  await app.evaluate((_, x) => { process.env.DASHBOARD_HUB_TEST_PICK = x; }, notExt);
  r = await page.evaluate(() => window.pmApi.pick('proton', 'file'));
  check('a file that is not an extension is refused', r.ok === false && /manifest/.test(r.error), JSON.stringify(r));
  r = await page.evaluate(() => window.pmApi.pick('nonsense', 'file'));
  check('an unknown manager name is refused', r.ok === false);
  // remove
  r = await page.evaluate(() => window.pmApi.remove());
  s = await page.evaluate(() => window.pmApi.status());
  check('remove: gone from the app and from the disk', r.ok && !s.installed && !s.loaded && !fs.existsSync(path.join(ud, 'extensions')));
  await page.evaluate(() => document.querySelectorAll('webview').forEach((w) => w.reload())); await sleep(2500);
  g = await guestInfo();
  check('after removal a reloaded panel is no longer touched', g && g.ran === null && g.pass === '', JSON.stringify(g));
  // the web panels can never reach the new commands
  const fromPanel = await app.evaluate(async ({ webContents }) => { const w = webContents.getAllWebContents().find((x) => x.getType() === 'webview'); return w ? w.executeJavaScript('typeof window.pmApi') : 'none'; });
  check('a web panel cannot use the password manager commands', fromPanel === 'undefined' || fromPanel === 'none', fromPanel);
  check('no script errors in the window', errors.length === 0, errors.join(' | '));
  await app.close(); srv.close();
  console.log(failed ? 'FAILED ' + failed : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})();
