// Network Map tab: scan the LAN and show every machine in an interactive 3D map
// with your router in the middle. Everything here runs inside the app window;
// the actual scanning is done by scanner.js in the app's background process.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const THREE = window.THREE;
  const OrbitControls = window.OrbitControls;

  const els = {
    tabPanels: $('tabPanels'), tabMap: $('tabMap'), view: $('mapView'), wrap: $('mapWrap'),
    iface: $('mapIface'), cidr: $('mapCidr'), router: $('mapRouter'), mode: $('mapMode'),
    scan: $('mapScan'), stop: $('mapStop'), status: $('mapStatus'), progress: $('mapProgress'), bar: $('mapProgressBar'),
    connect: $('mapConnect'), cable: $('mapCable'), top: $('mapTop'), reset: $('mapReset'), tidy: $('mapTidy'), offline: $('mapOffline'), gCluster: $('mapGroupMove'), gCircles: $('mapGroupCircles'),
    hint: $('mapHint'), legend: $('mapLegend'), tip: $('mapTip'), empty: $('mapEmpty'), side: $('mapSide'),
    list: $('mapList'), listBtn: $('mapListBtn'), alerts: $('mapAlerts'), services: $('mapServices'), toasts: $('mapToasts'),
    live: $('mapLive'), liveDot: $('mapLiveDot'), liveText: $('mapLiveText'), addSwitch: $('mapAddSwitch')
  };

  const OS_COLORS = { router: 0x06b6d4, windows: 0x3b82f6, linux: 0x22c55e, apple: 0xd1d5db, android: 0x84cc16, iot: 0xf97316, console: 0xf43f5e, printer: 0xf472b6, network: 0xa855f7, switch: 0xeab308, unknown: 0x6b7280 };
  const OS_NAMES = {
    router: 'Router', windows: 'Windows', linux: 'Linux / Unix', apple: 'Apple (macOS / iOS)', android: 'Android', iot: 'IoT / smart device', console: 'Game console', printer: 'Printer',
    network: 'Router / network device', switch: 'Switch', unknown: 'Unknown'
  };
  const LIVE_CHOICES = [0, 15, 30, 60, 120, 300, 600, 1800];
  const HTTPS_PORTS = new Set([443, 5001, 8006, 8443, 8920, 9443]);
  const WEB_PORTS = new Set([1880, 3002, 4533, 5055, 5173, 5230, 5601, 5678, 6767, 7474, 8082, 8083, 8085, 8086, 8088, 8090, 8112, 8181, 8686, 8787, 8920, 9001, 9117, 9200, 9696, 10000, 28080, 80, 81, 443, 3000, 3001, 5000, 5001, 7878, 8000, 8006, 8008, 8080, 8081, 8096, 8123, 8200, 8384, 8443, 8888, 8989, 9000, 9090, 9091, 9443, 19999, 32400]);

  // ---------- saved data ----------
  let net = null;

  function validIp(s) {
    if (typeof s !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return false;
    return s.split('.').every((p) => Number(p) <= 255);
  }
  function normMac(m) {
    if (typeof m !== 'string') return null;
    const h = m.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (h.length !== 12 || h === '000000000000' || h === 'ffffffffffff') return null;
    return h.match(/../g).join(':');
  }
  const text = (v, max) => String(v === null || v === undefined ? '' : v).slice(0, max || 100);
  const FLOOR_Y = -1.1;   // the grid floor sits just under the machines
  const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? Math.max(-300, Math.min(300, v)) : fallback);

  function spiralPos(i) {
    const angle = i * 2.39996;
    const r = 11 + 3.2 * Math.sqrt(i);
    return { x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r };
  }

  function cleanExtras(d) {
    const info = d.info && typeof d.info === 'object' ? d.info : {};
    const names = {};
    if (d.svcNames && typeof d.svcNames === 'object') {
      Object.keys(d.svcNames).slice(0, 60).forEach((k) => { if (/^\d{1,5}$/.test(k) && Number(k) >= 1 && Number(k) <= 65535) names[k] = text(d.svcNames[k], 40); });
    }
    return {
      vlan: text(d.vlan || '', 30),
      info: {
        brand: text(info.brand || '', 60),
        model: text(info.model || '', 60),
        ports: Number.isInteger(info.ports) && info.ports >= 0 && info.ports <= 1024 ? info.ports : null,
        notes: text(info.notes || '', 400),
        webUrl: typeof info.webUrl === 'string' && /^https?:\/\/[^\s<>"']{1,200}$/.test(info.webUrl) ? info.webUrl : ''
      },
      services: (Array.isArray(d.services) ? d.services : []).slice(0, 30).filter((s) => s && typeof s === 'object').map((s) => ({
        id: text(s.id || '', 20).replace(/[^a-zA-Z0-9]/g, ''),
        name: text(s.name || '', 40),
        port: Number.isInteger(s.port) && s.port >= 1 && s.port <= 65535 ? s.port : null,
        kind: s.kind === 'vpn' ? 'vpn' : 'service'
      })),
      svcNames: names,
      svcHidden: (Array.isArray(d.svcHidden) ? d.svcHidden : []).slice(0, 100).filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535),
      autoVpn: (Array.isArray(d.autoVpn) ? d.autoVpn : []).slice(0, 6).map((v) => text(v, 40))
    };
  }

  function cleanDevice(key, d) {
    const out = {
      key: key,
      ip: validIp(d.ip) ? d.ip : (key.startsWith('ip:') && validIp(key.slice(3)) ? key.slice(3) : ''),
      mac: /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(d.mac || '') ? d.mac : (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(key) ? key : null),
      vendor: d.vendor ? text(d.vendor, 60) : null,
      hostname: d.hostname ? text(d.hostname, 80) : null,
      label: text(d.label || '', 60),
      group: text(d.group || '', 30),
      connSeen: d.connSeen === 'wireless' || d.connSeen === 'wired' ? d.connSeen : null,
      attach: d.attach && typeof d.attach === 'object' ? { via: text(d.attach.via || '', 100), speed: speedNum(d.attach.speed), speedRx: speedNum(d.attach.speedRx), signal: Number.isFinite(d.attach.signal) ? Math.round(d.attach.signal) : null, by: text(d.attach.by || '', 40), port: text(d.attach.port || '', 30), parentKey: typeof d.attach.parentKey === 'string' ? text(d.attach.parentKey, 80) : '' } : null,
      portTable: Array.isArray(d.portTable) ? d.portTable.slice(0, 128).filter((p) => p && typeof p === 'object' && p.name).map((p) => ({ name: text(p.name, 30), up: p.up === true, speed: speedNum(p.speed) })) : [],
      portTableAt: Number.isFinite(d.portTableAt) ? d.portTableAt : null,
      speedSet: speedNum(d.speedSet),
      shares: Array.isArray(d.shares) ? d.shares.slice(0, 60).filter((s) => s && typeof s === 'object' && s.name).map((s) => ({ name: text(s.name, 120), type: text(s.type || 'Disk', 10), comment: text(s.comment || '', 120), proto: ['SMB', 'NFS'].includes(s.proto) ? s.proto : 'SMB' })) : [],
      sharesAt: Number.isFinite(d.sharesAt) ? d.sharesAt : null,
      dns: d.dns && typeof d.dns === 'object' && d.dns.server === true ? { server: true, recursive: d.dns.recursive === true, refused: d.dns.refused === true, software: text(d.dns.software || '', 60) } : null,
      dnsAt: Number.isFinite(d.dnsAt) ? d.dnsAt : null,
      uplinkSpeed: speedNum(d.uplinkSpeed),
      uplinkPort: d.uplinkPort ? text(d.uplinkPort, 30) : null,
      osOverride: OS_NAMES[d.osOverride] && d.osOverride !== 'router' ? d.osOverride : null,
      os: d.os && typeof d.os === 'object'
        ? { id: OS_NAMES[d.os.id] ? d.os.id : 'unknown', label: text(d.os.label, 40), confidence: text(d.os.confidence, 10), reasons: Array.isArray(d.os.reasons) ? d.os.reasons.slice(0, 12).map((r) => text(r, 120)) : [] }
        : { id: 'unknown', label: 'Unknown', confidence: 'low', reasons: [] },
      ports: Array.isArray(d.ports) ? d.ports.slice(0, 200).filter((p) => p && Number.isInteger(p.port)).map((p) => ({
        port: p.port, service: p.service ? text(p.service, 40) : null, banner: p.banner ? text(p.banner, 100) : null, title: p.title ? text(p.title, 80) : null
      })) : [],
      ttl: Number.isInteger(d.ttl) ? d.ttl : null,
      self: !!d.self,
      linkSpeed: d.linkSpeed && typeof d.linkSpeed === 'object' && speedNum(d.linkSpeed.mbps) ? { mbps: speedNum(d.linkSpeed.mbps), wireless: d.linkSpeed.wireless === true } : null,
      online: d.online !== false,
      manual: key.startsWith('manual:'),
      misses: 0,
      lastSeen: typeof d.lastSeen === 'number' ? d.lastSeen : null,
      firstSeen: Number.isFinite(d.firstSeen) && d.firstSeen > 0 ? d.firstSeen : null,
      onlineSince: Number.isFinite(d.onlineSince) && d.onlineSince > 0 ? d.onlineSince : null,
      upInfo: d.upInfo && typeof d.upInfo === 'object' && Number.isFinite(d.upInfo.sec) && d.upInfo.sec >= 0 && d.upInfo.sec <= 3153600000 && Number.isFinite(d.upInfo.at) && d.upInfo.at > 0 ? { sec: Math.floor(d.upInfo.sec), at: d.upInfo.at, kind: d.upInfo.kind === 'connected' ? 'connected' : 'device' } : null,
      isRouter: key === 'router',
      pos: { x: 0, y: 0, z: 0 }
    };
    if (d.pos) out.pos = { x: num(d.pos.x, 0), y: 0, z: num(d.pos.z, 0) };      // every machine sits on the same flat level
    return Object.assign(out, cleanExtras(d));
  }

  // ---------- LAN speedtest ----------
  // Asks the saved routers / access points / managed switches for their latest reports, then says what each machine's link rate is.
  // It reads the rate the two ends agreed on; it does not send test traffic, so a machine nobody reports on shows "not reported".
  async function runLanSpeedtest(list) {
    const devs = list.filter((d) => d && !d.isRouter);
    if (!devs.length) return 'Pick a machine first.';
    const hub = window.hubConnections;
    if (!hub || !hub.refreshNow) return 'Router and switch connections are not available here.';
    let r;
    try { r = await hub.refreshNow(); } catch (e) { r = null; }
    if (!r || r.none) return 'No router, access point or switch connections are set up yet. Add one under Router & switch links, then run the test again.';
    const lines = devs.slice(0, 8).map((d) => {
      const cur = net.devices[d.key] || d;
      const at = cur.attach && typeof cur.attach === 'object' ? cur.attach : null;
      const s = cur.self && cur.linkSpeed ? speedLabel(cur.linkSpeed.mbps, null, cur.linkSpeed.wireless) : at ? speedLabel(at.speed, at.speedRx, at.wireless) : '';
      return title(cur) + ': ' + (s ? s + (at && at.by ? ' (reported by ' + at.by + ')' : '') : 'not reported by your router or switch');
    });
    if (devs.length > 8) lines.push('...and ' + (devs.length - 8) + ' more.');
    return lines.join('\n');
  }

  // ---------- Wake-on-LAN ----------
  const waking = new Map();         // device key -> when the signal was sent
  async function wakeDevices(list) {
    const withMac = list.filter((d) => d && d.mac && !d.isRouter);
    if (!withMac.length) { setStatus('That machine has no hardware (MAC) address, so it cannot be woken.', true); return 'No hardware address.'; }
    if (!window.netApi || !window.netApi.wake) { setStatus('Wake-on-LAN only works inside the Dashboard Hub app.', true); return 'Not available here.'; }
    let res;
    // a server with a management chip (iLO / iDRAC) linked to it is switched on through that as well: it works even when Wake-on-LAN does not
    const viaBmc = [];
    for (const d of withMac) {
      const es = window.hubBmcFor && window.bmcApi ? window.hubBmcFor(d.mac) : [];
      if (es.length) { try { const r = await window.bmcApi.power(es[0].id, 'on'); if (r && r.ok) viaBmc.push(d); } catch (e) { /* the normal wake-up still goes out */ } }
    }
    try { res = await window.netApi.wake(withMac.map((d) => d.mac)); } catch (e) { res = { ok: false, error: 'The wake-up signal could not be sent.' }; }
    if ((!res || !res.ok) && viaBmc.length) res = { ok: true };
    if (!res || !res.ok) { const m = (res && res.error) || 'The wake-up signal could not be sent.'; setStatus(m, true); return m; }
    const names = withMac.map((d) => title(d));
    const msg = 'Wake-up signal sent to ' + (names.length === 1 ? names[0] : names.length + ' machines') + (viaBmc.length ? ' (and a power-on through its server management chip)' : '') + '. Machines that are set up for Wake-on-LAN start within a few seconds.';
    setStatus(msg);
    withMac.filter((d) => d.online === false).forEach((d) => waking.set(d.key, { t: Date.now(), told: false }));
    [6000, 20000, 45000, 75000, 120000, 180000, 300000].forEach((ms) => setTimeout(() => { if (!scanKind && waking.size) startScan({ background: true }); }, ms));       // slow boots take minutes
    return msg;
  }
  setInterval(() => {
    waking.forEach((w, key) => {
      const d = net.devices[key];
      if (!d) { waking.delete(key); return; }
      const age = Date.now() - w.t;
      if (d.online !== false && age > 3000) { waking.delete(key); setStatus(title(d) + ' is awake.'); renderSide(); return; }       // seen online by a scan or a router check
      if (age > 180000 && !w.told) { w.told = true; setStatus(title(d) + ' has not shown up yet. Slow computers can take a few minutes, so Dashboard Hub keeps watching. If it never wakes, check that Wake-on-LAN is on in its BIOS and network card settings.', true); }
      if (age > 900000) waking.delete(key);
    });
  }, 3000);

  // ---------- file sharing (SMB, NFS, Apple, FTP, WebDAV...) ----------
  const SHARE_PORTS = { 445: 'SMB', 139: 'SMB', 2049: 'NFS', 548: 'AFP', 21: 'FTP', 873: 'rsync', 5005: 'WebDAV', 5006: 'WebDAV', 3260: 'iSCSI' };
  function shareKinds(d) {
    const out = [];
    (d.ports || []).forEach((p) => { const k = SHARE_PORTS[p.port]; if (k && !out.includes(k)) out.push(k); });
    return out;
  }

  // link speed: whole number of Mbps, shown as Mbps or Gbps
  function speedNum(v) { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 200000 ? Math.round(n * 10) / 10 : null; }
  function speedFmt(n) { return n >= 1000 ? (Math.round(n / 100) / 10) + ' Gbps' : n + ' Mbps'; }
  function speedLabel(tx, rx, wireless) {
    const a = speedNum(tx), b = speedNum(rx);
    if (!a && !b) return '';
    if (a && b && a !== b) return '\u2193 ' + speedFmt(a) + ' \u00b7 \u2191 ' + speedFmt(b);
    return speedFmt(a || b);
  }
  function ensureNetwork(override) {
    const src = override && typeof override === 'object' ? override : (state.network && typeof state.network === 'object' ? state.network : {});
    const n = {
      router: validIp(src.router) ? src.router : '192.168.0.1',
      routerUser: !!src.routerUser,
      cidr: typeof src.cidr === 'string' ? src.cidr.slice(0, 20) : '',
      mode: src.mode === 'thorough' ? 'thorough' : 'quick',
      showOffline: src.showOffline === true,
      groupCluster: src.groupCluster !== false,
      groupCircles: src.groupCircles !== false,
      autoSeconds: LIVE_CHOICES.includes(Number(src.autoSeconds)) ? Number(src.autoSeconds) : 60,
      scannedOnce: !!src.scannedOnce,
      presenceAt: Number.isFinite(src.presenceAt) && src.presenceAt > 0 ? src.presenceAt : 0,
      alerts: ['off', 'app', 'desktop'].includes(src.alerts) ? src.alerts : 'app',
      showServices: src.showServices === true,
      removedReturn: true,
      // older versions kept removed machines away for good; now they come back when found again
      ignored: src.removedReturn === true && Array.isArray(src.ignored) ? src.ignored.filter((k) => typeof k === 'string' && k.length < 40).slice(0, 500) : [],
      devices: {},
      links: []
    };
    const devs = src.devices && typeof src.devices === 'object' ? src.devices : {};
    Object.keys(devs).slice(0, 2000).forEach((key) => {
      if (devs[key] && typeof devs[key] === 'object') n.devices[key] = cleanDevice(key, devs[key]);
    });
    if (!n.devices.router) {
      n.devices.router = cleanDevice('router', { ip: n.router, os: { id: 'network', label: OS_NAMES.network, confidence: 'high', reasons: ['this is your router'] }, online: true });
    }
    n.devices.router.ip = n.router;
    n.devices.router.pos = { x: 0, y: 0, z: 0 };
    // "online for X days" only counts time the app was watching: if it was closed for a while, the count starts again
    Object.values(n.devices).forEach((d) => {
      const ref = d.lastSeen || n.presenceAt || 0;
      if (d.onlineSince && ref && Date.now() - ref > PRESENCE_GAP_MS) d.onlineSince = null;
    });
    if (Array.isArray(src.links)) {
      const seen = new Set();
      src.links.slice(0, 5000).forEach((l) => {
        if (!l || !n.devices[l.a] || !n.devices[l.b] || l.a === l.b) return;
        const id = linkId(l.a, l.b);
        if (seen.has(id)) return;
        seen.add(id);
        n.links.push({ a: l.a, b: l.b, auto: !!l.auto, cable: l.cable === true && !l.auto, wireless: l.cable === true && !l.auto ? false : l.wireless === true ? true : l.wireless === false ? false : null });
      });
    }
    state.network = n;
    net = n;
  }

  const PRESENCE_GAP_MS = 2 * 3600 * 1000;
  // Keeps "first seen" and "online since" up to date. Runs on every save, so the count follows scans and router checks.
  function trackPresence() {
    if (!net) return;
    const now = Date.now();
    Object.values(net.devices).forEach((d) => {
      if (d.manual && !d.ip && !d.lastSeen) return;
      if (d.online === false) { d.onlineSince = null; d.upInfo = null; return; }
      if (!d.onlineSince) d.onlineSince = now;
      if (!d.firstSeen) d.firstSeen = d.lastSeen || now;
    });
    net.presenceAt = now;
  }
  // The device's own report (seconds), moved forward by the time since we heard it. Null once it is offline.
  function reportedUp(d) {
    if (!d.upInfo || d.online === false) return null;
    return d.upInfo.sec + Math.max(0, Math.round((Date.now() - d.upInfo.at) / 1000));
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const days = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (days >= 1) return days + (days === 1 ? ' day' : ' days') + (h ? ' ' + h + ' h' : '');
    if (h >= 1) return h + ' h' + (m ? ' ' + m + ' min' : '');
    if (m >= 1) return m + ' min';
    return 'under a minute';
  }
  function save() { try { trackPresence(); saveState(); if (window.hubProfilesCapture) window.hubProfilesCapture(); } catch (e) { /* ignore */ } }
  const linkId = (a, b) => (a < b ? a + '~' + b : b + '~' + a);
  const devices = () => Object.values(net.devices);
  const effectiveOs = (d) => (d.isRouter ? 'router' : (d.osOverride || (d.os && d.os.id) || 'unknown'));
  function title(d) {
    if (d.label) return d.label;
    if (d.isRouter) return 'Router';
    if (d.hostname) return d.hostname;
    const web = (d.ports || []).find((p) => p.title);
    if (web) return web.title;
    if (d.vendor && !/^Private/.test(d.vendor)) return d.vendor;
    return d.ip || 'Unknown device';
  }
  function ipSort(a, b) {
    const pa = (a.ip || '0.0.0.0').split('.').map(Number), pb = (b.ip || '0.0.0.0').split('.').map(Number);
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  }

  // ---------- merging scan results ----------
  let seenKeys = new Set();
  const wifiClaims = new Map();      // machine key -> Map(parent key -> { first, last }): who said "this machine is on my Wi-Fi", and since when
  let newCount = 0;
  let scanVlan = '';            // set while scanning a VLAN network, so the machines found get that VLAN label
  let alertBase = false;         // alerts only start after the first full scan
  let alertQueue = [];

  function rekey(oldKey, newKey) {
    const dev = net.devices[oldKey];
    if (!dev || oldKey === newKey) return;
    const other = net.devices[newKey];
    if (other) {            // the same machine already has a record: keep that one and merge custom attributes
      if (dev.label && !other.label) other.label = dev.label;
      if (dev.label && other.label === '') other.label = dev.label;
      if (dev.group && !other.group) other.group = dev.group;
      if (dev.osOverride && !other.osOverride) other.osOverride = dev.osOverride;
      if (dev.vlan && !other.vlan) other.vlan = dev.vlan;
      if (dev.attach) other.attach = Object.assign({}, dev.attach, other.attach || {});
      if (dev.info) other.info = Object.assign({}, dev.info, other.info || {});
      if (dev.svcNames) other.svcNames = Object.assign({}, dev.svcNames, other.svcNames || {});
      if (dev.services && dev.services.length) {
        const existing = new Set((other.services || []).map((s) => s.id));
        other.services = (other.services || []).concat(dev.services.filter((s) => !existing.has(s.id)));
      }
      net.links.forEach((l) => {
        if (l.a === oldKey) l.a = newKey;
        if (l.b === oldKey) l.b = newKey;
      });
      const seenLinkIds = new Set();
      net.links = net.links.filter((l) => {
        if (l.a === l.b) return false;
        const id = linkId(l.a, l.b);
        if (seenLinkIds.has(id)) return false;
        seenLinkIds.add(id);
        return true;
      });
      if (selected && selected.type === 'node' && selected.key === oldKey) selected.key = newKey;
      if (pending === oldKey) pending = newKey;
      delete net.devices[oldKey];
      removeNode(oldKey);
      seenKeys.delete(oldKey);
      return;
    }
    const n = nodes.get(oldKey);
    if (n) {
      nodes.set(newKey, n);
      nodes.delete(oldKey);
      if (n.mesh && n.mesh.userData) n.mesh.userData.key = newKey;
    }
    net.devices[newKey] = dev;
    delete net.devices[oldKey];
    dev.key = newKey;
    net.links.forEach((l) => { if (l.a === oldKey) l.a = newKey; if (l.b === oldKey) l.b = newKey; });
    devices().forEach((d) => { if (d.attach && d.attach.parentKey === oldKey) d.attach.parentKey = newKey; });
    if (selected && selected.type === 'node' && selected.key === oldKey) selected.key = newKey;
    if (pending === oldKey) pending = newKey;
    seenKeys.delete(oldKey);
  }

  function mergeHost(h) {
    if (!h) return null;
    const mac = normMac(h.mac);
    const hasIp = validIp(h.ip);
    if (!hasIp && !mac) return null;
    // machines you chose to ignore stay hidden (a plain "Remove from map" does not do this)
    if (hasIp && h.ip !== net.router && ((mac && net.ignored.includes(mac)) || net.ignored.includes('ip:' + h.ip))) return null;
    let dev = null;
    if (hasIp && h.ip === net.router) dev = net.devices.router;
    if (!dev && mac) dev = devices().find((d) => !d.isRouter && d.mac && d.mac.toLowerCase() === mac) || null;
    if (!dev && hasIp) dev = net.devices['ip:' + h.ip] || null;
    if (!dev && hasIp) dev = devices().find((d) => !d.isRouter && d.manual && d.ip === h.ip) || null;   // a switch you added by hand
    if (!dev && !mac && hasIp) dev = devices().find((d) => !d.isRouter && d.ip === h.ip && !seenKeys.has(d.key)) || null;
    let created = false;
    if (!dev) {
      const key = mac || (hasIp ? 'ip:' + h.ip : newId());
      dev = cleanDevice(key, { ip: hasIp ? h.ip : '', pos: spiralPos(devices().length) });
      net.devices[key] = dev;
      const hasLink = net.links.some((l) => l.a === key || l.b === key);
      if (!hasLink) {
        net.links.push({ a: 'router', b: key, auto: true });
      }
      created = true;
      newCount++;
      alertEvent('new', dev);
    }
    if (hasIp) dev.ip = h.ip;
    if (mac) {
      dev.mac = mac;
      if (!dev.isRouter && !dev.manual && dev.key !== mac) { rekey(dev.key, mac); dev = net.devices[mac] || dev; }
    }
    if (h.vendor) dev.vendor = text(h.vendor, 60);
    // an early or "still there" report must not wipe what a full scan found earlier
    const full = !h.scanning && !h.portsSkipped;
    if (full) {
      if (h.hostname) dev.hostname = text(h.hostname, 80);
      dev.ports = cleanDevice(dev.key, { ports: h.ports }).ports;
    }
    if (created || full) {
      const wasSwitch = effectiveOs(dev) === 'switch';
      dev.os = cleanDevice(dev.key, { os: h.os }).os;
      if (!wasSwitch && !dev.osOverride && dev.os.id === 'switch' && !dev.info.brand) dev.info.brand = brandHint(dev);   // first time a scan recognises a switch: fill in the maker if it is known
      dev.ttl = Number.isInteger(h.ttl) ? h.ttl : dev.ttl;
    }
    if (!created && dev.online === false) {
      alertEvent('back', dev);
      // detected again: a machine whose line was deleted while it was offline gets its line back now (a router check may then place it better)
      if (!dev.isRouter && !net.links.some((l) => l.a === dev.key || l.b === dev.key)) net.links.push({ a: 'router', b: dev.key, auto: true });
    }
    if (scanVlan && !dev.vlan) dev.vlan = scanVlan;
    if (full && h.self && Array.isArray(h.vpn)) dev.autoVpn = h.vpn.slice(0, 6).map((v) => text(v, 40));
    dev.self = !!h.self;
    dev.lastSeen = Date.now();
    dev.online = true;
    dev.misses = 0;
    seenKeys.add(dev.key);
    return dev;
  }

  // ---------- 3D scene ----------
  let renderer = null, scene = null, camera = null, controls = null, raycaster = null, canvas = null;
  let webglFailed = false, softwareGl = false, glLost = false, glLostTimer = null;
  const nodes = new Map();      // device key -> { group, mesh, edges, sprite, sig }
  const linkObjs = new Map();   // link id -> { group, vis, pick, a, b }
  let nodeGeo, routerGeo, switchGeo, linkGeo, svcGeo;
  let animateNew = false;       // new/lost machines pop in and out (switched on once the map has been drawn)
  const typeFilter = new Set();   // kinds ticked in the colour key (none ticked = show everything)
  let selected = null;          // { type:'node', key } or { type:'link', id }
  let pending = null;           // first machine picked while drawing a line
  let connectMode = false;
  let running = false;
  let syncQueued = false;
  let fitted = false;

  function initThree() {
    if (renderer || webglFailed) return !webglFailed;
    if (!THREE || !OrbitControls) { webglFailed = true; return false; }
    try {
      // smooth edges first; some graphics drivers refuse that, so try again without it before giving up
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
      catch (e1) { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true }); }
    } catch (e) {
      webglFailed = true;
      els.empty.textContent = 'The 3D map could not start because this computer\'s graphics are not available.';
      els.empty.classList.remove('hidden');
      return false;
    }
    // software drawing (no real graphics card) is slow and heats the processor: keep that case light
    try {
      const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      softwareGl = !!dbg && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)));
    } catch (e) { softwareGl = false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, softwareGl ? 1 : 2));
    canvas = renderer.domElement;
    // the graphics driver can reset (a driver update, sleep, a crash it recovers from): pause while the picture is gone, then carry on
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      glLost = true;
      clearTimeout(glLostTimer);
      glLostTimer = setTimeout(() => { if (glLost) { els.empty.textContent = 'The graphics driver reset and has not come back yet. The map will return by itself; if it does not, close and reopen Dashboard Hub, or switch the graphics card off in Settings.'; els.empty.classList.remove('hidden'); } }, 6000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      glLost = false; clearTimeout(glLostTimer);
      updateEmptyMessage();
      queueSync(); wakeLoop();
    });
    canvas.tabIndex = 0;
    els.wrap.insertBefore(canvas, els.wrap.firstChild);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
    camera.position.set(0, 30, 42);
    raycaster = new THREE.Raycaster();

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(20, 40, 30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-30, 10, -20);
    scene.add(fill);

    const grid = new THREE.GridHelper(160, 32, 0x2c3340, 0x1c2330);
    grid.position.y = FLOOR_Y;
    scene.add(grid);

    nodeGeo = new THREE.BoxGeometry(3.2, 2, 2);
    routerGeo = new THREE.BoxGeometry(5.6, 1.7, 3.6);
    switchGeo = new THREE.BoxGeometry(5.6, 0.9, 2.6);
    linkGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    svcGeo = new THREE.BoxGeometry(1.5, 1.1, 1.5);

    // add my handlers first (capture) so a drag on a machine moves it instead of rotating the camera
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    ['pointermove', 'pointerdown', 'wheel', 'keydown'].forEach((ev) => canvas.addEventListener(ev, wakeLoop, { passive: true }));
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', () => { els.tip.classList.add('hidden'); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 400;
    controls.minDistance = 4;

    if (window.ResizeObserver) new ResizeObserver(resize).observe(els.wrap);
    window.addEventListener('resize', resize);
    resize();
    return true;
  }

  let lastW = 0, lastH = 0, lastDpr = 0;
  function resize() {
    wakeLoop();
    if (!renderer) return;
    const w = Math.max(1, els.wrap.clientWidth), h = Math.max(1, els.wrap.clientHeight);
    // resizing the picture is expensive (the graphics card has to make a new one): do it only when the size really changed
    if (w === lastW && h === lastH && (window.devicePixelRatio || 1) === lastDpr) return;
    lastW = w; lastH = h; lastDpr = window.devicePixelRatio || 1;
    // never ask for more than about a 4K picture, however big the window or sharp the screen
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, softwareGl ? 1 : 2, Math.sqrt(8500000 / (w * h))));
    if (Math.abs(renderer.getPixelRatio() - pr) > 0.01) renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function easeOutBack(k) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }

  // machines pop in when they join and shrink away when they leave
  function stepAnimations() {
    const t = performance.now();
    let active = false;
    nodes.forEach((n) => {
      if (!n.anim) return;
      active = true;
      const k = Math.min(1, (t - n.anim.t0) / (n.anim.type === 'in' ? 550 : 350));
      n.scale = n.anim.type === 'in' ? easeOutBack(k) : n.anim.from * (1 - k * k);
      if (k >= 1) { n.anim = null; n.scale = n.shown ? 1 : 0; n.group.visible = n.shown; }
      n.group.scale.setScalar(Math.max(0.001, n.scale));
    });
    if (active) { net.links.forEach((l) => { const o = linkObjs.get(linkId(l.a, l.b)); if (o) placeLink(o, l); }); syncServices(); }
  }

  // Saves battery and fan noise: when nothing has moved for a couple of seconds the 3D view redraws about 15 times a second
  // instead of 60, and goes back to full speed the moment you touch the map or something changes.
  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);   // people who ask their computer for less motion get steady lines
  var pulseWanted = true;
  try { pulseWanted = localStorage.getItem('hubLinkPulse') !== 'off'; } catch (e) { /* no saved choice: blinking stays on */ }
  var pulseOn = pulseWanted && !reducedMotion;
  (function () {
    const chk = document.getElementById('pulseCheck');
    if (!chk) return;
    chk.checked = pulseWanted;
    chk.addEventListener('change', () => {
      pulseWanted = chk.checked; pulseOn = pulseWanted && !reducedMotion;
      try { localStorage.setItem('hubLinkPulse', pulseWanted ? 'on' : 'off'); } catch (e) { /* choice lasts until the app closes */ }
      if (!pulseOn) linkObjs.forEach((o) => { o.vis.material.opacity = 1; });
      wakeLoop();
    });
  })();
  var lastMove = performance.now(), lastCam = '', lastDraw = 0, loopGen = 0, idleTimer = null;
  // Anything that touches the map wakes it up at once (also when it was sleeping between slow redraws).
  function wakeLoop() {
    lastMove = performance.now();
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; if (running) next(0); }
  }
  // Schedules the next pass: now (on the next screen refresh) or after a pause. A pass belongs to one "generation", so a stop
  // followed by a quick start can never leave two loops running at the same time.
  function next(ms) {
    const g = loopGen;
    if (ms > 0) idleTimer = setTimeout(() => { idleTimer = null; if (running && g === loopGen) requestAnimationFrame(() => loop(g)); }, ms);
    else requestAnimationFrame(() => loop(g));
  }
  function loop(g) {
    if (!running || g !== loopGen) return;
    // nobody can see the picture (window hidden in the tray, minimised, or the graphics were reset): draw nothing, look again in a second
    if (window.hubWindowHidden || document.hidden || glLost) { next(1000); return; }
    const now = performance.now();
    stepAnimations();
    controls.update();
    if (keepMapInView()) controls.update();
    const cam = camera.position.x.toFixed(2) + camera.position.y.toFixed(2) + camera.position.z.toFixed(2) + controls.target.x.toFixed(2) + controls.target.y.toFixed(2) + controls.target.z.toFixed(2);
    let busy = cam !== lastCam; lastCam = cam;
    nodes.forEach((x) => { if (x.anim) busy = true; });
    if (busy) lastMove = now;
    let anyPulse = false;
    if (pulseOn) linkObjs.forEach((o) => { if (o.pulse) anyPulse = true; });
    if (now - lastMove > 2000) {
      // Resting: redraw only as often as the blinking needs (about 15 times a second, 10 after a minute of rest, 5 after five minutes), or once every half
      // second when nothing moves at all. This is by time, so a 144 Hz or 240 Hz screen does not draw more often than a 60 Hz one.
      const rest = now - lastMove;
      const wait = anyPulse ? (rest > 300000 ? 200 : rest > 60000 ? 100 : 66) : (softwareGl ? 1000 : 500);
      const since = now - lastDraw;
      if (since < wait) { next(Math.max(4, wait - since - 6)); return; }
    }
    if (anyPulse) { const t = now / 1000; linkObjs.forEach((o) => { if (o.pulse) { const sv = 0.7 * Math.sin(t * 2.4 + o.phase) + 0.3 * Math.sin(t * 5.1 + o.phase * 1.7); o.vis.material.opacity = 0.7 + 0.3 * sv; } }); }
    renderer.render(scene, camera);
    lastDraw = now;
    next(0);
  }
  function startLoop() { if (renderer && !running) { running = true; loopGen++; next(0); } }
  function stopLoop() { running = false; loopGen++; if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
  // the app window was hidden or shown (the main program tells the page): wake up right away when it comes back
  window.addEventListener('hub-visibility', wakeLoop);
  document.addEventListener('visibilitychange', wakeLoop);

  // label sprite
  function labelTexture(lines, dim) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 176;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(11,13,17,0.78)';
    const r = 22;
    g.beginPath();
    g.moveTo(r, 4); g.lineTo(c.width - r, 4); g.quadraticCurveTo(c.width - 4, 4, c.width - 4, r);
    g.lineTo(c.width - 4, c.height - r); g.quadraticCurveTo(c.width - 4, c.height - 4, c.width - r, c.height - 4);
    g.lineTo(r, c.height - 4); g.quadraticCurveTo(4, c.height - 4, 4, c.height - r);
    g.lineTo(4, r); g.quadraticCurveTo(4, 4, r, 4); g.closePath(); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = (s, font, max) => {
      g.font = font;
      let t = s;
      while (g.measureText(t).width > max && t.length > 3) t = t.slice(0, -2);
      return t === s ? s : t.replace(/\s+$/, '') + '…';
    };
    g.fillStyle = dim ? '#8a93a5' : '#ffffff';
    g.fillText(fit(lines[0], 'bold 54px "Segoe UI", system-ui, sans-serif', 480), 256, 48);
    g.fillStyle = dim ? '#6f788a' : '#8db8ff';
    g.fillText(fit(lines[1], '44px Consolas, "DejaVu Sans Mono", monospace', 480), 256, 98);
    g.fillStyle = '#8a93a5';
    g.fillText(fit(lines[2], '32px "Segoe UI", system-ui, sans-serif', 480), 256, 143);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function nodeVisible(d) {
    if (d.isRouter) return true;
    if (typeFilter.size && !(keepKeys && keepKeys.has(d.key))) return false;      // the colour key: only the ticked kinds (and the switches on the way to them)
    if (typeFilter.size && pathKeys && pathKeys.has(d.key)) return true;          // network gear and switches on the way stay, even if offline or not ticked
    if (d.manual && !d.ip) return true;               // a switch you drew has no address to check
    return d.online !== false || net.showOffline;
  }

  function geoFor(d) {
    if (d.isRouter) return routerGeo;
    return effectiveOs(d) === 'switch' ? switchGeo : nodeGeo;
  }

  function ensureNode(d) {
    let n = nodes.get(d.key);
    const geo = geoFor(d);
    if (!n) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x000000, roughness: 0.45, metalness: 0.15, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.key = d.key;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff }));
      edges.scale.setScalar(1.14);
      edges.visible = false;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
      sprite.renderOrder = 10;
      const group = new THREE.Group();
      group.add(mesh, edges, sprite);
      scene.add(group);
      n = { group: group, mesh: mesh, edges: edges, sprite: sprite, sig: '', geo: geo, shown: null, scale: 1, anim: null };
      nodes.set(d.key, n);
    }
    if (n.geo !== geo) {                               // its type changed (for example to Switch)
      n.geo = geo;
      n.mesh.geometry = geo;
      n.edges.geometry.dispose();
      n.edges.geometry = new THREE.EdgesGeometry(geo);
      n.sig = '';
    }
    // appearing and disappearing
    const want = nodeVisible(d);
    if (n.shown === null) {
      n.shown = want;
      if (want && animateNew && running && !d.isRouter) { n.scale = 0.001; n.anim = { type: 'in', t0: performance.now() }; }
      else n.scale = want ? 1 : 0;
    } else if (want !== n.shown) {
      n.shown = want;
      if (running) n.anim = { type: want ? 'in' : 'out', t0: performance.now(), from: n.scale || 1 };
      else { n.anim = null; n.scale = want ? 1 : 0; }
    }
    n.group.visible = n.shown || !!n.anim;
    n.group.scale.setScalar(Math.max(0.001, n.scale));
    // position and look
    n.group.position.set(d.pos.x, d.pos.y, d.pos.z);
    const os = effectiveOs(d);
    const color = OS_COLORS[os] || OS_COLORS.unknown;
    n.mesh.material.color.setHex(color);
    n.mesh.material.emissive.setHex(color);
    n.mesh.material.emissiveIntensity = d.online === false ? 0.05 : 0.3;
    n.mesh.material.opacity = d.online === false ? 0.35 : 1;
    const isSel = selected && selected.type === 'node' && selected.key === d.key;
    const isPending = pending === d.key;
    n.edges.visible = !!(isSel || isPending);
    n.edges.material.color.setHex(isPending ? 0xf59e0b : 0xffffff);

    const lines = [
      title(d),
      (d.ip || '') + (shareKinds(d).length ? '  \u25A4 files: ' + shareKinds(d).slice(0, 3).join('/') : ''),
      (d.online === false ? 'offline · ' : '') + (d.self ? 'this computer · ' : '') + OS_NAMES[os] + (os === 'switch' && (d.info.brand || d.info.ports) ? ' · ' + [d.info.brand, d.info.ports ? d.info.ports + '-port' : ''].filter(Boolean).join(' ') : (d.ports && d.ports.length ? ' · ' + d.ports.length + (d.ports.length === 1 ? ' port' : ' ports') : ''))
    ];
    const sig = lines.join('|') + '|' + (d.online === false);
    if (sig !== n.sig) {
      n.sig = sig;
      if (n.sprite.material.map) n.sprite.material.map.dispose();
      n.sprite.material.map = labelTexture(lines, d.online === false);
      n.sprite.material.needsUpdate = true;
      n.sprite.scale.set(10.5, 10.5 * 176 / 512, 1);
      n.sprite.position.set(0, geo.parameters.height / 2 + 0.4 + 1.8, 0);
    }
    return n;
  }

  function removeNode(key) {
    const n = nodes.get(key);
    if (!n) return;
    scene.remove(n.group);
    if (n.sprite.material.map) n.sprite.material.map.dispose();
    n.sprite.material.dispose();
    n.mesh.material.dispose();
    n.edges.geometry.dispose();
    n.edges.material.dispose();
    nodes.delete(key);
  }

  // A line is dotted when it is wireless. You can set it per line; "automatic" prioritizes authoritative AP / router reports or wireless device profiles.
  function isWireless(l) {
    if (l.cable === true && !l.auto) return false;      // a cable you drew is always a cable
    if (l.wireless === true) return true;
    if (l.wireless === false) return false;
    const ends = [l.a, l.b].map((k) => net.devices[k]).filter((d) => d && !d.isRouter);
    const wlSeen = ends.some((d) => d.connSeen === 'wireless' || (d.attach && (d.attach.wireless || /wi-?fi/i.test(d.attach.via || ''))));
    if (wlSeen) return true;
    const wiredSeen = ends.some((d) => d.connSeen === 'wired' || (d.attach && (/cable|ethernet|port/i.test(d.attach.via || ''))));
    if (wiredSeen) return false;
    return ends.some((d) => ['iot', 'android'].includes(effectiveOs(d)));
  }
  let dashCanvas = null;
  function dashTexture(len) {
    if (!dashCanvas) {
      dashCanvas = document.createElement('canvas');
      dashCanvas.width = 4; dashCanvas.height = 32;
      const c = dashCanvas.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, 4, 32);
      c.fillStyle = '#fff'; c.fillRect(0, 0, 4, 18);      // dash 18/32, gap 14/32
    }
    const t = new THREE.CanvasTexture(dashCanvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, Math.max(1, Math.round(len / 1.4)));
    return t;
  }
  function applyDash(o, wl, len) {
    const m = o.vis.material;
    if (!wl) {
      if (m.alphaMap) { m.alphaMap.dispose(); m.alphaMap = null; m.alphaTest = 0; m.needsUpdate = true; }
      m.transparent = true;
      o.dashLen = 0;
      return;
    }
    const want = Math.max(1, Math.round(len / 1.4));
    if (!m.alphaMap || o.dashLen !== want) {
      if (m.alphaMap) m.alphaMap.dispose();
      m.alphaMap = dashTexture(len);
      m.transparent = true;
      m.alphaTest = 0.15;            // low, so the dashes stay visible while the line fades
      m.needsUpdate = true;
      o.dashLen = want;
    }
  }

  function linkColor(l) {
    const isSel = selected && selected.type === 'link' && selected.id === linkId(l.a, l.b);
    if (isSel) return 0xf59e0b;
    if (l.cable === true && !l.auto) return 0xec4899;      // a physical cable you drew: pink (found-by-the-app lines stay green)
    return 0x2dd4bf;
  }

  function placeLink(o, l) {
    const A = net.devices[l.a], B = net.devices[l.b];
    const a = new THREE.Vector3(A.pos.x, A.pos.y, A.pos.z), b = new THREE.Vector3(B.pos.x, B.pos.y, B.pos.z);
    const dir = b.clone().sub(a);
    const len = Math.max(0.001, dir.length());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    o.group.position.copy(mid);
    o.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    o.vis.scale.set(0.09, len, 0.09);
    o.pick.scale.set(0.5, len, 0.5);
    const na = nodes.get(l.a), nb = nodes.get(l.b);
    const present = (n) => !n || n.shown || !!n.anim;
    o.group.visible = present(na) && present(nb);
    const sc = Math.max(0, Math.min(na ? na.scale : 1, nb ? nb.scale : 1));
    o.vis.material.color.setHex(linkColor(l));
    o.pulse = linkColor(l) === 0x2dd4bf && A.online !== false && B.online !== false;   // only lines to machines that are online blink                  // the green (found-by-the-app) lines blink gently; picked or hand-drawn ones stay steady
    if (!o.pulse) o.vis.material.opacity = 1;
    if (o.phase === undefined) { let h = 0; const id = linkId(l.a, l.b); for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; o.phase = (h / 9973) * 6.283; }
    const isSel = selected && selected.type === 'link' && selected.id === linkId(l.a, l.b);
    const wl = isWireless(l);
    applyDash(o, wl, len);
    o.vis.scale.x = o.vis.scale.z = (isSel ? 0.16 : (l.cable === true && !l.auto ? 0.14 : 0.09)) * Math.max(0.001, sc) * (wl ? 1.25 : 1);
  }

  // ---------- device groups: a soft circle around each named group, and the group can move as one ----------
  const groupObjs = new Map();   // group name -> { mesh, ring, sprite, label }
  let groupDiscGeo = null;
  const RING_W = 0.14;     // every group ring is this thick in map units, whatever the circle's size
  function groupColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return new THREE.Color().setHSL(h / 360, 0.65, 0.6);
  }
  function groupMembers(name) {
    return devices().filter((d) => !d.isRouter && d.group === name && nodeVisible(d));
  }
  function groupLabelTexture(name) {
    const font = 'bold 56px "Segoe UI", system-ui, sans-serif';
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    let t = name;
    while (m.measureText(t).width > 700 && t.length > 3) t = t.slice(0, -2);
    const w = Math.ceil(m.measureText(t).width) + 48, h = 96;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,12,20,0.78)';
    g.beginPath();
    if (g.roundRect) g.roundRect(2, 8, w - 4, h - 16, 24); else g.rect(2, 8, w - 4, h - 16);
    g.fill();
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.fillText(t, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { aspect: w / h };
    return tex;
  }
  function removeGroupObj(name) {
    const o = groupObjs.get(name);
    if (!o) return;
    scene.remove(o.mesh, o.ring, o.sprite);
    o.mesh.material.dispose(); o.ring.material.dispose(); o.ring.geometry.dispose();
    if (o.sprite.material.map) o.sprite.material.map.dispose();
    o.sprite.material.dispose();
    groupObjs.delete(name);
  }
  function syncGroups() {
    if (!renderer || !net) return;
    const want = new Map();
    if (net.groupCircles !== false) {
      devices().forEach((d) => {
        if (d.isRouter || !d.group || !nodeVisible(d)) return;
        if (!want.has(d.group)) want.set(d.group, []);
        want.get(d.group).push(d);
      });
    }
    Array.from(groupObjs.keys()).forEach((k) => { if (!want.has(k) || want.get(k).length < 2) removeGroupObj(k); });
    want.forEach((list, name) => {
      if (list.length < 2) return;
      let cx = 0, cz = 0;
      list.forEach((d) => { cx += d.pos.x; cz += d.pos.z; });
      cx /= list.length; cz /= list.length;
      let r = 0;
      list.forEach((d) => { r = Math.max(r, Math.hypot(d.pos.x - cx, d.pos.z - cz)); });
      r = Math.min(Math.max(r + 1.6, 2.2), 400);
      let o = groupObjs.get(name);
      if (!o) {
        if (!groupDiscGeo) { groupDiscGeo = new THREE.CircleGeometry(1, 96); }
        const col = groupColor(name);
        const mesh = new THREE.Mesh(groupDiscGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }));
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
        mesh.rotation.x = ring.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 1; ring.renderOrder = 1;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: groupLabelTexture(name), transparent: true, depthWrite: false, depthTest: false }));
        sprite.renderOrder = 6;
        scene.add(mesh, ring, sprite);
        o = { mesh: mesh, ring: ring, sprite: sprite };
        groupObjs.set(name, o);
      }
      const y = FLOOR_Y + 0.04;
      o.mesh.position.set(cx, y, cz); o.ring.position.set(cx, y + 0.01, cz);
      o.mesh.scale.setScalar(r); o.ring.scale.setScalar(r);
      if (o.ringR === undefined || Math.abs(o.ringR - r) > 0.005) {      // rebuild the ring so its thickness stays RING_W
        o.ring.geometry.dispose();
        o.ring.geometry = new THREE.RingGeometry(Math.max(0.5, 1 - RING_W / r), 1, 96);
        o.ringR = r;
      }
      const lh = Math.min(Math.max(r * 0.3, 1.6), 3.6), asp = (o.sprite.material.map && o.sprite.material.map.userData && o.sprite.material.map.userData.aspect) || 5;
      o.sprite.scale.set(lh * asp, lh, 1);
      o.sprite.position.set(cx, y + 1.2, cz + r + lh * 0.6);
    });
  }
  function clusterMates(dev) {
    if (!net || net.groupCluster === false || !dev || dev.isRouter || !dev.group) return [];
    return groupMembers(dev.group).filter((d) => d.key !== dev.key);
  }

  function syncScene() {
    syncQueued = false;
    if (!renderer) return;
    computeKeep();
    const keys = new Set();
    devices().forEach((d) => { keys.add(d.key); ensureNode(d); });
    Array.from(nodes.keys()).forEach((k) => { if (!keys.has(k)) removeNode(k); });
    const ids = new Set();
    net.links.forEach((l) => {
      const id = linkId(l.a, l.b);
      ids.add(id);
      let o = linkObjs.get(id);
      if (!o) {
        const vis = new THREE.Mesh(linkGeo, new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true }));
        const pickMat = new THREE.MeshBasicMaterial({ visible: false });
        const pick = new THREE.Mesh(linkGeo, pickMat);
        pick.userData.linkId = id;
        const group = new THREE.Group();
        group.add(vis, pick);
        scene.add(group);
        o = { group: group, vis: vis, pick: pick };
        linkObjs.set(id, o);
      }
      placeLink(o, l);
    });
    Array.from(linkObjs.keys()).forEach((id) => {
      if (!ids.has(id)) {
        const o = linkObjs.get(id);
        scene.remove(o.group);
        if (o.vis.material.alphaMap) o.vis.material.alphaMap.dispose();
        o.vis.material.dispose();
        o.pick.material.dispose();
        linkObjs.delete(id);
      }
    });
    syncServices();
    syncGroups();
    animateNew = true;
    updateEmptyMessage();
    renderList();
  }
  function queueSync() {
    wakeLoop();
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncScene);
  }

  function updateEmptyMessage() {
    const onlyRouter = devices().length <= 1;
    if (webglFailed) return;
    if (onlyRouter && scanKind !== 'manual') {
      els.empty.textContent = net.scannedOnce
        ? 'No other machines were found. Check the Network setting above and scan again.'
        : 'Press "Scan network" to find the machines on your network. They will appear here around your router.';
      els.empty.classList.remove('hidden');
    } else {
      els.empty.classList.add('hidden');
    }
  }

  function maxRadius() {
    let m = 10;
    devices().forEach((d) => { if (nodeVisible(d)) m = Math.max(m, Math.hypot(d.pos.x, d.pos.z)); });
    return m;
  }
  // The map can be pushed around and zoomed out, but never out of sight: the point the camera looks at stays
  // inside the area the machines cover (plus a margin), and zooming out stops a sensible distance away.
  function keepMapInView() {
    if (!controls || !camera) return false;
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
    devices().forEach((d) => { if (!nodeVisible(d) || !d.pos) return; if (d.pos.x < minX) minX = d.pos.x; if (d.pos.x > maxX) maxX = d.pos.x; if (d.pos.z < minZ) minZ = d.pos.z; if (d.pos.z > maxZ) maxZ = d.pos.z; });
    const pad = 12 + 0.1 * Math.max(maxX - minX, maxZ - minZ);
    const r = maxRadius();
    controls.maxDistance = Math.min(400, Math.max(70, r * 3.2 + 50));
    const t = controls.target;
    const cx = Math.min(maxX + pad, Math.max(minX - pad, t.x)), cz = Math.min(maxZ + pad, Math.max(minZ - pad, t.z));
    const cy = Math.min(8, Math.max(-8, t.y));
    if (cx === t.x && cz === t.z && cy === t.y) return false;
    camera.position.x += cx - t.x; camera.position.y += cy - t.y; camera.position.z += cz - t.z;   // slide the camera with it so nothing jumps
    t.set(cx, cy, cz);
    return true;
  }
  function fitView(top) {
    if (!renderer) return;
    const r = maxRadius();
    controls.target.set(0, 0, 0);
    if (top) camera.position.set(0, r * 2.0 + 18, 0.01);
    else camera.position.set(0, r * 0.85 + 14, r * 1.25 + 20);
    controls.update();
    fitted = true;
  }

  // ---------- mouse and keyboard on the map ----------
  // ---------- services and VPNs: small boxes around a machine ----------
  const VPN_PORTS = { 943: 'OpenVPN Access Server', 1194: 'OpenVPN', 1723: 'VPN (PPTP)' };
  const SVC_COLORS = { service: 0x38bdf8, vpn: 0xf43f5e };
  const svcObjs = new Map();       // "svc:<machine>:<id>" -> { mesh, line, sprite, sig }

  function servicesOf(d, includeHidden) {
    const hidden = new Set(d.svcHidden || []);
    const out = [];
    (d.ports || []).forEach((p) => {
      if (!includeHidden && hidden.has(p.port)) return;
      const vpn = VPN_PORTS[p.port];
      const given = d.svcNames && d.svcNames[p.port];
      out.push({ id: 'p' + p.port, port: p.port, kind: vpn ? 'vpn' : 'service', name: given || vpn || p.title || p.service || ('port ' + p.port), auto: true, renamed: !!given, hidden: hidden.has(p.port), info: p });
    });
    (d.autoVpn || []).forEach((n, i) => out.push({ id: 'v' + i, port: null, kind: 'vpn', name: n, auto: true, vpnIface: true }));
    (d.services || []).forEach((s) => out.push({ id: 'm' + s.id, port: s.port, kind: s.kind, name: s.name || (s.port ? 'port ' + s.port : 'service'), auto: false, mid: s.id }));
    return out;
  }

  function removeSvc(id) {
    const o = svcObjs.get(id);
    if (!o) return;
    scene.remove(o.mesh, o.line, o.sprite);
    o.mesh.material.dispose(); o.line.material.dispose();
    if (o.sprite.material.map) o.sprite.material.map.dispose();
    o.sprite.material.dispose();
    svcObjs.delete(id);
  }

  function syncServices() {
    if (!scene) return;
    if (!net.showServices) { Array.from(svcObjs.keys()).forEach(removeSvc); return; }
    const wanted = new Set();
    devices().forEach((d) => {
      const n = nodes.get(d.key);
      if (!n || !(n.shown || n.anim)) return;
      const list = servicesOf(d, false).slice(0, 14);
      const radius = 6.2 + (list.length > 7 ? 2 : 0);
      list.forEach((s, i) => {
        const id = 'svc:' + d.key + ':' + s.id;
        wanted.add(id);
        let o = svcObjs.get(id);
        if (!o) {
          const mesh = new THREE.Mesh(svcGeo, new THREE.MeshStandardMaterial({ color: SVC_COLORS[s.kind], emissive: SVC_COLORS[s.kind], emissiveIntensity: 0.25, roughness: 0.5 }));
          mesh.userData.svc = { key: d.key, id: s.id };
          const line = new THREE.Mesh(linkGeo, new THREE.MeshBasicMaterial({ color: SVC_COLORS[s.kind] }));
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
          sprite.renderOrder = 11;
          scene.add(mesh, line, sprite);
          o = { mesh: mesh, line: line, sprite: sprite, sig: '' };
          svcObjs.set(id, o);
        }
        const sel = selected && selected.type === 'svc' && selected.key === d.key && selected.id === s.id;
        const sig = s.name + '|' + s.kind + '|' + s.port + '|' + sel;
        if (o.sig !== sig) {
          o.sig = sig;
          if (o.sprite.material.map) o.sprite.material.map.dispose();
          o.sprite.material.map = labelTexture([s.name, s.port ? 'port ' + s.port : (s.kind === 'vpn' ? 'VPN' : 'service'), s.kind === 'vpn' ? 'VPN' : (s.auto ? 'found by scan' : 'added by you')], false);
          o.sprite.material.needsUpdate = true;
          o.sprite.scale.set(6.4, 6.4 * 176 / 512, 1);
          o.mesh.material.emissiveIntensity = sel ? 0.9 : 0.25;
        }
        const ang = (i / Math.max(1, list.length)) * Math.PI * 2 + 0.6;
        const sc = Math.max(0.001, n.scale);
        const px = d.pos.x + Math.cos(ang) * radius * sc, pz = d.pos.z + Math.sin(ang) * radius * sc, py = d.pos.y + 0.2;
        o.mesh.position.set(px, py, pz);
        o.mesh.scale.setScalar(sel ? 1.3 * sc : sc);
        o.sprite.position.set(px, py + 1.9 * sc, pz);
        o.sprite.visible = sc > 0.5;
        const a = new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z), b = new THREE.Vector3(px, py, pz);
        const dir = b.clone().sub(a), len = Math.max(0.001, dir.length());
        o.line.position.copy(a.clone().add(b).multiplyScalar(0.5));
        o.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        o.line.scale.set(0.05 * sc, len, 0.05 * sc);
        o.mesh.visible = o.line.visible = sc > 0.05;
      });
    });
    Array.from(svcObjs.keys()).forEach((id) => { if (!wanted.has(id)) removeSvc(id); });
  }

  function pickSvc(e) {
    setRay(e);
    const list = [];
    svcObjs.forEach((o) => { if (o.mesh.visible) list.push(o.mesh); });
    const hits = raycaster.intersectObjects(list, false);
    if (hits.length) return hits[0].object.userData.svc;
    const sprites = [];
    svcObjs.forEach((o, id) => { if (o.sprite.visible) { o.sprite.userData.svc = o.mesh.userData.svc; sprites.push(o.sprite); } });
    const sh = raycaster.intersectObjects(sprites, false);
    return sh.length ? sh[0].object.userData.svc : null;
  }

  let drag = null;
  let downInfo = null;
  const ndc = new THREE.Vector2();
  function setRay(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function pickNode(e) {
    setRay(e);
    const list = [];
    nodes.forEach((n) => { if (n.group.visible) list.push(n.mesh); });
    // the labels float above the machines: clicking a label counts as clicking the machine
    const hits = raycaster.intersectObjects(list, false);
    if (hits.length) return hits[0].object.userData.key;
    const sprites = [];
    nodes.forEach((n, key) => { if (n.group.visible) { n.sprite.userData.key = key; sprites.push(n.sprite); } });
    const sh = raycaster.intersectObjects(sprites, false);
    return sh.length ? sh[0].object.userData.key : null;
  }
  function pickLink(e) {
    setRay(e);
    const list = [];
    linkObjs.forEach((o) => { if (o.group.visible) list.push(o.pick); });
    const hits = raycaster.intersectObjects(list, false);
    return hits.length ? hits[0].object.userData.linkId : null;
  }

  function planeFor(dev) {
    const p = new THREE.Vector3(dev.pos.x, 0, dev.pos.z);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), p);
  }
  function planeHit(dev) {
    const plane = planeFor(dev);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, pt)) return null;
    if (pt.distanceTo(camera.position) > 600) return null;
    return pt;
  }

  function onDown(e) {
    if (e.button !== 0) { downInfo = null; return; }
    const key = pickNode(e);
    downInfo = { x: e.clientX, y: e.clientY, key: key };
    if (key) {
      const dev = net.devices[key];
      const hit = key === 'router' ? null : planeHit(dev);
      drag = { key: key, moved: false, solo: !!(e.ctrlKey || e.metaKey), mates: null, offset: hit ? new THREE.Vector3(dev.pos.x - hit.x, 0, dev.pos.z - hit.z) : new THREE.Vector3() };
      controls.enabled = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.stopPropagation();
    }
  }

  function onMove(e) {
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) > 4) drag.moved = true;
      if (drag.moved && drag.key !== 'router') {
        const dev = net.devices[drag.key];
        setRay(e);
        const pt = planeHit(dev);
        if (pt) {
          if (!drag.mates) drag.mates = drag.solo ? [] : clusterMates(dev);     // Ctrl (or Cmd) + drag moves just this one machine out of its group
          const ox = dev.pos.x, oz = dev.pos.z;
          dev.pos.x = num(pt.x + drag.offset.x, dev.pos.x);
          dev.pos.y = 0;
          dev.pos.z = num(pt.z + drag.offset.z, dev.pos.z);
          drag.mates.forEach((m) => {
            m.pos.x = num(m.pos.x + dev.pos.x - ox, m.pos.x);
            m.pos.y = 0;
            m.pos.z = num(m.pos.z + dev.pos.z - oz, m.pos.z);
          });
          syncScene();
        }
      }
      els.tip.classList.add('hidden');
      return;
    }
    if (e.buttons) { els.tip.classList.add('hidden'); return; }
    const key = pickNode(e);
    canvas.style.cursor = key ? 'pointer' : (connectMode ? 'crosshair' : 'grab');
    if (key) showTip(net.devices[key], e); else els.tip.classList.add('hidden');
  }

  function onUp(e) {
    const wasDrag = drag;
    const info = downInfo;
    drag = null;
    downInfo = null;
    controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (!info || e.type === 'pointercancel') return;
    const moved = Math.hypot(e.clientX - info.x, e.clientY - info.y) > 4;
    if (wasDrag && wasDrag.moved) { save(); renderSide(); return; }
    if (moved) return;                                   // it was a camera rotate/pan
    if (info.key) { clickNode(info.key); return; }
    const sv = pickSvc(e);
    if (sv) { selected = { type: 'svc', key: sv.key, id: sv.id }; pending = null; refresh(); return; }
    const lid = pickLink(e);
    if (lid) { selected = { type: 'link', id: lid }; pending = null; refresh(); return; }
    selected = null;
    pending = null;
    refresh();
  }

  function showTip(d, e) {
    const rect = els.wrap.getBoundingClientRect();
    els.tip.textContent = '';
    const lines = [title(d), d.ip || '', d.mac || '', OS_NAMES[effectiveOs(d)] + (d.ports && d.ports.length ? ' · ' + d.ports.length + ' open ports' : ''), shareKinds(d).length ? 'File sharing: ' + shareKinds(d).join(', ') : ''];
    lines.filter(Boolean).forEach((t, i) => {
      const div = document.createElement('div');
      div.textContent = t;
      if (i === 0) div.style.fontWeight = '600';
      els.tip.appendChild(div);
    });
    els.tip.classList.remove('hidden');
    const x = Math.min(e.clientX - rect.left + 14, rect.width - 270);
    const y = Math.min(e.clientY - rect.top + 14, rect.height - 100);
    els.tip.style.left = Math.max(4, x) + 'px';
    els.tip.style.top = Math.max(4, y) + 'px';
  }

  function clickNode(key) {
    if (connectMode) {
      const cableMode = connectMode === 'cable';
      if (!pending) { pending = key; selected = { type: 'node', key: key }; setHint('Now click the machine to connect it to (click the same pair again to remove the ' + (cableMode ? 'cable' : 'line') + ').'); }
      else if (pending === key) { pending = null; setHint(); }
      else {
        const id = linkId(pending, key);
        const idx = net.links.findIndex((l) => linkId(l.a, l.b) === id);
        let msg;
        if (cableMode) {
          if (idx >= 0 && net.links[idx].cable === true && !net.links[idx].auto) { net.links.splice(idx, 1); msg = 'Cable removed.'; }
          else {
            if (idx >= 0) net.links.splice(idx, 1);
            net.links.push({ a: pending, b: key, auto: false, cable: true, wireless: false });
            // an ordinary machine has one cable: the line the app guessed for it is replaced by the one you drew
            [pending, key].forEach((k) => {
              const dv = net.devices[k];
              if (dv && !dv.isRouter && !['switch', 'network'].includes(effectiveOs(dv))) net.links = net.links.filter((l) => !(l.auto && (l.a === k || l.b === k)));
            });
            msg = 'Cable added.';
          }
        } else if (idx >= 0) { net.links.splice(idx, 1); msg = 'Line removed.'; }
        else { net.links.push({ a: pending, b: key, auto: false }); msg = 'Line added.'; }
        pending = null;
        selected = { type: 'node', key: key };
        save();
        setHint(msg + ' Pick another machine, or press ' + (cableMode ? 'Draw physical cable' : 'Draw lines') + ' to finish.');
      }
    } else {
      selected = { type: 'node', key: key };
      pending = null;
    }
    refresh();
  }

  function setConnectMode(on, kind) {
    connectMode = on ? (kind === 'cable' ? 'cable' : 'lines') : false;
    pending = null;
    els.connect.classList.toggle('on', connectMode === 'lines');
    els.connect.textContent = connectMode === 'lines' ? 'Drawing lines... (click to stop)' : 'Draw lines';
    if (els.cable) {
      els.cable.classList.toggle('on', connectMode === 'cable');
      els.cable.textContent = connectMode === 'cable' ? 'Drawing cables... (click to stop)' : 'Draw physical cable';
    }
    if (canvas) canvas.style.cursor = on ? 'crosshair' : 'grab';
    setHint(connectMode === 'cable' ? 'Click a machine, then the machine at the other end of the real cable (add a switch first with "Add switch" if it is an unmanaged one). Cables you draw are pink and are never changed by scanning.' : on ? 'Click a machine, then click another machine to draw a line between them.' : '');
    refresh();
  }

  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('view-map')) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === 'Escape') { if (connectMode) setConnectMode(false); else { selected = null; pending = null; refresh(); } }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && selected.type === 'link') { deleteLink(selected.id); e.preventDefault(); }
  });

  function deleteLink(id) {
    net.links = net.links.filter((l) => linkId(l.a, l.b) !== id);
    selected = null;
    save();
    refresh();
  }

  function setHint(extra) {
    els.hint.textContent = extra || 'Drag a machine to move it (its whole group follows) · Ctrl+drag moves just one · Drag empty space to rotate · Right-drag to move the view · Scroll to zoom';
  }

  function refresh() {
    queueSync();
    renderSide();
  }

  // ---------- side panel ----------
  function el(tag, cls, content) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (content !== undefined && content !== null) e.textContent = content;
    return e;
  }
  function row(dl, k, v) {
    if (v === null || v === undefined || v === '') return;
    dl.appendChild(el('dt', null, k));
    dl.appendChild(el('dd', null, v));
  }
  function btn(label, handler, cls) {
    const b = el('button', cls || '', label);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  }

  function webUrl(d, port) {
    const scheme = HTTPS_PORTS.has(port) ? 'https' : 'http';
    const defaultPort = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
    return scheme + '://' + d.ip + (defaultPort ? '' : ':' + port);
  }

  // ---------- ports of a switch or router: which are up, how fast, and what is plugged into each ----------
  const portsExpanded = new Set();
  function selectDevice(key) { if (key && net.devices[key]) { selected = { type: 'node', key: key }; pending = null; refresh(); } }
  function pluggedInto(host, name) {
    return devices().filter((x) => x.key !== host.key && x.attach && !x.attach.wireless && x.attach.port === name && x.attach.parentKey === host.key);
  }
  function renderPorts(d) {
    const side = els.side;
    let table = Array.isArray(d.portTable) ? d.portTable.slice() : [];
    let learned = false;
    if (!table.length) {                    // no port list from the device: use what it told us about machines plugged into it
      const seen = new Map();
      devices().forEach((x) => { if (x.key !== d.key && x.attach && !x.attach.wireless && x.attach.port && x.attach.parentKey === d.key && !seen.has(x.attach.port)) seen.set(x.attach.port, { name: x.attach.port, up: true, speed: speedNum(x.attach.speed) }); });
      table = Array.from(seen.values()); learned = true;
    }
    if (!table.length) return;
    const withDev = table.map((p) => Object.assign({}, p, { devs: pluggedInto(d, p.name), uplink: !!(d.uplinkPort && d.uplinkPort === p.name) }));
    const upCount = withDev.filter((p) => p.up).length;
    side.appendChild(el('h4', null, 'Ports (' + upCount + ' in use' + (learned ? '' : ' of ' + withDev.length) + ')'));
    const strip = el('div', 'port-strip');
    withDev.forEach((p) => {
      const sq = el('button', 'port-sq' + (p.up ? ' up' : ' down') + (p.uplink ? ' uplink' : '') + (p.devs.length ? ' has' : ''));
      sq.type = 'button';
      const num = /(\d+)$/.exec(p.name);
      sq.textContent = num ? num[1] : p.name.slice(0, 3);
      sq.title = p.name + ' · ' + (p.up ? (p.speed ? speedFmt(p.speed) : 'linked') : 'nothing plugged in') + (p.uplink ? ' · uplink (toward the router)' : '') + (p.devs.length ? ' · ' + p.devs.slice(0, 3).map((x) => title(x)).join(', ') + (p.devs.length > 3 ? ' +' + (p.devs.length - 3) + ' more' : '') : '');
      sq.addEventListener('click', () => { if (p.devs.length === 1) selectDevice(p.devs[0].key); else setStatus(sq.title); });
      strip.appendChild(sq);
    });
    side.appendChild(strip);
    const showAll = portsExpanded.has(d.key);
    const rows = withDev.filter((p) => showAll || p.up || p.devs.length);
    const list = el('div', 'port-list');
    rows.forEach((p) => {
      const row = el('div', 'port-row' + (p.up ? '' : ' down'));
      row.appendChild(el('span', 'port-name', p.name));
      row.appendChild(el('span', 'port-speed', p.up ? (p.speed ? speedFmt(p.speed) : 'linked') : 'no link'));
      const who = el('span', 'port-who');
      if (p.uplink) who.appendChild(el('span', 'port-tag', 'uplink'));
      if (p.devs.length >= 4) who.appendChild(el('span', null, p.devs.length + ' machines (shared port, toward other switches)'));
      else p.devs.forEach((x) => { const b = el('button', 'port-dev', title(x)); b.type = 'button'; b.addEventListener('click', () => selectDevice(x.key)); who.appendChild(b); });
      if (!p.devs.length && !p.uplink && p.up) who.appendChild(el('span', 'port-none', 'unknown device'));
      row.appendChild(who);
      list.appendChild(row);
    });
    side.appendChild(list);
    const hidden = withDev.length - rows.length;
    if (hidden > 0 || showAll) {
      side.appendChild(btn(showAll ? 'Hide unused ports' : 'Show ' + hidden + ' unused port' + (hidden === 1 ? '' : 's'), () => { if (portsExpanded.has(d.key)) portsExpanded.delete(d.key); else portsExpanded.add(d.key); renderSide(); }));
    }
    side.appendChild(el('p', 'small-note', learned
      ? 'Built from what this device reported about the machines plugged into it. It did not give a full port list.'
      : 'Port list from the device itself' + (d.portTableAt ? ', read ' + new Date(d.portTableAt).toLocaleTimeString() : '') + '. A machine is shown on a port only when the device has seen it there; a port toward another switch may show several machines.'));
  }

  const lanMsgFor = { key: null, text: '' };
  function renderSideKeepMsg(key, text) {
    lanMsgFor.key = key; lanMsgFor.text = text;
    if (selected && selected.type === 'node' && selected.key === key) renderSide();
  }
  // Live updates (scans, connector refreshes, wake checks) must never rebuild the pane while you type in it.
  // Redraws that come from your own clicks/edits go straight through; automatic ones wait until you leave the box.
  let sideUserEvent = false, sideDeferred = false, sideMouseDown = false;
  function sideFlushSoon() {
    setTimeout(() => {
      if (!sideDeferred) return;
      if (sideMouseDown || sideIsBusy()) { sideFlushSoon(); return; }
      sideDeferred = false; renderSideNow();
    }, 500);
  }
  function renderSide() {
    if (!sideUserEvent && sideIsBusy()) { sideDeferred = true; sideFlushSoon(); return; }
    sideDeferred = false;
    renderSideNow();
  }
  function renderSideNow() {
    const side = els.side;
    side.textContent = '';
    if (!net) return;

    if (selected && selected.type === 'svc') {
      const d = net.devices[selected.key];
      const s = d ? servicesOf(d, true).find((x) => x.id === selected.id) : null;
      if (!d || !s) { selected = null; renderSide(); return; }
      side.appendChild(el('h3', null, s.name));
      side.appendChild(el('p', 'sub', (s.kind === 'vpn' ? 'VPN' : 'Service') + ' on ' + title(d)));
      const dl = el('dl');
      row(dl, 'Port', s.port ? String(s.port) : null);
      row(dl, 'Found as', s.info ? [s.info.service, s.info.title, s.info.banner].filter(Boolean).join(' · ') : null);
      row(dl, 'Source', s.vpnIface ? 'A VPN adapter on this computer' : s.auto ? 'Found by the scan' : 'Added by you');
      side.appendChild(dl);
      if (s.vpnIface) {
        side.appendChild(el('p', 'small-note', 'The name comes from the VPN adapter on this computer.'));
      } else {
        side.appendChild(el('h4', null, 'Name'));
        const ni = el('input'); ni.type = 'text'; ni.maxLength = 40; ni.placeholder = 'What is running here? For example: Grafana';
        ni.value = s.renamed || !s.auto ? s.name : '';
        ni.addEventListener('change', () => {
          const v = ni.value.trim().slice(0, 40);
          if (s.auto) { if (v) d.svcNames[String(s.port)] = v; else delete d.svcNames[String(s.port)]; }
          else { const it = d.services.find((x) => x.id === s.mid); if (it) it.name = v; }
          save(); queueSync(); renderSide();
        });
        side.appendChild(ni);
        if (!s.auto) {
          const ks = el('select');
          [['service', 'Service'], ['vpn', 'VPN']].forEach((o) => { const op = el('option', null, o[1]); op.value = o[0]; ks.appendChild(op); });
          ks.value = s.kind;
          ks.addEventListener('change', () => { const it = d.services.find((x) => x.id === s.mid); if (it) it.kind = ks.value === 'vpn' ? 'vpn' : 'service'; save(); queueSync(); renderSide(); });
          side.appendChild(ks);
        }
      }
      const rowS = el('div', 'btnrow');
      if (s.info && d.ip && (WEB_PORTS.has(s.port) || /HTTP/.test(s.info.service || ''))) rowS.appendChild(btn('Add web panel', () => addAsPanel(d, s.info)));
      if (s.auto && s.port) rowS.appendChild(btn('Hide this service', () => { if (!d.svcHidden.includes(s.port)) d.svcHidden.push(s.port); selected = { type: 'node', key: d.key }; save(); refresh(); }));
      if (!s.auto) rowS.appendChild(btn('Delete service', () => { d.services = d.services.filter((x) => x.id !== s.mid); selected = { type: 'node', key: d.key }; save(); refresh(); }));
      rowS.appendChild(btn('Back to the machine', () => { selected = { type: 'node', key: d.key }; refresh(); }));
      side.appendChild(rowS);
      const msg = el('p', 'small-note', ''); msg.id = 'mapSideMsg'; side.appendChild(msg);
      return;
    }

    if (selected && selected.type === 'link') {
      const l = net.links.find((x) => linkId(x.a, x.b) === selected.id);
      if (!l) { selected = null; renderSide(); return; }
      side.appendChild(el('h3', null, 'Line'));
      side.appendChild(el('p', 'sub', title(net.devices[l.a]) + '  ↔  ' + title(net.devices[l.b])));
      const isCable = l.cable === true && !l.auto;
      side.appendChild(el('p', 'small-note', l.auto ? 'Detected automatically (green line).' : isCable ? 'A physical cable you drew (pink line). Scanning and the router checks never change or remove it.' : 'Drawn by you.'));
      if (isCable) {
        const rowC = el('div', 'btnrow');
        rowC.appendChild(btn('Delete this cable', () => deleteLink(selected.id)));
        side.appendChild(rowC);
        return;
      }
      side.appendChild(el('p', 'small-note', 'Connection type (wireless lines are drawn dotted):'));
      const wsel = el('select'); wsel.id = 'mapWireSel';
      [['', 'Automatic (Wireless and wired detection)'], ['wired', 'Wired (solid line)'], ['wireless', 'Wireless (dotted line)']].forEach((o) => {
        const op = el('option', null, o[1]); op.value = o[0]; wsel.appendChild(op);
      });
      wsel.value = l.wireless === true ? 'wireless' : l.wireless === false ? 'wired' : '';
      wsel.addEventListener('change', () => { l.wireless = wsel.value === 'wireless' ? true : wsel.value === 'wired' ? false : null; save(); queueSync(); renderSide(); });
      side.appendChild(wsel);
      side.appendChild(el('p', 'small-note', isWireless(l) ? 'This line is drawn dotted (wireless).' : 'This line is drawn solid (wired).'));
      const row1 = el('div', 'btnrow');
      row1.appendChild(btn('Delete this line', () => deleteLink(selected.id)));
      side.appendChild(row1);
      return;
    }

    if (selected && selected.type === 'node' && net.devices[selected.key]) {
      const d = net.devices[selected.key];
      const os = effectiveOs(d);
      side.appendChild(el('h3', null, title(d)));
      side.appendChild(el('p', 'sub', (d.isRouter ? 'Router (center of the map)' : d.manual && !d.ip ? 'Added by you' : d.self ? 'This computer' : d.online === false ? 'Offline (not found in the last scan)' : 'Online') + (d.lastSeen ? ' · last seen ' + new Date(d.lastSeen).toLocaleString() : '')));

      {
        const up = reportedUp(d);
        const lines = [];
        if (d.online !== false && d.onlineSince && !(d.manual && !d.ip)) lines.push('Seen online for ' + fmtDuration((Date.now() - d.onlineSince) / 1000) + ' (since ' + new Date(d.onlineSince).toLocaleString() + ')');
        if (up !== null) lines.push((d.upInfo.kind === 'connected' ? 'Connected to the network for ' : 'The device says it has been running for ') + fmtDuration(up));
        if (d.firstSeen) lines.push('First seen ' + new Date(d.firstSeen).toLocaleDateString());
        if (lines.length) {
          const box = el('div', 'uptime-box');
          lines.forEach((t) => box.appendChild(el('p', 'small-note', t)));
          if (d.online !== false && d.onlineSince) box.appendChild(el('p', 'small-note', 'Counted only while Dashboard Hub is running and scanning, so a pause in watching starts the count again.' + (up === null && !d.isRouter ? ' This device does not report its own uptime.' : '')));
          side.appendChild(box);
        }
      }
      if (!d.isRouter) {
        const hasRouterLine = net.links.some((l) => linkId(l.a, l.b) === linkId('router', d.key));
        const rowL = el('div', 'btnrow');
        if (d.mac && !d.self) rowL.appendChild(btn(d.online === false ? 'Wake up (Wake-on-LAN)' : 'Send wake-up signal', () => wakeDevices([d]), 'wake-btn'));
        rowL.appendChild(btn(hasRouterLine ? 'Disconnect from router' : 'Connect to router', () => {
          const id = linkId('router', d.key);
          if (hasRouterLine) net.links = net.links.filter((l) => linkId(l.a, l.b) !== id);
          else net.links.push({ a: 'router', b: d.key, auto: false });
          save();
          refresh();
        }));
        side.appendChild(rowL);
      }

      const dl = el('dl');
      row(dl, 'IP address', d.ip);
      if (d.self && d.linkSpeed) row(dl, 'Link speed', speedLabel(d.linkSpeed.mbps, null, d.linkSpeed.wireless) + ' (this computer\u2019s own connection)');
      row(dl, 'MAC address', d.mac || (d.self || d.manual ? null : 'not available'));
      row(dl, 'Maker', d.vendor);
      row(dl, 'Name', d.hostname);
      const osDd = el('span', null, d.osOverride ? OS_NAMES[d.osOverride] + ' (set by you)' : (d.os && d.os.label) || 'Unknown');
      if (!d.osOverride && d.os && d.os.id !== 'unknown') osDd.appendChild(el('span', 'badge-conf', d.os.confidence + ' confidence'));
      dl.appendChild(el('dt', null, 'System'));
      const dd = el('dd');
      dd.appendChild(osDd);
      dl.appendChild(dd);
      if (!d.isRouter) {
        // "Connected to" is the machine one step towards the router on the lines that are really drawn (not a guess from old notes),
        // and Wi-Fi / Cable is what THAT line is drawn as
        const up = routeTree().get(d.key);
        const link = up ? net.links.find((l) => linkId(l.a, l.b) === linkId(up, d.key)) : null;
        const parentDev = up ? net.devices[up] : null;
        if (link && parentDev) {
          const how = link.cable === true && !link.auto ? 'Cable you drew' : isWireless(link) ? 'Wi-Fi' : 'Cable';
          dl.appendChild(el('dt', null, 'Connected to'));
          dl.appendChild(el('dd', null, (parentDev.isRouter ? 'Router' : title(parentDev)) + ' (' + how + ')' + (d.attach && d.attach.port && d.attach.parentKey === up ? ', port ' + d.attach.port : '') + (link.auto ? '' : ' · line drawn by you')));
        } else {
          dl.appendChild(el('dt', null, 'Connected to'));
          dl.appendChild(el('dd', null, 'Nothing yet (no line reaches the router)'));
        }
      }
      if (d.attach && d.attach.via) {
        dl.appendChild(el('dt', null, 'Link details'));
        const sigText = d.attach.signal !== null ? ' · signal ' + d.attach.signal + (String(d.attach.signal).includes('%') ? '' : ' dBm') : '';
        const repText = d.attach.by ? ' · reported by ' + d.attach.by : '';
        // what a router or switch said; if the line on the map is not that (for example you drew your own), say so
        const upK = !d.isRouter ? routeTree().get(d.key) : null;
        const upL = upK ? net.links.find((l) => linkId(l.a, l.b) === linkId(upK, d.key)) : null;
        const differs = !!upL && !upL.auto && (upL.cable === true || d.attach.pinned);
        dl.appendChild(el('dd', null, 'Last reported: ' + d.attach.via + sigText + repText + (differs ? ' (the line on the map is the one you drew)' : '')));
      } else if (d.connSeen) {
        dl.appendChild(el('dt', null, 'Link details'));
        dl.appendChild(el('dd', null, d.connSeen === 'wireless' ? 'Wi-Fi' : 'Cable'));
      }
      if (!d.isRouter && !d.self) {      // every machine shows its link speed (reported, or set by you), also on a cable you drew
        const at = d.attach && typeof d.attach === 'object' ? d.attach : null;
        const spd = d.speedSet ? speedFmt(d.speedSet) + ' (set by you)' : at ? speedLabel(at.speed, at.speedRx, at.wireless) : '';
        dl.appendChild(el('dt', null, 'Link speed'));
        dl.appendChild(el('dd', null, spd ? spd + (d.speedSet ? '' : ' (what the two ends agreed on, not a speed test)') : 'Not reported by the router or switch. You can set it below.'));
        if (d.uplinkSpeed) { dl.appendChild(el('dt', null, 'Uplink speed')); dl.appendChild(el('dd', null, speedFmt(d.uplinkSpeed) + ' (this device\u2019s own connection toward the router' + (d.uplinkPort ? ', port ' + d.uplinkPort : '') + ')')); }
      }
      side.appendChild(dl);
      if (!d.isRouter && !d.self && d.ip) {
        const lanRow = el('div', 'btnrow');
        const lanOut = el('p', 'small-note'); lanOut.id = 'mapLanMsg'; lanOut.style.whiteSpace = 'pre-line';
        const lanBtn = btn('Run LAN speedtest', async () => {
          lanBtn.disabled = true; lanOut.textContent = 'Asking your routers and switches...';
          const m = await runLanSpeedtest([d]);
          lanBtn.disabled = false; lanOut.textContent = m; renderSideKeepMsg(d.key, m);
        });
        lanBtn.id = 'mapLanBtn';
        lanRow.appendChild(lanBtn); side.appendChild(lanRow);
        side.appendChild(lanOut);
        if (lanMsgFor.key === d.key) lanOut.textContent = lanMsgFor.text;
      }
      renderPorts(d);
      if (!d.isRouter && d.mac && window.hubBmcPane) { try { window.hubBmcPane(d, side); } catch (e) { /* the server section is optional */ } }

      if (!d.osOverride && d.os && d.os.reasons && d.os.reasons.length) {
        side.appendChild(el('h4', null, 'Why this guess'));
        const ul = el('ul');
        d.os.reasons.forEach((r) => ul.appendChild(el('li', null, r)));
        side.appendChild(ul);
        side.appendChild(el('p', 'small-note', 'This is an educated guess from how the machine answers. You can correct it below.'));
      }

      side.appendChild(el('h4', null, 'Open ports (' + d.ports.length + ')'));
      if (!d.ports.length) {
        side.appendChild(el('p', 'small-note', d.manual && !d.lastSeen ? 'Nothing is known about this one yet. If you give it an IP address below, scans will fill this in.' : d.lastSeen ? 'No open ports were found.' : 'Not scanned yet.'));
      } else {
        const table = el('table');
        d.ports.forEach((p) => {
          const tr = el('tr');
          tr.appendChild(el('td', 'port', String(p.port)));
          const detail = [p.service, p.title, p.banner].filter(Boolean).join(' · ');
          tr.appendChild(el('td', null, detail || ''));
          table.appendChild(tr);
        });
        side.appendChild(table);
      }

      // DNS: is this machine a DNS server? (What each device USES cannot be seen from outside, so say so honestly.)
      if (d.ip) {
        if (d.dns && d.dns.server) {
          const sw = d.dns.software ? ' (' + d.dns.software + ')' : '';
          side.appendChild(el('p', 'small-note', 'DNS server: yes' + sw + '. ' + (d.dns.recursive ? 'It looks names up for other devices (a resolver or forwarder).' : d.dns.refused ? 'It answers on the DNS port but refuses ordinary lookups from here.' : 'It answers on the DNS port.')));
        }
        const others = dnsServers();
        if (others.length) side.appendChild(el('p', 'small-note', 'DNS servers found on this network: ' + others.map((x) => (x.isRouter ? 'router' : (x.label || x.name || x.ip)) + ' ' + x.ip + (x.dns.software ? ' (' + x.dns.software + ')' : '')).join(', ') + '. Which one a device uses is set on the device, or handed out by your router; it cannot be seen from outside.'));
        else if (d.dnsAt) side.appendChild(el('p', 'small-note', 'No DNS server was found among the machines checked so far.'));
        const rowD = el('div', 'btnrow');
        rowD.appendChild(btn(d.dnsAt ? 'Check DNS again' : 'Check DNS', async () => {
          setStatus('Asking ' + title(d) + ' whether it is a DNS server...');
          let r; try { r = await window.netApi.dns([d.ip]); } catch (e) { r = { ok: false }; }
          if (!r || !r.ok) { setStatus('DNS could not be checked.', true); return; }
          const x = r.results[d.ip] || { server: false };
          d.dns = x.server ? { server: true, recursive: x.recursive === true, refused: x.refused === true, software: text(x.software || '', 60) } : null;
          d.dnsAt = Date.now(); save(); renderSide();
          setStatus(x.server ? title(d) + ' is a DNS server' + (x.via === 'tcp' ? ' (it answered over TCP only).' : '.') : title(d) + ' is not a DNS server. ' + text(x.tried || '', 160));
        }));
        side.appendChild(rowD);
      }

      const kinds = shareKinds(d);
      if (kinds.length || (d.shares && d.shares.length)) {
        side.appendChild(el('h4', null, '\uD83D\uDCC1 File sharing'));
        side.appendChild(el('p', 'small-note', 'This machine offers: ' + (kinds.join(', ') || 'shares found earlier') + '. (Only that the service is switched on; what is shared depends on its settings.)'));
        const rowF = el('div', 'btnrow');
        if (d.ip && kinds.some((k) => k === 'SMB')) rowF.appendChild(btn('Copy Windows path', () => { try { navigator.clipboard.writeText('\\\\' + d.ip); setStatus('Copied \\\\' + d.ip + ' (paste it into the File Explorer address bar).'); } catch (e) { /* no clipboard */ } }));
        if (d.ip && kinds.some((k) => k === 'SMB')) rowF.appendChild(btn('Copy Mac/Linux path', () => { try { navigator.clipboard.writeText('smb://' + d.ip); setStatus('Copied smb://' + d.ip); } catch (e) { /* no clipboard */ } }));
        if (d.ip && window.netApi && window.netApi.shares) rowF.appendChild(btn(d.sharesAt ? 'List shares again' : 'List shares', async () => {
          setStatus('Asking ' + title(d) + ' which shares it offers...');
          let r;
          try { r = await window.netApi.shares(d.ip); } catch (e) { r = { ok: false, error: 'The share list could not be read.' }; }
          if (!r || !r.ok) { setStatus((r && r.error) || 'The share list could not be read.', true); return; }
          d.shares = (r.shares || []).slice(0, 60).map((s) => ({ name: text(s.name, 120), type: text(s.type || 'Disk', 10), comment: text(s.comment || '', 120), proto: s.proto === 'NFS' ? 'NFS' : 'SMB' }));
          d.sharesAt = Date.now();
          d.shareNotes = (r.notes || []).slice(0, 4).map((x) => text(x, 160));
          save(); setStatus(d.shares.length ? title(d) + ' offers ' + d.shares.length + (d.shares.length === 1 ? ' share.' : ' shares.') : 'No shares could be listed without a login.');
          queueSync(); renderSide();
        }));
        side.appendChild(rowF);
        if (d.shares && d.shares.length) {
          const ul2 = el('ul');
          d.shares.forEach((s2) => ul2.appendChild(el('li', null, s2.proto + ' · ' + s2.name + (s2.type === 'Print' ? ' (printer)' : '') + (s2.comment ? ' — ' + s2.comment : ''))));
          side.appendChild(ul2);
        }
        if (d.sharesAt && (!d.shares || !d.shares.length)) side.appendChild(el('p', 'small-note', 'No shares were listed without a login.'));
        (d.shareNotes || []).forEach((x) => side.appendChild(el('p', 'small-note', x)));
      }

      const web = d.ports.filter((p) => WEB_PORTS.has(p.port) || /HTTP/.test(p.service || ''));
      const hasSsh = d.ports.some((p) => p.port === 22);
      if ((web.length || hasSsh) && d.ip) {
        side.appendChild(el('h4', null, 'Use it in Dashboard Hub'));
        const rowB = el('div', 'btnrow');
        web.slice(0, 6).forEach((p) => {
          rowB.appendChild(btn('Add web panel :' + p.port, () => addAsPanel(d, p)));
        });
        if (hasSsh) rowB.appendChild(btn('Add as SSH server', () => addAsServer(d)));
        side.appendChild(rowB);
        const msg = el('p', 'small-note', '');
        msg.id = 'mapSideMsg';
        side.appendChild(msg);
      }

      side.appendChild(el('h4', null, 'Edit'));
      const nameIn = el('input');
      nameIn.type = 'text';
      nameIn.placeholder = 'Your own name for it (optional)';
      nameIn.value = d.label || '';
      nameIn.maxLength = 60;
      nameIn.addEventListener('input', () => { d.label = nameIn.value.trim().slice(0, 60); save(); queueSync(); });
      nameIn.addEventListener('change', () => { d.label = nameIn.value.trim().slice(0, 60); save(); queueSync(); renderSide(); });
      side.appendChild(nameIn);
      if (d.manual) {
        const ipIn = el('input');
        ipIn.type = 'text';
        ipIn.placeholder = 'IP address (optional, lets scans fill in details)';
        ipIn.value = d.ip || '';
        ipIn.maxLength = 15;
        ipIn.addEventListener('change', () => {
          const v = ipIn.value.trim();
          if (v !== '' && !validIp(v)) { ipIn.value = d.ip || ''; alert('That is not a valid IP address.'); return; }
          if (v !== '' && v === net.router) { ipIn.value = d.ip || ''; alert('That address is your router.'); return; }
          d.ip = v;
          d.misses = 0;
          // a machine the scan already found at that address becomes this switch
          const other = v ? devices().find((x) => x !== d && !x.isRouter && !x.manual && x.ip === v) : null;
          if (other) {
            ['mac', 'vendor', 'hostname', 'ttl', 'lastSeen', 'online'].forEach((k) => { d[k] = other[k]; });
            d.ports = other.ports;
            d.os = other.os;
            net.links.forEach((l) => {
              if (l.a === other.key) l.a = d.key;
              if (l.b === other.key) l.b = d.key;
            });
            const seen = new Set();
            net.links = net.links.filter((l) => {
              if (l.a === l.b) return false;
              const id = linkId(l.a, l.b);
              if (seen.has(id)) return false;
              seen.add(id);
              return true;
            });
            delete net.devices[other.key];
            removeNode(other.key);
            if (selected && selected.key === other.key) selected = { type: 'node', key: d.key };
          }
          save(); queueSync(); renderSide();
        });
        side.appendChild(ipIn);
      }
      if (!d.isRouter) {
        const sel = el('select'); sel.id = 'mapTypeSel';
        [['', d.manual ? 'Type: Switch' : 'System: use the scan\'s guess'], ['switch', 'Switch'], ['windows', 'Windows'], ['linux', 'Linux / Unix'], ['apple', 'Apple (macOS / iOS)'], ['android', 'Android'], ['iot', 'IoT / smart device (lights, plugs, speakers)'], ['console', 'Game console (PlayStation, Xbox, Nintendo, Steam Deck)'], ['printer', 'Printer (network printer or scanner)'], ['network', 'Router / network device'], ['unknown', 'Other / unknown']].forEach((o) => {
          const op = el('option', null, o[1]);
          op.value = o[0];
          sel.appendChild(op);
        });
        sel.value = d.osOverride || '';
        if (d.manual && !d.osOverride) sel.value = '';
        sel.addEventListener('change', () => { d.osOverride = sel.value || null; save(); queueSync(); renderSide(); });
        side.appendChild(sel);
        // link speed you set yourself (for cables through unmanaged switches, or routers that do not report it)
        side.appendChild(el('p', 'small-note', 'Link speed (if the router or switch cannot report it, set it here):'));
        const spSel = el('select'); spSel.id = 'mapSpeedSel';
        [['', 'Automatic (as reported, otherwise unknown)'], ['10', '10 Mbps'], ['100', '100 Mbps (Fast Ethernet)'], ['1000', '1 Gbps'], ['2500', '2.5 Gbps'], ['5000', '5 Gbps'], ['10000', '10 Gbps']].forEach((o) => {
          const op = el('option', null, o[1]); op.value = o[0]; spSel.appendChild(op);
        });
        spSel.value = d.speedSet ? String(d.speedSet) : '';
        spSel.addEventListener('change', () => { d.speedSet = spSel.value ? Number(spSel.value) : null; save(); renderSide(); });
        side.appendChild(spSel);
        // wired or wireless: sets how this machine's line(s) are drawn
        const myLinks = () => net.links.filter((l) => l.a === d.key || l.b === d.key);
        if (myLinks().length) {
          side.appendChild(el('p', 'small-note', 'Connection (wireless = dotted line):'));
          const csel = el('select'); csel.id = 'mapConnSel';
          [['', 'Automatic (Wireless and wired detection)'], ['wired', 'Wired (solid line)'], ['wireless', 'Wireless (dotted line)']].forEach((o) => {
            const op = el('option', null, o[1]); op.value = o[0]; csel.appendChild(op);
          });
          const ls = myLinks();
          csel.value = ls.every((l) => l.wireless === true) ? 'wireless' : ls.every((l) => l.wireless === false) ? 'wired' : '';
          csel.addEventListener('change', () => {
            myLinks().forEach((l) => { l.wireless = csel.value === 'wireless' ? true : csel.value === 'wired' ? false : null; });
            save(); queueSync(); renderSide();
          });
          side.appendChild(csel);
        }
        side.appendChild(el('p', 'small-note', 'Group (machines in a group get a circle and move together):'));
        const gin = el('input');
        gin.type = 'text'; gin.maxLength = 30; gin.placeholder = 'for example: Living room'; gin.value = d.group || '';
        gin.addEventListener('change', () => { d.group = text(gin.value.trim(), 30); save(); queueSync(); renderList(); });
        side.appendChild(gin);
        if (d.group) {
          const rmb = btn('Remove from group "' + d.group + '"', () => { d.group = ''; save(); queueSync(); renderSide(); renderList(); });
          rmb.id = 'mapSideUngroup';
          side.appendChild(rmb);
        }
        const rowC = el('div', 'btnrow');
        const dropDevice = (ignoreIt) => {
          if (ignoreIt && !d.manual) {
            const k = d.mac || 'ip:' + d.ip;
            if (k && !net.ignored.includes(k)) net.ignored.push(k);
            net.ignored = net.ignored.slice(-500);
          }
          delete net.devices[d.key];
          net.links = net.links.filter((l) => l.a !== d.key && l.b !== d.key);
          selected = null;
          save();
          refresh();
        };
        rowC.appendChild(btn(d.manual ? 'Delete' : 'Remove from map', () => {
          if (!confirm(d.manual ? 'Delete "' + title(d) + '" from the map?' : 'Remove "' + title(d) + '" from the map? If a scan finds it again (for example when it reconnects), it comes back by itself.')) return;
          dropDevice(false);
        }));
        if (!d.manual) {
          rowC.appendChild(btn('Ignore forever', () => {
            if (!confirm('Ignore "' + title(d) + '"? It will not be shown again, even when scans find it. (You can bring ignored machines back from the overview.)')) return;
            dropDevice(true);
          }));
        }
        side.appendChild(rowC);
      }
      infoSection(side, d);
      servicesSection(side, d);
      return;
    }

    // nothing selected: overview
    const all = devices();
    const others = all.filter((d) => !d.isRouter);
    const online = others.filter((d) => d.online !== false).length;
    side.appendChild(el('h3', null, 'Your network'));
    side.appendChild(el('p', 'sub', net.router + ' (router) · ' + others.length + (others.length === 1 ? ' machine' : ' machines') + (others.length ? ', ' + online + ' online' : '')));
    const counts = {};
    others.forEach((d) => { const k = effectiveOs(d); counts[k] = (counts[k] || 0) + 1; });
    const dl = el('dl');
    Object.keys(counts).forEach((k) => row(dl, OS_NAMES[k], String(counts[k])));
    side.appendChild(dl);
    if (net.ignored.length) {
      const rowR = el('div', 'btnrow');
      rowR.appendChild(btn('Bring back ' + net.ignored.length + ' ignored ' + (net.ignored.length === 1 ? 'machine' : 'machines'), () => {
        net.ignored = [];
        save();
        renderSide();
        setStatus('They will reappear the next time a scan finds them.');
      }));
      side.appendChild(rowR);
    }
    side.appendChild(el('h4', null, 'How to use the map'));
    const ul = el('ul');
    ['Click a machine to see its IP, MAC address, open ports and system.',
      'Drag a machine to move it.',
      'Press "Draw lines", then click two machines to connect them. Click a line to select it, then delete it.',
      'Press "Add switch" to put a switch on the map, then connect it to the router and your machines with lines.',
      'With Live update on, the map quietly watches for machines joining and leaving.',
      'Hover over a machine for a quick summary.',
      'Your map and layout are saved automatically.'].forEach((t) => ul.appendChild(el('li', null, t)));
    side.appendChild(ul);
  }

  function sideMessage(t) {
    const m = document.getElementById('mapSideMsg');
    if (m) m.textContent = t;
  }

  // ---------- what a machine is: web interface, brand, notes, VLAN ----------
  const BRANDS = [
    [/hpe|hewlett|aruba|procurve/i, 'HPE / Aruba'], [/cisco|meraki/i, 'Cisco'], [/netgear/i, 'Netgear'], [/tp-?link|omada/i, 'TP-Link'],
    [/ubiquiti|unifi|ubnt/i, 'Ubiquiti UniFi'], [/mikrotik|routeros/i, 'MikroTik'], [/d-link/i, 'D-Link'], [/zyxel/i, 'Zyxel'], [/juniper/i, 'Juniper'],
    [/dell|powerconnect/i, 'Dell'], [/brocade|ruckus|extreme/i, 'Ruckus / Extreme'], [/linksys/i, 'Linksys'], [/tenda/i, 'Tenda'], [/asus/i, 'ASUS'],
    [/fortinet|fortigate/i, 'Fortinet'], [/huawei/i, 'Huawei'], [/engenius/i, 'EnGenius'], [/trendnet/i, 'TRENDnet'], [/allied telesis/i, 'Allied Telesis'], [/qnap/i, 'QNAP'], [/synology/i, 'Synology']
  ];
  function brandHint(d) {
    const hay = [d.vendor, d.hostname].concat((d.ports || []).map((p) => (p.title || '') + ' ' + (p.banner || ''))).join(' ');
    const hit = BRANDS.find((b) => b[0].test(hay));
    return hit ? hit[1] : '';
  }
  function webPortOf(d) { return (d.ports || []).find((p) => WEB_PORTS.has(p.port) || /HTTP/.test(p.service || '')); }

  function infoSection(side, d) {
    const os = effectiveOs(d);
    const isNet = d.isRouter || os === 'switch' || os === 'network';
    const box = el('div', 'infobox');
    box.appendChild(el('h4', null, isNet ? 'About this ' + (os === 'switch' ? 'switch' : 'network device') : 'About this machine'));
    const wp = d.ip ? webPortOf(d) : null;
    const hint = brandHint(d);
    let statusEl = null;
    const updateStatus = () => {
      if (!statusEl) return;
      const auto = !d.osOverride && d.os && d.os.id === 'switch';
      const known = !!(d.info.brand || hint);
      statusEl.className = 'switch-status ' + (known || wp ? 'ok' : 'warn');
      statusEl.textContent =
        (auto ? 'Recognised as a switch by the scan. ' : d.manual ? 'Added by you. ' : 'Marked as a switch by you. ') +
        (known ? 'Maker: ' + (d.info.brand || hint) + '. ' : 'The maker could not be found automatically. ') +
        (wp ? 'It has a web page.' : d.ip ? 'No web page was found on the common ports.' : 'It has no IP address, so it cannot be scanned.') +
        (!known || !d.info.ports ? ' Please fill in what you know below: brand, number of ports and what it is used for.' : '');
    };
    if (os === 'switch') { statusEl = el('p', 'switch-status'); box.appendChild(statusEl); updateStatus(); }
    if (wp) {
      box.appendChild(el('p', null, 'Web interface found: ' + (HTTPS_PORTS.has(wp.port) ? 'https' : 'http') + '://' + d.ip + (wp.port === 80 || wp.port === 443 ? '' : ':' + wp.port) + (wp.title ? '  ("' + wp.title + '")' : '')));
      const r = el('div', 'btnrow');
      r.appendChild(btn('Add as web panel', () => addAsPanel(d, wp)));
      box.appendChild(r);
    } else if (isNet) {
      box.appendChild(el('p', 'small-note', d.ip ? 'No web interface was found on the common ports. If it has one, type its address below.' : 'Type what you know about it below. Give it an IP address (in the Edit section) to let scans find more.'));
    }
    if (hint) box.appendChild(el('p', 'small-note', 'Looks like: ' + hint + (d.vendor ? ' (from the maker "' + d.vendor + '" and what it answers)' : '')));
    const mk = (label, key, ph, max) => {
      const i = el('input'); i.type = 'text'; i.maxLength = max; i.placeholder = ph; i.value = d.info[key] || '';
      i.addEventListener('change', () => {
        let v = i.value.trim().slice(0, max);
        if (key === 'webUrl' && v !== '' && !/^https?:\/\/[^\s<>"']{1,200}$/.test(v)) { v = ''; i.value = ''; alert('Only web addresses that start with http:// or https:// are accepted.'); }
        d.info[key] = v; save(); queueSync(); updateStatus();
        if (key === 'webUrl') renderSide();
      });
      box.appendChild(el('p', 'small-note', label)); box.appendChild(i);
    };
    mk('Brand', 'brand', hint || d.vendor || 'for example: HPE', 60);
    mk('Model', 'model', 'for example: 1920S 24G', 60);
    if (isNet) {
      const pi = el('input'); pi.type = 'text'; pi.maxLength = 4; pi.placeholder = 'for example: 24'; pi.value = d.info.ports === null ? '' : String(d.info.ports);
      pi.addEventListener('change', () => { const v = pi.value.trim(); d.info.ports = /^\d{1,4}$/.test(v) && Number(v) <= 1024 ? Number(v) : null; pi.value = d.info.ports === null ? '' : String(d.info.ports); save(); updateStatus(); });
      box.appendChild(el('p', 'small-note', 'Number of ports')); box.appendChild(pi);
      mk('Web interface address (if it has one)', 'webUrl', 'http://192.168.0.2', 200);
      if (d.info.webUrl && !wp) {
        const r2 = el('div', 'btnrow');
        r2.appendChild(btn('Add as web panel', () => {
          if (state.panels.some((x) => x.url === d.info.webUrl)) { alert('A panel for that address already exists.'); return; }
          state.panels.push({ id: newId(), name: (title(d) || 'Switch').slice(0, 60), url: d.info.webUrl });
          save(); render(); alert('Added to your Panels tab.');
        }));
        box.appendChild(r2);
      }
    }
    box.appendChild(el('p', 'small-note', 'What it is used for'));
    const ta = el('textarea'); ta.maxLength = 400; ta.placeholder = 'for example: Office switch, uplink to the garage';
    ta.value = d.info.notes || '';
    ta.addEventListener('change', () => { d.info.notes = ta.value.slice(0, 400); save(); });
    box.appendChild(ta);
    if (!d.isRouter) {
      box.appendChild(el('p', 'small-note', 'VLAN (the name or number from your switch)'));
      const v = el('input'); v.type = 'text'; v.maxLength = 30; v.placeholder = 'for example: 20 IoT'; v.value = d.vlan || '';
      v.addEventListener('change', () => { d.vlan = v.value.trim().slice(0, 30); save(); queueSync(); });
      box.appendChild(v);
    }
    side.appendChild(box);
  }

  function servicesSection(side, d) {
    const box = el('div', 'infobox');
    box.appendChild(el('h4', null, 'Services and VPNs'));
    const list = servicesOf(d, false);
    if (!list.length) box.appendChild(el('p', 'small-note', 'None found yet. Services are the programs a machine offers (web apps, Docker containers, VPNs). You can add ones the scan cannot see, like a WireGuard VPN.'));
    list.forEach((s) => {
      const r = el('div', 'btnrow');
      r.appendChild(btn((s.kind === 'vpn' ? 'VPN: ' : '') + s.name + (s.port ? '  :' + s.port : ''), () => { selected = { type: 'svc', key: d.key, id: s.id }; refresh(); }));
      box.appendChild(r);
    });
    if (!net.showServices) box.appendChild(el('p', 'small-note', 'Tick "Show services" above the map to see these as small boxes around the machine.'));
    if ((d.svcHidden || []).length) {
      const r = el('div', 'btnrow');
      r.appendChild(btn('Show ' + d.svcHidden.length + ' hidden', () => { d.svcHidden = []; save(); queueSync(); renderSide(); }));
      box.appendChild(r);
    }
    box.appendChild(el('p', 'small-note', 'Add one yourself'));
    const ni = el('input'); ni.type = 'text'; ni.maxLength = 40; ni.placeholder = 'Name, for example: Grafana or WireGuard';
    const pi = el('input'); pi.type = 'text'; pi.maxLength = 5; pi.placeholder = 'Port (optional)';
    const ks = el('select');
    [['service', 'Service'], ['vpn', 'VPN']].forEach((o) => { const op = el('option', null, o[1]); op.value = o[0]; ks.appendChild(op); });
    box.appendChild(ni); box.appendChild(pi); box.appendChild(ks);
    const r2 = el('div', 'btnrow');
    r2.appendChild(btn('Add', () => {
      const name = ni.value.trim().slice(0, 40);
      const pv = pi.value.trim();
      const port = /^\d{1,5}$/.test(pv) && Number(pv) >= 1 && Number(pv) <= 65535 ? Number(pv) : null;
      if (!name && !port) { alert('Type a name or a port.'); return; }
      if (pv && port === null) { alert('The port must be a number from 1 to 65535.'); return; }
      if ((d.services || []).length >= 30) { alert('That is the most services one machine can have.'); return; }
      d.services.push({ id: newId().replace(/[^a-zA-Z0-9]/g, '').slice(0, 10), name: name, port: port, kind: ks.value === 'vpn' ? 'vpn' : 'service' });
      save(); queueSync(); renderSide();
    }));
    box.appendChild(r2);
    side.appendChild(box);
  }

  function addAsPanel(d, p) {
    const url = webUrl(d, p.port);
    if (state.panels.some((x) => x.url === url)) { sideMessage('A panel for ' + url + ' already exists.'); return; }
    const name = (p.title || d.label || d.hostname || d.ip) + (d.ports.filter((q) => WEB_PORTS.has(q.port)).length > 1 ? ' :' + p.port : '');
    state.panels.push({ id: newId(), name: name.slice(0, 60), url: url });
    save();
    render();
    sideMessage('Added "' + name + '" to your Panels tab.');
  }

  function addAsServer(d) {
    const s = $('serversBtn');
    if (!s) return;
    s.click();
    const sshPort = d.ports.find((p) => p.port === 22);
    $('srvName').value = title(d).slice(0, 60);
    $('srvHost').value = d.ip;
    $('srvPort').value = sshPort ? '22' : '';
    $('srvUser').focus();
  }

  // ---------- scanning ----------
  let scanKind = null;          // null, 'manual' (you pressed Scan) or 'background' (live update)
  let pendingManual = false;    // you pressed Scan while a live update was running
  let interfaces = [];
  let liveTimer = null;

  function setStatus(t, warn) {
    els.status.textContent = t; els.status.title = t || '';
    els.status.classList.toggle('warn', !!warn);
  }

  function currentCidr() {
    return els.iface.value === '__other' ? els.cidr.value.trim() : els.iface.value;
  }

  function fillInterfaces(list, gateway) {
    interfaces = list;
    els.iface.textContent = '';
    const seen = new Set();
    list.forEach((i) => {
      if (seen.has(i.cidr)) return;
      seen.add(i.cidr);
      const o = document.createElement('option');
      o.value = i.cidr;
      o.textContent = i.name + ' · ' + i.address + ' · ' + i.cidr + (i.vlan ? ' · VLAN ' + i.vlan : '');
      els.iface.appendChild(o);
    });
    const other = document.createElement('option');
    other.value = '__other';
    other.textContent = 'Other (type it)...';
    els.iface.appendChild(other);

    // choose: the network that contains the router, else the saved one, else the first
    let pick = null;
    const routerPrefix = net.router.split('.').slice(0, 3).join('.') + '.';
    list.forEach((i) => { if (!pick && i.cidr.startsWith(routerPrefix)) pick = i.cidr; });
    if (!pick && net.cidr && seen.has(net.cidr)) pick = net.cidr;
    if (!pick && list.length) pick = list[0].cidr;
    if (pick) els.iface.value = pick;
    else { els.iface.value = '__other'; els.cidr.value = net.cidr || '192.168.0.0/24'; }
    els.cidr.classList.toggle('hidden', els.iface.value !== '__other');
  }

  function ipInt(ip) { return ip.split('.').reduce((n, p) => n * 256 + Number(p), 0); }
  function inCidr(ip, cidr) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr || '');
    if (!m || !validIp(ip) || !validIp(m[1])) return false;
    const size = Math.pow(2, 32 - Number(m[2]));
    const base = Math.floor(ipInt(m[1]) / size) * size;
    const n = ipInt(ip);
    return n >= base && n < base + size;
  }

  function knownIps() {
    return devices().filter((d) => !d.isRouter && d.ip && d.lastSeen && ((d.ports && d.ports.length) || (d.os && d.os.id !== 'unknown'))).map((d) => d.ip).slice(0, 1100);
  }

  // ---------- network guard: a profile's map is never changed by scans or router checks from another network ----------
  const guard = { blocked: false, locked: false, cur: null, declined: '' };
  function activeProf() { try { return (state.profiles || []).find((p) => p.id === state.activeProfileId) || null; } catch (e) { return null; } }
  function guardStopped() { return guard.blocked || guard.locked; }
  function sameNetwork(fp, cur) {
    if (!fp || !cur || !cur.gateway) return true;             // no router found (cable out?): nothing to compare, nothing blocked
    if (fp.gw && fp.gw !== cur.gateway) return false;
    if (fp.mac && cur.mac && fp.mac !== cur.mac) return false;
    return true;
  }
  function renderGuard() {
    const el = $('netGuard');
    if (!el) return;
    const p = activeProf();
    el.textContent = '';
    el.classList.remove('locked');
    if (!p || !(guard.locked || guard.blocked)) { el.classList.add('hidden'); return; }
    const add = (tag, txt, cls) => { const e = document.createElement(tag); e.textContent = txt; if (cls) e.className = cls; el.appendChild(e); return e; };
    const curKey = guard.cur ? guard.cur.gateway + '|' + guard.cur.mac : '';
    const matches = guard.blocked ? (state.profiles || []).filter((o) => o.id !== p.id && o.fp && o.fp.gw === (guard.cur && guard.cur.gateway) && sameNetwork(o.fp, guard.cur)) : [];
    if (guard.blocked && matches.length && guard.declined !== curKey) {
      add('span', 'You\u2019re not on the right profile. Would you like to automatically switch to the profile for this network' + (matches.length === 1 ? ' (\u201c' + matches[0].name + '\u201d)?' : '?'), 'ng-text');
      matches.forEach((o) => {
        add('button', matches.length === 1 ? 'Yes, switch' : 'Yes, switch to \u201c' + o.name + '\u201d').addEventListener('click', () => { if (window.hubProfilesSwitch) window.hubProfilesSwitch(o.id); });
      });
      add('button', 'No, stay on this profile').addEventListener('click', () => { guard.declined = curKey; renderGuard(); });
      el.classList.remove('hidden');
      return;
    }
    if (guard.blocked) {
      add('span', 'This computer is on a different network than the profile "' + p.name + '" (router ' + (guard.cur && guard.cur.gateway || '?') + ', profile was made on ' + (p.fp && p.fp.gw || '?') + '). Scans and router checks are paused so that map is not changed.', 'ng-text');
      (state.profiles || []).filter((o) => o.id !== p.id && o.fp && sameNetwork(o.fp, guard.cur) && o.fp.gw === (guard.cur && guard.cur.gateway)).forEach((o) => {
        add('button', 'Switch to "' + o.name + '"').addEventListener('click', () => { if (window.hubProfilesSwitch) window.hubProfilesSwitch(o.id); });
      });
      add('button', 'New profile for this network').addEventListener('click', () => { if (window.hubProfilesCreate) window.hubProfilesCreate('Network ' + ((guard.cur && guard.cur.gateway) || 'new')); });
      add('button', 'This is the same network').addEventListener('click', () => { p.fp = { gw: guard.cur.gateway, mac: guard.cur.mac || '' }; guard.blocked = false; saveState(); renderGuard(); scheduleLive(2000); });
    } else {
      el.classList.add('locked');
      add('span', 'The profile "' + p.name + '" is locked. Scans and router checks will not change its map. Unlock it under Profiles.', 'ng-text');
    }
    el.classList.remove('hidden');
  }
  let guardBusy = false;
  async function guardCheck(prefetched) {
    const p = activeProf();
    const wasBlocked = guard.blocked, wasLocked = guard.locked, wasGw = guard.cur && guard.cur.gateway + '|' + guard.cur.mac;
    guard.locked = !!(p && p.locked);
    if (p && window.netApi && !guardBusy) {
      guardBusy = true;
      try {
        const res = prefetched || await window.netApi.interfaces();
        if (res && res.ok && res.gateway) {
          const cur = { gateway: res.gateway, mac: res.gatewayMac || '' };
          guard.cur = cur;
          if (res.speeds) { try { const me = devices().find((x) => x.self); const mine = me && (res.interfaces || []).find((i) => i.address === me.ip); const sp = mine && res.speeds[mine.name]; if (me && sp && speedNum(sp.mbps)) me.linkSpeed = { mbps: speedNum(sp.mbps), wireless: sp.wireless === true }; } catch (e) { /* optional */ } }
          if (!p.fp) { p.fp = { gw: cur.gateway, mac: cur.mac }; saveState(); }
          else if (sameNetwork(p.fp, cur)) { if (!p.fp.mac && cur.mac && p.fp.gw === cur.gateway) { p.fp.mac = cur.mac; saveState(); } }
          guard.blocked = !sameNetwork(p.fp, cur);
        } else guard.blocked = false;
      } catch (e) { /* keep the last answer */ }
      guardBusy = false;
    } else if (!p) guard.blocked = false;
    if (guardStopped() && scanKind && window.netApi) window.netApi.cancel();
    if (wasBlocked !== guard.blocked || wasLocked !== guard.locked || wasGw !== (guard.cur && guard.cur.gateway + '|' + guard.cur.mac)) renderGuard();
    return guardStopped();
  }
  setInterval(() => { if (!document.hidden || window.hubBackground) guardCheck(); }, 15000);

  async function startScan(opts) {
    if (!scanKind) {
      const stopped = await guardCheck();
      if (stopped) {
        renderGuard();
        if (!(opts && opts.background)) setStatus(guard.locked ? 'This profile is locked, so it will not be scanned. Unlock it under Profiles.' : 'You are on a different network than this profile, so the scan was not started. See the notice above the map.', true);
        scheduleLive();
        return;
      }
    }
    return startScanInner(opts);
  }
  async function startScanInner(opts) {
    const background = !!(opts && opts.background);
    if (scanKind) {
      if (!background && scanKind === 'background' && window.netApi) {      // you pressed Scan: stop the quiet one first
        pendingManual = true;
        setStatus('Starting...');
        window.netApi.cancel();
      }
      return;
    }
    if (!window.netApi) { if (!background) setStatus('Scanning only works inside the Dashboard Hub app.', true); return; }
    let router, cidr;
    if (background) {
      router = net.router;
      cidr = net.cidr;
    } else {
      router = els.router.value.trim();
      if (!validIp(router)) { setStatus('Type your router\'s address, like 192.168.0.1', true); return; }
      cidr = currentCidr();
      if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) { setStatus('Type the network like 192.168.0.0/24', true); return; }
      setRouter(router, true);
      net.cidr = cidr;
      net.mode = els.mode.value === 'thorough' ? 'thorough' : 'quick';
      save();
    }
    seenKeys = new Set(['router']);
    newCount = 0;
    alertBase = !!net.scannedOnce;
    alertQueue = [];
    { const ifc = (interfaces || []).find((i) => i.cidr === cidr); scanVlan = ifc && ifc.vlan ? 'VLAN ' + ifc.vlan : ''; }
    scanKind = background ? 'background' : 'manual';       // claimed before waiting, so two scans can never start at once
    if (!background) setStatus('Starting...');
    let res;
    try {
      res = await window.netApi.scan(background
        ? { cidr: cidr, mode: 'background', router: router, known: knownIps() }
        : { cidr: cidr, mode: net.mode, router: router });
    } catch (e) { res = { ok: false, error: 'The scan could not start.' }; }
    if (!res || !res.ok) {
      scanKind = null;
      if (!background) setStatus((res && res.error) || 'The scan could not start.', true);
      scheduleLive();
      return;
    }
    if (background) { setLiveBusy(true); return; }
    els.scan.classList.add('hidden');
    els.stop.classList.remove('hidden');
    els.progress.classList.remove('hidden');
    els.bar.style.width = '2%';
    setStatus('Scanning ' + res.cidr + '...');
    updateEmptyMessage();
  }

  ['change', 'click', 'keydown', 'input'].forEach((ev) => els.side.addEventListener(ev, () => { sideUserEvent = true; setTimeout(() => { sideUserEvent = false; }, 0); }, true));
  document.addEventListener('mousedown', () => { sideMouseDown = true; }, true);
  document.addEventListener('mouseup', () => { sideMouseDown = false; }, true);
  function sideIsBusy() { return els.side.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName); }

  // ---------- DNS servers ----------
  // After a scan, every online machine is asked (once an hour at most) whether it is a DNS server.
  let dnsBusy = false;
  async function dnsSweep(force) {
    if (dnsBusy || !window.netApi || !window.netApi.dns) return;
    const now = Date.now();
    const todo = devices().filter((d) => d.ip && d.online !== false && (force || !d.dnsAt || now - d.dnsAt > 3600 * 1000));
    if (!todo.length) return;
    dnsBusy = true;
    try {
      const r = await window.netApi.dns(todo.map((d) => d.ip));
      if (r && r.ok && r.results) {
        todo.forEach((d) => {
          const x = r.results[d.ip];
          if (!x) return;
          d.dns = x.server ? { server: true, recursive: x.recursive === true, refused: x.refused === true, software: text(x.software || '', 60) } : null;
          d.dnsAt = now;
        });
        save();
        if (!sideIsBusy()) renderSide();
      }
    } catch (e) { /* DNS is a bonus: a failure changes nothing */ }
    dnsBusy = false;
  }
  function dnsServers() { return devices().filter((d) => d.dns && d.dns.server && d.online !== false); }

  function onScanEvent(m) {
    if (!m || typeof m !== 'object' || !scanKind) return;
    const bg = scanKind === 'background';
    if (guardStopped()) {                      // a scan that is still running from before: its results are thrown away
      if (m.type === 'done') {
        scanKind = null;
        if (!bg) { els.scan.classList.remove('hidden'); els.stop.classList.add('hidden'); els.progress.classList.add('hidden'); setStatus('Scan stopped: this computer is on a different network than the profile.', true); }
        else setLiveBusy(false);
        scheduleLive();
      }
      return;
    }
    if (m.type === 'host') {
      const d = mergeHost(m.host);
      queueSync();
      // a quiet update never redraws the side panel under your hands
      if (d && selected && selected.type === 'node' && selected.key === d.key && !sideIsBusy()) renderSide();
    } else if (m.type === 'progress') {
      if (bg) return;
      const frac = m.total ? m.done / m.total : 0;
      const pct = m.phase === 'discovery' ? frac * 40 : 40 + frac * 60;
      els.bar.style.width = Math.max(2, Math.min(100, pct)) + '%';
      setStatus((m.message || 'Scanning...') + ' ' + Math.round(pct) + '%');
    } else if (m.type === 'done') {
      scanKind = null;
      if (!bg) {
        els.scan.classList.remove('hidden');
        els.stop.classList.add('hidden');
        els.progress.classList.add('hidden');
      }
      if (!m.canceled && !m.error) {
        // a machine counts as gone after it is missed (twice in a row for quiet updates, so one lost reply never makes it flicker)
        const need = bg ? 2 : 1;
        const scanned = net.cidr;
        devices().forEach((d) => {
          if (d.isRouter || (d.manual && !d.ip)) return;
          if (seenKeys.has(d.key)) { d.misses = 0; d.online = true; return; }
          if (d.ip && !inCidr(d.ip, scanned)) return;      // this scan did not look at that part of the network
          d.misses = (d.misses || 0) + 1;
          if (d.misses >= need) { if (d.online !== false) alertEvent('left', d); d.online = false; }
        });
        net.scannedOnce = true;
      }
      save();
      queueSync();
      if (!m.canceled && !m.error) scanDoneHooks.forEach((fn) => { try { fn(bg); } catch (e) { /* ignore */ } });
      if (!m.canceled && !m.error) flushAlerts(); else alertQueue = [];
      if (!bg || !sideIsBusy()) renderSide();
      if (bg) {
        setLiveBusy(false);
        liveLast = 'Last auto scan: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLiveText(liveLast);
      } else {
        if (m.error) setStatus('The scan stopped: ' + m.error, true);
        else if (m.canceled && !pendingManual) setStatus('Scan stopped. ' + (devices().length - 1) + ' machines on the map.');
        else if (!m.canceled) setStatus('Done. Found ' + Math.max(0, seenKeys.size - (seenKeys.has('router') ? 1 : 0)) + ' machines' + (newCount ? ' (' + newCount + ' new)' : '') + '.');
        if (!m.canceled && (!fitted || newCount)) setTimeout(() => fitView(false), 60);
        updateEmptyMessage();
      }
      if (pendingManual) { pendingManual = false; startScan(); return; }
      scheduleLive();
    }
  }

  // ---------- quiet live updates ----------
  function setLiveText(t) { if (els.liveText) els.liveText.textContent = t || ''; }
  let liveLast = '';   // when the last automatic check finished
  function setLiveBusy(on) {
    if (els.liveDot) els.liveDot.classList.toggle('busy', !!on);
    if (on) setLiveText('Auto scan in progress...');
    else if (net && net.autoSeconds > 0 && els.liveText && els.liveText.textContent === 'Auto scan in progress...') setLiveText(liveLast || liveIdleText());   // a check that ended without finishing
  }
  function liveIdleText() {
    const o = els.live && els.live.selectedOptions && els.live.selectedOptions[0];
    return 'Auto scan on' + (o ? ': ' + o.textContent.toLowerCase() : '');
  }
  function updateLiveUi() {
    const on = net.autoSeconds > 0;
    if (els.live) els.live.value = String(net.autoSeconds);
    if (els.liveDot) { els.liveDot.classList.toggle('off', !on); els.liveDot.title = on ? 'The green dot means Live update is on: the map quietly re-scans now and then to see machines joining and leaving. It blinks while a check is running.' : 'Live update is off.'; }
    if (!on) { setLiveText(''); liveLast = ''; }
    else if (els.liveText && (!els.liveText.textContent || /^Auto scan on/.test(els.liveText.textContent) || /^starts after/.test(els.liveText.textContent))) { if (net.scannedOnce) setLiveText(liveLast || liveIdleText()); }
  }
  function canLive() {
    return !!(window.netApi && net.autoSeconds > 0 && net.scannedOnce && net.cidr && scanKind === null && (!document.hidden || window.hubBackground === true) &&
      devices().some((d) => !d.isRouter && !d.manual));
  }
  function scheduleLive(delay) {
    clearTimeout(liveTimer);
    liveTimer = null;
    updateLiveUi();
    if (!net.autoSeconds) return;
    liveTimer = setTimeout(liveTick, delay !== undefined ? delay : net.autoSeconds * 1000);
  }
  function liveTick() {
    liveTimer = null;
    if (!canLive()) { scheduleLive(); return; }
    startScan({ background: true });
    if (window.hubConnections && window.hubConnections.syncNow) {
      window.hubConnections.syncNow();
    }
  }

  // ---------- switches you add by hand ----------
  function addSwitch() {
    const key = 'manual:' + newId().replace(/[^a-z0-9]/g, '').slice(0, 20);
    const d = cleanDevice(key, { label: 'Switch', osOverride: 'switch', pos: spiralPos(devices().length) });
    net.devices[key] = d;
    selected = { type: 'node', key: key };
    pending = null;
    save();
    refresh();
    setHint('Switch added. In the panel on the right, press "Connect to router" (or use Draw lines) to join it to the network.');
  }

  function setRouter(ip, byUser) {
    if (ip === net.router) { if (byUser) net.routerUser = true; return; }
    net.router = ip;
    if (byUser) net.routerUser = true;
    const r = net.devices.router;
    // the old router details no longer apply
    Object.assign(r, { ip: ip, mac: null, vendor: null, hostname: null, ports: [], ttl: null, lastSeen: null, online: true,
      os: { id: 'network', label: OS_NAMES.network, confidence: 'high', reasons: ['this is your router'] } });
    // a machine already on the map with that address becomes the router
    const dup = devices().find((d) => !d.isRouter && d.ip === ip);
    if (dup) {
      Object.assign(r, { mac: dup.mac, vendor: dup.vendor, hostname: dup.hostname, ports: dup.ports, ttl: dup.ttl, lastSeen: dup.lastSeen, online: dup.online });
      delete net.devices[dup.key];
      net.links = net.links.filter((l) => l.a !== dup.key && l.b !== dup.key);
      removeNode(dup.key);
    }
    els.router.value = ip;
    save();
    refresh();
  }

  // ---------- tidy / layout ----------
  function tidy() {
    const list = devices().filter((d) => !d.isRouter).sort(ipSort);
    list.forEach((d, i) => { d.pos = spiralPos(i); });
    save();
    refresh();
    fitView(false);
  }

  // ---------- switching tabs ----------
  function showView(v) {
    const map = v === 'map';
    document.body.classList.toggle('view-map', map);
    els.tabMap.classList.toggle('active', map);
    els.tabPanels.classList.toggle('active', !map);
    state.view = map ? 'map' : 'panels';
    save();
    if (map) {
      if (initThree()) {
        setHint();
        resize();
        queueSync();
        startLoop();
        if (!fitted) setTimeout(() => fitView(false), 80);
      }
      renderSide();
      updateEmptyMessage();
    } else {
      stopLoop();
      els.tip.classList.add('hidden');
    }
  }

  function buildLegend() {
    els.legend.textContent = '';
    ['router', 'switch', 'windows', 'linux', 'apple', 'android', 'iot', 'console', 'printer', 'network', 'unknown'].forEach((k) => {
      const isRouterKey = k === 'router';
      const s = document.createElement(isRouterKey ? 'span' : 'label');
      s.dataset.type = k;
      if (!isRouterKey) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.title = 'Show only ' + OS_NAMES[k] + ' devices (tick several to see several kinds; untick all to see everything)';
        cb.addEventListener('change', () => {
          if (cb.checked) typeFilter.add(k); else typeFilter.delete(k);
          updateLegend();
          queueSync();
        });
        s.appendChild(cb);
      }
      const i = document.createElement('i');
      i.style.background = '#' + OS_COLORS[k].toString(16).padStart(6, '0');
      s.appendChild(i);
      s.appendChild(document.createTextNode(OS_NAMES[k]));
      els.legend.appendChild(s);
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'legend-clear hidden';
    clear.textContent = 'Show all';
    clear.addEventListener('click', () => { typeFilter.clear(); updateLegend(); queueSync(); });
    els.legend.appendChild(clear);
  }
  function updateLegend() {
    els.legend.classList.toggle('filtering', typeFilter.size > 0);
    els.legend.querySelectorAll('label').forEach((lab) => {
      const on = typeFilter.has(lab.dataset.type);
      lab.classList.toggle('on', on);
      const cb = lab.querySelector('input');
      if (cb) cb.checked = on;
    });
    const c = els.legend.querySelector('.legend-clear');
    if (c) c.classList.toggle('hidden', typeFilter.size === 0);
  }

  // ---------- alerts: a machine joined or left ----------
  function alertEvent(kind, dev) {
    if (!alertBase || !dev) return;
    alertQueue.push({ kind: kind, key: dev.key, name: title(dev), ip: dev.ip });
  }
  function alertLine(e) {
    return (e.kind === 'left' ? 'Disconnected: ' : e.kind === 'new' ? 'New device: ' : 'Connected: ') + e.name + (e.ip && e.name !== e.ip ? ' (' + e.ip + ')' : '');
  }
  function showToast(message, kind, key) {
    if (!els.toasts) return;
    const t = el('div', 'map-toast ' + (kind || ''), message);
    t.addEventListener('click', () => {
      if (key && net.devices[key]) { selected = { type: 'node', key: key }; pending = null; refresh(); }
      t.remove();
    });
    els.toasts.appendChild(t);
    while (els.toasts.children.length > 5) els.toasts.firstChild.remove();
    setTimeout(() => { if (t.parentNode) t.remove(); }, 9000);
  }
  function desktopNotify(body) {
    try {
      if (window.settingsApi && window.settingsApi.notify) {
        window.settingsApi.notify(body).then((r) => { if (!r || !r.ok) webNotify(body); }).catch(() => webNotify(body));
        return;
      }
      webNotify(body);
    } catch (e) { /* ignore */ }
  }
  function webNotify(body) {
    try {
      if (!('Notification' in window)) return;
      const go = () => { try { new Notification('Dashboard Hub', { body: body }); } catch (e) { /* ignore */ } };
      if (Notification.permission === 'granted') go();
      else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') go(); }).catch(() => {});
    } catch (e) { /* ignore */ }
  }
  function flushAlerts() {
    const q = alertQueue;
    alertQueue = [];
    if (!q.length || net.alerts === 'off') return;
    let lines;
    if (q.length <= 3) {
      lines = q.map(alertLine);
      q.forEach((e, i) => showToast(lines[i], e.kind, e.key));
    } else {
      const n = (k) => q.filter((e) => e.kind === k).length;
      const parts = [];
      if (n('new')) parts.push(n('new') + ' new');
      if (n('back')) parts.push(n('back') + ' connected');
      if (n('left')) parts.push(n('left') + ' disconnected');
      lines = ['Network changes: ' + parts.join(', ')];
      showToast(lines[0], 'new', null);
    }
    if (net.alerts === 'desktop') desktopNotify(lines.join('\n'));
  }

  // When the colour key is used, switches that lead to a machine you want to see stay visible too.
  // the cheapest route from the router to every machine: a cable you drew counts as nearly free, a line the app found is the normal price
  function routeTree() {
    const adj = new Map();
    net.links.forEach((l) => {
      if (!net.devices[l.a] || !net.devices[l.b]) return;
      const cost = l.cable === true && !l.auto ? 0.1 : !l.auto ? 0.5 : 1;
      if (!adj.has(l.a)) adj.set(l.a, []);
      if (!adj.has(l.b)) adj.set(l.b, []);
      adj.get(l.a).push([l.b, cost]); adj.get(l.b).push([l.a, cost]);
    });
    const dist = new Map([['router', 0]]);
    const parent = new Map([['router', null]]);
    const todo = new Set(['router']);
    while (todo.size) {
      let k = null;
      todo.forEach((x) => { if (k === null || dist.get(x) < dist.get(k)) k = x; });
      todo.delete(k);
      (adj.get(k) || []).forEach((e) => {
        const nd = dist.get(k) + e[1];
        if (!dist.has(e[0]) || nd < dist.get(e[0]) - 1e-9) { dist.set(e[0], nd); parent.set(e[0], k); todo.add(e[0]); }
      });
    }
    return parent;
  }
  let keepKeys = null;
  let pathKeys = null;     // machines shown only because they sit on the way (switches, cables) to a machine you asked to see
  function computeKeep() {
    keepKeys = new Set(['router']);
    pathKeys = new Set();
    if (!typeFilter.size) return;
    const parent = routeTree();
    devices().forEach((d) => {
      if (d.isRouter || !typeFilter.has(effectiveOs(d))) return;
      let k = d.key;
      let first = true;
      while (k && !keepKeys.has(k)) {
        keepKeys.add(k);
        if (!first) pathKeys.add(k);
        first = false;
        k = parent.get(k);
      }
    });
    // switches and other network gear are the cabling of the map: they stay visible whatever kind you filter by
    devices().forEach((d) => {
      if (d.isRouter) return;
      const os = effectiveOs(d);
      if (os !== 'switch' && os !== 'network') return;
      keepKeys.add(d.key);
      pathKeys.add(d.key);
    });
    // a machine that was reached through another wanted machine is wanted itself: only keep "path only" for the ones not asked for
    pathKeys.forEach((k) => { const d = net.devices[k]; if (d && typeFilter.has(effectiveOs(d))) pathKeys.delete(k); });
  }

  // ---------- device list: slides in, pick several machines, change them all at once ----------
  const listSel = new Set();
  let listOpen = false, listQuery = '', listType = '', listMsg = '';
  let lsRows = null, lsBulk = null, lsSearch = null, lsAll = null;
  const TYPE_IDS = ['windows', 'linux', 'apple', 'android', 'iot', 'console', 'printer', 'network', 'switch', 'unknown'];

  function listDevices() {
    const q = listQuery.trim().toLowerCase();
    return devices().filter((d) => !d.isRouter).filter((d) => {
      if (listType && effectiveOs(d) !== listType) return false;
      if (!q) return true;
      const hay = [title(d), d.ip, d.mac, d.vendor, d.group, d.vlan, OS_NAMES[effectiveOs(d)]].join(' ').toLowerCase();
      return hay.includes(q);
    }).sort(ipSort);
  }
  function deviceLines(d) { return net.links.filter((l) => l.a === d.key || l.b === d.key); }

  function buildList() {
    const root = els.list;
    root.textContent = '';
    const head = el('div', 'ml-head');
    const tt = el('div', 'ml-title');
    tt.appendChild(el('h3', null, 'Devices'));
    tt.appendChild(btn('Close', () => setListOpen(false)));
    head.appendChild(tt);
    lsSearch = el('input'); lsSearch.type = 'text'; lsSearch.placeholder = 'Search name, address, maker, group...'; lsSearch.id = 'mapListSearch';
    lsSearch.addEventListener('input', () => { listQuery = lsSearch.value; renderList(); });
    head.appendChild(lsSearch);
    const fsel = el('select'); fsel.id = 'mapListType';
    const o0 = el('option', null, 'All types'); o0.value = ''; fsel.appendChild(o0);
    TYPE_IDS.forEach((k) => { const o = el('option', null, OS_NAMES[k]); o.value = k; fsel.appendChild(o); });
    fsel.addEventListener('change', () => { listType = fsel.value; renderList(); });
    head.appendChild(fsel);
    const tools = el('div', 'ml-tools');
    const allLab = el('label');
    lsAll = el('input'); lsAll.type = 'checkbox'; lsAll.id = 'mapListAll';
    lsAll.addEventListener('change', () => {
      const shown = listDevices();
      if (lsAll.checked) shown.forEach((d) => listSel.add(d.key)); else shown.forEach((d) => listSel.delete(d.key));
      listMsg = ''; renderList();
    });
    allLab.appendChild(lsAll); allLab.appendChild(document.createTextNode('Select all shown'));
    tools.appendChild(allLab);
    tools.appendChild(btn('Clear', () => { listSel.clear(); listMsg = ''; renderList(); }));
    head.appendChild(tools);
    root.appendChild(head);
    lsRows = el('div', 'ml-rows'); lsRows.id = 'mapListRows';
    root.appendChild(lsRows);
    lsBulk = el('div', 'ml-bulk'); lsBulk.id = 'mapListBulk';
    root.appendChild(lsBulk);
  }

  function setListOpen(on) {
    listOpen = !!on;
    els.list.classList.toggle('closed', !listOpen);
    els.list.setAttribute('aria-hidden', listOpen ? 'false' : 'true');
    els.legend.classList.toggle('list-open', listOpen);
    els.listBtn.classList.toggle('on', listOpen);
    if (listOpen) renderList();
  }

  function renderList() {
    if (!listOpen || !net || !lsRows) return;
    Array.from(listSel).forEach((k) => { if (!net.devices[k] || net.devices[k].isRouter) listSel.delete(k); });
    const shown = listDevices();
    lsRows.textContent = '';
    if (!shown.length) {
      lsRows.appendChild(el('div', 'ml-empty', devices().length > 1 ? 'No machines match.' : 'No machines yet. Scan your network first.'));
    }
    const groups = new Map();
    shown.forEach((d) => { const g = d.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); });
    const names = Array.from(groups.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const showHeads = names.length > 1 || (names.length === 1 && names[0] !== '');
    names.forEach((g) => {
      const list = groups.get(g);
      if (showHeads) {
        const gh = el('div', 'ml-group');
        const gc = el('input'); gc.type = 'checkbox'; gc.checked = list.every((d) => listSel.has(d.key));
        gc.addEventListener('click', (e) => e.stopPropagation());
        gc.addEventListener('change', () => { list.forEach((d) => { if (gc.checked) listSel.add(d.key); else listSel.delete(d.key); }); listMsg = ''; renderList(); });
        gh.appendChild(gc);
        gh.appendChild(document.createTextNode((g || 'No group') + ' (' + list.length + ')'));
        gh.addEventListener('click', () => gc.click());
        lsRows.appendChild(gh);
      }
      list.forEach((d) => {
        const row = el('div', 'ml-row' + (listSel.has(d.key) ? ' picked' : '') + (selected && selected.type === 'node' && selected.key === d.key ? ' sel' : '') + (d.online === false ? ' off' : ''));
        row.dataset.key = d.key;
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = listSel.has(d.key);
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => { if (cb.checked) listSel.add(d.key); else listSel.delete(d.key); listMsg = ''; renderList(); });
        row.appendChild(cb);
        const dot = el('span', 'ml-dot');
        dot.style.background = '#' + (OS_COLORS[effectiveOs(d)] || OS_COLORS.unknown).toString(16).padStart(6, '0');
        row.appendChild(dot);
        const main = el('div', 'ml-main');
        main.appendChild(el('div', 'ml-name', title(d)));
        main.appendChild(el('div', 'ml-sub', [d.ip, OS_NAMES[effectiveOs(d)], effectiveOs(d) === 'switch' ? [d.info.brand, d.info.ports ? d.info.ports + ' ports' : ''].filter(Boolean).join(' ') : '', d.vlan, d.online === false ? 'offline' : ''].filter(Boolean).join('  ·  ')));
        if (d.group) main.appendChild(el('div', 'ml-grouptag', 'Group: ' + d.group));
        row.appendChild(main);
        const ls = deviceLines(d);
        if (ls.length) row.appendChild(el('span', 'ml-link', ls.some(isWireless) ? 'wireless' : 'wired'));
        row.addEventListener('click', () => { selected = { type: 'node', key: d.key }; pending = null; refresh(); });
        lsRows.appendChild(row);
      });
    });
    const allSelected = shown.length > 0 && shown.every((d) => listSel.has(d.key));
    lsAll.checked = allSelected;
    renderBulk();
  }

  // The bulk box is rebuilt whenever the map updates; keep what the person is typing (text, cursor, focus)
  function renderBulk() {
    const keep = {}; let focusId = null;
    ['mapBulkGroup', 'mapBulkVlan'].forEach((id) => {
      const i = document.getElementById(id);
      if (i && lsBulk.contains(i)) {
        keep[id] = { v: i.value, s: i.selectionStart, e: i.selectionEnd };
        if (document.activeElement === i) focusId = id;
      }
    });
    renderBulkNow();
    Object.keys(keep).forEach((id) => {
      const i = document.getElementById(id);
      if (!i || !keep[id].v) return;
      i.value = keep[id].v;
      if (id === focusId) { i.focus(); try { i.setSelectionRange(keep[id].s, keep[id].e); } catch (e) { /* ignore */ } }
    });
  }
  function renderBulkNow() {
    lsBulk.textContent = '';
    const n = listSel.size;
    if (!n) {
      lsBulk.appendChild(el('p', 'small-note', 'Tick machines to change several at once: their type, wired or wireless, and a group name.'));
      if (listMsg) lsBulk.appendChild(el('div', 'ml-msg', listMsg));
      return;
    }
    lsBulk.appendChild(el('h4', null, n + (n === 1 ? ' machine' : ' machines') + ' selected'));
    const keys = () => Array.from(listSel).map((k) => net.devices[k]).filter((d) => d && !d.isRouter);

    const tsel = el('select'); tsel.id = 'mapBulkType';
    const t0 = el('option', null, 'Set type...'); t0.value = '__'; tsel.appendChild(t0);
    TYPE_IDS.filter((k) => k !== 'unknown').concat(['unknown']).forEach((k) => { const o = el('option', null, OS_NAMES[k]); o.value = k; tsel.appendChild(o); });
    const tg = el('option', null, 'Use the scan\'s guess'); tg.value = ''; tsel.appendChild(tg);
    tsel.addEventListener('change', () => {
      if (tsel.value === '__') return;
      let c = 0;
      keys().forEach((d) => { if (tsel.value === '' && d.manual) return; d.osOverride = tsel.value || null; c++; });
      listMsg = 'Type changed for ' + c + (c === 1 ? ' machine.' : ' machines.');
      save(); queueSync(); renderSide(); renderList();
    });
    lsBulk.appendChild(tsel);

    const csel = el('select'); csel.id = 'mapBulkConn';
    [['__', 'Set connection...'], ['wired', 'Wired (solid line)'], ['wireless', 'Wireless (dotted line)'], ['', 'Automatic']].forEach((o) => { const op = el('option', null, o[1]); op.value = o[0]; csel.appendChild(op); });
    csel.addEventListener('change', () => {
      if (csel.value === '__') return;
      let done = 0, none = 0;
      keys().forEach((d) => {
        const ls = deviceLines(d);
        if (!ls.length) { none++; return; }
        ls.forEach((l) => { l.wireless = csel.value === 'wireless' ? true : csel.value === 'wired' ? false : null; });
        done++;
      });
      listMsg = 'Connection changed for ' + done + (done === 1 ? ' machine.' : ' machines.') + (none ? ' ' + none + ' had no line yet (draw one first).' : '');
      save(); queueSync(); renderSide(); renderList();
    });
    lsBulk.appendChild(csel);

    const grp = el('div', 'ml-grp');
    const gin = el('input'); gin.type = 'text'; gin.maxLength = 30; gin.placeholder = 'Group name'; gin.id = 'mapBulkGroup';
    grp.appendChild(gin);
    grp.appendChild(btn('Set group', () => {
      const name = text(gin.value.trim(), 30);
      if (!name) { listMsg = 'Type a group name first (or use "Remove from group").'; renderList(); return; }
      keys().forEach((d) => { d.group = name; });
      listMsg = 'Group "' + name + '" set.';
      save(); queueSync(); renderSide(); renderList();
    }));
    lsBulk.appendChild(grp);
    const inGroup = keys().filter((d) => d.group);
    const rm = btn(inGroup.length ? 'Remove from group (' + inGroup.length + ')' : 'Remove from group', () => {
      const c = inGroup.length;
      inGroup.forEach((d) => { d.group = ''; });
      listMsg = c + (c === 1 ? ' machine' : ' machines') + ' removed from ' + (c === 1 ? 'its group.' : 'their groups.');
      save(); queueSync(); renderSide(); renderList();
    });
    rm.id = 'mapBulkUngroup';
    if (!inGroup.length) { rm.disabled = true; rm.title = 'None of the selected machines is in a group.'; }
    lsBulk.appendChild(rm);
    const wrow = el('div', 'ml-grp');
    wrow.appendChild(btn('Wake up selected', () => {
      const list = keys();
      listMsg = list.some((d) => d.mac) ? 'Sending wake-up signals...' : 'None of the selected machines has a hardware (MAC) address.';
      renderList();
      if (list.some((d) => d.mac)) wakeDevices(list).then((m) => { listMsg = m; renderList(); });
    }));
    lsBulk.appendChild(wrow);
    lsBulk.appendChild(btn('Run LAN speedtest', () => {
      listMsg = 'Asking your routers and switches...'; renderList();
      runLanSpeedtest(keys()).then((m) => { listMsg = m; renderList(); renderSide(); });
    }));
    const vrow = el('div', 'ml-grp');
    const vin = el('input'); vin.type = 'text'; vin.maxLength = 30; vin.placeholder = 'VLAN (for example: 20 IoT)'; vin.id = 'mapBulkVlan';
    vrow.appendChild(vin);
    vrow.appendChild(btn('Set VLAN', () => {
      const name = text(vin.value.trim(), 30);
      keys().forEach((d) => { d.vlan = name; });
      listMsg = name ? 'VLAN "' + name + '" set.' : 'VLAN cleared.';
      save(); queueSync(); renderSide(); renderList();
    }));
    lsBulk.appendChild(vrow);
    if (listMsg) lsBulk.appendChild(el('div', 'ml-msg', listMsg));
  }

  // ---------- what routers and switches told us (see connections-ui.js) ----------
  const scanDoneHooks = [];
  scanDoneHooks.push(() => { dnsSweep(false); });
  function applyConnector(res) {
    if (!res || !res.ok || !net) return { clients: 0, created: 0 };
    if (guardStopped()) return { clients: 0, created: 0 };
    const by = text(res.name || (res.self && res.self.name) || (res.self && res.self.brand ? res.self.brand + ' AP' : 'Router'), 40);
    let created = 0, touched = 0;
    const before = new Set(Object.keys(net.devices));

    const fillGear = (d, g) => {
      if (!d || d.isRouter) return;
      if (Number.isFinite(g.uptimeSec) && g.uptimeSec >= 0) d.upInfo = { sec: Math.floor(g.uptimeSec), at: Date.now(), kind: 'device' };
      if (g.name && !d.label && g.kind !== undefined && ['switch', 'ap', 'router'].includes(g.kind)) d.label = text(g.name, 60);
      if (g.brand && !d.info.brand) d.info.brand = text(g.brand, 60);
      if (g.model && !d.info.model) d.info.model = text(g.model, 60);
      if (Number.isInteger(g.ports) && g.ports > 0 && d.info.ports === null) d.info.ports = Math.min(1024, g.ports);
      if (!d.osOverride && g.kind === 'switch') d.osOverride = 'switch';
      else if (!d.osOverride && (g.kind === 'ap' || g.kind === 'router')) d.osOverride = 'network';
    };

    // Lines you drew are yours: the scan and router checks only add or replace lines THEY found (auto), never yours
    const reachesRouter = (startKey, avoidKey) => {
      const seen = new Set([avoidKey, startKey]);
      const queue = [startKey];
      while (queue.length) {
        const k = queue.shift();
        if (k === 'router') return true;
        net.links.forEach((l) => {
          const o = l.a === k ? l.b : l.b === k ? l.a : null;
          if (o && !seen.has(o) && net.devices[o]) { seen.add(o); queue.push(o); }
        });
      }
      return false;
    };
    // an ordinary machine: any cable you drew to it counts. A switch or access point: only a cable you drew that leads towards the router counts
    const hasManual = (dev) => net.links.some((l) => {
      if (l.auto || l.cable !== true || (l.a !== dev.key && l.b !== dev.key)) return false;     // only a physical cable you drew holds a machine in place
      if (!['switch', 'network'].includes(effectiveOs(dev))) return true;
      return reachesRouter(l.a === dev.key ? l.b : l.a, dev.key);
    });
    const dropAuto = (dev) => { net.links = net.links.filter((l) => !(l.auto && (l.a === dev.key || l.b === dev.key))); };

    const setPortTable = (dev, table) => {
      dev.portTable = table.slice(0, 128).filter((p) => p && p.name).map((p) => ({ name: text(p.name, 30), up: p.up === true, speed: speedNum(p.speed) }));
      dev.portTableAt = Date.now();
      const up = table.find((p) => p && p.uplink === true);
      if (up && up.name) dev.uplinkPort = text(up.name, 30);
    };
    // 1. Process gear (switches, APs) first so they exist as map nodes
    (res.gear || []).forEach((g) => {
      if (g && Array.isArray(g.portTable) && g.portTable.length && g.ip === net.router && net.devices.router) { setPortTable(net.devices.router, g.portTable); return; }
      if (!g || !validIp(g.ip) || g.ip === net.router) return;
      const d = mergeHost({ ip: g.ip, mac: g.mac, hostname: undefined, portsSkipped: true });
      if (d) {
        fillGear(d, g);
        if (Array.isArray(g.portTable) && g.portTable.length) setPortTable(d, g.portTable);
        d.online = true;
        d.misses = 0;
        d.lastSeen = Date.now();
      }
    });

    // 2. Identify or create the node representing the polled device itself (e.g. Netgear AP)
    let hostDev = null;
    if (res.host === net.router) {
      hostDev = net.devices.router;
    } else if (validIp(res.host)) {
      hostDev = devices().find((x) => x.ip === res.host || (res.self && res.self.mac && x.mac && x.mac.toLowerCase() === res.self.mac.toLowerCase()));
      if (!hostDev) {
        hostDev = mergeHost({
          ip: res.host,
          mac: res.self && res.self.mac ? res.self.mac : null,
          hostname: (res.self && res.self.name) || res.name || 'Access Point',
          portsSkipped: true
        });
      }
    }

    if (hostDev && res.self && Number.isFinite(res.self.uptimeSec) && res.self.uptimeSec >= 0) hostDev.upInfo = { sec: Math.floor(res.self.uptimeSec), at: Date.now(), kind: 'device' };
    if (hostDev && res.self && Array.isArray(res.self.portTable) && res.self.portTable.length) {
      hostDev.portTable = res.self.portTable.slice(0, 128).filter((p) => p && p.name).map((p) => ({ name: text(p.name, 30), up: p.up === true, speed: speedNum(p.speed) }));
      hostDev.portTableAt = Date.now();
    }
    if (hostDev && !hostDev.isRouter) {
      if (res.self) {
        if (res.self.brand && !hostDev.info.brand) hostDev.info.brand = text(res.self.brand, 60);
        if (res.self.model && !hostDev.info.model) hostDev.info.model = text(res.self.model, 60);
        if (Number.isInteger(res.self.ports) && res.self.ports > 0 && hostDev.info.ports === null) hostDev.info.ports = Math.min(1024, res.self.ports);
      }
      if (!hostDev.label && res.name) hostDev.label = text(res.name, 60);
      const isPrinter = res.self && res.self.kind === 'printer';
      const isSw = (res.self && res.self.kind === 'switch') || res.type === 'snmp';
      if (isPrinter) { if (!hostDev.osOverride || hostDev.osOverride === 'switch' || hostDev.osOverride === 'network') hostDev.osOverride = 'printer'; }      // an earlier version labelled every SNMP device a switch
      else if (!hostDev.osOverride) hostDev.osOverride = isSw ? 'switch' : 'network';
      hostDev.online = true;
      hostDev.misses = 0;
      hostDev.pollMisses = 0;
      hostDev.lastSeen = Date.now();
      // Ensure the AP/switch itself is linked upstream towards the router
      const hasUpstream = net.links.some((l) => (l.a === hostDev.key || l.b === hostDev.key) && l.a !== hostDev.key) || hasManual(hostDev);
      if (!hasUpstream) {
        net.links.push({ a: 'router', b: hostDev.key, auto: true, wireless: false });
      }
    }

    // Helper to find parent AP or Switch device for client c
    const findParent = (c, clientDev) => {
      if (!c) return null;
      // Match by AP MAC
      if (c.viaApMac) {
        const target = c.viaApMac.toLowerCase();
        const p = devices().find((x) => x.key !== clientDev.key && x.mac && x.mac.toLowerCase() === target);
        if (p) return p;
      }
      // Match by Switch MAC
      if (c.viaSwMac) {
        const target = c.viaSwMac.toLowerCase();
        const p = devices().find((x) => x.key !== clientDev.key && x.mac && x.mac.toLowerCase() === target);
        if (p) return p;
      }
      // Match by viaDeviceIp
      if (c.viaDeviceIp && validIp(c.viaDeviceIp)) {
        if (c.viaDeviceIp === net.router) return net.devices.router;
        const p = devices().find((x) => x.key !== clientDev.key && x.ip === c.viaDeviceIp);
        if (p) return p;
      }
      // Direct association: If c is wireless and polled from an AP, this AP is the parent
      if (c.wireless === true && hostDev && hostDev.key !== clientDev.key) {
        return hostDev;
      }
      // Direct switch port association
      if (c.viaPort && hostDev && hostDev.key !== clientDev.key) {
        return hostDev;
      }
      // Match by viaName (AP or switch name)
      if (c.viaName) {
        const vn = c.viaName.toLowerCase().trim();
        const p = devices().find((x) => x.key !== clientDev.key && (
          (x.label && x.label.toLowerCase() === vn) ||
          (x.hostname && x.hostname.toLowerCase() === vn) ||
          (x.info && x.info.model && x.info.model.toLowerCase() === vn)
        ));
        if (p) return p;
      }
      // Match by parsing c.via string (e.g. "on AP-Office (5 GHz)")
      if (c.via) {
        const m = c.via.match(/^(?:on\s+)?([^(/\n]+)/i);
        if (m) {
          const name = m[1].trim().toLowerCase();
          if (name && name !== 'router' && !name.startsWith('port') && !name.startsWith('vlan') && !name.startsWith('wi-fi')) {
            const p = devices().find((x) => x.key !== clientDev.key && (
              (x.label && x.label.toLowerCase() === name) ||
              (x.hostname && x.hostname.toLowerCase() === name) ||
              (x.info && x.info.model && x.info.model.toLowerCase() === name)
            ));
            if (p) return p;
          }
        }
      }
      // Polled from main router directly
      if (res.host === net.router) return net.devices.router;
      return null;
    };

    // 3a. A switch lists the machine that is "up" from it (the router, or the device it hangs from) on one port: that port is the way up, not a machine
    const listed = new Set();
    const upMacs = new Set();
    if (net.devices.router && net.devices.router.mac) upMacs.add(normMac(net.devices.router.mac));
    if (hostDev && !hostDev.isRouter) {
      const upl = net.links.find((l) => l.auto && l.b === hostDev.key && net.devices[l.a]);
      if (upl && net.devices[upl.a].mac) upMacs.add(normMac(net.devices[upl.a].mac));
    }
    (res.clients || []).forEach((c) => {
      if (c && c.viaPort && hostDev && upMacs.has(normMac(c.mac))) { hostDev.uplinkPort = c.viaPort; if (speedNum(c.speed)) hostDev.uplinkSpeed = speedNum(c.speed); }
    });

    // 3. Process clients
    (res.clients || []).forEach((c) => {
      if (!c) return;
      const mac = normMac(c.mac);
      if (!mac && !validIp(c.ip)) return;
      if (c.ip === net.router) return;
      if (mac && upMacs.has(mac)) return;                               // the way up, not a machine of its own
      let d = null;
      if (mac) d = devices().find((x) => !x.isRouter && x.mac && x.mac.toLowerCase() === mac);
      if (!d && validIp(c.ip)) d = devices().find((x) => !x.isRouter && x.ip === c.ip);
      // a hardware address with no network address that the map has never met (a virtual machine, a neighbour's phone) is not added: the scan finds real machines
      if (!d && !validIp(c.ip)) return;
      if (!d) d = mergeHost({ ip: c.ip || '', mac: mac, hostname: undefined, portsSkipped: true });
      if (!d || d.isRouter) return;
      listed.add(d.key);

      touched++;
      // Only proof that a machine is there right now brings it back online: a machine joined to a Wi-Fi radio (2.4 and 5 GHz alike),
      // or one the map has just met. A router's address list also keeps old entries for a while, so an unplugged cable machine
      // or switch is not brought back by it (the scan decides those).
      if (c.wireless === true || !before.has(d.key)) {
        d.online = true;
        d.misses = 0;
        d.lastSeen = Date.now();
      }
      if (c.name && !d.hostname) d.hostname = text(c.name, 80);
      if (Number.isFinite(c.connSec) && c.connSec >= 0 && d.online !== false && !d.upInfo) d.upInfo = { sec: Math.floor(c.connSec), at: Date.now(), kind: 'connected' };
      else if (Number.isFinite(c.connSec) && c.connSec >= 0 && d.online !== false && d.upInfo && d.upInfo.kind === 'connected') d.upInfo = { sec: Math.floor(c.connSec), at: Date.now(), kind: 'connected' };
      // A machine that is offline stays unlinked: a router's list keeps old entries for machines that are gone, and
      // those must not draw (or redraw) lines you deleted. Its lines come back when it is detected again, or when you connect it by hand.
      if (d.online === false) return;

      // a machine you cabled by hand keeps your cable: what the router says about it is remembered, but the lines stay
      const pinned = hasManual(d);
      // Check if this client was recently confirmed on an active AP Wi-Fi radio (within 120s)
      const hasFreshApWifi = d.attach && d.attach.wireless && d.attach.parentKey && d.attach.parentKey !== 'router' && (Date.now() - (d.attach.timestamp || 0) < 120000);

      // Scenario A: Client is reported WIRELESS by this device (either AP or Router)
      if (c.wireless === true) {
        d.connSeen = 'wireless';
        const parent = findParent(c, d) || (res.host === net.router ? net.devices.router : hostDev);
        const parentKey = parent ? parent.key : (res.host === net.router ? 'router' : (hostDev ? hostDev.key : 'router'));
        const pName = parent ? (parent.isRouter ? 'Router' : title(parent)) : by;
        // Two devices can both list one machine on their Wi-Fi: the one it has just left keeps an old entry for a while.
        // The device that started listing it most recently is where it really is. On a tie the machine stays where it is
        // (or, at the very start, an access point beats the main router, because an access point only lists machines on its own radio).
        const nowT = Date.now();
        let cm = wifiClaims.get(d.key);
        if (!cm) { cm = new Map(); wifiClaims.set(d.key, cm); }
        const mineC = cm.get(parentKey);
        if (!mineC || nowT - mineC.last > 100000) cm.set(parentKey, { first: nowT, last: nowT }); else mineC.last = nowT;
        const rivals = Array.from(cm.entries()).filter((e) => e[0] !== parentKey && nowT - e[1].last <= 100000);
        if (rivals.length && !pinned) {
          const myFirst = cm.get(parentKey).first;
          const newestRival = Math.max.apply(null, rivals.map((e) => e[1].first));
          const curKey = d.attach && d.attach.parentKey ? d.attach.parentKey : null;
          const iWin = myFirst > newestRival + 5000 ? true : myFirst < newestRival - 5000 ? false : (curKey === parentKey ? true : curKey && rivals.some((e) => e[0] === curKey) ? false : parentKey !== 'router');
          if (!iWin) { d.connSeen = 'wireless'; return; }
        }
        d.attach = {
          via: text(c.via || 'Wi-Fi', 100),
          speed: speedNum(c.speed), speedRx: speedNum(c.speedRx),
          signal: Number.isFinite(c.signal) ? Math.round(c.signal) : null,
          by: by,
          parentKey: parentKey,
          parentName: pName,
          wireless: true,
          timestamp: Date.now()
        };
        // Reparent client directly to this AP / Router with a dotted wireless line
        if (!pinned) {
        dropAuto(d);
        net.links.push({ a: parentKey, b: d.key, auto: true, wireless: true });
        }
        if (!pinned && parent && !parent.isRouter && parent.key !== 'router') {
          const hasUpstream = net.links.some((l) => (l.a === parent.key || l.b === parent.key) && l.a !== d.key && l.b !== d.key);
          if (!hasUpstream) net.links.push({ a: 'router', b: parent.key, auto: true, wireless: false });
        }
      }
      // Scenario B: Client is reported on a physical switch port
      else if (c.viaPort && (hostDev || c.viaSwMac)) {
        // a controller (UniFi...) names the switch each machine is on; a switch polled directly is the switch itself
        const sw = (c.viaSwMac && findParent(c, d)) || hostDev;
        if (!sw) return;
        const isRouterMac = net.devices.router && net.devices.router.mac && normMac(c.mac) === normMac(net.devices.router.mac);
        if (c.ip === net.router || isRouterMac) {
          sw.uplinkPort = c.viaPort;
          if (speedNum(c.speed)) sw.uplinkSpeed = speedNum(c.speed);
          const hasUpstream = net.links.some((l) => (l.a === sw.key && l.b === 'router') || (l.a === 'router' && l.b === sw.key)) || hasManual(sw);
          if (!hasUpstream) net.links.push({ a: 'router', b: sw.key, auto: true, wireless: false });
          return;
        }
        if (sw.uplinkPort && c.viaPort === sw.uplinkPort) {
          // seen on the way up: it is not below this switch any more, so what the main router says about it can apply at once
          if (d.attach && d.attach.parentKey === sw.key) d.attach.timestamp = 0;
          return;
        }

        d.connSeen = 'wired';
        d.attach = {
          via: text(c.via || ('Port ' + c.viaPort), 100),
          port: text(c.viaPort, 30),
          speed: speedNum(c.speed), speedRx: null,
          signal: null,
          by: by,
          parentKey: sw.key,
          parentName: title(sw),
          wireless: false,
          timestamp: Date.now()
        };
        if (pinned) { d.attach.pinned = true; return; }
        dropAuto(d);
        net.links.push({ a: sw.key, b: d.key, auto: true, wireless: false });
        const hasUpstream = net.links.some((l) => (l.a === sw.key || l.b === sw.key) && l.a !== d.key && l.b !== d.key) || hasManual(sw);
        if (!hasUpstream) {
          net.links.push({ a: 'router', b: sw.key, auto: true, wireless: false });
        }
      }
      // Scenario C: Reported wired / non-wireless by main router
      else if (res.host === net.router && c.wireless === false) {
        // If an AP has authoritatively claimed this client on active Wi-Fi, OR a switch on a port, do NOT clobber!
        const hasFreshSwitchPort = d.attach && !d.attach.wireless && d.attach.parentKey && d.attach.parentKey !== 'router' && (Date.now() - (d.attach.timestamp || 0) < 120000);
        if (!hasFreshApWifi && !hasFreshSwitchPort) {
          d.connSeen = 'wired';
          d.attach = {
            via: 'cable',
            speed: speedNum(c.speed), speedRx: null,
            signal: null,
            by: by,
            parentKey: 'router',
            parentName: 'Router',
            wireless: false,
            timestamp: Date.now()
          };
          if (!pinned) {
            dropAuto(d);
            net.links.push({ a: 'router', b: d.key, auto: true, wireless: false });
          }
        }
      }
      // Scenario D: Reported wired / non-wireless by an AP (merely observing upstream LAN traffic)
      else if (res.host !== net.router && c.wireless === false) {
        // Do not steal upstream wired devices
      }
    });

    // a device that answered but no longer lists a machine on its Wi-Fi has lost it: that claim is over straight away
    if (hostDev) {
      const hk = hostDev.isRouter ? 'router' : hostDev.key;
      wifiClaims.forEach((cm, mKey) => { if (cm.has(hk) && !listed.has(mKey)) cm.delete(hk); });
    }

    // Deduplicate all links
    const seenLinks = new Set();
    net.links = net.links.filter((l) => {
      if (!l || l.a === l.b || !net.devices[l.a] || !net.devices[l.b]) return false;
      const id = linkId(l.a, l.b);
      if (seenLinks.has(id)) return false;
      seenLinks.add(id);
      return true;
    });

    // Ensure client devices with an authoritative parent link only have that one connection line
    devices().forEach((dev) => {
      if (dev.attach && dev.attach.parentKey && !dev.isRouter && effectiveOs(dev) !== 'switch' && effectiveOs(dev) !== 'network') {
        const primaryId = linkId(dev.attach.parentKey, dev.key);
        const pinnedDev = hasManual(dev);
        net.links = net.links.filter((l) => {
          if (!l.auto) return true;                                // never remove a line you drew
          if (l.a === dev.key || l.b === dev.key) {
            return !pinnedDev && linkId(l.a, l.b) === primaryId;
          }
          return true;
        });
      }
    });

    created = Object.keys(net.devices).filter((k) => !before.has(k)).length;
    save();
    refresh();
    return { clients: touched, created: created };
  }

  // ---------- start ----------
  function init() {
    ensureNetwork();
    els.router.value = net.router;
    els.mode.value = net.mode;
    els.offline.checked = net.showOffline;
    els.alerts.value = net.alerts;
    els.services.checked = net.showServices;
    els.live.value = String(net.autoSeconds);
    updateLiveUi();
    buildLegend();
    buildList();
    els.listBtn.addEventListener('click', () => setListOpen(!listOpen));
    setHint();

    els.tabPanels.addEventListener('click', () => showView('panels'));
    els.tabMap.addEventListener('click', () => showView('map'));
    els.scan.addEventListener('click', startScan);
    els.stop.addEventListener('click', () => { if (window.netApi) window.netApi.cancel(); setStatus('Stopping...'); });
    els.connect.addEventListener('click', () => setConnectMode(connectMode !== 'lines', 'lines'));
    if (els.cable) els.cable.addEventListener('click', () => setConnectMode(connectMode !== 'cable', 'cable'));
    els.top.addEventListener('click', () => fitView(true));
    els.reset.addEventListener('click', () => fitView(false));
    els.tidy.addEventListener('click', () => { if (confirm('Move every machine back to its neat starting position? Your own layout will be lost.')) tidy(); });
    els.offline.addEventListener('change', () => { net.showOffline = els.offline.checked; save(); queueSync(); });
    els.gCluster.checked = net.groupCluster !== false;
    els.gCircles.checked = net.groupCircles !== false;
    els.gCluster.addEventListener('change', () => { net.groupCluster = els.gCluster.checked; save(); queueSync(); });
    els.gCircles.addEventListener('change', () => { net.groupCircles = els.gCircles.checked; save(); queueSync(); });
    els.services.addEventListener('change', () => { net.showServices = els.services.checked; save(); queueSync(); });
    els.alerts.addEventListener('change', () => { net.alerts = els.alerts.value; save(); if (net.alerts === 'desktop') desktopNotify('Desktop notices are on.'); });
    els.addSwitch.addEventListener('click', addSwitch);
    els.live.addEventListener('change', () => {
      net.autoSeconds = Number(els.live.value) || 0;
      save();
      scheduleLive();
      if (net.autoSeconds && !net.scannedOnce) setLiveText('starts after your first scan');
    });
    els.iface.addEventListener('change', () => { els.cidr.classList.toggle('hidden', els.iface.value !== '__other'); });
    els.router.addEventListener('change', () => {
      const ip = els.router.value.trim();
      if (validIp(ip)) { setRouter(ip, true); setStatus(''); }
      else { setStatus('That is not a valid address.', true); els.router.value = net.router; }
    });

    if (window.netApi) {
      window.netApi.onEvent(onScanEvent);
      window.netApi.interfaces().then((res) => {
        const list = res && res.ok ? res.interfaces : [];
        guardCheck(res).then((stopped) => {
          if (!stopped && res && res.ok && res.gateway && validIp(res.gateway) && !net.routerUser && res.gateway !== net.router) setRouter(res.gateway, false);
          fillInterfaces(list, res && res.gateway);
          if (net.scannedOnce) scheduleLive(8000);
        });
      }).catch(() => { fillInterfaces([], null); if (net.scannedOnce) scheduleLive(8000); });
    } else {
      fillInterfaces([], null);
      els.scan.disabled = true;
      setStatus('Scanning only works inside the Dashboard Hub app.', true);
    }

    if (state.view === 'map') showView('map');
  }

  // ---------- used by Backup (export and import of the map) ----------
  function applyControlsFromNet() {
    els.router.value = net.router;
    els.mode.value = net.mode;
    els.offline.checked = net.showOffline;
    els.gCluster.checked = net.groupCluster !== false;
    els.gCircles.checked = net.groupCircles !== false;
    els.alerts.value = net.alerts;
    els.services.checked = net.showServices;
    els.live.value = String(net.autoSeconds);
    updateLiveUi();
  }

  window.hubNetmap = {
    // a plain copy of the map for a backup file
    applyConnector: applyConnector,
    liveSeconds: function () { return net ? net.autoSeconds : 0; },
    deviceIps: function () { return net ? devices().filter((d) => d.ip && validIp(d.ip) && d.online !== false && !d.self).map((d) => ({ ip: d.ip, name: title(d) })) : []; },
    routerIp: function () { return net && net.router ? net.router : ''; },
    // a switch / access point you added a connection for did not answer: after two missed checks in a row it is marked offline
    connectorFailed: function (host, code, unreachable) {
      if (!net || !validIp(host) || host === net.router || !['timeout', 'refused'].includes(code)) return false;
      const dev = devices().find((x) => !x.isRouter && x.ip === host);
      if (!dev) return false;
      dev.pollMisses = (dev.pollMisses || 0) + 1;
      if ((unreachable === true || dev.pollMisses >= 2) && dev.online !== false) {
        dev.online = false;
        dev.misses = 99;
        alertEvent('left', dev);
        flushAlerts();
        save();
        refresh();
        return true;
      }
      return false;
    },
    guardCheck: function () { return guardCheck(); },
    guardState: function () { return { blocked: guard.blocked, locked: guard.locked, cur: guard.cur }; },
    onScanDone: function (fn) { if (typeof fn === 'function') scanDoneHooks.push(fn); },
    refresh: function () { try { refresh(); } catch (e) { /* ignore */ } },
    exportData: function () {
      const copy = JSON.parse(JSON.stringify(net));
      return copy;
    },
    count: function () { return devices().filter((d) => !d.isRouter).length; },
    // data has already been cleaned by the app's background process
    importData: function (data, replace) {
      if (!data || typeof data !== 'object' || !data.devices) return { devices: 0, duplicates: 0 };
      if (replace) {
        animateNew = false;
        Array.from(nodes.keys()).forEach(removeNode);
        ensureNetwork(data);
        selected = null;
        pending = null;
        seenKeys = new Set();
        fitted = false;
        applyControlsFromNet();
        save();
        refresh();
        if (renderer && document.body.classList.contains('view-map')) setTimeout(() => fitView(false), 80);
        scheduleLive(net.scannedOnce ? 8000 : undefined);
        return { devices: Object.keys(net.devices).length - 1, duplicates: 0 };
      }
      let added = 0, dup = 0;
      Object.keys(data.devices).forEach((key) => {
        if (key === 'router') return;
        const inc = data.devices[key];
        const exists = net.devices[key] ||
          (inc.mac && devices().some((d) => d.mac === inc.mac)) ||
          (key.startsWith('ip:') && devices().some((d) => d.ip === inc.ip));
        if (exists) {
          // the machine is already on this map: keep what is here, but fill in anything you had not set yet
          const mine = net.devices[key] || devices().find((d) => (inc.mac && d.mac === inc.mac) || (key.startsWith('ip:') && d.ip === inc.ip));
          if (mine && !mine.isRouter) {
            const src = cleanDevice(key, inc);
            if (!mine.label && src.label) mine.label = src.label;
            if (!mine.group && src.group) mine.group = src.group;
            if (!mine.vlan && src.vlan) mine.vlan = src.vlan;
            if (!mine.osOverride && src.osOverride) mine.osOverride = src.osOverride;
            ['brand', 'model', 'notes', 'webUrl'].forEach((f) => { if (!mine.info[f] && src.info[f]) mine.info[f] = src.info[f]; });
            if (mine.info.ports === null && src.info.ports !== null) mine.info.ports = src.info.ports;
          }
          dup++; return;
        }
        net.devices[key] = cleanDevice(key, inc);
        added++;
      });
      (data.links || []).forEach((l) => {
        if (!net.devices[l.a] || !net.devices[l.b]) return;
        const id = linkId(l.a, l.b);
        if (!net.links.some((x) => linkId(x.a, x.b) === id)) net.links.push({ a: l.a, b: l.b, auto: !!l.auto, cable: l.cable === true && !l.auto, wireless: l.cable === true && !l.auto ? false : l.wireless === true ? true : l.wireless === false ? false : null });
      });
      (data.ignored || []).forEach((k) => { if (!net.ignored.includes(k)) net.ignored.push(k); });
      net.ignored = net.ignored.slice(-500);
      save();
      refresh();
      return { devices: added, duplicates: dup };
    }
  };

  // small helper used by the automatic tests (where on screen is a machine or a line?)
  window.__hubMap = {
    view: () => ({ tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, dist: camera.position.distanceTo(controls.target), max: controls.maxDistance }),
    groups: function () { return Array.from(groupObjs.entries()).map(([k, o]) => ({ name: k, x: o.mesh.position.x, z: o.mesh.position.z, r: o.mesh.scale.x, ringOpacity: o.ring.material.opacity, fillOpacity: o.mesh.material.opacity, labelH: o.sprite.scale.y, labelW: o.sprite.scale.x, labelOnTop: o.sprite.material.depthTest === false, ringWidth: (1 - o.ring.geometry.parameters.innerRadius) * o.ring.scale.x }));  },
    glInfo: function () { return renderer ? { frames: renderer.info.render.frame, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, software: softwareGl, lost: glLost, running: running, gen: loopGen, pixelRatio: renderer.getPixelRatio(), width: canvas.width, height: canvas.height } : null; },
    screenOf: function (key) {
      const v = new THREE.Vector3();
      const n = nodes.get(key);
      if (!n || !canvas) return null;
      v.copy(n.group.position).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    },
    sync: function () { syncScene(); },
    floorY: function () { return FLOOR_Y; },
    labelOf: function (key) { const n = nodes.get(key); return n ? n.sig : null; },
    linkOpacity: function (x, y) { const o = linkObjs.get(linkId(x, y)); return o ? { op: o.vis.material.opacity, pulse: !!o.pulse, dashed: !!o.vis.material.alphaMap, alphaTest: o.vis.material.alphaTest, transparent: o.vis.material.transparent } : null; },
    linkStyle: function (x, y) { const l = net.links.find((q) => linkId(q.a, q.b) === linkId(x, y)); if (!l) return null; return { color: linkColor(l), auto: !!l.auto, cable: l.cable === true, wireless: isWireless(l) }; },
    linkShown: function (x, y) { const o = linkObjs.get(linkId(x, y)); return !!(o && o.group.visible); },
    debug: function () { return { scanKind: scanKind, timer: !!liveTimer, auto: net.autoSeconds, cidr: net.cidr, hidden: document.hidden, scannedOnce: net.scannedOnce }; },
    svcCount: function () { return Array.from(svcObjs.values()).filter((o) => o.mesh.visible).length; },
    svcIds: function () { return Array.from(svcObjs.keys()); },
    svcScreen: function (id) { const o = svcObjs.get(id); if (!o || !canvas) return null; const v = o.mesh.position.clone().project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    typeFilterSize: function () { return typeFilter.size; },
    dnsSweep: function (force) { return dnsSweep(force); },
    isShown: function (key) { const n = nodes.get(key); return !!(n && n.group.visible && n.shown); },
    scaleOf: function (key) { const n = nodes.get(key); return n ? n.scale : null; },
    isDotted: function (id) { const o = linkObjs.get(id); return !!(o && o.vis.material.alphaMap); },
    screenOfLink: function (id) {
      const o = linkObjs.get(id);
      if (!o || !canvas) return null;
      const v = o.group.position.clone().project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    }
  };

  init();
})();
