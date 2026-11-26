'use strict';
// Dashboard Hub for Docker: the same scanning, uptime history and phone/browser page as the desktop program, with no window.
// It scans your network on a timer, remembers every device and when it was online, and serves the view-only page.
// Dashboard Hub Desktop can connect to it (Settings > Remote servers) to check on it and ask for a scan.
// Folders: the program files sit one level up (scanner.js, remote.js, notif-history.js ...); your data lives in DASHBOARD_HUB_DATA (default /data).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const SRC = process.env.DASHBOARD_HUB_SRC || path.join(__dirname, '..');
const scanner = require(path.join(SRC, 'scanner.js'));
const notifLib = require(path.join(SRC, 'notif-history.js'));
const remote = require(path.join(SRC, 'remote.js'));
const createUpdater = require('./updater.js');
let VERSION = '0.0.0';
try { VERSION = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version; } catch (e) { /* unknown */ }

const DATA = process.env.DASHBOARD_HUB_DATA || '/data';
const PROFILE_ID = 'docker-main';
const log = (m) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + m);

// ---------- settings ----------
// config.json (in the data folder) holds the settings. The first time the server starts, the DASHBOARD_HUB_* environment settings
// (from docker-compose.yml) are used to create it. From then on config.json wins, so changes made in Dashboard Hub Desktop stick.
// The access code is the exception: DASHBOARD_HUB_CODE always applies when it is set.
const DEFAULTS = { name: 'Dashboard Hub (Docker)', network: 'auto', router: 'auto', scanSeconds: 300, port: remote.WEB_DEFAULT_PORT, panels: [], update: 'auto', alerts: { url: '', format: 'ntfy', onNew: true, onLeft: true, onBack: false, quietFrom: '', quietTo: '' } };
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, obj, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: mode || 0o600 });
  fs.renameSync(tmp, file);
}
const validIp = (s) => typeof s === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((p) => Number(p) <= 255);
function cleanPanels(list) {
  const panels = [];
  (Array.isArray(list) ? list : []).slice(0, 200).forEach((p) => {
    const url = String(p && p.url || '').trim().slice(0, 2000);
    if (/^https?:\/\/[^\s]+$/i.test(url)) panels.push({ name: String(p.name || '').trim().slice(0, 80) || url, url: url });
  });
  return panels;
}
const ALERT_FORMATS = ['ntfy', 'discord', 'slack', 'json'];
function cleanAlertUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  try { const u = new URL(s); if ((u.protocol === 'http:' || u.protocol === 'https:') && s.length <= 300) return u.href; } catch (e) { /* not an address */ }
  return null;
}
function cleanClock(v) { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v == null ? '' : v).trim()); return m ? (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2] : ''; }
function cleanAlerts(a) {
  a = a && typeof a === 'object' ? a : {};
  const u = cleanAlertUrl(a.url), d = DEFAULTS.alerts;
  const qf = cleanClock(a.quietFrom), qt = cleanClock(a.quietTo), quiet = !!qf && !!qt && qf !== qt;       // quiet hours need both times (and not the same one)
  return { url: u || '', format: ALERT_FORMATS.includes(a.format) ? a.format : d.format, onNew: a.onNew === undefined ? d.onNew : a.onNew === true, onLeft: a.onLeft === undefined ? d.onLeft : a.onLeft === true, onBack: a.onBack === undefined ? d.onBack : a.onBack === true, quietFrom: quiet ? qf : '', quietTo: quiet ? qt : '' };
}
function cleanConfig(c) {
  c = c && typeof c === 'object' ? c : {};
  const secs = parseInt(c.scanSeconds, 10), port = parseInt(c.port, 10);
  return {
    name: String(c.name || DEFAULTS.name).trim().slice(0, 80) || DEFAULTS.name,
    network: c.network === 'auto' || !c.network ? 'auto' : String(c.network).slice(0, 20),
    router: validIp(c.router) ? c.router : 'auto',
    scanSeconds: secs >= 60 && secs <= 86400 ? secs : DEFAULTS.scanSeconds,
    port: port >= 1024 && port <= 65535 ? port : DEFAULTS.port,
    panels: cleanPanels(c.panels),
    update: ['auto', 'check', 'off'].includes(c.update) ? c.update : DEFAULTS.update,
    alerts: cleanAlerts(c.alerts)
  };
}
const configFile = () => path.join(DATA, 'config.json');
function loadConfig() {
  const file = readJson(configFile(), null);
  if (file && typeof file === 'object') return cleanConfig(file);
  const e = process.env, c = {};
  if (e.DASHBOARD_HUB_NAME) c.name = e.DASHBOARD_HUB_NAME;
  if (e.DASHBOARD_HUB_NETWORK) c.network = e.DASHBOARD_HUB_NETWORK;
  if (e.DASHBOARD_HUB_ROUTER) c.router = e.DASHBOARD_HUB_ROUTER;
  if (e.DASHBOARD_HUB_SCAN_SECONDS) c.scanSeconds = e.DASHBOARD_HUB_SCAN_SECONDS;
  if (e.DASHBOARD_HUB_PORT) c.port = e.DASHBOARD_HUB_PORT;
  if (e.DASHBOARD_HUB_UPDATE) c.update = String(e.DASHBOARD_HUB_UPDATE).toLowerCase();
  if (e.DASHBOARD_HUB_PANELS) {      // Name=address|Name=address
    c.panels = String(e.DASHBOARD_HUB_PANELS).split('|').map((x) => { const i = x.indexOf('='); return i > 0 ? { name: x.slice(0, i).trim(), url: x.slice(i + 1).trim() } : { name: '', url: x.trim() }; });
  }
  const cfg = cleanConfig(c);
  try { writeJson(configFile(), cfg); } catch (err) { /* read-only data folder: settings stay in memory */ }
  return cfg;
}
let config = null;
function saveConfig() { try { writeJson(configFile(), config); return true; } catch (e) { return false; } }

