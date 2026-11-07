// Router and switch connections: ask a router, switch or controller on YOUR network which machines it
// knows about (its client list: names, Wi-Fi or cable, switch port) and what it is (brand, model, ports).
// This only READS information. Nothing on the device is changed.
//
// Supported:
//   snmp      Almost any managed switch, router or access point (SNMP v1/v2c): HPE/Aruba, Cisco, Netgear,
//             TP-Link, D-Link, Zyxel, MikroTik, Juniper, Dell, Ubiquiti ... gives brand, model, port count,
//             the address table and which switch port each machine is plugged into.
//   unifi     Ubiquiti UniFi (UniFi OS consoles such as UDM / Cloud Key Gen2, and classic controllers):
//             clients (Wi-Fi or cable, SSID, access point or switch port, signal) and UniFi gear.
//   openwrt   OpenWrt (ubus over HTTP): DHCP leases, host names, Wi-Fi clients.
//   mikrotik  MikroTik RouterOS 7 (REST API): ARP table, DHCP names, Wi-Fi clients.
//   opnsense  OPNsense (API key and secret): ARP table and DHCP leases.
//   ssh       Any switch or router with SSH (Linux/OpenWrt, MikroTik, Cisco IOS, or any that answers "show arp"): ARP, MAC table with ports, DHCP leases. No SNMP.
//   asus      ASUS routers (original firmware, usually Merlin too): client list with Wi-Fi band and signal.
//
// Only private addresses on your own network are allowed. Passwords are used for the request only and
// are never part of a backup file.

const http = require('http');
const https = require('https');
const dgram = require('dgram');
const crypto = require('crypto');
const sshpoll = require('./ssh-poll');

const TEST_HOOKS = {};        // only the test programs set this (it lets the Meraki test talk to a pretend server)
const TYPES = {
  snmp: { label: 'SNMP (most managed switches and routers)', defaults: { port: 161, https: false }, userLabel: '', secretLabel: 'Community name' },
  unifi: { label: 'Ubiquiti UniFi (controller, UDM, Cloud Key)', defaults: { port: 443, https: true }, userLabel: 'User name', secretLabel: 'Password' },
  openwrt: { label: 'OpenWrt (ubus)', defaults: { port: 80, https: false }, userLabel: 'User name', secretLabel: 'Password' },
  mikrotik: { label: 'MikroTik RouterOS 7 (REST API)', defaults: { port: 443, https: true }, userLabel: 'User name', secretLabel: 'Password' },
  opnsense: { label: 'OPNsense (API key)', defaults: { port: 443, https: true }, userLabel: 'API key', secretLabel: 'API secret' },
  asus: { label: 'ASUS router (original firmware / Merlin)', defaults: { port: 80, https: false }, userLabel: 'User name', secretLabel: 'Password' },
  netgear: { label: 'Netgear router (R6400, Nighthawk, Orbi ... its web interface)', defaults: { port: 5000, https: false }, userLabel: 'User name', secretLabel: 'Password' },
  fritz: { label: 'AVM FRITZ!Box (TR-064)', defaults: { port: 49000, https: false }, userLabel: 'User name', secretLabel: 'Password' },
  omada: { label: 'TP-Link Omada controller', defaults: { port: 8043, https: true }, userLabel: 'User name', secretLabel: 'Password' },
  meraki: { label: 'Cisco Meraki (cloud dashboard, needs internet)', defaults: { port: 443, https: true }, userLabel: '', secretLabel: 'API key', cloud: true },
  cisco: { label: 'Cisco IOS XE switch or router (RESTCONF)', defaults: { port: 443, https: true }, userLabel: 'User name', secretLabel: 'Password' },
  arubacx: { label: 'Aruba CX switch (REST API)', defaults: { port: 443, https: true }, userLabel: 'User name', secretLabel: 'Password' },
  hpe: { label: 'HPE OfficeConnect / 1820 / 1920 switch (SNMP)', defaults: { port: 161, https: false }, userLabel: '', secretLabel: 'Community name' },
  ssh: { label: 'Any switch or router over SSH (no SNMP: reads the ARP / MAC / DHCP tables)', defaults: { port: 22, https: false }, userLabel: 'SSH user name', secretLabel: 'Password (empty = use your SSH key)' }
};

// ---------- helpers ----------
// kind: 'refused' | 'timeout' | 'auth' | 'notfound' | 'bad'
class ConnError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function isPrivateIp(ip) {
  if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const p = ip.split('.').map(Number);
  if (p.some((n) => n > 255)) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

function normMac(m) {
  if (typeof m !== 'string') return null;
  const h = m.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (h.length !== 12 || m.replace(/[0-9a-fA-F:.\-]/g, '') !== '') return null;
  if (h === '000000000000' || h === 'ffffffffffff') return null;
  if (parseInt(h.slice(0, 2), 16) & 1) return null;           // multicast / broadcast, not a machine
  return h.match(/../g).join(':');
}
const cleanIp = (v) => (typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split('.').every((n) => Number(n) <= 255) && v !== '0.0.0.0' ? v : '');
const cleanText = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sig = (v) => { const n = Number(v); return Number.isFinite(n) && n < 0 && n > -130 ? Math.round(n) : null; };
// names the Wi-Fi band from whatever a device calls it: "2.4G", "2.4 GHz", "11ng", "wl0", "5GHz", "11ac", "radio 1" ...
function bandName(v) {
  const t = String(v == null ? '' : v).toLowerCase();
  if (/\b6\s*g|6e|6\s*ghz/.test(t)) return '6 GHz';
  if (/2\.4|2,4|\b2\s*g(hz)?\b|\b11\s*(b|g|ng|bg|bgn)\b|\bbgn?\b|wl0|\bng\b/.test(t)) return '2.4 GHz';
  if (/\b5\s*g|5\s*ghz|\b11\s*(a|ac|ax|na|an)\b|wl1|\bna\b|\bac\b/.test(t)) return '5 GHz';
  return '';
}
// band from a frequency in MHz (2437) or a channel number (6, 36)
function freqBand(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 2400 && n < 2500) return '2.4 GHz';
  if (n >= 4900 && n < 5925) return '5 GHz';
  if (n >= 5925 && n < 7200) return '6 GHz';
  if (n <= 14) return '2.4 GHz';
  if (n <= 177) return '5 GHz';
  return '';
}
// link speed in Mbps (what the two ends agreed on, not a measurement); a rate in text such as '866.7Mbps-80MHz/2S', '1 Gbps' or '300'
const mbps = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 200000 ? Math.round(n * 10) / 10 : null; };
const parseRate = (v) => {
  const m = /(\d+(?:\.\d+)?)\s*(g|m|k)?(?:bit|bps|b\/s)?/i.exec(String(v === undefined || v === null ? '' : v));
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] || 'm').toLowerCase();
  return mbps(u === 'g' ? n * 1000 : u === 'k' ? n / 1000 : n);
};
const newClient = (mac) => ({ mac: mac, ip: '', name: '', wireless: null, via: '', signal: null, speed: null, speedRx: null, viaApMac: null, viaSwMac: null, viaName: '', viaPort: '', viaDeviceIp: '' });

