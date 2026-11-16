'use strict';
//   sudo node test/secureboot-vm-test.js        (Linux, run as root; needs qemu-system-x86_64, OVMF, iproute2, dnsmasq, python3 + pycdlib)
// A real virtual computer with UEFI Secure Boot ON network-boots from Dashboard Hub: Hub's own DHCP, TFTP and web servers hand it
// Ubuntu's signed shim and grub and a boot menu; the firmware checks every signature. Then a signed kernel must be accepted and an
// unsigned one refused ("bad shim signature"). The signed Ubuntu files come from SB_DEB_DIR (shim-signed, grub-efi-amd64-signed and a
// linux-image .deb), or are fetched with "apt-get download". Not a real computer, but the real signed files and real Secure Boot firmware.
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const have = (c) => { try { sh('command -v ' + c); return true; } catch (e) { return false; } };
const CODE = '/usr/share/OVMF/OVMF_CODE_4M.secboot.fd', VARS = '/usr/share/OVMF/OVMF_VARS_4M.ms.fd';
const skip = (why) => { console.log('SKIPPED: ' + why); process.exit(0); };
if (process.platform !== 'linux' || process.getuid() !== 0) skip('needs Linux and root');
for (const c of ['qemu-system-x86_64', 'ip', 'dnsmasq', 'python3', 'dpkg-deb']) if (!have(c)) skip(c + ' is not installed');
if (!fs.existsSync(CODE) || !fs.existsSync(VARS)) skip('OVMF Secure Boot firmware (apt install ovmf) is not installed');
try { sh("python3 -c 'import pycdlib'"); } catch (e) { skip('python3 pycdlib is missing'); }
const pxe = require('../pxe.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbvm-'));