// ---------- devices ----------
function normMac(m) {
  if (typeof m !== 'string') return null;
  const h = m.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (h.length !== 12 || h === '000000000000' || h === 'ffffffffffff') return null;
  return h.match(/../g).join(':');
}
const text = (v, n) => String(v == null ? '' : v).slice(0, n);
const spiralPos = (i) => { const a = i * 2.39996, r = 11 + 3.2 * Math.sqrt(i); return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };
const stateFile = () => path.join(DATA, 'state.json');
const historyFile = () => path.join(DATA, 'history.json');
let state = { devices: {}, router: '', cidr: '', scannedOnce: false, scans: 0, links: [], mapOpts: { groupCircles: true, groupCluster: true } };
let store = notifLib.cleanStore(null);
// Extra things Dashboard Hub Desktop can send or export: device details (brand, model, notes, web address, VLAN) and the links (cables) between machines.
function cleanInfo(i) {
  const o = i && typeof i === 'object' ? i : {};
  const ports = Number.isInteger(o.ports) && o.ports >= 0 && o.ports <= 1024 ? o.ports : null;
  return { brand: text(o.brand, 60).replace(/[\u0000-\u001f\u007f<>]/g, ''), model: text(o.model, 60).replace(/[\u0000-\u001f\u007f<>]/g, ''), ports: ports, notes: text(o.notes, 400).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, ''), webUrl: typeof o.webUrl === 'string' && /^https?:\/\/[^\s<>"']{1,200}$/.test(o.webUrl) ? o.webUrl : '' };
}
const hasInfo = (i) => !!i && !!(i.brand || i.model || i.notes || i.webUrl || i.ports);
function cleanLinkList(list) {
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).slice(0, 4000).forEach((l) => {
    if (!l || typeof l.a !== 'string' || typeof l.b !== 'string' || l.a === l.b) return;
    const id = l.a < l.b ? l.a + '~' + l.b : l.b + '~' + l.a; if (seen.has(id)) return; seen.add(id);
    out.push({ a: text(l.a, 80), b: text(l.b, 80), cable: l.cable === true, wireless: l.wireless === true ? true : l.wireless === false ? false : null });
  });
  return out;
}
function loadState() {
  const s = readJson(stateFile(), null);
  if (s && typeof s === 'object' && s.devices && typeof s.devices === 'object') {
    Object.keys(s.devices).slice(0, 1500).forEach((k) => { const d = s.devices[k]; if (d && typeof d === 'object') state.devices[k] = d; });
    state.router = validIp(s.router) ? s.router : ''; state.cidr = text(s.cidr, 20); state.scannedOnce = s.scannedOnce === true; state.scans = Number(s.scans) || 0;
    state.links = cleanLinkList(s.links); state.mapOpts = { groupCircles: !(s.mapOpts && s.mapOpts.groupCircles === false), groupCluster: !(s.mapOpts && s.mapOpts.groupCluster === false) };
  }
  store = notifLib.cleanStore(readJson(historyFile(), null));
}
let saveTimer = null, histTimer = null;
const saveState = () => { if (!saveTimer) saveTimer = setTimeout(saveNow, 3000); };
function saveNow() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } try { writeJson(stateFile(), state); } catch (e) { log('Could not save the device list: ' + (e && e.code || 'error')); } }
const saveHistory = () => { if (!histTimer) histTimer = setTimeout(saveHistoryNow, 2000); };
function saveHistoryNow() { if (histTimer) { clearTimeout(histTimer); histTimer = null; } try { writeJson(historyFile(), store); } catch (e) { log('Could not save the history: ' + (e && e.code || 'error')); } }

