'use strict';
//   xvfb-run -a node test/corrupt-data-test.js
// Every saved data file is replaced by damaged content (cut off, garbage, empty, wrong shape, huge). The app must still start,
// open its tabs, and not log an unexpected error.
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const files = ['bmc.dat', 'connections.dat', 'folders.json', 'notes.dat', 'notifications.json', 'remote-devices.json', 'settings.json', 'update-prefs.json', 'window-state.json', 'security.json', 'pxe.json'];
const damage = {
  'cut off': (f) => f.endsWith('.json') ? '{"profiles":{"a":{"name":"x","sessions":[{"id":' : 'AAAA',
  'garbage': () => Buffer.from([0, 255, 254, 1, 2, 3, 200, 100, 0, 0, 17]).toString('latin1') + 'zzzz',
  'empty': () => '',
  'wrong shape': () => '[1,2,3,null,"x"]',
  'wrong types': () => '{"profiles":5,"devices":"no","closeToTray":"yes","width":"wide","list":{"a":1},"sessions":7}',
  'huge numbers': () => '{"x":1e999,"width":-99999999,"height":99999999,"x2":null}'
};
async function once(label, make) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-'));
  for (const f of files) fs.writeFileSync(path.join(ud, f), make(f), 'latin1');
  let app;
  try {
    app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
    const page = await app.firstWindow(); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    await page.waitForSelector('#tabMap', { timeout: 30000 });
    await page.click('#tabMap'); await new Promise((r) => setTimeout(r, 600));
    const ok = await page.locator('#mapScan').count() === 1;
    await page.evaluate(() => document.querySelector('#mapAlertTypes') && document.querySelector('#mapAlertTypes').click()); await new Promise((r) => setTimeout(r, 300));
    const log = (() => { try { return fs.readFileSync(path.join(ud, 'error-log.txt'), 'utf8'); } catch (e) { return ''; } })();
    check(label + ': starts, map opens, no page errors, nothing in the error log', ok && errs.length === 0 && log === '', JSON.stringify({ ok, errs: errs.slice(0, 2), log: log.slice(0, 200) }));
  } catch (e) { check(label + ': starts', false, String(e.message).slice(0, 200)); }
  finally { try { await app.close(); } catch (e) { /* closed */ } try { require('child_process').execSync('pkill -f "user-data-dir=' + ud + '"'); } catch (e) { /* none */ } }
}
(async () => {
  for (const k of Object.keys(damage)) await once(k, damage[k]);
  console.log(failed ? failed + ' failed' : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})();
