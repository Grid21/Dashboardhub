'use strict';
// Remote view: the list of remote-control devices (PiKVM, JetKVM, other web KVMs, NoMachine) and the pieces that need no window.
// - PiKVM / JetKVM / "other web KVM": their own web page is shown inside the Remote view window.
// - NoMachine: its protocol is private, so the NoMachine program you installed is started with the connection filled in.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  pikvm: { label: 'PiKVM', scheme: 'https', port: 443 },
  jetkvm: { label: 'JetKVM', scheme: 'http', port: 80 },
  web: { label: 'Other web KVM or page', scheme: 'https', port: 443 },
  nomachine: { label: 'NoMachine', port: 4000 }
};
const MAX = 100;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const V6_RE = /^[0-9A-Fa-f:]{2,45}$/;

function cleanDevice(d, old) {
  d = d || {};
  const type = String(d.type || '');
  if (!TYPES[type]) return { error: 'Choose what kind of device this is.' };
  const name = String(d.name == null ? '' : d.name).trim().slice(0, 60);
  if (!name) return { error: 'Give it a name, for example "Rack PiKVM".' };
  let raw = String(d.host == null ? '' : d.host).trim();
  let scheme = TYPES[type].scheme || '';
  let port = d.port === '' || d.port == null ? 0 : parseInt(d.port, 10);
  // a full web address pasted in is taken apart
  const m = /^(https?):\/\/([^\/?#]+)/i.exec(raw);
  if (m && type !== 'nomachine') {
    scheme = m[1].toLowerCase(); raw = m[2];
    const pm = /^(.*):(\d{1,5})$/.exec(raw);
    if (pm && !/^\[?[0-9A-Fa-f:]*\]?$/.test(raw) || (pm && /^\[.*\]:\d+$/.test(raw))) { raw = pm[1]; if (!port) port = parseInt(pm[2], 10); }
  }
  raw = raw.replace(/^\[|\]$/g, '');
  const hostOk = HOST_RE.test(raw) || (raw.includes(':') && V6_RE.test(raw));
  if (!raw || !hostOk) return { error: 'The address must be a name or IP address such as 192.168.0.50 (no spaces or slashes).' };
  if (port && (!(port >= 1 && port <= 65535))) return { error: 'The port must be a number from 1 to 65535.' };
  const out = { id: old && old.id || String(d.id || '').replace(/[^a-z0-9]/g, '').slice(0, 12) || crypto.randomBytes(5).toString('hex'), name, type, host: raw.toLowerCase(), port: port || 0 };
  if (scheme) out.scheme = scheme;
  if (type === 'nomachine') {
    const user = String(d.user == null ? '' : d.user).trim();
    if (user && !/^[A-Za-z0-9._@\\-]{1,64}$/.test(user)) return { error: 'The user name can only have letters, numbers and . _ - @ \\' };
    out.user = user;
  }
  return { device: out };
}
function cleanList(list) {
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).slice(0, MAX).forEach((d) => {
    const c = cleanDevice(d, d && /^[a-z0-9]{3,12}$/.test(String(d.id || '')) ? { id: d.id } : null);
    if (c.device && !seen.has(c.device.id)) { seen.add(c.device.id); out.push(c.device); }
  });
  return out;
}
function defaultPort(dev) { return dev.port || (dev.type === 'nomachine' ? TYPES.nomachine.port : dev.scheme === 'http' ? 80 : 443); }
function webUrl(dev) {
  if (!dev || dev.type === 'nomachine') return '';
  const h = dev.host.includes(':') ? '[' + dev.host + ']' : dev.host;
  const def = dev.scheme === 'http' ? 80 : 443;
  const p = dev.port && dev.port !== def ? ':' + dev.port : '';
  return dev.scheme + '://' + h + p + '/';
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function nxsText(dev) {
  const L = ['<!DOCTYPE NXClientSettings>', '<NXClientSettings application="nxclient" version="2.0">', ' <group name="General">',
    '  <option key="Connection service" value="nx" />', '  <option key="Server host" value="' + esc(dev.host) + '" />', '  <option key="Server port" value="' + defaultPort(dev) + '" />', ' </group>'];
  if (dev.user) L.push(' <group name="Login">', '  <option key="User" value="' + esc(dev.user) + '" />', ' </group>');
  L.push('</NXClientSettings>', '');
  return L.join('\n');
}
function nxCandidates(platform, env) {
  env = env || {};
  const L = [];
  if (env.NXPLAYER_PATH) L.push(env.NXPLAYER_PATH);
  if (platform === 'win32') {
    [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean).forEach((b) => L.push(b + '\\NoMachine\\bin\\nxplayer.exe'));
  } else if (platform === 'darwin') {
    L.push('/Applications/NoMachine.app/Contents/Frameworks/bin/nxplayer');
  } else {
    L.push('/usr/NX/bin/nxplayer', '/usr/NX/scripts/nxplayer', '/usr/bin/nxplayer');
  }
  return L.filter((x, i) => L.indexOf(x) === i);
}
function findNxplayer(platform, env, exists) {
  for (const c of nxCandidates(platform, env)) { try { if (exists(c)) return c; } catch (e) { /* next */ } }
  return '';
}
// writes the connection file and starts NoMachine with it; nothing is run through a shell
function launchNx(dev, o) {
  return new Promise((resolve) => {
    if (!dev || dev.type !== 'nomachine') { resolve({ ok: false, error: 'That is not a NoMachine device.' }); return; }
    const exe = findNxplayer(o.platform, o.env, o.exists || fs.existsSync);
    if (!exe) { resolve({ ok: false, notInstalled: true, error: 'NoMachine is not installed on this computer (or Dashboard Hub cannot find it).' }); return; }
    let file;
    try { fs.mkdirSync(o.dir, { recursive: true }); file = path.join(o.dir, dev.id + '.nxs'); fs.writeFileSync(file, nxsText(dev), { mode: 0o600 }); } catch (e) { resolve({ ok: false, error: 'The connection file could not be written.' }); return; }
    let done = false; const fin = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      const child = o.spawn(exe, ['--session', file], { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (e) => fin({ ok: false, error: 'NoMachine could not be started: ' + (e && e.code || 'error') }));
      child.once('spawn', () => { try { child.unref(); } catch (e) { /* fine */ } fin({ ok: true, program: exe }); });
      setTimeout(() => fin({ ok: true, program: exe }), 1500);
    } catch (e) { fin({ ok: false, error: 'NoMachine could not be started.' }); }
  });
}

function load(file) { try { return cleanList(JSON.parse(fs.readFileSync(file, 'utf8')).devices); } catch (e) { return []; } }
function save(file, list) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ devices: list }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}


// ---------- Phone and browser access: a small read-only web page served by Dashboard Hub ----------
// Off by default. When on, any browser that can reach this computer (phone over your VPN, another desktop) can sign in with an access code
// and look at the panel list, the network map, the device list and Uptime and history. Nothing on it can change anything.
const http = require('http');
const os = require('os');
const WEB_DEFAULT_PORT = 8787;

function webClean(c) {
  c = c && typeof c === 'object' ? c : {};
  const port = parseInt(c.port, 10);
  return {
    on: c.on === true,
    port: port >= 1024 && port <= 65535 ? port : WEB_DEFAULT_PORT,
    salt: typeof c.salt === 'string' && /^[0-9a-f]{32}$/.test(c.salt) ? c.salt : '',
    hash: typeof c.hash === 'string' && /^[0-9a-f]{64}$/.test(c.hash) ? c.hash : ''
  };
}
function webUrls(port) {
  const out = [];
  try {
    const nics = os.networkInterfaces();
    Object.keys(nics).forEach((n) => (nics[n] || []).forEach((a) => {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name: n, url: 'http://' + a.address + ':' + port + '/' });
    }));
  } catch (e) { /* none */ }
  return out;
}