const devList = () => Object.keys(state.devices).map((k) => state.devices[k]);
const shownList = () => devList().filter((d) => !d.ignored);      // ignored devices stay on the server but are left off the map, the counts and the history
const titleOf = (d) => d.label || d.hostname || d.ip || d.mac || 'Device';
let histQueue = [], seen = new Set(), newCount = 0, baseline = false;
function histEvent(kind, d) {
  if (!d || d.isRouter || d.ignored) return;
  histQueue.push({ kind: kind, key: d.key, t: Date.now(), mac: d.mac || '', ip: d.ip || '', name: titleOf(d), os: (d.os && d.os.id) || 'unknown', vendor: d.vendor || '' });
  if (histQueue.length > 2000) histQueue.shift();
}
// ---------- alerts: a message to your phone (ntfy, Discord, Slack or any web address) when a device is new, goes offline or comes back ----------
function alertLine(ev) {
  const who = (ev.name || ev.ip || ev.mac || 'A device') + (ev.ip && ev.name !== ev.ip ? ' (' + ev.ip + ')' : '') + (ev.kind === 'new' && ev.vendor ? ' - ' + ev.vendor : '');
  return (ev.kind === 'new' ? 'New device: ' : ev.kind === 'left' ? 'Went offline: ' : 'Back online: ') + who;
}
function buildAlert(format, server, lines, extra) {
  const title = 'Dashboard Hub: ' + server, body = lines.join('\n').slice(0, 1800);
  if (format === 'discord') return { type: 'application/json', body: JSON.stringify({ content: (title + '\n' + body).slice(0, 1900) }), headers: {} };
  if (format === 'slack') return { type: 'application/json', body: JSON.stringify({ text: title + '\n' + body }), headers: {} };
  if (format === 'json') return { type: 'application/json', body: JSON.stringify({ title: title, message: body, server: server, events: extra || [] }), headers: {} };
  return { type: 'text/plain; charset=utf-8', body: body, headers: { Title: title.replace(/[^\x20-\x7e]/g, '').slice(0, 100) || 'Dashboard Hub', Tags: 'satellite' } };
}
function postAlert(url, msg) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: 'The alert address is not valid.' }); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', timeout: 10000, headers: Object.assign({ 'Content-Type': msg.type, 'Content-Length': Buffer.byteLength(msg.body), 'User-Agent': 'DashboardHub-Alerts' }, msg.headers) }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300 ? { ok: true } : { ok: false, error: 'The alert address answered ' + res.statusCode + '.' }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer')));
    req.on('error', (e) => resolve({ ok: false, error: 'Could not reach the alert address (' + ((e && e.message) || 'error') + ').' }));
    req.end(msg.body);
  });
}
let lastAlertError = '';
// Quiet hours (the server's own clock, see TZ): alerts are kept and sent together, as one message, when the quiet time ends.
const clockMin = (s) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
function inQuiet(al, now) {
  if (!al || !al.quietFrom || !al.quietTo) return false;
  const d = now || new Date(), m = d.getHours() * 60 + d.getMinutes(), a = clockMin(al.quietFrom), b = clockMin(al.quietTo);
  if (a === b) return false;
  return a < b ? (m >= a && m < b) : (m >= a || m < b);
}
let held = [];                                           // alerts waiting for the quiet time to end
const alertLogFile = () => path.join(DATA, 'alert-log.json');
let alertLog = [];                                       // the last alerts (sent, held or failed) for the Settings page
function logAlert(status, count, text, error) {
  alertLog.push({ t: Date.now(), status: status, count: count, text: String(text || '').slice(0, 160), error: error ? String(error).slice(0, 160) : '' });
  if (alertLog.length > 40) alertLog = alertLog.slice(-40);
  try { writeJson(alertLogFile(), alertLog); } catch (e) { /* the list is only a convenience */ }
}
function loadAlertLog() { const a = readJson(alertLogFile(), []); alertLog = Array.isArray(a) ? a.filter((x) => x && typeof x.t === 'number').slice(-40) : []; }
function deliver(evs, heldNote) {
  const al = config.alerts;
  const first = alertLine(evs[0]), lines = evs.slice(0, 15).map(alertLine); if (evs.length > 15) lines.push('...and ' + (evs.length - 15) + ' more');
  if (heldNote) lines.unshift('While it was quiet:');
  return postAlert(al.url, buildAlert(al.format, config.name, lines, evs.slice(0, 50).map((e) => ({ kind: e.kind, name: e.name, ip: e.ip, mac: e.mac, vendor: e.vendor, at: e.t })))).then((r) => {
    if (!r.ok) { if (r.error !== lastAlertError) log('Alert not sent: ' + r.error); lastAlertError = r.error; logAlert('failed', evs.length, first, r.error); } else { lastAlertError = ''; logAlert('sent', evs.length, first); }
    return r;
  });
}
function sendAlerts(q, now) {
  const al = config.alerts;
  if (!al || !al.url) return Promise.resolve();
  const evs = q.filter((e) => (e.kind === 'new' && al.onNew) || (e.kind === 'left' && al.onLeft) || (e.kind === 'back' && al.onBack));
  if (!evs.length) return Promise.resolve();
  if (inQuiet(al, now)) { held = held.concat(evs).slice(-200); logAlert('held', evs.length, alertLine(evs[0])); return Promise.resolve(); }
  const all = held.length ? held.concat(evs) : evs, was = held.length > 0; held = [];
  return deliver(all, was);
}
function releaseHeld(now) {                              // called every half minute: quiet time over, so send what was kept
  const al = config.alerts;
  if (!held.length) return Promise.resolve();
  if (!al || !al.url) { held = []; return Promise.resolve(); }
  if (inQuiet(al, now)) return Promise.resolve();
  const all = held; held = [];
  return deliver(all, true);
}
async function alertTest(a) {
  const al = a && a.alerts ? cleanAlerts(a.alerts) : config.alerts, url = a && a.alerts ? cleanAlertUrl(a.alerts.url) : config.alerts.url;
  if (!url) return { ok: false, error: 'Type the alert address first.' };
  const r = await postAlert(url, buildAlert(al.format, config.name, ['This is a test message. Alerts are working.'], []));
  logAlert(r.ok ? 'sent' : 'failed', 0, 'Test message', r.ok ? '' : r.error);
  return r.ok ? { ok: true, message: 'Test message sent.' } : r;
}
function flushHistory() {
  const q = histQueue; histQueue = [];
  if (!q.length) return;
  try { sendAlerts(q); } catch (e) { /* alerts must never stop the scan */ }
  if (notifLib.apply(store, PROFILE_ID, config.name, q)) saveHistory();
}
function rekey(oldKey, newKey) {
  if (oldKey === newKey || !state.devices[oldKey]) return;
  const d = state.devices[oldKey];
  if (state.devices[newKey]) { delete state.devices[oldKey]; return; }
  d.key = newKey; state.devices[newKey] = d; delete state.devices[oldKey];
  state.links.forEach((l) => { if (l.a === oldKey) l.a = newKey; if (l.b === oldKey) l.b = newKey; });
}
function mergeHost(h) {
  if (!h) return null;
  const mac = normMac(h.mac), hasIp = validIp(h.ip);
  if (!hasIp && !mac) return null;
  let dev = null;
  if (hasIp && h.ip === state.router) dev = state.devices.router || null;
  if (!dev && mac) dev = devList().find((d) => !d.isRouter && d.mac === mac) || null;
  if (!dev && hasIp) dev = state.devices['ip:' + h.ip] || null;
  if (!dev && !mac && hasIp) dev = devList().find((d) => !d.isRouter && d.ip === h.ip && !seen.has(d.key)) || null;
  let created = false;
  if (!dev) {
    const key = h.ip === state.router && state.router ? 'router' : (mac || 'ip:' + h.ip);
    const p = spiralPos(devList().length);
    dev = { key: key, ip: hasIp ? h.ip : '', mac: mac, vendor: '', hostname: '', label: '', group: '', os: { id: 'unknown', label: 'Unknown' }, ports: [], x: key === 'router' ? 0 : p.x, z: key === 'router' ? 0 : p.z,
      online: true, misses: 0, lastSeen: 0, firstSeen: Date.now(), onlineSince: null, isRouter: key === 'router', self: false };
    state.devices[key] = dev; created = true; newCount++;
    histEvent(baseline ? 'new' : 'seen', dev);
  }
  if (!created && hasIp && dev.ip && dev.ip !== h.ip && dev.online !== false) histEvent('ip', dev);
  if (hasIp) dev.ip = h.ip;
  if (mac) { dev.mac = mac; if (!dev.isRouter && dev.key !== mac) { rekey(dev.key, mac); dev = state.devices[mac] || dev; } }
  if (h.vendor) dev.vendor = text(h.vendor, 60);
  const full = !h.scanning && !h.portsSkipped;
  if (full) {
    if (h.hostname) dev.hostname = text(h.hostname, 80);
    dev.ports = (Array.isArray(h.ports) ? h.ports : []).slice(0, 200).filter((p) => p && Number.isInteger(p.port)).map((p) => ({ port: p.port, service: p.service ? text(p.service, 40) : null }));
  }
  if ((created || full) && h.os && typeof h.os === 'object') dev.os = { id: text(h.os.id, 20) || 'unknown', label: text(h.os.label, 40) || 'Unknown' };
  if (!created && dev.online === false) histEvent('back', dev);
  dev.self = !!h.self; dev.lastSeen = Date.now(); dev.online = true; dev.misses = 0;
  seen.add(dev.key);
  return dev;
}
function trackPresence() {
  const now = Date.now();
  devList().forEach((d) => { if (d.online === false) { d.onlineSince = null; return; } if (!d.onlineSince) d.onlineSince = now; if (!d.firstSeen) d.firstSeen = d.lastSeen || now; });
}

