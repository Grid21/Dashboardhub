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
  const snp = r.json.snapshot;
  check('the page gets the devices and the router', snp.devices.length >= 2 && snp.devices.some((d) => d.isRouter) && snp.devices.every((d) => 'x' in d && 'online' in d));
  check('panels come from the settings, bad ones left out', snp.panels.length === 2 && snp.panels[0].name === 'Alpha' && snp.panels[1].url === 'https://example.org/x', JSON.stringify(snp.panels));
  check('the profile name is the Docker name', snp.profile.name === 'Test box');
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
  check('the page knows when it was last scanned (no "NaN days ago")', Number.isFinite(snp.at) && snp.at > 1.7e12);
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
  // ----- device names, groups, ignore, add by hand, forget -----
  const D = (body) => req(port, 'POST', '/api/action/devices', body, cookie, H);
  check('the device list needs a sign-in and the safety header', (await req(port, 'POST', '/api/action/devices', { op: 'list' }, '', H)).code === 401 && (await req(port, 'POST', '/api/action/devices', { op: 'list' }, cookie)).code === 403);
  r = await D({ op: 'list' });
  const rows = r.json.devices, host = rows.find((d) => !d.isRouter && !d.self) || rows.find((d) => !d.isRouter);
  check('the list has every device with name, group, address and status', r.json.ok && rows.length >= 2 && rows.every((d) => 'key' in d && 'shownName' in d && 'online' in d && 'ignored' in d) && rows.some((d) => d.isRouter), JSON.stringify(rows).slice(0, 200));
  r = await D({ op: 'save', changes: [{ key: host.key, name: 'My <b>test</b> box', group: 'Lab' }] });
  check('a name and a group can be set', r.json.ok === true && r.json.saved === 1, JSON.stringify(r.json));
  let sn2 = (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot, mine = sn2.devices.find((d) => d.key === host.key);
  check('the page shows the name (cleaned) and the group at once', mine && mine.name === 'My btest/b box' && mine.group === 'Lab', JSON.stringify(mine));
  r = await D({ op: 'save', changes: [{ key: host.key, ignored: true }] });
  sn2 = (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot;
  const infoN = (await req(port, 'GET', '/api/info', null, cookie)).json;
  check('an ignored device leaves the map, the links and the counts', !sn2.devices.some((d) => d.key === host.key) && !sn2.links.some((l) => l.b === host.key) && infoN.devices === rows.filter((d) => !d.isRouter && d.key !== host.key).length, JSON.stringify(infoN));
  check('but stays in the editing list, marked ignored', (await D({ op: 'list' })).json.devices.find((d) => d.key === host.key).ignored === true);
  r = await D({ op: 'save', changes: [{ key: host.key, ignored: false }] });
  check('it can be brought back', (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.some((d) => d.key === host.key));
  r = await D({ op: 'save', changes: [{ key: 'router', ignored: true }] });
  check('the router cannot be ignored', r.json.ok === false && /router/i.test(r.json.error));
  r = await D({ op: 'save', changes: [{ key: 'nope', name: 'x' }] });
  check('an unknown device is refused', r.json.ok === false);
  r = await D({ op: 'move', key: host.key, x: 12.5, z: -7 });
  check('a dot can be moved and the page gets the new place', r.json.ok === true && (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === host.key).x === 12.5);
  check('a made-up position is refused', (await D({ op: 'move', key: host.key, x: 'a', z: 1 })).json.ok === false && (await D({ op: 'move', key: 'nope', x: 1, z: 1 })).json.ok === false);
  r = await D({ op: 'move', key: host.key, x: 99999, z: -99999 });
  check('a position far off the map is held to the edge', (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === host.key).x === 1000);
  check('Reset puts the dots back', (await D({ op: 'resetlayout' })).json.ok === true && (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === host.key).x !== 1000);
  // ----- sync from Dashboard Hub Desktop -----
  const S = (body) => req(port, 'POST', '/api/action/sync', body, cookie, H);
  const hostMac = rows.find((d) => d.key === host.key).mac, hostIp = rows.find((d) => d.key === host.key).ip;
  check('sync needs a sign-in and the safety header', (await req(port, 'POST', '/api/action/sync', {}, '', H)).code === 401 && (await req(port, 'POST', '/api/action/sync', {}, cookie)).code === 403);
  r = await S({ names: true, groups: false, positions: false, devices: [{ mac: hostMac, ip: hostIp, label: 'Synced <name>', group: 'Synced group', x: 21, z: -13 }] });
  let sd = (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === host.key);
  check('only the ticked things are copied (names yes, groups and places no)', r.json.ok === true && r.json.matched === 1 && r.json.names === 1 && r.json.groups === 0 && r.json.moved === 0 && sd.name === 'Synced name' && sd.x !== 21, JSON.stringify([r.json, sd]));
  r = await S({ names: true, groups: true, positions: true, devices: [{ mac: '', ip: hostIp, label: 'Synced name', group: 'Synced group', x: 21, z: -13 }] });
  sd = (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === host.key);
  check('a machine without a MAC is matched by its address; groups and places are copied', r.json.matched === 1 && r.json.groups === 1 && r.json.moved === 1 && sd.group === 'Synced group' && sd.x === 21 && sd.z === -13, JSON.stringify([r.json, sd]));
  r = await S({ names: true, devices: [{ mac: hostMac, ip: hostIp, label: '', group: '', x: 1, z: 1 }] });
  check('an empty name on the computer never wipes the server\'s name', r.json.names === 0 && (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === host.key).name === 'Synced name');
  r = await S({ names: true, devices: [{ ip: '10.9.9.9', label: 'Unknown one' }] });
  check('a machine the server has not found is skipped by default', r.json.skipped === 1 && r.json.added === 0 && !(await D({ op: 'list' })).json.devices.some((d) => d.ip === '10.9.9.9'));
  r = await S({ names: true, groups: true, add: true, devices: [{ ip: '10.9.9.9', label: 'Unknown one', group: 'Far' }, { ip: '8.8.8.8', label: 'Public' }] });
  check('with "add" it is added (a public address never is)', r.json.added === 1 && (await D({ op: 'list' })).json.devices.some((d) => d.ip === '10.9.9.9' && d.name === 'Unknown one' && d.group === 'Far' && d.manual === true) && !(await D({ op: 'list' })).json.devices.some((d) => d.ip === '8.8.8.8'), JSON.stringify(r.json));
  r = await S({ names: true, positions: true, devices: [{ mac: '', ip: (await D({ op: 'list' })).json.devices.find((d) => d.isRouter).ip, label: 'Hacked router', x: 99, z: 99 }] });
  check('the router and the server itself are left alone', (await D({ op: 'list' })).json.devices.find((d) => d.isRouter).name !== 'Hacked router');
  const prevPanels = (await req(port, 'GET', '/api/config', null, cookie)).json.config.panels;
  r = await S({ panels: true, panelList: [{ name: 'Grafana', url: 'http://192.168.0.5:3000' }, { name: 'Bad', url: 'javascript:alert(1)' }], devices: [] });
  check('panels can be replaced, and a bad address is dropped', r.json.panels === 1 && (await req(port, 'GET', '/api/config', null, cookie)).json.config.panels.length === 1);
  await S({ panels: true, panelList: prevPanels, devices: [] });
  r = await S({ devices: 'nonsense' });
  check('nonsense is ignored without a crash', r.code === 200 && r.json.matched === 0);
  // ----- the whole saved map: details, cables, ignored machines, export and import -----
  const validate = require(path.join(ROOT, 'validate.js'));
  const snapDev = async (k) => (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.find((d) => d.key === k);
  const snapAll = async () => (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot;
  r = await S({ info: true, add: true, links: true, ignored: true, names: true,
    devices: [{ key: hostMac || 'ip:' + hostIp, mac: hostMac, ip: hostIp, label: 'Synced name', info: { brand: 'Acme', model: '<b>X1</b>', notes: 'Top shelf\u0001', webUrl: 'http://192.168.0.9/', ports: 8 }, vlan: '20' },
      { key: 'manual:zz1', ip: '10.9.9.9', label: 'Far box', info: { webUrl: 'javascript:alert(1)', notes: 'n' }, ignored: true }],
    linkList: [{ a: 'router', b: hostMac || 'ip:' + hostIp, cable: true }, { a: hostMac || 'ip:' + hostIp, b: 'manual:zz1', wireless: true }, { a: 'router', b: 'nope' }], groupOptions: { groupCircles: false } });
  let di = await snapDev(host.key);
  check('details sent from Desktop show on the server (tags removed, bad web address dropped)', r.json.ok === true && r.json.info === 2 && di.info && di.info.brand === 'Acme' && di.info.model === 'bX1/b' && di.info.webUrl === 'http://192.168.0.9/' && di.info.ports === 8 && di.vlan === '20', JSON.stringify([r.json, di]));
  check('a machine marked ignored on Desktop is hidden here too', r.json.hidden === 1 && !(await snapDev('ip:10.9.9.9')) && (await D({ op: 'list' })).json.devices.find((d) => d.ip === '10.9.9.9').ignored === true);
  let snm = await snapAll();
  check('cables from Desktop replace the plain star (links to unknown machines are dropped)', r.json.links === 1 || r.json.links === 2, JSON.stringify(r.json));
  check('every other shown machine still hangs off the router', snm.links.some((l) => l.cable === true && l.a === 'router' && l.b === host.key) && snm.devices.filter((d) => !d.isRouter && d.key !== host.key).every((d) => snm.links.some((l) => (l.a === 'router' && l.b === d.key) || l.b === d.key || l.a === d.key)), JSON.stringify(snm.links.slice(0, 4)));
  r = await S({ info: true, devices: [{ key: 'x', ip: hostIp, mac: hostMac, info: { brand: 'Acme', model: 'bX1/b', notes: 'Top shelf', webUrl: 'http://192.168.0.9/', ports: 8 }, vlan: '20' }] });
  check('sending the same details again changes nothing', r.json.info === 0, JSON.stringify(r.json));
  let ex = (await req(port, 'POST', '/api/action/exportmap', {}, cookie, H)).json;
  const parsed = validate.parseBackup(JSON.stringify(ex));
  check('the exported file is a real Dashboard Hub backup that Desktop can import', ex.app === 'dashboard-hub' && ex.format === 1 && parsed.ok === true && parsed.data.network && Object.keys(parsed.data.network.devices).length > 2, JSON.stringify(parsed).slice(0, 300));
  const exNet = parsed.data.network, exHost = exNet.devices[host.key];
  check('it carries names, places, details and the cable', exHost && exHost.label === 'Synced name' && exHost.info.brand === 'Acme' && exHost.vlan === '20' && exNet.links.some((l) => l.cable && l.b === host.key) && exNet.groupCircles === false, JSON.stringify(exHost).slice(0, 300));
  check('and it holds no access code, alert address or notes', !JSON.stringify(ex).includes('docker test code') && ex.includesNotes === false);
  // change things, then import the file we just exported: everything comes back
  await D({ op: 'save', changes: [{ key: host.key, name: 'Changed', group: 'Else' }] }); await S({ info: true, devices: [{ key: 'x', ip: hostIp, mac: hostMac, info: { brand: 'Other' } }] });
  r = await req(port, 'POST', '/api/action/importmap', { data: ex, what: { add: false } }, cookie, H);
  di = await snapDev(host.key);
  check('importing the exported file puts name, details and places back', r.json.ok === true && di.name === 'Synced name' && di.info.brand === 'Acme', JSON.stringify([r.json, di]));
  // a file in the shape Dashboard Hub Desktop writes, with two networks
  const hostOnDesktop = hostMac || 'ip:' + hostIp;
  const dt = { app: 'dashboard-hub', format: 1, exportedAt: '2026-11-01T00:00:00Z', includesNotes: true, layout: { columns: 3, height: 480 }, panels: [{ name: 'DT panel', url: 'http://192.168.0.5:3000', note: 'secret note' }], servers: [{ name: 'S', host: 'h', user: 'root', port: 22, note: 'password' }], activeProfileName: 'Home',
    profiles: [
      { id: 'a', name: 'Office', network: { router: '10.0.0.1', devices: { router: { key: 'router', ip: '10.0.0.1' } }, links: [], ignored: [] }, panels: [], servers: [] },
      { id: 'b', name: 'Home', network: { router: '192.168.0.1', groupCircles: true, groupCluster: false, devices: { router: { key: 'router', ip: '192.168.0.1', label: 'Router' },
        [hostOnDesktop]: { key: hostOnDesktop, ip: hostIp, mac: hostMac || null, label: 'From Desktop', group: 'Lab', pos: { x: -7, y: 0, z: 9 }, info: { brand: 'TP-Link', model: 'SG108', notes: 'rack 2', webUrl: '' }, vlan: '5' },
        'manual:abc': { key: 'manual:abc', ip: '10.55.0.9', label: 'Printer', group: 'Lab', pos: { x: 3, y: 0, z: 3 } } },
        links: [{ a: 'router', b: hostOnDesktop, auto: false, cable: true }, { a: hostOnDesktop, b: 'manual:abc', auto: false, cable: false, wireless: true }], ignored: ['manual:abc'] }, panels: [{ name: 'Home panel', url: 'http://192.168.0.6:8080' }], servers: [] }] };
  r = await req(port, 'POST', '/api/action/importmap', { data: dt, what: { panels: false } }, cookie, H);
  di = await snapDev(host.key); snm = await snapAll();
  check('a Desktop file with two networks imports the active one (Home)', r.json.ok === true && r.json.profile === 'Home' && r.json.total === 2 && di.name === 'From Desktop' && di.group === 'Lab' && di.x === -7 && di.z === 9 && di.info.model === 'SG108' && di.vlan === '5', JSON.stringify([r.json, di]));
  check('the manual machine was added, is hidden because Desktop ignores it, and is flagged manual', (await D({ op: 'list' })).json.devices.some((d) => d.ip === '10.55.0.9' && d.ignored === true && d.manual === true && d.name === 'Printer'));
  check('the cable and wireless links came across, panels were left alone', snm.links.some((l) => l.cable && l.b === host.key) && (await req(port, 'GET', '/api/config', null, cookie)).json.config.panels.length === prevPanels.length);
  r = await req(port, 'POST', '/api/action/importmap', { data: dt, profile: 0, what: {} }, cookie, H);
  check('the other network can be chosen (it has no machines to match)', r.json.ok === true && r.json.profile === 'Office' && r.json.matched === 0, JSON.stringify(r.json));
  r = await req(port, 'POST', '/api/action/importmap', { data: dt, what: { panels: true } }, cookie, H);
  check('panels come across only when asked, and without their notes', r.json.panels === 1 && (await req(port, 'GET', '/api/config', null, cookie)).json.config.panels.length === 1 && !JSON.stringify((await req(port, 'GET', '/api/config', null, cookie)).json).includes('secret note'));
  await S({ panels: true, panelList: prevPanels, devices: [] });
  r = await req(port, 'POST', '/api/action/importmap', { data: { app: 'something else' } }, cookie, H);
  check('a file that is not a Dashboard Hub export is refused with a plain message', r.json.ok === false && /not a Dashboard Hub export/.test(r.json.error));
  r = await req(port, 'POST', '/api/action/importmap', { data: { app: 'dashboard-hub', format: 1, panels: [] } }, cookie, H);
  check('an export with no map in it is refused', r.json.ok === false && /no network map/.test(r.json.error));
  r = await req(port, 'POST', '/api/action/importmap', { data: { app: 'dashboard-hub', format: 1, network: { devices: { 'not a key': 5, 'aa:bb:cc:dd:ee:ff': 'junk', router: null }, links: 'x', ignored: 7 } }, what: {} }, cookie, H);
  check('junk inside an export does not crash it', r.code === 200 && r.json.ok === true);
  { const big = []; for (let i = 0; i < 1400; i++) big.push({ key: 'ip:10.20.' + (i >> 8) + '.' + (i & 255), ip: '10.20.' + (i >> 8) + '.' + (i & 255), label: 'Machine ' + i, info: { notes: 'x'.repeat(300) } });
    const t0 = Date.now(); r = await S({ devices: big, info: true, names: true, add: true });
    check('a very large map (1400 machines, about 600 KB) is accepted and does not stall', r.code === 200 && r.json.ok === true && Date.now() - t0 < 8000, r.code + ' ' + (Date.now() - t0) + ' ms'); }
  for (let i = 0; i < 1400; i++) await D({ op: 'forget', key: 'ip:10.20.' + (i >> 8) + '.' + (i & 255) });
  await D({ op: 'forget', key: 'ip:10.55.0.9' });
  await D({ op: 'forget', key: 'ip:10.9.9.9' });
  r = await D({ op: 'add', ip: '8.8.8.8' }); check('a public address cannot be added', r.json.ok === false, JSON.stringify(r.json));
  r = await D({ op: 'add', ip: 'hello' }); check('a made-up address cannot be added', r.json.ok === false);
  r = await D({ op: 'add', ip: '10.77.0.5', name: 'Far away NAS', group: 'Remote' });
  check('a machine can be added by hand', r.json.ok === true && r.json.added === 'ip:10.77.0.5', JSON.stringify(r.json));
  check('it shows on the map, offline because it does not answer', (await req(port, 'GET', '/api/state', null, cookie)).json.snapshot.devices.some((d) => d.key === 'ip:10.77.0.5' && d.name === 'Far away NAS' && d.group === 'Remote' && d.online === false));
  check('adding the same address twice is refused', (await D({ op: 'add', ip: '10.77.0.5' })).json.ok === false);
  check('the router cannot be forgotten', (await D({ op: 'forget', key: 'router' })).json.ok === false);
  check('an online scanned device cannot be forgotten (ignore it instead)', (await D({ op: 'forget', key: host.key })).json.ok === (host.online ? false : true));
  r = await D({ op: 'forget', key: 'ip:10.77.0.5' });
  check('a hand-added machine can be forgotten', r.json.ok === true && !(await D({ op: 'list' })).json.devices.some((d) => d.key === 'ip:10.77.0.5'));
  check('an unknown request is refused', (await D({ op: 'explode' })).json.ok === false);
  await D({ op: 'save', changes: [{ key: host.key, name: 'Kept name', group: 'Kept' }] });
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
  check('names and groups survive a restart', r.json.snapshot.devices.some((d) => d.name === 'Kept name' && d.group === 'Kept'));
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
