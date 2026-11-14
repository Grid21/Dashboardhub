'use strict';
//   xvfb-run -a node test/fuzz-ipc-test.js
// Sends junk (wrong types, huge text, strange characters, missing values) to EVERY channel between the window and the
// main program, and checks that the program never crashes, never hangs, and stays usable afterwards.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud], env: Object.assign({}, process.env, { HUB_TEST: '1' }) });
  const page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  const res = await app.evaluate(async ({ ipcMain, BrowserWindow, dialog, shell, app }) => {
    // nothing may really open, save, restart or quit during this test
    const none = async () => ({ response: 0, canceled: true, filePaths: [], filePath: undefined });
    dialog.showMessageBox = none; dialog.showSaveDialog = none; dialog.showOpenDialog = none; dialog.showMessageBoxSync = () => 0; dialog.showErrorBox = () => {};
    shell.openExternal = async () => {}; shell.openPath = async () => ''; shell.showItemInFolder = () => {};
    app.relaunch = () => {}; app.quit = () => {}; app.exit = () => {};
    const skip = /^(app:restart|app:reload|updater:(install|armInstall|switchTo|apply)|pxe:(start|serve))/;
    const junk = [undefined, null, 0, -1, NaN, 1e21, true, false, '', ' ', 'x'.repeat(200000), '../../etc/passwd', '..\\..\\x', '\u0000', '<script>alert(1)</script>', '%s%n%x', '{"a":1}', [], [null], [[]], new Array(5000).fill('a'), {}, { id: {} }, { id: '../x', host: 'localhost; rm -rf /', port: 'abc' }, { __proto__: { polluted: 1 } }, Object.create(null), () => 1, Symbol.iterator.toString()];
    const names = Object.keys(ipcMain._invokeHandlers ? Object.fromEntries(ipcMain._invokeHandlers) : {});
    const win = BrowserWindow.getAllWindows()[0];
    const bad = [], tried = [];
    const lg = (m) => process.getBuiltinModule('fs').appendFileSync(process.env.FUZZ_LOG || '/tmp/fuzz.log', m + '\n');
    for (const ch of names) {
      if (skip.test(ch)) continue;
      const t0 = Date.now();
      const fn = ipcMain._invokeHandlers.get(ch);
      for (let i = 0; i < junk.length; i++) {
        const args = [junk[i], junk[(i + 3) % junk.length], junk[(i + 7) % junk.length]];
        tried.push(ch);
        try {
          const r = await Promise.race([Promise.resolve(fn({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, ...args)), new Promise((_, rej) => setTimeout(() => rej(new Error('HANG')), 4000))]);
          try { JSON.stringify(r); } catch (e) { bad.push(ch + ' returns something that cannot be sent'); }
        } catch (e) {
          if (/HANG/.test(String(e && e.message))) bad.push(ch + ' hung on input #' + i);
          // a clean refusal (thrown error) is fine
        }
      }
      lg(ch + ' ' + (Date.now() - t0) + 'ms');
    }
    return { channels: names.length, calls: tried.length, bad: Array.from(new Set(bad)).slice(0, 40), polluted: ({}).polluted === 1 };
  });
  check('found the channels to test (' + res.channels + ')', res.channels > 50, res.channels);
  check('no channel hung or returned something unsendable (' + res.calls + ' junk calls)', res.bad.length === 0, JSON.stringify(res.bad));
  check('no input polluted the base object prototype', res.polluted === false);
  const alive = await page.evaluate(() => typeof window.hubNetmap === 'object' && !!document.querySelector('#tabMap'));
  check('the window is still alive and working afterwards', alive);
  await page.click('#tabMap'); await new Promise((r) => setTimeout(r, 400));
  check('the map tab still opens', await page.locator('#mapScan').count() === 1);
  await app.evaluate(() => { setTimeout(() => { throw new Error('PRETEND-CRASH'); }, 10); Promise.reject(new Error('PRETEND-REJECT')); });
  await new Promise((r) => setTimeout(r, 1000));
  const logTxt = (() => { try { return fs.readFileSync(path.join(ud, 'error-log.txt'), 'utf8'); } catch (e) { return ''; } })();
  check('an unexpected error in the main program is logged, not shown as a crash box', /PRETEND-CRASH/.test(logTxt) && /PRETEND-REJECT/.test(logTxt), logTxt.slice(0, 200));
  check('the app keeps running after an unexpected error', await page.evaluate(() => typeof window.hubNetmap === 'object'));
  await app.close();
  console.log(failed ? failed + ' failed' : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  FAIL  test crashed: ' + e.message); process.exit(1); });