// ---------- scanning ----------
const ST = { running: false, lastAt: 0, lastMs: 0, lastError: '', nextAt: 0, cidr: '', router: '', scanning: null };
let timer = null, session = null, stopping = false;
const ipInt = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
function inCidr(ip, cidr) { const p = scanner.parseCidr(cidr); return !!(p.ok && validIp(ip) && ipInt(ip) >= p.base && ipInt(ip) < p.base + Math.pow(2, 32 - p.prefix)); }
async function pickNetwork() {
  let router = '';
  try { router = (await scanner.detectGateway()) || ''; } catch (e) { router = ''; }
  ST.detectedRouter = router;
  if (config.router !== 'auto') router = config.router;
  const ifs = scanner.listInterfaces();
  let cidr = '', auto = '';
  if (ifs.length) {
    let pick = null;
    if (router) pick = ifs.find((i) => inCidr(router, i.cidr));
    pick = pick || ifs[0]; auto = pick.cidr;
  }
  ST.detectedCidr = auto;
  if (config.network !== 'auto') { const p = scanner.parseCidr(config.network); if (p.ok) cidr = p.cidr; else return { error: 'The network "' + config.network + '" is not valid: ' + p.error }; }
  else cidr = auto;
  if (!cidr) return { error: 'No private network was found. Run the container with host networking (see README-DOCKER.md) or set DASHBOARD_HUB_NETWORK.' };
  return { cidr: cidr, router: router };
}
function ensureRouter(ip) {
  if (!validIp(ip)) return;
  state.router = ip;
  if (!state.devices.router) { state.devices.router = { key: 'router', ip: ip, mac: null, vendor: '', hostname: '', label: 'Router', group: '', os: { id: 'router', label: 'Router' }, ports: [], x: 0, z: 0, online: true, misses: 0, lastSeen: Date.now(), firstSeen: Date.now(), onlineSince: null, isRouter: true, self: false }; }
  else state.devices.router.ip = ip;
}
async function runScan(reason) {
  if (ST.running || stopping) return { ok: false, error: 'A scan is already running.' };
  const net = await pickNetwork();
  if (net.error) { ST.lastError = net.error; log(net.error); scheduleNext(); return { ok: false, error: net.error }; }
  ST.running = true; ST.cidr = net.cidr; ST.router = net.router; ST.lastError = '';
  if (state.cidr && state.cidr !== net.cidr) {        // the network was changed: machines of the old network are not kept on this map (their history stays)
    Object.keys(state.devices).forEach((k) => { const d = state.devices[k]; if (!d.isRouter && d.ip && !inCidr(d.ip, net.cidr)) delete state.devices[k]; });
    log('Network changed to ' + net.cidr + ': machines of the old network were taken off the map');
  }
  state.cidr = net.cidr;
  ensureRouter(net.router);
  seen = new Set(); newCount = 0;
  const bg = state.scannedOnce;
  const started = Date.now();
  log('Scan started (' + reason + ', ' + net.cidr + (bg ? ', gentle' : ', first scan') + ')');
  const known = devList().filter((d) => d.ip && d.ports && d.ports.length).map((d) => d.ip);
  await new Promise((resolve) => {
    const r = scanner.startScan({ cidr: net.cidr, mode: bg ? 'background' : 'quick', router: net.router, known: known.slice(0, 1100), methods: { probe: true, mdns: true, ssdp: true, netbios: true, reverseDns: true } }, (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'host') { try { mergeHost(m.host); } catch (e) { /* one odd host never stops a scan */ } }
      else if (m.type === 'progress') ST.scanning = { done: m.done || 0, total: m.total || 0, phase: m.phase || '' };
      else if (m.type === 'done') {
        ST.scanning = null; session = null;
        if (!m.canceled && !m.error) {
          const need = bg ? 2 : 1;
          devList().forEach((d) => {
            if (!d.isRouter && d.ip && !inCidr(d.ip, net.cidr) && !seen.has(d.key)) return;
            if (d.isRouter || seen.has(d.key)) { if (!d.isRouter) { d.misses = 0; d.online = true; } return; }
            d.misses = (d.misses || 0) + 1;
            if (d.misses >= need) { if (d.online !== false) histEvent('left', d); d.online = false; }
          });
          if (state.devices.router && net.router) { state.devices.router.online = true; state.devices.router.lastSeen = Date.now(); }
          state.scannedOnce = true; baseline = true; state.scans++;
          trackPresence();
          notifLib.heartbeat(store, PROFILE_ID, config.name, Math.max(10 * 60000, 3 * config.scanSeconds * 1000));
          flushHistory(); saveHistory(); saveState();
          ST.lastAt = Date.now(); ST.lastMs = ST.lastAt - started;
          log('Scan finished in ' + Math.round(ST.lastMs / 1000) + ' s: ' + devList().filter((d) => !d.isRouter && d.online !== false).length + ' devices online' + (newCount ? ', ' + newCount + ' new' : ''));
        } else { histQueue = []; ST.lastError = m.error ? 'The scan failed: ' + m.error : ''; if (m.error) log(ST.lastError); }
        resolve();
      }
    });
    if (!r.ok) { ST.lastError = r.error || 'The scan could not start.'; log(ST.lastError); resolve(); } else session = r.session;
  });
  try { await pingManual(); trackPresence(); saveState(); } catch (e) { /* manual machines are a bonus */ }
  ST.running = false;
  scheduleNext();
  return { ok: true };
}
function scheduleNext() {
  if (timer) clearTimeout(timer);
  if (stopping) return;
  ST.nextAt = Date.now() + config.scanSeconds * 1000;
  timer = setTimeout(() => { runScan('timer').catch((e) => log('Scan problem: ' + (e && e.message))); }, config.scanSeconds * 1000);
}

