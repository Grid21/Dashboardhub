'use strict';
//   xvfb-run -a node test/fullscreen-test.js
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html><body><h1>' + q.url + '</h1></body></html>'); });
  await new Promise((r) => srv.listen(3556, '127.0.0.3', r));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#addBtn');
  for (const [n, u] of [['Alpha', '127.0.0.3:3556/a'], ['Beta', '127.0.0.3:3556/b']]) {
    await page.click('#addBtn'); await page.fill('#nameInput', n); await page.fill('#urlInput', u); await page.click('#dialog button[type=submit]'); await sleep(800);
  }
  await sleep(1200);
  const st = () => page.evaluate(() => Array.from(document.querySelectorAll('.panel')).map((p) => {
    const r = p.getBoundingClientRect(), wv = p.querySelector('webview').getBoundingClientRect(), vis = (b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed';
    const btn = (t) => Array.from(p.querySelectorAll('.panel-head button')).find((b) => b.textContent.trim().endsWith(t));
    return { max: p.classList.contains('maximized'), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), wvh: Math.round(wv.height), wvw: Math.round(wv.width),
      maxShown: !!btn('Maximize') && getComputedStyle(btn('Maximize')).display !== 'none', exitShown: !!btn('Exit full screen') && getComputedStyle(btn('Exit full screen')).display !== 'none' };
  }));
  let s = await st();
  check('every panel has a Maximize button and no Exit button yet', s.every((p) => p.maxShown && !p.exitShown && !p.max));
  const srcBefore = await page.evaluate(() => Array.from(document.querySelectorAll('webview')).map((w) => { w.__mark = 'same'; return w.getAttribute('src'); }));
  await page.click('.panel:nth-child(1) .panel-head button:has-text("Maximize")'); await sleep(600);
  s = await st();
  check('Maximize: the panel fills the whole window', s[0].max && s[0].w === 1400 && s[0].h === 900 && s[0].top === 0 && s[0].left === 0, JSON.stringify(s[0]));
  check('the web page inside fills the space under the header', s[0].wvw === 1400 && s[0].wvh > 800, JSON.stringify(s[0]));
  check('the button changes to "Exit full screen"', !s[0].maxShown && s[0].exitShown);
  check('the other panel is not maximized', !s[1].max);
  check('the web page was not reloaded or replaced', await page.evaluate(() => Array.from(document.querySelectorAll('webview')).every((w) => w.__mark === 'same')));
  check('the panel cannot be dragged while full screen', await page.evaluate(() => document.querySelector('.panel.maximized .panel-head').draggable === false));
  await page.click('.panel.maximized button:has-text("Exit full screen")'); await sleep(500);
  s = await st();
  check('Exit full screen: back to the dashboard', !s[0].max && s[0].w < 1400 && s[0].maxShown && !s[0].exitShown, JSON.stringify(s[0]));
  check('and it can be dragged again', await page.evaluate(() => document.querySelector('.panel .panel-head').draggable === true));
  // Esc leaves full screen too
  await page.click('.panel:nth-child(2) .panel-head button:has-text("Maximize")'); await sleep(400);
  check('second panel maximizes', (await st())[1].max);
  await page.keyboard.press('Escape'); await sleep(400);
  check('Esc leaves full screen', !(await st())[1].max);
  // maximizing one while another is maximized is not possible by mouse (covered), but the code keeps only one
  await page.evaluate(() => { document.querySelectorAll('.panel')[0].querySelector('.panel-head button:nth-of-type(2)').click(); });
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel-head button')).filter((x) => x.textContent.trim().endsWith('Maximize')); b.forEach((x) => x.click()); });
  await sleep(400);
  check('never more than one panel full screen at once', (await st()).filter((p) => p.max).length === 1);
  await page.keyboard.press('Escape'); await sleep(300);
  // editing a panel while full screen keeps it full screen after the redraw
  await page.click('.panel:nth-child(1) .panel-head button:has-text("Maximize")'); await sleep(300);
  await page.click('.panel.maximized .panel-head button:has-text("Edit")'); await sleep(400);
  await page.keyboard.press('Escape'); await sleep(300);
  check('...and the panel is still full screen', (await st())[0].max);
  await page.click('.panel.maximized .panel-head button:has-text("Edit")'); await sleep(300);
  await page.fill('#nameInput', 'Alpha 2'); await page.click('#dialog button[type=submit]'); await sleep(1000);
  await page.screenshot({ path: path.join(os.tmpdir(), 'fs-shot.png') });
  s = await st();
  check('editing while full screen redraws it still full screen, with its new name', s[0].max && await page.evaluate(() => /Alpha 2/.test(document.querySelector('.panel.maximized .panel-title').textContent)), JSON.stringify(s[0]));
  await page.click('.panel.maximized button:has-text("Exit full screen")'); await sleep(300);
  check('after leaving, the page scrolls normally again', await page.evaluate(() => !document.body.classList.contains('has-maximized')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
