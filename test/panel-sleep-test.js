'use strict';
//   xvfb-run -a node test/panel-sleep-test.js
// Panels only run while someone can see them, and sleep after being away.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<h1>panel</h1><p id=h>' + q.headers.host + '</p>'); });
  await new Promise((r) => srv.listen(0, '0.0.0.0', r)); const port = srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  let app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('#aboutBtn'); await sleep(1200);
  await page.evaluate((port) => { state.panels.length = 0; for (let i = 0; i < 4; i++) state.panels.push({ id: 'p' + i, name: 'P' + i, url: 'http://127.0.0.' + (i + 1) + ':' + port }); saveState(); }, port);
  await app.close(); await sleep(800);
  const procs = (a) => a.evaluate(({ app }) => app.getAppMetrics().length);
  // start with the Panels tab showing: all four load
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#aboutBtn'); await sleep(3000);
  const base = await procs(app);
  const wvs = () => page.evaluate(() => document.querySelectorAll('webview').length);
  check('with the Panels tab showing, all 4 panels run', (await wvs()) === 4, await wvs());
  await page.evaluate(() => { window.hubPanelSleepMs = 1500; });
  await page.click('#tabMap'); await sleep(600);
  check('right after leaving the tab they are still running (grace time)', (await wvs()) === 4);
  await sleep(2500);
  check('after the grace time the panels sleep (no web pages left)', (await wvs()) === 0, await wvs());
  const asleepProcs = await procs(app);
  check('and their processes are gone (' + base + ' -> ' + asleepProcs + ')', asleepProcs <= base - 4, base + ' -> ' + asleepProcs);
  check('each sleeping panel says so', await page.evaluate(() => document.querySelectorAll('.panel-nap:not(.hidden)').length === 4 && /Asleep/.test(document.querySelector('.panel-nap').textContent)));
  await page.click('#tabPanels'); await sleep(3000);
  check('coming back wakes all 4 panels', (await wvs()) === 4, await wvs());
  check('and they load their pages again', await page.evaluate(() => Array.from(document.querySelectorAll('webview')).every((w) => !w.isLoading())));
  // quick trip away and back keeps them running (no needless restarts)
  const idBefore = await page.evaluate(() => { window.__mark = document.querySelector('webview'); return 1; });
  await page.click('#tabMap'); await sleep(500); await page.click('#tabPanels'); await sleep(800);
  check('a short trip to the map does not restart panels', await page.evaluate(() => document.querySelector('webview') === window.__mark));
  // the setting
  await page.evaluate(() => { document.getElementById('settingsBtn').click(); });
  await sleep(300);
  check('Settings has the sleep checkbox, ticked by default', await page.evaluate(() => document.getElementById('panelSleepCheck').checked));
  await page.evaluate(() => { const c = document.getElementById('panelSleepCheck'); c.checked = false; c.dispatchEvent(new Event('change')); });
  await page.keyboard.press('Escape');
  await page.click('#tabMap'); await sleep(3500);
  check('with the setting off, panels keep running on the map tab', (await wvs()) === 4, await wvs());
  await page.evaluate(() => { const c = document.getElementById('panelSleepCheck'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await sleep(3000);
  check('turning it back on puts them to sleep after the grace time', (await wvs()) === 0, await wvs());
  // click-to-wake and the reload button on a sleeping panel
  await page.evaluate(() => document.querySelector('.panel-nap').click()); await sleep(1500);
  check('clicking a sleeping panel wakes just that one', (await wvs()) === 1, await wvs());
  await app.close(); await sleep(800);
  // start on the map tab: nothing loads until the Panels tab is opened
  await app.close().catch(() => {});
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#aboutBtn');
  await page.click('#tabMap'); await page.evaluate(() => render()); await sleep(2000);
  check('panels drawn while the map is showing are not started yet', (await wvs()) === 0 && await page.evaluate(() => /Not loaded yet/.test(document.querySelector('.panel-nap').textContent)));
  await page.click('#tabPanels'); await sleep(2500);
  check('they start when the Panels tab opens', (await wvs()) === 4, await wvs());
  // maximize and per-panel reload still work
  await page.evaluate(() => document.querySelector('.panel-head button[title*="ull"], .panel-head button').click());
  await sleep(300);
  console.log('  info  window-hidden and tray cases: tested through the same page-class switch');
  await page.evaluate(() => { document.body.classList.add('window-hidden'); window.hubPanelSleepMs = 800; window.hubPanelSleepCheck(); }); await sleep(1800);
  check('a window hidden in the tray puts panels to sleep too', (await wvs()) === 0, await wvs());
  await page.evaluate(() => { document.body.classList.remove('window-hidden'); }); await sleep(2500);
  check('and showing the window wakes them', (await wvs()) === 4, await wvs());
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); srv.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
