'use strict';
//   xvfb-run -a node test/remote-servers-ui-test.js
// Dashboard Hub Desktop managing a Dashboard Hub Docker server: add, check, scan now, open, edit, remove.
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), net = require('net');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
(async () => {
  const dkPort = await freePort(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'rsdk-')), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsui-'));
  const dk = spawn(process.execPath, [path.join(ROOT, 'docker', 'server.js')], { env: Object.assign({}, process.env, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_PORT: String(dkPort), DASHBOARD_HUB_CODE: 'server code 1', DASHBOARD_HUB_NAME: 'Docker box', DASHBOARD_HUB_PANELS: 'Alpha=http://10.0.0.5:9000' }), stdio: 'ignore' });
  await sleep(9000);
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + dir] });
  const page = await app.firstWindow(); await page.waitForSelector('#tabMap'); await sleep(1200);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.click('#settingsBtn'); await page.click('#hubsMenuBtn'); await sleep(500);
  check('the Remote servers window opens, empty', await page.isVisible('#hubsDialog') && /No servers yet/.test(await page.textContent('#hubsList')));
  await page.fill('#hubName', 'Home server'); await page.fill('#hubUrl', 'ftp://nope'); await page.fill('#hubCode', 'server code 1'); await page.click('#hubSave'); await sleep(300);
  check('a wrong kind of address gets a plain message', /http/.test(await page.textContent('#hubsMsg')));
  await page.fill('#hubUrl', 'http://127.0.0.1:' + dkPort); await page.fill('#hubCode', 'abc'); await page.click('#hubSave'); await sleep(300);
  check('an empty or short code is asked for', /access code/i.test(await page.textContent('#hubsMsg')));
  await page.fill('#hubCode', 'wrong code!'); await page.click('#hubSave'); await sleep(1500);
  check('a server can be saved, and a wrong code is explained when checked', /not right/.test(await page.textContent('#hubsList')), await page.textContent('#hubsList'));
  const id = await page.evaluate(async () => (await window.hubsApi.list()).list[0].id);
  await page.evaluate((id) => document.querySelector('.hub-row button:nth-child(6)').click(), id); await sleep(200);
  await page.fill('#hubCode', 'server code 1'); await page.click('#hubSave'); await sleep(300);
  await page.click('.hub-row button:nth-child(1)'); await sleep(2500);
  const txt = await page.textContent('#hubsList');
  check('after fixing the code Check shows it is online with the counts', /Online/.test(txt) && /devices: \d+ online, \d+ offline/.test(txt) && /network 127\.0\.0\.0\/24/.test(txt) && /last scan/.test(txt), txt);
  check('the address and the name are shown', /Home server/.test(txt) && txt.indexOf('127.0.0.1:' + dkPort) > 0);
  check('the code is never given back to the window', await page.evaluate(async () => JSON.stringify(await window.hubsApi.list()).indexOf('server code 1') < 0));
  await page.click('.hub-row button:nth-child(2)'); await sleep(1200);
  check('Scan now starts a scan on the server', /Scan started|already running/.test(await page.textContent('#hubsList')), await page.textContent('#hubsList'));
  await sleep(500);
  await page.click('.hub-row button:nth-child(1)'); await sleep(2000);
  check('Check afterwards shows it scanning or finished', /scanning now|last scan/.test(await page.textContent('#hubsList')));
  await page.click('.hub-row button:nth-child(3)'); await sleep(2500);
  const win = app.windows().find((w) => w.url().indexOf(':' + dkPort) > 0);
  check('Open shows the server\'s own page, already signed in', !!win && await win.evaluate(() => !document.getElementById('app').hidden), win ? win.url() : 'no window');
  if (win) { await sleep(800); check('and it shows the Docker server\'s panels', /Alpha/.test(await win.textContent('#t-panels'))); await win.close().catch(() => {}); }
  // ----- the server's settings window -----
  await page.click('.hub-row button:nth-child(4)');
  await sleep(1200);
  const cfgOpen = await page.isVisible('#hubCfgDialog');
  check('Settings opens the server\'s settings window with its current values', cfgOpen && await page.inputValue('#hcName') === 'Docker box' && await page.evaluate(() => document.querySelectorAll('#hcPanels .hc-panel').length) === 1 && await page.inputValue('#hcScan') === '300');
  if (cfgOpen && process.env.RS_SHOT) await page.screenshot({ path: process.env.RS_SHOT });
  if (cfgOpen) {
    check('the network list offers Automatic and typing it yourself', await page.evaluate(() => Array.from(document.getElementById('hcNet').options).map((o) => o.value).join(',').includes('auto') && Array.from(document.getElementById('hcNet').options).some((o) => o.value === 'custom')));
    check('the router hint says what the server found', /Found by the server/.test(await page.textContent('#hcRouterHint')));
    await page.fill('#hcName', 'Renamed from Desktop');
    await page.selectOption('#hcScan', '600');
    const rxGot = [], rxs = require('http').createServer((q, s) => { rxGot.push(q.url); q.resume(); s.writeHead(200); s.end('ok'); });
    await new Promise((r) => rxs.listen(0, '127.0.0.1', r)); const rxUrl = 'http://127.0.0.1:' + rxs.address().port + '/desktop';
    await page.fill('#hcAlUrl', rxUrl); await page.check('#hcAlBack');
    await page.click('#hcAlTest'); await sleep(1500);
    check('the test message button sends a message and says so', rxGot.length === 1 && rxGot[0] === '/desktop' && /sent/i.test(await page.textContent('#hcAlMsg')), JSON.stringify([rxGot, await page.textContent('#hcAlMsg')]));
    await page.fill('#hcAlUrl', 'ftp://bad'); await page.click('#hcAlTest'); await sleep(1000);
    check('a wrong alert address is explained', /http/i.test(await page.textContent('#hcAlMsg')) || /address/i.test(await page.textContent('#hcAlMsg')), await page.textContent('#hcAlMsg'));
    await page.fill('#hcAlUrl', rxUrl);
    await page.click('#hcAddPanel'); await sleep(200);
    const rows = await page.$$('#hcPanels .hc-panel');
    await rows[1].$eval('.hc-pn', (e) => { e.value = 'Pi-hole'; });
    await rows[1].$eval('.hc-pu', (e) => { e.value = 'http://192.168.0.2/admin'; });
    await page.click('#hcSave'); await sleep(1200);
    check('Save says it is saved', /Saved/.test(await page.textContent('#hcMsg')), await page.textContent('#hcMsg'));
    await rows[1].$eval('.hc-pu', (e) => { e.value = 'ftp://bad'; });
    await page.click('#hcSave'); await sleep(900);
    check('a bad panel address is explained', /http/.test(await page.textContent('#hcMsg')) && !/Saved/.test(await page.textContent('#hcMsg')), await page.textContent('#hcMsg'));
    await rows[1].$eval('.hc-pu', (e) => { e.value = 'http://192.168.0.2/admin'; });
    await page.click('#hcSave'); await sleep(900);
    await page.click('#hcClose'); await sleep(200);
    const cfg = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; return window.hubsApi.getConfig(l[0].id); });
    check('the server really has the new name, scan time and panels', cfg.ok && cfg.config.config.name === 'Renamed from Desktop' && cfg.config.config.scanSeconds === 600 && cfg.config.config.panels.length === 2 && cfg.config.config.panels[1].name === 'Pi-hole', JSON.stringify(cfg).slice(0, 300));
    const st2 = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; return window.hubsApi.setConfig(l[0].id, { router: '192.168.0.1', network: 'auto' }); });
    check('the alert address and choices were saved with the settings', cfg.config.config.alerts.url === rxUrl && cfg.config.config.alerts.onBack === true && cfg.config.config.alerts.onNew === true, JSON.stringify(cfg.config.config.alerts));
    rxs.close();
    check('the router can be set from Desktop', st2.ok === true && st2.config.router === '192.168.0.1', JSON.stringify(st2));
    const st3 = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; return window.hubsApi.setConfig(l[0].id, { scanSeconds: 3 }); });
    check('and a bad value comes back as a plain message', st3.ok === false && /Scan every/.test(st3.error), JSON.stringify(st3));
  }
  // ----- the devices window -----
  await page.click('.hub-row button:nth-child(5)'); await sleep(1500);
  const devOpen = await page.isVisible('#hubDevDialog');
  check('Devices opens a window with every device of the server', devOpen && await page.evaluate(() => document.querySelectorAll('#hdList .hd-row').length >= 2));
  if (devOpen) {
    if (process.env.RS_SHOT2) await page.screenshot({ path: process.env.RS_SHOT2 });
    check('the router has no Ignore box to tick', await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#hdList .hd-row')).find((x) => x.dataset.key === 'router'); return !!r && r.querySelector('.hd-i').disabled; }));
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#hdList .hd-row')).find((x) => x.dataset.key !== 'router'); r.querySelector('.hd-n').value = 'Desk PC'; r.querySelector('.hd-g').value = 'Office'; r.querySelector('.hd-i').checked = false; });
    await page.click('#hdSave'); await sleep(1200);
    check('Save says how many changes were kept', /Saved 1 change/.test(await page.textContent('#hdMsg')), await page.textContent('#hdMsg'));
    check('and the name and group are really on the server', await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; const r = await window.hubsApi.devices(l[0].id, { op: 'list' }); return r.devices.some((d) => d.name === 'Desk PC' && d.group === 'Office'); }));
    await page.fill('#hdAddIp', 'hello'); await page.click('#hdAdd'); await sleep(900);
    check('a bad address is explained', /home network address/.test(await page.textContent('#hdMsg')), await page.textContent('#hdMsg'));
    await page.fill('#hdAddIp', '10.88.0.9'); await page.fill('#hdAddName', 'Garage Pi'); await page.click('#hdAdd'); await sleep(2500);
    check('adding a machine by hand puts it in the list', /Added/.test(await page.textContent('#hdMsg')) && await page.evaluate(() => Array.from(document.querySelectorAll('#hdList .hd-row')).some((x) => x.dataset.key === 'ip:10.88.0.9')), await page.textContent('#hdMsg'));
    // ----- copy this computer's map to the server -----
    const srvDev = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; const r = await window.hubsApi.devices(l[0].id, { op: 'list' }); const d = r.devices.find((x) => !x.isRouter && !x.self && x.ip) || r.devices.find((x) => !x.isRouter && x.ip); return { ip: d.ip, mac: d.mac }; });
    await page.evaluate((sd) => window.webApi.push({ profile: { id: 'p1', name: 'Test' }, panels: [{ name: 'Grafana', url: 'http://192.168.0.5:3000' }], links: [], devices: [{ key: 'x1', name: 'host', label: 'Copied from Desktop', ip: sd.ip, mac: '', vendor: '', os: '', group: 'Desk group', online: true, isRouter: false, self: false, x: 7, z: 9 }] }), srvDev);
    await sleep(300);
    await page.evaluate(() => { document.getElementById('hdSyncBox').open = true; });
    await page.click('#hsSend'); await sleep(1500);
    check('"Send to the server" says what was copied', /Done: 1 machine matched, 1 name set, 1 group set, 1 moved/.test(await page.textContent('#hsMsg')), await page.textContent('#hsMsg'));
    check('and the server really has the name, group and place from this computer', await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; const r = await window.hubsApi.devices(l[0].id, { op: 'list' }); return r.devices.some((d) => d.name === 'Copied from Desktop' && d.group === 'Desk group'); }));
    await page.uncheck('#hsNames'); await page.uncheck('#hsGroups'); await page.uncheck('#hsPos'); await page.uncheck('#hsInfo'); await page.uncheck('#hsLinks'); await page.uncheck('#hsIgnored');
    await page.click('#hsSend'); await sleep(500);
    check('with nothing ticked it asks you to tick something', /at least one/i.test(await page.textContent('#hsMsg')));
    // the whole saved map: details, cables, ignored machines
    const net = require(path.join(ROOT, 'validate.js')).cleanNetwork({ router: '192.168.0.1', removedReturn: true, groupCircles: false, devices: {
      router: { key: 'router', ip: '192.168.0.1' },
      ['ip:' + srvDev.ip]: { key: 'ip:' + srvDev.ip, ip: srvDev.ip, label: 'Full map name', group: 'Full group', pos: { x: 4, y: 0, z: 5 }, info: { brand: 'Netgear', model: 'GS308', notes: 'rack 1', webUrl: 'http://192.168.0.2/' }, vlan: '9' },
      },
      links: [{ a: 'router', b: 'ip:' + srvDev.ip, cable: true }], ignored: ['ip:10.88.0.9'] });
    await page.evaluate((n) => window.hubNetmap.importData(n, true), net); await sleep(500);
    await page.check('#hsNames'); await page.check('#hsGroups'); await page.check('#hsPos'); await page.check('#hsInfo'); await page.check('#hsLinks'); await page.check('#hsIgnored');
    await page.click('#hsSend'); await sleep(1800);
    check('the message mentions details, links and hidden machines', /1 with details/.test(await page.textContent('#hsMsg')) && /1 link/.test(await page.textContent('#hsMsg')) && /1 hidden/.test(await page.textContent('#hsMsg')), await page.textContent('#hsMsg'));
    { const lg = await fetch('http://127.0.0.1:' + dkPort + '/api/login', { method: 'POST', body: JSON.stringify({ code: 'server code 1' }) }); const ck = (lg.headers.get('set-cookie') || '').split(';')[0];
      const st = (await (await fetch('http://127.0.0.1:' + dkPort + '/api/state', { headers: { Cookie: ck } })).json()).snapshot, dv = st.devices.find((d) => d.ip === srvDev.ip);
      check('the server has the whole saved map: name, group, place, details, cable', dv && dv.name === 'Full map name' && dv.group === 'Full group' && dv.x === 4 && dv.z === 5 && dv.info && dv.info.model === 'GS308' && dv.vlan === '9' && st.links.some((l) => l.cable && l.b === dv.key), JSON.stringify(dv));
      check('the machine Desktop ignores is hidden on the server', !st.devices.some((d) => d.ip === '10.88.0.9')); }
    // ----- automatic sending -----
    const srvName = async () => { const lg = await fetch('http://127.0.0.1:' + dkPort + '/api/login', { method: 'POST', body: JSON.stringify({ code: 'server code 1' }) }); const ck = (lg.headers.get('set-cookie') || '').split(';')[0]; const st = (await (await fetch('http://127.0.0.1:' + dkPort + '/api/state', { headers: { Cookie: ck } })).json()).snapshot; const dv = st.devices.find((d) => d.ip === srvDev.ip); return dv && dv.name; };
    const rename = (nm) => page.evaluate(([ip, n]) => { const e = window.hubNetmap.exportData(); e.devices['ip:' + ip].label = n; window.hubNetmap.importData(e, true); }, [srvDev.ip, nm]);
    check('automatic sending starts switched off', !(await page.isChecked('#hsAuto')));
    await rename('Auto name one');
    await page.check('#hsAuto'); await sleep(3500);
    check('switching it on sends the map right away and says so', /Sent automatically/.test(await page.textContent('#hsAutoMsg')), await page.textContent('#hsAutoMsg'));
    check('the server has the new name', (await srvName()) === 'Auto name one', await srvName());
    check('the choice is remembered in the server list', await page.evaluate(async () => (await window.hubsApi.list()).list.some((h) => h.auto === true)));
    await rename('Auto name two'); await page.evaluate(() => window.__hubAutoRun(false)); await sleep(2500);
    check('a later change is sent too', (await srvName()) === 'Auto name two', await srvName());
    await rename('Not sent');
    await page.uncheck('#hsAuto'); await sleep(500); await page.evaluate(() => window.__hubAutoRun(false)); await sleep(1500);
    check('when switched off nothing more is sent', (await srvName()) === 'Auto name two');
    check('a map of a different network is not sent', await (async () => {
      await rename('Auto name two');
      await page.evaluate(() => { const e = window.hubNetmap.exportData(); Object.keys(e.devices).forEach((k) => { if (k !== 'router') { const d = e.devices[k]; d.ip = '10.200.0.' + (1 + Object.keys(e.devices).indexOf(k)); d.label = 'Elsewhere'; } }); window.hubNetmap.importData(e, true); });
      await page.check('#hsAuto'); await sleep(3000);
      return (await srvName()) === 'Auto name two' && /different network/.test(await page.textContent('#hsAutoMsg'));
    })(), await page.textContent('#hsAutoMsg'));
    await page.uncheck('#hsAuto'); await sleep(300);
    await page.click('#hdClose'); await sleep(200);
  }
  // page not reachable
  await page.evaluate(() => window.hubsApi.save({ name: 'Gone', url: 'http://127.0.0.1:1', code: 'whatever1' }));
  await page.evaluate(() => document.getElementById('hubsMenuBtn').click()).catch(() => {}); await sleep(300);
  const gone = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; const h = l.find((x) => x.name === 'Gone'); return window.hubsApi.status(h.id); });
  check('a server that is not there gets a plain explanation', gone.ok === false && /Nothing is listening|did not answer|reached/.test(gone.error), gone.error);
  const sc = await page.evaluate(async () => { const l = (await window.hubsApi.list()).list; return window.hubsApi.scan(l.find((x) => x.name === 'Gone').id); });
  check('and so does asking it to scan', sc.ok === false && !!sc.error);
  // the desktop's own phone page cannot be told to scan
  const wcfg = await page.evaluate(async () => { await window.webApi.setCode('desktop phone code'); return (await window.webApi.setOn(true)).port; });
  const r = await page.evaluate(async (p) => { const l = await fetch('http://127.0.0.1:' + p + '/api/login', { method: 'POST', body: JSON.stringify({ code: 'desktop phone code' }) }); return l.status; }, wcfg).catch(() => 0);
  const hubsDesktop = await new Promise((res) => { const h = require('http'); const q = h.request({ host: '127.0.0.1', port: wcfg, method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' } }, (rs) => { const ck = (rs.headers['set-cookie'] || [])[0] || ''; rs.resume(); const q2 = h.request({ host: '127.0.0.1', port: wcfg, method: 'POST', path: '/api/action/scan', headers: { Cookie: ck.split(';')[0], 'X-Dashboard-Hub': '1' } }, (r2) => { r2.resume(); res(r2.statusCode); }); q2.end(); }); q.write(JSON.stringify({ code: 'desktop phone code' })); q.end(); });
  check('the desktop\'s own phone page stays view only (no scan action)', hubsDesktop === 405, hubsDesktop);
  await page.evaluate(() => window.webApi.setOn(false));
  const ids = await page.evaluate(async () => (await window.hubsApi.list()).list.map((x) => x.id));
  for (const i of ids) await page.evaluate((i) => window.hubsApi.remove(i), i);
  check('servers can be removed', (await page.evaluate(async () => (await window.hubsApi.list()).list.length)) === 0);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await app.close(); dk.kill('SIGTERM');
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
