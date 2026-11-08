'use strict';
// Gentle ways to find and name machines WITHOUT SNMP:
//   mDNS / Bonjour (phones, TVs, printers, Macs, Linux), SSDP / UPnP (smart TVs, routers, media boxes),
//   NetBIOS names (Windows machines). All three use plain UDP and only talk to addresses inside your own network.
const dgram = require('dgram');
const http = require('http');

const MDNS_ADDR = '224.0.0.251', MDNS_PORT = 5353;
const SSDP_ADDR = '239.255.255.250', SSDP_PORT = 1900;
const SERVICE_TYPES = ['_services._dns-sd._udp', '_http._tcp', '_workstation._tcp', '_device-info._tcp', '_airplay._tcp', '_raop._tcp', '_googlecast._tcp', '_ipp._tcp', '_printer._tcp', '_hap._tcp', '_smb._tcp', '_ssh._tcp', '_homekit._tcp'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v, n) => String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n || 80);
function isPrivate(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
}

// ---------- DNS packet helpers (used by mDNS and NetBIOS) ----------
function encodeName(name) {
  const parts = String(name).split('.').filter(Boolean);
  const bufs = parts.map((p) => { const b = Buffer.from(p, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat(bufs.concat([Buffer.from([0])]));
}
function buildMdnsQuery(types) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(types.length, 4);
  const qs = types.map((t) => { const tail = Buffer.alloc(4); tail.writeUInt16BE(12, 0); tail.writeUInt16BE(0x8001, 2); return Buffer.concat([encodeName(t + '.local'), tail]); });   // 0x8001: "please answer me directly"
  return Buffer.concat([head].concat(qs));
}
// reads a (possibly compressed) name; returns { name, next } or null when the packet is damaged
function readName(buf, pos) {
  const labels = [];
  let next = -1, jumps = 0, p = pos;
  for (;;) {
    if (p >= buf.length || jumps > 20 || labels.length > 40) return null;
    const len = buf[p];
    if (len === 0) { p++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (p + 1 >= buf.length) return null;
      if (next < 0) next = p + 2;
      p = ((len & 0x3f) << 8) | buf[p + 1];
      jumps++;
      continue;
    }
    if (len > 63 || p + 1 + len > buf.length) return null;
    labels.push(buf.toString('utf8', p + 1, p + 1 + len));
    p += 1 + len;
  }
  return { name: labels.join('.'), next: next >= 0 ? next : p };
}
function readRecords(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) { const n = readName(buf, pos); if (!n || n.next + 4 > buf.length) return []; pos = n.next + 4; }
  const out = [];
  for (let i = 0; i < total && i < 200; i++) {
    const n = readName(buf, pos);
    if (!n || n.next + 10 > buf.length) break;
    const type = buf.readUInt16BE(n.next);
    const rdlen = buf.readUInt16BE(n.next + 8);
    const start = n.next + 10;
    if (start + rdlen > buf.length) break;
    out.push({ name: n.name, type: type, start: start, len: rdlen });
    pos = start + rdlen;
  }
  return out;
}

// ---------- mDNS ----------
// Turns one mDNS reply into { name, model, services } (or null). from = the address the reply came from.
function parseMdns(buf, from) {
  const recs = readRecords(buf);
  if (!recs.length) return null;
  let host = '', model = '';
  const services = [];
  let instance = '';
  for (const r of recs) {
    if (r.type === 1 && r.len === 4) {                                   // A record: a name and its address
      const ip = Array.from(buf.slice(r.start, r.start + 4)).join('.');
      if (!from || ip === from) host = host || r.name;
    } else if (r.type === 12) {                                          // PTR: a service instance
      const t = readName(buf, r.start);
      if (t && t.name) { services.push(clean(r.name.replace(/\.local$/, ''), 40)); if (!instance) instance = t.name.split('._')[0]; }
    } else if (r.type === 16) {                                          // TXT: "model=..." / "md=..."
      let p = r.start;
      while (p < r.start + r.len) {
        const l = buf[p]; const s = buf.toString('utf8', p + 1, Math.min(p + 1 + l, r.start + r.len)); p += 1 + l;
        const m = /^(md|model|am|ty)=(.+)$/i.exec(s); if (m && !model) model = clean(m[2], 60);
      }
    } else if (r.type === 33 && !host) {                                 // SRV: target host name
      const t = readName(buf, r.start + 6); if (t && t.name) host = t.name;
    }
  }
  const name = clean((host || instance).replace(/\.local\.?$/i, ''), 60);
  if (!name && !model) return null;
  return { name: name, model: model, services: services.slice(0, 6) };
}

function mdnsBrowse(ms, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { resolve(found); return; }
    const done = () => { try { sock.close(); } catch (e) { /* closed */ } resolve(found); };
    sock.on('error', done);
    sock.on('message', (msg, rinfo) => {
      if (!isPrivate(rinfo.address) || found.size > 600) return;
      const d = parseMdns(msg, rinfo.address);
      if (!d) return;
      const old = found.get(rinfo.address);
      found.set(rinfo.address, old ? { name: old.name || d.name, model: old.model || d.model, services: old.services.concat(d.services).slice(0, 8) } : d);
    });
    sock.bind(0, opts.localAddress || undefined, () => {
      try {
        if (opts.localAddress) sock.setMulticastInterface(opts.localAddress);
        const q = buildMdnsQuery(SERVICE_TYPES);
        const send = () => sock.send(q, opts.port || MDNS_PORT, opts.target || MDNS_ADDR, () => { /* ignore send errors */ });
        send(); setTimeout(send, 700);
      } catch (e) { done(); return; }
      setTimeout(done, ms);
    });
  });
}

