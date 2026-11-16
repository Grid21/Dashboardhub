'use strict';
//   node test/pxe-disk-test.js    (needs sh, and ksvalidator from "pip install pykickstart" for the answer-file check)
// Disk choice and UEFI/BIOS partitions in the unattended-install answers. The small script that runs inside the Rocky/Alma
// installer is really executed here, with a pretend lsblk and a pretend /sys/firmware/efi.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const pxe = require('../pxe');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -> ' + d : '')); } };
const base = { username: 'admin', hostname: 'srv1', timezone: 'UTC', keyboard: 'us', hash: '$6$abc$def' };
const ans = (o) => Object.assign({}, base, o);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));

// ---- defaults must be exactly what earlier versions wrote ----
const oldKs = ['text', 'reboot', '# no packages on this disc: the installer picks an online mirror', 'lang en_US.UTF-8', "keyboard --xlayouts='us'", 'timezone UTC --utc', 'network --bootproto=dhcp --hostname=srv1 --activate', 'rootpw --lock',
  'user --name=admin --groups=wheel --iscrypted --password=$6$abc$def', 'zerombr', 'clearpart --all --initlabel', 'autopart', 'firstboot --disable', '%packages', '@^minimal-environment', '%end', ''].join('\n');
check('default settings give exactly the same Rocky/Alma answer file as before', pxe.kickstartText(ans({ layout: 'auto', disk: 'auto' }), 'x', false) === oldKs);
check('old saved answers (no disk/layout fields) give the same file too', pxe.kickstartText(ans({}), 'x', false) === oldKs);
check('default Ubuntu storage is unchanged', /  storage: \{layout: \{name: direct\}\}\n/.test(pxe.userDataText(ans({ disk: 'auto' }), 'x')));

// ---- checking what is typed in ----
const bad = ['../x', 'sda; reboot', '/dev/sda', 'sda sdb', '$(id)', 'x', '', 'nvme0', 'sd', 'LARGEST ONE'];
const clean = (disk) => pxe.cleanAnswers({ username: 'admin', password: 'pw123456', hostname: 'srv1', timezone: 'UTC', keyboard: 'us', layout: 'simple', disk: disk }, null);
check('wrong disk names are refused (' + bad.filter((b) => b !== '').length + ' tried)', bad.filter((b) => b !== '').every((b) => !!clean(b).error), JSON.stringify(bad.filter((b) => !clean(b).error)));
check('good disk names are accepted', ['sda', 'sdb', 'vda', 'nvme0n1', 'nvme1n2', 'mmcblk0', 'xvda', 'largest', 'auto'].every((g) => !clean(g).error && clean(g).answers.disk === g));
check('an empty disk means automatic', clean('').answers.disk === 'auto');
check('wrong layout is refused', !!pxe.cleanAnswers({ username: 'admin', password: 'pw123456', hostname: 'srv1', timezone: 'UTC', keyboard: 'us', layout: 'weird', disk: 'auto' }, null).error);

// ---- Ubuntu ----
check('Ubuntu: largest disk', /\{layout: \{name: direct, match: \{size: largest\}\}\}/.test(pxe.userDataText(ans({ disk: 'largest' }), 'x')));
check('Ubuntu: named disk', /\{layout: \{name: direct, match: \{path: \/dev\/nvme0n1\}\}\}/.test(pxe.userDataText(ans({ disk: 'nvme0n1' }), 'x')));
check('Ubuntu: a bad stored disk name is ignored, not written', /\{layout: \{name: direct\}\}/.test(pxe.userDataText(ans({ disk: 'a; rm -rf /' }), 'x')));

