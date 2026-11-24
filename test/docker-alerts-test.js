'use strict';
//   node test/docker-alerts-test.js
// Alerts of the Docker version: the message that goes to ntfy / Discord / Slack / any web address when a device is new, goes offline or comes back.
// A small web server on this computer plays the receiver. Not tested: the real ntfy, Discord or Slack.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function req(port, method, p, body, cookie, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ Cookie: cookie || '', 'Content-Type': 'application/json' }, headers || {}) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ code: res.statusCode, headers: res.headers, json: j }); }); });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
(async () => {
  const got = [];
  const rx = http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => { got.push({ url: q.url, headers: q.headers, body: b }); s.writeHead(q.url.indexOf('fail') >= 0 ? 500 : 200); s.end('ok'); }); });
  await new Promise((r) => rx.listen(0, '127.0.0.1', r)); const rxUrl = 'http://127.0.0.1:' + rx.address().port;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'al-'));
  process.env.DASHBOARD_HUB_DATA = data; process.env.DASHBOARD_HUB_PORT = '18999';
  const T = require('../docker/server.js')._test;
  const evs = [{ kind: 'new', name: 'Laptop', ip: '192.168.0.9', vendor: 'Acme', t: 1 }, { kind: 'left', name: 'Printer', ip: '192.168.0.4', t: 2 }, { kind: 'back', name: 'NAS', ip: '192.168.0.2', t: 3 }, { kind: 'ip', name: 'X', ip: '192.168.0.7', t: 4 }];
  const base = (o) => ({ name: 'Home lab', alerts: Object.assign({ url: rxUrl + '/topic', format: 'ntfy', onNew: true, onLeft: true, onBack: false }, o) });
  T.setConfig(base()); T.sendAlerts(evs); await sleep(600);
  check('ntfy: one plain-text message with the new and the offline device', got.length === 1 && /^text\/plain/.test(got[0].headers['content-type']) && /New device: Laptop \(192\.168\.0\.9\) - Acme/.test(got[0].body) && /Went offline: Printer/.test(got[0].body), JSON.stringify(got[0]));
  check('only the kinds you chose are sent (back and address changes are not)', !/Back online/.test(got[0].body) && !/X/.test(got[0].body.replace(/Acme|Laptop/g, '')));
  check('the title names the server, in plain letters', got[0].headers.title === 'Dashboard Hub: Home lab' && got[0].url === '/topic');
  got.length = 0; T.setConfig(base({ onBack: true, onNew: false, onLeft: false })); T.sendAlerts(evs); await sleep(500);
  check('"back online" can be chosen on its own', got.length === 1 && /Back online: NAS/.test(got[0].body) && !/New device/.test(got[0].body));
  got.length = 0; T.setConfig(base({ onBack: false, onNew: false, onLeft: false })); T.sendAlerts(evs); await sleep(400);
  check('with everything switched off nothing is sent', got.length === 0);
  got.length = 0; T.setConfig(base({ url: '' })); T.sendAlerts(evs); await sleep(400);
  check('with no address nothing is sent', got.length === 0);
  got.length = 0; T.setConfig(base({ format: 'discord' })); T.sendAlerts(evs); await sleep(500);
  let j = null; try { j = JSON.parse(got[0].body); } catch (e) { /* not json */ }
  check('Discord: JSON with "content"', got.length === 1 && j && /Dashboard Hub: Home lab/.test(j.content) && /New device/.test(j.content), JSON.stringify(got[0]));
  got.length = 0; T.setConfig(base({ format: 'slack' })); T.sendAlerts(evs); await sleep(500);
  try { j = JSON.parse(got[0].body); } catch (e) { j = null; }
  check('Slack: JSON with "text"', got.length === 1 && j && /Went offline: Printer/.test(j.text));
  got.length = 0; T.setConfig(base({ format: 'json' })); T.sendAlerts(evs); await sleep(500);
  try { j = JSON.parse(got[0].body); } catch (e) { j = null; }
  check('plain JSON: title, message, server and the events', got.length === 1 && j && j.server === 'Home lab' && Array.isArray(j.events) && j.events.length === 2 && j.events[0].kind === 'new');
  const many = []; for (let i = 0; i < 20; i++) many.push({ kind: 'left', name: 'Dev' + i, ip: '192.168.0.' + (10 + i), t: i });
  got.length = 0; T.setConfig(base()); T.sendAlerts(many); await sleep(500);
  check('a flood becomes one message, "...and 5 more"', got.length === 1 && /and 5 more/.test(got[0].body) && got[0].body.split('\n').length === 16);
  T.setConfig(base({ url: 'http://127.0.0.1:1/x' })); let threw = false; try { T.sendAlerts(evs); await sleep(500); } catch (e) { threw = true; }
  check('an unreachable address does not break anything', !threw);
  T.setConfig(base({ url: rxUrl + '/fail' })); got.length = 0; try { T.sendAlerts(evs); await sleep(500); } catch (e) { threw = true; }
  check('an address that answers with an error does not break anything either', !threw && got.length === 1);

  // ---- the real server: settings and the test button ----
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'docker', 'server.js')], { env: Object.assign({}, process.env, { DASHBOARD_HUB_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'al2-')), DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_CODE: 'alert test code', DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_UPDATE: 'off' }), stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await req(port, 'GET', '/api/health')).code === 200) break; } catch (e) { /* not up yet */ } await sleep(300); }
  const login = await req(port, 'POST', '/api/login', { code: 'alert test code' }); const cookie = (login.headers['set-cookie'] || [])[0].split(';')[0], H = { 'X-Dashboard-Hub': '1' };
  let r = await req(port, 'GET', '/api/config', null, cookie);
  check('alerts start switched off (no address)', r.json.config.alerts.url === '' && r.json.config.alerts.onNew === true && r.json.config.alerts.onBack === false, JSON.stringify(r.json.config.alerts));
  r = await req(port, 'POST', '/api/action/alerttest', {}, cookie, H);
  check('the test button asks for an address first', r.json.ok === false && /address/i.test(r.json.error));
  r = await req(port, 'POST', '/api/action/config', { alerts: { url: 'ftp://nope', format: 'ntfy' } }, cookie, H);
  check('a wrong address is refused', r.json.ok === false && /http/.test(r.json.error));
  r = await req(port, 'POST', '/api/action/config', { alerts: { url: rxUrl + '/phone', format: 'carrier-pigeon' } }, cookie, H);
  check('an unknown alert type is refused', r.json.ok === false);
  got.length = 0;
  r = await req(port, 'POST', '/api/action/alerttest', { alerts: { url: rxUrl + '/phone', format: 'ntfy' } }, cookie, H);
  check('the test button sends a test message (before saving)', r.json.ok === true && got.length === 1 && /test message/i.test(got[0].body) && got[0].url === '/phone', JSON.stringify([r.json, got]));
  r = await req(port, 'POST', '/api/action/alerttest', { alerts: { url: rxUrl + '/fail', format: 'ntfy' } }, cookie, H);
  check('the test button says when the address answers with an error', r.json.ok === false && /500/.test(r.json.error), JSON.stringify(r.json));
  r = await req(port, 'POST', '/api/action/config', { alerts: { url: rxUrl + '/phone', format: 'slack', onBack: true } }, cookie, H);
  check('the settings are saved', r.code === 200 && r.json.config.alerts.url === rxUrl + '/phone' && r.json.config.alerts.format === 'slack' && r.json.config.alerts.onBack === true && r.json.config.alerts.onNew === true, JSON.stringify(r.json));
  r = await req(port, 'POST', '/api/action/config', { name: 'Renamed' }, cookie, H);
  r = await req(port, 'GET', '/api/config', null, cookie);
  check('changing something else keeps the alert address', r.json.config.name === 'Renamed' && r.json.config.alerts.url === rxUrl + '/phone');
  child.kill('SIGTERM'); rx.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