// ---------- what the web page and Dashboard Hub Desktop see ----------
// The lines on the map: the links that came from Dashboard Hub Desktop, and every other shown machine hangs off the router like before.
function effectiveLinks() {
  const shown = new Set(shownList().map((d) => d.key)), out = [], used = new Set();
  state.links.forEach((l) => { if (shown.has(l.a) && shown.has(l.b)) { out.push(l); used.add(l.a); used.add(l.b); } });
  shownList().filter((d) => !d.isRouter && !used.has(d.key)).forEach((d) => out.push({ a: 'router', b: d.key, cable: false, wireless: null, auto: true }));
  return out;
}
function snapshot() {
  return {
    at: ST.lastAt || Date.now(),
    profile: { id: PROFILE_ID, name: config.name }, panels: config.panels,
    devices: shownList().map((d) => ({ key: d.key, name: d.isRouter && !d.label ? 'Router' : titleOf(d), ip: d.ip, mac: d.mac || '', vendor: d.vendor || '', os: d.os && d.os.id !== 'unknown' ? d.os.label : '', group: d.group || '', online: d.online !== false, isRouter: !!d.isRouter, self: !!d.self, x: d.x || 0, z: d.z || 0, lastSeen: d.lastSeen || null, onlineSince: d.onlineSince || null, ports: d.ports || [], info: hasInfo(d.info) ? d.info : null, vlan: d.vlan || '' })),
    links: effectiveLinks().map((l) => ({ a: l.a, b: l.b, cable: !!l.cable, wireless: l.wireless === true })),
    opts: { groupCircles: state.mapOpts.groupCircles, groupCluster: state.mapOpts.groupCluster }
  };
}
function uptimeFor(rangeMs, minDropMs) {
  const store2 = store; const pid = notifLib.profileId(PROFILE_ID);
  if (!store2.profiles[pid]) return { ok: true, empty: true, now: Date.now() };
  const now = Date.now();
  const range = Math.min(366 * 86400000, Math.max(3600000, Number(rangeMs) || 86400000));
  const tl = notifLib.hideShort(notifLib.timeline(store2.profiles[pid], now - range, now, now), Math.min(3600000, Math.max(0, Number(minDropMs) || 0)));
  return { ok: true, now: now, from: tl.from, to: tl.to, since: tl.since, watchedPct: tl.watchedPct, summary: notifLib.summary(tl, now), lines: notifLib.story(tl, now), linesAll: notifLib.story(tl, now, undefined, true), devices: tl.devices };
}
function info() {
  const ds = shownList().filter((d) => !d.isRouter);
  return { mode: 'docker', editable: true, version: VERSION, name: config.name, network: ST.cidr || state.cidr, router: ST.router || state.router, scanSeconds: config.scanSeconds, running: ST.running, progress: ST.scanning, lastScanAt: ST.lastAt, lastScanMs: ST.lastMs, nextScanAt: ST.nextAt, scans: state.scans,
    devices: ds.length, online: ds.filter((d) => d.online !== false).length, offline: ds.filter((d) => d.online === false).length, error: ST.lastError, uptimeSeconds: Math.round(process.uptime()) };
}

