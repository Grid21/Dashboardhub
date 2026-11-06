'use strict';
//   xvfb-run -a node test/dns-test.js     (uses the DNS port 53 on a few loopback addresses, so it must be allowed to)
const path = require('path'), fs = require('fs'), os = require('os'), dgram = require('dgram');
const dnsProbe = require('../dns-probe');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a pretend DNS server: mode 'dnsmasq' (resolver + banner), 'pihole', 'refuse' (answers REFUSED), 'silent' (nothing listens)
function fakeDns(ip, mode) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (msg, rinfo) => {
      const id = msg.slice(0, 2);
      // the question section (copy it back)
      let pos = 12; while (msg[pos] !== 0) pos += msg[pos] + 1; pos += 5;
      const question = msg.slice(12, pos);
      const labels = []; let p = 12; while (msg[p] !== 0) { labels.push(msg.slice(p + 1, p + 1 + msg[p]).toString()); p += msg[p] + 1; }
      const name = labels.join('.'); const qtype = (msg[pos - 4] << 8) | msg[pos - 3]; const qclass = (msg[pos - 2] << 8) | msg[pos - 1];
      const head = (flags, an) => Buffer.concat([id, Buffer.from([flags >> 8, flags & 255, 0, 1, 0, an, 0, 0, 0, 0]), question]);
      if (mode === 'refuse') return s.send(Buffer.concat([id, Buffer.from([0x81, 0x05, 0, 1, 0, 0, 0, 0, 0, 0]), question]), rinfo.port, rinfo.address);
      if (qclass === 3 && name === 'version.bind') {
        const txt = mode === 'pihole' ? 'dnsmasq-pi-hole-v2.89' : 'dnsmasq-2.89';
        const rr = Buffer.concat([Buffer.from([0xc0, 0x0c, 0, 16, 0, 3, 0, 0, 0, 0, 0, txt.length + 1, txt.length]), Buffer.from(txt)]);
        return s.send(Buffer.concat([head(0x8580, 1), rr]), rinfo.port, rinfo.address);
      }
      if (qtype === 1 && name === 'localhost') { const rr = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]); return s.send(Buffer.concat([head(0x8180, 1), rr]), rinfo.port, rinfo.address); }
      return s.send(head(0x8183, 0), rinfo.port, rinfo.address);       // name error for everything else
    });
    s.on('error', reject);
    s.bind(53, ip, () => resolve(s));
  });
}
(async () => {
  const servers = [];
  try { servers.push(await fakeDns('127.0.0.10', 'dnsmasq')); servers.push(await fakeDns('127.0.0.11', 'pihole')); servers.push(await fakeDns('127.0.0.12', 'refuse')); }
  catch (e) { console.log('Cannot use port 53 here: ' + e.message); process.exit(2); }
  const a = await dnsProbe.probe('127.0.0.10'), b = await dnsProbe.probe('127.0.0.11'), c = await dnsProbe.probe('127.0.0.12'), z = await dnsProbe.probe('127.0.0.13');
  check('a normal resolver is found, with its software', a.server && a.recursive && a.software === 'dnsmasq 2.89', JSON.stringify(a));
  check('Pi-hole is recognised from its banner', b.server && /Pi-hole/.test(b.software), JSON.stringify(b));
  check('a server that refuses lookups is found and said to refuse', c.server && c.refused && !c.recursive, JSON.stringify(c));
  check('a machine with no DNS service is not a DNS server (and fast)', z.server === false);
  // a server that only answers over TCP (UDP filtered)
  const tcp = require('net').createServer((c) => { c.on('data', (d) => {
    const q = d.slice(2); const id = q.slice(0, 2); let pos = 12; while (q[pos] !== 0) pos += q[pos] + 1; pos += 5;
    const rr = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]);
    const body = Buffer.concat([id, Buffer.from([0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]), q.slice(12, pos), rr]);
    c.end(Buffer.concat([Buffer.from([body.length >> 8, body.length & 255]), body]));
  }); });
  await new Promise((r) => tcp.listen(53, '127.0.0.14', r));
  const tt = await dnsProbe.probe('127.0.0.14');
  check('a server that only answers over TCP is still found', tt.server === true && tt.via === 'tcp' && tt.recursive === true, JSON.stringify(tt));
  check('when nothing answers, the reason is explained in plain words', /No answer on the DNS port \(53\)/.test(z.tried || ''), JSON.stringify(z));
  tcp.close();
  const many = await dnsProbe.probeMany(['127.0.0.10', '127.0.0.13', '127.0.0.10'], 8);
  check('many at once works and repeats are asked once', Object.keys(many).length === 2 && many['127.0.0.10'].server && !many['127.0.0.13'].server);
  check('the reply parser ignores a wrong answer id', dnsProbe.parseReply(Buffer.from([0, 1, 0x81, 0x80, 0, 1, 0, 0, 0, 0, 0, 0]), 2) === null);
  // --- in the app ---
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'dn-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const A = 'aa:bb:cc:00:00:01', B = 'aa:bb:cc:00:00:02';
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '127.0.0.10', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '127.0.0.10', isRouter: true }, [A]: { key: A, mac: A, ip: '127.0.0.11', label: 'pihole box', online: true, pos: { x: 7, y: 0, z: 5 } }, [B]: { key: B, mac: B, ip: '127.0.0.13', label: 'laptop', online: true, pos: { x: -7, y: 0, z: 5 } } }, links: [{ a: 'router', b: A, auto: true }, { a: 'router', b: B, auto: true }] });
  await sleep(700); await page.evaluate(() => window.__hubMap.sync()); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  const sel = async (k) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), k); await page.mouse.click(p.x, p.y); await sleep(500); };
  await sel(B);
  check('a device that was not checked yet offers "Check DNS"', await page.locator('#mapSide button', { hasText: /^Check DNS$/ }).count() === 1);
  await page.click('#mapSide button:has-text("Check DNS")'); await sleep(4000);
  let side = await page.textContent('#mapSide');
  check('a laptop is not a DNS server, and the pane says what cannot be known', !/DNS server: yes/.test(side) && /cannot be seen from outside|No DNS server was found/.test(side), side.slice(0, 400));
  await sel(A); await page.click('#mapSide button:has-text("Check DNS")'); await sleep(1500);
  side = await page.textContent('#mapSide');
  check('the Pi-hole machine shows "DNS server: yes" with the software', /DNS server: yes \(Pi-hole/.test(side) && /looks names up/.test(side), side.slice(0, 500));
  await sel('router'); await page.click('#mapSide button:has-text("Check DNS")'); await sleep(1500);
  side = await page.textContent('#mapSide');
  check('the router shows its DNS server info and lists the other DNS servers found', /DNS server: yes \(dnsmasq 2\.89\)/.test(side) && /DNS servers found on this network:.*pihole box 127\.0\.0\.11/.test(side), side.slice(0, 600));
  const saved = await page.evaluate((k) => window.hubNetmap.exportData().devices[k].dns, A);
  check('the result is saved with the map', saved && saved.server === true && /Pi-hole/.test(saved.software), JSON.stringify(saved));
  // the automatic check that runs after every scan
  await page.evaluate(() => { const x = window.hubNetmap.exportData(); Object.values(x.devices).forEach((d) => { d.dns = null; d.dnsAt = null; }); window.hubNetmap.importData(x, true); });
  await page.evaluate(() => window.__hubMap.dnsSweep(false)); await sleep(1800);
  const swept = await page.evaluate(() => { const x = window.hubNetmap.exportData().devices; return { r: x.router.dns && x.router.dns.software, p: x[arguments[0]] }; }).catch(() => null);
  const sw2 = await page.evaluate((k) => { const x = window.hubNetmap.exportData().devices; return { router: x.router.dns && x.router.dns.software, pi: x[k].dns && x[k].dns.software, lapAt: !!x['aa:bb:cc:00:00:02'].dnsAt, lap: x['aa:bb:cc:00:00:02'].dns }; }, A);
  check('after a scan every machine is checked automatically (and quiet ones left as non-servers)', sw2.router === 'dnsmasq 2.89' && /Pi-hole/.test(sw2.pi || '') && sw2.lapAt && sw2.lap === null, JSON.stringify(sw2));
  const again = await page.evaluate(() => { const before = window.hubNetmap.exportData().devices.router.dnsAt; return window.__hubMap.dnsSweep(false).then(() => before === window.hubNetmap.exportData().devices.router.dnsAt); });
  check('machines checked in the last hour are not asked again', again === true);
  // the REAL flow: a scan finishes -> machines are checked by themselves
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('net:scan');
    ipcMain.handle('net:scan', (e, o) => { setTimeout(() => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.send('net:event', { type: 'host', host: { ip: '127.0.0.11', mac: 'aa:bb:cc:00:00:01', hostname: 'pihole box', ports: [], os: { id: 'linux', label: 'Linux', confidence: 'low', reasons: [] } } }); w.webContents.send('net:event', { type: 'done' }); }, 150); return { ok: true, cidr: o.cidr }; });
  });
  await page.evaluate(() => { const x = window.hubNetmap.exportData(); Object.values(x.devices).forEach((d) => { d.dns = null; d.dnsAt = null; }); window.hubNetmap.importData(x, true); });
  await page.click('#mapScan'); await sleep(3000);
  const afterScan = await page.evaluate((k) => { const x = window.hubNetmap.exportData().devices; return { router: x.router.dns && x.router.dns.software, pi: x[k].dns && x[k].dns.software, lapAt: !!x['aa:bb:cc:00:00:02'].dnsAt }; }, A);
  check('after a real scan finishes, DNS servers are found by themselves', afterScan.router === 'dnsmasq 2.89' && /Pi-hole/.test(afterScan.pi || ''), JSON.stringify(afterScan));
  check('the info is only in the device pane, not drawn on the map', await page.evaluate(() => !document.querySelector('#mapLegend').textContent.includes('DNS')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close(); servers.forEach((s) => s.close());
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
