'use strict';
// node test/methods-test.js  (no window needed). Fake mDNS / SSDP / NetBIOS devices answer on 127.0.0.2.
const dgram = require('dgram'), http = require('http'), net = require('net'), fs = require('fs'), os = require('os'), path = require('path');
const scanner = require('../scanner'), discovery = require('../discovery'), connectors = require('../connectors'), security = require('../security');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const udp = (port, onMsg) => new Promise((res) => { const s = dgram.createSocket('udp4'); s.on('message', (m, r) => onMsg(s, m, r)); s.bind(port, '127.0.0.2', () => res(s)); });

function mdnsReply() {            // one A record: "mdns-thing.local" is 127.0.0.2
  const head = Buffer.alloc(12); head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(1, 6);
  const rr = Buffer.alloc(10); rr.writeUInt16BE(1, 0); rr.writeUInt16BE(1, 2); rr.writeUInt16BE(4, 8);
  return Buffer.concat([head, discovery.encodeName('mdns-thing.local'), rr, Buffer.from([127, 0, 0, 2])]);
}
function nbReply(name) {
  const head = Buffer.alloc(12); head.writeUInt16BE(0x4442, 0); head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(1, 6);
  const q = Buffer.concat([Buffer.from([32]), Buffer.from('CK' + 'A'.repeat(30)), Buffer.from([0])]);
  const rr = Buffer.alloc(10); rr.writeUInt16BE(0x21, 0); rr.writeUInt16BE(1, 2);
  const ent = Buffer.alloc(18); ent.write(name.padEnd(15, ' '), 0, 'latin1'); ent[15] = 0; ent.writeUInt16BE(0x0400, 16);
  return Buffer.concat([head, q, rr, Buffer.from([1]), ent]);
}
function runScan(methods, hooks) {
  return new Promise((resolve) => {
    const hosts = new Map();
    const r = scanner.startScan({ cidr: '127.0.0.0/30', mode: 'quick', router: '', methods, testHooks: hooks }, (m) => {
      if (m.type === 'host') hosts.set(m.host.ip, JSON.parse(JSON.stringify(m.host)));
      if (m.type === 'done') resolve(hosts);
    });
    if (!r.ok) resolve(hosts);
  });
}

