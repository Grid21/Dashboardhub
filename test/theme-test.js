'use strict';
//   xvfb-run -a node test/theme-test.js
// Light / dark mode: the setting, saving it, every window following it, and readable text in both.
// Set THEME_SHOTS=/some/folder to also save screenshots.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.THEME_SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// the worst text/background pairs on a page: walks every visible text element, finds the colour behind it
const CONTRAST = () => {
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => { let base = { r: 255, g: 255, b: 255 }; const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; } } if (!stack.length || stack[stack.length - 1].a < 0.99) base = parse(true && (document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)) ? 'rgb(20,23,28)' : 'rgb(238,241,246)'); for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; } return base; };
  const bad = []; let n = 0;
  document.querySelectorAll('body *').forEach((el) => {
    if (!el.childNodes.length || !Array.from(el.childNodes).some((x) => x.nodeType === 3 && x.textContent.trim())) return;
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') return;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    if (el.closest('webview, [hidden], .hidden, canvas')) return;
    const fg = parse(st.color); if (!fg) return; const bg = bgOf(el);
    const a = fg.a; const f = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); n++;
    if (ratio < 3) bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30)) + ' ' + ratio.toFixed(1) + ' "' + el.textContent.trim().slice(0, 24) + '"');
  });
  return { n, bad: bad.slice(0, 12), count: bad.length };
};
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thm-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  let app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(1200);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const mode = (p) => p.evaluate(() => { const t = document.documentElement.dataset.theme; return t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); });
  const openSettings = async () => { if (!(await page.isVisible('#themeSelect'))) { await page.click('#settingsBtn'); await sleep(300); } };
  const closeSettings = async () => { if (await page.isVisible('#themeSelect')) { await page.click('#settingsBtn'); await sleep(300); } };
  await openSettings();
  check('the Settings menu has a Colours choice, set to Automatic by default', await page.evaluate(() => { const s = document.getElementById('themeSelect'); return !!s && s.value === 'auto' && s.options.length === 4; }));
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const scanPage = async (p, label) => { const r = await p.evaluate(CONTRAST); check(label + ': text is readable (' + r.n + ' texts checked)', r.count === 0, JSON.stringify(r.bad)); };
  for (const t of ['dark', 'light']) {
    await openSettings();
    await page.selectOption('#themeSelect', t); await sleep(500);
    check(t + ': the main window follows', (await mode(page)) === t);
    check(t + ': the page really is painted in ' + t + ' colours', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === (t === 'dark' ? 'rgb(20, 23, 28)' : 'rgb(237, 240, 245)'));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    check(t + ': the choice is saved', saved.theme === t && 'closeToTray' in saved, JSON.stringify(saved));
    check(t + ': the window background matches', await app.evaluate(({ BrowserWindow }, tt) => { const w = BrowserWindow.getAllWindows()[0]; const c = w.getBackgroundColor().toLowerCase(); return tt === 'dark' ? c === '#14171c' : c === '#edf0f5'; }, t));
    await closeSettings();
    await page.click('#tabPanels').catch(() => {}); await sleep(400);
    await shot(page, t + '-panels'); await scanPage(page, t + ' panels tab');
    await page.click('#tabMap'); await sleep(900);
    await shot(page, t + '-map'); await scanPage(page, t + ' map tab');
    await openSettings(); await shot(page, t + '-settings'); await scanPage(page, t + ' settings menu');
    await closeSettings();
    // other windows
    await page.evaluate(() => document.getElementById('remoteBtn').click());
    let rv = null; for (let j = 0; j < 20 && !rv; j++) { rv = app.windows().find((w) => /remote\.html/.test(w.url())); await sleep(250); }
    check(t + ': the Remote view window opens', !!rv);
    if (rv) { await sleep(500); check(t + ': the Remote view follows', (await mode(rv)) === t); await shot(rv, t + '-remote'); await scanPage(rv, t + ' Remote view'); await rv.close().catch(() => {}); await sleep(300); }
    await page.click('#mapAlertTypes').catch(() => {}); await sleep(300); await page.click('#alertTypesCenter').catch(() => {});
    let nc = null; for (let j = 0; j < 20 && !nc; j++) { nc = app.windows().find((w) => /notifications\.html/.test(w.url())); await sleep(250); }
    check(t + ': the Notifications Center opens', !!nc);
    if (nc) { await sleep(600); check(t + ': the Notifications Center follows', (await mode(nc)) === t); await shot(nc, t + '-notif'); await scanPage(nc, t + ' Notifications list'); await nc.click('#ncTabUp'); await sleep(600); await shot(nc, t + '-uptime'); await scanPage(nc, t + ' Uptime tab'); await nc.close().catch(() => {}); await sleep(300); }
    await page.click('#tabPanels').catch(() => {}); await sleep(200);
  }
  // ----- Tron Legacy -----
  await openSettings();
  await page.selectOption('#themeSelect', 'tron'); await sleep(600);
  check('tron: the main window follows', (await mode(page)) === 'tron');
  check('tron: the page is painted black with neon', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(2, 7, 13)' && await page.evaluate(() => getComputedStyle(document.querySelector('.brand')).color) === 'rgb(111, 243, 255)');
  check('tron: it is saved', JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).theme === 'tron');
  check('tron: the window background matches', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase() === '#02070d'));
  check('tron: the system never switches it to the light set', await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors));
  await closeSettings();
  await page.click('#tabPanels').catch(() => {}); await sleep(400);
  await shot(page, 'tron-panels'); await scanPage(page, 'tron panels tab');
  await page.click('#tabMap'); await sleep(1200);
  await shot(page, 'tron-map'); await scanPage(page, 'tron map tab');
  await openSettings(); await shot(page, 'tron-settings'); await scanPage(page, 'tron settings menu'); await closeSettings();
  await page.evaluate(() => document.getElementById('remoteBtn').click());
  { let rv = null; for (let j = 0; j < 20 && !rv; j++) { rv = app.windows().find((w) => /remote\.html/.test(w.url())); await sleep(250); }
    check('tron: the Remote view window opens and follows', !!rv && (await mode(rv)) === 'tron');
    if (rv) { await sleep(500); await shot(rv, 'tron-remote'); await scanPage(rv, 'tron Remote view'); await rv.close().catch(() => {}); await sleep(300); } }
  await page.click('#tabPanels').catch(() => {}); await sleep(200);
  // survives a restart
  await app.close(); await sleep(800);
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(1200);
  check('Tron Legacy is still on after a restart', (await mode(page)) === 'tron');
  await openSettings();
  check('and the Colours choice shows it', await page.evaluate(() => document.getElementById('themeSelect').value) === 'tron');
  await page.selectOption('#themeSelect', 'auto'); await sleep(400);
  check('Automatic saves too', JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).theme === 'auto');
  check('a bad value is refused', await page.evaluate(() => window.settingsApi.setTheme('purple')).then((r) => r.ok === false));
  check('other settings are kept when the colour changes', await page.evaluate(() => window.settingsApi.get()).then((r) => r.ok && r.gpu === true && r.closeToTray === false && r.theme === 'auto'));
  check('no page errors', errs.length === 0, errs.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
