'use strict';
// node test/ping-count-test.js  (no window needed, Linux/mac). A fake "ping" counts how many times it is started.
const fs = require('fs'), os = require('os'), path = require('path');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -> ' + d : '')); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubping-'));
const log = path.join(dir, 'log'); fs.writeFileSync(log, '');
fs.writeFileSync(path.join(dir, 'ping'), '#!/bin/sh\necho "S $$ $(date +%s%N)" >> "' + log + '"\nsleep 0.6\necho "E $$" >> "' + log + '"\nexit 1\n', { mode: 0o755 });
process.env.PATH = dir + path.delimiter + process.env.PATH;
const scanner = require('../scanner');
function scan(hooks, background) {
  fs.writeFileSync(log, '');
  return new Promise((resolve) => {
    const r = scanner.startScan({ cidr: '10.99.0.0/28', router: '', mode: background ? 'background' : 'quick', methods: { probe: true, mdns: false, ssdp: false }, testHooks: Object.assign({ tcpProbe: async () => 'timeout' }, hooks) }, (m) => {
      if (m.type === 'done') {
        const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
        let cur = 0, max = 0, starts = 0;
        for (const l of lines) { if (l[0] === 'S') { starts++; cur++; max = Math.max(max, cur); } else cur--; }
        resolve({ starts, max });
      }
    });
    if (!r.ok) resolve({ starts: -1, max: -1, err: r.error });
  });
}
(async () => {
  const empty = await scan({ interfaces: [{ cidr: '10.99.0.0/28' }] });
  check('on the local network, empty addresses start no ping at all', empty.starts === 0, JSON.stringify(empty));
  const one = await scan({ interfaces: [{ cidr: '10.99.0.0/28' }], tcpProbe: async (ip) => (ip === '10.99.0.5' ? 'open' : 'timeout') });
  check('a machine that answered the port check is pinged once (for its operating system hint)', one.starts === 1, JSON.stringify(one));
  const far = await scan({ interfaces: [{ cidr: '192.168.77.0/24' }] });
  check('addresses on another network are still pinged', far.starts >= 10, JSON.stringify(far));
  check('manual scan never runs more than 8 pings at once', far.max > 0 && far.max <= 8, JSON.stringify(far));
  const bg = await scan({ interfaces: [{ cidr: '192.168.77.0/24' }] }, true);
  check('automatic scan never runs more than 3 pings at once', bg.max > 0 && bg.max <= 3, JSON.stringify(bg));
  console.log(fail ? fail + ' failed' : 'All ' + pass + ' passed'); process.exit(fail ? 1 : 0);
})();
