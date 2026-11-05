// Safety checks for SSH server details before anything is run.
// Only plain, simple characters are allowed, so nothing typed into the
// server form can be turned into a different command.

function cleanServer(input) {
  const s = input && typeof input === 'object' ? input : {};

  const name = String(s.name == null ? '' : s.name)
    .replace(/[^A-Za-z0-9 _.-]/g, '')
    .trim()
    .slice(0, 40) || 'server';

  const user = String(s.user == null ? '' : s.user).trim();
  const host = String(s.host == null ? '' : s.host).trim();
  const portText = String(s.port == null || s.port === '' ? '22' : s.port).trim();

  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(user)) {
    return { ok: false, error: 'The username can only use letters, numbers, dot, dash and underscore.' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(host)) {
    return { ok: false, error: 'The address can only use letters, numbers, dots, dashes and colons (for example 192.168.1.60).' };
  }
  if (!/^[0-9]{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    return { ok: false, error: 'The port must be a number from 1 to 65535 (usually 22).' };
  }

  return { ok: true, value: { name: name, user: user, host: host, port: Number(portText) } };
}

// ---------- backup files ----------
// A backup file may come from a friend, so everything in it is treated as
// untrusted: only normal web addresses are accepted, text is length-limited,
// and servers go through the same checks as the Add Server form.

const MAX_ITEMS = 200;
const MAX_PROFILES = 50;
const MAX_NOTE = 20000;

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanNote(value) {
  if (typeof value !== 'string') return '';
  const t = value.slice(0, MAX_NOTE);
  return t.trim() === '' ? '' : t;
}

// Returns the address (with http:// added if missing), or null if it is not a plain web address.
function cleanUrl(value) {
  let t = String(value == null ? '' : value).trim();
  if (!t || t.length > 2000) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'http://' + t;
  let u;
  try { u = new URL(t); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  return t;
}


// ---------- network map inside a backup ----------
const OS_IDS = ['router', 'windows', 'linux', 'apple', 'android', 'iot', 'console', 'printer', 'network', 'switch', 'unknown'];
const MAX_DEVICES = 1000;
const MAX_LINKS = 5000;
const MAX_IGNORED = 500;

function isIp(s) {
  if (typeof s !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return false;
  return s.split('.').every((p) => Number(p) <= 255);
}
const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const KEY_RE = /^(router|[0-9a-f]{2}(:[0-9a-f]{2}){5}|ip:\d{1,3}(\.\d{1,3}){3}|manual:[a-z0-9]{1,24})$/;

function coord(v) {
  return typeof v === 'number' && isFinite(v) ? Math.max(-300, Math.min(300, v)) : 0;
}

// the extra things you can fill in for a machine: VLAN, brand / model / notes, services, VPN
function cleanNetExtras(o) {
  const info = o.info && typeof o.info === 'object' ? o.info : {};
  const names = {};
  if (o.svcNames && typeof o.svcNames === 'object') {
    for (const k of Object.keys(o.svcNames).slice(0, 60)) if (/^\d{1,5}$/.test(k) && Number(k) >= 1 && Number(k) <= 65535) names[k] = cleanText(o.svcNames[k], 40);
  }
  return {
    vlan: cleanText(o.vlan || '', 30),
    info: {
      brand: cleanText(info.brand || '', 60),
      model: cleanText(info.model || '', 60),
      ports: Number.isInteger(info.ports) && info.ports >= 0 && info.ports <= 1024 ? info.ports : null,
      notes: cleanText(info.notes || '', 400),
      webUrl: typeof info.webUrl === 'string' && /^https?:\/\/[^\s<>"']{1,200}$/.test(info.webUrl) ? info.webUrl : ''
    },
    services: (Array.isArray(o.services) ? o.services : []).slice(0, 30).filter((s) => s && typeof s === 'object').map((s) => ({
      id: cleanText(s.id || '', 20).replace(/[^a-zA-Z0-9]/g, ''),
      name: cleanText(s.name || '', 40),
      port: Number.isInteger(s.port) && s.port >= 1 && s.port <= 65535 ? s.port : null,
      kind: s.kind === 'vpn' ? 'vpn' : 'service'
    })),
    svcNames: names,
    svcHidden: (Array.isArray(o.svcHidden) ? o.svcHidden : []).slice(0, 100).filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535),
    autoVpn: (Array.isArray(o.autoVpn) ? o.autoVpn : []).slice(0, 6).map((v) => cleanText(v, 40))
  };
}

function cleanNetDevice(key, d) {
  const o = d && typeof d === 'object' ? d : {};
  const os = o.os && typeof o.os === 'object' ? o.os : {};
  const ports = [];
  if (Array.isArray(o.ports)) {
    for (const p of o.ports.slice(0, 200)) {
      if (!p || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) continue;
      ports.push({
        port: p.port,
        service: p.service ? cleanText(p.service, 40) : null,
        banner: p.banner ? cleanText(p.banner, 100) : null,
        title: p.title ? cleanText(p.title, 80) : null
      });
    }
  }
  const isRouter = key === 'router';
  const manual = key.startsWith('manual:');
  const pos = o.pos && typeof o.pos === 'object' ? { x: coord(o.pos.x), y: coord(o.pos.y), z: coord(o.pos.z) } : { x: 0, y: 0, z: 0 };
  return {
    key: key,
    ip: isIp(o.ip) ? o.ip : '',
    mac: typeof o.mac === 'string' && MAC_RE.test(o.mac) ? o.mac : null,
    vendor: o.vendor ? cleanText(o.vendor, 60) : null,
    hostname: o.hostname ? cleanText(o.hostname, 80) : null,
    label: cleanText(o.label || '', 60),
    group: cleanText(o.group || '', 30),
    connSeen: o.connSeen === 'wireless' || o.connSeen === 'wired' ? o.connSeen : null,
    attach: o.attach && typeof o.attach === 'object' ? { via: cleanText(o.attach.via || '', 100), speed: Number.isFinite(o.attach.speed) && o.attach.speed >= 1 && o.attach.speed <= 200000 ? o.attach.speed : null, speedRx: Number.isFinite(o.attach.speedRx) && o.attach.speedRx >= 1 && o.attach.speedRx <= 200000 ? o.attach.speedRx : null, signal: Number.isFinite(o.attach.signal) ? Math.round(o.attach.signal) : null, by: cleanText(o.attach.by || '', 40), port: cleanText(o.attach.port || '', 30), parentKey: typeof o.attach.parentKey === 'string' ? cleanText(o.attach.parentKey, 80) : '' } : null,
    portTable: Array.isArray(o.portTable) ? o.portTable.slice(0, 128).filter((p) => p && typeof p === 'object' && typeof p.name === 'string' && p.name).map((p) => ({ name: cleanText(p.name, 30), up: p.up === true, speed: Number.isFinite(p.speed) && p.speed >= 1 && p.speed <= 400000 ? p.speed : null })) : [],
    portTableAt: Number.isFinite(o.portTableAt) ? o.portTableAt : null,
    osOverride: OS_IDS.includes(o.osOverride) && o.osOverride !== 'router' ? o.osOverride : null,
    os: {
      id: OS_IDS.includes(os.id) ? os.id : 'unknown',
      label: cleanText(os.label || '', 40),
      confidence: ['low', 'medium', 'high'].includes(os.confidence) ? os.confidence : 'low',
      reasons: Array.isArray(os.reasons) ? os.reasons.slice(0, 12).map((r) => cleanText(r, 120)) : []
    },
    ports: ports,
    ttl: Number.isInteger(o.ttl) ? o.ttl : null,
    self: !!o.self,
    uplinkPort: typeof o.uplinkPort === 'string' && o.uplinkPort ? cleanText(o.uplinkPort, 30) : null,
    uplinkSpeed: Number.isFinite(o.uplinkSpeed) && o.uplinkSpeed >= 1 && o.uplinkSpeed <= 200000 ? o.uplinkSpeed : null,
    shares: Array.isArray(o.shares) ? o.shares.slice(0, 60).filter((s) => s && typeof s === 'object' && typeof s.name === 'string' && s.name).map((s) => ({ name: cleanText(s.name, 120), type: cleanText(s.type || 'Disk', 10), comment: cleanText(s.comment || '', 120), proto: s.proto === 'NFS' ? 'NFS' : 'SMB' })) : [],
    sharesAt: Number.isFinite(o.sharesAt) ? o.sharesAt : null,
    speedSet: Number.isFinite(o.speedSet) && o.speedSet >= 1 && o.speedSet <= 200000 ? o.speedSet : null,
    linkSpeed: o.linkSpeed && typeof o.linkSpeed === 'object' && Number.isFinite(o.linkSpeed.mbps) && o.linkSpeed.mbps >= 1 && o.linkSpeed.mbps <= 200000 ? { mbps: o.linkSpeed.mbps, wireless: o.linkSpeed.wireless === true } : null,
    manual: manual,
    online: o.online !== false,
    lastSeen: typeof o.lastSeen === 'number' && isFinite(o.lastSeen) ? o.lastSeen : null,
    misses: 0,
    isRouter: isRouter,
    pos: isRouter ? { x: 0, y: 0, z: 0 } : pos
  };
}
function cleanNetDeviceFull(key, d) {
  return Object.assign(cleanNetDevice(key, d), cleanNetExtras(d && typeof d === 'object' ? d : {}));
}

// Returns a safe copy of a network map from a backup file, or null if there is none.
function cleanNetwork(raw) {
  if (!raw || typeof raw !== 'object' || !raw.devices || typeof raw.devices !== 'object') return null;
  const devices = {};
  let count = 0;
  for (const key of Object.keys(raw.devices)) {
    if (!KEY_RE.test(key)) continue;
    if (++count > MAX_DEVICES) break;
    devices[key] = cleanNetDeviceFull(key, raw.devices[key]);
  }
  const router = isIp(raw.router) ? raw.router : '192.168.0.1';
  if (!devices.router) devices.router = cleanNetDeviceFull('router', { ip: router });
  devices.router.ip = router;

  const links = [];
  const seen = new Set();
  if (Array.isArray(raw.links)) {
    for (const l of raw.links.slice(0, MAX_LINKS)) {
      if (!l || typeof l.a !== 'string' || typeof l.b !== 'string') continue;
      if (l.a === l.b || !devices[l.a] || !devices[l.b]) continue;
      const id = l.a < l.b ? l.a + '~' + l.b : l.b + '~' + l.a;
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({ a: l.a, b: l.b, auto: !!l.auto, cable: l.cable === true && !l.auto, wireless: l.cable === true && !l.auto ? false : l.wireless === true ? true : l.wireless === false ? false : null });
    }
  }
  const ignored = [];
  if (Array.isArray(raw.ignored)) {
    for (const k of raw.ignored.slice(0, MAX_IGNORED)) if (typeof k === 'string' && KEY_RE.test(k) && k !== 'router') ignored.push(k);
  }
  const live = Number(raw.autoSeconds);
  return {
    router: router,
    routerUser: raw.routerUser === true,
    alerts: ['off', 'app', 'desktop'].includes(raw.alerts) ? raw.alerts : 'app',
    showServices: raw.showServices === true,
    cidr: typeof raw.cidr === 'string' && /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(raw.cidr) ? raw.cidr : '',
    mode: raw.mode === 'thorough' ? 'thorough' : 'quick',
    showOffline: raw.showOffline === true,
    autoSeconds: [0, 15, 30, 60, 120, 300, 600, 1800].includes(live) ? live : 60,
    scannedOnce: raw.scannedOnce === true,
    devices: devices,
    links: links,
    ignored: ignored
  };
}

function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, error: 'That file is not a valid Dashboard Hub backup.' };
  }
  if (!obj || typeof obj !== 'object' || obj.app !== 'dashboard-hub' || obj.format !== 1) {
    return { ok: false, error: 'That file is not a Dashboard Hub backup.' };
  }

  const rawPanels = Array.isArray(obj.panels) ? obj.panels : [];
  const rawServers = Array.isArray(obj.servers) ? obj.servers : [];
  if (rawPanels.length > MAX_ITEMS || rawServers.length > MAX_ITEMS) {
    return { ok: false, error: 'That backup has too many entries (the limit is ' + MAX_ITEMS + ' of each).' };
  }

  const panels = [];
  const servers = [];
  let skipped = 0;

  for (const p of rawPanels) {
    const url = p && typeof p === 'object' ? cleanUrl(p.url) : null;
    if (!url) { skipped++; continue; }
    const item = { name: cleanText(p.name, 80) || 'Panel', url: url };
    const note = cleanNote(p.note);
    if (note) item.note = note;
    panels.push(item);
  }

  for (const s of rawServers) {
    const checked = cleanServer(s);
    if (!checked.ok) { skipped++; continue; }
    const item = checked.value;
    const note = cleanNote(s.note);
    if (note) item.note = note;
    servers.push(item);
  }

  let layout = null;
  if (obj.layout && typeof obj.layout === 'object') {
    const columns = String(obj.layout.columns);
    const height = String(obj.layout.height);
    if (['1', '2', '3'].includes(columns) && ['400', '600', '800', 'full'].includes(height)) {
      layout = { columns: columns, height: height };
    }
  }

  let network = null;
  if (obj.network !== undefined && obj.network !== null) {
    network = cleanNetwork(obj.network);
    if (!network) skipped++;
  }

  const profiles = [];
  if (Array.isArray(obj.profiles)) {
    const names = new Set();
    for (const p of obj.profiles.slice(0, MAX_PROFILES)) {
      if (!p || typeof p !== 'object') { skipped++; continue; }
      const name = cleanText(p.name, 50) || 'Imported network';
      const key = name.toLowerCase();
      if (names.has(key)) { skipped++; continue; }
      names.add(key);
      let profileNetwork = null;
      if (p.network !== null && p.network !== undefined) {
        profileNetwork = cleanNetwork(p.network);
        if (!profileNetwork) { skipped++; continue; }
      }
      const fpRaw = p.fp && typeof p.fp === 'object' ? p.fp : null;
      const fp = fpRaw && typeof fpRaw.gw === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(fpRaw.gw)
        ? { gw: fpRaw.gw, mac: typeof fpRaw.mac === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(fpRaw.mac) ? fpRaw.mac.toLowerCase() : '' } : null;
      let profPanels = null;
      if (Array.isArray(p.panels)) {
        profPanels = [];
        for (const pp of p.panels.slice(0, MAX_ITEMS)) {
          const url = pp && typeof pp === 'object' ? cleanUrl(pp.url) : null;
          if (!url) { skipped++; continue; }
          const item = { name: cleanText(pp.name, 80) || 'Panel', url: url };
          const note = cleanNote(pp.note);
          if (note) item.note = note;
          profPanels.push(item);
        }
      }
      let profServers = null;
      if (Array.isArray(p.servers)) {
        profServers = [];
        for (const ss of p.servers.slice(0, MAX_ITEMS)) {
          const checked = cleanServer(ss);
          if (!checked.ok) { skipped++; continue; }
          const item = checked.value;
          const note = cleanNote(ss && ss.note);
          if (note) item.note = note;
          profServers.push(item);
        }
      }
      profiles.push({ name: name, network: profileNetwork, locked: p.locked === true, fp: fp, panels: profPanels, servers: profServers });
    }
  }
  const activeProfileName = cleanText(obj.activeProfileName, 50);
  // server management chips (iLO / iDRAC / BMC): the details only, never a password
  const bmc = [];
  if (Array.isArray(obj.bmc)) {
    for (const b of obj.bmc.slice(0, 20)) {
      const host = b && typeof b === 'object' && typeof b.host === 'string' ? b.host.trim() : '';
      const port = Number(b && b.port) || 443;
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !(port >= 1 && port <= 65535)) { skipped++; continue; }
      const mac = typeof b.mac === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(b.mac) ? b.mac.toLowerCase() : '';
      bmc.push({ name: cleanText(b.name, 60) || host, host: host, port: Math.round(port), https: b.https !== false, username: cleanText(b.username, 80), mac: mac });
    }
  }
  return { ok: true, data: { panels: panels, servers: servers, layout: layout, network: network, profiles: profiles, bmc: bmc, activeProfileName: activeProfileName, skipped: skipped } };
}

module.exports = { cleanServer, cleanUrl, cleanNetwork, parseBackup };