(async () => {
  const mdnsPort = 40000 + Math.floor(Math.random() * 5000), ssdpPort = mdnsPort + 1, nbPort = mdnsPort + 2, httpPort = mdnsPort + 3;
  const mdnsSock = await udp(mdnsPort, (s, m, r) => s.send(mdnsReply(), r.port, r.address));
  const web = http.createServer((q, a) => { a.end('<root><device><friendlyName>Living Room TV</friendlyName><manufacturer>Acme</manufacturer><modelName>TV9</modelName></device></root>'); });
  await new Promise((r) => web.listen(httpPort, '127.0.0.2', r));
  const ssdpSock = await udp(ssdpPort, (s, m, r) => s.send(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.2:' + httpPort + '/d.xml\r\nSERVER: acme/1.0\r\nST: upnp:rootdevice\r\n\r\n'), r.port, r.address));
  const nbSock = await udp(nbPort, (s, m, r) => s.send(nbReply('WINBOX'), r.port, r.address));
  let tcpSrv = null; try { tcpSrv = net.createServer((c) => c.end()); await new Promise((r, j) => { tcpSrv.once('error', j); tcpSrv.listen(80, '127.0.0.2', r); }); } catch (e) { tcpSrv = null; }
  const hooks = { discovery: { mdns: { port: mdnsPort, target: '127.0.0.2' }, ssdp: { port: ssdpPort, target: '127.0.0.2' } }, netbiosPort: nbPort };
  const off = { probe: false, mdns: false, ssdp: false, netbios: false, reverseDns: false };

  console.log('Quiet scan: only listening');
  let h = await runScan(Object.assign({}, off, { mdns: true }), hooks);
  let x = h.get('127.0.0.2');
  check('a machine that only announces itself (mDNS) is found', !!x);
  check('its name comes from mDNS', x && x.hostname === 'mdns-thing', JSON.stringify(x && x.hostname));
  check('the machine says it was found by mDNS', x && x.found.includes('mDNS'), JSON.stringify(x && x.found));
  check('with probing off nothing was pinged or port-checked', x && x.ttl === null && x.ports.length === 0, JSON.stringify(x && [x.ttl, x.ports]));

  h = await runScan(Object.assign({}, off, { ssdp: true }), hooks); x = h.get('127.0.0.2');
  check('SSDP / UPnP alone finds the machine and its name', x && x.hostname === 'Living Room TV' && x.found.includes('SSDP'), JSON.stringify(x && [x.hostname, x.found]));

  h = await runScan(Object.assign({}, off, { mdns: true, netbios: true }), hooks); x = h.get('127.0.0.2');
  check('a name from mDNS wins over NetBIOS (NetBIOS is only a fallback)', x && x.hostname === 'mdns-thing');
  h = await runScan(Object.assign({}, off, { netbios: true }), hooks);
  check('NetBIOS alone cannot find a machine nobody announced (it only names known ones)', !h.get('127.0.0.2'));

  check('NetBIOS: a Windows machine tells us its own name', (await discovery.netbiosName('127.0.0.2', 900, nbPort)) === 'WINBOX');
  let nb139 = null; try { nb139 = net.createServer((c) => c.end()); await new Promise((r, j) => { nb139.once('error', j); nb139.listen(139, '127.0.0.2', r); }); } catch (e) { nb139 = null; }
  if (nb139) {
    h = await runScan({ probe: true, mdns: false, ssdp: false, netbios: true, reverseDns: false }, hooks); x = h.get('127.0.0.2');
    check('in a scan, a machine with the file-sharing port open is named through NetBIOS', x && x.hostname === 'WINBOX' && x.found.includes('NetBIOS'), JSON.stringify(x && [x.hostname, x.found]));
    h = await runScan({ probe: true, mdns: false, ssdp: false, netbios: false, reverseDns: false }, hooks); x = h.get('127.0.0.2');
    check('with NetBIOS switched off, no name question is asked', x && !x.hostname, JSON.stringify(x && x.hostname));
    nb139.close();
  }
  console.log('Everything switched off');
  h = await runScan(off, hooks);
  check('with every method off, the machine is not found', !h.get('127.0.0.2'));
  check('this computer itself is still listed', h.has('127.0.0.1'));

  console.log('Normal scan, one method at a time');
  if (tcpSrv) {
    h = await runScan({ probe: true, mdns: false, ssdp: false, netbios: false, reverseDns: false }, hooks); x = h.get('127.0.0.2');
    check('ping / port checks find a machine with an open port', x && x.ports.some((p) => p.port === 80), JSON.stringify(x && x.ports));
    check('...and it is reported as found by the port check', x && x.found.includes('Ping / port check'));
    h = await runScan({ probe: true, mdns: true, ssdp: false, netbios: true, reverseDns: false }, hooks); x = h.get('127.0.0.2');
    check('methods combine: port check + mDNS name', x && x.ports.length > 0 && x.hostname === 'mdns-thing' && x.found.includes('mDNS') && x.found.includes('Ping / port check'), JSON.stringify(x && [x.hostname, x.found]));
  } else console.log('  (skipped port-check tests: port 80 not available)');

  console.log('discoverNames switches');
  let d = await discovery.discoverNames(Object.assign({ ms: 900, useMdns: false }, hooks.discovery));
  check('mDNS can be switched off on its own', d.has('127.0.0.2') && !d.get('127.0.0.2').via.includes('mDNS') && d.get('127.0.0.2').via.includes('SSDP'));
  d = await discovery.discoverNames(Object.assign({ ms: 900, useMdns: false, useSsdp: false }, hooks.discovery));
  check('with both switched off nothing is sent or found', d.size === 0);

  console.log('SNMP master switch');
  const cfg = { type: 'snmp', host: '192.168.0.1', port: 161, password: 'public', snmpVersion: 2 };
  connectors.setPolicy({ snmpEnabled: false });
  let r = await connectors.poll(cfg); check('an SNMP connection is refused when SNMP is off', r.ok === false && r.code === 'blocked' && /SNMP is turned off/.test(r.error), JSON.stringify(r));
  r = await connectors.poll(Object.assign({}, cfg, { type: 'hpe' })); check('HPE (SNMP) connections are refused too', r.ok === false && r.code === 'blocked');
  r = await connectors.counters(cfg); check('SNMP traffic numbers are refused', r.ok === false && r.code === 'blocked');
  r = await connectors.snmpProbe('192.168.0.1', ['public'], 161); check('the SNMP finder sends nothing', r.ok === false);
  const mk = await connectors.poll({ type: 'unifi', host: '192.168.0.1', port: 443, https: true, username: 'a', password: 'b' });
  check('connections that do not use SNMP are not blocked by this switch', !(mk.code === 'blocked'), JSON.stringify(mk).slice(0, 120));
  connectors.setPolicy({ snmpEnabled: true });
  r = await connectors.poll(cfg); check('turning SNMP back on allows it again (it just fails to reach the fake address)', r.code !== 'blocked', JSON.stringify(r).slice(0, 100));

  console.log('Settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-')); security.init(dir);
  let s = security.get();
  check('standard: everything on', ['scanProbe', 'scanMdns', 'scanSsdp', 'scanNetbios', 'scanReverseDns', 'snmpEnabled'].every((k) => s[k] === true));
  security.set({ scanMdns: false, certs: 'strict' }); security.preset('quiet'); s = security.get();
  check('"Quiet scan, no SNMP" turns off probing, NetBIOS and SNMP', !s.scanProbe && !s.scanNetbios && !s.snmpEnabled);
  check('...and leaves the other settings as they were', s.scanMdns === false && s.certs === 'strict' && s.scanSsdp === true && s.scanReverseDns === true);
  security.set({ scanProbe: 'yes', snmpEnabled: 1, bogus: true }); s = security.get();
  check('junk values are ignored', s.scanProbe === false && s.snmpEnabled === false && s.bogus === undefined);
  security.preset('default'); s = security.get();
  check('"Standard settings" turns everything back on', s.scanProbe && s.scanMdns && s.scanNetbios && s.snmpEnabled && s.certs === 'local');

  [mdnsSock, ssdpSock, nbSock].forEach((k) => { try { k.close(); } catch (e) { /* closed */ } });
  web.close(); if (tcpSrv) tcpSrv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
