'use strict';
//   xvfb-run -a node test/pxe-ui-test.js
// The Network boot window, end to end through the real app (real UDP ports, no other computer needed).
const path = require('path'), fs = require('fs'), os = require('os'), dgram = require('dgram'), http = require('http'), cp = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxeui-'));
  fs.writeFileSync(path.join(tmp, 'k'), Buffer.alloc(2000, 1)); fs.writeFileSync(path.join(tmp, 'i'), Buffer.alloc(3000, 2));
  cp.execFileSync('python3', ['-I', '-c', `
import pycdlib, sys
t = sys.argv[1]
iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, rock_ridge='1.09', vol_ident='LIVEDISC')
iso.add_directory('/CASPER', rr_name='casper')
iso.add_file(t + '/k', '/CASPER/VMLINUZ;1', rr_name='vmlinuz'); iso.add_file(t + '/i', '/CASPER/INITRD;1', rr_name='initrd')
iso.write(t + '/live.iso'); iso.close()`, tmp]);
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'pxeud-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1300, height: 950 }); await page.waitForSelector('#tabMap');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, path.join(tmp, 'live.iso'));
  const dlgOpen = () => page.evaluate(() => document.getElementById('pxeDialog').open);
  await page.click('#settingsBtn, #settingsMenuBtn, button:has-text("Settings")').catch(() => {}); await sleep(200);
  await page.evaluate(() => document.getElementById('pxeMenuBtn').click()); await sleep(500);
  check('the Network boot window opens from the Settings menu', await dlgOpen());
  check('it says it is off until Start', /Not running/.test(await page.textContent('#pxeState')));
  const vis = (id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
  await page.click('#pxeStart'); await sleep(600);
  check('Start is refused until a computer is listed, with a clear message', /MAC address/.test(await page.textContent('#pxeMsg')) && !(await page.evaluate(() => /Running/.test(document.getElementById('pxeState').textContent))), await page.textContent('#pxeMsg'));
  await page.fill('#pxeMacInput', 'not a mac'); await page.click('#pxeMacAdd'); await sleep(400);
  check('a wrong MAC is refused with an example', /not a MAC/i.test(await page.textContent('#pxeMsg')) && (await page.locator('#pxeMacList .pxe-item').count()) === 0, await page.textContent('#pxeMsg'));
  await page.fill('#pxeMacInput', 'AA-BB-CC-11-22-33'); await page.click('#pxeMacAdd'); await sleep(400);
  check('a good MAC is added, tidied up', (await page.locator('#pxeMacList .pxe-item .pxe-name').allTextContents()).join() === 'aa:bb:cc:11:22:33', (await page.locator('#pxeMacList .pxe-item .pxe-name').allTextContents()).join());
  await page.click('#pxeIsoAdd'); await sleep(700);
  check('an ISO is added through the file box', (await page.locator('#pxeIsoList .pxe-item .pxe-name').allTextContents()).join().includes('LIVEDISC'), (await page.locator('#pxeIsoList').textContent()));
  check('  and shown as an Ubuntu-style live disc', /Ubuntu-style live disc/.test(await page.textContent('#pxeIsoList')));
  const ips = await page.evaluate(() => [...document.querySelectorAll('#pxeIp option')].map((o) => o.value));
  check('network connections are listed to choose from', ips.length >= 1 && /^\d+\.\d+\.\d+\.\d+$/.test(ips[0]), JSON.stringify(ips));
  await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'pxe1.png') });
  // per-computer choice and self-check
  const opts = await page.evaluate(() => [...document.querySelectorAll('#pxeMacList select option')].map((o) => o.textContent));
  check('each listed computer has a "what to start by itself" choice, with the ISO in it', opts.length === 4 && /LIVEDISC/.test(opts.join()) && /netboot\.xyz/.test(opts.join()), JSON.stringify(opts));
  await page.selectOption('#pxeMacList select', 'netbootxyz'); await sleep(400);
  check('the choice is saved', (await page.evaluate(() => window.pxeApi.status())).allow.choice['aa:bb:cc:11:22:33'] === 'netbootxyz');
  await page.click('#pxeCheck'); await sleep(1500);
  const chk = await page.locator('#pxeChecks .pxe-item').allTextContents();
  check('"Check my setup" lists plain-language results with a verdict', chk.length >= 5 && /Everything looks ready|Fix the red items/.test(chk[chk.length - 1]), JSON.stringify(chk).slice(0, 300));
  await page.evaluate(() => { document.querySelector('.pxe-tips').open = true; document.getElementById('pxeChecks').scrollIntoView(); }); await page.screenshot({ path: process.env.SHOT2 || path.join(os.tmpdir(), 'pxe2.png') });
  check('the VirtualBox tips are in the window', /Bridged Adapter/.test(await page.textContent('.pxe-tips')));
  await page.click('#pxeStart'); await sleep(1200);
  const running = await page.evaluate(() => /Running on/.test(document.getElementById('pxeState').textContent));
  check('Start works and says it is running', running, await page.textContent('#pxeMsg'));
  check('Stop button replaces Start', (await vis('pxeStop')) && !(await vis('pxeStart')));
  check('the settings are locked while running', await page.evaluate(() => document.getElementById('pxeMacInput').disabled && document.getElementById('pxeIp').disabled));
  // a real ISO menu over the real web port
  const get = (u) => new Promise((resolve) => { http.get({ host: '127.0.0.1', port: 8088, path: u }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ s: res.statusCode, b: Buffer.concat(c) })); }).on('error', () => resolve({ s: 0, b: Buffer.alloc(0) })); });
  const menu = await get('/boot.ipxe');
  check('the menu is being served on port 8088', menu.s === 200 && /LIVEDISC/.test(menu.b.toString()) && /netboot\.xyz/.test(menu.b.toString()));
  // a computer that asks to boot (listed) and one that is not
  function disc(mac) { const b = Buffer.alloc(240); b[0] = 1; b[1] = 1; b[2] = 6; b[4] = 7; Buffer.from(mac.split(':').map((x) => parseInt(x, 16))).copy(b, 28); Buffer.from([0x63, 0x82, 0x53, 0x63]).copy(b, 236); return Buffer.concat([b, Buffer.from([53, 1, 1, 60, 9]), Buffer.from('PXEClient'), Buffer.from([93, 2, 0, 0, 255])]); }
  const s = dgram.createSocket('udp4'); await new Promise((r) => s.bind(0, r));
  s.send(disc('aa:bb:cc:11:22:33'), 67, '127.0.0.1'); s.send(disc('de:ad:be:ef:00:01'), 67, '127.0.0.1'); await sleep(2500);
  const logTxt = await page.textContent('#pxeLog');
  check('a listed computer that asks to boot shows up in the log', /aa:bb:cc:11:22:33 asked how to network boot/.test(logTxt), logTxt.slice(0, 300));
  check('an unlisted computer is ignored and the log says so', /de:ad:be:ef:00:01 asked to network boot, but it is not on your list/.test(logTxt));
  s.close();
  await page.evaluate(() => document.getElementById('pxeClose').click()); await sleep(300);
  check('closing the window leaves it running (and the menu says so)', (await get('/boot.ipxe')).s === 200);
  await page.evaluate(() => document.getElementById('pxeMenuBtn').click()); await sleep(600);
  await page.click('#pxeStop'); await sleep(900);
  check('Stop turns it off and frees the web port', /Not running/.test(await page.textContent('#pxeState')) && (await get('/boot.ipxe')).s === 0);
  check('the list of computers and ISOs is kept', (await page.locator('#pxeMacList .pxe-item').count()) === 1 && (await page.locator('#pxeIsoList .pxe-item').count()) === 1);
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); await app.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
