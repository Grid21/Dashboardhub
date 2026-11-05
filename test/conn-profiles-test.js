'use strict';
//   xvfb-run -a node test/conn-profiles-test.js      (router & switch links and server logins belong to a network profile)
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
const enc = (obj) => JSON.stringify({ enc: Buffer.from('enc:' + JSON.stringify(obj)).toString('base64') });
const readEnc = (f) => JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(path.join(ud, f), 'utf8')).enc, 'base64').toString().replace(/^enc:/, ''));
const launch = async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => { errors.push(String(e)); console.log('  PAGEERROR ' + String(e).slice(0, 200)); }); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => true; safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'; safeStorage.encryptString = (s) => Buffer.from('enc:' + s); safeStorage.decryptString = (b) => Buffer.from(b).toString().replace(/^enc:/, ''); });
  return { app, page, errors };
};
(async () => {
  // links and a server login saved by an OLDER version: nobody owns them yet
  fs.writeFileSync(path.join(ud, 'connections.dat'), enc([
    { id: 'old1', type: 'snmp', name: 'Old switch', host: '10.7.0.2', port: 161, https: false, username: '', password: 'public', site: '', snmpVersion: 2, authProto: 'sha', privProto: 'aes', secret2: '' },
    { id: 'old2', type: 'asus', name: 'Old router', host: '10.7.0.1', port: 80, https: false, username: 'admin', password: 'pw', site: '', snmpVersion: 2, authProto: 'sha', privProto: 'aes', secret2: '' }]));
  fs.writeFileSync(path.join(ud, 'bmc.dat'), enc([{ id: 'bold1', name: 'Old iLO', host: '10.7.0.50', port: 443, https: true, username: 'u', password: 'p', mac: '' }]));
  let { app, page, errors } = await launch();
  const A = await page.evaluate(() => state.activeProfileId);
  await page.evaluate((id) => window.connApi.setProfile(id), A); await sleep(400);     // (the stub for encryption went in after start-up)
  let l = await page.evaluate(() => window.connApi.list());
  check('older links go to the profile that is showing when the update first runs', l.list.length === 2 && l.list.map((x) => x.name).sort().join() === 'Old router,Old switch', JSON.stringify(l.list.map((x) => x.name)));
  const bl = await page.evaluate(() => window.bmcApi.list());
  check('older server logins go there too', bl.list.length === 1 && bl.list[0].name === 'Old iLO');
  check('saved file now records the owner', readEnc('connections.dat').every((x) => x.profileId === A) && readEnc('bmc.dat')[0].profileId === A);

  // a new profile starts clean
  await page.evaluate(() => window.hubProfilesCreate('Client B')); await sleep(900);
  const B = await page.evaluate(() => state.activeProfileId);
  await page.evaluate((id) => window.connApi.setProfile(id), B);       // (already done by the app; harmless)
  l = await page.evaluate(() => window.connApi.list());
  check('a NEW profile starts with no router & switch links', B !== A && l.list.length === 0, JSON.stringify(l.list));
  check('...and no server logins', (await page.evaluate(() => window.bmcApi.list())).list.length === 0);
  await page.click('#tabMap'); await sleep(300); await page.click('#mapConnBtn'); await sleep(500);
  check('the Router & switch links window shows none', /No connections yet/.test(await page.evaluate(() => document.getElementById('connList').innerText)), await page.evaluate(() => document.getElementById('connList').innerText));
  await page.evaluate(() => document.getElementById('connClose').click()); await sleep(200);
  const bw = await page.evaluate(() => window.netApi.bandwidth());
  check('the Bandwidth Monitor sees no saved routers for it either', bw.ok && bw.saved === 0, JSON.stringify(bw.saved));

  // save one for B
  const sv = await page.evaluate(() => window.connApi.save({ type: 'snmp', name: 'Client switch', host: '10.9.0.2', port: 161, password: 'clientcomm', snmpVersion: 2 }));
  check('a link saved in B belongs to B', sv.ok && sv.list.length === 1 && sv.list[0].name === 'Client switch', JSON.stringify(sv));
  check('saved file keeps both networks\' links separate', (() => { const f = readEnc('connections.dat'); return f.length === 3 && f.filter((x) => x.profileId === A).length === 2 && f.filter((x) => x.profileId === B).length === 1; })());

  // back to A
  await page.evaluate((id) => window.hubProfilesSwitch(id), A); await sleep(900);
  l = await page.evaluate(() => window.connApi.list());
  check('switching back shows only A\'s links', l.list.length === 2 && !l.list.some((x) => x.host === '10.9.0.2'), JSON.stringify(l.list.map((x) => x.name)));
  await page.click('#mapConnBtn'); await sleep(500);
  const txt = await page.evaluate(() => document.getElementById('connList').innerText);
  check('the window lists A\'s links and not B\'s', /Old switch/.test(txt) && /Old router/.test(txt) && !/Client switch/.test(txt), txt);
  await page.evaluate(() => document.getElementById('connClose').click()); await sleep(200);
  // B cannot remove or reach A's links
  await page.evaluate((id) => window.hubProfilesSwitch(id), B); await sleep(800);
  const rm = await page.evaluate(() => window.connApi.remove('old1'));
  check('another profile cannot remove this one\'s link', rm.ok && rm.list.length === 1 && readEnc('connections.dat').some((x) => x.id === 'old1'));
  const bw2 = await page.evaluate(() => window.netApi.bandwidth());
  check('B\'s bandwidth monitor counts only B\'s router (1)', bw2.saved === 1, String(bw2.saved));

  // duplicate A -> the copy gets its own copy of A's links
  await page.evaluate((id) => window.hubProfilesSwitch(id), A); await sleep(800);
  await page.click('#settingsBtn'); await sleep(300);
  await page.click('#profileDuplicate'); await sleep(300);
  await page.fill('#profileNameInput', 'A copy'); await page.click('#profileConfirm'); await sleep(1500);
  const C = await page.evaluate(() => state.activeProfileId);
  l = await page.evaluate(() => window.connApi.list());
  check('a duplicated profile starts with its own copy of the links', C !== A && l.list.length === 2 && l.list.every((x) => x.id !== 'old1' && x.id !== 'old2'), JSON.stringify(l.list.map((x) => x.id)));
  check('the copy keeps the saved password (shown as saved)', l.list.every((x) => x.hasSecret));
  check('the server logins were copied too', (await page.evaluate(() => window.bmcApi.list())).list.length === 1);
  // remove the copy: its links go, A's stay
  await page.click('#settingsBtn'); await sleep(300);
  await page.click('#profileRemove'); await sleep(300); await page.click('#profileConfirm'); await sleep(1500);
  const now = await page.evaluate(() => state.activeProfileId);
  const file = readEnc('connections.dat');
  check('removing the copy removes its links and keeps the others', now !== C && !file.some((x) => x.profileId === C) && file.filter((x) => x.profileId === A).length === 2 && file.filter((x) => x.profileId === B).length === 1, JSON.stringify(file.map((x) => x.profileId === A ? 'A' : x.profileId === B ? 'B' : x.profileId === C ? 'C' : '?')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close(); await sleep(500);

  // after a restart each profile still has its own
  ({ app, page, errors } = await launch());
  await page.evaluate((id) => window.connApi.setProfile(id), B); await sleep(300);
  check('after a restart, B still has only its own link', (await page.evaluate(() => window.connApi.list())).list.map((x) => x.name).join() === 'Client switch');
  await page.evaluate((id) => window.connApi.setProfile(id), A); await sleep(300);
  check('and A its own two', (await page.evaluate(() => window.connApi.list())).list.length === 2);
  check('an unknown profile id has none', (await page.evaluate(() => window.connApi.setProfile('zzz').then(() => window.connApi.list()))).list.length === 0);
  const badId = await page.evaluate(() => window.connApi.setProfile('../x'));
  check('a bad profile id is refused', !badId.ok);
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
