'use strict';
//   node test/pxe-auto-test.js   (unattended install answers; no window needed)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), cp = require('child_process');
const pxe = require('../pxe.js');
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? '  ok    ' : '  FAIL  ') + n + (ok ? '' : '   -> ' + d)); if (!ok) failed++; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxea-'));
  fs.writeFileSync(path.join(tmp, 'f'), Buffer.from('x'.repeat(3000)));
  cp.execFileSync('python3', ['-I', '-c', `
import pycdlib, sys
t = sys.argv[1]
def mk(out, dirs, files):
    iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, rock_ridge='1.09', vol_ident='T')
    for p, rr in dirs: iso.add_directory(p, rr_name=rr)
    for p, rr in files: iso.add_file(t + '/f', p, rr_name=rr)
    iso.write(out); iso.close()
mk(t + '/ub.iso', [('/CASPER', 'casper')], [('/CASPER/VMLINUZ.;1', 'vmlinuz'), ('/CASPER/INITRD.;1', 'initrd')])
mk(t + '/rk.iso', [('/IMAGES', 'images'), ('/IMAGES/PXEBOOT', 'pxeboot'), ('/BASEOS', 'BaseOS')], [('/IMAGES/INSTALL.IMG;1', 'install.img'), ('/IMAGES/PXEBOOT/VMLINUZ.;1', 'vmlinuz'), ('/IMAGES/PXEBOOT/INITRD.IMG;1', 'initrd.img')])
mk(t + '/pl.iso', [('/README', 'readme')], [('/README/HELLO.TXT;1', 'hello.txt')])
`, tmp]);
  // password hash agrees with the system's own tool
  const want = cp.execFileSync('openssl', ['passwd', '-6', '-salt', 'abcdefgh', 'Pa$$w0rd!']).toString().trim();
  check('password hash matches openssl', pxe.sha512crypt('Pa$$w0rd!', 'abcdefgh') === want, pxe.sha512crypt('Pa$$w0rd!', 'abcdefgh'));
  const MAC = 'aa:bb:cc:00:00:01', OTHER = 'aa:bb:cc:00:00:02';
  const P = { dhcp: 16767, pxe: 14011, tftp: 16769, http: 18090 };
  const mod = pxe.create({ dataDir: tmp, ports: P });
  mod.setAllow({ macs: [MAC, OTHER], any: false });
  check('server starts', (await mod.start({ ip: '127.0.0.1' })).ok);
  check('ISOs added', mod.addIso(path.join(tmp, 'ub.iso')).ok && mod.addIso(path.join(tmp, 'rk.iso')).ok && mod.addIso(path.join(tmp, 'pl.iso')).ok);
  const isos = mod.status().isos, ub = isos[0], rk = isos[1], pl = isos[2];
  check('unattended is refused until answers are saved', !mod.setChoice(MAC, 'iso:' + ub.id + ':auto').ok);
  check('bad user name refused', /user name/.test(mod.setAnswers({ username: 'Bad Name', password: 'x', hostname: 'h1', timezone: 'UTC', keyboard: 'us' }).error || ''));
  check('bad host name refused', /computer name/.test(mod.setAnswers({ username: 'admin', password: 'x', hostname: 'bad_host!', timezone: 'UTC', keyboard: 'us' }).error || ''));
  check('bad time zone refused', !mod.setAnswers({ username: 'admin', password: 'x', hostname: 'h1', timezone: '../../etc', keyboard: 'us' }).ok);
  check('missing password refused the first time', !mod.setAnswers({ username: 'admin', password: '', hostname: 'h1', timezone: 'UTC', keyboard: 'us' }).ok);
  check('good answers saved', mod.setAnswers({ username: 'admin', password: 'Sup3r secret', hostname: 'srv1', timezone: 'America/New_York', keyboard: 'us' }).ok);
  const sj = JSON.stringify(mod.status());
  check('status never shows the hash or password', !/\$6\$|Sup3r/.test(sj) && mod.status().answers.hasPassword === true, sj.slice(0, 200));
  check('saved file holds a hash, not the password', (() => { const t = fs.readFileSync(path.join(tmp, fs.readdirSync(tmp).find((x) => /\.json$/.test(x))), 'utf8'); return /\$6\$/.test(t) && !/Sup3r/.test(t); })());
  check('password can stay empty later (keeps the old hash)', mod.setAnswers({ username: 'admin', password: '', hostname: 'srv2', timezone: 'UTC', keyboard: 'us' }).ok);
  check('unattended refused for a generic ISO', !mod.setChoice(MAC, 'iso:' + pl.id + ':auto').ok);
  check('unattended accepted for Ubuntu and Rocky style', mod.setChoice(MAC, 'iso:' + ub.id + ':auto').ok && mod.setChoice(OTHER, 'iso:' + rk.id + ':auto').ok);
  const get = (u) => new Promise((res) => http.get({ host: '127.0.0.1', port: P.http, path: u }, (q) => { const c = []; q.on('data', (x) => c.push(x)); q.on('end', () => res({ s: q.statusCode, body: Buffer.concat(c).toString() })); }).on('error', () => res({ s: 0, body: '' })));
  const menu = (await get('/boot.ipxe')).body;
  check('menu does NOT list the unattended entries as pickable items', !/item iso\w+auto/.test(menu), menu.slice(0, 600));
  check('menu has the hidden Ubuntu autoinstall entry with this computer\'s own answer address', menu.includes(':iso' + ub.id + 'auto') && menu.includes('autoinstall ds=nocloud-net;s=${base}/auto/' + ub.id + '/${net0/mac:hexhyp}/'), menu);
  check('menu has the Rocky kickstart entry', menu.includes('inst.ks=${base}/auto/' + rk.id + '/${net0/mac:hexhyp}/ks.cfg'));
  check('Ubuntu auto entry does not carry the old cloud-config-url=/dev/null', !/auto[\s\S]*?cloud-config-url=\/dev\/null[\s\S]*?:iso\w+auto/.test(menu.split(':iso' + ub.id + 'auto')[1].split(':netbootxyz')[0].split('\n').slice(0, 3).join('\n').replace(/^.*$/m, (l) => l)) || !menu.split(':iso' + ub.id + 'auto')[1].split('\n')[2].includes('/dev/null'));
  check('each computer is sent to its own entry', menu.includes('iseq ${net0/mac} ' + MAC) && menu.includes('set dflt iso' + ub.id + 'auto') && menu.includes('set dflt iso' + rk.id + 'auto'));
  const dash = MAC.replace(/:/g, '-');
  let r = await get('/auto/' + ub.id + '/' + dash + '/user-data');
  check('Ubuntu answers are served', r.s === 200 && /#cloud-config/.test(r.body) && /autoinstall:/.test(r.body) && /hostname: srv2, username: admin/.test(r.body) && /\$6\$/.test(r.body) && /timezone: UTC/.test(r.body), r.s + r.body);
  check('...and it is a one-shot: the computer now starts from its own disk', mod.status().allow.choice[MAC] === 'local', JSON.stringify(mod.status().allow.choice));
  r = await get('/auto/' + ub.id + '/' + dash + '/user-data'); check('...but a second fetch within 30 minutes still works (cloud-init asks more than once)', r.s === 200);
  r = await get('/auto/' + ub.id + '/' + dash + '/meta-data'); check('meta-data served', r.s === 200 && /instance-id:/.test(r.body));
  r = await get('/auto/' + ub.id + '/' + OTHER.replace(/:/g, '-') + '/user-data'); check('another computer cannot fetch Ubuntu answers (its choice is the Rocky one)', r.s === 404);
  r = await get('/auto/' + rk.id + '/' + OTHER.replace(/:/g, '-') + '/ks.cfg');
  check('Rocky kickstart is served with a hashed password and disk wipe', r.s === 200 && /^rootpw --lock/m.test(r.body) && /--iscrypted --password=\$6\$/.test(r.body) && /clearpart --all/.test(r.body) && /^url --url=http:\/\/127\.0\.0\.1:18090\/iso\/\w+\/f$/m.test(r.body), r.s + r.body);
  r = await get('/auto/' + rk.id + '/' + MAC.replace(/:/g, '-') + '/ks.cfg'); check('a computer with no unattended choice gets nothing', r.s === 404);
  r = await get('/auto/' + pl.id + '/' + dash + '/user-data'); check('generic ISOs never get answers', r.s === 404);
  check('removing an ISO clears unattended choices that used it', (mod.setChoice(MAC, 'iso:' + ub.id + ':auto'), mod.removeIso(ub.id).ok && mod.status().allow.choice[MAC] === undefined));
  await mod.stop();
  console.log(failed ? 'FAILED ' + failed : 'All passed'); process.exit(failed ? 1 : 0);
})();
