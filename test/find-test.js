'use strict';
// Ctrl+F in the Panels tab: finds words inside any panel, also when the keyboard is inside the panel's web page.
//   xvfb-run -a node test/find-test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; console.log('  ok    ' + name); } else { failed++; console.log('  FAIL  ' + name + (detail !== undefined ? '   -> ' + detail : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const pages = { '/a': '<html><body style="font-size:30px"><h1>Alpha page</h1><p>needle one</p><p>needle two</p><p>needle three</p><p>hay</p></body></html>', '/b': '<html><body style="font-size:30px"><h1>Beta page</h1><p>apple</p><p>needle only once</p></body></html>' };
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(pages[q.url] || '<html></html>'); });
  await new Promise((r) => srv.listen(3555, '127.0.0.3', r));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'finddata-'))], env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '0' }) });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForSelector('#addBtn');
  for (const [n, u] of [['Alpha', '127.0.0.3:3555/a'], ['Beta', '127.0.0.3:3555/b']]) {
    await page.click('#addBtn'); await page.fill('#nameInput', n); await page.fill('#urlInput', u); await page.click('#dialog button[type=submit]'); await sleep(800);
  }
  await page.evaluate(() => { document.querySelectorAll('webview').forEach((w) => { w.style.height = '300px'; }); });
  await sleep(1500);
  const bars = () => page.evaluate(() => Array.from(document.querySelectorAll('.panel')).map((p) => { const b = p.querySelector('.find-bar'); return { open: !b.classList.contains('hidden'), count: p.querySelector('.find-count').textContent, val: b.querySelector('input').value }; }));
  console.log('\nFind in panels');
  check('every panel has a Find button', (await page.evaluate(() => Array.from(document.querySelectorAll('.panel-head button')).filter((b) => b.textContent === 'Find').length)) === 2);
  // point at panel 2, press Ctrl+F on the dashboard itself
  await page.hover('.panel:nth-child(2) .panel-head'); await sleep(200);
  await page.keyboard.press('Control+f'); await sleep(300);
  let b = await bars();
  check('Ctrl+F opens the find box in the panel you are pointing at', !b[0].open && b[1].open, JSON.stringify(b));
  await page.keyboard.type('needle'); await sleep(900);
  b = await bars();
  check('typing finds the words inside that panel\'s page (1 match in Beta)', /1 of 1/.test(b[1].count), b[1].count);
  await page.keyboard.press('Escape'); await sleep(200);
  check('Esc closes it', !(await bars())[1].open);
  // panel 1: via the Find button, then Enter moves to the next match
  await page.click('.panel:nth-child(1) .panel-head button:has-text("Find")'); await sleep(300);
  await page.keyboard.type('needle'); await sleep(900);
  b = await bars();
  check('Alpha has 3 matches', /1 of 3/.test(b[0].count), b[0].count);
  await page.keyboard.press('Enter'); await sleep(500);
  check('Enter goes to the next match', /2 of 3/.test((await bars())[0].count), (await bars())[0].count);
  await page.keyboard.press('Shift+Enter'); await sleep(500);
  check('Shift+Enter goes back', /1 of 3/.test((await bars())[0].count), (await bars())[0].count);
  await page.keyboard.press('Control+a'); await page.keyboard.type('zzzz'); await sleep(700);
  check('no match says so', /No matches/.test((await bars())[0].count));
  await page.keyboard.press('Escape'); await sleep(200);
  // the keyboard is INSIDE a panel's web page: Ctrl+F must still work there
  await page.click('.panel:nth-child(2) .panel-body webview', { position: { x: 60, y: 60 } }); await sleep(500);
  // the keyboard of a real panel page is not reachable through the dashboard page, so the key is sent to that page itself
  await app.evaluate(({ webContents }) => { const g = webContents.getAllWebContents().filter((w) => w.getType() === 'webview'); const wc = g.find((w) => /\/b$/.test(w.getURL())) || g[1]; wc.focus(); wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] }); });
  await sleep(700);
  b = await bars();
  check('Ctrl+F also works while you are clicked inside a panel\'s web page', b[1].open, JSON.stringify(b));
  await page.keyboard.type('apple'); await sleep(900);
  check('and finds words there', /1 of 1/.test((await bars())[1].count), (await bars())[1].count);
  check('no script errors', errors.length === 0, errors.join(' | '));
  await app.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log('CRASHED ' + (e && e.stack || e)); process.exit(1); });
