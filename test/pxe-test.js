'use strict';
//   node test/pxe-test.js        (no window needed; uses high port numbers and 127.0.0.1)
const path = require('path'), fs = require('fs'), os = require('os'), dgram = require('dgram'), http = require('http'), crypto = require('crypto'), cp = require('child_process');
const pxe = require('../pxe.js');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---- a tiny ISO like an Ubuntu live disc (made with pycdlib)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxe-'));
const KERNEL = crypto.randomBytes(3000), INITRD = crypto.randomBytes(9000);
fs.writeFileSync(path.join(tmp, 'k'), KERNEL); fs.writeFileSync(path.join(tmp, 'i'), INITRD);
const isoFile = path.join(tmp, 'ubuntu-test.iso'), plainIso = path.join(tmp, 'plain.iso');
cp.execFileSync('python3', ['-I', '-c', `
import pycdlib, sys
tmp = sys.argv[1]
def make(out, files):
    iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, rock_ridge='1.09', vol_ident='TESTDISC')
    dirs = set()
    for name, src, sh in files:
        d = name.rsplit('/', 1)[0]
        if d and d not in dirs:
            iso.add_directory('/' + sh.rsplit('/', 1)[0].upper(), rr_name=d.split('/')[-1]); dirs.add(d)
        iso.add_file(src, '/' + sh.upper() + ';1', rr_name=name.rsplit('/', 1)[1])
    iso.write(out); iso.close()
make(tmp + '/ubuntu-test.iso', [('casper/vmlinuz', tmp + '/k', 'casper/VMLINUZ'), ('casper/initrd', tmp + '/i', 'casper/INITRD')])
make(tmp + '/plain.iso', [('readme/hello.txt', tmp + '/k', 'readme/HELLO.TXT')])
`, tmp]);

// ---- DHCP packet like a network card's boot ROM sends
function discover(mac, arch, type, ipxe) {
  const b = Buffer.alloc(240); b[0] = 1; b[1] = 1; b[2] = 6; crypto.randomBytes(4).copy(b, 4);
  Buffer.from(mac.split(':').map((x) => parseInt(x, 16))).copy(b, 28);
  Buffer.from([0x63, 0x82, 0x53, 0x63]).copy(b, 236);
  const o = [Buffer.from([53, 1, type]), Buffer.from([60, 9]), Buffer.from('PXEClient'), Buffer.from([93, 2, 0, arch])];
  if (ipxe) o.push(Buffer.from([77, 4]), Buffer.from('iPXE'));
  o.push(Buffer.from([255]));
  return Buffer.concat([b, ...o]);
}
const reply = (packet, port, toPort, mac) => new Promise((resolve) => {
  const c = dgram.createSocket('udp4'); let got = null;
  c.on('message', (m) => { got = m; });
  c.bind(0, '127.0.0.1', () => {
    // the server answers to the port given in "testing.replyPort"; we listen there instead
    c.close(); resolve(null);
  });
});
async function ask(mac, arch, type, toPort, ipxe) {
  const pkt = discover(mac, arch, type, ipxe);
  const c = dgram.createSocket('udp4');
  const got = new Promise((resolve) => { c.on('message', (m, ri) => resolve({ m, ri })); setTimeout(() => resolve(null), 600); });
  await new Promise((r) => c.bind(0, '127.0.0.1', r));
  const REPLY_PORT = c.address().port;
  ask.last = REPLY_PORT;
  return { c, pkt, got, REPLY_PORT, send: () => c.send(pkt, toPort, '127.0.0.1') };
}
function optOf(m, code) { let p = 240; while (p < m.length) { const c = m[p++]; if (c === 255) break; if (c === 0) continue; const l = m[p++]; if (c === code) return m.subarray(p, p + l); p += l; } return null; }

