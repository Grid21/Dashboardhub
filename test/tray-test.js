'use strict';
//   xvfb-run -a node test/tray-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  let app = await launch(); let page = await app.firstWindow();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#settingsBtn');
  const win = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? { visible: w.isVisible(), destroyed: w.isDestroyed() } : null; });
  await page.click('#settingsBtn'); await sleep(300);
  check('Settings menu opens with the tray option, off by default', await page.evaluate(() => !document.getElementById('profilesMenu').classList.contains('hidden') && !document.getElementById('trayCheck').checked && !!document.getElementById('backupBtn') && !!document.getElementById('profileChoices')));
  // turn it on
  await page.click('#trayCheck'); await sleep(600);
  const on = await page.evaluate(() => document.getElementById('trayCheck').checked);
  const msg = await page.evaluate(() => document.getElementById('settingsMsg').textContent);
  console.log('  (tray available on this test machine: ' + on + ' — ' + msg.slice(0, 90) + ')');
  if (on) {
    check('setting saved to disk', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).closeToTray === true);
    check('a tray icon exists', await app.evaluate((a) => !!a.app.hubTray));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await sleep(600);
    let w = await win();
    check('X hides the window instead of closing the app', w && !w.destroyed && w.visible === false, JSON.stringify(w));
    await app.evaluate((a) => { a.app.hubTray.emit('click'); }); await sleep(500);
    w = await win();
    check('clicking the tray icon shows the window again', w && w.visible === true, JSON.stringify(w));
    // turn off: X closes normally
    await page.click('#trayCheck'); await sleep(500);
    check('turning it off removes the tray icon', await app.evaluate((a) => !a.app.hubTray));
    check('off is saved', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).closeToTray === false);
    // on again, then restart the app: tray comes back by itself
    await page.click('#trayCheck'); await sleep(500);
    await app.close(); app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#settingsBtn'); await sleep(500);
    check('after a restart the tray icon is back', await app.evaluate((a) => !!a.app.hubTray));
    // Quit from the tray menu really quits
    // with the setting ON, "Quit" in the tray menu really ends the app; (the menu item calls app.quit())
    const closed = new Promise((r) => app.process().once('exit', () => r(true)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await sleep(500);
    check('window hidden again after restart', (await win()).visible === false);
    await app.evaluate((a) => { a.app.quit(); });
    check('quit ends the app even while hidden', await Promise.race([closed, sleep(8000).then(() => false)]));
    // setting OFF: X closes the app
    const ud2 = ud;
    fs.writeFileSync(path.join(ud2, 'settings.json'), JSON.stringify({ closeToTray: false }));
    app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#settingsBtn');
    const closed2 = new Promise((r) => app.process().once('exit', () => r(true)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    check('with the setting off, X closes the app as before', await Promise.race([closed2, sleep(8000).then(() => false)]));
  } else {
    check('without a tray the option is refused and left off (window cannot get lost)', !on && /tray/i.test(msg));
    check('nothing saved as on', !fs.existsSync(path.join(ud, 'settings.json')) || JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).closeToTray !== true);
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  try { await app.close(); } catch (e) { /* already closed */ }
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
