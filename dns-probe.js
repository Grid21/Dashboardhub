'use strict';
// Finds out whether a machine on your own network is a DNS server, by asking it a harmless question over the normal DNS port (53).
// The questions are about names the machine answers by itself ("localhost", its software version), so nothing is sent out to the internet.
const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');

function buildQuery(id, name, qtype, qclass) {
  const labels = String(name).split('.').filter(Boolean);
  const parts = [Buffer.from([id >> 8, id & 255, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])];     // recursion desired, one question
  labels.forEach((l) => { const b = Buffer.from(l, 'ascii'); parts.push(Buffer.from([b.length]), b); });
  parts.push(Buffer.from([0, qtype >> 8, qtype & 255, qclass >> 8, qclass & 255]));
  return Buffer.concat(parts);
}

function skipName(buf, pos) {
  for (let guard = 0; pos < buf.length && guard < 64; guard++) {
    const len = buf[pos];
    if (len === 0) return pos + 1;
    if ((len & 0xc0) === 0xc0) return pos + 2;
    pos += 1 + len;
  }
  return -1;
}

// returns { rcode, ra, answers, text } or null when nothing (valid) came back
function parseReply(buf, id) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (((buf[0] << 8) | buf[1]) !== id) return null;
  const flags = (buf[2] << 8) | buf[3];
  if (!(flags & 0x8000)) return null;                          // must be an answer, not a question
  const out = { rcode: flags & 0x0f, ra: !!(flags & 0x0080), answers: (buf[6] << 8) | buf[7], text: '', addr: '' };
  try {
    let pos = 12;
    for (let q = (buf[4] << 8) | buf[5]; q > 0; q--) { pos = skipName(buf, pos); if (pos < 0) return out; pos += 4; }
    if (out.answers > 0) {
      pos = skipName(buf, pos); if (pos < 0) return out;
      const type = (buf[pos] << 8) | buf[pos + 1]; const rdlen = (buf[pos + 8] << 8) | buf[pos + 9]; pos += 10;
      if (type === 16 && rdlen > 1) out.text = buf.slice(pos + 1, pos + 1 + Math.min(buf[pos], rdlen - 1)).toString('latin1');
      if (type === 1 && rdlen === 4) out.addr = buf[pos] + '.' + buf[pos + 1] + '.' + buf[pos + 2] + '.' + buf[pos + 3];
    }
  } catch (e) { /* keep what we have */ }
  return out;
}

function ask(ip, name, qtype, qclass, timeoutMs) {
  return new Promise((resolve) => {
    const id = crypto.randomBytes(2).readUInt16BE(0);
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch (e) { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => finish(null), timeoutMs || 1000);
    sock.on('error', () => finish(null));
    // the answer must come from the DNS port and carry our random id (some routers answer from a different address of their own)
    sock.on('message', (m, r) => { if (r.port === 53) { const p = parseReply(m, id); if (p) finish(p); } });
    try { sock.send(buildQuery(id, name, qtype, qclass), 53, ip, (err) => { if (err) finish(null); }); } catch (e) { finish(null); }
  });
}

// the same question over TCP (some networks or firewalls let TCP through when UDP is filtered)
function askTcp(ip, name, qtype, qclass, timeoutMs) {
  return new Promise((resolve) => {
    const id = crypto.randomBytes(2).readUInt16BE(0);
    const sock = new net.Socket();
    let done = false, buf = Buffer.alloc(0), state = 'timeout';
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) { /* ignore */ } resolve(v || { none: state }); };
    const timer = setTimeout(() => finish(null), timeoutMs || 1000);
    sock.on('error', (e) => { state = e && e.code === 'ECONNREFUSED' ? 'closed' : 'error'; finish(null); });
    sock.on('connect', () => { state = 'no-answer'; const q = buildQuery(id, name, qtype, qclass); const len = Buffer.from([q.length >> 8, q.length & 255]); sock.write(Buffer.concat([len, q])); });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 2 && buf.length >= 2 + ((buf[0] << 8) | buf[1])) { const p = parseReply(buf.slice(2, 2 + ((buf[0] << 8) | buf[1])), id); if (p) finish(p); }
    });
    sock.connect(53, ip);
  });
}

function cleanBanner(t) {
  const s = String(t || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 60);
  if (!s) return '';
  let m = /^dnsmasq-pi-hole-?v?([\w.-]*)/i.exec(s); if (m) return 'Pi-hole (dnsmasq ' + (m[1] || '') + ')'.replace(' )', ')');
  m = /^dnsmasq-?v?([\w.-]*)/i.exec(s); if (m) return ('dnsmasq ' + m[1]).trim();
  m = /^unbound\s*([\w.-]*)/i.exec(s); if (m) return ('Unbound ' + m[1]).trim();
  m = /^(\d+\.\d+[\w.\-+~]*)/.exec(s); if (m) return 'BIND ' + m[1];
  m = /^(PowerDNS|Knot|CoreDNS|bind|Microsoft DNS)\b.*/i.exec(s); if (m) return s;
  return s;
}

// Is this machine a DNS server? What kind? (Never throws.)
// Tries UDP (the normal way), once more if nothing came back, then TCP.
async function probe(ip) {
  let via = 'udp';
  let r = await ask(ip, 'localhost', 1, 1, 700);
  if (!r) r = await ask(ip, 'localhost', 1, 1, 900);
  let tcpState = '';
  if (!r) {
    const t = await askTcp(ip, 'localhost', 1, 1, 800);
    if (t && t.rcode !== undefined) { r = t; via = 'tcp'; } else tcpState = (t && t.none) || 'timeout';
  }
  if (!r) return { server: false, tried: 'No answer on the DNS port (53): UDP got no reply and TCP was ' + (tcpState === 'closed' ? 'closed' : tcpState === 'no-answer' ? 'open but silent' : 'not answering') + '.' };
  const out = { server: true, recursive: r.ra && r.rcode !== 5, refused: r.rcode === 5, software: '', via: via };
  if (via === 'udp') {
    const v = await ask(ip, 'version.bind', 16, 3, 700);                 // CHAOS TXT: many servers say what software they are
    if (v && v.rcode === 0 && v.text) out.software = cleanBanner(v.text);
    if (!out.software) {                                                // Pi-hole answers its own name locally
      const p = await ask(ip, 'pi.hole', 1, 1, 700);
      if (p && p.rcode === 0 && p.addr === ip) out.software = 'Pi-hole';
    }
  }
  return out;
}

async function probeMany(ips, concurrency) {
  const list = Array.from(new Set(ips)).slice(0, 512);
  const results = {};
  let i = 0;
  async function worker() { while (i < list.length) { const ip = list[i++]; try { results[ip] = await probe(ip); } catch (e) { results[ip] = { server: false }; } } }
  await Promise.all(Array.from({ length: Math.min(concurrency || 24, list.length) }, worker));
  return results;
}

module.exports = { probe, askTcp, probeMany, buildQuery, parseReply, cleanBanner };
