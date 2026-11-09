'use strict';
//   xvfb-run -a node test/dialog-fit-test.js     (the Router & switch links window must fit: no sideways scroll bar, nothing cut off)
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'df-'))] });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await page.click('#tabMap'); await sleep(400);
  const measure = () => page.evaluate(() => {
    const d = document.getElementById('connDialog'); const r = d.getBoundingClientRect();
    const bad = [...d.querySelectorAll('input, select, button, label, p, .conn-row')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right - 1 || b.left < r.left - 1); }).map((e) => (e.id || e.className || e.tagName));
    return { sw: d.scrollWidth, cw: d.clientWidth, w: Math.round(r.width), vw: innerWidth, bad: bad.slice(0, 6), hscroll: d.scrollWidth > d.clientWidth };
  });
  for (const [w, h] of [[1400, 900], [1000, 700], [760, 600], [600, 700]]) {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s[0], s[1]), [w, h]); await sleep(300);
    await page.evaluate(() => document.getElementById('mapConnBtn').click()); await sleep(500);
    for (const type of ['snmp', 'unifi', 'asus']) {
      await page.selectOption('#connType', type); await sleep(150);
      if (type === 'snmp') { await page.selectOption('#connSnmpVer', '3'); await sleep(150); }
      const m = await measure();
      check(w + 'px wide, ' + type + (type === 'snmp' ? ' v3' : '') + ': no sideways scroll bar, nothing sticks out', !m.hscroll && m.bad.length === 0 && m.w <= m.vw, JSON.stringify(m));
    }
    if (w === 1400) await page.screenshot({ path: path.join(ROOT, 'test', 'dialog-shot.png') });
    await page.evaluate(() => document.getElementById('connClose').click()); await sleep(200);
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
