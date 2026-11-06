'use strict';
//   xvfb-run -a node test/updwin-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'uw-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  const setInfo = (info) => app.evaluate(({ ipcMain }, i) => { ipcMain.removeHandler('update:info'); ipcMain.handle('update:info', () => i); }, info);
  const open = async () => { await page.evaluate(() => { const d = document.getElementById('updateDialog'); if (d.open) d.close(); document.getElementById('updatesBtn').click(); }); await sleep(500); };
  const shown = (id) => page.evaluate((i) => { const e = document.getElementById(i); return !!e && !e.classList.contains('hidden') && e.offsetParent !== null; }, id);
  // running an installed update, nothing earlier stored (like the screenshot)
  await setInfo({ version: '1.10.59', builtIn: '1.10.1', source: 'update', note: '', previous: null, problem: null });
  await open();
  check('Updates window: the online check button is there', await shown('updDlgCheck'));
  check('Updates window: install from file is there', await shown('updateInstall'));
  check('Updates window: "go back to last working version" is visible even with nothing stored, but cannot be clicked', await shown('updateRevertPrev') && await page.evaluate(() => document.getElementById('updateRevertPrev').disabled === true));
  const note = await page.textContent('#updateNote');
  check('it says why, in plain words', /No earlier update is stored/.test(note), note);
  check('go back to the built-in version is there too', await shown('updateRevert'));
  // the "Open updates folder" button
  check('Updates window: "Open updates folder" button is there', await shown('updDlgFolder'));
  await app.evaluate(({ shell }) => { global.__opened = null; shell.openPath = async (p) => { global.__opened = p; return global.__openErr || ''; }; });
  await page.click('#updDlgFolder'); await sleep(500);
  const opened = await app.evaluate(() => global.__opened);
  check('it opens the app\'s own "updates" folder, and the folder exists', !!opened && /[\\/]updates$/.test(opened) && require('fs').existsSync(opened), String(opened));
  check('and says so', /Opened the updates folder/.test(await page.textContent('#updDlgMsg')));
  await app.evaluate(() => { global.__openErr = 'no file manager'; });
  await page.click('#updDlgFolder'); await sleep(500);
  check('if the system cannot open it, a plain message says so', /Could not open the folder/.test(await page.textContent('#updDlgMsg')), await page.textContent('#updDlgMsg'));
  // an earlier working update exists
  await setInfo({ version: '1.10.59', builtIn: '1.10.1', source: 'update', note: '', previous: { dir: 'v1', version: '1.10.58' }, problem: null });
  await open();
  const label = await page.textContent('#updateRevertPrev');
  check('with an earlier update stored, the button names it and can be clicked', /1\.10\.58/.test(label) && await page.evaluate(() => document.getElementById('updateRevertPrev').disabled === false), label);
  // running the built-in program: nothing to go back to
  await setInfo({ version: '1.10.1', builtIn: '1.10.1', source: 'built-in', note: '', previous: null, problem: null });
  await open();
  check('built-in program: no "go back" buttons are needed', !(await shown('updateRevertPrev')) && !(await shown('updateRevert')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