(async () => {
  const P = { dhcp: 16767, pxe: 14011, tftp: 16969, http: 18088 };
  let REPLY = 0;
  const holder = {};
  const mod = pxe.create({ dataDir: tmp, ports: P, testing: { replyTo: '127.0.0.1', get replyPort() { return holder.port; } } });
  const MAC = 'aa:bb:cc:11:22:33', OTHER = 'aa:bb:cc:99:99:99';

  let r = await mod.start({ ip: '127.0.0.1' });
  check('start is refused until you list a computer', !r.ok && /MAC/.test(r.error), JSON.stringify(r));
  r = await mod.start({ ip: 'abc' }); check('start is refused for a nonsense address', !r.ok);
  const sa = mod.setAllow({ macs: ['AA-BB-CC-11-22-33', 'nonsense', MAC], any: false });
  check('MACs are tidied up, duplicates and nonsense dropped', JSON.stringify(mod.status().allow.macs) === JSON.stringify([MAC]) && sa.bad.length === 1, JSON.stringify(mod.status().allow));
  r = await mod.start({ ip: '127.0.0.1' }); check('server starts once a computer is listed', r.ok, JSON.stringify(r));

  async function dhcp(mac, arch, type, port, ipxe) {
    const t = await ask(mac, arch, type, port, ipxe); holder.port = t.REPLY_PORT; t.send();
    const g = await t.got; t.c.close(); return g;
  }
  // PXE first question (port 67)
  let g = await dhcp(MAC, 0, 1, P.dhcp);
  check('older BIOS computer gets an offer', !!g && optOf(g.m, 53)[0] === 2, g && g.m.length);
  check('  offer names undionly.kpxe', g && g.m.toString('latin1', 108, 108 + 13) === 'undionly.kpxe', g && g.m.toString('latin1', 108, 125));
  check('  offer never hands out an address (yiaddr 0.0.0.0)', g && g.m.readUInt32BE(16) === 0);
  check('  offer points at this computer (siaddr)', g && g.m.readUInt32BE(20) === 0x7f000001);
  g = await dhcp(MAC, 7, 1, P.dhcp);
  check('UEFI computer gets ipxe.efi', g && g.m.toString('latin1', 108, 116) === 'ipxe.efi');
  g = await dhcp(MAC, 9, 1, P.dhcp); check('UEFI (code 9) too', g && g.m.toString('latin1', 108, 116) === 'ipxe.efi');
  g = await dhcp(MAC, 0, 1, P.dhcp, true);
  check('a computer already running iPXE is sent to the menu over the web', g && /^http:\/\/127\.0\.0\.1:18088\/boot\.ipxe/.test(g.m.toString('latin1', 108, 150)), g && g.m.toString('latin1', 108, 150));
  g = await dhcp(MAC, 0, 3, P.pxe);
  check('follow-up question on port 4011 gets an acknowledgement', g && optOf(g.m, 53)[0] === 5);
  g = await dhcp(MAC, 0, 3, P.dhcp); check('a "request" on port 67 is left to the real DHCP server', g === null);
  g = await dhcp(OTHER, 0, 1, P.dhcp);
  check('a computer that is NOT on your list gets no answer', g === null);
  g = await dhcp(OTHER, 0, 3, P.pxe); check('...also not on port 4011', g === null);
  check('the ignored computer is mentioned in the log', mod.status().log.some((l) => /aa:bb:cc:99:99:99.*not on your list/.test(l.msg)));
  g = await dhcp(MAC, 0xFF, 1, P.dhcp); check('a boot type that is not offered gets no answer', g === null);
  mod.setAllow({ macs: [MAC], any: true }); g = await dhcp(OTHER, 0, 1, P.dhcp);
  check('"any computer" answers everyone', !!g);
  mod.setAllow({ macs: [MAC], any: false });

  // ---- TFTP
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'ipxe-files.json'), 'utf8'));
  const want = { 'undionly.kpxe': Buffer.from(j.undionly, 'base64'), 'ipxe.efi': Buffer.from(j.efi, 'base64') };
  function tftpGet(name, blksize, opcode) {
    return new Promise((resolve) => {
      const c = dgram.createSocket('udp4'); const chunks = []; let peer = null, size = null, blk = 512, expect = 1, done = false;
      const fin = (v) => { if (done) return; done = true; clearTimeout(tm); try { c.close(); } catch (e) {} resolve(v); };
      const tm = setTimeout(() => fin({ timeout: true }), 15000);
      c.on('message', (m, ri) => {
        peer = ri; const op = m.readUInt16BE(0);
        if (op === 5) return fin({ error: m.toString('latin1', 4, m.length - 1), code: m.readUInt16BE(2) });
        if (op === 6) { const parts = m.subarray(2).toString('latin1').split('\0'); for (let i = 0; i + 1 < parts.length; i += 2) { if (parts[i] === 'blksize') blk = parseInt(parts[i + 1], 10); if (parts[i] === 'tsize') size = parseInt(parts[i + 1], 10); } const a = Buffer.alloc(4); a.writeUInt16BE(4, 0); a.writeUInt16BE(0, 2); return c.send(a, ri.port, ri.address); }
        if (op === 3) { const n = m.readUInt16BE(2); if (n === expect) { chunks.push(m.subarray(4)); expect++; } const a = Buffer.alloc(4); a.writeUInt16BE(4, 0); a.writeUInt16BE(n, 2); c.send(a, ri.port, ri.address); if (m.length - 4 < blk && n === expect - 1) fin({ data: Buffer.concat(chunks), size, blk }); }
      });
      c.bind(0, '127.0.0.1', () => {
        const parts = [Buffer.from([0, opcode || 1]), Buffer.from(name + '\0octet\0')];
        if (blksize) parts.push(Buffer.from('blksize\0' + blksize + '\0tsize\0' + '0\0'));
        c.send(Buffer.concat(parts), P.tftp, '127.0.0.1');
      });
    });
  }
  let t = await tftpGet('undionly.kpxe', 1432);
  check('TFTP: undionly.kpxe arrives complete (with block-size option)', t.data && sha(t.data) === sha(want['undionly.kpxe']), t.error || t.timeout);
  check('  and the size it announced is right', t.size === want['undionly.kpxe'].length);
  t = await tftpGet('ipxe.efi'); check('TFTP: ipxe.efi arrives complete (plain, 512-byte blocks)', t.data && sha(t.data) === sha(want['ipxe.efi']), t.error || t.timeout);
  t = await tftpGet('../../etc/passwd'); check('TFTP: a path outside is refused', t.error === 'File not found' || t.code === 1, JSON.stringify(t).slice(0, 80));
  t = await tftpGet('boot.ipxe'); check('TFTP: files that are not boot loaders are refused', !!t.error);
  t = await tftpGet('undionly.kpxe', 0, 2); check('TFTP: uploading is refused', !!t.error && t.code === 4, JSON.stringify(t).slice(0, 80));

  // ---- ISO and web server
  let a = mod.addIso(isoFile); check('an Ubuntu-style ISO is accepted', a.ok, JSON.stringify(a));
  const st = mod.status(); const one = st.isos[0];
  check('  it is recognised as a "casper" live disc', one && one.mode === 'casper', one && one.mode);
  check('  the same ISO cannot be added twice', !mod.addIso(isoFile).ok);
  check('a file that is not an ISO is refused with a clear message', /ISO/.test(mod.addIso(path.join(tmp, 'k')).error || ''));
  a = mod.addIso(plainIso); check('a plain ISO is accepted (generic mode)', a.ok && mod.status().isos[1].mode === 'sanboot');
  const get = (u, headers, method) => new Promise((resolve) => { const q = http.request({ host: '127.0.0.1', port: P.http, path: u, headers: headers || {}, method: method || 'GET' }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), headers: res.headers })); }); q.on('error', () => resolve({ status: 0, body: Buffer.alloc(0), headers: {} })); q.end(); });
  let h = await get('/boot.ipxe');
  const script = h.body.toString();
  check('web: boot menu starts with #!ipxe', h.status === 200 && script.startsWith('#!ipxe'));
  check('  menu lists the Ubuntu ISO, netboot.xyz, a local-disk fallback', /ubuntu-test|TESTDISC/i.test(script) && /netboot\.xyz/.test(script) && /local/.test(script));
  check('  menu starts the live disc with kernel + initrd lines', script.includes('kernel ${base}/iso/' + one.id + '/f/casper/vmlinuz') && script.includes('set base http://127.0.0.1:18088') && /initrd .*\/f\/casper\/initrd/.test(script) && /boot=casper/.test(script));
  check('  menu says nothing is installed or erased by itself', /nothing is installed or erased/.test(script));
  check('  menu falls back to the local disk by itself', /choose --default local --timeout/.test(script));
  h = await get('/iso/' + one.id + '/f/casper/vmlinuz'); check('web: kernel is read straight out of the ISO, byte for byte', h.status === 200 && h.body.equals(KERNEL), h.status + ' ' + h.body.length);
  h = await get('/iso/' + one.id + '/f/casper/initrd'); check('web: initrd too', h.status === 200 && h.body.equals(INITRD));
  h = await get('/iso/' + one.id + '/f/casper/initrd', { Range: 'bytes=100-199' }); check('web: a byte range works (206, exact bytes)', h.status === 206 && h.body.equals(INITRD.subarray(100, 200)) && /bytes 100-199\//.test(h.headers['content-range']));
  h = await get('/iso/' + one.id + '/f/casper/initrd', { Range: 'bytes=-50' }); check('web: "last 50 bytes" works', h.status === 206 && h.body.equals(INITRD.subarray(INITRD.length - 50)));
  h = await get('/iso/' + one.id + '/f/casper/initrd', { Range: 'bytes=99999999-' }); check('web: a range past the end gets 416', h.status === 416);
  h = await get('/iso/' + one.id + '/f/casper/initrd', null, 'HEAD'); check('web: HEAD gives the length and no body', h.status === 200 && Number(h.headers['content-length']) === INITRD.length && h.body.length === 0);
  h = await get('/iso/' + one.id + '/iso'); check('web: the whole ISO can be fetched', h.status === 200 && h.body.equals(fs.readFileSync(isoFile)));
  h = await get('/iso/' + one.id + '/f/casper/nothing'); check('web: a missing file in the ISO is 404', h.status === 404);
  h = await get('/iso/zzzzzz/iso'); check('web: an unknown disc is 404', h.status === 404);
  for (const bad of ['/etc/passwd', '/iso/' + one.id + '/f/../../../etc/passwd', '/iso/' + one.id + '/f/%2e%2e/%2e%2e/etc/passwd', '/../pxe.js', '/pxe.js']) { h = await get(bad); check('web: cannot read outside (' + bad.slice(0, 40) + ')', h.status === 404 || h.status === 400, h.status); }
  h = await get('/boot.ipxe', null, 'POST'); check('web: only GET/HEAD are allowed', h.status === 405);
  // rename / remove
  mod.renameIso(one.id, 'My $(rm) {Ubuntu} #1'); h = await get('/boot.ipxe');
  check('menu text is cleaned (no $ { } # that iPXE would act on)', !/My \$|\{Ubuntu\}|#1/.test(h.body.toString().split('\n').filter((l) => /^item iso/.test(l)).join('\n')), h.body.toString().split('\n').filter((l) => /^item iso/.test(l)).join('|'));
  mod.removeIso(mod.status().isos[1].id); check('an ISO can be removed from the list', mod.status().isos.length === 1);
  // a file that disappears
  const gone = path.join(tmp, 'gone.iso'); fs.copyFileSync(isoFile, gone); const ga = mod.addIso(gone); fs.unlinkSync(gone);
  check('an ISO whose file was deleted is shown as missing, and dropped from the menu', mod.status().isos.find((x) => x.id === ga.id).ok === false && !(await get('/boot.ipxe')).body.toString().includes('iso' + ga.id + ' '));
  // settings survive a restart
  await mod.stop();
  const mod2 = pxe.create({ dataDir: tmp, ports: P }); check('the ISO list and your computer list are remembered', mod2.status().isos.length === 2 && mod2.status().allow.macs[0] === MAC);
  // stop frees the ports
  const free = await new Promise((resolve) => { const s = dgram.createSocket('udp4'); s.once('error', () => resolve(false)); s.bind(P.tftp, () => { s.close(); resolve(true); }); });
  check('stopping frees the ports', free && (await get('/boot.ipxe')).status === 0);
  // port problems give friendly words
  const hog = dgram.createSocket('udp4'); await new Promise((r) => hog.bind(P.tftp, r));
  const mod3 = pxe.create({ dataDir: tmp, ports: P }); r = await mod3.start({ ip: '127.0.0.1' });
  check('a busy port gives a plain-language reason', !r.ok && /Another program already uses port 16969/.test(r.error), r.error);
  check('...and nothing is left half-open', (await get('/boot.ipxe')).status === 0);
  hog.close();
  r = await mod3.start({ ip: '127.0.0.1' }); check('...and it starts once the port is free again', r.ok); await mod3.stop();
  console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(2); });
