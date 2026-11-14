'use strict';
//   xvfb-run -a node test/manual-test.js
// The manual in the About window: tabs, topics and search.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'mn-'))] });
  const page = await app.firstWindow(); await page.waitForSelector('#aboutBtn');
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.click('#aboutBtn'); await sleep(500);
  check('About opens on the About tab (ports table visible, manual hidden)', await page.evaluate(() => !document.getElementById('aboutPane').classList.contains('hidden') && document.getElementById('manualPane').classList.contains('hidden')));
  await page.click('#aboutTabManual'); await sleep(300);
  const n = await page.evaluate(() => document.querySelectorAll('#manualList details').length);
  check('the Manual tab lists every topic (' + n + ')', n >= 18 && n === await page.evaluate(() => window.HUB_MANUAL.length));
  check('topics start closed', await page.evaluate(() => Array.from(document.querySelectorAll('#manualList details')).every((d) => !d.open)));
  await page.click('#manualList details:first-child > summary'); await sleep(200);
  check('clicking a topic opens it and shows its text', await page.evaluate(() => { const d = document.querySelector('#manualList details'); return d.open && d.querySelector('.manual-body').offsetHeight > 40; }));
  // search
  await page.fill('#manualSearch', 'alerts'); await sleep(200);
  let r = await page.evaluate(() => ({ ids: Array.from(document.querySelectorAll('#manualList details')).map((d) => d.id), open: Array.from(document.querySelectorAll('#manualList details')).every((d) => d.open), marks: document.querySelectorAll('#manualList mark').length, count: document.getElementById('manualCount').textContent }));
  check('searching "alerts" ranks the Alerts topic first', r.ids[0] === 'manual-alerts', JSON.stringify(r.ids));
  check('matches are opened and highlighted', r.open && r.marks > 0, r.marks);
  check('the match count is shown', /match/.test(r.count), r.count);
  await page.fill('#manualSearch', 'backup restore'); await sleep(200);
  r = await page.evaluate(() => Array.from(document.querySelectorAll('#manualList details')).map((d) => d.id));
  check('two words must both match ("backup restore" finds Backup)', r.includes('manual-backup'), JSON.stringify(r));
  await page.fill('#manualSearch', 'pxe'); await sleep(200);
  r = await page.evaluate(() => Array.from(document.querySelectorAll('#manualList details')).map((d) => d.id));
  check('"pxe" finds Network boot first', r[0] === 'manual-pxe', JSON.stringify(r));
  await page.fill('#manualSearch', 'ALERTS'); await sleep(200);
  check('search ignores capital letters', (await page.evaluate(() => document.querySelectorAll('#manualList details').length)) > 0);
  await page.fill('#manualSearch', 'zzqxnothing'); await sleep(200);
  check('no match shows a friendly message', await page.evaluate(() => /Nothing in the manual matches/.test(document.getElementById('manualList').textContent) && document.querySelectorAll('#manualList details').length === 0));
  await page.fill('#manualSearch', '(.*[+'); await sleep(200);
  check('odd characters in the search do not break it', errs.length === 0 && await page.evaluate(() => document.getElementById('manualCount').textContent.length > 0), errs.join('|'));
  await page.fill('#manualSearch', '<b>x</b>'); await sleep(200);
  check('HTML typed in the search is never turned into markup', await page.evaluate(() => !document.querySelector('#manualList b[class], #manualList x') && !document.getElementById('manualList').innerHTML.includes('<b>x</b>')));
  await page.fill('#manualSearch', 'snmp'); await sleep(200);
  await page.click('#manualClear'); await sleep(200);
  check('Clear brings back the full list', await page.evaluate(() => document.getElementById('manualSearch').value === '' && document.querySelectorAll('#manualList details').length === window.HUB_MANUAL.length));
  // tabs and reopening
  await page.click('#aboutTabAbout'); await sleep(200);
  check('the About tab shows the ports table again', await page.evaluate(() => document.querySelectorAll('#aboutPorts tr').length > 10 && document.getElementById('manualPane').classList.contains('hidden')));
  await page.click('#aboutTabManual'); await page.fill('#manualSearch', 'tray'); await sleep(200);
  await page.click('#aboutClose'); await sleep(300); await page.click('#aboutBtn'); await sleep(500);
  check('reopening About starts on the About tab with an empty search', await page.evaluate(() => !document.getElementById('aboutPane').classList.contains('hidden') && document.getElementById('manualSearch').value === ''));
  // the manual must only name things that exist in the app
  const labels = await page.evaluate(() => ({ top: ['Panels', 'Network Map', 'Remote view', '>_ Servers', 'Settings', 'Updates', 'About', 'Reload'].map((t) => [t, Array.from(document.querySelectorAll('header button, header .settings-control button, #tabMap, #tabPanels, .tabs button')).some((b) => b.textContent.replace(/[▾⚙↻]/g, '').trim().startsWith(t))]), ids: ['mapAlertTypes', 'mapMenuBtn', 'mapScan', 'mapAlerts', 'mapListBtn', 'mapBwBtn', 'bmcMenuBtn', 'pxeMenuBtn', 'securityMenuBtn', 'backupBtn', 'toolsMenuBtn', 'updCheckNow', 'profileLock', 'addBtn', 'reloadAll', 'trayCheck', 'gpuCheck'].map((i) => [i, !!document.getElementById(i)]) }));
  const missing = labels.top.concat(labels.ids).filter((x) => !x[1]).map((x) => x[0]);
  check('every button the manual names exists', missing.length === 0, missing.join(', '));
  check('no page errors', errs.length === 0, errs.join('|'));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
