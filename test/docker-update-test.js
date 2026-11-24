'use strict';
//   node test/docker-update-test.js
// The Docker version's self-update, with a pretend GitHub (a small web server on this computer): newer version found and installed,
// a web page instead of the file refused, a version that needs a rebuild refused, a version that will not start rolled back, "only tell me" mode.
// Not tested here: the real GitHub, the Docker image itself.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpd = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function req(port, method, p, body, cookie, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ Cookie: cookie || '', 'Content-Type': 'application/json' }, headers || {}) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ code: res.statusCode, headers: res.headers, json: j }); }); });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function waitFor(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) { /* keep waiting */ } await sleep(300); } return false; }
const copyDir = (a, b) => fs.cpSync(a, b, { recursive: true });

// the "built-in" program inside the image: the current files, but pretending to be an older version
function makeBaked(version) {
  const d = tmpd('baked-');
  ['scanner.js', 'discovery.js', 'notif-history.js', 'remote.js', 'package.json'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(d, f)));
  copyDir(path.join(ROOT, 'vendor'), path.join(d, 'vendor')); fs.mkdirSync(path.join(d, 'docker'));
  ['server.js', 'updater.js', 'boot.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'docker', f), path.join(d, 'docker', f)));
  const pj = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); pj.version = version; fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pj));
  return d;
}
// a bundle like make-docker-bundle makes, with a chosen version; tweak(dir) may change files first
function makeBundle(version, tweak) {
  const t = tmpd('bundle-'), d = path.join(t, 'dashboard-hub-docker');
  fs.mkdirSync(path.join(d, 'vendor'), { recursive: true });
  ['scanner.js', 'discovery.js', 'notif-history.js', 'remote.js', 'package.json'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(d, f)));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'oui.json'), path.join(d, 'vendor', 'oui.json'));
  ['server.js', 'updater.js', 'boot.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'docker', f), path.join(d, f)));
  const pj = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); pj.version = version; fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pj));
  if (tweak) tweak(d);
  const file = path.join(t, 'b.tar.gz'); execFileSync('tar', ['-czf', file, '-C', t, 'dashboard-hub-docker']);
  return fs.readFileSync(file);
}
function fakeGithub() {
  const o = { files: {}, hits: [] };
  o.server = http.createServer((rq, rs) => {
    const n = rq.url.split('/').pop(); o.hits.push(n);
    if (o.files[n]) { rs.writeHead(200); rs.end(o.files[n]); } else { rs.writeHead(404); rs.end('no'); }
  });
  o.publish = (buf) => { o.files['dashboard-hub-docker.tar.gz'] = buf; };
  return new Promise((res) => o.server.listen(0, '127.0.0.1', () => { o.port = o.server.address().port; res(o); }));
}
function startBoot(baked, env) {
  const child = spawn(process.execPath, [path.join(baked, 'docker', 'boot.js')], { env: Object.assign({}, process.env, { DASHBOARD_HUB_BASE: '1', DASHBOARD_HUB_CODE: 'update test code', DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_SCAN_SECONDS: '60', DASHBOARD_HUB_UPDATE_FIRST_MS: '600' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
  const o = { child, log: '' }; child.stdout.on('data', (d) => { o.log += d; }); child.stderr.on('data', (d) => { o.log += d; });
  return o;
}
async function login(port) { const r = await req(port, 'POST', '/api/login', { code: 'update test code' }); return ((r.headers['set-cookie'] || [])[0] || '').split(';')[0]; }
const stopBoot = async (o) => { o.child.kill('SIGTERM'); await new Promise((r) => { const t = setTimeout(r, 4000); o.child.on('exit', () => { clearTimeout(t); r(); }); }); };

(async () => {
  const gh = await fakeGithub();
  const url = 'http://127.0.0.1:' + gh.port;
  check('the newer-version check understands numbers', require('../docker/updater.js').newer('1.10.0', '1.9.9') && !require('../docker/updater.js').newer('1.2.0', '1.2.0') && !require('../docker/updater.js').newer('1.1.9', '1.2.0'));

  // ---- 1. automatic update ----
  let baked = makeBaked('1.0.0'), data = tmpd('data-'), port = await freePort();
  gh.publish(makeBundle('1.0.1'));
  let b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto' });
  check('the built-in version starts first', await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000), b.log);
  check('it finds, installs and restarts into the newer version by itself', await waitFor(() => /Running the updated version 1\.0\.1/.test(b.log), 40000), b.log);
  check('the page comes back and reports the new version', await waitFor(async () => { const c = await login(port); return c && (await req(port, 'GET', '/api/info', null, c)).json.version === '1.0.1'; }, 20000), b.log);
  check('the update sits in the data folder, not in the image', fs.existsSync(path.join(data, 'app', '1.0.1', 'docker', 'server.js')) && JSON.parse(fs.readFileSync(path.join(data, 'app', 'current.json'), 'utf8')).version === '1.0.1');
  check('settings and history survive the update', fs.existsSync(path.join(data, 'config.json')));
  let c = await login(port);
  let r = await req(port, 'GET', '/api/config', null, c);
  check('Desktop sees the update status', r.json.update && r.json.update.version === '1.0.1' && r.json.update.canInstall === true && r.json.config.update === 'auto', JSON.stringify(r.json.update));
  await stopBoot(b);
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url });
  check('after a container restart the updated version keeps running', await waitFor(() => /Running the updated version 1\.0\.1/.test(b.log), 15000), b.log);
  await stopBoot(b);
  // a rebuilt image that is newer than the saved update ignores it
  const baked2 = makeBaked('1.0.5'); b = startBoot(baked2, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'off' });
  await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000);
  c = await login(port);
  check('a rebuilt image that is newer than the saved update wins', !/updated version/.test(b.log) && (await req(port, 'GET', '/api/info', null, c)).json.version === '1.0.5', b.log);
  await stopBoot(b);

  // ---- 2. a web page instead of the file (the GitHub /blob/ mistake) ----
  baked = makeBaked('1.0.0'); data = tmpd('data-'); port = await freePort();
  gh.publish(Buffer.from('<!DOCTYPE html><html><body>GitHub</body></html>'));
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto' });
  await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000);
  await sleep(3500);
  c = await login(port); r = await req(port, 'GET', '/api/config', null, c);
  check('a web page instead of the bundle is not installed', !/updated version/.test(b.log) && /not a proper/.test(r.json.update.error) && !fs.existsSync(path.join(data, 'app', 'current.json')), JSON.stringify(r.json.update));
  await stopBoot(b);

  // ---- 3. needs a rebuild ----
  gh.publish(makeBundle('1.0.3', (d) => { const f = path.join(d, 'package.json'), j = JSON.parse(fs.readFileSync(f, 'utf8')); j.dockerBase = 2; fs.writeFileSync(f, JSON.stringify(j)); })); data = tmpd('data-'); port = await freePort();
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto' });
  await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000); await sleep(3000);
  c = await login(port); r = await req(port, 'GET', '/api/config', null, c);
  check('an update that needs a rebuild is announced but not installed', r.json.update.needsRebuild === true && r.json.update.available === true && !fs.existsSync(path.join(data, 'app', 'current.json')));
  await stopBoot(b);

  // ---- 4. a version that will not start is rolled back ----
  gh.publish(makeBundle('1.0.4', (d) => { fs.appendFileSync(path.join(d, 'server.js'), '\nprocess.exit(1);\n'); }));
  data = tmpd('data-'); port = await freePort();
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto' });
  check('a version that stops right away is dropped', await waitFor(() => /going back to the built-in version/i.test(b.log), 40000), b.log);
  check('the built-in version runs again and the bad one is remembered', await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000) && JSON.parse(fs.readFileSync(path.join(data, 'app', 'bad.json'), 'utf8')).versions.includes('1.0.4') && !fs.existsSync(path.join(data, 'app', 'current.json')), b.log);
  c = await login(port);
  check('it is not tried again', (await req(port, 'POST', '/api/action/update', {}, c, { 'X-Dashboard-Hub': '1' })).json.error.indexOf('skipped') > 0);
  await stopBoot(b);

  // ---- 5. only tell me, then install from Desktop ----
  gh.publish(makeBundle('1.0.6'));
  data = tmpd('data-'); port = await freePort();
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'check' });
  await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000); await sleep(3000);
  c = await login(port); r = await req(port, 'GET', '/api/config', null, c);
  check('"only tell me" announces the update and leaves it alone', r.json.update.available === true && r.json.update.latest === '1.0.6' && !/updated version/.test(b.log));
  r = await req(port, 'POST', '/api/action/update', { apply: false }, c, { 'X-Dashboard-Hub': '1' });
  check('"Check now" does not install', r.code === 200 && r.json.status.available === true && !/updated version/.test(b.log));
  r = await req(port, 'POST', '/api/action/update', {}, c);
  check('install needs the safety header', r.code === 403);
  r = await req(port, 'POST', '/api/action/update', {}, c, { 'X-Dashboard-Hub': '1' });
  check('"Install now" from Desktop installs and restarts', r.code === 200 && r.json.updated === true && await waitFor(() => /Running the updated version 1\.0\.6/.test(b.log), 20000), JSON.stringify(r.json) + b.log);
  await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000);
  c = await login(port);
  r = await req(port, 'POST', '/api/action/update', {}, c, { 'X-Dashboard-Hub': '1' });
  check('asking again says it is the newest', r.json.updated === false && /newest/.test(r.json.message), JSON.stringify(r.json));
  r = await req(port, 'POST', '/api/action/config', { update: 'off' }, c, { 'X-Dashboard-Hub': '1' });
  check('the update setting can be changed and is kept', r.code === 200 && JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).update === 'off');
  r = await req(port, 'POST', '/api/action/config', { update: 'sometimes' }, c, { 'X-Dashboard-Hub': '1' });
  check('a made-up update setting is refused', r.code === 200 ? r.json.ok === false : true);
  await stopBoot(b);

  // ---- 6. unsafe update file ----
  const evil = tmpd('evil-'); fs.mkdirSync(path.join(evil, 'x')); fs.writeFileSync(path.join(evil, 'x', 'f'), 'x');
  const evilTar = path.join(evil, 'e.tar.gz'); execFileSync('tar', ['-czf', evilTar, '-C', evil, '--transform', 's,^x/f,../escaped.txt,', '--absolute-names', 'x/f']);
  gh.publish(fs.readFileSync(evilTar)); data = tmpd('data-'); port = await freePort();
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto' });
  await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 15000); await sleep(3500);
  check('an update file with an unsafe path is refused', !fs.existsSync(path.join(data, 'escaped.txt')) && !fs.existsSync(path.join(data, 'app', 'current.json')) && !/updated version/.test(b.log));
  await stopBoot(b);
  // ---- 7. restarting the container is what triggers the update ----
  gh.publish(makeBundle('1.0.8'));
  data = tmpd('data-'); port = await freePort();
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto', DASHBOARD_HUB_UPDATE_FIRST_MS: '99999999' });
  check('a start (restart) installs the newer version straight away', await waitFor(() => /Running the updated version 1\.0\.8/.test(b.log), 30000) && await waitFor(async () => { const cc = await login(port); return cc && (await req(port, 'GET', '/api/info', null, cc)).json.version === '1.0.8'; }, 20000), b.log);
  check('it did not serve the old version first', !/Dashboard Hub 1\.0\.0 \(Docker\) is running/.test(b.log), b.log);
  await stopBoot(b);
  // no internet / no update list: it starts anyway
  data = tmpd('data-'); port = await freePort();
  b = startBoot(baked, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: 'http://127.0.0.1:1', DASHBOARD_HUB_UPDATE: 'auto' });
  check('with no update server reachable it still starts the built-in version', await waitFor(async () => (await req(port, 'GET', '/api/health')).code === 200, 30000) && /No update installed/.test(b.log), b.log);
  await stopBoot(b);
  // ---- 8. containers built from 1.29.1 (the old kind of update) can still update ----
  // The real 1.29.1 program files are kept in test/fixtures; the bundle script must keep making the pair they understand.
  const outDir = tmpd('mk-'); execFileSync(process.execPath, [path.join(ROOT, 'tools', 'make-docker-bundle.js'), outDir], { stdio: 'ignore' });
  const legacyDir = path.join(outDir, 'for-old-containers'), curVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  check('the bundle script makes the single file and the pair for old containers', fs.existsSync(path.join(outDir, 'dashboard-hub-docker.tar.gz')) && fs.existsSync(path.join(legacyDir, 'dashboard-hub-docker-' + curVer + '.tar.gz')) && fs.existsSync(path.join(legacyDir, 'dashboard-hub-docker-latest.json')));
  const old = makeBaked('1.29.1');
  ['server.js', 'updater.js', 'boot.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'docker-1.29.1', f), path.join(old, 'docker', f)));
  gh.files = {}; fs.readdirSync(legacyDir).forEach((f) => { gh.files[f] = fs.readFileSync(path.join(legacyDir, f)); });
  data = tmpd('data-'); port = await freePort();
  b = startBoot(old, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_UPDATE_URL: url, DASHBOARD_HUB_UPDATE: 'auto' });
  check('the real 1.29.1 container installs the current version from that pair', await waitFor(() => new RegExp('Running the updated version ' + curVer.replace(/\./g, '\\.')).test(b.log), 40000), b.log);
  check('and then it is running the current version', await waitFor(async () => { const cc = await login(port); return cc && (await req(port, 'GET', '/api/info', null, cc)).json.version === curVer; }, 20000), b.log);
  await stopBoot(b);
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