function createWebAccess(o) {
  const file = o.file;
  let cfg = webClean(null);
  try { cfg = webClean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first time */ }
  let server = null, error = '', lastLogin = 0;
  const sessions = new Map();           // token -> expiry time
  const fails = new Map();              // ip -> { n, first, until }
  let globalFails = { n: 0, first: 0, until: 0 };
  const SESSION_MS = 12 * 3600000, MAX_SESSIONS = 50;

  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) { /* kept in memory for this run */ }
  }
  const hashOf = (pin, salt) => crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32).toString('hex');
  function pinOk(pin) {
    if (!cfg.hash) return false;
    const a = Buffer.from(hashOf(pin, cfg.salt), 'hex'), b = Buffer.from(cfg.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  function prune() { const now = Date.now(); sessions.forEach((exp, t) => { if (exp < now) sessions.delete(t); }); }
  function lockLeft(ip) {
    const now = Date.now(), f = fails.get(ip);
    if (globalFails.until > now) return globalFails.until - now;
    return f && f.until > now ? f.until - now : 0;
  }
  function noteFail(ip) {
    const now = Date.now();
    let f = fails.get(ip);
    if (!f || now - f.first > 600000) f = { n: 0, first: now, until: 0 };
    f.n++; if (f.n >= 5) f.until = now + 600000;
    fails.set(ip, f);
    if (fails.size > 500) fails.clear();
    if (now - globalFails.first > 3600000) globalFails = { n: 0, first: now, until: 0 };
    globalFails.n++; if (globalFails.n >= 60) globalFails.until = now + 900000;
  }
  function cookieOf(req) { const m = /(?:^|;\s*)dh_sid=([0-9a-f]{64})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; }
  function authed(req) { const t = cookieOf(req); const exp = t && sessions.get(t); return !!exp && exp > Date.now(); }

  function send(res, code, type, body, extra) {
    const h = Object.assign({
      'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    }, extra || {});
    res.writeHead(code, h); res.end(body);
  }
  const json = (res, code, obj, extra) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj), extra);

  function handle(req, res) {
    let url; try { url = new URL(req.url, 'http://x'); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
    const p = url.pathname, ip = String(req.socket.remoteAddress || '');
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', WEB_HTML);
    if (req.method === 'GET' && p === '/app.js') return send(res, 200, 'text/javascript; charset=utf-8', WEB_JS);
    if (req.method === 'GET' && p === '/app.css') return send(res, 200, 'text/css; charset=utf-8', WEB_CSS);
    if (req.method === 'GET' && p === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
    if (p === '/api/login') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      const wait = lockLeft(ip);
      if (wait) return json(res, 429, { error: 'Too many wrong codes. Try again in ' + Math.ceil(wait / 60000) + ' minute(s).' });
      let body = '', over = false;
      req.on('data', (c) => { body += c; if (body.length > 2048) { over = true; req.destroy(); } });
      req.on('end', () => {
        if (over) return;
        let pin = ''; try { pin = String(JSON.parse(body).code || ''); } catch (e) { /* empty */ }
        if (pin && pin.length <= 200 && pinOk(pin)) {
          prune(); if (sessions.size >= MAX_SESSIONS) sessions.clear();
          const t = crypto.randomBytes(32).toString('hex');
          sessions.set(t, Date.now() + SESSION_MS); lastLogin = Date.now();
          fails.delete(ip);
          return json(res, 200, { ok: true }, { 'Set-Cookie': 'dh_sid=' + t + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_MS / 1000) });
        }
        noteFail(ip);
        return json(res, 401, { error: 'That access code is not right.' });
      });
      return;
    }
    if (p === '/api/logout' && req.method === 'POST') { const t = cookieOf(req); if (t) sessions.delete(t); return json(res, 200, { ok: true }, { 'Set-Cookie': 'dh_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
    if (!p.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    // Actions exist only where the program that owns this server hands them over (the Docker version); the desktop page is view only.
    const am = /^\/api\/action\/([a-z][a-z-]{0,30})$/.exec(p);
    if (am && req.method === 'POST' && o.actions && Object.prototype.hasOwnProperty.call(o.actions, am[1])) {
      if (!authed(req)) return json(res, 401, { error: 'Sign in first', login: true });
      if (req.headers['x-dashboard-hub'] !== '1') return json(res, 403, { error: 'Not allowed' });      // a web page on another site cannot send this header
      let abody = '', aover = false;
      req.on('data', (c) => { abody += c; if (abody.length > 65536) { aover = true; req.destroy(); } });
      req.on('end', () => {
        if (aover) return;
        let args = {}; try { args = abody ? JSON.parse(abody) : {}; } catch (e) { return json(res, 400, { ok: false, error: 'Bad request' }); }
        Promise.resolve().then(() => o.actions[am[1]](args && typeof args === 'object' ? args : {})).then((r) => json(res, 200, Object.assign({ ok: true }, r && typeof r === 'object' ? r : {})), (e) => json(res, 500, { ok: false, error: String(e && e.message || 'Failed').slice(0, 200) }));
      });
      return;
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Read only' });
    if (!authed(req)) return json(res, 401, { error: 'Sign in first', login: true });
    if (p === '/api/config') { let c = null; try { c = o.getConfig ? o.getConfig() : null; } catch (e) { c = null; } return c ? json(res, 200, Object.assign({ ok: true }, c)) : json(res, 404, { error: 'Not found' }); }
    if (p === '/api/info') { let i = null; try { i = o.getInfo ? o.getInfo() : null; } catch (e) { i = null; } return json(res, 200, Object.assign({ ok: true, mode: 'desktop', version: o.version || '' }, i || {})); }
    if (p === '/api/state') {
      let s = null; try { s = o.getSnapshot(); } catch (e) { s = null; }
      return json(res, 200, { ok: true, now: Date.now(), version: o.version || '', snapshot: s });
    }
    if (p === '/api/uptime') {
      const days = Math.min(90, Math.max(1, parseFloat(url.searchParams.get('days')) || 1));
      const min = Math.min(60, Math.max(0, parseFloat(url.searchParams.get('min')) || 0));
      let r = null; try { r = o.getUptime(days * 86400000, min * 60000); } catch (e) { r = null; }
      return json(res, 200, r || { ok: true, empty: true, now: Date.now() });
    }
    return json(res, 404, { error: 'Not found' });
  }

  function status() {
    prune();
    return { on: !!server, wanted: cfg.on, port: cfg.port, hasCode: !!cfg.hash, urls: server ? webUrls(cfg.port) : [], error: error, signedIn: sessions.size, lastLogin: lastLogin };
  }
  function start() {
    return new Promise((resolve) => {
      if (server) return resolve(status());
      if (!cfg.hash) { error = 'Choose an access code first.'; return resolve(status()); }
      const s = http.createServer(handle);
      s.headersTimeout = 10000; s.requestTimeout = 15000; s.keepAliveTimeout = 5000; s.maxHeadersCount = 50;
      s.once('error', (e) => { error = e && e.code === 'EADDRINUSE' ? 'Port ' + cfg.port + ' is already used by another program. Choose another port.' : 'The phone and browser page could not start (' + (e && e.code || 'error') + ').'; try { s.close(); } catch (x) { /* closed */ } server = null; resolve(status()); });
      s.listen(cfg.port, '0.0.0.0', () => { server = s; error = ''; s.removeAllListeners('error'); s.on('error', () => {}); resolve(status()); });
    });
  }
  function stop() {
    return new Promise((resolve) => {
      sessions.clear();
      if (!server) return resolve(status());
      const s = server; server = null;
      try { s.closeAllConnections(); } catch (e) { /* older */ }
      s.close(() => resolve(status()));
      setTimeout(() => resolve(status()), 500);
    });
  }
  return {
    status,
    start, stop,
    async setOn(on) { cfg.on = on === true; persist(); error = ''; return on === true ? start() : stop(); },
    async setPort(port) {
      const n = parseInt(port, 10);
      if (!(n >= 1024 && n <= 65535)) return { ok: false, error: 'Choose a port between 1024 and 65535.' };
      cfg.port = n; persist();
      if (server) { await stop(); await start(); }
      return Object.assign({ ok: true }, status());
    },
    setCode(code) {
      code = String(code == null ? '' : code);
      if (code.length < 6) return { ok: false, error: 'The access code needs at least 6 characters.' };
      if (code.length > 64) return { ok: false, error: 'The access code can be at most 64 characters.' };
      cfg.salt = crypto.randomBytes(16).toString('hex'); cfg.hash = hashOf(code, cfg.salt); persist(); sessions.clear();
      return Object.assign({ ok: true }, status());
    },
    signOutAll() { sessions.clear(); return status(); },
    autoStart() { return cfg.on && cfg.hash ? start() : Promise.resolve(status()); }
  };
}


// ---------- Remote servers: Dashboard Hub Desktop looks after Dashboard Hub servers (the Docker version) ----------
// The list is kept by the main program (the access codes are encrypted with the computer's login where possible).
function hubUrl(text) {
  let u; try { u = new URL(String(text || '').trim()); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) return null;
  return u.origin;
}
function createRemoteHubs(o) {
  const cookies = new Map();          // id -> { value, at }
  let list = null;
  const load = () => { if (!list) { let l = []; try { l = o.read(); } catch (e) { l = []; } list = (Array.isArray(l) ? l : []).slice(0, 50).filter((h) => h && h.id && hubUrl(h.url)).map((h) => ({ id: String(h.id).slice(0, 40), name: String(h.name || '').slice(0, 60), url: hubUrl(h.url), code: String(h.code || '').slice(0, 64) })); } return list; };
  const persist = () => { try { return o.write(load()); } catch (e) { return false; } };
  const find = (id) => load().find((h) => h.id === id) || null;
  function request(h, method, p, body, cookie, extra) {
    return new Promise((resolve) => {
      let u; try { u = new URL(p, h.url); } catch (e) { return resolve({ code: 0, error: 'Bad address' }); }
      const lib = u.protocol === 'https:' ? require('https') : http;
      const data = body ? JSON.stringify(body) : '';
      const headers = Object.assign({ Accept: 'application/json' }, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, cookie ? { Cookie: 'dh_sid=' + cookie } : {}, extra || {});
      const r = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method, headers: headers, timeout: 8000 }, (res) => {
        let b = ''; res.on('data', (c) => { if (b.length < 4000000) b += c; });
        res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* not json */ } resolve({ code: res.statusCode, json: j, setCookie: res.headers['set-cookie'] || [] }); });
      });
      r.on('timeout', () => { r.destroy(); resolve({ code: 0, error: 'timeout' }); });
      r.on('error', (e) => resolve({ code: 0, error: e && e.code || 'error' }));
      if (data) r.write(data); r.end();
    });
  }
  function why(r) {
    if (r.code === 0) return r.error === 'timeout' ? 'It did not answer in time. Is the container running and is the address right?' : r.error === 'ECONNREFUSED' ? 'Nothing is listening at that address and port.' : r.error === 'ENOTFOUND' ? 'That name could not be found.' : 'It could not be reached (' + r.error + ').';
    if (r.code === 429) return (r.json && r.json.error) || 'Too many wrong codes. Try again in a few minutes.';
    if (r.code === 401) return 'The access code is not right.';
    return 'It answered with an unexpected reply (' + r.code + '). Is this a Dashboard Hub server?';
  }
  async function session(h, fresh) {
    const c = cookies.get(h.id);
    if (!fresh && c && Date.now() - c.at < 10 * 60000) return { ok: true, cookie: c.value };
    const r = await request(h, 'POST', '/api/login', { code: h.code });
    if (r.code !== 200 || !r.json || !r.json.ok) return { ok: false, error: why(r) };
    const m = /dh_sid=([0-9a-f]{64})/.exec((r.setCookie || []).join(';'));
    if (!m) return { ok: false, error: 'It did not give a sign-in.' };
    cookies.set(h.id, { value: m[1], at: Date.now() });
    return { ok: true, cookie: m[1] };
  }
  async function authed(h, method, p, extra) {
    let s = await session(h, false); if (!s.ok) return s;
    let r = await request(h, method, p, null, s.cookie, extra);
    if (r.code === 401) { s = await session(h, true); if (!s.ok) return s; r = await request(h, method, p, null, s.cookie, extra); }
    if (r.code === 200 && r.json) return { ok: true, json: r.json, cookie: s.cookie };
    return { ok: false, error: why(r) };
  }
  const pub = (h) => ({ id: h.id, name: h.name, url: h.url, hasCode: !!h.code });
  return {
    list: () => load().map(pub),
    save(x) {
      x = x || {};
      const url = hubUrl(x.url); if (!url) return { ok: false, error: 'Type the address like http://192.168.1.50:8787' };
      const name = String(x.name || '').trim().slice(0, 60) || url;
      let h = x.id ? find(String(x.id)) : null;
      const code = String(x.code == null ? '' : x.code);
      if (!h) { if (load().length >= 50) return { ok: false, error: 'That is the most servers that can be saved.' }; if (code.length < 6) return { ok: false, error: 'Type the access code of that server.' }; h = { id: crypto.randomBytes(8).toString('hex'), name, url, code }; load().push(h); }
      else { h.name = name; h.url = url; if (code) h.code = code.slice(0, 64); cookies.delete(h.id); }
      const kept = persist();
      return { ok: true, id: h.id, kept: kept !== false, list: load().map(pub) };
    },
    remove(id) { list = load().filter((h) => h.id !== id); cookies.delete(id); persist(); return { ok: true, list: list.map(pub) }; },
    async status(id) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const r = await authed(h, 'GET', '/api/info'); if (!r.ok) return r;
      return { ok: true, info: r.json };
    },
    async scan(id) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const s = await session(h, false); if (!s.ok) return s;
      let r = await request(h, 'POST', '/api/action/scan', {}, s.cookie, { 'X-Dashboard-Hub': '1' });
      if (r.code === 401) { const s2 = await session(h, true); if (!s2.ok) return s2; r = await request(h, 'POST', '/api/action/scan', {}, s2.cookie, { 'X-Dashboard-Hub': '1' }); }
      if (r.code === 200 && r.json) return { ok: true, started: r.json.started !== false, message: r.json.message || '' };
      if (r.code === 404 || r.code === 405) return { ok: false, error: 'That server cannot be told to scan. Is it the Docker version?' };
      return { ok: false, error: why(r) };
    },
    async getConfig(id) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const r = await authed(h, 'GET', '/api/config');
      if (!r.ok) return r.error && /unexpected reply \(404\)/.test(r.error) ? { ok: false, error: 'That server has no settings to edit. Is it the Docker version (1.28 or newer)?' } : r;
      return { ok: true, config: r.json };
    },
    async setConfig(id, cfg) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const doIt = async (cookie) => request(h, 'POST', '/api/action/config', cfg && typeof cfg === 'object' ? cfg : {}, cookie, { 'X-Dashboard-Hub': '1' });
      let s = await session(h, false); if (!s.ok) return s;
      let r = await doIt(s.cookie);
      if (r.code === 401) { s = await session(h, true); if (!s.ok) return s; r = await doIt(s.cookie); }
      if (r.code === 200 && r.json) return r.json;
      if (r.code === 404 || r.code === 405) return { ok: false, error: 'That server cannot change its settings. Update it to the newest Docker version first.' };
      return r.json && r.json.error ? { ok: false, error: r.json.error } : { ok: false, error: why(r) };
    },
    async devices(id, args) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const doIt = async (cookie) => request(h, 'POST', '/api/action/devices', args && typeof args === 'object' ? args : {}, cookie, { 'X-Dashboard-Hub': '1' });
      let s = await session(h, false); if (!s.ok) return s;
      let r = await doIt(s.cookie);
      if (r.code === 401) { s = await session(h, true); if (!s.ok) return s; r = await doIt(s.cookie); }
      if (r.code === 200 && r.json) return r.json;
      if (r.code === 404 || r.code === 405) return { ok: false, error: 'That server cannot edit devices yet. Update it to the newest Docker version first.' };
      return r.json && r.json.error ? { ok: false, error: r.json.error } : { ok: false, error: why(r) };
    },
    async alertTest(id, alerts) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const doIt = async (cookie) => request(h, 'POST', '/api/action/alerttest', { alerts: alerts && typeof alerts === 'object' ? alerts : {} }, cookie, { 'X-Dashboard-Hub': '1' });
      let s = await session(h, false); if (!s.ok) return s;
      let r = await doIt(s.cookie);
      if (r.code === 401) { s = await session(h, true); if (!s.ok) return s; r = await doIt(s.cookie); }
      if (r.code === 200 && r.json) return r.json;
      if (r.code === 404 || r.code === 405) return { ok: false, error: 'That server cannot send alerts yet. Update it to the newest Docker version first.' };
      return r.json && r.json.error ? { ok: false, error: r.json.error } : { ok: false, error: why(r) };
    },
    async update(id, apply) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const doIt = async (cookie) => request(h, 'POST', '/api/action/update', { apply: apply !== false }, cookie, { 'X-Dashboard-Hub': '1' });
      let s = await session(h, false); if (!s.ok) return s;
      let r = await doIt(s.cookie);
      if (r.code === 401) { s = await session(h, true); if (!s.ok) return s; r = await doIt(s.cookie); }
      if (r.code === 200 && r.json) return r.json;
      if (r.code === 404 || r.code === 405) return { ok: false, error: 'That server cannot update itself yet. Rebuild it once from the newest Docker bundle.' };
      return r.json && r.json.error ? { ok: false, error: r.json.error } : { ok: false, error: why(r) };
    },
    async openInfo(id) {
      const h = find(id); if (!h) return { ok: false, error: 'Not found' };
      const s = await session(h, true); if (!s.ok) return s;
      return { ok: true, url: h.url, cookie: s.cookie, name: h.name };
    }
  };
}

