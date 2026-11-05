'use strict';
//   node test/updater-test.js        (no window needed: a pretend GitHub runs on this computer)
process.env.DASHBOARD_HUB_UPDATE_TEST = '1';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const U = require('../updater');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const goodFile = JSON.stringify({ app: 'dashboard-hub', format: 1, version: '2.0.0', files: {} });
let mode = 'newer';
const srv = http.createServer((q, r) => {
  const send = (code, body, headers) => { r.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {})); r.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const base = 'http://127.0.0.1:' + srv.address().port;
  if (q.url === '/repos/me/hub/releases/latest') {
    if (mode === '404') return send(404, { message: 'Not Found' });
    if (mode === 'limit') return send(403, {});
    if (mode === 'garbage') return send(200, 'not json at all');
    if (mode === 'same') return send(200, { tag_name: 'v1.10.54', assets: [] });
    if (mode === 'pre') return send(200, { tag_name: 'v3.0.0', prerelease: true, assets: [] });
    if (mode === 'noasset') return send(200, { tag_name: 'v2.0.0', body: 'notes', html_url: base + '/releases/2.0.0', assets: [{ name: 'Dashboard-Hub.exe', browser_download_url: base + '/dl/x.exe' }] });
    if (mode === 'evil') return send(200, { tag_name: 'v2.0.0', assets: [{ name: 'Dashboard-Hub-update-2.0.0.hubupdate', browser_download_url: 'https://evil.example.com/Dashboard-Hub-update-2.0.0.hubupdate' }] });
    if (mode === 'wrongname') return send(200, { tag_name: 'v2.0.0', assets: [{ name: 'Dashboard-Hub-update-9.9.9.hubupdate', browser_download_url: base + '/dl/a' }] });
    return send(200, { tag_name: 'v2.0.0', body: 'Fixes and things', assets: [{ name: 'Dashboard-Hub-update-2.0.0.hubupdate', browser_download_url: base + '/redir' }] });
  }
  if (q.url === '/redir') return send(302, '', { Location: '/dl/file' });
  if (q.url === '/dl/file') return send(200, mode === 'badfile' ? 'MZ not an update' : goodFile);
  if (q.url === '/dl/big') { r.writeHead(200, { 'Content-Length': String(50 * 1024 * 1024) }); return r.end('x'); }
  send(404, {});
});
srv.listen(0, '127.0.0.1', async () => {
  const api = 'http://127.0.0.1:' + srv.address().port, repo = 'me/hub';
  let r = await U.checkLatest({ repo: 'OWNER/REPO', current: '1.10.54', apiBase: api });
  check('placeholder repository: checks stay off', r.ok === false && r.notConfigured === true);
  check('placeholder detection / real names', !U.repoReady('OWNER/REPO') && U.repoReady('me/hub') && !U.repoReady('bad name/x') && !U.repoReady(''));
  mode = 'newer'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('newer release found with its update file and notes', r.ok && r.available && r.latest === '2.0.0' && r.assetName === 'Dashboard-Hub-update-2.0.0.hubupdate' && /Fixes/.test(r.notes), JSON.stringify(r));
  mode = 'same'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('same version: up to date', r.ok && !r.available);
  mode = 'pre'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('pre-releases are ignored', r.ok && !r.available);
  mode = 'noasset'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('newer release without an update file still tells you, with the page', r.ok && r.available && !r.assetName && /releases/.test(r.page), JSON.stringify(r));
  mode = 'evil'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('an update file hosted somewhere other than GitHub is ignored', r.ok && r.available && !r.assetUrl, JSON.stringify(r));
  mode = 'wrongname'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('an update file whose version does not match the release is ignored', r.ok && r.available && !r.assetUrl);
  mode = '404'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('no releases yet: plain message', !r.ok && /No releases/.test(r.error), r.error);
  mode = 'limit'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('GitHub rate limit: plain message', !r.ok && /limiting/.test(r.error), r.error);
  mode = 'garbage'; r = await U.checkLatest({ repo, current: '1.10.54', apiBase: api });
  check('garbage reply is handled', !r.ok && /unexpected/.test(r.error), r.error);
  r = await U.checkLatest({ repo, current: '1.10.54', apiBase: 'http://127.0.0.1:1' });
  check('no connection: plain message', !r.ok && /Could not reach GitHub/.test(r.error), r.error);
  // refuses other addresses
  const prev = process.env.DASHBOARD_HUB_UPDATE_TEST; process.env.DASHBOARD_HUB_UPDATE_TEST = '0';
  check('only GitHub addresses are allowed in real use', U.allowedUrl('https://api.github.com/x') && U.allowedUrl('https://objects.githubusercontent.com/x') && !U.allowedUrl('https://evil.example.com/x') && !U.allowedUrl('http://api.github.com/x') && !U.allowedUrl('http://127.0.0.1:1/x') && !U.allowedUrl('https://github.com.evil.com/x'));
  process.env.DASHBOARD_HUB_UPDATE_TEST = prev;
  // download
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')); fs.writeFileSync(path.join(dir, 'old.hubupdate'), 'old');
  mode = 'newer';
  let d = await U.download({ url: api + '/redir', name: 'Dashboard-Hub-update-2.0.0.hubupdate', dir });
  check('download follows a redirect and saves the file', d.ok && fs.readFileSync(path.join(dir, d.name), 'utf8') === goodFile, JSON.stringify(d));
  check('older leftovers are cleared, no half-files remain', !fs.existsSync(path.join(dir, 'old.hubupdate')) && !fs.readdirSync(dir).some((f) => f.endsWith('.part')), fs.readdirSync(dir).join());
  mode = 'badfile'; d = await U.download({ url: api + '/redir', name: 'Dashboard-Hub-update-2.0.0.hubupdate', dir });
  check('a downloaded file that is not an update is rejected and removed', !d.ok && !fs.readdirSync(dir).length, JSON.stringify(d) + fs.readdirSync(dir));
  d = await U.download({ url: api + '/dl/big', name: 'Dashboard-Hub-update-2.0.0.hubupdate', dir });
  check('an oversized download is refused', !d.ok && /bigger/.test(d.error), JSON.stringify(d));
  d = await U.download({ url: api + '/redir', name: '../../evil.hubupdate', dir });
  check('a path in the file name is refused', !d.ok);
  // choices
  const pf = path.join(dir, 'prefs.json');
  let p = U.loadPrefs(pf); check('first run: not asked yet, checking off', p.asked === false && p.enabled === false);
  p.asked = true; p.enabled = true; p.skipped = '2.0.0'; U.savePrefs(pf, p); p = U.loadPrefs(pf);
  check('choices are saved and read back', p.asked && p.enabled && p.skipped === '2.0.0');
  const res = { ok: true, available: true, latest: '2.0.0' };
  check('a skipped version is not offered again', !U.shouldOffer(res, p, Date.now()));
  check('...but the NEXT version is', U.shouldOffer({ ok: true, available: true, latest: '2.0.1' }, p, Date.now()));
  p.snoozeUntil = Date.now() + 1000; p.skipped = '';
  check('"remind me later" holds it back until the time passes', !U.shouldOffer(res, p, Date.now()) && U.shouldOffer(res, p, Date.now() + 5000));
  fs.writeFileSync(pf, '{broken'); check('damaged choices file falls back safely', U.loadPrefs(pf).asked === false);
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
});
