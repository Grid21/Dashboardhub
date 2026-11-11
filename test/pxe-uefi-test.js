'use strict';
//   node test/pxe-uefi-test.js   (UEFI firmware that ignores the short answer gets the classic boot-menu answer)
const dgram = require('dgram'), crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const pxe = require('../pxe.js');
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? '  ok    ' : '  FAIL  ') + n + (ok ? '' : '   -> ' + d)); if (!ok) failed++; };
function pkt(mac, arch, type, opt43, xid) {
  const b = Buffer.alloc(240); b[0] = 1; b[1] = 1; b[2] = 6; b[10] = 0x80; (xid || crypto.randomBytes(4)).copy(b, 4);
  Buffer.from(mac.split(':').map((x) => parseInt(x, 16))).copy(b, 28); Buffer.from([0x63, 0x82, 0x53, 0x63]).copy(b, 236);
  const o = [Buffer.from([53, 1, type]), Buffer.from([60, 32]), Buffer.from('PXEClient:Arch:00007:UNDI:003016'), Buffer.from([93, 2, 0, arch]), Buffer.from([97, 17, 0]), crypto.randomBytes(16)];
  if (opt43) o.push(Buffer.from([43, opt43.length]), opt43);
  o.push(Buffer.from([255])); return Buffer.concat([b, ...o]);
}
const optOf = (m, code) => { let p = 240; while (p < m.length) { const c = m[p++]; if (c === 255) break; if (c === 0) continue; const l = m[p++]; if (c === code) return m.subarray(p, p + l); p += l; } return null; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxeu-'));
  const holder = {}, P = { dhcp: 16767, pxe: 14011, tftp: 16969, http: 18088 }, MAC = 'aa:bb:cc:00:00:07';
  const mod = pxe.create({ dataDir: tmp, ports: P, testing: { replyTo: '127.0.0.1', get replyPort() { return holder.port; } } });
  mod.setAllow({ macs: [MAC], any: false });
  check('server starts', (await mod.start({ ip: '127.0.0.1' })).ok);
  const ask = async (type, port, arch, opt43) => {
    const c = dgram.createSocket('udp4'); await new Promise((r) => c.bind(0, '127.0.0.1', r)); holder.port = c.address().port;
    const got = new Promise((res) => { c.on('message', (m) => res(m)); setTimeout(() => res(null), 500); });
    c.send(pkt(MAC, arch === undefined ? 7 : arch, type, opt43), port, '127.0.0.1'); const m = await got; c.close(); return m;
  };
  let m = await ask(1, P.dhcp);
  check('first answer to UEFI firmware is the short one: boot file named in the offer, no menu', m && m.toString('latin1', 108, 120).startsWith('snponly.efi') && !pxe.pxeSub(optOf(m, 43), 9), m && m.toString('latin1', 108, 125));
  await ask(1, P.dhcp);
  m = await ask(1, P.dhcp);          // the third ask in a row: firmware did not accept it
  check('after three asks without a download the answer style changes (offer names no file)', m && m[108] === 0, m && m.toString('latin1', 108, 125));
  const v = optOf(m, 43);
  check('...it offers a one-item boot menu', v && pxe.pxeSub(v, 9) && /Dashboard Hub network boot/.test(pxe.pxeSub(v, 9).toString('latin1')) && pxe.pxeSub(v, 9).readUInt16BE(0) === 7, v && v.toString('hex'));
  check('...and this computer as the boot server (type 7, one server, 127.0.0.1)', pxe.pxeSub(v, 8) && pxe.pxeSub(v, 8).readUInt16BE(0) === 7 && pxe.pxeSub(v, 8)[2] === 1 && pxe.pxeSub(v, 8).readUInt32BE(3) === 0x7f000001);
  check('...with discovery control set to use only that server', pxe.pxeSub(v, 6) && pxe.pxeSub(v, 6)[0] === 7);
  check('...still never hands out an address, still echoes the machine ID', m.readUInt32BE(16) === 0 && optOf(m, 97) && optOf(m, 97).length === 17 && optOf(m, 60).toString() === 'PXEClient');
  m = await ask(3, P.dhcp);
  check('its ordinary address request on port 67 is left to the real DHCP server in this style', m === null);
  const item = Buffer.from([71, 4, 0, 7, 0, 0, 255]);
  m = await ask(3, P.pxe, 7, item);
  check('its boot server request on port 4011 gets the file name in an acknowledgement', m && optOf(m, 53)[0] === 5 && m.toString('latin1', 108, 120).startsWith('snponly.efi') && pxe.pxeSub(optOf(m, 43), 71) && pxe.pxeSub(optOf(m, 43), 71).equals(Buffer.from([0, 7, 0, 0])), m && m.toString('latin1', 108, 125));
  m = await ask(3, P.dhcp, 7, item);
  check('the same request broadcast to port 67 is answered too', m && optOf(m, 53)[0] === 5 && m.toString('latin1', 108, 120).startsWith('snponly.efi'), m && m.toString('latin1', 108, 125));
  const log = mod.status().log.map((x) => x.text || x.message || JSON.stringify(x)).join('\n');
  check('the log explains the change', /Now trying the classic boot-menu style/.test(log), log.slice(-300));
  for (let i = 0; i < 3; i++) m = await ask(1, P.dhcp);
  check('three more failed asks switch back to the short style, so both get tried', m && m.toString('latin1', 108, 120).startsWith('snponly.efi'), m && m.toString('latin1', 108, 125));
  m = await ask(1, P.dhcp, 0);
  check('BIOS computers are never given the menu style', m && m.toString('latin1', 108, 121) === 'undionly.kpxe');
  await mod.stop();
  console.log(failed ? 'FAILED ' + failed : 'All passed'); process.exit(failed ? 1 : 0);
})();
