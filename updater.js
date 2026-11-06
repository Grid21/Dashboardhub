'use strict';
// Looks for a newer Dashboard Hub on GitHub and downloads it. It never installs anything by itself:
// installing is the starter program's job, and only after you click.
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// The GitHub repository to look at, as "owner/name". Until you set it, update checks stay switched off.
const UPDATE_REPO = 'Grid21/Dashboardhub';

const MAX_JSON = 1024 * 1024;
const MAX_DOWNLOAD = 40 * 1024 * 1024;
const ASSET_RE = /^Dashboard-Hub-update-(\d{1,4}\.\d{1,4}\.\d{1,4})\.hubupdate$/;

function repoReady(repo) { return /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(String(repo || '')) && repo !== 'OWNER/REPO'; }
function isVersion(v) { return typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v); }
function compare(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// Only GitHub's own addresses may be contacted (plus this computer, which the tests use).
function allowedUrl(u) {
  let x; try { x = new URL(u); } catch (e) { return false; }
  if (x.protocol === 'https:' && (x.hostname === 'api.github.com' || x.hostname === 'github.com' || x.hostname.endsWith('.githubusercontent.com'))) return true;
  return process.env.DASHBOARD_HUB_UPDATE_TEST === '1' && /^(127\.0\.0\.1|localhost)$/.test(x.hostname) && (x.protocol === 'http:' || x.protocol === 'https:');
}

// One GET with a few redirects, a time limit and a size limit.
function get(url, { maxBytes, accept, toFile, redirects = 5, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!allowedUrl(url)) return reject(new Error('Refusing to contact that address.'));
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Dashboard-Hub-update-check', Accept: accept || '*/*' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects.'));
        let next; try { next = new URL(res.headers.location, url).toString(); } catch (e) { return reject(new Error('Bad redirect.')); }
        return get(next, { maxBytes, accept, toFile, redirects: redirects - 1, timeoutMs }).then(resolve, reject);
      }
      if (res.statusCode === 404) { res.resume(); return reject(Object.assign(new Error('Not found.'), { code: 404 })); }
      if (res.statusCode === 403 || res.statusCode === 429) { res.resume(); return reject(Object.assign(new Error('GitHub is limiting requests right now. Try again later.'), { code: res.statusCode })); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('GitHub answered with an error (' + res.statusCode + ').')); }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > maxBytes) { res.resume(); return reject(new Error('The download is bigger than expected.')); }
      let got = 0;
      const chunks = [];
      const out = toFile ? fs.createWriteStream(toFile, { mode: 0o600 }) : null;
      res.on('data', (c) => {
        got += c.length;
        if (got > maxBytes) { req.destroy(new Error('The download is bigger than expected.')); return; }
        if (out) out.write(c); else chunks.push(c);
      });
      res.on('end', () => {
        if (out) out.end(() => resolve({ bytes: got })); else resolve({ body: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('GitHub did not answer in time.')));
    req.on('error', reject);
  });
}

function plainError(e) {
  const m = String((e && e.message) || e);
  if (e && e.code === 404) return 'No releases were found yet.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|did not answer/i.test(m + ' ' + (e && e.code))) return 'Could not reach GitHub. Check the internet connection.';
  return m.slice(0, 160);
}

// What is the newest release, and is it newer than what is running?
async function checkLatest({ repo = UPDATE_REPO, current, apiBase = 'https://api.github.com' }) {
  if (!repoReady(repo)) return { ok: false, notConfigured: true, error: 'Update checks are not set up for this copy yet.' };
  if (!isVersion(current)) return { ok: false, error: 'Could not read the running version.' };
  try {
    let r;
    try { r = await get(apiBase + '/repos/' + repo + '/releases/latest', { maxBytes: MAX_JSON, accept: 'application/vnd.github+json' }); }
    catch (e) {
      // no release published: look for update files placed in the repository's "updates" folder instead
      if (!(e && e.code === 404)) throw e;
      const f = await folderLatest({ repo, current, apiBase });
      if (f) return f;
      return { ok: false, error: 'No update was found. Put the update file in a GitHub Release, or in the "updates" folder of a public repository.' };
    }
    let j; try { j = JSON.parse(r.body.toString('utf8')); } catch (e) { return { ok: false, error: 'GitHub sent something unexpected.' }; }
    const tag = String(j && j.tag_name || '').replace(/^v/i, '');
    if (!isVersion(tag)) return { ok: false, error: 'The latest release has no usable version number.' };
    if (j.draft === true || j.prerelease === true) return { ok: true, available: false, current, latest: tag };
    if (compare(tag, current) <= 0) return { ok: true, available: false, current, latest: tag };
    const assets = (Array.isArray(j.assets) ? j.assets : []).filter((a) => a && typeof a.browser_download_url === 'string' && allowedUrl(a.browser_download_url));
    let asset = assets.find((a) => ASSET_RE.test(String(a.name)) && ASSET_RE.exec(a.name)[1] === tag);
    // GitHub sometimes renames uploads (spaces, brackets) or people add a suffix: accept any single ".hubupdate" file on the release, saved under the proper name
    if (!asset) {
      const loose = assets.filter((a) => /\.hubupdate$/i.test(String(a.name)) && !ASSET_RE.test(String(a.name)));
      if (loose.length === 1) asset = Object.assign({}, loose[0], { name: 'Dashboard-Hub-update-' + tag + '.hubupdate' });
    }
    // still nothing: maybe the file was put in the repository's "updates" folder instead
    if (!asset) {
      try { const f = await folderLatest({ repo, current, apiBase }); if (f && f.available && compare(f.latest, tag) >= 0) return f; } catch (e) { /* keep going with the release page */ }
    }
    // a newer release exists, but with no update file attached: tell the person where to get it
    const page = typeof j.html_url === 'string' && allowedUrl(j.html_url) ? j.html_url : 'https://github.com/' + repo + '/releases';
    return { ok: true, available: true, current, latest: tag, notes: String(j.body || '').slice(0, 1500), assetName: asset ? asset.name : null, assetUrl: asset ? asset.browser_download_url : null, page };
  } catch (e) { return { ok: false, error: plainError(e) }; }
}

