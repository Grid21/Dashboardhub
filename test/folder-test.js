'use strict';
//   xvfb-run -a node test/folder-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-ud-'));
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-dl-'));            // pretend Downloads
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-other-'));
  const file = path.join(other, 'x.hubupdate'); fs.writeFileSync(file, '{"not":"a real update"}');
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [path.join(ROOT, 'test/folder-harness.js'), '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  let app = await launch(); let page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await app.evaluate(({ app }, d) => { app.setPath('downloads', d); }, dl);
  const calls = () => app.evaluate(() => global.__dialogCalls.slice());
  const install = () => page.evaluate(() => window.updateApi ? window.updateApi.install() : window.hubUpdate.install());
  const hasApi = await page.evaluate(() => !!(window.updateApi || window.hubUpdate));
  check('update API reachable from the page', hasApi);
  // the harness replaced the dialog BEFORE app-main wrapped it, so the wrapper sits on top of the harness
  await install().catch(() => {}); await sleep(300);
  let c = await calls();
  check('first time: the update box opens in your Downloads folder', c.length === 1 && c[0].defaultPath === dl, JSON.stringify(c));
  await app.evaluate((_, f) => { global.__nextPick = f; }, file);
  await install().catch(() => {}); await sleep(500);
  const saved = fs.existsSync(path.join(ud, 'folders.json')) ? JSON.parse(fs.readFileSync(path.join(ud, 'folders.json'), 'utf8')) : {};
  check('picking a file remembers its folder', saved.update === other, JSON.stringify(saved));
  await app.close();
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await install().catch(() => {}); await sleep(300);
  c = await app.evaluate(() => global.__dialogCalls.slice());
  check('next time (even after restart): it opens in that same folder', c.length === 1 && c[0].defaultPath === other, JSON.stringify(c));
  await app.close();
  fs.rmSync(other, { recursive: true, force: true });
  app = await launch(); page = await app.firstWindow(); await page.waitForSelector('#tabMap');
  await app.evaluate(({ app }, d) => { app.setPath('downloads', d); }, dl);
  await install().catch(() => {}); await sleep(300);
  c = await app.evaluate(() => global.__dialogCalls.slice());
  check('if that folder was deleted, it falls back to Downloads', c.length === 1 && c[0].defaultPath === dl, JSON.stringify(c));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
