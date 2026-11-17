'use strict';
//   xvfb-run -a node test/pxe-dhcp-ui-test.js
// The "Secure Boot computers" part of the Network boot window: before the download the box cannot be ticked, after it can, and the
// choice is remembered after a restart. (The signed files are put in place by the test; the real download and the real boot with
// Secure Boot ON are in test/secureboot-vm-test.js.)
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'dhu-'));
async function launch() {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1300, height: 1000 }); await page.waitForSelector('#tabMap');
  for (let i = 0; i < 20; i++) {   // the button only works once the window has finished loading its scripts
    await page.evaluate(() => { const d = document.getElementById('pxeDialog'); if (!d.open) document.getElementById('pxeMenuBtn').click(); });
    if (await page.evaluate(() => document.getElementById('pxeDialog').open)) break; await sleep(500);
  }
  await sleep(1200);
  await page.evaluate(() => { document.getElementById('pxeDhcp').open = true; });
  return { app, page };
}
(async () => {
  let { app, page } = await launch();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
  check('the DHCP server box is there and switched off by default', await page.evaluate(() => document.getElementById('pxeDhcpOn').checked === false));
  check('the box warns that the router DHCP must be off', /router/i.test(await page.textContent('#pxeDhcp')));
  const bad = await page.evaluate(() => window.pxeApi.dhcpSet({ on: true, from: 'abc', to: '', router: '' }));
  check('a wrong address is refused', bad.ok === false, JSON.stringify(bad));
  await page.fill('#pxeDhcpFrom', '192.168.0.200'); await page.fill('#pxeDhcpTo', '192.168.0.230'); await page.fill('#pxeDhcpRouter', '192.168.0.1'); await page.check('#pxeDhcpOn');
  await page.click('#pxeDhcpSave'); await sleep(600);
  const st = await page.evaluate(() => window.pxeApi.status());
  check('saving keeps the settings', st.dhcpServer && st.dhcpServer.on === true && st.dhcpServer.from === '192.168.0.200' && st.dhcpServer.to === '192.168.0.230' && st.dhcpServer.router === '192.168.0.1', JSON.stringify(st.dhcpServer));
  await app.close(); await sleep(800);
  ({ app, page } = await launch());
  await page.waitForFunction(() => document.getElementById('pxeDhcpFrom').value !== '', null, { timeout: 15000 }).catch(() => {});
  check('after a restart the settings are still there', await page.evaluate(() => document.getElementById('pxeDhcpOn').checked && document.getElementById('pxeDhcpFrom').value === '192.168.0.200' && document.getElementById('pxeDhcpRouter').value === '192.168.0.1'));
  check('no script errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log(failed ? 'FAILED ' + failed : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})();