// ---- the signed files ----
let debDir = process.env.SB_DEB_DIR || path.join(tmp, 'debs');
function debsIn(d) { try { const f = fs.readdirSync(d); const g = (re) => f.filter((x) => re.test(x)).map((x) => path.join(d, x))[0]; return { shim: g(/^shim-signed.*\.deb$/), grub: g(/^grub-efi-amd64-signed.*\.deb$/), kern: g(/^linux-image-[0-9].*\.deb$/) }; } catch (e) { return {}; } }
let D = debsIn(debDir);
if (!D.shim || !D.grub || !D.kern) {
  fs.mkdirSync(debDir, { recursive: true });
  try { sh('cd ' + debDir + ' && apt-get download shim-signed grub-efi-amd64-signed $(apt-cache depends linux-image-generic | awk \'/Depends: linux-image-[0-9]/{print $2}\' | head -1) 2>&1'); } catch (e) { /* checked below */ }
  D = debsIn(debDir);
}
if (!D.shim || !D.grub || !D.kern) skip('the signed Ubuntu .deb files are not available (set SB_DEB_DIR)');
const unpack = (deb, inner) => sh('dpkg-deb --fsys-tarfile "' + deb + '" | tar -xO ' + inner + ' | sha256sum').split(' ')[0];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  // ---- 1. the downloader, against a local copy of an Ubuntu archive ----
  const mirrorDir = path.join(tmp, 'mirror'); fs.mkdirSync(path.join(mirrorDir, 'pool'), { recursive: true }); fs.mkdirSync(path.join(mirrorDir, 'dists/noble-updates/main/binary-amd64'), { recursive: true });
  const mkMirror = (breakShim) => {
    let list = '';
    [['shim-signed', D.shim], ['grub-efi-amd64-signed', D.grub]].forEach(([n, f]) => {
      const b = fs.readFileSync(f), name = 'pool/' + path.basename(f); fs.copyFileSync(f, path.join(mirrorDir, name));
      list += 'Package: ' + n + '\nVersion: ' + sh('dpkg-deb -f "' + f + '" Version').trim() + '\nFilename: ' + name + '\nSHA256: ' + (breakShim && n === 'shim-signed' ? '0'.repeat(64) : sha(b)) + '\n\n';
    });
    fs.writeFileSync(path.join(mirrorDir, 'dists/noble-updates/main/binary-amd64/Packages.gz'), require('zlib').gzipSync(list));
  };
  const srv = http.createServer((req, res) => { const f = path.join(mirrorDir, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(mirrorDir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const mirror = 'http://127.0.0.1:' + srv.address().port;
  const dataDir = path.join(tmp, 'hubdata'); fs.mkdirSync(dataDir);
  let mod = pxe.create({ dataDir, sbMirror: mirror });
  check('before the download: Secure Boot cannot be switched on', mod.setSecureBoot(true).ok === false && mod.status().secureBoot.ready === false);
  mkMirror(true);
  let r = await mod.getSecureBootFiles();
  check('a download that does not match the checksum is refused', r.ok === false && /checksum/.test(r.error), JSON.stringify(r));
  check('...and nothing is kept from it', !fs.existsSync(path.join(dataDir, 'secureboot', 'shimx64.efi')));
  mkMirror(false);
  r = await mod.getSecureBootFiles();
  check('the real signed Ubuntu files are downloaded, checked and unpacked', r.ok === true, JSON.stringify(r));
  const sbd = path.join(dataDir, 'secureboot');
  check('shim is exactly the file inside Ubuntu\'s package', sha(fs.readFileSync(path.join(sbd, 'shimx64.efi'))) === unpack(D.shim, './usr/lib/shim/shimx64.efi.signed.latest'));
  check('grub is exactly the network grub inside Ubuntu\'s package', sha(fs.readFileSync(path.join(sbd, 'grubx64.efi'))) === unpack(D.grub, './usr/lib/grub/x86_64-efi-signed/grubnetx64.efi.signed'));
  check('Secure Boot can now be switched on', mod.setSecureBoot(true).ok && mod.status().secureBoot.on === true);
  mod = pxe.create({ dataDir, sbMirror: mirror });
  check('after a restart the files and the switch are remembered', mod.status().secureBoot.on === true && mod.status().secureBoot.ready === true);
  srv.close();

  // ---- 2. a virtual network ----
  const MAC = '52:54:00:12:34:56';
  const net = (c) => { try { sh(c); } catch (e) { /* best effort */ } };
  const cleanup = () => { net('pkill -f "dnsmasq.*hubdhcp-test"'); net('pkill -f "qemu-system-x86_64.*sbvm"'); net('ip netns del hubdhcp'); net('ip link del tapsb0'); net('ip link del hubbr0'); };
  cleanup();
  sh('ip link add hubbr0 type bridge && ip addr add 10.77.0.1/24 dev hubbr0 && ip link set hubbr0 up');
  net('ip route add 255.255.255.255/32 dev hubbr0');   // like a computer whose only network is this one: broadcasts must leave on the virtual network, not on this machine's default one
  sh('ip tuntap add dev tapsb0 mode tap && ip link set tapsb0 master hubbr0 && ip link set tapsb0 up');
  sh('ip netns add hubdhcp && ip link add vethh type veth peer name vethd && ip link set vethd netns hubdhcp && ip link set vethh master hubbr0 && ip link set vethh up');
  sh('ip netns exec hubdhcp sh -c "ip addr add 10.77.0.2/24 dev vethd && ip link set vethd up && ip link set lo up"');
  const dm = cp.spawn('ip', ['netns', 'exec', 'hubdhcp', 'dnsmasq', '--conf-file=/dev/null', '--no-daemon', '--interface=vethd', '--bind-interfaces', '--dhcp-range=10.77.0.100,10.77.0.110,1h', '--pid-file=/tmp/hubdhcp-test.pid', '--log-facility=-'], { stdio: 'ignore' });

  // ---- 3. test discs: a signed kernel and an unsigned one ----
  const kern = path.join(tmp, 'kern'); fs.mkdirSync(kern);
  sh('dpkg-deb --fsys-tarfile "' + D.kern + '" | tar -xO ./boot/vmlinuz-* 2>/dev/null > ' + path.join(kern, 'signed') + ' || true');
  if (!fs.existsSync(path.join(kern, 'signed')) || fs.statSync(path.join(kern, 'signed')).size < 1e6) sh('cd ' + kern + ' && dpkg-deb -x "' + D.kern + '" x && cp x/boot/vmlinuz-* signed');
  fs.writeFileSync(path.join(kern, 'bad'), crypto.randomBytes(3e6)); fs.writeFileSync(path.join(kern, 'initrd'), crypto.randomBytes(200000));
  const mkIso = (out, k) => sh("python3 -I -c \"import pycdlib,sys; i=pycdlib.PyCdlib(); i.new(interchange_level=3, rock_ridge='1.09', vol_ident='UBU'); i.add_directory('/CASPER', rr_name='casper'); i.add_file(sys.argv[1], '/CASPER/VMLINUZ.;1', rr_name='vmlinuz'); i.add_file(sys.argv[2], '/CASPER/INITRD.;1', rr_name='initrd'); i.write(sys.argv[3]); i.close()\" " + k + ' ' + path.join(kern, 'initrd') + ' ' + out);
  mkIso(path.join(tmp, 'good.iso'), path.join(kern, 'signed')); mkIso(path.join(tmp, 'bad.iso'), path.join(kern, 'bad'));

  const seen = []; const origCreate = http.createServer; http.createServer = function (...a) { const s = origCreate.apply(this, a); s.on('request', (q) => seen.push(q.url)); return s; };
  const P = { http: 18099 };
  const hub = pxe.create({ dataDir, ports: P });
  hub.setAllow({ macs: [MAC], any: false });
  const g = hub.addIso(path.join(tmp, 'good.iso')), b = hub.addIso(path.join(tmp, 'bad.iso'));
  check('the two test discs are added as Ubuntu-style discs', g.ok && b.ok && hub.status().isos.every((x) => x.mode === 'casper'), JSON.stringify(hub.status().isos));
  const gid = hub.status().isos[0].id, bid = hub.status().isos[1].id;
  const st = await hub.start({ ip: '10.77.0.1' });
  check('Hub starts on the virtual network', st.ok, JSON.stringify(st));
  http.createServer = origCreate;

  async function boot(label, isoId, expectOk) {
    seen.length = 0; hub.setChoice(MAC, 'iso:' + isoId);
    const vars = path.join(tmp, 'vars-' + label + '.fd'), serial = path.join(tmp, 'serial-' + label + '.log');
    fs.copyFileSync(VARS, vars); fs.writeFileSync(serial, '');
    const q = cp.spawn('qemu-system-x86_64', ['-name', 'sbvm', '-machine', 'q35', '-m', '2048', '-accel', 'tcg', '-cpu', 'max', '-nographic', '-serial', 'file:' + serial, '-monitor', 'none', '-drive', 'if=pflash,format=raw,readonly=on,file=' + CODE, '-drive', 'if=pflash,format=raw,file=' + vars, '-netdev', 'tap,id=n0,ifname=tapsb0,script=no,downscript=no', '-device', 'virtio-net-pci,netdev=n0,mac=' + MAC, '-boot', 'order=n'], { stdio: 'ignore' });
    const t0 = Date.now(); let text = '';
    while (Date.now() - t0 < Number(process.env.SB_BOOT_MS || 300000)) {
      await sleep(3000); text = fs.readFileSync(serial, 'latin1');
      if (/No bootable option or device was found/.test(text) && Date.now() - t0 > 20000) break;   // every way of starting has failed: no point waiting longer
      if (expectOk ? seen.some((u) => /\/iso\/[a-z0-9]+\/f.*initrd/i.test(u)) : /bad shim signature/.test(text)) break;
    }
    await sleep(2000); text = fs.readFileSync(serial, 'latin1'); q.kill('SIGKILL'); await sleep(500);
    return text;
  }
  let text = await boot('good', gid, true);
  check('the firmware accepted Hub\'s shim and grub (Secure Boot ON)', /Fetching Netboot Image grubx64\.efi/.test(text) && /GNU GRUB/.test(text), text.slice(-400));
  check('Hub offered the signed boot program (shimx64.efi) to the UEFI computer', hub.status().log.some((l) => /shimx64\.efi/.test(JSON.stringify(l))), JSON.stringify(hub.status().log.slice(-6)));
  check('grub read its menu from Hub (grub/grub.cfg)', seen.length > 0, JSON.stringify(seen.slice(0, 5)));
  const kernelAsked = seen.findIndex((u) => /\/iso\/[a-z0-9]+\/f.*vmlinuz/i.test(u)), initrdAsked = seen.findIndex((u) => /\/iso\/[a-z0-9]+\/f.*initrd/i.test(u));
  check('SIGNED kernel: grub downloaded it from Hub and Secure Boot accepted it (the initrd was asked for next)', kernelAsked >= 0 && initrdAsked > kernelAsked && !/bad shim signature/.test(text), JSON.stringify({ seen: seen.slice(0, 6), tail: text.slice(-300) }));
  text = await boot('bad', bid, false);
  const initrdBad = seen.some((u) => /\/iso\/[a-z0-9]+\/f.*initrd/i.test(u));
  check('UNSIGNED kernel: Secure Boot refused it ("bad shim signature")', /bad shim signature/.test(text), text.slice(-400));
  check('...and the computer never went on to load its initrd', !initrdBad);

  await hub.stop(); dm.kill(); cleanup();
  console.log(fail ? fail + ' failed' : 'All ' + pass + ' passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + (e && e.stack || e)); try { cp.execSync('pkill -f "qemu-system-x86_64.*sbvm"; ip netns del hubdhcp; ip link del tapsb0; ip link del hubbr0', { stdio: 'ignore' }); } catch (x) { /* ignore */ } process.exit(1); });