// one small HTTP(S) request. Self-signed certificates are accepted, because routers and controllers use them.
function httpRequest(o) {
  return new Promise((resolve, reject) => {
    const lib = o.https ? https : http;
    const headers = Object.assign({ Accept: 'application/json', 'User-Agent': 'DashboardHub' }, o.headers || {});
    let payload = null;
    if (o.json !== undefined) { payload = Buffer.from(JSON.stringify(o.json)); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    else if (o.raw !== undefined) { payload = Buffer.from(o.raw); headers['Content-Type'] = o.contentType || 'text/xml'; headers['Content-Length'] = payload.length; }
    else if (o.form !== undefined) { payload = Buffer.from(o.form); headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = payload.length; }
    if (o.auth) headers.Authorization = 'Basic ' + Buffer.from(o.auth).toString('base64');
    const req = lib.request({
      host: o.host, port: o.port, method: o.method || (payload ? 'POST' : 'GET'), path: o.path, headers: headers,
      rejectUnauthorized: false, timeout: o.timeout || 8000
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { req.destroy(new ConnError('bad', 'The answer was far too big.')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e) => reject(new ConnError('timeout', e.code || 'cut off')));
    });
    req.on('timeout', () => req.destroy(new ConnError('timeout', 'no answer')));
    req.on('error', (e) => {
      if (e instanceof ConnError) return reject(e);
      if (e.code === 'ECONNREFUSED') return reject(new ConnError('refused', 'refused'));
      if (/^ERR_SSL|EPROTO|WRONG_VERSION|ERR_TLS/.test(String(e.code || e.message))) return reject(new ConnError('bad', 'tls'));
      reject(new ConnError('timeout', e.code || e.message));
    });
    if (payload) req.write(payload);
    req.end();
  });
}
function parseJson(res, what) {
  try { return JSON.parse(res.text); } catch (e) { throw new ConnError('bad', (what || 'The device') + ' did not answer in the expected format.'); }
}
function checkStatus(res, what) {
  if (res.status === 401 || res.status === 403) throw new ConnError('auth', 'refused');
  if (res.status === 404) throw new ConnError('notfound', what || 'That address');
  if (res.status >= 500) throw new ConnError('bad', 'The device reported an error (' + res.status + ').');
  if (res.status >= 300) throw new ConnError('bad', 'Unexpected answer from the device (' + res.status + ').');
}

// ---------- SNMP v1 / v2c (small, read-only) ----------
const SNMP = (() => {
  const encLen = (n) => {
    if (n < 128) return Buffer.from([n]);
    const b = [];
    while (n > 0) { b.unshift(n & 255); n = Math.floor(n / 256); }
    return Buffer.from([0x80 | b.length].concat(b));
  };
  const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), encLen(body.length), body]);
  const encInt = (v) => {
    const b = [];
    let n = v;
    do { b.unshift(n & 255); n = Math.floor(n / 256); } while (n > 0 || (b[0] & 0x80));
    return tlv(0x02, Buffer.from(b));
  };
  const encOid = (oid) => {
    const p = oid.split('.').map(Number);
    const out = [p[0] * 40 + p[1]];
    for (let i = 2; i < p.length; i++) {
      let n = p[i];
      const part = [n & 127];
      n = Math.floor(n / 128);
      while (n > 0) { part.unshift((n & 127) | 128); n = Math.floor(n / 128); }
      out.push.apply(out, part);
    }
    return tlv(0x06, Buffer.from(out));
  };
  function readTlv(buf, pos) {
    if (pos + 2 > buf.length) throw new Error('short');
    const tag = buf[pos];
    let len = buf[pos + 1];
    let start = pos + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n < 1 || n > 4 || start + n > buf.length) throw new Error('bad length');
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf[start + i];
      start += n;
    }
    if (start + len > buf.length) throw new Error('short');
    return { tag: tag, start: start, end: start + len };
  }
  const decInt = (b) => { let v = b.length && (b[0] & 0x80) ? -1 : 0; for (const x of b) v = v * 256 + x; return v; };
  const decUint = (b) => { let v = 0; for (const x of b) v = v * 256 + x; return v; };
  function decOid(b) {
    if (!b.length) return '';
    const out = [Math.floor(b[0] / 40), b[0] % 40];
    let n = 0;
    for (let i = 1; i < b.length; i++) {
      n = n * 128 + (b[i] & 127);
      if (!(b[i] & 128)) { out.push(n); n = 0; }
    }
    return out.join('.');
  }
  function decodeValue(buf, t) {
    const body = buf.subarray(t.start, t.end);
    switch (t.tag) {
      case 0x02: return { type: 'int', value: decInt(body) };
      case 0x04: return { type: 'str', value: Buffer.from(body) };
      case 0x05: return { type: 'null', value: null };
      case 0x06: return { type: 'oid', value: decOid(body) };
      case 0x40: return { type: 'ip', value: Array.from(body).join('.') };
      case 0x41: case 0x42: case 0x43: case 0x46: return { type: 'uint', value: decUint(body) };
      case 0x80: case 0x81: case 0x82: return { type: 'end', value: null };
      default: return { type: 'other', value: Buffer.from(body) };
    }
  }
  const PDU = { get: 0xa0, next: 0xa1 };
  // version: the number on the wire (0 = v1, 1 = v2c)
  function encodeRequest(o) {
    const vbs = Buffer.concat(o.oids.map((x) => tlv(0x30, Buffer.concat([encOid(x), Buffer.from([0x05, 0x00])]))));
    const pdu = tlv(PDU[o.type] || PDU.get, Buffer.concat([encInt(o.id), encInt(0), encInt(0), tlv(0x30, vbs)]));
    return tlv(0x30, Buffer.concat([encInt(o.version), tlv(0x04, Buffer.from(String(o.community), 'latin1')), pdu]));
  }
  // reads one PDU (response, report ...) that starts at tlv "pdu" inside buf
  function parsePdu(buf, pdu) {
    let p = pdu.start;
    const rid = readTlv(buf, p); p = rid.end;
    const es = readTlv(buf, p); p = es.end;
    const ei = readTlv(buf, p); p = ei.end;
    const list = readTlv(buf, p);
    const vbs = [];
    p = list.start;
    while (p < list.end) {
      const vb = readTlv(buf, p);
      let q = vb.start;
      const o = readTlv(buf, q); q = o.end;
      const v = readTlv(buf, q);
      const dec = decodeValue(buf, v);
      vbs.push({ oid: decOid(buf.subarray(o.start, o.end)), type: dec.type, value: dec.value });
      p = vb.end;
    }
    return { tag: pdu.tag, id: decInt(buf.subarray(rid.start, rid.end)), errorStatus: decInt(buf.subarray(es.start, es.end)), vbs: vbs };
  }
  function decodeResponse(buf) {
    const top = readTlv(buf, 0);
    if (top.tag !== 0x30) throw new Error('not SNMP');
    let p = top.start;
    const ver = readTlv(buf, p); p = ver.end;
    const com = readTlv(buf, p); p = com.end;
    const pdu = readTlv(buf, p);
    if (pdu.tag !== 0xa2) throw new Error('not a response');
    const r = parsePdu(buf, pdu);
    return { id: r.id, errorStatus: r.errorStatus, vbs: r.vbs };
  }

  // ----- SNMP version 3 (user name + passwords, RFC 3414 "USM") -----
  const USM_OIDS = {
    '1.3.6.1.6.3.15.1.1.1.0': 'level', '1.3.6.1.6.3.15.1.1.2.0': 'time', '1.3.6.1.6.3.15.1.1.3.0': 'user',
    '1.3.6.1.6.3.15.1.1.4.0': 'engine', '1.3.6.1.6.3.15.1.1.5.0': 'digest', '1.3.6.1.6.3.15.1.1.6.0': 'decrypt'
  };
  const HASHES = { md5: { node: 'md5', mac: 12 }, sha: { node: 'sha1', mac: 12 }, sha256: { node: 'sha256', mac: 24 } };
  const octets = (b) => tlv(0x04, Buffer.from(b));
  function userKey(hashName, pass) {                       // password -> key: the password repeated to 1 MB, hashed
    const pw = Buffer.from(String(pass), 'utf8');
    const buf = Buffer.alloc(1048576);
    for (let i = 0; i < buf.length; i++) buf[i] = pw[i % pw.length];
    return crypto.createHash(hashName).update(buf).digest();
  }
  const localizeKey = (hashName, ku, eid) => crypto.createHash(hashName).update(Buffer.concat([ku, eid, ku])).digest();
  const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

  // st: { user, eid, boots, time, authKey, authProto, privKey, privProto }
  function v3Encode(st, o) {
    const hasAuth = !!st.authKey, hasPriv = !!st.privKey;
    const pduBody = Buffer.concat([encInt(o.id), encInt(0), encInt(0), tlv(0x30, Buffer.concat((o.oids || []).map((x) => tlv(0x30, Buffer.concat([encOid(x), Buffer.from([0x05, 0x00])])))))]);
    const pdu = tlv(PDU[o.type] || PDU.get, pduBody);
    const scoped = tlv(0x30, Buffer.concat([octets(st.eid), octets(Buffer.alloc(0)), pdu]));
    let msgData = scoped, privParams = Buffer.alloc(0);
    if (hasPriv) {
      if (st.privProto === 'aes') {
        const salt = crypto.randomBytes(8);
        const c = crypto.createCipheriv('aes-128-cfb', st.privKey.subarray(0, 16), Buffer.concat([be32(st.boots), be32(st.time), salt]));
        msgData = octets(Buffer.concat([c.update(scoped), c.final()]));
        privParams = salt;
      } else {
        const salt = Buffer.concat([be32(st.boots), crypto.randomBytes(4)]);
        const pre = st.privKey.subarray(8, 16);
        const iv = Buffer.alloc(8);
        for (let i = 0; i < 8; i++) iv[i] = pre[i] ^ salt[i];
        const pad = (8 - (scoped.length % 8)) % 8;
        const c = crypto.createCipheriv('des-cbc', st.privKey.subarray(0, 8), iv);
        c.setAutoPadding(false);
        msgData = octets(Buffer.concat([c.update(Buffer.concat([scoped, Buffer.alloc(pad)])), c.final()]));
        privParams = salt;
      }
    }
    const macLen = hasAuth ? HASHES[st.authProto].mac : 0;
    const flags = (hasAuth ? 1 : 0) | (hasPriv ? 2 : 0) | (o.reportable === false ? 0 : 4);
    const build = (authParams) => {
      const sec = tlv(0x30, Buffer.concat([octets(st.eid), encInt(st.boots), encInt(st.time), octets(Buffer.from(st.user, 'utf8')), octets(authParams), octets(privParams)]));
      const global = tlv(0x30, Buffer.concat([encInt(o.msgId), encInt(65507), octets(Buffer.from([flags])), encInt(3)]));
      return tlv(0x30, Buffer.concat([encInt(3), global, octets(sec), msgData]));
    };
    if (!hasAuth) return build(Buffer.alloc(0));
    const mac = crypto.createHmac(HASHES[st.authProto].node, st.authKey).update(build(Buffer.alloc(macLen))).digest().subarray(0, macLen);
    return build(mac);
  }

  // returns { msgId, flags, eid, boots, time, pdu } ; throws when the packet is not a good v3 message
  function v3Decode(buf, st) {
    const top = readTlv(buf, 0);
    if (top.tag !== 0x30) throw new Error('not SNMP');
    let p = top.start;
    const ver = readTlv(buf, p); p = ver.end;
    if (decInt(buf.subarray(ver.start, ver.end)) !== 3) throw new Error('not v3');
    const glob = readTlv(buf, p); p = glob.end;
    let q = glob.start;
    const mid = readTlv(buf, q); q = mid.end;
    const msz = readTlv(buf, q); q = msz.end;
    const fl = readTlv(buf, q);
    const flags = buf[fl.start];
    const secOct = readTlv(buf, p); p = secOct.end;
    const sec = readTlv(buf, secOct.start);
    let r = sec.start;
    const eid = readTlv(buf, r); r = eid.end;
    const boots = readTlv(buf, r); r = boots.end;
    const time = readTlv(buf, r); r = time.end;
    const user = readTlv(buf, r); r = user.end;
    const authP = readTlv(buf, r); r = authP.end;
    const privP = readTlv(buf, r);
    const out = { msgId: decInt(buf.subarray(mid.start, mid.end)), flags: flags, eid: Buffer.from(buf.subarray(eid.start, eid.end)), boots: decInt(buf.subarray(boots.start, boots.end)), time: decInt(buf.subarray(time.start, time.end)) };
    if (flags & 1) {
      if (!st || !st.authKey) throw new Error('unexpected authentication');
      const macLen = HASHES[st.authProto].mac;
      if (authP.end - authP.start !== macLen) throw new Error('bad digest length');
      const copy = Buffer.from(buf);
      copy.fill(0, authP.start, authP.end);
      const want = crypto.createHmac(HASHES[st.authProto].node, st.authKey).update(copy).digest().subarray(0, macLen);
      if (!crypto.timingSafeEqual(want, buf.subarray(authP.start, authP.end))) throw new Error('bad digest');
    }
    let scopedBuf = buf, scoped;
    if (flags & 2) {
      if (!st || !st.privKey) throw new Error('unexpected privacy');
      const enc = readTlv(buf, p);
      const data = buf.subarray(enc.start, enc.end);
      const salt = buf.subarray(privP.start, privP.end);
      if (salt.length !== 8) throw new Error('bad salt');
      let plain;
      if (st.privProto === 'aes') {
        const d = crypto.createDecipheriv('aes-128-cfb', st.privKey.subarray(0, 16), Buffer.concat([be32(out.boots), be32(out.time), salt]));
        plain = Buffer.concat([d.update(data), d.final()]);
      } else {
        const pre = st.privKey.subarray(8, 16);
        const iv = Buffer.alloc(8);
        for (let i = 0; i < 8; i++) iv[i] = pre[i] ^ salt[i];
        const d = crypto.createDecipheriv('des-cbc', st.privKey.subarray(0, 8), iv);
        d.setAutoPadding(false);
        plain = Buffer.concat([d.update(data.subarray(0, data.length - (data.length % 8))), d.final()]);
      }
      scopedBuf = plain;
      scoped = readTlv(plain, 0);
    } else scoped = readTlv(buf, p);
    if (scoped.tag !== 0x30) throw new Error('bad scoped PDU');
    let s2 = scoped.start;
    const cid = readTlv(scopedBuf, s2); s2 = cid.end;
    const cn = readTlv(scopedBuf, s2); s2 = cn.end;
    const pdu = readTlv(scopedBuf, s2);
    out.pdu = parsePdu(scopedBuf, pdu);
    return out;
  }
  function v3Keys(o, eid) {
    const st = { user: o.user, eid: eid, authProto: o.authProto, privProto: o.privProto };
    if (o.authProto && o.authPass) {
      const h = HASHES[o.authProto].node;
      st.authKey = localizeKey(h, userKey(h, o.authPass), eid);
      if (o.privProto && o.privPass) st.privKey = localizeKey(h, userKey(h, o.privPass), eid);
    }
    return st;
  }

  class Session {
    constructor(o) {
      this.host = o.host; this.port = o.port || 161; this.community = o.community || 'public';
      this.v3 = o.version === 3 ? { user: String(o.user || ''), authProto: o.authProto, authPass: o.authPass, privProto: o.privProto, privPass: o.privPass } : null;
      this.version = o.version === 1 ? 0 : 1;
      this.timeout = o.timeout || 2500; this.retries = o.retries === undefined ? 1 : o.retries;
      this.deadline = o.deadline || 0;
      this.sock = dgram.createSocket('udp4');
      this.sock.on('error', () => {});
    }
    close() { try { this.sock.close(); } catch (e) { /* ignore */ } }
    // sends msg, waits for a packet that "match" accepts (it returns the result, or undefined to keep waiting)
    exchange(msg, match) {
      const attempt = (left) => new Promise((resolve, reject) => {
        let done = false;
        const cleanup = () => { if (done) return; done = true; clearTimeout(timer); this.sock.removeListener('message', onMsg); };
        const timer = setTimeout(() => { cleanup(); if (left > 0) resolve(attempt(left - 1)); else reject(new ConnError('timeout', 'no answer')); }, this.timeout);
        const onMsg = (buf, rinfo) => {
          if (rinfo.address !== this.host) return;
          let r;
          try { r = match(buf); } catch (e) { if (process.env.SNMPDBG) console.log("drop:", e.message); return; }
          if (r === undefined) return;
          cleanup();
          resolve(r);
        };
        this.sock.on('message', onMsg);
        this.sock.send(msg, this.port, this.host, (err) => { if (err) { cleanup(); reject(new ConnError('timeout', err.code || 'send failed')); } });
      });
      return attempt(this.retries);
    }
    // version 3: ask the device for its engine id, then work out the keys
    async discover() {
      const v = this.v3;
      const msgId = crypto.randomInt(1, 0x3fffffff);
      const probe = { user: '', eid: Buffer.alloc(0), boots: 0, time: 0 };
      const msg = v3Encode(probe, { msgId: msgId, id: msgId, type: 'get', oids: [] });
      const rep = await this.exchange(msg, (buf) => { const d = v3Decode(buf, null); return d.msgId === msgId ? d : undefined; });
      if (!rep.eid.length) throw new ConnError('bad', 'v3: the device did not give its engine id.');
      this.st = v3Keys(Object.assign({ user: v.user }, v), rep.eid);
      this.st.boots = rep.boots; this.st.syncAt = Date.now() - rep.time * 1000;
    }
    async request3(type, oids, again) {
      const st = this.st;
      const msgId = crypto.randomInt(1, 0x3fffffff);
      const cur = Object.assign({}, st, { time: Math.floor((Date.now() - st.syncAt) / 1000) });
      const msg = v3Encode(cur, { msgId: msgId, id: msgId, type: type, oids: oids });
      const d = await this.exchange(msg, (buf) => { const x = v3Decode(buf, cur); return x.msgId === msgId ? x : undefined; });
      if (d.pdu.tag === 0xa8) {                                  // a "report" means something is wrong
        const why = d.pdu.vbs[0] && USM_OIDS[d.pdu.vbs[0].oid];
        if (why === 'time' && !again) { st.boots = d.boots; st.syncAt = Date.now() - d.time * 1000; return this.request3(type, oids, true); }
        const msgs = {
          user: 'v3: the device does not know that user name.', digest: 'v3: the user name is known, but the authentication password (or its type) is wrong.',
          decrypt: 'v3: the privacy password (or its type, AES / DES) is wrong.', level: 'v3: the device does not allow that security level for this user.',
          time: 'v3: the device and this computer disagree about the time window.', engine: 'v3: the device did not recognise the engine id.'
        };
        throw new ConnError('auth', msgs[why] || 'v3: the device refused the request.');
      }
      return { id: d.pdu.id, errorStatus: d.pdu.errorStatus, vbs: d.pdu.vbs };
    }
    request(type, oids) {
      if (this.v3) return this.request3(type, oids, false);
      const reqId = crypto.randomInt(1, 0x3fffffff);
      const msg = encodeRequest({ version: this.version, community: this.community, type: type, id: reqId, oids: oids });
      return this.exchange(msg, (buf) => { const r = decodeResponse(buf); return r.id === reqId ? r : undefined; });
    }
    async get(oids) { return (await this.request('get', oids)).vbs; }
    // everything under "base", one step at a time (GETNEXT works with every agent), at most "limit" entries
    async walk(base, limit) {
      const out = [];
      let cur = base;
      const max = limit || 3000;
      while (out.length < max) {
        if (this.deadline && Date.now() > this.deadline) break;
        const r = await this.request('next', [cur]);
        if (r.errorStatus !== 0 || !r.vbs.length) break;         // v1 "noSuchName" means: end of table
        const vb = r.vbs[0];
        if (vb.type === 'end' || !vb.oid.startsWith(base + '.') || vb.oid === cur) break;
        out.push(vb);
        cur = vb.oid;
      }
      return out;
    }
  }
  return { Session: Session, encodeRequest: encodeRequest, decodeResponse: decodeResponse };
})();