// ---------- SSDP / UPnP ----------
function parseSsdp(text) {
  const h = {};
  String(text).split(/\r?\n/).slice(1, 40).forEach((line) => { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); });
  return { server: clean(h.server, 100), location: clean(h.location, 200), st: clean(h.st || h.nt, 80) };
}
function parseUpnpXml(xml) {
  const pick = (tag) => { const m = new RegExp('<' + tag + '>([^<]{1,120})</' + tag + '>', 'i').exec(xml); return m ? clean(m[1], 80) : ''; };
  return { name: pick('friendlyName'), model: [pick('manufacturer'), pick('modelName')].filter(Boolean).join(' ') };
}
// A device's UPnP description (its name and model) hardly ever changes, so it is fetched once and kept for half an hour.
// Without this, every background scan would download the description of every smart TV and router again.
const upnpCache = new Map();
function fetchUpnp(location, from, ms) {
  const hit = upnpCache.get(location + '|' + from);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return Promise.resolve(hit.v);
  return fetchUpnpNow(location, from, ms).then((v) => {
    if (v) { if (upnpCache.size >= 300) upnpCache.delete(upnpCache.keys().next().value); upnpCache.set(location + '|' + from, { at: Date.now(), v: v }); }
    return v;
  });
}
function fetchUpnpNow(location, from, ms) {
  return new Promise((resolve) => {
    let u; try { u = new URL(location); } catch (e) { resolve(null); return; }
    if (u.protocol !== 'http:' || u.hostname !== from || !isPrivate(u.hostname)) { resolve(null); return; }      // only the machine that answered, only inside your network
    const req = http.get({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, timeout: ms, headers: { 'User-Agent': 'DashboardHub' } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 65536) req.destroy(); });
      res.on('end', () => resolve(parseUpnpXml(data)));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    setTimeout(() => { try { req.destroy(); } catch (e) { /* done */ } resolve(null); }, ms + 300);
  });
}
function ssdpSearch(ms, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const replies = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { resolve(new Map()); return; }
    const finish = async () => {
      try { sock.close(); } catch (e) { /* closed */ }
      const out = new Map();
      const list = Array.from(replies.entries()).slice(0, 60);
      await Promise.all(list.map(async ([ip, r]) => {
        const x = r.location ? await fetchUpnp(r.location, ip, 1500) : null;
        const name = clean((x && x.name) || '', 60);
        const model = clean((x && x.model) || r.server, 80);
        if (name || model) out.set(ip, { name: name, model: model, services: [] });
      }));
      resolve(out);
    };
    sock.on('error', finish);
    sock.on('message', (msg, rinfo) => {
      if (!isPrivate(rinfo.address) || replies.size > 200) return;
      const r = parseSsdp(msg.toString('utf8', 0, Math.min(msg.length, 2048)));
      if (!replies.has(rinfo.address) || (r.location && !replies.get(rinfo.address).location)) replies.set(rinfo.address, r);
    });
    sock.bind(0, opts.localAddress || undefined, () => {
      try {
        if (opts.localAddress) sock.setMulticastInterface(opts.localAddress);
        const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: ' + SSDP_ADDR + ':' + SSDP_PORT + '\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
        const send = () => sock.send(q, opts.port || SSDP_PORT, opts.target || SSDP_ADDR, () => { /* ignore send errors */ });
        send(); setTimeout(send, 700);
      } catch (e) { finish(); return; }
      setTimeout(finish, ms);
    });
  });
}

