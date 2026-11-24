'use strict';
// Self-update for the Docker version.
// It downloads  dashboard-hub-docker.tar.gz  from your GitHub repository (the same one file you install from), reads the version inside it,
// and if that is newer, unpacks it into the data folder (/data/app/<version>) and asks the program to restart.
// docker/boot.js (the small starter inside the image) then runs the newer copy. If the newer copy cannot start, the starter goes back to the built-in one.
// Things that live in the image itself (Linux packages, the starter) cannot change this way: the update file says so ("base") and you rebuild once.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const cp = require('child_process');

const num = (v) => String(v).split('.').map((p) => parseInt(p, 10) || 0);
function newer(a, b) {           // is version a newer than b?
  const x = num(a), y = num(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
const validVersion = (v) => typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);

function fetchBuf(url, maxBytes, hops) {
  return new Promise((resolve, reject) => {
    if ((hops || 0) > 4) return reject(new Error('Too many redirects.'));
    let u; try { u = new URL(url); } catch (e) { return reject(new Error('Bad update address.')); }
    const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!lib) return reject(new Error('Bad update address.'));
    const req = lib.get(u, { headers: { 'User-Agent': 'DashboardHub-Docker-Updater', 'Accept': '*/*' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next; try { next = new URL(res.headers.location, u); } catch (e) { return reject(new Error('Bad redirect.')); }
        if (u.protocol === 'https:' && next.protocol !== 'https:') return reject(new Error('Redirect to an unsafe address refused.'));
        return fetchBuf(next.href, maxBytes, (hops || 0) + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('The update server answered ' + res.statusCode + (res.statusCode === 404 ? ' (file not found: has the update been uploaded to GitHub?)' : '') + '.')); }
      const parts = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(new Error('The update file is too big.')); } else parts.push(c); });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The update server did not answer in time.')));
    req.on('error', reject);
  });
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* leave it */ } }

