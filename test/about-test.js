'use strict';
//   xvfb-run -a node test/about-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'))] });
  const page = await app.firstWindow();
  for (const size of [{ width: 1400, height: 900 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(size);
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForSelector('#aboutBtn');
    check('About button is in the top bar, next to Updates (' + size.width + 'px wide)', await page.evaluate(() => { const a = document.getElementById('aboutBtn'), u = document.getElementById('updatesBtn'); return a.offsetParent !== null && a.previousElementSibling === u; }));
    await page.click('#aboutBtn'); await sleep(500);
    const t = await page.evaluate(() => document.getElementById('aboutDialog').innerText);
    check('it opens as a popup', await page.evaluate(() => document.getElementById('aboutDialog').open));
    check('shows the version', /Version \d+\.\d+\.\d+/.test(t), t.slice(0, 120));
    check('shows the license', /GNU General Public License/.test(t));
    check('shows the ports table with SNMP and a header', /UDP 161/.test(t) && /What it is for/.test(t) && /TCP 49000/.test(t));
    check('table has every row', await page.evaluate(() => document.querySelectorAll('#aboutPorts tr').length === 19));
    check('window fits on screen and Close is reachable', await page.evaluate(() => { const r = document.getElementById('aboutClose').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0 && r.right <= innerWidth; }));
    await page.click('#aboutClose'); await sleep(300);
    check('Close works', !(await page.evaluate(() => document.getElementById('aboutDialog').open)));
    check('no page errors', errors.length === 0, errors.join(' | '));
  }
  await page.screenshot({ path: process.env.SHOT || '/tmp/about-shot.png' });
  await page.setViewportSize({ width: 1200, height: 800 }); await page.click('#aboutBtn'); await sleep(400);
  await page.screenshot({ path: path.join(os.tmpdir(), 'about-shot.png') });
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