const ENTERPRISES = {
  9: 'Cisco', 3955: 'Cisco', 11: 'HPE / Aruba', 25506: 'HPE / Aruba', 14823: 'HPE / Aruba', 47196: 'HPE / Aruba', 4526: 'Netgear', 11863: 'TP-Link', 41112: 'Ubiquiti UniFi',
  10002: 'Ubiquiti UniFi', 14988: 'MikroTik', 171: 'D-Link', 890: 'Zyxel', 2636: 'Juniper', 674: 'Dell', 1916: 'Ruckus / Extreme', 1991: 'Ruckus / Extreme',
  1588: 'Ruckus / Extreme', 3076: 'Linksys', 11898: 'Linksys', 13742: 'Linksys', 12356: 'Fortinet', 2011: 'Huawei', 52619: 'Mercusys', 8744: 'Allied Telesis',
  207: 'Allied Telesis', 6486: 'Alcatel-Lucent', 30065: 'Arista', 4413: 'Planet', 7244: 'Moxa', 8691: 'Moxa', 8072: 'Linux (Net-SNMP)', 2021: 'Linux (Net-SNMP)'
};
const BRAND_WORDS = [
  [/hewlett|\bhpe?\b|procurve|officeconnect|aruba|comware|\bh3c\b/i, 'HPE / Aruba'], [/cisco|catalyst|meraki/i, 'Cisco'], [/netgear/i, 'Netgear'], [/tp-?link|omada|jetstream/i, 'TP-Link'],
  [/ubiquiti|unifi|edgeswitch|\busw\b/i, 'Ubiquiti UniFi'], [/mikrotik|routeros/i, 'MikroTik'], [/d-?link/i, 'D-Link'], [/zyxel/i, 'Zyxel'], [/juniper|junos/i, 'Juniper'],
  [/\bdell\b|powerconnect/i, 'Dell'], [/brocade|ruckus|extreme/i, 'Ruckus / Extreme'], [/linksys/i, 'Linksys'], [/tenda/i, 'Tenda'], [/fortinet|fortigate/i, 'Fortinet'],
  [/epson/i, 'Epson'], [/canon/i, 'Canon'], [/brother/i, 'Brother'], [/xerox/i, 'Xerox'], [/lexmark/i, 'Lexmark'], [/ricoh/i, 'Ricoh'], [/kyocera/i, 'Kyocera'], [/konica|minolta/i, 'Konica Minolta'],
    [/huawei/i, 'Huawei'], [/engenius/i, 'EnGenius'], [/trendnet/i, 'TRENDnet'], [/allied telesis/i, 'Allied Telesis'], [/synology/i, 'Synology'], [/qnap/i, 'QNAP'], [/arista/i, 'Arista']
];
const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0', sysObjectID: '1.3.6.1.2.1.1.2.0', sysName: '1.3.6.1.2.1.1.5.0', sysUpTime: '1.3.6.1.2.1.1.3.0',
  ifType: '1.3.6.1.2.1.2.2.1.3', ifDescr: '1.3.6.1.2.1.2.2.1.2', ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15', ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  arp: '1.3.6.1.2.1.4.22.1.2', fdbPort: '1.3.6.1.2.1.17.4.3.1.2', basePortIf: '1.3.6.1.2.1.17.1.4.1.2', qFdbPort: '1.3.6.1.2.1.17.7.1.2.2.1.2'
};
const ETHERNET_IF_TYPES = new Set([6, 62, 69, 117]);          // ethernetCsmacd, fastEther, fastEtherFX, gigabitEthernet
// sysUpTime is in hundredths of a second
const upSec = (v) => (v && v.type === 'uint' && Number.isFinite(Number(v.value)) && Number(v.value) >= 0 ? Math.floor(Number(v.value) / 100) : null);
const hexMac = (bytes) => normMac(Array.from(bytes).map((b) => Number(b).toString(16).padStart(2, '0')).join(':'));

const PRINTER_WORDS = /epson|canon|brother|xerox|lexmark|ricoh|kyocera|konica|minolta|oki data|okidata|laserjet|officejet|deskjet|designjet|ecotank|workforce|pixma|imageclass|bizhub|\bmfp\b|printer|jetdirect|zebra tech/i;
async function pollSnmp(c) {
  const v3 = c.snmpVersion === 3;
  const s = new SNMP.Session({ host: c.host, port: c.port, community: c.password || 'public', version: c.snmpVersion === 1 ? 1 : v3 ? 3 : 2, deadline: Date.now() + 40000,
    user: c.username, authProto: c.authProto === 'none' ? '' : c.authProto, authPass: c.authProto === 'none' ? '' : c.password, privProto: c.privProto === 'none' ? '' : c.privProto, privPass: c.privProto === 'none' ? '' : c.secret2 });
  try {
    if (v3) await s.discover();
    const sys = await s.get([OID.sysDescr, OID.sysObjectID, OID.sysName, OID.sysUpTime]);
    const by = {};
    sys.forEach((v) => { by[v.oid] = v; });
    const str = (o) => (by[o] && by[o].type === 'str' ? cleanText(by[o].value.toString('utf8'), 200) : '');
    const descr = str(OID.sysDescr), name = str(OID.sysName);
    const oidv = by[OID.sysObjectID] && by[OID.sysObjectID].type === 'oid' ? by[OID.sysObjectID].value : '';
    if (!descr && !name && !oidv) throw new ConnError('auth', 'no system information');
    const em = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(oidv);
    let brand = em && ENTERPRISES[em[1]] ? ENTERPRISES[em[1]] : '';
    if (!brand || /Net-SNMP/.test(brand)) { const hit = BRAND_WORDS.find((b) => b[0].test(descr + ' ' + name)); if (hit) brand = hit[1]; }

    // interfaces: names, and how many real network ports there are
    const types = {};
    for (const v of await s.walk(OID.ifType, 2000)) types[v.oid.slice(OID.ifType.length + 1)] = v.value;
    let nameBase = OID.ifName;
    let nameWalk = await s.walk(OID.ifName, 2000);
    if (!nameWalk.length) { nameBase = OID.ifDescr; nameWalk = await s.walk(OID.ifDescr, 2000); }
    const names = {};
    nameWalk.forEach((v) => { if (v.type === 'str') names[v.oid.slice(nameBase.length + 1)] = cleanText(v.value.toString('utf8'), 30); });
    const ports = Object.keys(types).filter((k) => ETHERNET_IF_TYPES.has(types[k])).length;
    // how fast each port is linked right now (Mbps), by port name
    const speedOfIf = {};
    try {
      for (const v of await s.walk(OID.ifSpeed, 2000)) { const n = Number(v.value); if (Number.isFinite(n) && n > 0 && n < 4294967295) speedOfIf[v.oid.slice(OID.ifSpeed.length + 1)] = n / 1e6; }
      for (const v of await s.walk(OID.ifHighSpeed, 2000)) { const n = Number(v.value); if (Number.isFinite(n) && n > 0) speedOfIf[v.oid.slice(OID.ifHighSpeed.length + 1)] = n; }
    } catch (e) { /* this device does not report port speeds */ }
    const speedOfPort = {};
    Object.keys(speedOfIf).forEach((k) => { if (names[k]) speedOfPort[names[k]] = mbps(speedOfIf[k]); });

    const clients = new Map();
    const touch = (mac) => { if (!clients.has(mac)) clients.set(mac, newClient(mac)); return clients.get(mac); };
    // who is on the network: the address (ARP) table
    for (const v of await s.walk(OID.arp, 3000)) {
      if (v.type !== 'str' || v.value.length !== 6) continue;
      const mac = hexMac(v.value);
      const ip = cleanIp(v.oid.split('.').slice(-4).join('.'));
      if (mac && ip) touch(mac).ip = ip;
    }
    // where each one sits: the forwarding table of a switch (bridge MIB), with port names
    const portIf = {};
    for (const v of await s.walk(OID.basePortIf, 2000)) portIf[v.oid.slice(OID.basePortIf.length + 1)] = String(v.value);
    const seenOn = new Map();
    const addFdb = (walk, base) => {
      for (const v of walk) {
        const tail = v.oid.slice(base.length + 1).split('.');
        if (tail.length < 6 || !v.value) continue;
        const mac = normMac(tail.slice(-6).map((n) => Number(n).toString(16).padStart(2, '0')).join(':'));
        if (!mac) continue;
        const bp = String(v.value);
        const idx = portIf[bp] || bp;
        seenOn.set(mac, names[idx] || 'port ' + idx);
      }
    };
    addFdb(await s.walk(OID.fdbPort, 4000), OID.fdbPort);
    addFdb(await s.walk(OID.qFdbPort, 4000), OID.qFdbPort);
    const perPort = {};
    seenOn.forEach((p) => { perPort[p] = (perPort[p] || 0) + 1; });
    seenOn.forEach((port, mac) => {
      const cl = touch(mac);
      cl.port = port;
      cl.viaPort = port;
      cl.viaDeviceIp = c.host;
      cl.via = port ? 'switch port ' + port + (perPort[port] >= 4 ? ' (shared port, toward other switches)' : '') : '';
      cl.wireless = false;
    });
    const list = [];
    clients.forEach((cl) => {
      const port = seenOn.get(cl.mac) || cl.port || '';
      cl.port = port;
      cl.viaPort = port;
      cl.viaDeviceIp = c.host;
      if (port && speedOfPort[port]) cl.speed = speedOfPort[port];
      if (port && !cl.via) cl.via = 'switch port ' + port + (perPort[port] >= 4 ? ' (shared port, toward other switches)' : '');
      if (port) cl.wireless = false;
      if (cl.ip || cl.mac) list.push(cl);
    });
    const kind = PRINTER_WORDS.test(descr + ' ' + name + ' ' + brand) && !seenOn.size ? 'printer' : seenOn.size ? 'switch' : (clients.size ? 'router' : null);
    // every network port: is it up, and how fast is it linked (a port that is down has no speed)
    const portTable = [];
    try {
      const st = {};
      for (const v of await s.walk(OID_IF.status, 2000)) st[v.oid.slice(OID_IF.status.length + 1)] = Number(v.value);
      Object.keys(types).filter((k) => ETHERNET_IF_TYPES.has(types[k]) && names[k]).sort((a, b) => Number(a) - Number(b)).slice(0, 128).forEach((k) => {
        const up = st[k] === 1;
        portTable.push({ name: names[k], up: up, speed: up && speedOfIf[k] ? mbps(speedOfIf[k]) : null });
      });
    } catch (e) { /* this device does not list port states */ }
    return {
      host: c.host,
      self: { uptimeSec: upSec(by[OID.sysUpTime]), portTable: portTable, name: name, brand: brand, model: cleanText(descr.split(/[\r\n,]/)[0], 60), ports: ports || null, descr: descr, kind: kind },
      clients: list.slice(0, 2000), gear: [],
      note: seenOn.size ? 'Its forwarding table lists ' + seenOn.size + ' machine' + (seenOn.size === 1 ? '' : 's') + ' on ' + Object.keys(perPort).length + ' port' + (Object.keys(perPort).length === 1 ? '' : 's') + (Object.keys(perPort).some((p) => perPort[p] >= 4) ? ' (a port with several machines usually leads to another switch, often an unmanaged one: draw it with "Draw physical cable")' : '') + '. A machine that has been quiet for about 5 minutes drops out of this table.'
        : (clients.size ? 'It listed machines but has no forwarding table, so it cannot say which port each one is on.' : '')
    };
  } finally { s.close(); }
}

