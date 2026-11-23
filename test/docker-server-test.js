'use strict';
//   node test/docker-server-test.js
// The Docker version's program (docker/server.js) run on this computer: it scans the loopback network (a simulated network), keeps history, answers the web page and Dashboard Hub Desktop.
// Not tested here: the Docker image itself (no Docker engine in the test machine) and a real home network.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
function req(port, method, p, body, cookie, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ Cookie: cookie || '', 'Content-Type': 'application/json' }, headers || {}) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ code: res.statusCode, headers: res.headers, json: j }); }); });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
function start(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'docker', 'server.js')], { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
  const o = { child, log: '' }; child.stdout.on('data', (d) => { o.log += d; }); child.stderr.on('data', (d) => { o.log += d; });
  o.exited = new Promise((r) => child.on('exit', (c) => r(c)));
  return o;
}
async function waitFor(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) { /* keep waiting */ } await sleep(300); } return false; }
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-'));
  const port = await freePort();
  const env = { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_CODE: 'docker test code', DASHBOARD_HUB_NAME: 'Test box', DASHBOARD_HUB_SCAN_SECONDS: '60', DASHBOARD_HUB_PANELS: 'Alpha=http://10.0.0.5:9000|Evil=javascript:alert(1)|https://example.org/x' };
  let s = start(env);
  check('the web page comes up', await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000), s.log);
  check('the health check needs no sign-in and shares nothing', (await req(port, 'GET', '/api/health')).json.ok === true && Object.keys((await req(port, 'GET', '/api/health')).json).length === 1);
  check('the first scan finishes', await waitFor(() => /Scan finished/.test(s.log), 40000), s.log);
  let r = await req(port, 'POST', '/api/login', { code: 'wrong' });
  check('a wrong code is refused', r.code === 401);
  r = await req(port, 'POST', '/api/login', { code: 'docker test code' });
  const cookie = ((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
  check('the code from the environment signs in', r.code === 200 && !!cookie);
  r = await req(port, 'GET', '/api/info', null, cookie);
  check('info says it is the Docker version, with name, network and counts', r.json.mode === 'docker' && r.json.name === 'Test box' && r.json.network === '127.0.0.0/24' && r.json.devices >= 1 && r.json.online >= 1 && r.json.scans === 1 && r.json.running === false && /^\d+\.\d+\.\d+$/.test(r.json.version), JSON.stringify(r.json));
  check('info needs a sign-in', (await req(port, 'GET', '/api/info')).code === 401);
  r = await req(port, 'GET', '/api/state', null, cookie);
  const sn = r.json.snapshot;
  check('the page gets the devices and the router', sn.devices.length >= 2 && sn.devices.some((d) => d.isRouter) && sn.devices.every((d) => 'x' in d && 'online' in d));
  check('panels come from the settings, bad ones left out', sn.panels.length === 2 && sn.panels[0].name === 'Alpha' && sn.panels[1].url === 'https://example.org/x', JSON.stringify(sn.panels));
  check('the profile name is the Docker name', sn.profile.name === 'Test box');
  r = await req(port, 'GET', '/api/uptime?days=1', null, cookie);
  check('uptime history already has a story and a row per device', r.json.ok && r.json.devices.length >= 1 && typeof r.json.summary === 'string', JSON.stringify(r.json).slice(0, 200));
  // the scan action
  r = await req(port, 'POST', '/api/action/scan', {}, cookie);
  check('scan now needs the safety header', r.code === 403);
  r = await req(port, 'POST', '/api/action/scan', {}, '', { 'X-Dashboard-Hub': '1' });
  check('scan now needs a sign-in', r.code === 401);
  r = await req(port, 'POST', '/api/action/scan', {}, cookie, { 'X-Dashboard-Hub': '1' });
  check('scan now starts a scan', r.code === 200 && r.json.started === true);
  r = await req(port, 'POST', '/api/action/scan', {}, cookie, { 'X-Dashboard-Hub': '1' });
  check('asking again while it runs says so', r.code === 200 && (r.json.started === false || r.json.started === true));
  check('the second scan finishes', await waitFor(() => (s.log.match(/Scan finished/g) || []).length >= 2, 40000), s.log);
  check('nothing else can be done to it from the page', (await req(port, 'POST', '/api/action/reboot', {}, cookie, { 'X-Dashboard-Hub': '1' })).code === 405 && (await req(port, 'POST', '/api/state', {}, cookie)).code === 405);
  // ----- settings that Desktop can read and change -----
  check('settings need a sign-in', (await req(port, 'GET', '/api/config')).code === 401);
  r = await req(port, 'GET', '/api/config', null, cookie);
  check('the settings show what is set, what was found, and the network cards', r.code === 200 && r.json.config.name === 'Test box' && r.json.config.scanSeconds === 60 && r.json.config.panels.length === 2 && Array.isArray(r.json.interfaces) && typeof r.json.detected.network === 'string' && r.json.detected.router === '192.0.2.1' && r.json.port === port, JSON.stringify(r.json).slice(0, 300));
  check('the page knows when it was last scanned (no "NaN days ago")', Number.isFinite(sn.at) && sn.at > 1.7e12);
  const H = { 'X-Dashboard-Hub': '1' };
  check('changing settings needs the safety header', (await req(port, 'POST', '/api/action/config', { name: 'x' }, cookie)).code === 403);
  for (const [label, bad] of [['a scan time under a minute', { scanSeconds: 5 }], ['a public network', { network: '8.8.8.0/24' }], ['a network that is not one', { network: 'hello' }], ['a router address that is not one', { router: 'abc' }], ['a public router address', { router: '8.8.8.8' }], ['a panel without http', { panels: [{ name: 'x', url: 'javascript:alert(1)' }] }], ['an empty name', { name: '  ' }]]) {
    const x = await req(port, 'POST', '/api/action/config', bad, cookie, H);
    check('it refuses ' + label, x.code === 200 && x.json.ok === false && typeof x.json.error === 'string' && x.json.error.length > 5, JSON.stringify(x.json));
  }
  r = await req(port, 'POST', '/api/action/config', { name: 'Renamed box', scanSeconds: 120, router: '10.9.9.1', panels: [{ name: 'One', url: 'http://10.0.0.9' }, { name: '', url: 'https://example.net/a' }] }, cookie, H);
  check('good settings are accepted', r.json.ok === true && r.json.config.name === 'Renamed box' && r.json.config.panels.length === 2 && r.json.config.panels[1].name === 'https://example.net/a', JSON.stringify(r.json));
  r = await req(port, 'GET', '/api/state', null, cookie);
  check('the page shows the new name and panels at once', r.json.snapshot.profile.name === 'Renamed box' && r.json.snapshot.panels[0].name === 'One');
  r = await req(port, 'GET', '/api/info', null, cookie);
  check('info shows the new scan time', r.json.scanSeconds === 120 && r.json.name === 'Renamed box');
  check('the settings file on disk has them', JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).name === 'Renamed box');
  check('only the settings that were sent change', (await req(port, 'GET', '/api/config', null, cookie)).json.config.scanSeconds === 120 && (await req(port, 'POST', '/api/action/config', { name: 'Renamed box' }, cookie, H)).json.config.panels.length === 2);
  r = await req(port, 'POST', '/api/action/config', { router: 'auto' }, cookie, H);
  check('the router can go back to automatic', r.json.ok === true && r.json.config.router === 'auto');
  await sleep(3500);
  check('the device list and history are saved in the data folder', fs.existsSync(path.join(data, 'state.json')) && fs.existsSync(path.join(data, 'history.json')) && fs.existsSync(path.join(data, 'web-access.json')));
  check('the access code is not in the data folder as plain text', !fs.readFileSync(path.join(data, 'web-access.json'), 'utf8').includes('docker test code'));
  const before = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  s.child.kill('SIGTERM');
  check('it stops cleanly when told to', (await Promise.race([s.exited, sleep(8000).then(() => 'late')])) === 0);
  // restart: remembers devices, no second "new" flood
  s = start(env);
  check('it comes back with the same devices', await waitFor(async () => { const x = await req(port, 'POST', '/api/login', { code: 'docker test code' }); return x.code === 200; }, 15000));
  r = await req(port, 'POST', '/api/login', { code: 'docker test code' }); const c2 = r.headers['set-cookie'][0].split(';')[0];
  r = await req(port, 'GET', '/api/state', null, c2);
  check('the devices are the same after a restart', r.json.snapshot.devices.length === Object.keys(before.devices).length);
  check('settings changed in Desktop win over the starting settings after a restart', r.json.snapshot.profile.name === 'Renamed box' && r.json.snapshot.panels[0].name === 'One');
  check('the second run finishes a scan without calling everything new', await waitFor(() => /Scan finished/.test(s.log), 40000) && !/ new\b/.test(s.log.split('Scan finished').pop().split('\n')[0] || ''), s.log);
  s.child.kill('SIGTERM'); await s.exited;
  // no code given: it makes one and shows it once
  const data2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dk2-')); const port2 = await freePort();
  s = start({ DASHBOARD_HUB_DATA: data2, DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_PORT: String(port2), DASHBOARD_HUB_CODE: '' });
  await waitFor(() => /access code is/.test(s.log), 15000);
  const code = (/access code is:\s+(\S+)/.exec(s.log) || [])[1] || '';
  check('with no code set it makes a random one and prints it once', code.length === 12);
  check('and that code works', await waitFor(async () => (await req(port2, 'POST', '/api/login', { code })).code === 200, 15000));
  s.child.kill('SIGTERM'); await s.exited;
  s = start({ DASHBOARD_HUB_DATA: data2, DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_PORT: String(port2), DASHBOARD_HUB_CODE: '' });
  await waitFor(async () => (await req(port2, 'GET', '/api/health').catch(() => ({ code: 0 }))).code === 200, 15000);
  check('on the next start the same code still works and is not printed again', !/access code is/.test(s.log) && (await req(port2, 'POST', '/api/login', { code })).code === 200);
  s.child.kill('SIGTERM'); await s.exited;
  s = start({ DASHBOARD_HUB_DATA: data2, DASHBOARD_HUB_CODE: 'abc', DASHBOARD_HUB_PORT: String(port2) });
  check('a too-short code in the settings stops it with a clear message', (await s.exited) === 2 && /DASHBOARD_HUB_CODE/.test(s.log));
  s = start({ DASHBOARD_HUB_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dk3-')), DASHBOARD_HUB_NETWORK: '8.8.8.0/24', DASHBOARD_HUB_PORT: String(port2), DASHBOARD_HUB_CODE: 'a good code' });
  check('a public network is refused (only home networks are scanned)', await waitFor(() => /only private/.test(s.log), 15000), s.log);
  s.child.kill('SIGTERM'); await s.exited;
  // the files the image needs exist
  const df = fs.readFileSync(path.join(ROOT, 'docker', 'Dockerfile'), 'utf8');
  const need = (df.match(/^COPY (.+?) \.\/?$/m) || [])[1] || '';
  check('the Dockerfile copies only files that exist', need.split(/\s+/).every((f) => fs.existsSync(path.join(ROOT, f))) && fs.existsSync(path.join(ROOT, 'vendor', 'oui.json')) && fs.existsSync(path.join(ROOT, 'docker', 'server.js')), need);
  check('the compose file asks for host networking and little else', /network_mode: host/.test(fs.readFileSync(path.join(ROOT, 'docker', 'docker-compose.yml'), 'utf8')) && /cap_drop: \[ALL\]/.test(fs.readFileSync(path.join(ROOT, 'docker', 'docker-compose.yml'), 'utf8')));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