// What the renderer shares for the web page is cut down to plain, bounded text first.
function webCleanSnapshot(s) {
  if (!s || typeof s !== 'object') return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
  const out = { at: Date.now(), profile: { id: str(s.profile && s.profile.id, 80), name: str(s.profile && s.profile.name, 80) }, panels: [], devices: [], links: [] };
  (Array.isArray(s.panels) ? s.panels : []).slice(0, 200).forEach((p) => {
    const url = str(p && p.url, 2000);
    if (/^https?:\/\/[^\s]+$/i.test(url)) out.panels.push({ name: str(p.name, 80) || url, url: url });
  });
  (Array.isArray(s.devices) ? s.devices : []).slice(0, 1500).forEach((d) => {
    if (!d || typeof d !== 'object' || !d.key) return;
    out.devices.push({
      key: str(d.key, 80), name: str(d.name, 80), ip: str(d.ip, 45), mac: str(d.mac, 17), vendor: str(d.vendor, 60), os: str(d.os, 40), group: str(d.group, 30),
      online: d.online !== false, isRouter: d.isRouter === true, self: d.self === true, x: num(d.x), z: num(d.z),
      lastSeen: Number.isFinite(d.lastSeen) ? d.lastSeen : null, onlineSince: Number.isFinite(d.onlineSince) ? d.onlineSince : null,
      ports: (Array.isArray(d.ports) ? d.ports : []).slice(0, 16).filter((p) => p && Number.isInteger(p.port)).map((p) => ({ port: p.port, service: str(p.service, 30) }))
    });
  });
  (Array.isArray(s.links) ? s.links : []).slice(0, 4000).forEach((l) => { if (l && l.a && l.b) out.links.push({ a: str(l.a, 80), b: str(l.b, 80) }); });
  return out;
}

