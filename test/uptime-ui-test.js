'use strict';
//   xvfb-run -a node test/uptime-ui-test.js
// The "Uptime and history" tab of the Notifications Center, driven by simulated scans (no real network).
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upt-'));
  const csvFile = path.join(dir, 'out.csv');
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  let app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const rig = () => app.evaluate(({ ipcMain, BrowserWindow, dialog }, f) => {
    global.__send = (m) => { try { BrowserWindow.getAllWindows().find((w) => /Dashboard Hub$/.test(w.getTitle()) || !/Notifications|Remote/.test(w.getTitle())).webContents.send('net:event', m); } catch (e) {} };
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.8.0.9', cidr: '10.8.0.0/24' }], gateway: '10.8.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} }));
    ipcMain.removeHandler('net:scan'); ipcMain.handle('net:scan', () => ({ ok: true }));
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, csvFile);
  await rig();
  const host = (n, osid, name) => app.evaluate((_, a) => global.__send({ type: 'host', host: { ip: '10.8.0.' + a.n, mac: 'aa:bb:cc:02:00:' + String(a.n).padStart(2, '0'), hostname: a.name || (a.os + a.n), online: true, ports: [], ttl: 64, os: { id: a.os, label: a.os, confidence: 'high', reasons: [] } } }), { n, os: osid, name });
  const done = () => app.evaluate(() => global.__send({ type: 'done', count: 5 }));
  const scan = async (hosts) => { await page.click('#mapScan'); await sleep(300); for (const h of hosts) await host(h[0], h[1], h[2]); await done(); await sleep(1500); };
  const winTitle = (w) => w.title();
  const findCenter = async () => { for (let i = 0; i < 40; i++) { for (const w of app.windows()) { if (/Notifications Center/.test(await winTitle(w))) return w; } await sleep(250); } return null; };
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(400);
  await page.evaluate(() => { const c = document.getElementById('mapCidr'); c.value = '10.8.0.0/24'; c.dispatchEvent(new Event('change')); }); await sleep(300);
  await page.evaluate(() => { const l = document.getElementById('mapLive'); l.value = '0'; l.dispatchEvent(new Event('change')); }); await sleep(300);
  // three manual scans: everyone there, then "office-pc" is missing
  await scan([[5, 'linux', 'nas'], [6, 'windows', 'office-pc'], [7, 'iot', '<b>plug</b>']]);
  await scan([[5, 'linux', 'nas'], [6, 'windows', 'office-pc'], [7, 'iot', '<b>plug</b>']]);
  await scan([[5, 'linux', 'nas'], [7, 'iot', '<b>plug</b>']]);
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesCenter');
  const win = await findCenter();
  check('the Notifications Center opens', !!win);
  if (!win) { await app.close(); process.exit(1); }
  const werrs = []; win.on('pageerror', (e) => werrs.push(e.message));
  await sleep(800);
  check('it has the two tabs, the list first', await win.evaluate(() => document.getElementById('ncTabList').classList.contains('active') && !document.getElementById('ncListView').classList.contains('hidden') && document.getElementById('ncUpView').classList.contains('hidden')));
  await win.click('#ncTabUp'); await sleep(800);
  check('the Uptime tab shows and the list hides', await win.evaluate(() => !document.getElementById('ncUpView').classList.contains('hidden') && document.getElementById('ncListView').classList.contains('hidden')));
  const sum = await win.textContent('#upSummary');
  check('the summary counts 3 devices and 1 drop', /3 devices watched/.test(sum) && /1 time a device went offline \(1 device\)/.test(sum) && /offline right now/.test(sum), sum);
  check('the summary says how much was watched', /Dashboard Hub was watching \d+(\.\d)?% of this period/.test(sum), sum);
  const story = await win.evaluate(() => Array.from(document.querySelectorAll('#upStory li')).map((l) => l.textContent));
  check('a plain sentence says office-pc went offline', story.length === 1 && /^office-pc went offline at today \d{1,2}:\d{2}\s?[AP]M, and has not come back yet \(off for (under 1 min|\d+ min) so far\)\.$/i.test(story[0]), JSON.stringify(story));
  const rows = await win.evaluate(() => Array.from(document.querySelectorAll('#upRows .up-row')).map((r) => ({ name: r.querySelector('.up-name').firstChild.textContent, pct: r.querySelector('.up-pct').textContent, segs: Array.from(r.querySelectorAll('.up-seg')).map((s) => s.className.replace('up-seg ', '')) })));
  check('every device has a row', rows.length === 3, JSON.stringify(rows));
  const off = rows.find((r) => r.name === 'office-pc');
  check('office-pc is gray (before watching began), then green, then red', off && off.segs.join(',') === 'unknown,up,down' && /1 drop/.test(off.pct), JSON.stringify(off));
  check('the devices that stayed on are gray (before watching began) and then green', rows.filter((r) => r.name !== 'office-pc').every((r) => r.segs.join(',') === 'unknown,up' && /^100% online$/.test(r.pct)), JSON.stringify(rows));
  check('the device with the most drops is listed first', rows[0].name === 'office-pc');
  check('a device name is shown as text, never as markup', await win.evaluate(() => document.querySelectorAll('#upRows b, #upStory b').length === 0) && rows.some((r) => r.name === '<b>plug</b>'), JSON.stringify(rows.map((r) => r.name)));
  const widths = await win.evaluate(() => Array.from(document.querySelectorAll('#upRows .up-row')).find((r) => /office-pc/.test(r.textContent)).querySelectorAll('.up-seg').length && Array.from(document.querySelectorAll('#upRows .up-row')).find((r) => /office-pc/.test(r.textContent)).querySelector('.up-bar').getBoundingClientRect().width);
  check('the bars have a real size on screen', widths > 100, widths);
  // filters
  await win.check('#upOnlyDown'); await sleep(200);
  check('"only devices that went offline" leaves just office-pc', await win.evaluate(() => document.querySelectorAll('#upRows .up-row').length === 1));
  await win.uncheck('#upOnlyDown'); await win.fill('#upSearch', 'nas'); await sleep(200);
  check('the search narrows the devices', await win.evaluate(() => document.querySelectorAll('#upRows .up-row').length === 1 && /nas/.test(document.getElementById('upRows').textContent)));
  await win.fill('#upSearch', 'zzz'); await sleep(200);
  check('a search with no match says so', /Nothing matches/.test(await win.textContent('#upEmpty')));
  await win.fill('#upSearch', ''); await win.selectOption('#upRange', '604800000'); await sleep(800);
  check('another time period works', await win.evaluate(() => document.querySelectorAll('#upRows .up-row').length === 3) && /3 devices watched/.test(await win.textContent('#upSummary')));
  // the list tab still works
  await win.click('#ncTabList'); await sleep(300);
  check('the connections list is still there', await win.evaluate(() => document.querySelectorAll('#ncRows tr').length >= 3 && !document.getElementById('ncListView').classList.contains('hidden')));
  // the watching periods are saved on disk and survive a restart
  await app.close(); await sleep(1200);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'notifications.json'), 'utf8'));
  const p0 = saved.profiles[Object.keys(saved.profiles)[0]];
  check('the watching period is saved', Array.isArray(p0.watch) && p0.watch.length === 1 && p0.watchSince > 0, JSON.stringify(p0.watch));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await rig(); await page.click('#tabMap'); await sleep(500);
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesCenter');
  const win2 = await findCenter(); await sleep(800);
  await win2.click('#ncTabUp'); await sleep(800);
  check('after a restart the history is still there', /3 devices watched/.test(await win2.textContent('#upSummary')) && (await win2.evaluate(() => document.querySelectorAll('#upStory li').length)) === 1);
  check('no script errors', errs.length === 0 && werrs.length === 0, errs.concat(werrs).join(' | '));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
