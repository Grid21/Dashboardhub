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
  const ALL = [[5, 'linux', 'nas'], [6, 'windows', 'office-pc'], [7, 'iot', '<b>plug</b>']], PLUG = [5, 'linux', 'nas'], PL = [7, 'iot', '<b>plug</b>'];
  await scan(ALL); await scan(ALL);
  await scan([PLUG, PL]);            // office-pc leaves and never returns
  await scan([PLUG]); await scan([PLUG, PL]);       // the plug drops off and comes back, three times
  await scan([PLUG]); await scan([PLUG, PL]);
  await scan([PLUG]); await scan([PLUG, PL]);
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
  check('the summary counts 3 devices and 4 drops', /3 devices watched/.test(sum) && /4 times a device went offline \(2 devices\)/.test(sum) && /1 offline right now/.test(sum), sum);
  check('the summary says how much was watched', /Dashboard Hub was watching \d+(\.\d)?% of this period/.test(sum), sum);
  const story = await win.evaluate(() => Array.from(document.querySelectorAll('#upStory li')).map((l) => l.textContent));
  check('a device that keeps dropping briefly gets ONE line, not a sentence each', story.length === 2 && /^<b>plug<\/b> dropped off 3 times between today .+ and today .+ \(.+ offline in total, none longer than .+\)\.$/.test(story[0]), JSON.stringify(story));
  check('a device that dropped once keeps its plain sentence', /^office-pc went offline at today \d{1,2}:\d{2}\s?[AP]M, and has not come back yet \(off for (under 1 min|\d+ min) so far\)\.$/i.test(story[1]), story[1]);
  const rows = await win.evaluate(() => Array.from(document.querySelectorAll('#upRows .up-row')).map((r) => ({ name: r.querySelector('.up-name').firstChild.textContent, pct: r.querySelector('.up-pct').textContent, segs: Array.from(r.querySelectorAll('.up-seg')).map((s) => s.className.replace('up-seg ', '')) })));
  check('every device has a row', rows.length === 3, JSON.stringify(rows));
  const off = rows.find((r) => r.name === 'office-pc');
  check('office-pc is gray (before watching began), then green, then red', off && off.segs.join(',') === 'unknown,up,down' && /1 drop$/.test(off.pct), JSON.stringify(off));
  const plug = rows.find((r) => r.name === '<b>plug</b>');
  check('the plug shows three red stretches', plug && plug.segs.filter((x) => x === 'down').length === 3 && /3 drops/.test(plug.pct), JSON.stringify(plug));
  check('the NAS that stayed on is gray (before watching began) and then green', rows.find((r) => r.name === 'nas').segs.join(',') === 'unknown,up' && /^100% online$/.test(rows.find((r) => r.name === 'nas').pct), JSON.stringify(rows));
  check('devices that are offline now come first, then the ones with the most drops', rows[0].name === 'office-pc' && rows[1].name === '<b>plug</b>' && rows[2].name === 'nas', JSON.stringify(rows.map((r) => r.name + ' ' + r.pct)));
  check('a device name is shown as text, never as markup', await win.evaluate(() => document.querySelectorAll('#upRows b, #upStory b').length === 0) && rows.some((r) => r.name === '<b>plug</b>'), JSON.stringify(rows.map((r) => r.name)));
  const widths = await win.evaluate(() => Array.from(document.querySelectorAll('#upRows .up-row')).find((r) => /office-pc/.test(r.textContent)).querySelectorAll('.up-seg').length && Array.from(document.querySelectorAll('#upRows .up-row')).find((r) => /office-pc/.test(r.textContent)).querySelector('.up-bar').getBoundingClientRect().width);
  check('the bars have a real size on screen', widths > 100, widths);
  if (process.env.UPTIME_SHOT) await win.screenshot({ path: process.env.UPTIME_SHOT });
  // filters
  await win.check('#upOnlyDown'); await sleep(200);
  check('"only devices that went offline" leaves the two that dropped', await win.evaluate(() => document.querySelectorAll('#upRows .up-row').length === 2));
  await win.uncheck('#upOnlyDown'); await sleep(200);
  // regression: the sentence box must stay put through many refreshes (it once flipped on and off at every refresh)
  const seen = [];
  for (let i = 0; i < 6; i++) { await win.evaluate(() => window.hubNotifTest.upLoad()); await sleep(350); seen.push(await win.evaluate(() => !document.getElementById('upStoryBox').classList.contains('hidden') && !document.getElementById('upDevices').classList.contains('hidden') && document.querySelectorAll('#upStory li').length)); }
  check('six refreshes in a row: sentences and devices stay visible every time', seen.every((x) => x === 2), JSON.stringify(seen));
  await win.fill('#upSearch', 'a'); await win.fill('#upSearch', ''); await sleep(200);
  check('typing in the search and clearing it keeps them visible', await win.evaluate(() => !document.getElementById('upStoryBox').classList.contains('hidden')));
  // layout: the devices come first and the sentence list never grows past its box
  const lay = await win.evaluate(() => ({ devTop: document.getElementById('upDevices').getBoundingClientRect().top, storyTop: document.getElementById('upStoryBox').getBoundingClientRect().top, maxH: getComputedStyle(document.getElementById('upStory')).maxHeight }));
  check('the device bars come before the sentences', lay.devTop < lay.storyTop, JSON.stringify(lay));
  check('the sentence list has a fixed maximum height and scrolls inside', lay.maxH !== 'none' && parseInt(lay.maxH, 10) > 0, lay.maxH);
  // click the device's row: only its own drops, one sentence each
  await win.evaluate(() => { Array.from(document.querySelectorAll('#upRows .up-row')).find((r) => /plug/.test(r.textContent)).click(); }); await sleep(300);
  const foc = await win.evaluate(() => ({ chip: !document.getElementById('upFocus').classList.contains('hidden') && document.getElementById('upFocusName').textContent, lines: Array.from(document.querySelectorAll('#upStory li')).map((l) => l.textContent), picked: document.querySelectorAll('#upRows .up-row.picked').length }));
  check('clicking a device shows each of its drops as its own sentence', foc.chip === '<b>plug</b>' && foc.lines.length === 3 && foc.lines.every((t) => /^<b>plug<\/b> went offline at today .+, and came back at today .+\(off for .+\)\.$/.test(t)) && foc.picked === 1, JSON.stringify(foc));
  await win.click('#upFocusX'); await sleep(200);
  await win.check('#upAllEvents'); await sleep(200);
  check('"show every event" lists all four sentences', (await win.evaluate(() => document.querySelectorAll('#upStory li').length)) === 4);
  await win.uncheck('#upAllEvents'); await sleep(200);
  // hiding short drops: the plug's drops last seconds, office-pc is still offline and stays
  await win.selectOption('#upMinDrop', '120000'); await sleep(900);
  const hid = { story: await win.evaluate(() => Array.from(document.querySelectorAll('#upStory li')).map((l) => l.textContent)), sum: await win.textContent('#upSummary') };
  check('hiding short drops removes the plug\'s but keeps the device that is still offline', hid.story.length === 1 && /^office-pc went offline/.test(hid.story[0]) && /1 time a device went offline \(1 device\)/.test(hid.sum), JSON.stringify(hid));
  check('the bars are not changed by it (they stay truthful)', await win.evaluate(() => Array.from(document.querySelectorAll('#upRows .up-row')).find((r) => /plug/.test(r.textContent)).querySelectorAll('.up-seg.down').length === 3));
  await win.selectOption('#upMinDrop', '0'); await sleep(900);
  // a refresh does not make the lists jump
  await win.evaluate(() => { document.getElementById('upStory').style.maxHeight = '40px'; });
  await win.check('#upAllEvents'); await sleep(200);
  await win.evaluate(() => { document.getElementById('upStory').scrollTop = 30; });
  await win.evaluate(() => window.hubNotifTest.upLoad()); await sleep(600);
  check('after a refresh the list is still scrolled where it was', (await win.evaluate(() => document.getElementById('upStory').scrollTop)) === 30);
  await win.uncheck('#upAllEvents'); await win.evaluate(() => { document.getElementById('upStory').style.maxHeight = ''; }); await sleep(200);
  await win.fill('#upSearch', 'nas'); await sleep(200);
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
  check('after a restart the history is still there', /3 devices watched/.test(await win2.textContent('#upSummary')) && (await win2.evaluate(() => document.querySelectorAll('#upStory li').length)) === 2);
  check('no script errors', errs.length === 0 && werrs.length === 0, errs.concat(werrs).join(' | '));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