// ---------- UniFi ----------
async function pollUnifi(c) {
  const site = /^[A-Za-z0-9_-]{1,40}$/.test(c.site || '') ? c.site : 'default';
  const base = { host: c.host, port: c.port, https: c.https !== false };
  let prefix = '/proxy/network';
  let r = await httpRequest(Object.assign({ path: '/api/auth/login', json: { username: c.username, password: c.password, remember: false } }, base));
  if (r.status === 404) {           // an older, self-hosted controller
    prefix = '';
    r = await httpRequest(Object.assign({ path: '/api/login', json: { username: c.username, password: c.password } }, base));
  }
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
  checkStatus(r, 'The UniFi login');
  const cookies = [].concat(r.headers['set-cookie'] || []).map((x) => x.split(';')[0]).join('; ');
  if (!cookies) throw new ConnError('auth', 'refused');
  const headers = { Cookie: cookies };
  if (r.headers['x-csrf-token']) headers['X-CSRF-Token'] = r.headers['x-csrf-token'];
  const get = async (p) => {
    const res = await httpRequest(Object.assign({ path: prefix + '/api/s/' + site + p, headers: headers }, base));
    if (res.status === 404) throw new ConnError('notfound', 'The UniFi site "' + site + '"');
    checkStatus(res, 'UniFi');
    const j = parseJson(res, 'UniFi');
    return Array.isArray(j.data) ? j.data : [];
  };
  const sta = await get('/stat/sta');
  let dev = [];
  try { dev = await get('/stat/device'); } catch (e) { if (e.kind === 'auth') throw e; }
  const nameOf = {};
  const portSpeed = {};
  dev.forEach((d) => {
    const m = normMac(d.mac);
    if (m) nameOf[m] = cleanText(d.name || d.model || '', 40);
    if (m && Array.isArray(d.port_table)) d.port_table.slice(0, 128).forEach((p) => { if (p && p.up !== false && mbps(p.speed)) portSpeed[m + '|' + String(p.port_idx)] = mbps(p.speed); });
  });
  const bands = { na: '5 GHz', ng: '2.4 GHz', '6e': '6 GHz', ax: '5 GHz', ac: '5 GHz' };
  const clients = sta.slice(0, 3000).map((x) => {
    const mac = normMac(x.mac);
    if (!mac) return null;
    const cl = newClient(mac);
    cl.ip = cleanIp(x.ip) || cleanIp(x.last_ip);
    cl.name = cleanText(x.name || x.hostname || '', 60);
    if (Number.isFinite(x.uptime) && x.uptime >= 0 && x.uptime < 3153600000) cl.connSec = Math.floor(x.uptime);
    if (x.is_wired === false) {
      cl.wireless = true;
      cl.signal = sig(x.signal);
      cl.speed = mbps(Number(x.tx_rate) / 1000);      // the access point reports kilobits per second
      cl.speedRx = mbps(Number(x.rx_rate) / 1000);
      const apMac = normMac(x.ap_mac);
      const ap = nameOf[apMac] || '';
      cl.viaApMac = apMac;
      cl.viaName = ap;
      const ub = bands[x.radio] || freqBand(x.channel) || bandName(x.radio_proto || '');
      cl.via = [ub ? ub + ' Wi-Fi' : 'Wi-Fi', x.essid ? cleanText(x.essid, 32) : '', ap ? 'on ' + ap : ''].filter(Boolean).join(' · ');
    } else if (x.is_wired === true) {
      cl.wireless = false;
      const swMac = normMac(x.sw_mac);
      const sw = nameOf[swMac] || '';
      cl.viaSwMac = swMac;
      cl.viaName = sw;
      cl.viaPort = cleanText(x.sw_port, 6);
      cl.speed = mbps(x.wired_rate_mbps) || portSpeed[swMac + '|' + String(x.sw_port)] || null;
      cl.via = x.sw_port ? (sw || 'switch') + ', port ' + cleanText(x.sw_port, 6) : '';
    }
    return cl;
  }).filter(Boolean);
  const kinds = { usw: 'switch', uap: 'ap', ugw: 'router', udm: 'router', uxg: 'router', udb: 'ap' };
  const gear = dev.slice(0, 500).map((d) => {
    const mac = normMac(d.mac);
    if (!mac) return null;
    return { mac: mac, ip: cleanIp(d.ip), name: cleanText(d.name || '', 60), brand: 'Ubiquiti UniFi', uptimeSec: Number.isFinite(d.uptime) && d.uptime >= 0 && d.uptime < 3153600000 ? Math.floor(d.uptime) : null, model: cleanText(d.model || '', 60), kind: kinds[d.type] || 'other', ports: Array.isArray(d.port_table) && d.port_table.length ? d.port_table.length : null,
      // every port with its link state and speed (the port number is what each client's "switch port" refers to)
      portTable: Array.isArray(d.port_table) ? d.port_table.slice(0, 128).filter((p) => p && p.port_idx !== undefined && !p.is_uplink_lag).map((p) => ({ name: String(p.port_idx), up: p.up === true, speed: p.up === true ? mbps(p.speed) : null, label: cleanText(p.name || '', 30), uplink: p.is_uplink === true })) : [] };
  }).filter(Boolean);
  return { host: c.host, self: null, clients: clients, gear: gear };
}

// ---------- MikroTik RouterOS 7 (REST) ----------
async function pollMikrotik(c) {
  const base = { host: c.host, port: c.port, https: c.https !== false, auth: c.username + ':' + c.password };
  const get = async (path, optional) => {
    const r = await httpRequest(Object.assign({ path: '/rest' + path }, base));
    if (optional && r.status === 404) return null;
    checkStatus(r, 'The RouterOS REST API (it needs RouterOS 7.1 or newer)');
    const j = parseJson(r, 'RouterOS');
    return Array.isArray(j) ? j : [j];
  };
  const identity = (await get('/system/identity') || [])[0] || {};
  const resource = (await get('/system/resource', true) || [])[0] || {};
  const arp = await get('/ip/arp', true) || [];
  const leases = await get('/ip/dhcp-server/lease', true) || [];
  const wifi1 = await get('/interface/wifi/registration-table', true);
  const wifi2 = await get('/interface/wireless/registration-table', true);
  const eth = await get('/interface/ethernet', true);
  const wifiKnown = wifi1 !== null || wifi2 !== null;
  const wifi = (wifi1 || []).concat(wifi2 || []);
  const by = new Map();
  const touch = (mac) => { if (!by.has(mac)) by.set(mac, newClient(mac)); return by.get(mac); };
  arp.forEach((a) => {
    const mac = normMac(a['mac-address']);
    if (!mac || a.status === 'failed' || a.status === 'incomplete' || a.invalid === 'true') return;
    const cl = touch(mac);
    cl.ip = cleanIp(a.address) || cl.ip;
  });
  leases.forEach((l) => {
    const mac = normMac(l['mac-address']);
    if (!mac || !by.has(mac)) return;                            // only machines that really answer
    const cl = by.get(mac);
    cl.name = cleanText(l['host-name'] || l.comment || '', 60) || cl.name;
    cl.ip = cl.ip || cleanIp(l.address || l['active-address']);
  });
  const wl = new Map();
  wifi.forEach((w) => { const mac = normMac(w['mac-address']); if (mac) wl.set(mac, w); });
  by.forEach((cl, mac) => {
    if (wl.has(mac)) {
      const w = wl.get(mac);
      cl.wireless = true;
      const mb = bandName(w.band || '') || freqBand(String(w.frequency || w['channel'] || '').split(/[^0-9]/)[0]) || bandName(w.interface || '');
      cl.via = 'Wi-Fi' + (mb ? ' ' + mb : '') + ' (' + cleanText(w.interface || 'wifi', 20) + ')';
      cl.signal = sig(String(w.signal || w['signal-strength'] || '').split('@')[0]);
      cl.speed = parseRate(w['tx-rate']);
      cl.speedRx = parseRate(w['rx-rate']);
    } else if (wifiKnown) cl.wireless = false;
  });
  return {
    host: c.host,
    self: { name: cleanText(identity.name || '', 60), brand: 'MikroTik', model: cleanText(resource['board-name'] || '', 60), ports: eth && eth.length ? eth.length : null, descr: resource.version ? 'RouterOS ' + cleanText(resource.version, 30) : '', kind: 'router' },
    clients: Array.from(by.values()).filter((x) => x.ip).slice(0, 3000), gear: []
  };
}

// ---------- Any switch or router over SSH ----------
async function pollSsh(c) {
  const kind = String(c.site || 'linux').toLowerCase();
  let r;
  try { r = await sshpoll.readDevice(c, kind); }
  catch (e) { throw new ConnError(e && e.kind ? e.kind : 'bad', e && e.message ? e.message : 'The SSH login did not work.'); }
  const by = new Map();
  r.rows.forEach((row) => {                                         // address table rows: the machines that really answer
    if (row.lease) return;
    const mac = normMac(String(row.mac || '')), ip = cleanIp(String(row.ip || ''));
    if (!mac || !ip) return;
    const cl = by.get(mac) || newClient(mac); by.set(mac, cl);
    cl.ip = ip;
    if (row.port) { cl.port = cleanText(row.port, 24); cl.via = 'port ' + cl.port; }
  });
  r.rows.forEach((row) => {                                         // names from the DHCP leases
    if (!row.lease) return;
    const mac = normMac(String(row.mac || ''));
    if (!mac || !by.has(mac)) return;
    const cl = by.get(mac);
    if (row.name) cl.name = cleanText(row.name, 60) || cl.name;
    cl.ip = cl.ip || cleanIp(String(row.ip || ''));
  });
  return {
    host: c.host,
    self: { name: '', brand: kind === 'cisco' ? 'Cisco' : kind === 'mikrotik' ? 'MikroTik' : '', model: '', ports: null, descr: 'Read over SSH (' + kind + ')', kind: kind === 'cisco' ? 'switch' : 'router' },
    clients: Array.from(by.values()).slice(0, 3000), gear: []
  };
}

// ---------- OPNsense ----------
async function pollOpnsense(c) {
  const base = { host: c.host, port: c.port, https: c.https !== false, auth: c.username + ':' + c.password };
  const get = async (path, optional) => {
    const r = await httpRequest(Object.assign({ path: path }, base));
    if (optional && r.status === 404) return null;
    checkStatus(r, 'The OPNsense API');
    return parseJson(r, 'OPNsense');
  };
  const arp = await get('/api/diagnostics/interface/getArp');
  const leases = await get('/api/dhcpv4/leases/searchLease', true);
  const by = new Map();
  const touch = (mac) => { if (!by.has(mac)) by.set(mac, newClient(mac)); return by.get(mac); };
  (Array.isArray(arp) ? arp : []).slice(0, 3000).forEach((a) => {
    const mac = normMac(a.mac);
    if (!mac) return;
    const cl = touch(mac);
    cl.ip = cleanIp(a.ip) || cl.ip;
    cl.name = cleanText(a.hostname || '', 60) || cl.name;
    cl.via = cleanText(a.intf_description || a.intf || '', 30);
  });
  const rows = leases && Array.isArray(leases.rows) ? leases.rows : [];
  rows.slice(0, 3000).forEach((l) => {
    const mac = normMac(l.hwaddr || l.mac);
    if (!mac) return;
    const cl = touch(mac);
    cl.ip = cleanIp(l.address) || cl.ip;
    cl.name = cleanText(l.hostname || '', 60) || cl.name;
  });
  return { host: c.host, self: { name: '', brand: 'OPNsense', model: 'OPNsense firewall', ports: null, descr: '', kind: 'router' }, clients: Array.from(by.values()).filter((x) => x.ip), gear: [], note: 'OPNsense does not say who is on Wi-Fi, so wired / wireless stays automatic.' };
}

