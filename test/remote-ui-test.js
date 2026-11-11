'use strict';
//   xvfb-run -a node test/remote-ui-test.js
// The Remote view window through the real app: a fake PiKVM (self-signed https), a fake JetKVM (http), a fake NoMachine player.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), https = require('https'), cp = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const openRemote = async (app, page) => {
  let rv = null;
  for (let i = 0; i < 6 && !rv; i++) {
    await page.evaluate(() => document.getElementById('remoteBtn').click());
    for (let j = 0; j < 12 && !rv; j++) { rv = app.windows().find((w) => /remote\.html/.test(w.url())); await sleep(250); }
  }
  return rv;
};
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvui-'));
  cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '2', '-subj', '/CN=pikvm.fake'], { stdio: 'ignore' });
  const pik = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html><body>FAKE-PIKVM-PAGE</body></html>'); });
  const jet = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html><body>FAKE-JETKVM-PAGE</body></html>'); });
  await new Promise((r) => pik.listen(0, '127.0.0.1', r)); await new Promise((r) => jet.listen(0, '127.0.0.1', r));
  const pPort = pik.address().port, jPort = jet.address().port;
  const argsFile = path.join(tmp, 'nx-args.txt'), fake = path.join(tmp, 'nxplayer');
  fs.writeFileSync(fake, '#!/bin/sh\necho "$@" > ' + argsFile + '\ncat "$2" >> ' + argsFile + '\n', { mode: 0o755 });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvud-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dataDir], env: Object.assign({}, process.env, { NXPLAYER_PATH: fake }) });
  const main = await app.firstWindow(); await main.waitForSelector('#tabMap');
  await sleep(1500);
  const rv = await openRemote(app, main);
  check('the Remote view opens as its own window from its own button next to Servers', !!rv && rv !== main);
  if (!rv) { console.log('cannot continue'); process.exit(1); }
  check('the button sits right before the Servers button in the top bar', await main.evaluate(() => { const b = document.getElementById('remoteBtn'), s = document.getElementById('serversBtn'); return !!b && b.nextElementSibling === s && b.getBoundingClientRect().top === s.getBoundingClientRect().top; }));
  check('and it is no longer inside the Settings menu', await main.evaluate(() => !document.getElementById('settingsMenu') || !document.getElementById('settingsMenu').contains(document.getElementById('remoteBtn'))));
  const errors = []; rv.on('pageerror', (e) => errors.push(String(e)));
  await rv.waitForSelector('#rvAdd');
  check('it starts with a helpful empty page', /Control a computer remotely/.test(await rv.textContent('#rvEmpty')));
  const add = async (kind, name, host, port, user) => {
    await rv.click('#rvAdd'); await rv.selectOption('#rvType', kind); await rv.fill('#rvName', name); await rv.fill('#rvHost', host); await rv.fill('#rvPort', port || ''); if (user) await rv.fill('#rvUser', user);
    await rv.click('#rvSave'); await sleep(600);
  };
  await rv.click('#rvAdd'); await rv.click('#rvSave'); await sleep(300);
  check('saving an empty form shows a clear message and stays open', /name/i.test(await rv.textContent('#rvDlgMsg')) && await rv.evaluate(() => document.getElementById('rvDialog').open));
  await rv.fill('#rvName', 'x'); await rv.fill('#rvHost', 'bad host!'); await rv.click('#rvSave'); await sleep(300);
  check('a bad address is refused with an example', /address/i.test(await rv.textContent('#rvDlgMsg')), await rv.textContent('#rvDlgMsg'));
  await rv.click('#rvCancel');
  await add('pikvm', 'Fake PiKVM', '127.0.0.1', String(pPort));
  const wvText = async (i) => rv.evaluate(async (idx) => { const w = document.querySelectorAll('webview')[idx]; try { return await w.executeJavaScript('document.body && document.body.textContent'); } catch (e) { return 'ERR ' + e.message; } }, i);
  let t = ''; for (let i = 0; i < 20 && !/FAKE/.test(t); i++) { t = await wvText(0); await sleep(300); }
  check('a PiKVM with a self-signed certificate opens inside the window', /FAKE-PIKVM-PAGE/.test(t), t);
  await add('jetkvm', 'Fake JetKVM', '127.0.0.1', String(jPort));
  t = ''; for (let i = 0; i < 20 && !/FAKE/.test(t); i++) { t = await wvText(1); await sleep(300); }
  check('a JetKVM opens in a second tab', /FAKE-JETKVM-PAGE/.test(t) && (await rv.locator('.rv-tab').count()) === 2, t);
  check('the device list shows both with their kind', (await rv.locator('.rv-dev').count()) === 2 && /PiKVM/.test(await rv.textContent('#rvList')) && /JetKVM/.test(await rv.textContent('#rvList')));
  await rv.locator('.rv-tab').first().click(); await sleep(200);
  check('clicking a tab shows that device', await rv.evaluate(() => !document.querySelectorAll('webview')[0].parentElement.classList.contains('hidden') && document.querySelectorAll('webview')[1].parentElement.classList.contains('hidden')));
  await add('web', 'Dead one', '127.0.0.1', '9');
  await sleep(1500);
  check('an unreachable device says so, with Try again', /Could not reach Dead one/.test(await rv.textContent('#rvStage')), (await rv.textContent('#rvStage')).slice(0, 200));
  await rv.click('#rvAdd'); await rv.selectOption('#rvType', 'nomachine'); await sleep(500);
  check('the NoMachine form explains it is separate software needed on two computers, with a download button', /separate, free software/.test(await rv.textContent('#rvNxNote')) && /two/.test(await rv.textContent('#rvNxNote')) && await rv.isVisible('#rvNxGet'));
  check('...and says whether it was found on this computer', /was found on this computer/.test(await rv.textContent('#rvNxState')), await rv.textContent('#rvNxState'));
  await rv.selectOption('#rvType', 'pikvm'); check('...the note is hidden for other kinds', !(await rv.isVisible('#rvNxNote'))); await rv.click('#rvCancel');
  await add('nomachine', 'Desk NX', 'desk.lan', '', 'me');
  for (let i = 0; i < 20 && !fs.existsSync(argsFile); i++) await sleep(250);
  const args = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8') : '';
  check('NoMachine is started with --session and a connection file', /^--session .*\.nxs/.test(args) && /Server host" value="desk\.lan"/.test(args) && /Server port" value="4000"/.test(args) && /User" value="me"/.test(args), args);
  check('the tab says NoMachine is opening', /NoMachine is opening/.test(await rv.textContent('#rvStage')));
  // security: a page in the window cannot attach a web view to an address that is not in the list
  const sneaky = await rv.evaluate(async () => {
    const w = document.createElement('webview'); w.setAttribute('partition', 'persist:remote'); w.setAttribute('src', 'http://localhost:1/'); document.body.appendChild(w);
    await new Promise((r) => setTimeout(r, 1500)); let id = 'none'; try { id = String(w.getWebContentsId()); } catch (e) { id = 'blocked'; } w.remove(); return id;
  });
  check('a web view for an address that is not in the list is refused', sneaky === 'blocked' || sneaky === 'none', sneaky);
  // editing and removing
  await rv.locator('.rv-dev').nth(1).click({ button: 'right' }); await sleep(300);
  check('right-click opens the edit form with the saved values', (await rv.inputValue('#rvName')) === 'Fake JetKVM' && (await rv.inputValue('#rvPort')) === String(jPort));
  await rv.click('#rvDelete'); await sleep(500);
  check('removing a device takes it out of the list and closes its tab', (await rv.locator('.rv-dev').count()) === 3 && !/Fake JetKVM/.test(await rv.textContent('#rvList')) && !/Fake JetKVM/.test(await rv.textContent('#rvTabs')));
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'remote-devices.json'), 'utf8'));
  check('the list is saved on disk (no passwords anywhere)', saved.devices.length === 3 && !/pass/i.test(JSON.stringify(saved)), JSON.stringify(saved).slice(0, 200));
  await rv.locator('.rv-tab').first().click(); await sleep(200); await rv.click('#rvFull'); await sleep(300);
  check('full screen hides the side bar and offers an Exit button', await rv.evaluate(() => document.body.classList.contains('rv-full') && getComputedStyle(document.getElementById('rvFullExit')).display !== 'none'));
  await rv.click('#rvFullExit'); await sleep(300);
  check('Exit full screen brings it back', await rv.evaluate(() => !document.body.classList.contains('rv-full')));
  check('opening it again just brings the same window forward', await (async () => { await main.evaluate(() => document.getElementById('remoteBtn').click()); await sleep(500); return app.windows().filter((w) => /remote\.html/.test(w.url())).length === 1; })());
  check('no page errors in the window', errors.length === 0, errors.join(' | '));
  await app.close(); pik.close(); jet.close();
  // second start, with no NoMachine anywhere: the tab and the form must explain it
  const dd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rvud2-'));
  fs.writeFileSync(path.join(dd2, 'remote-devices.json'), JSON.stringify({ devices: [{ id: 'nx1', name: 'Desk NX', type: 'nomachine', host: 'desk.lan', port: 0, user: '' }] }));
  const env2 = Object.assign({}, process.env); delete env2.NXPLAYER_PATH;
  const app2 = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dd2], env: env2 });
  const m2 = await app2.firstWindow(); await m2.waitForSelector('#tabMap'); await sleep(1500);
  const rv2 = await openRemote(app2, m2);
  await rv2.waitForSelector('.rv-dev'); await rv2.click('.rv-dev'); await sleep(900);
  const card = await rv2.textContent('#rvStage');
  check('without NoMachine, the tab says it is separate software, to install first, with download and Check again', /not installed here/.test(card) && /separate, free software/.test(card) && /Check again/.test(card) && /Open the NoMachine download page/.test(card), card.slice(0, 300));
  await rv2.click('#rvEdit'); await sleep(500);
  check('the form says it was not found on this computer', /was not found on this computer/.test(await rv2.textContent('#rvNxState')), await rv2.textContent('#rvNxState'));
  await app2.close();
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})();