// The page served to phones and other browsers (plain HTML, CSS and JS; no outside libraries, nothing is loaded from the internet).
const WEB_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Dashboard Hub</title>
<link rel="stylesheet" href="/app.css">
</head><body>
<section id="login" class="login" hidden>
  <form id="loginForm" class="card" autocomplete="off">
    <h1>Dashboard Hub</h1>
    <p class="dim">Enter the access code you set in Dashboard Hub (Settings, Phone and browser access).</p>
    <input id="code" type="password" placeholder="Access code" autocomplete="current-password" required>
    <button type="submit" class="primary">Sign in</button>
    <p id="loginMsg" class="bad"></p>
  </form>
</section>
<section id="app" hidden>
  <header class="top">
    <div class="brand"><b>Dashboard Hub</b> <span id="profile" class="dim"></span></div>
    <div class="right"><span id="age" class="dim"></span> <button id="refresh" title="Refresh now">&#8635;</button> <button id="logout">Sign out</button></div>
  </header>
  <nav class="tabs">
    <button data-tab="panels" class="on">Panels</button><button data-tab="map">Map</button><button data-tab="devices">Devices</button><button data-tab="uptime">Uptime</button><button data-tab="settings" id="setTab" hidden>Settings</button>
  </nav>
  <main>
    <div id="note" class="note" hidden></div>
    <div id="t-panels"></div>
    <div id="t-map" hidden>
      <div class="mapbar"><span id="mapStat" class="dim"></span><span><button id="mode3" title="Switch between the flat map and the 3D view">3D</button> <button id="resetPos" title="Put the dots back where they were placed automatically">Reset</button> <button id="fit">Fit</button></span></div>
      <canvas id="map"></canvas>
      <div id="mapDetail" class="card" hidden></div>
    </div>
    <div id="t-devices" hidden>
      <div class="bar"><input id="q" type="search" placeholder="Search name, address, maker"><span id="chips"><button data-f="all" class="on">All</button><button data-f="on">Online</button><button data-f="off">Offline</button></span></div>
      <div id="devList"></div>
    </div>
    <div id="t-settings" hidden></div>
    <div id="t-uptime" hidden>
      <div class="bar"><select id="range"><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
      <label class="chk"><input id="brief" type="checkbox"> show very short drops</label></div>
      <p id="upSum" class="dim"></p>
      <div id="upLines"></div>
      <div id="upDev"></div>
    </div>
  </main>