// ---------- OpenWrt (ubus over HTTP) ----------
async function pollOpenwrt(c) {
  const base = { host: c.host, port: c.port, https: c.https === true };
  let id = 1;
  const call = async (sid, obj, method, args) => {
    const r = await httpRequest(Object.assign({ path: '/ubus', json: { jsonrpc: '2.0', id: id++, method: 'call', params: [sid, obj, method, args || {}] } }, base));
    checkStatus(r, 'OpenWrt "/ubus" (is the uhttpd-mod-ubus package installed?)');
    const j = parseJson(r, 'OpenWrt');
    if (j.error) throw new ConnError('bad', 'OpenWrt said: ' + cleanText(j.error.message || 'error', 80));
    const res = j.result;
    if (!Array.isArray(res)) throw new ConnError('bad', 'OpenWrt did not answer in the expected format.');
    if (res[0] === 6) throw new ConnError('auth', 'refused');
    return res[0] === 0 ? res[1] : null;
  };
  const login = await call('00000000000000000000000000000000', 'session', 'login', { username: c.username || 'root', password: c.password });
  const sid = login && (login.ubus_rpc_session || login.ubus_session_id);
  if (!sid) throw new ConnError('auth', 'refused');
  const soft = (obj, method, args) => call(sid, obj, method, args).catch((e) => { if (e.kind === 'auth' || e.kind === 'refused' || e.kind === 'timeout') throw e; return null; });
  const board = await soft('system', 'board', {});
  const by = new Map();
  const touch = (mac) => { if (!by.has(mac)) by.set(mac, newClient(mac)); return by.get(mac); };
  const hints = await soft('luci-rpc', 'getHostHints', {});
  if (hints && typeof hints === 'object') {
    Object.keys(hints).slice(0, 3000).forEach((m) => {
      const mac = normMac(m);
      if (!mac) return;
      const h = hints[m] || {};
      const cl = touch(mac);
      cl.ip = cleanIp(Array.isArray(h.ipaddrs) ? h.ipaddrs[0] : h.ipv4) || cl.ip;
      cl.name = cleanText(h.name || '', 60) || cl.name;
    });
  }
  const leases = await soft('luci-rpc', 'getDHCPLeases', { family: 4 });
  (leases && Array.isArray(leases.dhcp_leases) ? leases.dhcp_leases : []).slice(0, 3000).forEach((l) => {
    const mac = normMac(l.macaddr);
    if (!mac) return;
    const cl = touch(mac);
    cl.ip = cleanIp(l.ipaddr) || cl.ip;
    cl.name = cleanText(l.hostname || '', 60) || cl.name;
  });
  const devs = await soft('iwinfo', 'devices', {});
  const radios = devs && Array.isArray(devs.devices) ? devs.devices.slice(0, 8) : [];
  const wl = new Map();
  for (const dev of radios) {
    const assoc = await soft('iwinfo', 'assoclist', { device: String(dev) });
    const info = await soft('iwinfo', 'info', { device: String(dev) });
    (assoc && Array.isArray(assoc.results) ? assoc.results : []).slice(0, 500).forEach((a) => {
      const mac = normMac(a.mac);
      if (mac) wl.set(mac, { ssid: cleanText(info && info.ssid || '', 40), dev: cleanText(dev, 20), signal: sig(a.signal), speed: mbps(Number(a.tx && a.tx.rate) / 1000), speedRx: mbps(Number(a.rx && a.rx.rate) / 1000), band: freqBand(info && (info.frequency || info.channel)) || bandName(info && (info.hwmodes_text || (info.hwmodes || []).join(' ')) || '') });
    });
  }
  by.forEach((cl, mac) => {
    if (wl.has(mac)) { const w = wl.get(mac); cl.wireless = true; cl.signal = w.signal; cl.speed = w.speed; cl.speedRx = w.speedRx; cl.via = 'Wi-Fi ' + (w.band ? w.band + ' ' : '') + (w.ssid ? w.ssid + ' ' : '') + '(' + w.dev + ')'; }
    else if (devs) cl.wireless = false;
  });
  return {
    host: c.host,
    self: { name: cleanText(board && board.hostname || '', 60), brand: 'OpenWrt', model: cleanText(board && board.model || '', 60), ports: null, descr: cleanText(board && board.release && board.release.description || '', 80), kind: 'router' },
    clients: Array.from(by.values()).filter((x) => x.ip), gear: []
  };
}

// ---------- ASUS (original firmware) ----------
async function pollAsus(c) {
  const base = { host: c.host, port: c.port, https: c.https === true };
  const ua = { 'User-Agent': 'asusrouter-Android-DUTUtil-1.0.0.3.58-163', Referer: (base.https ? 'https' : 'http') + '://' + c.host + '/Main_Login.asp' };
  const auth = Buffer.from(c.username + ':' + c.password).toString('base64');
  const r = await httpRequest(Object.assign({ path: '/login.cgi', headers: ua, form: 'login_authorization=' + encodeURIComponent(auth) }, base));
  checkStatus(r, 'The ASUS login page');
  const j = parseJson(r, 'The ASUS router');
  if (!j.asus_token) {
    if (String(j.error_status) === '7') throw new ConnError('bad', 'The router has locked the login for a while after too many wrong tries. Wait a few minutes.');
    if (String(j.error_status) === '3') throw new ConnError('bad', 'The router wants a captcha. Log in once on its web page first.');
    throw new ConnError('auth', 'refused');
  }
  const headers = Object.assign({ Cookie: 'asus_token=' + j.asus_token }, ua);
  const g = await httpRequest(Object.assign({ path: '/appGet.cgi?hook=get_clientlist()', headers: headers }, base));
  checkStatus(g, 'The ASUS client list');
  const data = parseJson(g, 'The ASUS router').get_clientlist || {};
  const bands = { 1: '2.4 GHz', 2: '5 GHz', 3: '5 GHz-2', 4: '6 GHz' };
  const routerName = c.name || 'ASUS Router';
  const clients = [];
  Object.keys(data).slice(0, 3000).forEach((k) => {
    const x = data[k];
    if (!x || typeof x !== 'object' || !x.mac) return;
    const mac = normMac(x.mac);
    if (!mac || String(x.isOnline) === '0') return;
    const cl = newClient(mac);
    cl.ip = cleanIp(x.ip);
    cl.name = cleanText(x.nickName || x.name || '', 60);
    const wl = String(x.isWL || '0');
    // Wi-Fi when the router says so, or when it gives a signal strength (some firmware leaves isWL empty for 2.4 GHz machines)
    const hasSignal = sig(x.rssi) !== null && String(x.isWL === undefined ? '' : x.isWL) !== '0';
    if (wl !== '0' || hasSignal || /^(1|2|3|4)$/.test(String(x.wlBand || ''))) {
      const band = bands[wl] || bandName(x.wlBand || x.band || x.frequency || x.ssid || '') || bands[String(x.wlBand || '')] || '';
      cl.wireless = true;
      cl.via = 'Wi-Fi ' + band;
      cl.signal = sig(x.rssi);
      cl.speed = parseRate(x.curTx);
      cl.speedRx = parseRate(x.curRx);
    } else {
      cl.wireless = false;
      cl.via = 'cable';
    }
    cl.viaDeviceIp = c.host;
    cl.viaName = routerName;
    clients.push(cl);
  });
  return { host: c.host, type: 'asus', self: { name: routerName, brand: 'ASUS', model: '', ports: null, descr: '', kind: 'router' }, clients: clients.filter((x) => x.ip || x.mac), gear: [] };
}

// ---------- small helpers for the newer connections ----------
const xmlDecode = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tagRe = (tag) => '<(?:[A-Za-z0-9_-]+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?' + tag + '>';
function xmlTag(x, tag) { const m = new RegExp(tagRe(tag)).exec(String(x)); return m ? xmlDecode(m[1]).trim() : ''; }
function xmlAll(x, tag) { const re = new RegExp(tagRe(tag), 'g'); const out = []; let m; while ((m = re.exec(String(x))) && out.length < 5000) out.push(m[1]); return out; }
const xmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md5 = (t) => crypto.createHash('md5').update(t).digest('hex');
const looksMac = (v) => typeof v === 'string' && !!normMac(v);

// finds every object (at any depth) that satisfies test()
function findObjs(node, test, out, depth) {
  out = out || []; depth = depth || 0;
  if (!node || typeof node !== 'object' || depth > 8 || out.length > 6000) return out;
  if (!Array.isArray(node) && test(node)) out.push(node);
  (Array.isArray(node) ? node : Object.values(node)).forEach((v) => findObjs(v, test, out, depth + 1));
  return out;
}

// HTTP "digest" login (used by FRITZ!Box): answers the device's challenge, then reuses it
function digestClient(user, pass) {
  let ch = null, nc = 0;
  const parse = (h) => {
    const o = {};
    String(h || '').replace(/^Digest\s+/i, '').replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (m, k, a, b) => { o[k.toLowerCase()] = a !== undefined ? a : b; return ''; });
    return o;
  };
  const header = (method, uri) => {
    nc += 1;
    const ncs = ('00000000' + nc.toString(16)).slice(-8);
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(user + ':' + ch.realm + ':' + pass);
    const ha2 = md5(method + ':' + uri);
    const qop = ch.qop ? ch.qop.split(',')[0].trim() : '';
    const resp = qop ? md5([ha1, ch.nonce, ncs, cnonce, qop, ha2].join(':')) : md5([ha1, ch.nonce, ha2].join(':'));
    return 'Digest username="' + user + '", realm="' + ch.realm + '", nonce="' + ch.nonce + '", uri="' + uri + '", response="' + resp + '"' +
      (qop ? ', qop=' + qop + ', nc=' + ncs + ', cnonce="' + cnonce + '"' : '') + (ch.opaque ? ', opaque="' + ch.opaque + '"' : '') + ', algorithm=MD5';
  };
  return async (o) => {
    const method = o.method || (o.raw !== undefined || o.json !== undefined || o.form !== undefined ? 'POST' : 'GET');
    const go = () => httpRequest(Object.assign({}, o, { method: method, headers: Object.assign({}, o.headers || {}, ch ? { Authorization: header(method, o.path) } : {}) }));
    let r = await go();
    if (r.status === 401 && /^Digest/i.test(String(r.headers['www-authenticate'] || ''))) {
      ch = parse(r.headers['www-authenticate']);
      nc = 0;
      r = await go();
    }
    return r;
  };
}

