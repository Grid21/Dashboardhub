'use strict';
//   node test/speed-test.js        (link speed reading: SNMP switch, UniFi, rate parsing)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const C = require('../connectors.js');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const pr = C.parseRate;
  check('rate text: 866.7Mbps-80MHz/2S', pr('866.7Mbps-80MHz/2S') === 866.7);
  check('rate text: 1 Gbps', pr('1 Gbps') === 1000 && pr('2.5Gbps') === 2500);
  check('rate text: plain number is Mbps', pr('300') === 300 && pr(144) === 144);
  check('rate text: nonsense is unknown', pr('') === null && pr('n/a') === null && pr(0) === null && pr(undefined) === null);

  // ---- UniFi (pretend controller) ----
  const srv = http.createServer((req, res) => {
    const send = (o, h) => { res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, h || {})); res.end(JSON.stringify(o)); };
    if (req.url.endsWith('/api/login') || req.url.endsWith('/api/auth/login')) return send({ meta: { rc: 'ok' } }, { 'set-cookie': 'unifises=abc; Path=/' });
    if (req.url.endsWith('/stat/sta')) return send({ data: [
      { mac: 'aa:bb:cc:00:00:01', ip: '10.5.0.21', name: 'Laptop', is_wired: false, signal: -52, tx_rate: 866700, rx_rate: 780000, ap_mac: 'aa:bb:cc:00:aa:01', radio: 'na', essid: 'Home' },
      { mac: 'aa:bb:cc:00:00:02', ip: '10.5.0.22', name: 'NAS', is_wired: true, sw_mac: 'aa:bb:cc:00:bb:01', sw_port: 7 },
      { mac: 'aa:bb:cc:00:00:03', ip: '10.5.0.23', name: 'Printer', is_wired: true, sw_mac: 'aa:bb:cc:00:bb:01', sw_port: 9, wired_rate_mbps: 100 }] });
    if (req.url.endsWith('/stat/device')) return send({ data: [
      { mac: 'aa:bb:cc:00:aa:01', name: 'AP', model: 'U6', type: 'uap', ip: '10.5.0.2' },
      { mac: 'aa:bb:cc:00:bb:01', name: 'Switch', model: 'USW', type: 'usw', ip: '10.5.0.3', port_table: [{ port_idx: 7, up: true, speed: 2500 }, { port_idx: 9, up: true, speed: 1000 }] }] });
    send({ data: [] });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const u = await C.poll({ type: 'unifi', host: '127.0.0.1', port: srv.address().port, https: false, username: 'a', password: 'b', site: 'default' });
  srv.close();
  const by = {}; (u.clients || []).forEach((c) => { by[c.mac] = c; });
  check('UniFi poll works', u.ok === true, JSON.stringify(u).slice(0, 200));
  check('UniFi Wi-Fi client: both directions', by['aa:bb:cc:00:00:01'] && by['aa:bb:cc:00:00:01'].speed === 866.7 && by['aa:bb:cc:00:00:01'].speedRx === 780);
  check('UniFi wired client: speed from the switch port', by['aa:bb:cc:00:00:02'] && by['aa:bb:cc:00:00:02'].speed === 2500);
  check('UniFi wired client: own reported speed wins', by['aa:bb:cc:00:00:03'] && by['aa:bb:cc:00:00:03'].speed === 100);

  // ---- SNMP switch (pretend) ----
  const mib = {
    '1.3.6.1.2.1.1.1.0': ['s', 'Pretend Switch'], '1.3.6.1.2.1.1.5.0': ['s', 'sw1'],
    '1.3.6.1.2.1.2.2.1.3.1': ['i', 6], '1.3.6.1.2.1.2.2.1.3.2': ['i', 6],
    '1.3.6.1.2.1.31.1.1.1.1.1': ['s', 'Gi1'], '1.3.6.1.2.1.31.1.1.1.1.2': ['s', 'Gi2'],
    '1.3.6.1.2.1.2.2.1.5.1': ['i', 1000000000], '1.3.6.1.2.1.2.2.1.5.2': ['i', 100000000],
    '1.3.6.1.2.1.31.1.1.1.15.1': ['i', 1000], '1.3.6.1.2.1.31.1.1.1.15.2': ['i', 100],
    '1.3.6.1.2.1.17.1.4.1.2.1': ['i', 1], '1.3.6.1.2.1.17.1.4.1.2.2': ['i', 2],
    '1.3.6.1.2.1.17.4.3.1.2.170.187.204.0.0.1': ['i', 1], '1.3.6.1.2.1.17.4.3.1.2.170.187.204.0.0.2': ['i', 2],
    '1.3.6.1.2.1.4.22.1.2.1.10.5.0.31': ['x', 'aabbcc000001'], '1.3.6.1.2.1.4.22.1.2.1.10.5.0.32': ['x', 'aabbcc000002']
  };
  const mf = path.join(os.tmpdir(), 'speed-mib.json'); fs.writeFileSync(mf, JSON.stringify(mib));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const agent = spawn('python3', ['-W', 'ignore', path.join(__dirname, 'snmp-mock.py'), String(port), 'hubtest', mf], { stdio: ['ignore', 'pipe', 'pipe'] });
  await sleep(1500);
  const s = await C.poll({ type: 'snmp', host: '127.0.0.1', port: port, password: 'hubtest', snmpVersion: 2 });
  agent.kill();
  const sb = {}; (s.clients || []).forEach((c) => { sb[c.mac] = c; });
  check('SNMP poll works', s.ok === true, JSON.stringify(s).slice(0, 200));
  check('SNMP: port at 1 Gbps', sb['aa:bb:cc:00:00:01'] && sb['aa:bb:cc:00:00:01'].speed === 1000, JSON.stringify(sb['aa:bb:cc:00:00:01']));
  check('SNMP: port at 100 Mbps', sb['aa:bb:cc:00:00:02'] && sb['aa:bb:cc:00:00:02'].speed === 100);
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