// ---------- device names, groups, ignore and manual add (Dashboard Hub Desktop) ----------
const cleanName = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
function deviceRows() {
  return devList().map((d) => ({ key: d.key, name: d.label || '', shownName: d.isRouter && !d.label ? 'Router' : titleOf(d), group: d.group || '', ip: d.ip || '', mac: d.mac || '', vendor: d.vendor || '', os: d.os && d.os.id !== 'unknown' ? d.os.label : '',
    online: d.online !== false, ignored: !!d.ignored, manual: !!d.manual, isRouter: !!d.isRouter, self: !!d.self, lastSeen: d.lastSeen || null }))
    .sort((a, b) => (b.isRouter - a.isRouter) || (a.ignored - b.ignored) || a.shownName.localeCompare(b.shownName));
}
async function pingManual() {       // machines typed in by hand that are outside the scanned network cannot be found by the scan, so they are pinged
  const list = devList().filter((d) => d.manual && d.ip && (!ST.cidr || !inCidr(d.ip, ST.cidr)));
  for (const d of list.slice(0, 100)) {
    let up = false; try { up = !!(await scanner.pingHost(d.ip)); } catch (e) { up = false; }
    if (up) { if (d.online === false) histEvent('back', d); d.online = true; d.misses = 0; d.lastSeen = Date.now(); if (!d.onlineSince) d.onlineSince = Date.now(); }
    else { d.misses = (d.misses || 0) + 1; if (d.misses >= 2 && d.online !== false) { histEvent('left', d); d.online = false; d.onlineSince = null; } }
  }
}
// Dashboard Hub Desktop copies its map to this server: names, groups and places (matched by MAC address, else by address), and optionally panels.
function syncFromDesktop(a) {
  const inc = Array.isArray(a.devices) ? a.devices.slice(0, 1500) : [];
  const byMac = {}, byIp = {};
  devList().forEach((d) => { if (d.mac) byMac[String(d.mac).toLowerCase()] = d; if (d.ip) byIp[d.ip] = d; });
  const res = { matched: 0, names: 0, groups: 0, moved: 0, added: 0, skipped: 0, panels: null, info: 0, hidden: 0, links: null };
  const kmap = { router: 'router' };
  const pos = (v) => (Number.isFinite(Number(v)) ? Math.max(-1000, Math.min(1000, Number(v))) : null);
  inc.forEach((e) => {
    if (!e || typeof e !== 'object') return;
    const mac = typeof e.mac === 'string' ? e.mac.toLowerCase() : '', ip = typeof e.ip === 'string' ? e.ip : '';
    let d = (mac && byMac[mac]) || (ip && byIp[ip]) || null;
    const label = cleanName(e.label, 60), group = cleanName(e.group, 30), x = pos(e.x), z = pos(e.z);
    if (!d) {
      if (a.add === true && validIp(ip) && scanner.parseCidr(ip + '/32').ok && devList().length < 1500) {
        const p = spiralPos(devList().length);
        d = { key: mac ? mac : 'ip:' + ip, ip: ip, mac: mac || null, vendor: '', hostname: '', label: '', group: '', os: { id: 'unknown', label: 'Unknown' }, ports: [], x: p.x, z: p.z, online: false, misses: 0, lastSeen: 0, firstSeen: Date.now(), onlineSince: null, isRouter: false, self: false, manual: true };
        state.devices[d.key] = d; if (typeof e.key === 'string' && e.key.startsWith('manual:')) d.manual = true; if (mac) byMac[mac] = d; byIp[ip] = d; res.added++;
      } else { res.skipped++; return; }
    } else if (d.isRouter || d.self) { return; }
    res.matched++; if (typeof e.key === 'string') kmap[e.key] = d.key;
    if (a.names === true && label && d.label !== label) { d.label = label; res.names++; }
    if (a.groups === true && group && d.group !== group) { d.group = group; res.groups++; }
    if (a.positions === true && x !== null && z !== null) { d.x = x; d.z = z; res.moved++; }
    if (a.info === true && (e.info || e.vlan !== undefined)) { const inf = cleanInfo(e.info), vl = cleanName(e.vlan, 30); if (JSON.stringify(inf) !== JSON.stringify(d.info || cleanInfo(null)) || vl !== (d.vlan || '')) { d.info = inf; d.vlan = vl; res.info++; } }
    if (a.ignored === true && typeof e.ignored === 'boolean' && !!d.ignored !== e.ignored) { d.ignored = e.ignored; res.hidden++; }
  });
  if (a.links === true) {
    const list = cleanLinkList(a.linkList).map((l) => ({ a: kmap[l.a], b: kmap[l.b], cable: l.cable, wireless: l.wireless })).filter((l) => l.a && l.b && l.a !== l.b && state.devices[l.a] && state.devices[l.b]);
    state.links = cleanLinkList(list); res.links = state.links.length;
    if (a.groupOptions && typeof a.groupOptions === 'object') state.mapOpts = { groupCircles: a.groupOptions.groupCircles !== false, groupCluster: a.groupOptions.groupCluster !== false };
  }
  if (a.panels === true) {
    const list = cleanPanels(a.panelList);
    config = cleanConfig(Object.assign({}, config, { panels: list })); saveConfig(); res.panels = list.length;
  }
  saveNow();
  return Object.assign({ ok: true }, res);
}
// The same kind of file Dashboard Hub Desktop saves with Backup > Export, so Desktop can import it (and this page can import Desktop's).
function exportMap() {
  const devices = {}, ignored = [], links = effectiveLinks();
  devList().forEach((d) => {
    const o = { key: d.key, ip: d.ip || '', mac: d.mac || null, vendor: d.vendor || null, hostname: d.hostname || null, label: d.isRouter && d.label === 'Router' ? '' : (d.label || ''), group: d.group || '',
      pos: { x: Math.round((d.x || 0) * 100) / 100, y: 0, z: Math.round((d.z || 0) * 100) / 100 },
      os: d.os || { id: 'unknown', label: 'Unknown' }, ports: (d.ports || []).slice(0, 60).filter((p) => p && Number.isInteger(p.port)).map((p) => ({ port: p.port, service: p.service || null, banner: null, title: null })) };
    if (d.osOverride) o.osOverride = d.osOverride;
    if (hasInfo(d.info)) o.info = d.info;
    if (d.vlan) o.vlan = d.vlan;
    devices[d.key] = o;
    if (d.ignored && !d.isRouter) ignored.push(d.key);
  });
  const network = { router: state.router || '192.168.0.1', routerUser: false, alerts: 'app', showServices: false, cidr: state.cidr || '', mode: 'quick', showOffline: true, groupCluster: state.mapOpts.groupCluster, groupCircles: state.mapOpts.groupCircles,
    autoSeconds: 60, scannedOnce: true, presenceAt: 0, removedReturn: true, devices: devices, links: links.map((l) => ({ a: l.a, b: l.b, auto: l.auto === true, cable: l.cable === true, wireless: l.wireless })), ignored: ignored };
  const panels = (config.panels || []).map((p) => ({ name: p.name, url: p.url }));
  return { app: 'dashboard-hub', format: 1, exportedAt: new Date().toISOString(), source: 'docker', includesNotes: false, layout: { columns: 3, height: 480 }, panels: panels, servers: [], network: network,
    profiles: [{ id: PROFILE_ID, name: config.name, locked: false, fp: null, network: network, panels: panels, servers: [] }], activeProfileName: config.name };
}
// Reads a Dashboard Hub export (from Desktop, or from another server like this one) and applies the parts that were ticked.
function importMap(a) {
  const d = a && a.data;
  if (!d || typeof d !== 'object' || d.app !== 'dashboard-hub') return { ok: false, error: 'That file is not a Dashboard Hub export. In Dashboard Hub Desktop use Backup > Export (or this page\'s Download button).' };
  let net = d.network, panels = d.panels, name = '';
  const profs = Array.isArray(d.profiles) ? d.profiles.filter((p) => p && typeof p === 'object' && p.network) : [];
  if (profs.length) {
    let i = Number.isInteger(a.profile) ? a.profile : profs.findIndex((p) => p.name === d.activeProfileName);
    if (i < 0 || i >= profs.length) i = 0;
    net = profs[i].network; name = text(profs[i].name, 80); if (Array.isArray(profs[i].panels)) panels = profs[i].panels;
  }
  if (!net || typeof net !== 'object' || !net.devices || typeof net.devices !== 'object') return { ok: false, error: 'That file has no network map in it.' };
  const ign = new Set(Array.isArray(net.ignored) ? net.ignored.filter((k) => typeof k === 'string') : []);
  const macOf = (k, x) => (typeof x.mac === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(x.mac) ? x.mac : (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(k) ? k : ''));
  const entries = Object.keys(net.devices).filter((k) => k !== 'router').slice(0, 1500).map((k) => {
    const x = net.devices[k] && typeof net.devices[k] === 'object' ? net.devices[k] : {};
    return { key: k, mac: macOf(k, x), ip: typeof x.ip === 'string' ? x.ip : '', label: x.label, group: x.group, x: x.pos && x.pos.x, z: x.pos && x.pos.z, info: x.info, vlan: x.vlan, ignored: ign.has(k) };
  });
  ign.forEach((k) => { if (Object.prototype.hasOwnProperty.call(net.devices, k) || k === 'router') return; if (macOf(k, {})) entries.push({ key: k, mac: k, ip: '', ignored: true }); else if (/^ip:\d{1,3}(\.\d{1,3}){3}$/.test(k)) entries.push({ key: k, mac: '', ip: k.slice(3), ignored: true }); });      // an ignored machine that has no record of its own
  const w = a.what && typeof a.what === 'object' ? a.what : {};
  const r = syncFromDesktop({ devices: entries, names: w.names !== false, groups: w.groups !== false, positions: w.positions !== false, info: w.info !== false, ignored: w.ignored !== false, links: w.links !== false, add: w.add !== false, panels: w.panels === true,
    linkList: net.links, groupOptions: { groupCircles: net.groupCircles, groupCluster: net.groupCluster }, panelList: panels });
  r.total = entries.length; r.profile = name;
  return r;
}
async function devicesAction(a) {
  const op = String(a.op || 'list');
  if (op === 'list') return { devices: deviceRows(), groups: Array.from(new Set(devList().map((d) => d.group).filter(Boolean))).sort() };
  if (op === 'save') {
    const ch = Array.isArray(a.changes) ? a.changes.slice(0, 1500) : [], errs = []; let n = 0;
    ch.forEach((c) => {
      const d = c && typeof c === 'object' ? state.devices[String(c.key || '')] : null;
      if (!d) { errs.push('A device was not found.'); return; }
      if (c.name !== undefined) { const nm = cleanName(c.name, 60); d.label = d.isRouter && !nm ? 'Router' : nm; }
      if (c.group !== undefined) d.group = cleanName(c.group, 30);
      if (c.ignored !== undefined) { if (d.isRouter || d.self) { if (c.ignored === true) errs.push((d.isRouter ? 'The router' : 'The server itself') + ' cannot be ignored.'); } else d.ignored = c.ignored === true; }
      n++;
    });
    saveNow();
    return errs.length ? { ok: false, error: errs[0], saved: n } : { saved: n };
  }
  if (op === 'add') {
    const ip = String(a.ip || '').trim();
    if (!validIp(ip) || !scanner.parseCidr(ip + '/32').ok) return { ok: false, error: 'Type a home network address like 192.168.0.50.' };
    if (devList().some((d) => d.ip === ip)) return { ok: false, error: 'That address is already on the list.' };
    if (devList().length >= 1500) return { ok: false, error: 'The list is full.' };
    const p = spiralPos(devList().length);
    const dev = { key: 'ip:' + ip, ip: ip, mac: null, vendor: '', hostname: '', label: cleanName(a.name, 60), group: cleanName(a.group, 30), os: { id: 'unknown', label: 'Unknown' }, ports: [], x: p.x, z: p.z, online: false, misses: 0, lastSeen: 0, firstSeen: Date.now(), onlineSince: null, isRouter: false, self: false, manual: true };
    state.devices[dev.key] = dev;
    let up = false; try { up = !!(await scanner.pingHost(ip)); } catch (e) { up = false; }
    if (up) { dev.online = true; dev.lastSeen = Date.now(); dev.onlineSince = Date.now(); }
    histEvent('seen', dev);
    flushHistory(); saveNow();
    return { added: dev.key, online: dev.online };
  }
  if (op === 'move') {
    const d = state.devices[String(a.key || '')], x = Number(a.x), z = Number(a.z);
    if (!d) return { ok: false, error: 'That device was not found.' };
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, error: 'The position is not valid.' };
    d.x = Math.max(-1000, Math.min(1000, x)); d.z = Math.max(-1000, Math.min(1000, z));
    saveState();
    return { moved: true };
  }
  if (op === 'resetlayout') {
    devList().forEach((d, i) => { if (d.isRouter) return; const p = spiralPos(i); d.x = p.x; d.z = p.z; });
    if (state.devices.router) { state.devices.router.x = 0; state.devices.router.z = 0; }
    saveNow();
    return { reset: true };
  }
  if (op === 'forget') {
    const d = state.devices[String(a.key || '')];
    if (!d) return { ok: false, error: 'That device was not found.' };
    if (d.isRouter || d.self) return { ok: false, error: 'The router and the server itself cannot be removed.' };
    if (d.online !== false && !d.manual) return { ok: false, error: 'It is online right now. To hide it, choose Ignore instead.' };
    delete state.devices[d.key]; saveNow();
    return { removed: true };
  }
  return { ok: false, error: 'Unknown request.' };
}