// ---------- FRITZ!Box (TR-064) ----------
async function pollFritz(c) {
  const req = digestClient(c.username, c.password);
  const base = { host: c.host, port: c.port, https: c.https === true };
  const call = async (path, service, action, args) => {
    const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:' + action + ' xmlns:u="urn:dslforum-org:service:' + service + '">' +
      Object.keys(args || {}).map((k) => '<' + k + '>' + xmlEsc(args[k]) + '</' + k + '>').join('') + '</u:' + action + '></s:Body></s:Envelope>';
    const r = await req(Object.assign({ path: path, raw: body, contentType: 'text/xml; charset="utf-8"', headers: { SOAPAction: '"urn:dslforum-org:service:' + service + '#' + action + '"', Accept: 'text/xml' } }, base));
    if (r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
    if (r.status === 404) throw new ConnError('notfound', 'The FRITZ!Box TR-064 service');
    if (r.status === 500) {
      const code = xmlTag(r.text, 'errorCode');
      if (code === '606' || code === '401') throw new ConnError('auth', 'refused');
      throw new ConnError('bad', 'The FRITZ!Box said: ' + cleanText(xmlTag(r.text, 'errorDescription') || ('error ' + code), 80));
    }
    checkStatus(r, 'The FRITZ!Box');
    return r.text;
  };
  const info = await call('/upnp/control/deviceinfo', 'DeviceInfo:1', 'GetInfo', {});
  const countText = await call('/upnp/control/hosts', 'Hosts:1', 'GetHostNumberOfEntries', {});
  const total = Math.min(Number(xmlTag(countText, 'NewHostNumberOfEntries')) || 0, 400);
  const clients = [];
  for (let i = 0; i < total; i++) {
    const t = await call('/upnp/control/hosts', 'Hosts:1', 'GetGenericHostEntry', { NewIndex: i });
    const mac = normMac(xmlTag(t, 'NewMACAddress'));
    if (!mac || xmlTag(t, 'NewActive') !== '1') continue;
    const cl = newClient(mac);
    cl.ip = cleanIp(xmlTag(t, 'NewIPAddress'));
    cl.name = cleanText(xmlTag(t, 'NewHostName'), 60);
    const it = xmlTag(t, 'NewInterfaceType');
    if (/802\.11|wlan|wifi/i.test(it)) { cl.wireless = true; cl.via = 'Wi-Fi'; } else if (/ethernet/i.test(it)) { cl.wireless = false; cl.via = 'cable'; }
    cl.viaDeviceIp = c.host;
    cl.viaName = c.name || 'FRITZ!Box';
    if (cl.ip || cl.mac) clients.push(cl);
  }
  return { host: c.host, type: 'fritz', self: { name: c.name || '', brand: 'AVM', model: cleanText(xmlTag(info, 'NewModelName') || xmlTag(info, 'NewDescription'), 60), ports: null, descr: cleanText(xmlTag(info, 'NewSoftwareVersion'), 40), kind: 'router' }, clients: clients, gear: [] };
}

// ---------- Netgear (the router / AP SOAP interface: R6400, Nighthawk, Orbi, WAX, WAC ...) ----------
async function pollNetgear(c) {
  const base = { host: c.host, port: c.port, https: c.https === true };
  const call = async (service, action, params) => {
    const body = '<?xml version="1.0" encoding="utf-8" standalone="no"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      '<SOAP-ENV:Header><SessionID>A7D88AE69687E58D9A00</SessionID></SOAP-ENV:Header><SOAP-ENV:Body><M1:' + action + ' xmlns:M1="urn:NETGEAR-ROUTER:service:' + service + '">' +
      Object.keys(params || {}).map((k) => '<' + k + '>' + xmlEsc(params[k]) + '</' + k + '>').join('') + '</M1:' + action + '></SOAP-ENV:Body></SOAP-ENV:Envelope>';
    const r = await httpRequest(Object.assign({ path: '/soap/server_sa/', raw: body, contentType: 'text/xml;charset=utf-8', headers: { SOAPAction: 'urn:NETGEAR-ROUTER:service:' + service + '#' + action, 'User-Agent': 'SOAP Toolkit 3.0', Accept: '*/*' } }, base));
    if (r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
    if (r.status === 404) throw new ConnError('notfound', 'The Netgear SOAP interface');
    checkStatus(r, 'The Netgear device');
    const code = (/<ResponseCode>\s*(\d+)\s*<\/ResponseCode>/.exec(r.text) || [])[1] || '';
    return { text: r.text, code: code };
  };
  const svc = (x) => x;
  const login = await call(svc('ParentalControl:1'), 'Authenticate', { NewUsername: c.username || 'admin', NewPassword: c.password });
  if (login.code === '401' || login.code === '403') throw new ConnError('auth', 'refused');
  const clients = [];
  const add = (cl) => { if (cl && cl.mac) { cl.viaDeviceIp = c.host; cl.viaName = c.name || 'Netgear AP'; clients.push(cl); } };
  let gotList = false;
  const two = await call(svc('DeviceConfig:1'), 'GetAttachDevice2', {}).catch((e) => { if (e.kind === 'auth' || e.kind === 'refused' || e.kind === 'timeout') throw e; return null; });
  let devs = two && two.code !== '401' ? xmlAll(two.text, 'Device') : [];
  if (two && !devs.length) devs = xmlAll(xmlDecode(two.text), 'Device');
  devs.forEach((d) => {
    const mac = normMac(xmlTag(d, 'MAC'));
    if (!mac) return;
    const cl = newClient(mac);
    cl.ip = cleanIp(xmlTag(d, 'IP'));
    const nm = xmlTag(d, 'Name');
    cl.name = /^<?unknown>?$/i.test(nm) ? '' : cleanText(nm, 60);
    const ct = xmlTag(d, 'ConnectionType') || xmlTag(d, 'Connection') || '';
    const pct = Number(xmlTag(d, 'SignalStrength'));
    const ssid = cleanText(xmlTag(d, 'SSID'), 32);
    if (/^wired|^ethernet|^cable/i.test(ct)) {
      cl.wireless = false;
      cl.via = 'cable';
    } else if (ct || pct > 0 || ssid || /wireless|wifi|2\.4g|5g|6g/i.test(ct)) {
      cl.wireless = true;
      const bnd = bandName(ct + ' ' + xmlTag(d, 'Band') + ' ' + xmlTag(d, 'Radio') + ' ' + xmlTag(d, 'WiFiBand') + ' ' + xmlTag(d, 'Mode') + ' ' + xmlTag(d, 'PhyMode'));
      cl.via = 'Wi-Fi' + (bnd ? ' ' + bnd : (ct ? ' ' + cleanText(ct, 12) : '')) + (ssid ? ' ' + ssid : '') + (pct > 0 && pct <= 100 ? ' (' + Math.round(pct) + '%)' : '');
      cl.signal = pct > 0 && pct <= 100 ? Math.round(-100 + (pct * 0.5)) : sig(xmlTag(d, 'RSSI'));
      cl.speed = parseRate(xmlTag(d, 'LinkSpeed') || xmlTag(d, 'Speed'));
    }
    add(cl);
  });
  gotList = devs.length > 0;
  if (!gotList) {
    const one = await call(svc('DeviceInfo:1'), 'GetAttachDevice', {});
    if (one.code === '401') throw new ConnError('auth', 'refused');
    const raw = xmlTag(one.text, 'NewAttachDevice');
    const entries = raw.split('@');
    if (entries.length > 1 && /^\d+$/.test(entries[0].trim())) entries.shift();
    entries.slice(0, 1000).forEach((e) => {
      const f = e.split(';');
      if (f.length < 4) return;
      const mac = normMac(f[3].trim());
      if (!mac) return;
      const cl = newClient(mac);
      cl.ip = cleanIp(f[1].trim());
      cl.name = /^<unknown>$/i.test(f[2].trim()) ? '' : cleanText(f[2], 60);
      const ct = (f[4] || '').trim();
      if (/^wired|^ethernet|^cable/i.test(ct)) {
        cl.wireless = false;
        cl.via = 'cable';
      } else if (/wireless|wifi|ghz|2\.4|^5g|^6g/i.test(ct) || ct !== '') {
        cl.wireless = true;
        cl.via = 'Wi-Fi' + (bandName(ct) ? ' ' + bandName(ct) : (ct ? ' ' + cleanText(ct, 16) : ''));
      }
      add(cl);
    });
  }
  const gi = await call(svc('DeviceInfo:1'), 'GetInfo', {}).catch((e) => { if (e.kind === 'auth' || e.kind === 'refused' || e.kind === 'timeout') throw e; return null; });
  const model = gi ? cleanText(xmlTag(gi.text, 'ModelName'), 60) : '';
  const isAp = (c.name && /ap|access point|extender|satellite/i.test(c.name)) || /ap|wax|wac|eax|ex\d/i.test(model);
  const netgearName = c.name || (isAp ? 'Netgear AP' : 'Netgear');
  return { host: c.host, type: 'netgear', self: { name: netgearName, brand: 'Netgear', model: model, ports: null, descr: gi ? cleanText(xmlTag(gi.text, 'Firmwareversion'), 40) : '', kind: isAp ? 'ap' : 'router' }, clients: clients, gear: [] };
}

// ---------- TP-Link Omada controller (software controller, OC200 / OC300 ...) ----------
async function pollOmada(c) {
  const base = { host: c.host, port: c.port, https: c.https !== false };
  const info = await httpRequest(Object.assign({ path: '/api/info' }, base));
  let prefix = '';
  if (info.status === 200) { const j = parseJson(info, 'Omada'); prefix = j.result && j.result.omadacId ? '/' + cleanText(j.result.omadacId, 64).replace(/[^A-Za-z0-9]/g, '') : ''; }
  else if (info.status !== 404) checkStatus(info, 'The Omada controller');
  const lr = await httpRequest(Object.assign({ path: prefix + '/api/v2/login', json: { username: c.username, password: c.password } }, base));
  checkStatus(lr, 'The Omada login');
  const lj = parseJson(lr, 'Omada');
  if (lj.errorCode !== 0 || !lj.result || !lj.result.token) throw new ConnError('auth', 'refused');
  const token = encodeURIComponent(lj.result.token);
  const cookies = [].concat(lr.headers['set-cookie'] || []).map((x) => x.split(';')[0]).join('; ');
  const headers = { 'Csrf-Token': lj.result.token };
  if (cookies) headers.Cookie = cookies;
  const get = async (path) => {
    const r = await httpRequest(Object.assign({ path: prefix + '/api/v2' + path + (path.includes('?') ? '&' : '?') + 'token=' + token, headers: headers }, base));
    checkStatus(r, 'Omada');
    const j = parseJson(r, 'Omada');
    if (j.errorCode !== 0) throw new ConnError(j.errorCode === -1200 || j.errorCode === -1005 ? 'auth' : 'bad', 'Omada said: ' + cleanText(j.msg || ('error ' + j.errorCode), 80));
    return j.result;
  };
  const sitesRes = await get('/sites?currentPage=1&currentPageSize=100');
  let sites = (sitesRes && Array.isArray(sitesRes.data) ? sitesRes.data : []).filter((s) => s && s.id);
  if (c.site) { const want = sites.filter((s) => s.name === c.site || s.id === c.site); if (!want.length) throw new ConnError('notfound', 'The Omada site "' + c.site + '"'); sites = want; }
  const clients = [], gear = [];
  for (const site of sites.slice(0, 10)) {
    const sid = encodeURIComponent(site.id);
    const cr = await get('/sites/' + sid + '/clients?currentPage=1&currentPageSize=500&filters.active=true');
    (cr && Array.isArray(cr.data) ? cr.data : []).slice(0, 1500).forEach((x) => {
      const mac = normMac(x.mac);
      if (!mac) return;
      const cl = newClient(mac);
      cl.ip = cleanIp(x.ip);
      cl.name = cleanText(x.name || x.hostName || '', 60);
      if (x.wireless === true) {
        cl.wireless = true;
        cl.signal = sig(x.rssi !== undefined ? x.rssi : x.signalLevel);
        cl.viaApMac = normMac(x.apMac);
        cl.viaName = cleanText(x.apName || '', 40);
        const ob = bandName(x.wifiMode || x.band || '') || ({ 0: '2.4 GHz', 1: '5 GHz', 2: '5 GHz', 3: '6 GHz' })[x.radioId] || '';
        cl.via = ['Wi-Fi' + (ob ? ' ' + ob : ''), x.ssid ? cleanText(x.ssid, 32) : '', x.apName ? 'on ' + cleanText(x.apName, 40) : ''].filter(Boolean).join(' · ');
      } else if (x.wireless === false) {
        cl.wireless = false;
        cl.viaSwMac = normMac(x.switchMac);
        cl.viaName = cleanText(x.switchName || '', 40);
        cl.viaPort = cleanText(x.port, 6);
        cl.via = x.switchName ? cleanText(x.switchName, 40) + (x.port ? ', port ' + cleanText(x.port, 6) : '') : (x.port ? 'port ' + cleanText(x.port, 6) : '');
      }
      if (cl.ip) clients.push(cl);
    });
    const dr = await get('/sites/' + sid + '/devices').catch((e) => { if (e.kind === 'auth') throw e; return null; });
    (Array.isArray(dr) ? dr : (dr && Array.isArray(dr.data) ? dr.data : [])).slice(0, 300).forEach((d) => {
      const mac = normMac(d.mac);
      if (!mac) return;
      gear.push({ mac: mac, ip: cleanIp(d.ip), name: cleanText(d.name || '', 60), brand: 'TP-Link Omada', model: cleanText(d.showModel || d.model || '', 60), kind: ({ ap: 'ap', switch: 'switch', gateway: 'router' })[String(d.type).toLowerCase()] || 'other', ports: null });
    });
  }
  return { host: c.host, self: null, clients: clients, gear: gear };
}

// ---------- Cisco Meraki (cloud dashboard: needs the internet and an API key) ----------
const MERAKI = { host: 'api.meraki.com', port: 443, https: true };
async function pollMeraki(c) {
  const target = Object.assign({}, MERAKI, TEST_HOOKS.meraki || {});
  const get = async (path) => {
    let host = target.host, port = target.port, https = target.https;
    for (let hop = 0; hop < 4; hop++) {
      const r = await httpRequest({ host: host, port: port, https: https, path: path, headers: { Authorization: 'Bearer ' + c.password, 'X-Cisco-Meraki-API-Key': c.password } });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        let u;
        try { u = new URL(r.headers.location, (https ? 'https://' : 'http://') + host + ':' + port); } catch (e) { throw new ConnError('bad', 'Meraki sent a strange redirect.'); }
        if (!TEST_HOOKS.meraki && !/\.meraki\.com$/i.test(u.hostname)) throw new ConnError('bad', 'Meraki redirected somewhere unexpected.');
        host = u.hostname; port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80); https = u.protocol === 'https:'; path = u.pathname + u.search;
        continue;
      }
      if (r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
      if (r.status === 429) throw new ConnError('bad', 'Meraki says "too many requests" (its limit is about 10 per second). Wait a minute and try again.');
      if (r.status === 404) throw new ConnError('notfound', 'That Meraki item');
      if (r.status === 400) return null;                         // e.g. a network without Wi-Fi gear
      checkStatus(r, 'Meraki');
      return parseJson(r, 'Meraki');
    }
    throw new ConnError('bad', 'Meraki redirected too many times.');
  };
  const orgs = await get('/api/v1/organizations');
  if (!Array.isArray(orgs) || !orgs.length) throw new ConnError('notfound', 'A Meraki organization for this API key');
  const clients = [], gear = [];
  for (const org of orgs.slice(0, 3)) {
    const oid = encodeURIComponent(org.id);
    let nets = await get('/api/v1/organizations/' + oid + '/networks') || [];
    if (c.site) { nets = nets.filter((n) => n.name === c.site || n.id === c.site); if (!nets.length && orgs.length === 1) throw new ConnError('notfound', 'The Meraki network "' + c.site + '"'); }
    for (const n of nets.slice(0, 15)) {
      const list = await get('/api/v1/networks/' + encodeURIComponent(n.id) + '/clients?timespan=3600&perPage=1000');
      (Array.isArray(list) ? list : []).slice(0, 2000).forEach((x) => {
        const mac = normMac(x.mac);
        if (!mac || String(x.status).toLowerCase() === 'offline') return;
        const cl = newClient(mac);
        cl.ip = cleanIp(x.ip);
        cl.name = cleanText(x.description || x.dhcpHostname || '', 60);
        const dev = cleanText(x.recentDeviceName || '', 40);
        if (x.ssid) { cl.wireless = true; cl.via = ['Wi-Fi', cleanText(x.ssid, 32), dev ? 'on ' + dev : ''].filter(Boolean).join(' · '); }
        else if (x.switchport) { cl.wireless = false; cl.via = (dev || 'switch') + ', port ' + cleanText(x.switchport, 8); }
        if (cl.ip) clients.push(cl);
      });
    }
    const devs = await get('/api/v1/organizations/' + oid + '/devices?perPage=1000') || [];
    (Array.isArray(devs) ? devs : []).slice(0, 500).forEach((d) => {
      const mac = normMac(d.mac);
      if (!mac) return;
      const model = cleanText(d.model || '', 40);
      const kind = /^MR|^CW/i.test(model) ? 'ap' : /^MS/i.test(model) ? 'switch' : /^MX|^Z/i.test(model) ? 'router' : 'other';
      const pm = /^MS\d+-(\d+)/i.exec(model);
      gear.push({ mac: mac, ip: cleanIp(d.lanIp), name: cleanText(d.name || '', 60), brand: 'Cisco Meraki', model: model, kind: kind, ports: pm ? Number(pm[1]) : null });
    });
  }
  return { host: c.host, self: null, clients: clients, gear: gear };
}

// ---------- Cisco IOS XE (RESTCONF) ----------
async function pollCisco(c) {
  const base = { host: c.host, port: c.port, https: c.https !== false, auth: c.username + ':' + c.password, headers: { Accept: 'application/yang-data+json' } };
  const get = async (path, optional) => {
    const r = await httpRequest(Object.assign({ path: '/restconf/data/' + path }, base));
    if (r.status === 404 || r.status === 204 || (optional && r.status === 400)) { if (optional) return null; throw new ConnError('notfound', 'RESTCONF on the switch'); }
    checkStatus(r, 'RESTCONF on the switch');
    return parseJson(r, 'The switch');
  };
  const first = (j) => (j && typeof j === 'object' ? Object.values(j)[0] : undefined);
  const hostname = first(await get('Cisco-IOS-XE-native:native/hostname', true));
  const inv = findObjs(await get('Cisco-IOS-XE-device-hardware-oper:device-hardware-data/device-hardware/device-inventory', true), (o) => 'hw-type' in o);
  const chassis = inv.find((o) => /chassis/i.test(o['hw-type'])) || inv[0] || {};
  const ifs = findObjs(await get('ietf-interfaces:interfaces/interface', true), (o) => typeof o.name === 'string');
  const ports = ifs.filter((i) => /^(Gigabit|FastEthernet|TenGigabit|TwoGigabit|TwoFiveGigabit|FiveGigabit|TwentyFiveGigE|FortyGigabit|HundredGig|Ethernet)/i.test(i.name) && !/\.\d+$/.test(i.name)).length;
  const by = new Map();
  const touch = (mac) => { if (!by.has(mac)) by.set(mac, newClient(mac)); return by.get(mac); };
  const arp = await get('Cisco-IOS-XE-arp-oper:arp-data', true);
  findObjs(arp, (o) => typeof o.address === 'string' && typeof o.hardware === 'string').slice(0, 3000).forEach((a) => {
    const mac = normMac(a.hardware);
    const ip = cleanIp(a.address);
    if (mac && ip) touch(mac).ip = ip;
  });
  const matm = await get('Cisco-IOS-XE-matm-oper:matm-oper-data', true);
  const seen = new Map();
  findObjs(matm, (o) => looksMac(o.mac) && typeof o.port === 'string').slice(0, 5000).forEach((e) => { seen.set(normMac(e.mac), cleanText(e.port, 30)); });
  const perPort = {};
  seen.forEach((p) => { perPort[p] = (perPort[p] || 0) + 1; });
  seen.forEach((p, mac) => {
    const cl = touch(mac);
    cl.wireless = false;
    cl.port = p;
    cl.viaPort = p;
    cl.via = 'switch port ' + p + (perPort[p] >= 4 ? ' (shared port, toward other switches)' : '');
  });
  const out = [];
  by.forEach((cl, mac) => {
    const p = seen.get(mac) || cl.port;
    if (p) { cl.wireless = false; cl.port = p; cl.viaPort = p; if (!cl.via) cl.via = 'switch port ' + p + (perPort[p] >= 4 ? ' (shared port, toward other switches)' : ''); }
    if (cl.ip || cl.mac) out.push(cl);
  });
  return { host: c.host, self: { name: cleanText(hostname || '', 60), brand: 'Cisco', model: cleanText(chassis['part-number'] || chassis['hw-description'] || '', 60), ports: ports || null, descr: '', kind: seen.size ? 'switch' : 'router' }, clients: out, gear: [] };
}

// ---------- Aruba CX (REST API) ----------
async function pollArubaCx(c) {
  const base = { host: c.host, port: c.port, https: c.https !== false };
  let prefix = '', cookie = '';
  for (const p of ['/rest/v10.09', '/rest/v10.08', '/rest/v10.04', '/rest/v1']) {
    const r = await httpRequest(Object.assign({ path: p + '/login', form: 'username=' + encodeURIComponent(c.username) + '&password=' + encodeURIComponent(c.password) }, base));
    if (r.status === 404) continue;
    if (r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
    if (r.status === 400) { prefix = p; continue; }
    checkStatus(r, 'The Aruba CX login');
    cookie = [].concat(r.headers['set-cookie'] || []).map((x) => x.split(';')[0]).join('; ');
    prefix = p;
    break;
  }
  if (!prefix) throw new ConnError('notfound', 'The Aruba CX REST interface');
  if (!cookie) throw new ConnError('auth', 'refused');
  const headers = { Cookie: cookie };
  const get = async (path, optional) => {
    const r = await httpRequest(Object.assign({ path: prefix + path, headers: headers }, base));
    if (optional && (r.status === 404 || r.status === 400)) return null;
    checkStatus(r, 'The Aruba CX switch');
    return parseJson(r, 'The switch');
  };
  try {
    const sys = await get('/system?attributes=hostname,platform_name,product_info,software_version', true) || {};
    const ifs = await get('/system/interfaces', true);
    const names = ifs && typeof ifs === 'object' ? (Array.isArray(ifs) ? ifs : Object.keys(ifs)).map((k) => { try { return decodeURIComponent(String(k)); } catch (e) { return String(k); } }) : [];
    const ports = names.filter((n) => /^\d+\/\d+\/\d+$/.test(n)).length;
    const by = new Map();
    const touch = (mac) => { if (!by.has(mac)) by.set(mac, newClient(mac)); return by.get(mac); };
    const nb = await get('/system/vrfs/default/neighbors?depth=2', true);
    findObjs(nb, (o) => typeof o.ip_address === 'string' && looksMac(o.mac)).slice(0, 3000).forEach((n) => {
      const ip = cleanIp(n.ip_address);
      const mac = normMac(n.mac);
      if (mac && ip) touch(mac).ip = ip;
    });
    const seen = new Map();
    const vl = await get('/system/vlans', true);
    const vids = vl && typeof vl === 'object' ? (Array.isArray(vl) ? vl : Object.keys(vl)).map((k) => String(k).split('/').pop()).filter((k) => /^\d{1,4}$/.test(k)).slice(0, 60) : [];
    for (const vid of vids) {
      const m = await get('/system/vlans/' + vid + '/macs?depth=2', true);
      findObjs(m, (o) => looksMac(o.mac_addr)).slice(0, 3000).forEach((e) => {
        let port = '';
        if (e.port && typeof e.port === 'object') port = decodeURIComponent(String(Object.keys(e.port)[0] || '').split('/rest/').pop().split('/ports/').pop());
        else if (typeof e.port === 'string') port = decodeURIComponent(e.port.split('/').slice(-3).join('/'));
        const mac = normMac(e.mac_addr);
        if (mac && port) seen.set(mac, cleanText(port, 20));
      });
    }
    const perPort = {};
    seen.forEach((p) => { perPort[p] = (perPort[p] || 0) + 1; });
    seen.forEach((port, mac) => {
      const cl = touch(mac);
      cl.wireless = false;
      cl.port = port;
      cl.viaPort = port;
      cl.via = 'switch port ' + port + (perPort[port] >= 4 ? ' (shared port, toward other switches)' : '');
    });
    const out = [];
    by.forEach((cl, mac) => {
      const p = seen.get(mac) || cl.port;
      if (p) { cl.wireless = false; cl.port = p; cl.viaPort = p; if (!cl.via) cl.via = 'switch port ' + p + (perPort[p] >= 4 ? ' (shared port, toward other switches)' : ''); }
      if (cl.ip || cl.mac) out.push(cl);
    });
    const pi = sys.product_info && typeof sys.product_info === 'object' ? sys.product_info : {};
    return { host: c.host, self: { name: cleanText(sys.hostname || '', 60), brand: 'HPE / Aruba', model: cleanText(sys.platform_name || pi.product_name || '', 60), ports: ports || null, descr: cleanText(sys.software_version || '', 40), kind: seen.size ? 'switch' : 'router' }, clients: out, gear: [] };
  } finally {
    httpRequest(Object.assign({ path: prefix + '/logout', method: 'POST', headers: headers, timeout: 3000 }, base)).catch(() => {});
  }
}

// ---------- settings and messages ----------
function cleanConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const type = String(o.type || '');
  if (!TYPES[type]) throw new Error('Choose what kind of device this is.');
  const host = type === 'meraki' ? MERAKI.host : String(o.host || '').trim();
  if (type !== 'meraki' && !isPrivateIp(host)) throw new Error('Type the device\'s address on your own network, like 192.168.0.2. (Only addresses inside your own network are allowed.)');
  const def = TYPES[type].defaults;
  let port = def.port;
  if (o.port !== undefined && o.port !== null && String(o.port).trim() !== '') {
    port = Number(o.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port must be a whole number from 1 to 65535.');
  }
  return {
    id: typeof o.id === 'string' && /^[a-z0-9]{1,24}$/.test(o.id) ? o.id : undefined,
    type: type,
    name: cleanText(o.name || '', 60),
    host: host,
    port: port,
    https: (type === 'snmp' || type === 'hpe' || type === 'ssh') ? false : (o.https === undefined ? !!def.https : o.https === true || o.https === 'true'),
    username: String(o.username || '').slice(0, 100),
    password: String(o.password || '').slice(0, 200),
    site: /^[A-Za-z0-9_. -]{1,40}$/.test(String(o.site || '')) ? String(o.site).trim() : '',
    snmpVersion: (type === 'snmp' || type === 'hpe') ? (Number(o.snmpVersion) === 1 ? 1 : Number(o.snmpVersion) === 3 ? 3 : 2) : 2,
    authProto: ['md5', 'sha', 'sha256', 'none'].includes(o.authProto) ? o.authProto : 'sha',
    privProto: ['aes', 'des', 'none'].includes(o.privProto) ? o.privProto : 'aes',
    secret2: String(o.secret2 || '').slice(0, 200)
  };
}
// extra rules that depend on the kind of device (called after the saved password has been filled in)
function checkLogin(c) {
  if (c.type === 'ssh') {
    if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/.test(c.username)) return 'Type the SSH user name (letters, numbers and . _ @ - only).';
    const k = String(c.site || 'linux').toLowerCase();
    if (!sshpoll.PROFILES[k]) return 'The device kind must be one of: ' + Object.keys(sshpoll.PROFILES).join(', ') + '.';
  }
  if ((c.type === 'snmp' || c.type === 'hpe') && c.snmpVersion === 3) {
    if (!c.username) return 'SNMP version 3 needs the user name set in the device.';
    if (c.authProto !== 'none' && c.password.length < 8) return 'The authentication password of SNMP version 3 is at least 8 characters long.';
    if (c.authProto === 'none' && c.privProto !== 'none') return 'Privacy (encryption) needs authentication too. Choose an authentication type, or switch privacy off.';
    if (c.privProto !== 'none' && c.secret2.length < 8) return 'The privacy password of SNMP version 3 is at least 8 characters long.';
  }
  return '';
}

function explain(type, e) {
  const t = TYPES[type];
  const kind = e && e.kind ? e.kind : 'bad';
  if (kind === 'refused') return { code: 'refused', error: 'Nothing answered at that address and port. Check the address and port, and that the service is switched on' + (type === 'ssh' ? ' (SSH must be switched on in the device, usually on port 22)' : type === 'mikrotik' ? ' (RouterOS 7: IP > Services > www-ssl or www)' : type === 'unifi' ? ' (UniFi OS consoles use port 443, classic controllers 8443)' : type === 'netgear' ? ' (Netgear routers usually answer on port 5000, or 443 with https)' : type === 'fritz' ? ' (FRITZ!Box: port 49000, or 49443 with https, and "access for applications" must be allowed)' : type === 'omada' ? ' (Omada: port 8043 for the software controller, 443 for an OC200)' : type === 'cisco' ? ' (Cisco: "restconf" and "ip http secure-server" must be switched on)' : type === 'arubacx' ? ' (Aruba CX: the REST API must be switched on for the management VRF)' : type === 'meraki' ? ' (Meraki needs an internet connection)' : '') + '.' };
  if (kind === 'timeout') {
    return { code: 'timeout', error: (type === 'snmp' || type === 'hpe')
      ? 'No answer. SNMP must be switched on in the device (version 1, 2c or 3, read-only), the community name must be right ("public" is the usual default), and this computer must be allowed to reach it.'
      : 'No answer from the device. Check the address and port, and that this computer can reach it.' };
  }
  if (kind === 'auth') {
    if (e.message && /^v3: /.test(e.message)) return { code: 'auth', error: e.message.slice(4) };
    return { code: 'auth', error: (type === 'snmp' || type === 'hpe') ? 'The device answered, but not to this community name. Check the community name (it is case sensitive).'
      : type === 'ssh' ? 'The SSH login was refused. Check the user name and password. With an empty password the login uses your SSH key, so the key must be set up on this computer (ssh-agent or a default key in your .ssh folder) and allowed on the device.'
      : type === 'opnsense' ? 'The API key or secret was refused. Create an API key under System > Access > Users and type the key as the user name and the secret as the password.'
      : type === 'unifi' ? 'The user name or password was refused. Use a local UniFi account (a read-only one is enough), not your ubiquiti.com login.'
      : 'The user name or password was refused. Check them, and that this account may log in to the device\'s web page.' };
  }
  if (kind === 'notfound') {
    const what = e.message || 'That address';
    return { code: 'notfound', error: what + ' was not found on the device. ' + (type === 'unifi' ? 'Check the site name (the usual one is "default").' : type === 'mikrotik' ? 'The REST API needs RouterOS 7.1 or newer.' : type === 'openwrt' ? 'Install the "uhttpd-mod-ubus" package on the router.' : 'Check the address and port.') };
  }
  if (e && e.message === 'tls') return { code: 'bad', error: 'The device did not speak the secure (https) protocol on that port. Try again with "Use https" ' + ((type === 'snmp' || type === 'hpe') ? '' : 'switched the other way') + ', or another port.' };
  return { code: 'bad', error: (e && e.message && !/^(refused|no answer)$/.test(e.message) ? e.message : 'The device gave an answer that could not be understood.') + (t ? '' : '') };
}


// ---------- live traffic counters (for the Bandwidth Monitor) ----------
// Returns running byte totals; the screen turns two readings into a speed. Nothing here guesses: a device that does not report
// counters simply answers with an error.
const IF_UP = 1;
const IF_SKIP_TYPES = new Set([24, 53, 131, 135, 136, 161]);      // loopback, virtual, tunnel, VLAN sub-interfaces, link aggregation members shown elsewhere
function hexNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /^0x([0-9a-f]{1,16})$/i.exec(String(v || '').trim());
  if (m) return parseInt(m[1], 16);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
async function countersSnmp(c) {
  const v3 = c.snmpVersion === 3;
  const s = new SNMP.Session({ host: c.host, port: c.port, community: c.password || 'public', version: c.snmpVersion === 1 ? 1 : v3 ? 3 : 2, deadline: Date.now() + 15000,
    user: c.username, authProto: c.authProto === 'none' ? '' : c.authProto, authPass: c.authProto === 'none' ? '' : c.password, privProto: c.privProto === 'none' ? '' : c.privProto, privPass: c.privProto === 'none' ? '' : c.secret2 });
  try {
    if (v3) await s.discover();
    const idx = (v, base) => v.oid.slice(base.length + 1);
    const types = {}, status = {}, names = {}, speed = {}, rx = {}, tx = {};
    for (const v of await s.walk(OID.ifType, 2000)) types[idx(v, OID.ifType)] = v.value;
    for (const v of await s.walk(OID_IF.status, 2000)) status[idx(v, OID_IF.status)] = v.value;
    let nb = OID.ifName, nw = await s.walk(OID.ifName, 2000);
    if (!nw.length) { nb = OID.ifDescr; nw = await s.walk(OID.ifDescr, 2000); }
    nw.forEach((v) => { if (v.type === 'str') names[idx(v, nb)] = cleanText(v.value.toString('utf8'), 30); });
    for (const v of await s.walk(OID.ifSpeed, 2000)) { const n = Number(v.value); if (Number.isFinite(n) && n > 0 && n < 4294967295) speed[idx(v, OID.ifSpeed)] = n / 1e6; }
    try { for (const v of await s.walk(OID.ifHighSpeed, 2000)) { const n = Number(v.value); if (Number.isFinite(n) && n > 0) speed[idx(v, OID.ifHighSpeed)] = n; } } catch (e) { /* older device */ }
    // 64-bit counters when the device has them (needed above about 100 Mbps), else the 32-bit ones
    let hc = true;
    for (const v of await s.walk(OID_IF.hcIn, 2000)) rx[idx(v, OID_IF.hcIn)] = Number(v.value);
    for (const v of await s.walk(OID_IF.hcOut, 2000)) tx[idx(v, OID_IF.hcOut)] = Number(v.value);
    if (!Object.keys(rx).length) {
      hc = false;
      for (const v of await s.walk(OID_IF.in32, 2000)) rx[idx(v, OID_IF.in32)] = Number(v.value);
      for (const v of await s.walk(OID_IF.out32, 2000)) tx[idx(v, OID_IF.out32)] = Number(v.value);
    }
    if (!Object.keys(rx).length) throw new ConnError('bad', 'This device does not share traffic counters over SNMP.');
    const ports = [];
    Object.keys(rx).forEach((k) => {
      if (IF_SKIP_TYPES.has(Number(types[k]))) return;
      if (Number(status[k]) !== IF_UP) return;
      if (!Number.isFinite(rx[k]) || !Number.isFinite(tx[k])) return;
      ports.push({ name: names[k] || 'port ' + k, rx: rx[k], tx: tx[k], speed: speed[k] ? mbps(speed[k]) : null, bits: hc ? 64 : 32 });
    });
    return { kind: 'snmp', ports: ports.slice(0, 96) };
  } finally { try { s.close(); } catch (e) { /* closed */ } }
}
const OID_IF = { status: '1.3.6.1.2.1.2.2.1.8', in32: '1.3.6.1.2.1.2.2.1.10', out32: '1.3.6.1.2.1.2.2.1.16', hcIn: '1.3.6.1.2.1.31.1.1.1.6', hcOut: '1.3.6.1.2.1.31.1.1.1.10' };
const asusTokens = new Map();      // host:port -> { token, at } so the router is not logged in to every few seconds
async function countersAsus(c) {
  const base = { host: c.host, port: c.port, https: c.https === true };
  const ua = { 'User-Agent': 'asusrouter-Android-DUTUtil-1.0.0.3.58-163', Referer: (base.https ? 'https' : 'http') + '://' + c.host + '/Main_Login.asp' };
  const id = c.host + ':' + c.port + ':' + c.username;
  const ask = async (token) => httpRequest(Object.assign({ path: '/appGet.cgi?hook=netdev(appobj)', headers: Object.assign({ Cookie: 'asus_token=' + token }, ua) }, base));
  let cached = asusTokens.get(id);
  let g = null;
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) { try { g = await ask(cached.token); if (g.status >= 400 || !/netdev/.test(g.text || '')) g = null; } catch (e) { g = null; } }
  if (!g) {
    const auth = Buffer.from(c.username + ':' + c.password).toString('base64');
    const r = await httpRequest(Object.assign({ path: '/login.cgi', headers: ua, form: 'login_authorization=' + encodeURIComponent(auth) }, base));
    checkStatus(r, 'The ASUS login page');
    const j = parseJson(r, 'The ASUS router');
    if (!j.asus_token) throw new ConnError('auth', 'refused');
    asusTokens.set(id, { token: j.asus_token, at: Date.now() });
    g = await ask(j.asus_token);
  }
  checkStatus(g, 'The ASUS traffic counters');
  const nd = parseJson(g, 'The ASUS router').netdev;
  if (!nd || typeof nd !== 'object') throw new ConnError('bad', 'This router does not share its traffic counters.');
  const part = (p) => { const rx = hexNum(nd[p + '_rx']), tx = hexNum(nd[p + '_tx']); return rx === null || tx === null ? null : { rx: rx, tx: tx, bits: 32 }; };
  const wan = part('INTERNET');
  if (!wan) throw new ConnError('bad', 'This router does not share its traffic counters.');
  return { kind: 'asus', wan: wan, wired: part('WIRED'), wireless: [part('WIRELESS0'), part('WIRELESS1'), part('WIRELESS2')].filter(Boolean) };
}
async function counters(config) {
  let c;
  try { c = cleanConfig(config); const bad = checkLogin(c); if (bad) throw new Error(bad); } catch (e) { return { ok: false, code: 'config', error: e.message }; }
  if ((c.type === 'snmp' || c.type === 'hpe') && !POLICY.snmpEnabled) return SNMP_OFF;
  const run = { snmp: countersSnmp, hpe: countersSnmp, asus: countersAsus }[c.type];
  if (!run) return { ok: false, code: 'unsupported', error: 'This kind of device does not share live traffic numbers with Dashboard Hub yet.' };
  try { return Object.assign({ ok: true }, await run(c)); }
  catch (e) { const x = explain(c.type, e); return { ok: false, code: x.code, error: x.error }; }
}

