'use strict';
//   xvfb-run -a node test/window-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { pickBounds } = require('../window-state');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = { width: 1400, height: 900 };
const main = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const ext = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
const left = { bounds: { x: -1280, y: 100, width: 1280, height: 1024 }, workArea: { x: -1280, y: 100, width: 1280, height: 984 } };
// --- the decision logic, with pretend screens ---
let r = pickBounds({ x: 2200, y: 200, width: 1500, height: 950, maximized: false }, [main, ext], D);
check('window last on the external screen goes back to the external screen', r.bounds && r.bounds.x === 2200 && r.bounds.y === 200, JSON.stringify(r));
r = pickBounds({ x: 2200, y: 200, width: 1500, height: 950, maximized: false }, [main], D);
check('external screen unplugged: no position (opens on the main screen)', !r.bounds && r.width === 1500, JSON.stringify(r));
r = pickBounds({ x: -1100, y: 150, width: 1000, height: 700, maximized: true }, [main, left], D);
check('a screen to the LEFT (negative position) and maximized is remembered', r.bounds && r.bounds.x === -1100 && r.maximized === true, JSON.stringify(r));
r = pickBounds({ x: 2200, y: 200, width: 1500, height: 950, maximized: false }, [main, { bounds: { x: 1920, y: 0, width: 1280, height: 720 }, workArea: { x: 1920, y: 0, width: 1280, height: 700 } }], D);
check('that screen is now smaller: the window is shrunk to fit', r.bounds && r.bounds.width <= 1280 && r.bounds.height <= 700 && r.bounds.x >= 1920 && r.bounds.x + r.bounds.width <= 3200, JSON.stringify(r));
r = pickBounds(null, [main], D); check('nothing saved: normal default size', !r.bounds && r.width === 1400 && r.height === 900 && !r.maximized);
r = pickBounds({ x: 'a', y: null, width: 5, height: 5 }, [main], D); check('damaged saved data is ignored safely', !r.bounds && r.width === 1400);
// --- the real window ---
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const bounds = (app) => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { b: w.getBounds(), max: w.isMaximized() }; });
  let app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 80, width: 1000, height: 700 })); await sleep(900);
  await app.close();
  check('a window-state file is written', fs.existsSync(path.join(ud, 'window-state.json')));
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(500);
  let s = await bounds(app);
  check('restart: same size and place', s.b.width === 1000 && s.b.height === 700 && Math.abs(s.b.x - 120) < 30 && Math.abs(s.b.y - 80) < 60, JSON.stringify(s));
  // maximize (pretended: this test machine has no window manager)
  const launchH = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [path.join(ROOT, 'test/win-harness.js'), '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  app = await launchH(); page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize()); await sleep(300);
  await app.close();
  const saved = JSON.parse(fs.readFileSync(path.join(ud, 'window-state.json'), 'utf8'));
  check('maximized is saved, with the normal size kept', saved.maximized === true && saved.width >= 200, JSON.stringify(saved));
  app = await launchH(); page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(500);
  check('restart: it comes back maximized', await app.evaluate(() => global.__maxCalled === true));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
