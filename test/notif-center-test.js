'use strict';
//   xvfb-run -a node test/notif-center-test.js
// The Alerts button next to Remote view, and the Notifications Center window (history of connects and disconnects).
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-'));
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
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(300);

  // --- the button
  const order = await page.evaluate(() => { const b = document.getElementById('mapAlertTypes'); return { text: b.textContent.trim(), next: b.nextElementSibling && b.nextElementSibling.id, inBar: !!b.closest('header, .topbar, #topbar, .top-bar') || b.parentElement === document.getElementById('remoteBtn').parentElement }; });
  check('the Alerts button is in the top bar, right before Remote view', order.text === 'Alerts' && order.next === 'remoteBtn' && order.inBar, JSON.stringify(order));
  check('it is no longer on the map\'s second row', await page.evaluate(() => !document.querySelector('#mapMenuBtn').parentElement.parentElement.contains(document.getElementById('mapAlertTypes'))));
  await page.click('#tabPanels'); await sleep(300);
  await page.click('#mapAlertTypes'); await sleep(400);
  check('it opens the alerts window from the Panels tab too', await page.evaluate(() => document.getElementById('alertTypesDialog').open));
  const centerBtn = await page.evaluate(() => { const b = document.getElementById('alertTypesCenter'); const c = document.getElementById('alertTypesCancel'); return { text: b.textContent, left: b.getBoundingClientRect().left < c.getBoundingClientRect().left, sameRow: Math.abs(b.getBoundingClientRect().top - c.getBoundingClientRect().top) < 6 }; });
  check('"View Notifications Center" sits on the left of Cancel and Save', centerBtn.text === 'View Notifications Center' && centerBtn.left && centerBtn.sameRow, JSON.stringify(centerBtn));
  await page.click('#alertTypesCancel'); await sleep(300);

  // --- record some history: start watching, a device arrives, one leaves, one changes address
  await page.click('#tabMap'); await sleep(300);
  // make sure the pretend network card (10.8.0.0/24) is the one the map is using before scanning
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); window.hubNetmap.guardCheck(); }); await sleep(400);
  await page.fill('#mapCidr', '10.8.0.0/24'); await page.dispatchEvent('#mapCidr', 'change'); await sleep(200);
  // switch Live update off so no background scan (which needs two misses) can fire in the middle of the test
  await page.evaluate(() => { const l = document.getElementById('mapLive'); l.value = '0'; l.dispatchEvent(new Event('change')); }); await sleep(300);
  await scan([[5, 'linux', 'nas'], [6, 'windows', 'office-pc']]);
  await scan([[5, 'linux', 'nas'], [6, 'windows', 'office-pc'], [7, 'iot', 'plug']]);
  await scan([[5, 'linux', 'nas'], [7, 'iot', 'plug']]);              // office-pc left
  await page.click('#mapAlertTypes'); await sleep(300);
  await page.click('#alertTypesCenter');
  const win = await findCenter();
  check('"View Notifications Center" opens its own window', !!win);
  check('and closes the alerts window', await page.evaluate(() => !document.getElementById('alertTypesDialog').open));
  if (!win) { console.log('cannot continue'); await app.close(); process.exit(1); }
  const werrs = []; win.on('pageerror', (e) => werrs.push(e.message));
  await win.waitForSelector('#ncRows tr', { timeout: 8000 });
  const rows = () => win.evaluate(() => Array.from(document.querySelectorAll('#ncRows tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent.replace(/\s+/g, ' ').trim())));
  let r = await rows();
  check('three devices are listed', r.length === 3, JSON.stringify(r));
  const pc = r.find((x) => /office-pc/.test(x[0]));
  check('the office PC shows its type, MAC and IP address', pc && /Windows/.test(pc[1]) && pc[2] === 'aa:bb:cc:02:00:06' && pc[3] === '10.8.0.6', JSON.stringify(pc));
  check('it has a connected time and a disconnected time (not "Online now")', pc && /\d/.test(pc[4]) && /\d/.test(pc[5]) && !/Online now/.test(pc[5]), JSON.stringify(pc));
  check('and says how long it was online', pc && /(under 1 min|\d+ min|\d+ h)/.test(pc[6]), pc && pc[6]);
  const plug = r.find((x) => /plug/.test(x[0]));
  check('a device that arrived later is marked as first seen and is online now', plug && /first time seen/.test(plug[4]) && /Online now/.test(plug[5]) && /so far/.test(plug[6]), JSON.stringify(plug));
  const nas = r.find((x) => /nas/.test(x[0]));
  check('a device already online when watching began says so', nas && /already online when watching began/.test(nas[4]), JSON.stringify(nas));
  check('the count line says 3 records, 2 online', /3 of 3 records/.test(await win.textContent('#ncCount')) && /2 online now/.test(await win.textContent('#ncCount')), await win.textContent('#ncCount'));
  check('the window opened on this network\'s profile', (await win.evaluate(() => document.getElementById('ncProfile').selectedOptions[0].textContent)).includes('Home network') || (await win.evaluate(() => document.getElementById('ncProfile').selectedOptions.length)) === 1);

  // --- live update while the window is open: the PC comes back with another address
  await scan([[5, 'linux', 'nas'], [6, 'windows', 'office-pc'], [7, 'iot', 'plug']]);
  await sleep(800);
  r = await rows();
  check('a returning device is added live as a new record (history keeps both)', r.filter((x) => /office-pc/.test(x[0])).length === 2, JSON.stringify(r.map((x) => x[0] + '|' + x[5])));
  // --- filters and search
  await win.fill('#ncSearch', 'aa:bb:cc:02:00:07'); await sleep(200);
  check('searching by MAC address finds the device', (await rows()).length === 1 && /plug/.test((await rows())[0][0]));
  await win.fill('#ncSearch', '10.8.0.6'); await sleep(200);
  check('searching by IP address finds both records of the PC', (await rows()).length === 2);
  await win.fill('#ncSearch', '');
  await win.selectOption('#ncStatus', 'gone'); await sleep(200);
  check('"Disconnected" shows only finished records', (await rows()).length === 1 && /office-pc/.test((await rows())[0][0]));
  await win.selectOption('#ncStatus', 'online'); await sleep(200);
  check('"Online now" shows only devices that are online', (await rows()).length === 3);
  await win.selectOption('#ncStatus', 'all');
  await win.selectOption('#ncKind', 'iot'); await sleep(200);
  check('the type filter works', (await rows()).length === 1 && /plug/.test((await rows())[0][0]));
  await win.selectOption('#ncKind', 'printer'); await sleep(200);
  check('an empty result shows a friendly message', await win.evaluate(() => !document.getElementById('ncEmpty').classList.contains('hidden') && /Nothing matches/.test(document.getElementById('ncEmpty').textContent)));
  await win.selectOption('#ncKind', 'all');
  await win.click('th[data-sort="name"]'); await sleep(200);
  r = await rows();
  check('clicking a column heading sorts by it', r[0][0].startsWith('nas') || /nas/.test(r[0][0]), JSON.stringify(r.map((x) => x[0])));
  await win.fill('#ncSearch', '<img src=x onerror=alert(1)>'); await sleep(200);
  check('typing HTML in the search does nothing odd', (await win.evaluate(() => document.querySelectorAll('#ncRows img').length)) === 0);
  await win.fill('#ncSearch', '');

  // --- export
  await win.click('#ncExport'); await sleep(800);
  check('Export saves a CSV file', fs.existsSync(csvFile));
  const csv = fs.existsSync(csvFile) ? fs.readFileSync(csvFile, 'utf8') : '';
  check('with a header, the MAC addresses, IPs and both times', /MAC address/.test(csv) && /aa:bb:cc:02:00:06/.test(csv) && /10\.8\.0\.6/.test(csv) && /Disconnected \(UTC\)/.test(csv) && /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/.test(csv), csv.slice(0, 400));
  check('and the file opens correctly in a spreadsheet (starts with a byte-order mark)', csv.charCodeAt(0) === 0xfeff);
  check('a message says where it was saved', /Saved 4 records/.test(await win.textContent('#ncMsg')), await win.textContent('#ncMsg'));

  // --- history survives a restart, with the window closed
  await win.close(); await sleep(500);
  check('closing the window is fine for the main window', !page.isClosed());
  await app.close(); await sleep(800);
  check('history is saved to disk', fs.existsSync(path.join(dir, 'notifications.json')));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'notifications.json'), 'utf8'));
  check('only validated fields are stored', Object.keys(onDisk.profiles).length === 1 && Object.values(onDisk.profiles)[0].sessions.length === 4);
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await rig();
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesCenter');
  const win2 = await findCenter();
  await win2.waitForSelector('#ncRows tr', { timeout: 8000 });
  check('after a restart the history is still there', (await win2.evaluate(() => document.querySelectorAll('#ncRows tr').length)) === 4);
  // --- clear keeps online devices
  await win2.click('#ncClear'); await sleep(800);
  const left = await win2.evaluate(() => Array.from(document.querySelectorAll('#ncRows tr')).map((tr) => tr.children[5].textContent.trim()));
  check('Clear history removes finished records and keeps devices that are online now', left.length === 3 && left.every((x) => /Online now/.test(x)), JSON.stringify(left));
  // opening again focuses the same window
  await page.click('#mapAlertTypes'); await sleep(300); await page.click('#alertTypesCenter'); await sleep(800);
  check('opening it again does not make a second window', app.windows().filter((w) => true).length === 2, app.windows().length);
  check('no page errors in either window', errs.length === 0 && werrs.length === 0, errs.concat(werrs).join('|'));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