// ---------- SNMP finder: does this machine answer SNMP, and with which community name? ----------
// A device with the wrong community name stays silent, exactly like one with SNMP switched off, so the two cannot be told apart.
async function snmpProbe(host, communities, port) {
  if (!POLICY.snmpEnabled) return { ok: false };
  if (!isPrivateIp(host)) return { ok: false, error: 'Only addresses inside your own network are allowed.' };
  const tries = [];
  [2, 1].forEach((v) => communities.forEach((cm) => tries.push({ v: v, cm: cm })));
  for (const t of tries) {
    const s = new SNMP.Session({ host: host, port: port || 161, community: t.cm, version: t.v, timeout: 1000, retries: 0, deadline: Date.now() + 2500 });
    try {
      const vbs = await s.get([OID.sysDescr, OID.sysObjectID, OID.sysName]);
      const by = {};
      vbs.forEach((v) => { by[v.oid] = v; });
      const str = (o) => (by[o] && by[o].type === 'str' ? cleanText(by[o].value.toString('utf8'), 200) : '');
      const descr = str(OID.sysDescr), name = str(OID.sysName);
      const oidv = by[OID.sysObjectID] && by[OID.sysObjectID].type === 'oid' ? by[OID.sysObjectID].value : '';
      if (!descr && !name && !oidv) continue;
      const em = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(oidv);
      let brand = em && ENTERPRISES[em[1]] ? ENTERPRISES[em[1]] : '';
      if (!brand || /Net-SNMP/.test(brand)) { const hit = BRAND_WORDS.find((b) => b[0].test(descr + ' ' + name)); if (hit) brand = hit[1]; }
      return { ok: true, ip: host, community: t.cm, version: t.v, name: name, descr: descr.split(/[\r\n,]/)[0].slice(0, 80), brand: brand };
    } catch (e) { /* no answer with this name: try the next */ } finally { s.close(); }
  }
  return { ok: false, ip: host };
}

