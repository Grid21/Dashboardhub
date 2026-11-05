'use strict';
//   xvfb-run -a node test/gpu-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-'));
  const launch = async () => { const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--user-data-dir=' + ud] }); const page = await app.firstWindow(); await page.waitForSelector('#settingsBtn'); return { app, page }; };
  const get = (page) => page.evaluate(() => window.settingsApi.get());
  let { app, page } = await launch(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  let r = await get(page);
  check('graphics card is on by default', r.gpu === true && r.gpuRunning === true, JSON.stringify(r));
  await page.click('#settingsBtn'); await sleep(400);
  check('menu shows the option ticked, no restart button', await page.evaluate(() => document.getElementById('gpuCheck').checked && document.getElementById('gpuRestart').hidden));
  await page.click('#gpuCheck'); await sleep(500);
  check('unticking is saved', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).gpu === false);
  check('menu asks for a restart', await page.evaluate(() => !document.getElementById('gpuRestart').hidden && /Restart/.test(document.getElementById('gpuHint').textContent)));
  check('this run is unchanged until restart', (await get(page)).gpuRunning === true);
  await page.click('#trayCheck').catch(() => {}); await sleep(300);
  check('other settings keep the GPU choice when saved', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).gpu === false);
  await app.close(); await sleep(500);
  ({ app, page } = await launch());
  r = await get(page);
  check('after restart the graphics card is off', r.gpu === false && r.gpuRunning === false && r.gpuState === 'off', JSON.stringify(r));
  await page.click('#settingsBtn'); await sleep(400);
  check('menu shows it unticked and says software drawing', await page.evaluate(() => !document.getElementById('gpuCheck').checked && /switched off/.test(document.getElementById('gpuHint').textContent)), await page.evaluate(() => document.getElementById('gpuHint').textContent));
  await page.click('#gpuCheck'); await sleep(500);
  check('ticking again is saved', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).gpu === true);
  await app.close();
  fs.writeFileSync(path.join(ud, 'settings.json'), '{broken');
  ({ app, page } = await launch());
  check('a damaged settings file falls back to graphics card on', (await get(page)).gpuRunning === true);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
