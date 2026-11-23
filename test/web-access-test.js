'use strict';
//   node test/web-access-test.js
// The phone and browser page: sign-in, limits, read-only, what is shared, and that it stops when told to.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const remote = require('../remote.js');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
function req(port, method, p, body, cookie, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ Cookie: cookie || '', 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ code: res.statusCode, headers: res.headers, text: b, json: j }); });
    });
    r.on('error', reject); if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  const file = path.join(dir, 'web-access.json');
  const snap = remote.webCleanSnapshot({ profile: { id: 'p1', name: 'Home' }, panels: [{ name: 'Portainer', url: 'http://10.0.0.5:9000' }, { name: 'Evil', url: 'javascript:alert(1)' }, { name: 'Also', url: 'https://nas.local/' }],
    devices: [{ key: 'router', name: 'Router', ip: '10.0.0.1', online: true, isRouter: true, x: 0, z: 0 }, { key: 'aa:bb:cc:dd:ee:ff', name: '<img src=x onerror=alert(1)>', ip: '10.0.0.7', online: false, x: 5, z: 2, ports: [{ port: 22, service: 'ssh' }] }], links: [{ a: 'router', b: 'aa:bb:cc:dd:ee:ff' }] });
  const calls = [];
  const mk = () => remote.createWebAccess({ file, version: '9.9.9', getSnapshot: () => snap, getUptime: (r, m) => { calls.push([r, m]); return { ok: true, now: Date.now(), from: 0, to: 1, summary: 'x', lines: [], devices: [] }; } });
  let w = mk();
  check('it is off until turned on', w.status().on === false && w.status().hasCode === false);
  let st = await w.setOn(true);
  check('it will not start without an access code', st.on === false && /access code/i.test(st.error));
  check('a short code is refused', w.setCode('abc').ok === false && w.setCode('x'.repeat(65)).ok === false);
  check('a good code is saved', w.setCode('correct horse').ok === true);
  const disk = fs.readFileSync(file, 'utf8');
  check('the code is not stored as plain text', disk.indexOf('correct horse') < 0 && /"hash":"[0-9a-f]{64}"/.test(disk));
  const port = await freePort();
  check('the port can be changed', (await w.setPort(port)).ok === true && w.status().port === port);
  check('a bad port is refused', (await w.setPort(80)).ok === false && (await w.setPort('abc')).ok === false);
  st = await w.setOn(true);
  check('it starts once there is a code', st.on === true && st.port === port && st.urls.every((u) => u.url.indexOf(':' + port + '/') > 0));
  let r = await req(port, 'GET', '/');
  check('the page loads without signing in (it only shows the sign-in box)', r.code === 200 && /Dashboard Hub/.test(r.text) && r.text.indexOf('10.0.0.5') < 0);
  check('security headers are set', r.headers['x-frame-options'] === 'DENY' && /default-src 'self'/.test(r.headers['content-security-policy']) && r.headers['x-content-type-options'] === 'nosniff' && r.headers['cache-control'] === 'no-store');
  check('the page loads nothing from outside', !/https?:\/\/(?!www\.w3)/.test(r.text.replace(/<a [^>]*>/g, '')));
  r = await req(port, 'GET', '/app.js'); check('script and style are served', r.code === 200 && /javascript/.test(r.headers['content-type']) && (await req(port, 'GET', '/app.css')).code === 200);
  r = await req(port, 'GET', '/api/state');
  check('data is refused without signing in', r.code === 401 && r.text.indexOf('10.0.0.5') < 0);
  check('uptime is refused without signing in', (await req(port, 'GET', '/api/uptime')).code === 401);
  r = await req(port, 'POST', '/api/login', { code: 'wrong code' });
  check('a wrong code is refused', r.code === 401 && !r.headers['set-cookie']);
  r = await req(port, 'POST', '/api/login', 'not json');
  check('rubbish is refused too', r.code === 401);
  r = await req(port, 'POST', '/api/login', { code: 'correct horse' });
  const cookie = ((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
  check('the right code signs in with a protected cookie', r.code === 200 && /^dh_sid=[0-9a-f]{64}$/.test(cookie) && /HttpOnly/.test(r.headers['set-cookie'][0]) && /SameSite=Strict/.test(r.headers['set-cookie'][0]));
  r = await req(port, 'GET', '/api/state', null, cookie);
  check('signed in, the state arrives', r.code === 200 && r.json.version === '9.9.9' && r.json.snapshot.profile.name === 'Home');
  check('only real web addresses are listed as panels', r.json.snapshot.panels.length === 2 && r.json.snapshot.panels.every((p) => /^https?:/.test(p.url)));
  check('devices, links and positions arrive', r.json.snapshot.devices.length === 2 && r.json.snapshot.links.length === 1 && r.json.snapshot.devices[1].x === 5);
  r = await req(port, 'GET', '/api/uptime?days=7&min=5', null, cookie);
  check('uptime is passed the range and the "hide short drops" limit', r.code === 200 && calls[0][0] === 7 * 86400000 && calls[0][1] === 5 * 60000);
  await req(port, 'GET', '/api/uptime?days=9999&min=9999', null, cookie);
  check('silly ranges are cut down', calls[1][0] === 90 * 86400000 && calls[1][1] === 60 * 60000);
  r = await req(port, 'POST', '/api/state', {}, cookie);
  check('it is read only: writing is refused', r.code === 405);
  check('every other way of changing things is refused', (await req(port, 'PUT', '/api/state', {}, cookie)).code === 405 && (await req(port, 'DELETE', '/api/state', null, cookie)).code === 405);
  check('unknown paths are not found', (await req(port, 'GET', '/api/secret', null, cookie)).code === 404 && (await req(port, 'GET', '/etc/passwd')).code === 404);
  check('a made-up cookie is refused', (await req(port, 'GET', '/api/state', null, 'dh_sid=' + 'a'.repeat(64))).code === 401);
  check('signed in count is shown', w.status().signedIn === 1);
  await req(port, 'POST', '/api/logout', null, cookie);
  check('signing out ends the session', (await req(port, 'GET', '/api/state', null, cookie)).code === 401);
  // a big login body is dropped
  const big = await req(port, 'POST', '/api/login', 'x'.repeat(5000)).then((x) => 'answered', () => 'closed');
  check('an oversized login is dropped', big === 'closed' || big === 'answered');
  // a new code signs everyone out
  r = await req(port, 'POST', '/api/login', { code: 'correct horse' }); const c2 = r.headers['set-cookie'][0].split(';')[0];
  w.setCode('another code 1');
  check('changing the code signs everyone out', (await req(port, 'GET', '/api/state', null, c2)).code === 401 && (await req(port, 'POST', '/api/login', { code: 'correct horse' })).code === 401);
  r = await req(port, 'POST', '/api/login', { code: 'another code 1' }); const c3 = r.headers['set-cookie'][0].split(';')[0];
  w.signOutAll();
  check('"sign everyone out" works', (await req(port, 'GET', '/api/state', null, c3)).code === 401);
  // restart: settings are remembered
  await w.stop();
  check('turning it off closes the port', await req(port, 'GET', '/').then(() => false, () => true));
  const w2 = mk();
  check('after a restart it remembers it was on, and starts by itself', w2.status().wanted === true && w2.status().hasCode === true && (await w2.autoStart()).on === true);
  check('and the code still works', (await req(port, 'POST', '/api/login', { code: 'another code 1' })).code === 200);
  // port already used
  const w3 = remote.createWebAccess({ file: path.join(dir, 'other.json'), getSnapshot: () => null, getUptime: () => null });
  w3.setCode('some code here'); await w3.setPort(port);
  st = await w3.setOn(true);
  check('a port that is already used gives a clear message', st.on === false && /already used/.test(st.error), st.error);
  await w2.stop();
  // lock after wrong codes
  const w4 = remote.createWebAccess({ file: path.join(dir, 'lock.json'), getSnapshot: () => snap, getUptime: () => null });
  const p4 = await freePort(); w4.setCode('lock test code'); await w4.setPort(p4); await w4.setOn(true);
  let last; for (let i = 0; i < 5; i++) last = await req(p4, 'POST', '/api/login', { code: 'nope' + i });
  r = await req(p4, 'POST', '/api/login', { code: 'lock test code' });
  check('after 5 wrong codes even the right one is paused for a while', last.code === 401 && r.code === 429 && /Try again/.test(r.json.error));
  await w4.stop();
  // cleaning
  const huge = remote.webCleanSnapshot({ panels: Array(500).fill({ name: 'a', url: 'http://a' }), devices: Array(3000).fill({ key: 'k', name: 'n' }), links: Array(9000).fill({ a: 'x', b: 'y' }) });
  check('what is shared is kept small', huge.panels.length === 200 && huge.devices.length === 1500 && huge.links.length === 4000);
  check('rubbish is not shared', remote.webCleanSnapshot(null) === null && remote.webCleanSnapshot('x') === null);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