// ---- Rocky / Alma / Fedora: pull out the little script and run it ----
function pre(a) { const t = pxe.kickstartText(a, 'x', false); const m = /%pre[^\n]*\n([\s\S]*?)\n%end/.exec(t); return { text: t, script: m ? m[1] : null }; }
function run(a, o) {
  const p = pre(a); if (!p.script) return { none: true };
  const dev = path.join(tmp, 'dev-' + Math.random().toString(36).slice(2)), sys = path.join(tmp, 'sys-' + Math.random().toString(36).slice(2)), out = path.join(tmp, 'part-' + Math.random().toString(36).slice(2)), bin = path.join(tmp, 'bin-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dev); fs.mkdirSync(bin); (o.disks || []).forEach((d) => fs.writeFileSync(path.join(dev, d.n), ''));
  if (o.efi) fs.mkdirSync(sys);
  fs.writeFileSync(path.join(bin, 'lsblk'), '#!/bin/sh\n' + (o.disks || []).map((d) => 'echo "' + d.n + ' ' + d.size + ' ' + (d.type || 'disk') + ' ' + (d.rm || 0) + '"').join('\n') + '\n', { mode: 0o755 });
  const script = p.script.split('/sys/firmware/efi').join(sys).split('/tmp/hub-part').join(out).split('[ ! -b "/dev/$DISK" ]').join('[ ! -e "' + dev + '/$DISK" ]');
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { PATH: bin + path.delimiter + process.env.PATH } });
  return { code: r.status, err: r.stderr, part: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null, text: p.text };
}
const disks = [{ n: 'sda', size: 500107862016 }, { n: 'nvme0n1', size: 1000204886016 }, { n: 'sdb', size: 4000787030016, rm: 1 }, { n: 'sr0', size: 1073741312, type: 'rom', rm: 1 }, { n: 'loop0', size: 9999999999999, type: 'loop' }];
let r = run(ans({ disk: 'largest', layout: 'simple' }), { efi: true, disks });
check('UEFI + largest disk: picks the biggest internal disk (not the USB stick, not the loop device)', r.code === 0 && /clearpart --all --initlabel --disklabel=gpt --drives=nvme0n1/.test(r.part) && /ignoredisk --only-use=nvme0n1/.test(r.part), JSON.stringify(r));
check('UEFI + simple: EFI partition, /boot, one big root, all on that disk', /part \/boot\/efi --fstype=efi --size=600 --ondisk=nvme0n1/.test(r.part) && /part \/boot --fstype=xfs --size=1024 --ondisk=nvme0n1/.test(r.part) && /part \/ --fstype=xfs --size=1 --grow --ondisk=nvme0n1/.test(r.part) && !/biosboot/.test(r.part), r.part);
check('it says which mode it found', /installing in efi mode on \/dev\/nvme0n1/.test(r.err), r.err);
r = run(ans({ disk: 'largest', layout: 'simple' }), { efi: false, disks });
check('BIOS + simple: BIOS boot partition, /boot, root, boot loader on the disk, no EFI partition', /part biosboot --fstype=biosboot --size=1 --ondisk=nvme0n1/.test(r.part) && /bootloader --location=mbr --boot-drive=nvme0n1/.test(r.part) && !/\/boot\/efi/.test(r.part), r.part);
r = run(ans({ disk: 'sda', layout: 'auto' }), { efi: true, disks });
check('named disk + automatic layout: only that disk, installer partitions it', r.code === 0 && /ignoredisk --only-use=sda/.test(r.part) && /autopart/.test(r.part) && !/part \//.test(r.part), r.part);
r = run(ans({ disk: 'sdz', layout: 'simple' }), { efi: true, disks });
check('a named disk that is not there stops the install and erases nothing', r.code === 1 && r.part === null && /Nothing was erased/.test(r.err), JSON.stringify(r));
r = run(ans({ disk: 'largest', layout: 'simple' }), { efi: true, disks: [{ n: 'sdb', size: 100, rm: 1 }] });
check('"largest" with only a USB stick present stops and erases nothing', r.code === 1 && r.part === null, JSON.stringify(r));
r = run(ans({ disk: 'auto', layout: 'simple' }), { efi: true, disks });
check('any disk + simple layout in UEFI mode still works', r.code === 0 && /part \/boot\/efi --fstype=efi --size=600\n/.test(r.part) && /clearpart --all --initlabel --disklabel=gpt\n/.test(r.part), r.part);

// ---- the answer files are valid Kickstart ----
const v = spawnSync('ksvalidator', ['--version'], { encoding: 'utf8' });
if (v.error) { console.log('  (ksvalidator is not installed: skipping the Kickstart syntax check)'); }
else {
  const combos = [{ disk: 'auto', layout: 'auto' }, { disk: 'auto', layout: 'simple' }, { disk: 'largest', layout: 'simple' }, { disk: 'sda', layout: 'auto' }, { disk: 'nvme0n1', layout: 'simple' }];
  let bad2 = [];
  combos.forEach((c) => ['efi', 'bios'].forEach((mode) => {
    // what the installer ends up reading: the answer file with the generated partition lines in place of the include
    let t = pxe.kickstartText(ans(c), 'http://x/f', true);
    if (/%pre/.test(t)) {
      const parts = new RegExp('(?:if \\[ "\\$MODE" = efi \\]; then|else)\\ncat > /tmp/hub-part <<HUBEOF\\n([\\s\\S]*?)\\nHUBEOF', 'g'); let m, found = [];
      while ((m = parts.exec(t))) found.push(m[1]);
      const lines = (mode === 'efi' ? found[0] : found[1]).replace(/\$DISK/g, c.disk === 'largest' ? 'nvme0n1' : c.disk);
      t = t.replace(/%pre[\s\S]*?%end\n%include \/tmp\/hub-part/, lines);
    }
    const f = path.join(tmp, 'k.cfg'); fs.writeFileSync(f, t);
    const k = spawnSync('ksvalidator', ['-v', 'RHEL9', f], { encoding: 'utf8' });
    if (k.status !== 0) bad2.push(JSON.stringify(c) + ' ' + mode + ': ' + (k.stderr || k.stdout).slice(0, 200));
  }));
  check('every disk/layout combination is valid Kickstart (UEFI and BIOS versions, checked with ksvalidator)', bad2.length === 0, bad2.join(' | '));
}
console.log(fail ? fail + ' failed' : 'All ' + pass + ' passed'); process.exit(fail ? 1 : 0);