// ---------- ask one device ----------
// Switches from the Security settings window
const POLICY = { snmpV3Only: false, meraki: true, snmpEnabled: true };
function setPolicy(p) { POLICY.snmpV3Only = !!(p && p.snmpV3Only); POLICY.meraki = !(p && p.meraki === false); POLICY.snmpEnabled = !(p && p.snmpEnabled === false); }
const SNMP_OFF = { ok: false, code: 'blocked', error: 'SNMP is turned off in the Security settings (Finding machines). Use another connection type, or turn SNMP back on there.' };
async function poll(config) {
  let c;
  try { c = cleanConfig(config); const bad = checkLogin(c); if (bad) throw new Error(bad); } catch (e) { return { ok: false, code: 'config', error: e.message }; }
  if (c.type === 'meraki' && !POLICY.meraki) return { ok: false, code: 'blocked', error: 'Cisco Meraki is turned off in the Security settings (it needs an internet connection).' };
  if ((c.type === 'snmp' || c.type === 'hpe') && !POLICY.snmpEnabled) return SNMP_OFF;
  if ((c.type === 'snmp' || c.type === 'hpe') && POLICY.snmpV3Only && c.snmpVersion !== 3) return { ok: false, code: 'blocked', error: 'This connection uses SNMP version 1 or 2c, which the Security settings do not allow. Change it to version 3, or turn "SNMP version 3 only" off.' };
  const run = { snmp: pollSnmp, hpe: pollSnmp, unifi: pollUnifi, openwrt: pollOpenwrt, mikrotik: pollMikrotik, opnsense: pollOpnsense, asus: pollAsus, netgear: pollNetgear, fritz: pollFritz, omada: pollOmada, meraki: pollMeraki, cisco: pollCisco, arubacx: pollArubaCx, ssh: pollSsh }[c.type];
  try {
    const data = await run(c);
    const out = { ok: true, host: c.host, type: c.type, self: data.self || null, clients: data.clients || [], gear: data.gear || [], note: data.note || '' };
    if (!out.clients.length && !out.gear.length && !out.note) out.note = 'The device answered, but it listed no machines. It may not keep such a list (for example a switch in access-point or bridge mode), or this firmware may name things differently.';
    return out;
  } catch (e) {
    const x = explain(c.type, e);
    return { ok: false, code: x.code, error: x.error };
  }
}

module.exports = { sshpoll, setPolicy, snmpProbe, counters, hexNum, httpRequest, ConnError, bandName, freqBand, parseRate, mbps, TEST_HOOKS, poll, cleanConfig, checkLogin, TYPES, SNMP, isPrivateIp, normMac };