// ---------- NetBIOS names (Windows) ----------
function buildNbstat() {
  const head = Buffer.alloc(12); head.writeUInt16BE(0x4442, 0); head.writeUInt16BE(1, 4);
  const q = Buffer.concat([Buffer.from([32]), Buffer.from('CK' + 'A'.repeat(30)), Buffer.from([0]), Buffer.from([0, 0x21, 0, 1])]);
  return Buffer.concat([head, q]);
}
// returns the machine's own (non-group) name, or ''
function parseNbstat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 + 12) return '';
  if (buf.readUInt16BE(6) < 1) return '';
  const n = readName(buf, 12);
  if (!n || n.next + 11 > buf.length) return '';
  let p = n.next + 10;
  const count = buf[p]; p++;
  for (let i = 0; i < count && i < 30; i++) {
    if (p + 18 > buf.length) break;
    const nm = buf.toString('latin1', p, p + 15).replace(/[\s\u0000]+$/, '');
    const suffix = buf[p + 15];
    const flags = buf.readUInt16BE(p + 16);
    p += 18;
    if (suffix === 0 && !(flags & 0x8000) && nm) return clean(nm, 15);
  }
  return '';
}
function netbiosName(ip, ms, port) {
  return new Promise((resolve) => {
    if (!isPrivate(ip)) { resolve(''); return; }
    let sock;
    try { sock = dgram.createSocket('udp4'); } catch (e) { resolve(''); return; }
    const done = (v) => { try { sock.close(); } catch (e) { /* closed */ } resolve(v || ''); };
    const timer = setTimeout(() => done(''), ms || 900);
    sock.on('error', () => { clearTimeout(timer); done(''); });
    sock.on('message', (msg, rinfo) => { if (rinfo.address !== ip) return; clearTimeout(timer); done(parseNbstat(msg)); });
    sock.send(buildNbstat(), port || 137, ip, (err) => { if (err) { clearTimeout(timer); done(''); } });
  });
}

// ---------- everything together ----------
// Runs mDNS and SSDP at the same time; returns a Map: ip -> { name, model, services, via: [...] }
async function discoverNames(opts) {
  opts = opts || {};
  const ms = opts.ms || 2300;
  const none = () => Promise.resolve(new Map());
  const [m, s] = await Promise.all([
    opts.useMdns === false ? none() : mdnsBrowse(ms, opts.mdns || opts).catch(none),
    opts.useSsdp === false ? none() : ssdpSearch(ms, opts.ssdp || opts).catch(none)
  ]);
  const out = new Map();
  const add = (map, via) => map.forEach((d, ip) => {
    const o = out.get(ip) || { name: '', model: '', services: [], via: [] };
    o.name = o.name || d.name; o.model = o.model || d.model; o.services = o.services.concat(d.services).slice(0, 8); o.via.push(via);
    out.set(ip, o);
  });
  add(m, 'mDNS'); add(s, 'SSDP');
  return out;
}

module.exports = { discoverNames, mdnsBrowse, ssdpSearch, netbiosName, parseMdns, parseSsdp, parseUpnpXml, parseNbstat, buildMdnsQuery, buildNbstat, readName, isPrivate, encodeName };
