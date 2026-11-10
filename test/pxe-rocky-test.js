'use strict';
//   node test/pxe-rocky-test.js   (a tiny Rocky/Alma-style ISO; no window needed)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), cp = require('child_process');
const pxe = require('../pxe.js');
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? '  ok    ' : '  FAIL  ') + n + (ok ? '' : '   -> ' + d)); if (!ok) failed++; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxer-'));
  fs.writeFileSync(path.join(tmp, 'f'), Buffer.from('hello-rocky'));
  const make = (name, withRepo) => cp.execFileSync('python3', ['-I', '-c', `
import pycdlib, sys
iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, rock_ridge='1.09', vol_ident='Rocky-9-test')
def d(path, rr): iso.add_directory(path, rr_name=rr)
d('/IMAGES','images'); d('/IMAGES/PXEBOOT','pxeboot')
if sys.argv[3] == '1': d('/BASEOS','BaseOS')
f = sys.argv[1] + '/f'
iso.add_file(f, '/IMAGES/INSTALL.IMG;1', rr_name='install.img')
iso.add_file(f, '/IMAGES/PXEBOOT/VMLINUZ.;1', rr_name='vmlinuz')
iso.add_file(f, '/IMAGES/PXEBOOT/INITRD.IMG;1', rr_name='initrd.img')
iso.add_file(f, '/TREEINFO.;1', rr_name='.treeinfo')
iso.write(sys.argv[2]); iso.close()`, tmp, path.join(tmp, name), withRepo ? '1' : '0']);
  make('dvd.iso', true); make('boot.iso', false);
  const a = pxe.analyzeIso(path.join(tmp, 'dvd.iso')), b = pxe.analyzeIso(path.join(tmp, 'boot.iso'));
  check('DVD-style ISO recognised as anaconda with packages', a.mode === 'anaconda' && a.repo === true && a.kernel === '/images/pxeboot/vmlinuz' && a.initrd === '/images/pxeboot/initrd.img', JSON.stringify(a));
  check('boot-style ISO recognised, no packages', b.mode === 'anaconda' && b.repo === false, JSON.stringify(b));
  const P = { dhcp: 16767, pxe: 14011, tftp: 16769, http: 18089 };
  const mod = pxe.create({ dataDir: tmp, ports: P });
  mod.setAllow({ macs: [], any: true });
  const r = await mod.start({ ip: '127.0.0.1' }); check('server starts', r.ok, JSON.stringify(r));
  check('both ISOs added', mod.addIso(path.join(tmp, 'dvd.iso')).ok && mod.addIso(path.join(tmp, 'boot.iso')).ok);
  const get = (u) => new Promise((res) => http.get({ host: '127.0.0.1', port: P.http, path: u }, (q) => { const c = []; q.on('data', (x) => c.push(x)); q.on('end', () => res({ s: q.statusCode, body: Buffer.concat(c).toString() })); }).on('error', () => res({ s: 0, body: '' })));
  const m = await get('/boot.ipxe');
  check('menu has inst.stage2 and ip=dhcp', /kernel \$\{base\}\/iso\/\w+\/f\/images\/pxeboot\/vmlinuz inst\.stage2=\$\{base\}\/iso\/\w+\/f( inst\.repo=\S+)? ip=dhcp/.test(m.body), m.body.slice(0, 900));
  check('inst.repo only for the disc that has packages', (m.body.match(/inst\.repo=/g) || []).length === 1, m.body.slice(0, 900));
  const id = mod.status().isos[0].id;
  const t = await get('/iso/' + id + '/f/.treeinfo'); check('.treeinfo and install.img are served from inside the ISO', t.s === 200 && t.body === 'hello-rocky' && (await get('/iso/' + id + '/f/images/install.img')).s === 200, t.s);
  await mod.stop();
  console.log(failed ? 'FAILED ' + failed : 'All passed'); process.exit(failed ? 1 : 0);
})();