</section>
<script src="/app.js"></script>
</body></html>`;

const WEB_CSS = String.raw`:root{--bg:#14171c;--panel:#1b2027;--line:#2b323c;--text:#e6e9ee;--dim:#9aa4b2;--accent:#3b82f6;--good:#34d399;--bad:#f87171;--raise:#232a33;color-scheme:light dark}
@media (prefers-color-scheme:light){:root{--bg:#eef1f6;--panel:#fff;--line:#d5dae3;--text:#1a202c;--dim:#4a5568;--accent:#2563eb;--good:#059669;--bad:#dc2626;--raise:#eef1f6}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-text-size-adjust:100%}
[hidden]{display:none!important}
.dim{color:var(--dim)}.bad{color:var(--bad)}.good{color:var(--good)}
button,select,input{font:inherit;color:inherit;background:var(--raise);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
button{cursor:pointer;min-height:40px}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}.login .card{width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px}.login h1{margin:0;font-size:22px}.login p{margin:0}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap;position:sticky;top:0;z-index:5}
.top .right{display:flex;gap:8px;align-items:center;font-size:13px}
.tabs{display:flex;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:var(--hh,57px);z-index:4}
.tabs button{flex:1;border:0;border-radius:0;background:transparent;padding:12px 4px;border-bottom:3px solid transparent}
.tabs button.on{border-bottom-color:var(--accent);font-weight:600}
main{padding:14px;max-width:1100px;margin:0 auto}
.note{background:var(--raise);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
a.tile{display:block;text-decoration:none;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
a.tile:active,a.tile:hover{border-color:var(--accent)}a.tile b{display:block;font-size:17px}a.tile span{color:var(--dim);font-size:13px;word-break:break-all}
canvas#map{width:100%;height:62vh;min-height:320px;background:var(--panel);border:1px solid var(--line);border-radius:12px;touch-action:none;display:block}
.mapbar,.bar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap}
.bar input[type=search]{flex:1;min-width:160px}#chips{display:flex;gap:6px}#chips button.on{background:var(--accent);border-color:var(--accent);color:#fff}
#mapDetail{margin-top:10px}
.dev{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:8px}
.dev>.h{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer}
.dot{width:12px;height:12px;border-radius:50%;flex:none;background:var(--good)}.dot.off{background:var(--bad)}
.dev .n{flex:1;min-width:0}.dev .n b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dev .n span{font-size:13px;color:var(--dim)}
.dev .d{padding:0 14px 12px 36px;font-size:14px;color:var(--dim)}.dev .d div{margin-top:2px}
.up-row{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:8px}
.up-row .t{display:flex;justify-content:space-between;gap:8px}.up-row .t span{color:var(--dim);font-size:13px;white-space:nowrap}
.bar2{position:relative;height:12px;border-radius:6px;background:var(--raise);overflow:hidden;margin-top:6px}
.seg{position:absolute;top:0;bottom:0;min-width:1px}.seg.up{background:var(--good)}.seg.down{background:var(--bad)}.seg.unknown{background:repeating-linear-gradient(45deg,#8a93a5,#8a93a5 3px,transparent 3px,transparent 6px)}
.line{padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.chk{font-size:14px;display:flex;gap:6px;align-items:center}.chk input{padding:0;width:auto}
h2{font-size:16px;margin:16px 0 8px}
.sl{display:block;margin-top:10px}.sl span{display:block;font-size:13px;margin-bottom:4px}.sl select,#t-settings input{width:100%}
.prow{display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--line)}
`;

const WEB_JS = String.raw`(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var S = { tab: 'panels', snap: null, filter: 'all', q: '', sel: null, view: null, openDev: {}, timer: null, lastUp: null };
function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
function api(p, opt) {
  opt = opt || {}; opt.credentials = 'same-origin';
  return fetch(p, opt).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}
function ago(ms) {
  var s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
function showLogin(msg) {
  $('app').hidden = true; $('login').hidden = false; $('loginMsg').textContent = msg || '';
  clearInterval(S.timer); S.timer = null;
}
function fixHeader() { var h = document.querySelector('.top'); if (h) document.documentElement.style.setProperty('--hh', h.offsetHeight + 'px'); }
window.addEventListener('resize', fixHeader);
function showApp() { fixHeader(); $('login').hidden = true; $('app').hidden = false; if (!S.timer) S.timer = setInterval(function () { if (!document.hidden) load(true); }, 15000); }

$('loginForm').addEventListener('submit', function (e) {
  e.preventDefault();
  api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) }).then(function (r) {
    if (r.ok) { $('code').value = ''; $('loginMsg').textContent = ''; load(); } else $('loginMsg').textContent = r.error || 'Could not sign in.';
  }).catch(function () { $('loginMsg').textContent = 'Could not reach Dashboard Hub.'; });
});
$('logout').addEventListener('click', function () { api('/api/logout', { method: 'POST' }).then(function () { showLogin(''); }); });
$('refresh').addEventListener('click', function () { load(); });

function load() {
  api('/api/state').then(function (r) {
    if (r._status === 401) { showLogin(''); return; }
    showApp();
    if (S.edit === undefined) { S.edit = false; api('/api/info').then(function (i) { if (i && i.editable === true) { S.edit = true; $('setTab').hidden = false; if (S.tab === 'devices') drawDevices(); } }).catch(function () {}); }
    if (S.dragging) return;
    S.now = r.now; S.snap = r.snapshot || null; S.fetched = Date.now();
    draw();
  }).catch(function () { $('note').hidden = false; $('note').textContent = 'Cannot reach Dashboard Hub right now. Is the computer on and the VPN connected?'; });
}

document.querySelectorAll('.tabs button').forEach(function (b) {
  b.addEventListener('click', function () {
    S.tab = b.getAttribute('data-tab'); S.setBuilt = false;
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    draw();
  });
});

function draw() {
  var s = S.snap;
  $('profile').textContent = s && s.profile ? s.profile.name : '';
  var note = $('note');
  if (!s) { note.hidden = false; note.textContent = 'Dashboard Hub has not shared anything yet. Open Dashboard Hub on the computer once.'; }
  else if (!s.devices.length && S.tab !== 'panels' && S.tab !== 'uptime' && S.tab !== 'settings') { note.hidden = false; note.textContent = 'No devices yet. On the computer, open Network Map and run a scan.'; }
  else note.hidden = true;
  $('age').textContent = s ? 'updated ' + ago(S.now - s.at) : '';
  ['panels', 'map', 'devices', 'uptime', 'settings'].forEach(function (t) { $('t-' + t).hidden = S.tab !== t; });
  if (S.tab === 'panels') drawPanels();
  else if (S.tab === 'map') drawMap();
  else if (S.tab === 'devices') drawDevices();
  else if (S.tab === 'settings') { if (!S.setBuilt) { S.setBuilt = true; drawSettings(); } }
  else loadUptime();
}

/* ---------- settings of the Docker version (name, network, router, scan time, panels, updates) ---------- */
function lab(text, node) { var l = el('label', 'sl'); l.appendChild(el('span', 'dim', text)); l.appendChild(node); return l; }
function drawSettings() {
  var box = $('t-settings'); box.textContent = ''; box.appendChild(el('p', 'dim', 'Loading...'));
  api('/api/config').then(function (r) {
    box.textContent = '';
    if (r._status === 401) { showLogin(''); return; }
    if (!r.config) { box.appendChild(el('p', 'bad', 'This server does not allow changing its settings from the page.')); return; }
    var c = r.config, det = r.detected || {}, card = el('div', 'card'), msg = el('p', 'dim');
    var name = field('Name', c.name, 80); name.style.marginTop = '0';
    var net = el('select'), netC = field('192.168.0.0/24', '', 18), rt = el('select'), rtC = field('192.168.0.1', '', 15), scan = el('select'), upd = el('select');
    function opt(sel, v, t) { var o = el('option', '', t); o.value = v; sel.appendChild(o); }
    opt(net, 'auto', 'Automatic' + (det.network ? ' (now ' + det.network + ')' : ''));
    (r.interfaces || []).forEach(function (i) { opt(net, i.cidr, i.cidr + ' (' + i.name + ')'); });
    opt(net, 'custom', 'I will type it');
    var known = Array.prototype.some.call(net.options, function (o) { return o.value === c.network; });
    net.value = known ? c.network : 'custom'; netC.hidden = net.value !== 'custom'; netC.value = known ? '' : c.network;
    net.addEventListener('change', function () { netC.hidden = net.value !== 'custom'; });
    opt(rt, 'auto', 'Automatic' + (det.router ? ' (found ' + det.router + ')' : '')); opt(rt, 'custom', 'I will type it');
    rt.value = c.router === 'auto' ? 'auto' : 'custom'; rtC.hidden = rt.value !== 'custom'; rtC.value = c.router === 'auto' ? '' : c.router;
    rt.addEventListener('change', function () { rtC.hidden = rt.value !== 'custom'; });
    [[60, 'every minute'], [300, 'every 5 minutes'], [900, 'every 15 minutes'], [3600, 'every hour'], [21600, 'every 6 hours'], [86400, 'once a day']].forEach(function (x) { opt(scan, String(x[0]), x[1]); });
    if (!Array.prototype.some.call(scan.options, function (o) { return o.value === String(c.scanSeconds); })) opt(scan, String(c.scanSeconds), 'every ' + c.scanSeconds + ' seconds');
    scan.value = String(c.scanSeconds);
    opt(upd, 'auto', 'Install new versions by itself'); opt(upd, 'check', 'Only tell me'); opt(upd, 'off', 'Off'); upd.value = c.update || 'auto';
    [lab('Name of this server', name), lab('Network to scan', net), netC, lab('Router', rt), rtC, lab('Scan', scan), lab('Updates', upd)].forEach(function (x) { card.appendChild(x); });
    var u = r.update, uh = el('p', 'dim'), ub = el('button', '', 'Check now');
    function updText(s) {
      if (!s) { uh.textContent = 'This server cannot update itself yet.'; ub.hidden = true; return; }
      var t = 'Running ' + s.version + '.';
      if (s.error) t += ' Last check: ' + s.error;
      else if (s.available && s.needsRebuild) t += ' Version ' + s.latest + ' is ready but needs a one-time rebuild of the container.';
      else if (s.available) t += ' Version ' + s.latest + ' is ready.';
      else if (s.latest) t += ' This is the newest version.';
      uh.textContent = t; var inst = s.available && s.canInstall && !s.needsRebuild; ub.textContent = inst ? 'Install ' + s.latest + ' now' : 'Check now'; ub.dataset.install = inst ? '1' : '';
    }
    updText(u);
    ub.addEventListener('click', function () {
      var inst = !!ub.dataset.install; uh.textContent = inst ? 'Installing...' : 'Checking...';
      act('update', { apply: inst }).then(function (x) {
        if (x.ok === false) { uh.textContent = x.error || 'Could not check.'; return; }
        if (x.updated) { uh.textContent = x.message + ' Reload this page in a minute.'; ub.hidden = true; return; }
        if (x.status) updText(x.status); if (x.message) uh.textContent += ' ' + x.message;
      }).catch(function () { uh.textContent = 'Could not reach the server.'; });
    });
    card.appendChild(uh); card.appendChild(ub);
    card.appendChild(el('h2', '', 'Alerts'));
    card.appendChild(el('p', 'dim', 'A message to your phone when something changes. Use a free ntfy topic (ntfy.sh), a Discord or Slack web hook, or any web address that accepts a POST.'));
    var al = c.alerts || {}, alUrl = field('https://ntfy.sh/your-secret-topic', al.url, 300), alFmt = el('select'), alRes = el('p', 'dim');
    alUrl.style.marginTop = '0';
    [['ntfy', 'ntfy (plain text)'], ['discord', 'Discord web hook'], ['slack', 'Slack web hook'], ['json', 'Other (JSON)']].forEach(function (x) { opt(alFmt, x[0], x[1]); }); alFmt.value = al.format || 'ntfy';
    function chk(text, on) { var l = el('label', 'chk'), i = el('input'); i.type = 'checkbox'; i.checked = !!on; l.style.marginTop = '8px'; l.appendChild(i); l.appendChild(document.createTextNode(text)); l.input = i; return l; }
    var cNew = chk('A new device appears', al.onNew), cLeft = chk('A device goes offline', al.onLeft), cBack = chk('A device comes back online', al.onBack);
    var alTest = el('button', '', 'Send a test message'); alTest.style.marginTop = '8px';
    function alertsNow() { return { url: alUrl.value.trim(), format: alFmt.value, onNew: cNew.input.checked, onLeft: cLeft.input.checked, onBack: cBack.input.checked }; }
    alTest.addEventListener('click', function () { alRes.className = 'dim'; alRes.textContent = 'Sending...'; act('alerttest', { alerts: alertsNow() }).then(function (x) { alRes.textContent = x.ok ? (x.message || 'Sent.') : (x.error || 'Not sent.'); alRes.className = x.ok ? 'good' : 'bad'; }).catch(function () { alRes.textContent = 'Could not reach the server.'; alRes.className = 'bad'; }); });
    [lab('Alert address (leave empty for no alerts)', alUrl), lab('Type', alFmt), cNew, cLeft, cBack, alTest, alRes].forEach(function (x) { card.appendChild(x); });
    card.appendChild(el('h2', '', 'Panels'));
    var pbox = el('div');
    function panelRow(p) {
      var row = el('div', 'prow'), pn = field('Name', p ? p.name : '', 40), pu = field('http://192.168.0.10:9000', p ? p.url : '', 300), rm = el('button', '', 'Remove');
      pn.className = 'pn'; pu.className = 'pu'; rm.addEventListener('click', function () { row.remove(); });
      row.appendChild(pn); row.appendChild(pu); row.appendChild(rm); pbox.appendChild(row);
    }
    (c.panels || []).forEach(panelRow); card.appendChild(pbox);
    var addP = el('button', '', 'Add a panel'); addP.style.marginTop = '8px'; addP.addEventListener('click', function () { panelRow(null); }); card.appendChild(addP);
    var save = el('button', 'primary', 'Save'); save.style.marginTop = '14px'; save.style.display = 'block';
    save.addEventListener('click', function () {
      var panels = Array.prototype.map.call(pbox.querySelectorAll('.prow'), function (r2) { return { name: r2.querySelector('.pn').value.trim(), url: r2.querySelector('.pu').value.trim() }; }).filter(function (p) { return p.name || p.url; });
      msg.className = 'dim'; msg.textContent = 'Saving...';
      act('config', { name: name.value, network: net.value === 'custom' ? netC.value.trim() : net.value, router: rt.value === 'custom' ? rtC.value.trim() : 'auto', scanSeconds: Number(scan.value), update: upd.value, alerts: alertsNow(), panels: panels }).then(function (x) {
        if (x.ok === false) { msg.textContent = x.error || 'Could not save.'; msg.className = 'bad'; return; }
        msg.textContent = x.rescanning ? 'Saved. The server is scanning the network again.' : 'Saved.'; msg.className = 'good'; load();
      }).catch(function () { msg.textContent = 'Could not reach the server.'; msg.className = 'bad'; });
    });
    card.appendChild(save); card.appendChild(msg); box.appendChild(card);
  }).catch(function () { box.textContent = ''; box.appendChild(el('p', 'bad', 'Could not read the settings.')); });
}
function drawPanels() {
  var box = $('t-panels'); box.textContent = '';
  var list = S.snap ? S.snap.panels : [];
  if (!list.length) { box.appendChild(el('p', 'dim', 'No panels yet. Add panels in Dashboard Hub and they will show here.')); return; }
  var g = el('div', 'grid');
  list.forEach(function (p) {
    var a = el('a', 'tile'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.appendChild(el('b', '', p.name)); a.appendChild(el('span', '', p.url.replace(/^https?:\/\//, '')));
    g.appendChild(a);
  });
  box.appendChild(g);
  box.appendChild(el('p', 'dim', 'Each button opens the panel in this browser. Your phone must be able to reach that address (for example through your VPN).'));
}

function devName(d) { return d.name || d.ip || d.mac || 'Device'; }
function detailRows(d) {
  var rows = [];
  if (d.ip) rows.push('Address: ' + d.ip);
  if (d.mac) rows.push('MAC: ' + d.mac);
  if (d.vendor) rows.push('Maker: ' + d.vendor);
  if (d.os) rows.push('System: ' + d.os);
  if (d.group) rows.push('Group: ' + d.group);
  if (d.ports && d.ports.length) rows.push('Open ports: ' + d.ports.map(function (p) { return p.port + (p.service ? ' (' + p.service + ')' : ''); }).join(', '));
  if (d.online && d.onlineSince) rows.push('Online since ' + new Date(d.onlineSince).toLocaleString());
  if (!d.online && d.lastSeen) rows.push('Last seen ' + new Date(d.lastSeen).toLocaleString());
  return rows;
}

function act(name, body) {
  return api('/api/action/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Hub': '1' }, body: JSON.stringify(body || {}) });
}
function field(ph, val, max) { var i = el('input'); i.type = 'text'; i.placeholder = ph; i.maxLength = max; i.value = val || ''; i.style.width = '100%'; i.style.marginTop = '6px'; return i; }
function editBox(d) {
  var b = el('div', 'edit'); b.style.marginTop = '10px';
  var n = field('Name', d.name, 60), g = field('Group', d.group, 30), msg = el('div', 'dim');
  var lab = el('label', 'chk'), cb = el('input'); cb.type = 'checkbox'; lab.style.marginTop = '8px'; lab.appendChild(cb); lab.appendChild(document.createTextNode('Ignore (leave it off the map and the counts)'));
  var save = el('button', 'primary', 'Save'); save.style.marginTop = '8px';
  if (d.isRouter || d.self) cb.disabled = true;
  save.addEventListener('click', function () {
    msg.textContent = 'Saving...';
    act('devices', { op: 'save', changes: [{ key: d.key, name: n.value, group: g.value, ignored: cb.checked }] }).then(function (r) {
      if (r.ok === false) { msg.textContent = r.error || 'Could not save.'; msg.className = 'bad'; return; }
      msg.textContent = 'Saved.'; msg.className = 'good'; load();
    }).catch(function () { msg.textContent = 'Could not reach the server.'; msg.className = 'bad'; });
  });
  [n, g, lab, save, msg].forEach(function (x) { b.appendChild(x); });
  return b;
}
function manageBox() {
  var box = el('div', 'card'); box.style.marginTop = '14px';
  box.appendChild(el('b', '', 'Add a machine by hand'));
  box.appendChild(el('div', 'dim', 'For something the scan cannot see. The server pings it to see if it is online.'));
  var ip = field('192.168.0.50', '', 15), nm = field('Name', '', 60), gr = field('Group', '', 30), msg = el('div', 'dim'), add = el('button', 'primary', 'Add'); add.style.marginTop = '8px';
  add.addEventListener('click', function () {
    msg.className = 'dim'; msg.textContent = 'Adding...';
    act('devices', { op: 'add', ip: ip.value, name: nm.value, group: gr.value }).then(function (r) {
      if (r.ok === false) { msg.textContent = r.error || 'Could not add it.'; msg.className = 'bad'; return; }
      ip.value = ''; nm.value = ''; gr.value = ''; msg.textContent = 'Added.'; msg.className = 'good'; load();
    });
  });
  [ip, nm, gr, add, msg].forEach(function (x) { box.appendChild(x); });
  var ign = el('div'); ign.style.marginTop = '14px'; var sh = el('button', '', 'Show ignored machines'); ign.appendChild(sh);
  sh.addEventListener('click', function () {
    act('devices', { op: 'list' }).then(function (r) {
      ign.textContent = '';
      var list = (r.devices || []).filter(function (d) { return d.ignored; });
      ign.appendChild(el('b', '', list.length ? 'Ignored machines' : 'No ignored machines'));
      list.forEach(function (d) {
        var row = el('div', 'line'), t = el('span', '', d.shownName + (d.ip ? ' (' + d.ip + ')' : '') + ' '), rb = el('button', '', 'Bring back');
        rb.addEventListener('click', function () { act('devices', { op: 'save', changes: [{ key: d.key, ignored: false }] }).then(function () { row.remove(); load(); }); });
        row.appendChild(t); row.appendChild(rb); ign.appendChild(row);
      });
    });
  });
  box.appendChild(ign);
  return box;
}
function drawDevices() {
  var box = $('devList'); box.textContent = '';
  var s = S.snap; if (!s) return;
  var q = S.q.toLowerCase();
  var list = s.devices.filter(function (d) {
    if (S.filter === 'on' && !d.online) return false;
    if (S.filter === 'off' && d.online) return false;
    if (!q) return true;
    return (devName(d) + ' ' + (d.ip || '') + ' ' + (d.mac || '') + ' ' + (d.vendor || '') + ' ' + (d.group || '')).toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return (a.online ? 1 : 0) - (b.online ? 1 : 0) || devName(a).toLowerCase().localeCompare(devName(b).toLowerCase()); });
  var on = s.devices.filter(function (d) { return d.online; }).length;
  var head = el('p', 'dim', on + ' online, ' + (s.devices.length - on) + ' offline, ' + s.devices.length + ' in total'); box.appendChild(head);
  list.forEach(function (d) {
    var card = el('div', 'dev'), h = el('div', 'h'), n = el('div', 'n');
    h.appendChild(el('span', 'dot' + (d.online ? '' : ' off')));
    n.appendChild(el('b', '', devName(d))); n.appendChild(el('span', '', (d.ip || '') + (d.vendor ? ' · ' + d.vendor : '') + (d.online ? '' : ' · offline')));
    h.appendChild(n); card.appendChild(h);
    var body = el('div', 'd'); detailRows(d).forEach(function (t) { body.appendChild(el('div', '', t)); });
    if (S.edit) body.appendChild(editBox(d));
    body.hidden = !S.openDev[d.key]; card.appendChild(body);
    h.addEventListener('click', function () { S.openDev[d.key] = body.hidden; body.hidden = !body.hidden; });
    box.appendChild(card);
  });
  if (!list.length) box.appendChild(el('p', 'dim', 'Nothing matches.'));
  if (S.edit) box.appendChild(manageBox());
}
$('q').addEventListener('input', function () { S.q = $('q').value; drawDevices(); });
document.querySelectorAll('#chips button').forEach(function (b) {
  b.addEventListener('click', function () { S.filter = b.getAttribute('data-f'); document.querySelectorAll('#chips button').forEach(function (x) { x.classList.toggle('on', x === b); }); drawDevices(); });
});

/* ---------- map: the same layout as on the computer, seen from above; drag to move, pinch or wheel to zoom, tap a device ---------- */
var cv = $('map'), ctx = cv.getContext('2d'), pts = [], base = { sx: 1, ox: 0, oy: 0 }, ptr = {}, dragInfo = null;
function posKey() { return 'dh-pos-' + (S.snap && S.snap.profile ? S.snap.profile.id : ''); }
function localPos() { try { return JSON.parse(localStorage.getItem(posKey()) || '{}') || {}; } catch (e) { return {}; } }
function saveLocalPos(key, x, z) { try { var o = localPos(); o[key] = { x: x, z: z }; localStorage.setItem(posKey(), JSON.stringify(o)); } catch (e) { /* private window: the move just lasts until the page is reloaded */ } }
function layout() {
  var s = S.snap; pts = [];
  if (!s) return;
  var ds = s.devices, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  if (S.edit === false) { var ov = localPos(); ds.forEach(function (d) { if (ov[d.key]) { d.x = ov[d.key].x; d.z = ov[d.key].z; } }); }
  ds.forEach(function (d) { minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); minZ = Math.min(minZ, d.z); maxZ = Math.max(maxZ, d.z); });
  var flat = !(maxX - minX > 0.5 || maxZ - minZ > 0.5);
  var cols = Math.ceil(Math.sqrt(ds.length || 1));
  ds.forEach(function (d, i) { pts.push({ d: d, x: flat ? (i % cols) * 10 : d.x, z: flat ? Math.floor(i / cols) * 10 : d.z }); });
}
function size() {
  var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  return { w: r.width, h: r.height, dpr: dpr };
}
function fitView() {
  var z = size(); layout();
  if (!pts.length) { S.view = { k: 1, tx: 0, ty: 0 }; return; }
  var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  pts.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
  var pad = 46, sx = (z.w - pad * 2) / Math.max(1, maxX - minX), sz = (z.h - pad * 2) / Math.max(1, maxZ - minZ), k = Math.min(sx, sz, 60);
  S.view = { k: k, tx: z.w / 2 - k * (minX + maxX) / 2, ty: z.h / 2 - k * (minZ + maxZ) / 2 };
}
/* ---------- the 3D view: the same flat map seen from a tilted camera you can turn around (drag), zoom (wheel or pinch); dots are boxes standing on the floor ---------- */
var C3 = { yaw: 0.55, pitch: 0.75, dist: 60, tx: 0, tz: 0 };
try { S.m3 = localStorage.getItem('dh-3d') === '1'; } catch (e) { S.m3 = false; }
function focal() { var z = size(); return Math.min(z.w, z.h) * 1.05; }
function proj3(x, y, z) {
  var rx = x - C3.tx, rz = z - C3.tz, cy = Math.cos(C3.yaw), sy = Math.sin(C3.yaw), cp = Math.cos(C3.pitch), sp = Math.sin(C3.pitch);
  var x1 = cy * rx + sy * rz, z1 = -sy * rx + cy * rz, y2 = cp * y + sp * z1, z2 = -sp * y + cp * z1, zc = z2 + C3.dist, zz = size(), f = focal();
  if (zc < 1) zc = 1;
  return { x: zz.w / 2 + f * x1 / zc, y: zz.h / 2 - f * y2 / zc, d: zc, k: f / zc };
}
function floorAt(p) {
  var zz = size(), f = focal(), dx = (p.x - zz.w / 2) / f, dy = -(p.y - zz.h / 2) / f, dz = 1;
  var cy = Math.cos(C3.yaw), sy = Math.sin(C3.yaw), cp = Math.cos(C3.pitch), sp = Math.sin(C3.pitch);
  function back(vx, vy, vz) { var y = cp * vy - sp * vz, z1 = sp * vy + cp * vz; return { x: cy * vx - sy * z1, y: y, z: sy * vx + cy * z1 }; }
  var O = back(0, 0, -C3.dist), D = back(dx, dy, dz);
  if (Math.abs(D.y) < 1e-6) return null;
  var t = (1 - O.y) / D.y; if (t <= 0) return null;      // the plane through the middle of the boxes
  return { x: O.x + t * D.x + C3.tx, z: O.z + t * D.z + C3.tz };
}
function scr(p) { if (S.m3) { var a = proj3(p.x, 1, p.z); return { x: a.x, y: a.y }; } return toScreen(p); }
function fit3() {
  layout(); var cx = 0, cz = 0, R = 8;
  if (pts.length) { pts.forEach(function (p) { cx += p.x; cz += p.z; }); cx /= pts.length; cz /= pts.length; pts.forEach(function (p) { R = Math.max(R, Math.hypot(p.x - cx, p.z - cz)); }); }
  C3.tx = cx; C3.tz = cz; C3.dist = R * 2.1 + 12;
}
function zoom3(f) { C3.dist = Math.max(8, Math.min(1500, C3.dist / f)); paint(); }
function shade(hex, f) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return hex;
  return 'rgb(' + [1, 2, 3].map(function (i) { return Math.max(0, Math.min(255, Math.round(parseInt(m[i], 16) * f))); }).join(',') + ')';
}
function paint3() {
  var z = size(); ctx.setTransform(z.dpr, 0, 0, z.dpr, 0, 0); ctx.clearRect(0, 0, z.w, z.h);
  var s = S.snap; if (!s) return;
  var good = css('--good'), bad = css('--bad'), text = css('--text'), acc = css('--accent');
  // floor grid
  var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; pts.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
  if (pts.length) {
    var g0x = Math.floor((minX - 12) / 10) * 10, g1x = Math.ceil((maxX + 12) / 10) * 10, g0z = Math.floor((minZ - 12) / 10) * 10, g1z = Math.ceil((maxZ + 12) / 10) * 10, i, a, b;
    ctx.lineWidth = 1; ctx.strokeStyle = css('--line'); ctx.globalAlpha = 0.7;
    for (i = g0x; i <= g1x; i += 10) { a = proj3(i, 0, g0z); b = proj3(i, 0, g1z); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (i = g0z; i <= g1z; i += 10) { a = proj3(g0x, 0, i); b = proj3(g1x, 0, i); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  var byKey = {}; pts.forEach(function (p) { byKey[p.d.key] = p; });
  ctx.lineWidth = 1.5; ctx.strokeStyle = css('--dim');
  (s.links || []).forEach(function (l) { var A = byKey[l.a], B = byKey[l.b]; if (!A || !B) return; var a2 = proj3(A.x, 1, A.z), b2 = proj3(B.x, 1, B.z); ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); });
  // camera position in the world, to know which sides of a box face us
  var cy = Math.cos(C3.yaw), sy = Math.sin(C3.yaw), cp = Math.cos(C3.pitch), sp = Math.sin(C3.pitch);
  var oy = cp * 0 - sp * -C3.dist, oz1 = sp * 0 + cp * -C3.dist, camX = cy * 0 - sy * oz1 + C3.tx, camY = oy, camZ = sy * 0 + cy * oz1 + C3.tz;
  var order = pts.slice().sort(function (a, b) { return Math.hypot(b.x - camX, b.z - camZ) - Math.hypot(a.x - camX, a.z - camZ); });
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  order.forEach(function (p) {
    var d = p.d, sc = d.isRouter ? 1.5 : 1, hw = 1.6 * sc, hh = 2 * sc, hd = 1 * sc, base = d.online ? good : bad;
    function V(sx, sy2, sz) { return proj3(p.x + sx * hw, sy2 * hh, p.z + sz * hd); }
    function face(vs, col) { ctx.beginPath(); vs.forEach(function (v, i) { if (i) ctx.lineTo(v.x, v.y); else ctx.moveTo(v.x, v.y); }); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke(); }
    var v = { a: V(-1, 0, -1), b: V(1, 0, -1), c: V(1, 0, 1), d: V(-1, 0, 1), e: V(-1, 1, -1), f: V(1, 1, -1), g: V(1, 1, 1), h: V(-1, 1, 1) };
    if (camZ > p.z + hd) face([v.d, v.c, v.g, v.h], shade(base, 0.8));      // front (+z)
    if (camZ < p.z - hd) face([v.a, v.b, v.f, v.e], shade(base, 0.8));      // back (-z)
    if (camX > p.x + hw) face([v.b, v.c, v.g, v.f], shade(base, 0.62));     // right (+x)
    if (camX < p.x - hw) face([v.a, v.d, v.h, v.e], shade(base, 0.62));     // left (-x)
    face([v.e, v.f, v.g, v.h], shade(base, 1.1));                           // top
    if (d.self || (S.sel && S.sel === d.key)) { ctx.lineWidth = 3; ctx.strokeStyle = acc; ctx.beginPath(); [v.e, v.f, v.g, v.h].forEach(function (q, i) { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke(); }
    var lp = proj3(p.x, 0, p.z), nm = devName(d); if (nm.length > 18) nm = nm.slice(0, 17) + '\u2026';
    if (pts.length > 60 && lp.k < 16 && !d.isRouter && !d.self && S.sel !== d.key) return;      // a crowd: names appear when you zoom in
    ctx.fillStyle = text; ctx.fillText(nm, lp.x, lp.y + 14);
  });
}
$('mode3').addEventListener('click', function () {
  S.m3 = !S.m3; try { localStorage.setItem('dh-3d', S.m3 ? '1' : '0'); } catch (e) { /* only this visit */ }
  $('mode3').textContent = S.m3 ? '2D' : '3D'; if (S.m3) fit3(); paint();
});
$('mode3').textContent = S.m3 ? '2D' : '3D';
function toScreen(p) { return { x: p.x * S.view.k + S.view.tx, y: p.z * S.view.k + S.view.ty }; }
function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function paint() {
  if (S.m3) { paint3(); return; }
  var z = size(); if (!S.view) fitView();
  ctx.setTransform(z.dpr, 0, 0, z.dpr, 0, 0); ctx.clearRect(0, 0, z.w, z.h);
  var s = S.snap; if (!s) return;
  var byKey = {}; pts.forEach(function (p) { byKey[p.d.key] = p; });
  ctx.lineWidth = 1.5; ctx.strokeStyle = css('--line');
  (s.links || []).forEach(function (l) { var a = byKey[l.a], b = byKey[l.b]; if (!a || !b) return; var A = toScreen(a), B = toScreen(b); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); });
  var good = css('--good'), bad = css('--bad'), text = css('--text'), acc = css('--accent');
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
  pts.forEach(function (p) {
    var A = toScreen(p), d = p.d, r = d.isRouter ? 13 : 9;
    ctx.fillStyle = d.online ? good : bad;
    ctx.beginPath();
    if (d.isRouter) ctx.rect(A.x - r, A.y - r, r * 2, r * 2); else ctx.arc(A.x, A.y, r, 0, 6.2832);
    ctx.fill();
    if (d.self || (S.sel && S.sel === d.key)) { ctx.lineWidth = 3; ctx.strokeStyle = acc; ctx.stroke(); }
    ctx.fillStyle = text;
    var nm = devName(d); if (nm.length > 18) nm = nm.slice(0, 17) + '…';
    ctx.fillText(nm, A.x, A.y + r + 14);
  });
}
function drawMap() {
  var s = S.snap; var on = s ? s.devices.filter(function (d) { return d.online; }).length : 0;
  $('mapStat').textContent = s ? on + ' online of ' + s.devices.length : '';
  layout(); if (!S.view || S.refit) { fitView(); if (S.m3) fit3(); S.refit = false; }
  paint(); showDetail();
}
function showDetail() {
  var box = $('mapDetail'), d = S.snap && S.sel ? S.snap.devices.filter(function (x) { return x.key === S.sel; })[0] : null;
  if (!d) { box.hidden = true; return; }
  box.hidden = false; box.textContent = '';
  var h = el('div', 'h'); h.appendChild(el('span', 'dot' + (d.online ? '' : ' off'))); h.appendChild(document.createTextNode(' '));
  h.appendChild(el('b', '', devName(d) + (d.online ? '' : ' (offline)'))); box.appendChild(h);
  var dd = el('div', 'd'); detailRows(d).forEach(function (t) { dd.appendChild(el('div', '', t)); }); box.appendChild(dd);
}
$('fit').addEventListener('click', function () { if (S.m3) fit3(); else fitView(); paint(); });
function zoomAt(x, y, f) {
  var v = S.view, nk = Math.max(0.3, Math.min(400, v.k * f)); f = nk / v.k;
  v.tx = x - (x - v.tx) * f; v.ty = y - (y - v.ty) * f; v.k = nk; paint();
}
function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
cv.addEventListener('wheel', function (e) { e.preventDefault(); if (S.m3) { zoom3(e.deltaY < 0 ? 1.15 : 1 / 1.15); return; } var p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
function hitDot(p, max) {
  var best = null, bd = max || 22;
  pts.forEach(function (q) { var A = scr(q), dd = Math.hypot(A.x - p.x, A.y - p.y); if (dd < bd) { bd = dd; best = q; } });
  return best;
}
cv.addEventListener('pointerdown', function (e) {
  cv.setPointerCapture(e.pointerId); ptr[e.pointerId] = pos(e);
  dragInfo = { moved: 0, start: pos(e), pinch: 0, dev: null };
  if (Object.keys(ptr).length === 1) {
    var hit = hitDot(pos(e));
    if (hit) { dragInfo.dev = hit; S.dragging = true; }
  }
});
cv.addEventListener('pointermove', function (e) {
  if (!ptr[e.pointerId]) return;
  var prev = ptr[e.pointerId], cur = pos(e), ids = Object.keys(ptr);
  if (ids.length === 2) {
    var o = ptr[ids[0] === String(e.pointerId) ? ids[1] : ids[0]];
    var d0 = Math.hypot(prev.x - o.x, prev.y - o.y), d1 = Math.hypot(cur.x - o.x, cur.y - o.y);
    ptr[e.pointerId] = cur; dragInfo.moved = 99;
    if (S.m3) { if (d0 > 0) zoom3(d1 / d0); return; }
    if (d0 > 0) zoomAt((cur.x + o.x) / 2, (cur.y + o.y) / 2, d1 / d0);
    return;
  }
  ptr[e.pointerId] = cur; dragInfo.moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
  if (dragInfo.dev) {
    if (dragInfo.moved < 8) return;                       // a small wobble is still a tap
    if (!dragInfo.began) { dragInfo.began = true; pts.forEach(function (q) { q.d.x = q.x; q.d.z = q.z; }); S.sel = dragInfo.dev.d.key; }   // keep every dot where it is drawn (also when the layout was a plain grid)
    var q = dragInfo.dev;
    if (S.m3) { var f = floorAt(cur); if (f) { q.x = f.x; q.z = f.z; } } else { q.x = (cur.x - S.view.tx) / S.view.k; q.z = (cur.y - S.view.ty) / S.view.k; }
    q.d.x = q.x; q.d.z = q.z; paint(); return;
  }
  if (S.m3) { C3.yaw += (cur.x - prev.x) * 0.008; C3.pitch = Math.max(0.2, Math.min(1.5, C3.pitch + (cur.y - prev.y) * 0.006)); paint(); return; }
  S.view.tx += cur.x - prev.x; S.view.ty += cur.y - prev.y; paint();
});
function finishDrag() {
  var q = dragInfo && dragInfo.dev; S.dragging = false;
  if (!q || !dragInfo.began) return;
  var d = q.d;
  if (S.edit) act('devices', { op: 'move', key: d.key, x: d.x, z: d.z }).then(function (r) { if (r && r.ok === false) { $('mapStat').textContent = r.error || 'Could not save the move.'; } }).catch(function () { $('mapStat').textContent = 'Could not save the move.'; });
  else saveLocalPos(d.key, d.x, d.z);
  showDetail();
}
function up(e) {
  if (dragInfo && dragInfo.dev && Object.keys(ptr).length === 1) finishDrag();
  var wasTap = dragInfo && dragInfo.moved < 8 && Object.keys(ptr).length === 1;
  delete ptr[e.pointerId];
  if (!Object.keys(ptr).length) S.dragging = false;
  if (wasTap) {
    var hit = hitDot(pos(e), 28);
    S.sel = hit ? hit.d.key : null; paint(); showDetail();
  }
}
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', function (e) { delete ptr[e.pointerId]; S.dragging = false; });
$('resetPos').addEventListener('click', function () {
  if (!confirm('Put all the dots back where they were placed automatically?')) return;
  if (S.edit) act('devices', { op: 'resetlayout' }).then(function () { S.refit = true; load(); });
  else { try { localStorage.removeItem(posKey()); } catch (e) { /* nothing saved */ } S.refit = true; load(); }
});
cv.dhDots = function () { return pts.map(function (p) { var A = scr(p); return { key: p.d.key, x: A.x, y: A.y, name: devName(p.d) }; }); };   // lets the tests find the dots
window.addEventListener('resize', function () { if (S.tab === 'map') { if (S.m3) fit3(); else fitView(); paint(); } });

/* ---------- uptime and history ---------- */
function loadUptime() {
  var days = $('range').value, min = $('brief').checked ? 0 : 5;
  api('/api/uptime?days=' + days + '&min=' + min).then(function (r) {
    if (r._status === 401) { showLogin(''); return; }
    S.lastUp = r; drawUptime();
  });
}
$('range').addEventListener('change', loadUptime); $('brief').addEventListener('change', loadUptime);
function drawUptime() {
  var r = S.lastUp, lines = $('upLines'), dev = $('upDev'); lines.textContent = ''; dev.textContent = '';
  if (!r || r.empty) { $('upSum').textContent = 'No history yet. Dashboard Hub records it while it is open and scanning.'; return; }
  $('upSum').textContent = r.summary || '';
  var L = r.lines || [];
  if (L.length) lines.appendChild(el('h2', '', 'What happened'));
  L.slice(0, 40).forEach(function (l) { lines.appendChild(el('div', 'line', l.text)); });
  if (L.length > 40) lines.appendChild(el('p', 'dim', 'And ' + (L.length - 40) + ' more earlier events (see them on the computer).'));
  var span = Math.max(1, r.to - r.from);
  dev.appendChild(el('h2', '', 'Every device'));
  (r.devices || []).forEach(function (x) {
    var row = el('div', 'up-row'), t = el('div', 't'), n = el('b', '', x.name);
    t.appendChild(n); t.appendChild(el('span', '', (x.pct === null ? 'not enough watching' : x.pct + '% online') + (x.downs.length ? ' · ' + x.downs.length + (x.downs.length === 1 ? ' drop' : ' drops') : '')));
    row.appendChild(t);
    var bar = el('div', 'bar2');
    x.segments.forEach(function (sg) {
      if (sg[2] === 'none') return;
      var d = el('div', 'seg ' + sg[2]); d.style.left = (100 * (sg[0] - r.from) / span) + '%'; d.style.width = (100 * (sg[1] - sg[0]) / span) + '%'; bar.appendChild(d);
    });
    row.appendChild(bar); dev.appendChild(row);
  });
}
load();
})();
`;

module.exports = { createWebAccess, createRemoteHubs, hubUrl, webCleanSnapshot, webUrls, WEB_DEFAULT_PORT, TYPES, cleanDevice, cleanList, webUrl, nxsText, nxCandidates, findNxplayer, launchNx, load, save, defaultPort };
