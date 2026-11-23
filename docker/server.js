'use strict';
// Dashboard Hub for Docker: the same scanning, uptime history and phone/browser page as the desktop program, with no window.
// It scans your network on a timer, remembers every device and when it was online, and serves the view-only page.
// Dashboard Hub Desktop can connect to it (Settings > Remote servers) to check on it and ask for a scan.
// Folders: the program files sit one level up (scanner.js, remote.js, notif-history.js ...); your data lives in DASHBOARD_HUB_DATA (default /data).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SRC = process.env.DASHBOARD_HUB_SRC || path.join(__dirname, '..');
const scanner = require(path.join(SRC, 'scanner.js'));
const notifLib = require(path.join(SRC, 'notif-history.js'));
const remote = require(path.join(SRC, 'remote.js'));
let VERSION = '0.0.0';
try { VERSION = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version; } catch (e) { /* unknown */ }

const DATA = process.env.DASHBOARD_HUB_DATA || '/data';
const PROFILE_ID = 'docker-main';
const log = (m) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + m);

// ---------- settings ----------
// config.json (in the data folder) holds the settings. The first time the server starts, the DASHBOARD_HUB_* environment settings
// (from docker-compose.yml) are used to create it. From then on config.json wins, so changes made in Dashboard Hub Desktop stick.
// The access code is the exception: DASHBOARD_HUB_CODE always applies when it is set.
const DEFAULTS = { name: 'Dashboard Hub (Docker)', network: 'auto', router: 'auto', scanSeconds: 300, port: remote.WEB_DEFAULT_PORT, panels: [] };
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
function cleanConfig(c) {
  c = c && typeof c === 'object' ? c : {};
  const secs = parseInt(c.scanSeconds, 10), port = parseInt(c.port, 10);
  return {
    name: String(c.name || DEFAULTS.name).trim().slice(0, 80) || DEFAULTS.name,
    network: c.network === 'auto' || !c.network ? 'auto' : String(c.network).slice(0, 20),
    router: validIp(c.router) ? c.router : 'auto',
    scanSeconds: secs >= 60 && secs <= 86400 ? secs : DEFAULTS.scanSeconds,
    port: port >= 1024 && port <= 65535 ? port : DEFAULTS.port,
    panels: cleanPanels(c.panels)
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
let state = { devices: {}, router: '', cidr: '', scannedOnce: false, scans: 0 };
let store = notifLib.cleanStore(null);
function loadState() {
  const s = readJson(stateFile(), null);
  if (s && typeof s === 'object' && s.devices && typeof s.devices === 'object') {
    Object.keys(s.devices).slice(0, 1500).forEach((k) => { const d = s.devices[k]; if (d && typeof d === 'object') state.devices[k] = d; });
    state.router = validIp(s.router) ? s.router : ''; state.cidr = text(s.cidr, 20); state.scannedOnce = s.scannedOnce === true; state.scans = Number(s.scans) || 0;
  }
  store = notifLib.cleanStore(readJson(historyFile(), null));
}
let saveTimer = null, histTimer = null;
const saveState = () => { if (!saveTimer) saveTimer = setTimeout(saveNow, 3000); };
function saveNow() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } try { writeJson(stateFile(), state); } catch (e) { log('Could not save the device list: ' + (e && e.code || 'error')); } }
const saveHistory = () => { if (!histTimer) histTimer = setTimeout(saveHistoryNow, 2000); };
function saveHistoryNow() { if (histTimer) { clearTimeout(histTimer); histTimer = null; } try { writeJson(historyFile(), store); } catch (e) { log('Could not save the history: ' + (e && e.code || 'error')); } }

const devList = () => Object.keys(state.devices).map((k) => state.devices[k]);
const titleOf = (d) => d.label || d.hostname || d.ip || d.mac || 'Device';
let histQueue = [], seen = new Set(), newCount = 0, baseline = false;
function histEvent(kind, d) {
  if (!d || d.isRouter) return;
  histQueue.push({ kind: kind, key: d.key, t: Date.now(), mac: d.mac || '', ip: d.ip || '', name: titleOf(d), os: (d.os && d.os.id) || 'unknown', vendor: d.vendor || '' });
  if (histQueue.length > 2000) histQueue.shift();
}
function flushHistory() {
  const q = histQueue; histQueue = [];
  if (!q.length) return;
  if (notifLib.apply(store, PROFILE_ID, config.name, q)) saveHistory();
}
function rekey(oldKey, newKey) {
  if (oldKey === newKey || !state.devices[oldKey]) return;
  const d = state.devices[oldKey];
  if (state.devices[newKey]) { delete state.devices[oldKey]; return; }
  d.key = newKey; state.devices[newKey] = d; delete state.devices[oldKey];
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
function snapshot() {
  return {
    at: ST.lastAt || Date.now(),
    profile: { id: PROFILE_ID, name: config.name }, panels: config.panels,
    devices: devList().map((d) => ({ key: d.key, name: d.isRouter && !d.label ? 'Router' : titleOf(d), ip: d.ip, mac: d.mac || '', vendor: d.vendor || '', os: d.os && d.os.id !== 'unknown' ? d.os.label : '', group: d.group || '', online: d.online !== false, isRouter: !!d.isRouter, self: !!d.self, x: d.x || 0, z: d.z || 0, lastSeen: d.lastSeen || null, onlineSince: d.onlineSince || null, ports: d.ports || [] })),
    links: devList().filter((d) => !d.isRouter).map((d) => ({ a: 'router', b: d.key }))
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
  const ds = devList().filter((d) => !d.isRouter);
  return { mode: 'docker', name: config.name, network: ST.cidr || state.cidr, router: ST.router || state.router, scanSeconds: config.scanSeconds, running: ST.running, progress: ST.scanning, lastScanAt: ST.lastAt, lastScanMs: ST.lastMs, nextScanAt: ST.nextAt, scans: state.scans,
    devices: ds.length, online: ds.filter((d) => d.online !== false).length, offline: ds.filter((d) => d.online === false).length, error: ST.lastError, uptimeSeconds: Math.round(process.uptime()) };
}

// ---------- settings that Dashboard Hub Desktop can read and change ----------
function getConfigInfo() {
  let ifs = []; try { ifs = scanner.listInterfaces().map((i) => ({ name: i.name, address: i.address, cidr: i.cidr })); } catch (e) { ifs = []; }
  return { config: { name: config.name, network: config.network, router: config.router, scanSeconds: config.scanSeconds, panels: config.panels }, detected: { network: ST.detectedCidr || '', router: ST.detectedRouter || '' }, interfaces: ifs, port: config.port };
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
let web = null;
async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  config = loadConfig();
  loadState();
  web = remote.createWebAccess({
    file: path.join(DATA, 'web-access.json'), version: VERSION, getSnapshot: snapshot, getUptime: uptimeFor, getInfo: info, getConfig: getConfigInfo,
    actions: { config: changeConfig, scan: () => { if (ST.running) return { started: false, message: 'A scan is already running.' }; runScan('requested').catch(() => {}); return { started: true }; } }
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
}
function shutdown() {
  if (stopping) return; stopping = true;
  if (timer) clearTimeout(timer);
  try { if (session) session.cancel(); } catch (e) { /* ending anyway */ }
  try { flushHistory(); } catch (e) { /* ending anyway */ }
  saveNow(); saveHistoryNow();
  Promise.resolve(web ? web.stop() : null).then(() => process.exit(0), () => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('uncaughtException', (e) => { log('Unexpected problem: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { log('Unexpected problem: ' + (e && e.stack || e)); });
main().catch((e) => { console.error(e); process.exit(1); });