// ---------- settings that Dashboard Hub Desktop can read and change ----------
function getConfigInfo() {
  let ifs = []; try { ifs = scanner.listInterfaces().map((i) => ({ name: i.name, address: i.address, cidr: i.cidr })); } catch (e) { ifs = []; }
  return { config: { name: config.name, network: config.network, router: config.router, scanSeconds: config.scanSeconds, panels: config.panels, update: config.update, alerts: config.alerts }, alertLog: alertLog.slice(-20).reverse(), alertHeld: held.length, serverTime: (function () { const d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); })(), update: updater ? updater.status() : null, detected: { network: ST.detectedCidr || '', router: ST.detectedRouter || '' }, interfaces: ifs, port: config.port };
}
function changeConfig(a) {
  const errs = [], next = Object.assign({}, config);
  if (a.name !== undefined) { const n = String(a.name).trim(); if (!n || n.length > 80) errs.push('The name must be 1 to 80 characters.'); else next.name = n; }
  if (a.network !== undefined) {
    const n = String(a.network).trim();
    if (n === 'auto') next.network = 'auto'; else { const p = scanner.parseCidr(n); if (p.ok) next.network = p.cidr; else errs.push('Network: ' + p.error); }
  }
  if (a.router !== undefined) { const r = String(a.router).trim(); if (r === 'auto') next.router = 'auto'; else if (validIp(r) && scanner.parseCidr(r + '/32').ok) next.router = r; else errs.push('The router address must be a home network address like 192.168.0.1, or Automatic.'); }
  if (a.scanSeconds !== undefined) { const n = parseInt(a.scanSeconds, 10); if (n >= 60 && n <= 86400) next.scanSeconds = n; else errs.push('Scan every: 60 seconds to 24 hours.'); }
  if (a.alerts !== undefined) {
    const al = a.alerts && typeof a.alerts === 'object' ? a.alerts : null, u = al ? (al.url === undefined ? config.alerts.url : cleanAlertUrl(al.url)) : null;
    if (!al) errs.push('The alert settings are not valid.');
    else if (u === null) errs.push('The alert address must start with http:// or https://.');
    else if (al.format !== undefined && !ALERT_FORMATS.includes(al.format)) errs.push('Pick one of the alert types in the list.');
    else next.alerts = cleanAlerts(Object.assign({}, config.alerts, al, { url: u }));
  }
  if (a.update !== undefined) { if (['auto', 'check', 'off'].includes(a.update)) next.update = a.update; else errs.push('Updates must be Automatic, Only tell me, or Off.'); }
  if (a.panels !== undefined) {
    if (!Array.isArray(a.panels) || a.panels.length > 200) errs.push('Too many panels.');
    else {
      const clean = cleanPanels(a.panels);
      if (clean.length !== a.panels.length) errs.push('Every panel needs an address starting with http:// or https://.');
      else next.panels = clean;
    }
  }
  if (errs.length) return { ok: false, error: errs.join(' ') };
  const rescan = next.network !== config.network || next.router !== config.router, resched = next.scanSeconds !== config.scanSeconds;
  config = cleanConfig(Object.assign({}, next, { port: config.port }));
  if (!saveConfig()) return { ok: false, error: 'The settings could not be saved (is the data folder read-only?).' };
  log('Settings changed from Dashboard Hub Desktop or the page');
  if (resched && !ST.running) scheduleNext();
  if (rescan && !ST.running) runScan('settings changed').catch(() => {});
  return { config: getConfigInfo().config, rescanning: rescan };
}

