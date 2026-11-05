'use strict';
//   xvfb-run -a node test/bandwidth-test.js      (needs python3 + pysnmp for the SNMP part; skipped if missing)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), { spawn, spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const bw = require(path.join(ROOT, 'bandwidth.js')), cn = require(path.join(ROOT, 'connectors.js'));
  // ---- this computer
  const proc = 'Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0\n  eth0: 5000000 100 0 0 0 0 0 0 2500000 80 0 0 0 0 0 0\ndocker0: 9 1 0 0 0 0 0 0 9 1 0 0 0 0 0 0\n wlan0: 700 5 0 0 0 0 0 0 300 4 0 0 0 0 0 0';
  const p = bw.parseProcNetDev(proc);
  check('Linux counters read, loopback and virtual cards skipped', p.length === 2 && p[0].name === 'eth0' && p[0].rx === 5000000 && p[0].tx === 2500000 && p[1].name === 'wlan0', JSON.stringify(p));
  const mac = 'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll\nlo0   16384 <Link#1>                        100     0       5000      100     0       5000     0\nen0   1500  <Link#4>    aa:bb:cc:dd:ee:ff  5000     0   123456789     4000     0    22222222     0\nen0   1500  192.168.1.0/24 192.168.1.5      5000     -   123456789     4000     -    22222222     -\nawdl0 1484  <Link#9>    aa:bb:cc:dd:ee:00     1     0         100        1     0         100     0';
  const m = bw.parseNetstatIb(mac);
  check('macOS counters read (first row per card, virtual skipped)', m.length === 1 && m[0].name === 'en0' && m[0].rx === 123456789 && m[0].tx === 22222222, JSON.stringify(m));
  const w = bw.parseNetstatE('Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                  987654321       123456789\r\nUnicast packets           100              99');
  check('Windows counters read', w.length === 1 && w[0].rx === 987654321 && w[0].tx === 123456789, JSON.stringify(w));
  check('rubbish gives nothing', !bw.parseProcNetDev('x').length && !bw.parseNetstatIb('x').length && !bw.parseNetstatE('x').length);
  const live = await bw.localCounters();
  check('this machine reports counters (Linux test box)', process.platform !== 'linux' || (live && live.rx >= 0 && live.ports.length >= 0), JSON.stringify(live && { n: live.ports.length }));

  // ---- ASUS router (stand-in web server)
  let logins = 0, hits = 0; const t0 = Date.now();
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url.startsWith('/login.cgi')) { logins++; res.end(JSON.stringify({ asus_token: 'tok' })); return; }
      if (req.url.startsWith('/appGet.cgi') && /asus_token=tok/.test(req.headers.cookie || '')) {
        hits++; const s = (Date.now() - t0) / 1000, h = (n) => '0x' + Math.floor(n).toString(16);
        res.end(JSON.stringify({ netdev: { INTERNET_rx: h(1e6 + s * 1.25e6), INTERNET_tx: h(5e5 + s * 1e5), WIRED_rx: h(2e6), WIRED_tx: h(1e6), WIRELESS0_rx: h(3e6), WIRELESS0_tx: h(1e6) } })); return;
      }
      res.statusCode = 403; res.end('no');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { type: 'asus', host: '127.0.0.1', port: srv.address().port, username: 'admin', password: 'pw' };
  const a1 = await cn.counters(cfg); await sleep(1100); const a2 = await cn.counters(cfg);
  check('ASUS: internet counters read', a1.ok && a1.kind === 'asus' && a1.wan.rx > 1e6 && a1.wired && a1.wireless.length === 1, JSON.stringify(a1).slice(0, 200));
  check('ASUS: counters grow, and the login is reused', a2.ok && a2.wan.rx > a1.wan.rx && logins === 1, 'logins=' + logins);
  const bad = await cn.counters(Object.assign({}, cfg, { port: 1 }));
  check('ASUS: unreachable router gives a plain error', !bad.ok && typeof bad.error === 'string', JSON.stringify(bad));
  check('unsupported kinds say so', (await cn.counters({ type: 'unifi', host: '127.0.0.1', port: 8443, username: 'a', password: 'b' })).code === 'unsupported');
  check('hex counters are understood', cn.hexNum('0x10') === 16 && cn.hexNum('12') === 12 && cn.hexNum('zz') === null && cn.hexNum(undefined) === null);

  // ---- SNMP switch (independent pysnmp agent)
  const pyOk = spawnSync('python3', ['-c', 'import pysnmp']).status === 0;
  if (pyOk) {
    const mib = {};
    const ifs = [[1, 'Gi1', 6, 1, 1000], [2, 'Gi2', 6, 1, 1000], [3, 'Gi3', 6, 2, 1000], [4, 'lo0', 24, 1, 0], [5, 'Vl1', 53, 1, 0]];
    ifs.forEach(([i, n, ty, st, sp]) => {
      mib['1.3.6.1.2.1.2.2.1.3.' + i] = ['i', ty]; mib['1.3.6.1.2.1.2.2.1.8.' + i] = ['i', st];
      mib['1.3.6.1.2.1.31.1.1.1.1.' + i] = ['s', n]; mib['1.3.6.1.2.1.31.1.1.1.15.' + i] = ['i', sp];
      mib['1.3.6.1.2.1.31.1.1.1.6.' + i] = ['i', 1000000 * i]; mib['1.3.6.1.2.1.31.1.1.1.10.' + i] = ['i', 500000 * i];
    });
    mib['1.3.6.1.2.1.1.5.0'] = ['s', 'sw']; mib['1.3.6.1.2.1.1.1.0'] = ['s', 'test switch'];
    const mf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-')), 'mib.json'); fs.writeFileSync(mf, JSON.stringify(mib));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const py = spawn('python3', [path.join(__dirname, 'snmp-mock.py'), String(port), 'public', mf]);
    await new Promise((r) => { py.stdout.on('data', (d) => { if (/ready/.test(String(d))) r(); }); setTimeout(r, 4000); });
    const sn = await cn.counters({ type: 'snmp', host: '127.0.0.1', port: port, password: 'public', snmpVersion: 2 });
    check('SNMP: only ports that are up are listed', sn.ok && sn.kind === 'snmp' && sn.ports.length === 2 && sn.ports.map((x) => x.name).join() === 'Gi1,Gi2', JSON.stringify(sn).slice(0, 300));
    check('SNMP: counters and port speed read', sn.ok && sn.ports[1].rx === 2000000 && sn.ports[1].tx === 1000000 && sn.ports[0].speed === 1000 && sn.ports[0].bits === 64, JSON.stringify(sn.ports));
    const none = await cn.counters({ type: 'snmp', host: '127.0.0.1', port: port, password: 'wrong', snmpVersion: 2 });
    check('SNMP: wrong community gives a plain error', !none.ok && /community|login|refused|password|answer/i.test(none.error), JSON.stringify(none));
    py.kill();
  } else console.log('  (pysnmp not installed: SNMP counters not tested here)');

  // ---- the window
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'bwu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => {
    global.__t0 = Date.now(); global.__mode = 'full';
    ipcMain.removeHandler('bw:sample');
    ipcMain.handle('bw:sample', () => {
      const s = (Date.now() - global.__t0) / 1000, at = Date.now();
      const local = { kind: 'local', rx: 1e9 + s * 125000, tx: 5e8 + s * 25000, ports: [{ name: 'eth0', rx: 1e9 + s * 125000, tx: 5e8 + s * 25000 }] };
      if (global.__mode === 'snmpmain' || global.__mode === 'snmpnoname') return { ok: true, at, local, gearAt: at, saved: 1, gear: [{ ok: true, id: 'r1', name: 'Gateway', host: '10.7.0.1', type: 'snmp', kind: 'snmp', ports: [{ name: global.__mode === 'snmpmain' ? 'igb0' : 'igb0', rx: 1e6 + s * 1e6, tx: 1e6 + s * 2.5e5, speed: 1000, bits: 64 }, { name: global.__mode === 'snmpmain' ? 'WAN' : 'igb1', rx: 1e6 + s * 4e6, tx: 1e6 + s * 5e5, speed: 1000, bits: 64 }] }] };
      if (global.__mode === 'local') return { ok: true, at, local, gear: [], gearAt: 0, saved: 0 };
      return { ok: true, at, local, gearAt: at, saved: 2, gear: [
        { ok: true, id: 'a1', name: 'Hallway router', host: '10.7.0.1', type: 'asus', kind: 'asus', wan: { rx: 1e6 + s * 5e6, tx: 1e6 + s * 1.25e6, bits: 32 }, wired: { rx: 1e6 + s * 2e6, tx: 1e6 + s * 1e6, bits: 32 }, wireless: [{ rx: 1e6 + s * 3e6, tx: 1e6 + s * 5e5, bits: 32 }] },
        { ok: true, id: 's1', name: 'Core switch', host: '10.7.0.2', type: 'snmp', kind: 'snmp', ports: Array.from({ length: 12 }, (_, i) => ({ name: 'Gi' + (i + 1), rx: 1e6 + s * (i + 1) * 1e5, tx: 1e6 + s * (i + 1) * 5e4, speed: 1000, bits: 64 })) },
        { ok: false, id: 'x1', name: 'Old switch', host: '10.7.0.3', type: 'snmp', error: 'The device did not answer in time.' }] };
    });
  });
  await page.click('#tabMap'); await sleep(500);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true, devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true } }, links: [] });
  await sleep(300);
  check('button is there and the window starts hidden', await page.evaluate(() => !!document.getElementById('mapBwBtn') && document.getElementById('bwPanel').classList.contains('closed')));
  await page.click('#mapBwBtn'); await sleep(5200);
  check('click shows the window', await page.evaluate(() => !document.getElementById('bwPanel').classList.contains('closed') && document.getElementById('mapBwBtn').getAttribute('aria-expanded') === 'true'));
  const d = await page.evaluate(() => window.hubBandwidth.dials());
  // WAN: down 5 MB/s = 40 Mbps, up 1.25 MB/s = 10 Mbps
  check('dials follow the router\'s internet traffic (download ~40, upload ~10 Mbps)', Math.abs(d.down - 40) < 4 && Math.abs(d.up - 10) < 1.5, JSON.stringify(d));
  const rows = await page.evaluate(() => [...document.querySelectorAll('#bwRows .bw-row')].map((r) => r.querySelector('.bw-name').textContent));
  check('rows for internet, wired, Wi-Fi, switch ports and this computer', ['Internet', 'Wired devices', 'Wi-Fi', 'Gi12'].every((n) => rows.some((x) => x.startsWith(n))) && rows.some((x) => /^This computer/.test(x)), JSON.stringify(rows));
  check('a switch with many ports shows 8 and a "Show all" button', await page.evaluate(() => /Show all 12/.test(document.getElementById('bwRows').innerText) && [...document.querySelectorAll('#bwRows .bw-gname')].some((g) => g.textContent === 'Core switch')));
  const txt = await page.evaluate(() => document.getElementById('bwPanel').innerText);
  check('an unreachable device is reported plainly', /Old switch: The device did not answer in time/.test(txt));
  check('window explains that per-device speeds are not available', /do not report traffic per device/.test(txt));
  check('dials say where the numbers come from', /Dials show: Main router · Hallway router → Internet \(the main router’s internet connection\)/.test(txt) && !/ASUS/i.test(txt), txt.slice(0, 400));
  // pin a different source: switch port Gi12 -> rx 1.2e6 B/s = 9.6 Mbps down
  await page.evaluate(() => { const r = [...document.querySelectorAll('#bwRows .bw-row')].find((x) => x.dataset.key === 's1|Gi12'); if (r) r.querySelector('.bw-pin').click(); }); await sleep(3200);
  const d2 = await page.evaluate(() => window.hubBandwidth.dials());
  check('"dials" button moves the dials to that port', Math.abs(d2.down - 9.6) < 1.2, JSON.stringify(d2));
  await page.screenshot({ path: path.join(ROOT, 'test', 'bw-shot.png'), clip: { x: 0, y: 150, width: 700, height: 750 } });
  await page.selectOption('#bwScale', '1000'); await sleep(300);
  check('fixed scale is honoured (dial end reads 1 Gbps)', (await page.evaluate(() => [...document.querySelectorAll('.bw-tick')].map((x) => x.textContent).join(' '))).includes('1 Gbps'));
  // hide and show again
  await page.click('#mapBwBtn'); await sleep(400);
  check('click again hides it and stops asking', await page.evaluate(() => document.getElementById('bwPanel').classList.contains('closed') && !window.hubBandwidth.isOpen()));
  await app.evaluate(() => { global.__mode = 'snmpmain'; });
  await page.evaluate(() => { try { localStorage.removeItem('hubBw'); } catch (e) { /* ignore */ } });
  await page.click('#mapBwBtn'); await sleep(4200);
  const s1 = await page.evaluate(() => ({ t: document.getElementById('bwPanel').innerText, d: window.hubBandwidth.dials() }));
  check('a main router that lists ports: the port named WAN drives the dials (download ~32 Mbps)', /WAN \(internet\)/.test(s1.t) && Math.abs(s1.d.down - 32) < 3, JSON.stringify(s1.d) + s1.t.slice(0, 300));
  await page.click('#mapBwBtn'); await sleep(300);
  await app.evaluate(() => { global.__mode = 'snmpnoname'; });
  await page.click('#mapBwBtn'); await sleep(4200);
  const s2 = await page.evaluate(() => ({ t: document.getElementById('bwPanel').innerText, d: window.hubBandwidth.dials() }));
  check('port names not recognised: it says so instead of guessing, and falls back to this computer', /internet port was not recognised/.test(s2.t) && /this computer only/.test(s2.t), s2.t.slice(0, 400));
  await page.evaluate(() => { const r = [...document.querySelectorAll('#bwRows .bw-row')].find((x) => x.dataset.key === 'r1|igb1'); r.querySelector('.bw-pin').click(); }); await sleep(3200);
  const s3 = await page.evaluate(() => window.hubBandwidth.dials());
  check('pressing "dials" on the right port is remembered and used', Math.abs(s3.down - 32) < 3, JSON.stringify(s3));
  await page.click('#mapBwBtn'); await sleep(300);
  await page.evaluate(() => { try { localStorage.removeItem('hubBw'); } catch (e) { /* ignore */ } });
  await app.evaluate(() => { global.__mode = 'local'; });
  await page.click('#mapBwBtn'); await sleep(4200);
  const t2 = await page.evaluate(() => document.getElementById('bwPanel').innerText);
  const d3 = await page.evaluate(() => window.hubBandwidth.dials());
  check('with no router set up, this computer drives the dials and it says how to add more', Math.abs(d3.down - 1) < 0.3 && /this computer only/.test(t2) && /Router & switch links/.test(t2), JSON.stringify(d3) + t2.slice(0, 300));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