module.exports = function createUpdater(o) {
  const dataDir = o.dataDir, appDir = path.join(dataDir, 'app');
  const log = o.log || (() => {});
  const st = { checkedAt: 0, latest: '', error: '', note: '', needsRebuild: false, busy: false, notes: '' };
  let timer = null, first = null;
  const baseUrl = () => o.baseUrl || ('https://raw.githubusercontent.com/' + o.repo + '/' + (o.branch || 'main'));
  const mode = () => (typeof o.getMode === 'function' ? o.getMode() : 'auto');
  const badFile = path.join(appDir, 'bad.json');
  const bad = () => { try { return JSON.parse(fs.readFileSync(badFile, 'utf8')).versions || []; } catch (e) { return []; } };

  const BUNDLE = 'dashboard-hub-docker.tar.gz';
  // Downloads the one bundle file, checks that it is a safe tar.gz and reads its version from the package.json inside it.
  async function fetchBundle() {
    const buf = await fetchBuf(baseUrl() + '/' + BUNDLE, 30 * 1024 * 1024);
    const tgz = path.join(appDir, 'download.tar.gz');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(tgz, buf);
    try {
      let names;
      try { names = cp.execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 4000000 }).split('\n').filter(Boolean); } catch (e) { throw new Error('The file on GitHub is not a proper dashboard-hub-docker.tar.gz (is it the GitHub web page and not the file?).'); }
      if (!names.length || names.length > 200) throw new Error('The update file has an unexpected number of files.');
      names.forEach((n) => { if (n.startsWith('/') || n.split('/').includes('..')) throw new Error('The update file has an unsafe file name.'); });
      let pj; try { pj = JSON.parse(cp.execFileSync('tar', ['-xzOf', tgz, 'dashboard-hub-docker/package.json'], { encoding: 'utf8', maxBuffer: 1000000 })); } catch (e) { throw new Error('The update file has no readable package.json.'); }
      if (!validVersion(pj.version)) throw new Error('The update file has no valid version.');
      return { buf, version: pj.version, base: Number(pj.dockerBase) || 1, notes: String(pj.dockerNotes || '').slice(0, 300) };
    } finally { try { fs.unlinkSync(tgz); } catch (e) { /* already gone */ } }
  }
  async function check() {
    st.checkedAt = Date.now();
    try {
      const m = await fetchBundle();
      st.latest = m.version; st.error = ''; st.needsRebuild = m.base > o.base; st.notes = m.notes;
      return m;
    } catch (e) { st.error = e.message || 'Update check failed.'; return null; }
  }

  function extractAndPlace(buf, m) {
    const tmp = path.join(appDir, 'tmp-' + m.version), final = path.join(appDir, m.version), tgz = tmp + '.tar.gz';
    rmrf(tmp); rmrf(final);
    fs.writeFileSync(tgz, buf);
    try {
      fs.mkdirSync(tmp);
      cp.execFileSync('tar', ['-xzf', tgz, '-C', tmp, '--no-same-owner', '--no-same-permissions']);
    } finally { try { fs.unlinkSync(tgz); } catch (e) { /* already gone */ } }
    const top = path.join(tmp, 'dashboard-hub-docker');
    const need = ['scanner.js', 'discovery.js', 'notif-history.js', 'remote.js', 'package.json', 'server.js', 'updater.js', path.join('vendor', 'oui.json')];
    need.forEach((f) => { if (!fs.existsSync(path.join(top, f))) throw new Error('The update file is missing ' + f + '.'); });
    fs.mkdirSync(path.join(top, 'docker'));
    ['server.js', 'updater.js'].forEach((f) => fs.renameSync(path.join(top, f), path.join(top, 'docker', f)));
    // the new program must at least be readable by Node
    cp.execFileSync(process.execPath, ['--check', path.join(top, 'docker', 'server.js')], { stdio: 'ignore' });
    fs.renameSync(top, final); rmrf(tmp);
    return final;
  }

  async function apply() {
    if (st.busy) return { ok: false, error: 'An update is already being installed.' };
    if (!o.supervised) return { ok: false, error: 'This container was built before updates were possible. Rebuild it once from the newest bundle.' };
    st.busy = true;
    try {
      log('Looking for a newer version...');
      const m = await check();
      if (!m) return { ok: false, error: st.error };
      if (!newer(m.version, o.version)) return { ok: true, updated: false, message: 'Already the newest version (' + o.version + ').' };
      if (m.base > o.base) return { ok: false, error: 'Version ' + m.version + ' needs the container to be rebuilt once (the Linux part changed). Download the bundle and run docker compose up -d --build.' };
      if (bad().includes(m.version)) return { ok: false, error: 'Version ' + m.version + ' did not start here before, so it was skipped. Upload a newer one.' };
      log('Installing version ' + m.version + '...');
      const dir = extractAndPlace(m.buf, m);
      const cur = path.join(appDir, 'current.json');
      fs.writeFileSync(cur + '.tmp', JSON.stringify({ version: m.version, dir: dir }), { mode: 0o600 }); fs.renameSync(cur + '.tmp', cur);
      // keep only this version and the one running now
      try { fs.readdirSync(appDir).forEach((n) => { if (/^\d+\.\d+\.\d+$/.test(n) && n !== m.version && n !== o.version) rmrf(path.join(appDir, n)); }); } catch (e) { /* tidy-up only */ }
      log('Version ' + m.version + ' installed. Restarting to use it.');
      return { ok: true, updated: true, version: m.version, message: 'Installed ' + m.version + '. The server is restarting.' };
    } catch (e) { st.error = e.message || 'The update failed.'; log('Update failed: ' + st.error); return { ok: false, error: st.error }; } finally { st.busy = false; }
  }

  async function cycle() {
    if (mode() === 'auto') { const r = await apply(); if (r.updated && o.restart) o.restart(); } else await check();
  }
  return {
    check, apply, newer,
    status() { return { mode: mode(), version: o.version, latest: st.latest, available: !!st.latest && newer(st.latest, o.version), needsRebuild: st.needsRebuild, checkedAt: st.checkedAt, error: st.error, notes: st.notes, canInstall: !!o.supervised, repo: o.baseUrl ? '(custom)' : o.repo }; },
    start() {
      const run = () => { if (mode() !== 'off') cycle().catch(() => {}); };
      first = setTimeout(() => { run(); timer = setInterval(run, o.everyMs || 6 * 3600 * 1000); timer.unref(); }, o.firstMs || 120000);
      first.unref();
    },
    stop() { if (first) clearTimeout(first); if (timer) clearInterval(timer); }
  };
};
module.exports.newer = newer;