// ---------- start ----------
let web = null, updater = null;
function updateNow(a) {
  if (!updater) return Promise.resolve({ ok: false, error: 'Updates are not available.' });
  if (a && a.apply === false) return updater.check().then(() => ({ status: updater.status() }));
  return updater.apply().then((r) => {
    if (r.updated) setTimeout(() => shutdown(42), 1500);
    return Object.assign({}, r, { status: updater.status() });
  });
}
async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  config = loadConfig();
  loadAlertLog();
  setInterval(() => { releaseHeld().catch(() => {}); }, 30000).unref();
  loadState();
  updater = createUpdater({
    dataDir: DATA, version: VERSION, base: Number(process.env.DASHBOARD_HUB_BASE) || 1, supervised: process.env.DASHBOARD_HUB_BOOT === '1',
    repo: process.env.DASHBOARD_HUB_UPDATE_REPO || 'Grid21/Dashboardhub', branch: process.env.DASHBOARD_HUB_UPDATE_BRANCH || 'main', baseUrl: process.env.DASHBOARD_HUB_UPDATE_URL || '',
    getMode: () => config.update, log: log, firstMs: Number(process.env.DASHBOARD_HUB_UPDATE_FIRST_MS) || 120000, everyMs: Number(process.env.DASHBOARD_HUB_UPDATE_EVERY_MS) || 0,
    restart: () => shutdown(42)
  });
  // On every start (also when you press Restart in Portainer or Docker): look for a newer version FIRST and install it before anything else.
  if (config.update === 'auto' && process.env.DASHBOARD_HUB_BOOT === '1') {
    const r = await Promise.race([updater.apply(), new Promise((res) => setTimeout(() => res(null), 45000))]).catch(() => null);
    if (r && r.updated) { log('Updated to ' + r.version + '. Starting it now.'); process.exit(42); }
    if (r && r.ok === false) log('No update installed: ' + r.error);
  }
  web = remote.createWebAccess({
    file: path.join(DATA, 'web-access.json'), version: VERSION, getSnapshot: snapshot, getUptime: uptimeFor, getInfo: info, getConfig: getConfigInfo,
    actions: { config: changeConfig, update: updateNow, alerttest: alertTest, sync: syncFromDesktop, devices: devicesAction, exportmap: exportMap, importmap: importMap, scan: () => { if (ST.running) return { started: false, message: 'A scan is already running.' }; runScan('requested').catch(() => {}); return { started: true }; } }
  });
  // the access code: from DASHBOARD_HUB_CODE, or one that was set before, or a new one shown once in the log
  const envCode = process.env.DASHBOARD_HUB_CODE;
  if (envCode) {
    const r = web.setCode(envCode);
    if (!r.ok) { console.error('DASHBOARD_HUB_CODE is not usable: ' + r.error); process.exit(2); }
  } else if (!web.status().hasCode) {
    const code = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 12);
    web.setCode(code);
    log('=================================================================');
    log('Your access code is:  ' + code + '   (shown once; set DASHBOARD_HUB_CODE to choose your own)');
    log('=================================================================');
  }
  await web.setPort(config.port);
  const st = await web.setOn(true);
  if (!st.on) { console.error('The web page could not start: ' + st.error); process.exit(3); }
  log('Dashboard Hub ' + VERSION + ' (Docker) is running. Open http://<this computer>:' + config.port + '/ in a browser.');
  runScan('start').catch((e) => log('Scan problem: ' + (e && e.message)));
  updater.start();
}
function shutdown(code) {
  code = typeof code === 'number' ? code : 0;
  if (stopping) return; stopping = true;
  if (updater) updater.stop();
  if (timer) clearTimeout(timer);
  try { if (session) session.cancel(); } catch (e) { /* ending anyway */ }
  try { flushHistory(); } catch (e) { /* ending anyway */ }
  saveNow(); saveHistoryNow();
  Promise.resolve(web ? web.stop() : null).then(() => process.exit(code), () => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on('SIGTERM', () => shutdown(0)); process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (e) => { log('Unexpected problem: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { log('Unexpected problem: ' + (e && e.stack || e)); });
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
else module.exports = { _test: { importMap: importMap, exportMap: exportMap, sendAlerts: sendAlerts, releaseHeld: releaseHeld, inQuiet: inQuiet, heldCount: () => held.length, log: () => alertLog, loadAlertLog: loadAlertLog, setConfig: (c) => { config = cleanConfig(c); } } };      // for the tests only
