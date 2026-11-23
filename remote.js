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
    <button data-tab="panels" class="on">Panels</button><button data-tab="map">Map</button><button data-tab="devices">Devices</button><button data-tab="uptime">Uptime</button>
  </nav>
  <main>
    <div id="note" class="note" hidden></div>
    <div id="t-panels"></div>
    <div id="t-map" hidden>
      <div class="mapbar"><span id="mapStat" class="dim"></span><button id="fit">Fit</button></div>
      <canvas id="map"></canvas>
      <div id="mapDetail" class="card" hidden></div>
    </div>
    <div id="t-devices" hidden>
      <div class="bar"><input id="q" type="search" placeholder="Search name, address, maker"><span id="chips"><button data-f="all" class="on">All</button><button data-f="on">Online</button><button data-f="off">Offline</button></span></div>
      <div id="devList"></div>
    </div>
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
.tabs{display:flex;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:57px;z-index:4}
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
function showApp() { $('login').hidden = true; $('app').hidden = false; if (!S.timer) S.timer = setInterval(function () { if (!document.hidden) load(true); }, 15000); }

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
    S.now = r.now; S.snap = r.snapshot || null; S.fetched = Date.now();
    draw();
  }).catch(function () { $('note').hidden = false; $('note').textContent = 'Cannot reach Dashboard Hub right now. Is the computer on and the VPN connected?'; });
}

document.querySelectorAll('.tabs button').forEach(function (b) {
  b.addEventListener('click', function () {
    S.tab = b.getAttribute('data-tab');
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    draw();
  });
});

function draw() {
  var s = S.snap;
  $('profile').textContent = s && s.profile ? s.profile.name : '';
  var note = $('note');
  if (!s) { note.hidden = false; note.textContent = 'Dashboard Hub has not shared anything yet. Open Dashboard Hub on the computer once.'; }
  else if (!s.devices.length && S.tab !== 'panels' && S.tab !== 'uptime') { note.hidden = false; note.textContent = 'No devices yet. On the computer, open Network Map and run a scan.'; }
  else note.hidden = true;
  $('age').textContent = s ? 'updated ' + ago(S.now - s.at) : '';
  ['panels', 'map', 'devices', 'uptime'].forEach(function (t) { $('t-' + t).hidden = S.tab !== t; });
  if (S.tab === 'panels') drawPanels();
  else if (S.tab === 'map') drawMap();
  else if (S.tab === 'devices') drawDevices();
  else loadUptime();
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
    body.hidden = !S.openDev[d.key]; card.appendChild(body);
    h.addEventListener('click', function () { S.openDev[d.key] = body.hidden; body.hidden = !body.hidden; });
    box.appendChild(card);
  });
  if (!list.length) box.appendChild(el('p', 'dim', 'Nothing matches.'));
}
$('q').addEventListener('input', function () { S.q = $('q').value; drawDevices(); });
document.querySelectorAll('#chips button').forEach(function (b) {
  b.addEventListener('click', function () { S.filter = b.getAttribute('data-f'); document.querySelectorAll('#chips button').forEach(function (x) { x.classList.toggle('on', x === b); }); drawDevices(); });
});

/* ---------- map: the same layout as on the computer, seen from above; drag to move, pinch or wheel to zoom, tap a device ---------- */
var cv = $('map'), ctx = cv.getContext('2d'), pts = [], base = { sx: 1, ox: 0, oy: 0 }, ptr = {}, dragInfo = null;
function layout() {
  var s = S.snap; pts = [];
  if (!s) return;
  var ds = s.devices, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
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
function toScreen(p) { return { x: p.x * S.view.k + S.view.tx, y: p.z * S.view.k + S.view.ty }; }
function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function paint() {
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
  layout(); if (!S.view || S.refit) { fitView(); S.refit = false; }
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
$('fit').addEventListener('click', function () { fitView(); paint(); });
function zoomAt(x, y, f) {
  var v = S.view, nk = Math.max(0.3, Math.min(400, v.k * f)); f = nk / v.k;
  v.tx = x - (x - v.tx) * f; v.ty = y - (y - v.ty) * f; v.k = nk; paint();
}
function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
cv.addEventListener('wheel', function (e) { e.preventDefault(); var p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
cv.addEventListener('pointerdown', function (e) { cv.setPointerCapture(e.pointerId); ptr[e.pointerId] = pos(e); dragInfo = { moved: 0, start: pos(e), pinch: 0 }; });
cv.addEventListener('pointermove', function (e) {
  if (!ptr[e.pointerId]) return;
  var prev = ptr[e.pointerId], cur = pos(e), ids = Object.keys(ptr);
  if (ids.length === 2) {
    var o = ptr[ids[0] === String(e.pointerId) ? ids[1] : ids[0]];
    var d0 = Math.hypot(prev.x - o.x, prev.y - o.y), d1 = Math.hypot(cur.x - o.x, cur.y - o.y);
    ptr[e.pointerId] = cur; dragInfo.moved = 99;
    if (d0 > 0) zoomAt((cur.x + o.x) / 2, (cur.y + o.y) / 2, d1 / d0);
    return;
  }
  ptr[e.pointerId] = cur; dragInfo.moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
  S.view.tx += cur.x - prev.x; S.view.ty += cur.y - prev.y; paint();
});
function up(e) {
  var wasTap = dragInfo && dragInfo.moved < 8 && Object.keys(ptr).length === 1;
  delete ptr[e.pointerId];
  if (wasTap) {
    var p = pos(e), best = null, bd = 28;
    pts.forEach(function (q) { var A = toScreen(q), dd = Math.hypot(A.x - p.x, A.y - p.y); if (dd < bd) { bd = dd; best = q.d.key; } });
    S.sel = best; paint(); showDetail();
  }
}
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', function (e) { delete ptr[e.pointerId]; });
window.addEventListener('resize', function () { if (S.tab === 'map') { fitView(); paint(); } });

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