// Fallback: update files uploaded straight into the repository's "updates" folder (no Release needed).
async function folderLatest({ repo, current, apiBase }) {
  let list;
  try {
    const r = await get(apiBase + '/repos/' + repo + '/contents/updates', { maxBytes: MAX_JSON, accept: 'application/vnd.github+json' });
    list = JSON.parse(r.body.toString('utf8'));
  } catch (e) { if (e && e.code === 404) return null; throw e; }
  if (!Array.isArray(list)) return null;
  let best = null;
  for (const f of list) {
    const m = f && f.type === 'file' && typeof f.name === 'string' && ASSET_RE.exec(f.name);
    if (!m || typeof f.download_url !== 'string' || !allowedUrl(f.download_url)) continue;
    if (!best || compare(m[1], best.v) > 0) best = { v: m[1], name: f.name, url: f.download_url };
  }
  if (!best) return null;
  if (compare(best.v, current) <= 0) return { ok: true, available: false, current, latest: best.v };
  return { ok: true, available: true, current, latest: best.v, notes: '', assetName: best.name, assetUrl: best.url, page: 'https://github.com/' + repo + '/tree/main/updates' };
}

// Downloads the update file into dir (the app's own downloads folder). Returns just the file name.
async function download({ url, name, dir }) {
  if (!ASSET_RE.test(String(name))) return { ok: false, error: 'That is not an update file.' };
  if (!allowedUrl(url)) return { ok: false, error: 'Refusing to download from that address.' };
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // clear older leftovers
    for (const f of fs.readdirSync(dir)) if (/\.hubupdate(\.part)?$/.test(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch (e) { /* ignore */ } }
    const part = path.join(dir, name + '.part');
    await get(url, { maxBytes: MAX_DOWNLOAD, toFile: part, timeoutMs: 30000 });
    // it must at least look like an update file before it is kept
    const head = fs.readFileSync(part, 'utf8').slice(0, 400);
    if (!/"app"\s*:\s*"dashboard-hub"/.test(head) && !/"format"\s*:\s*1/.test(head)) { fs.rmSync(part, { force: true }); return { ok: false, error: 'The downloaded file is not a Dashboard Hub update.' }; }
    fs.renameSync(part, path.join(dir, name));
    return { ok: true, name: name, file: path.join(dir, name) };
  } catch (e) {
    try { fs.rmSync(path.join(dir, name + '.part'), { force: true }); } catch (e2) { /* ignore */ }
    return { ok: false, error: plainError(e) };
  }
}

// ---- the person's choices: asked yet? checking on? which version skipped? remind me later until when? ----
function defaults() { return { asked: false, enabled: false, skipped: '', snoozeUntil: 0 }; }
function loadPrefs(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Object.assign(defaults(), { asked: j.asked === true, enabled: j.enabled === true, skipped: isVersion(j.skipped) ? j.skipped : '', snoozeUntil: Number.isFinite(j.snoozeUntil) ? j.snoozeUntil : 0 }); }
  catch (e) { return defaults(); }
}
function savePrefs(file, p) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ asked: p.asked === true, enabled: p.enabled === true, skipped: isVersion(p.skipped) ? p.skipped : '', snoozeUntil: Number(p.snoozeUntil) || 0 }));
  fs.renameSync(tmp, file);
}
// Should the banner be shown for this result right now?
function shouldOffer(result, prefs, now) {
  if (!result || !result.ok || !result.available) return false;
  if (prefs.skipped && prefs.skipped === result.latest) return false;
  if (prefs.snoozeUntil && now < prefs.snoozeUntil) return false;
  return true;
}

// What the web page may see: the result without the download address.
function publicResult(r) { const o = Object.assign({}, r || {}); delete o.assetUrl; return o; }

module.exports = { publicResult, UPDATE_REPO, repoReady, checkLatest, download, loadPrefs, savePrefs, shouldOffer, compare, allowedUrl, ASSET_RE };
