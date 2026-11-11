'use strict';
//   node test/pxe-win-test.js   (a Windows-style disc, including one whose real file list is only in the Joliet part)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), cp = require('child_process');
const pxe = require('../pxe.js');
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? '  ok    ' : '  FAIL  ') + n + (ok ? '' : '   -> ' + d)); if (!ok) failed++; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxew-'));
  const WIM = Buffer.from('MSWIM-test-'.repeat(500)); fs.writeFileSync(path.join(tmp, 'w'), WIM); fs.writeFileSync(path.join(tmp, 's'), 'setup');
  cp.execFileSync('python3', ['-I', '-c', `
import pycdlib, sys
t = sys.argv[1]
# plain: files are in the normal tree
iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, vol_ident='WIN_PLAIN')
iso.add_directory('/SOURCES'); iso.add_file(t + '/w', '/SOURCES/BOOT.WIM;1'); iso.add_file(t + '/s', '/SETUP.EXE;1')
iso.write(t + '/plain.iso'); iso.close()
# joliet only: the normal tree has just a readme, like some official discs
iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, joliet=3, vol_ident='WIN-TEST')
iso.add_file(t + '/s', '/README.TXT;1', joliet_path='/readme.txt')
iso.add_directory('/SRC', joliet_path='/sources'); iso.add_file(t + '/w', '/SRC/B.WIM;1', joliet_path='/sources/boot.wim'); iso.add_file(t + '/s', '/SETUP.EXE;1', joliet_path='/setup.exe')
iso.write(t + '/joliet.iso'); iso.close()
`, tmp]);
  const a = pxe.analyzeIso(path.join(tmp, 'plain.iso')), b = pxe.analyzeIso(path.join(tmp, 'joliet.iso'));
  check('plain Windows disc recognised', a.mode === 'windows' && a.kernel === '/sources/boot.wim', JSON.stringify(a));
  check('Joliet-only Windows disc recognised too', b.mode === 'windows', JSON.stringify(b));
  const P = { dhcp: 16767, pxe: 14011, tftp: 16769, http: 18091 };
  const mod = pxe.create({ dataDir: tmp, ports: P });
  mod.setAllow({ macs: [], any: true });
  check('server starts', (await mod.start({ ip: '127.0.0.1' })).ok);
  check('discs added', mod.addIso(path.join(tmp, 'plain.iso')).ok && mod.addIso(path.join(tmp, 'joliet.iso')).ok);
  const isos = mod.status().isos;
  const get = (u, hdr) => new Promise((res) => http.get({ host: '127.0.0.1', port: P.http, path: u, headers: hdr || {} }, (q) => { const c = []; q.on('data', (x) => c.push(x)); q.on('end', () => res({ s: q.statusCode, buf: Buffer.concat(c), body: Buffer.concat(c).toString('latin1') })); }).on('error', () => res({ s: 0, body: '', buf: Buffer.alloc(0) })));
  let r = await get('/win/' + isos[0].id + '/hubsetup.cmd'); check('setup script is withheld until the share is saved', r.s === 404);
  check('bad share address refused', /share address/.test(mod.setWinShare({ unc: 'C:\\x', user: 'a' }).error || ''));
  check('share address with spaces/quotes refused', !mod.setWinShare({ unc: '\\\\pc\\a b"c', user: 'a' }).ok);
  check('bad account refused', !mod.setWinShare({ unc: '\\\\192.168.1.10\\WinSetup', user: 'a b&c' }).ok);
  check('good share saved', mod.setWinShare({ unc: '\\\\192.168.1.10\\WinSetup', user: 'MYPC\\hubsetup', bypass: true }).ok && mod.status().winShare.bypass === true);
  const menu = (await get('/boot.ipxe')).body;
  check('menu boots Windows with wimboot, boot.wim and the two scripts', menu.includes('kernel ${base}/wimboot') && new RegExp('initrd \\$\\{base\\}/iso/' + isos[0].id + '/f/sources/boot\\.wim boot\\.wim').test(menu) && menu.includes('/win/' + isos[0].id + '/winpeshl.ini winpeshl.ini') && menu.includes('/win/' + isos[0].id + '/hubsetup.cmd hubsetup.cmd'), menu);
  r = await get('/wimboot'); check('wimboot is served whole', r.s === 200 && r.buf.length > 20000 && r.buf.subarray(0, 4).toString('latin1') !== '', r.s + ' ' + r.buf.length);
  r = await get('/iso/' + isos[0].id + '/f/sources/boot.wim'); check('boot.wim is read from the disc, byte for byte', r.s === 200 && r.buf.equals(WIM), r.s);
  r = await get('/iso/' + isos[1].id + '/f/sources/boot.wim'); check('...also from a Joliet-only disc', r.s === 200 && r.buf.equals(WIM), r.s + ' ' + r.buf.length);
  r = await get('/win/' + isos[0].id + '/winpeshl.ini'); check('winpeshl.ini starts networking, then our script', r.s === 200 && /\[LaunchApps\]/.test(r.body) && /wpeinit\.exe/i.test(r.body) && /hubsetup\.cmd/.test(r.body), r.body);
  r = await get('/win/' + isos[0].id + '/hubsetup.cmd');
  check('hubsetup.cmd connects to the share, asks for the password, runs Setup', r.s === 200 && /net use Z: \\\\192\.168\.1\.10\\WinSetup \/user:MYPC\\hubsetup \*/.test(r.body) && /Z:\\setup\.exe/.test(r.body) && /autounattend\.xml/.test(r.body) && !/password:/i.test(r.body.replace(/Type that.*password when asked/, '')), r.body);
  check('...with the Windows 11 checks skipped when asked', /BypassTPMCheck/.test(r.body) && /BypassSecureBootCheck/.test(r.body));
  mod.setWinShare({ unc: '\\\\192.168.1.10\\WinSetup', user: 'MYPC\\hubsetup', bypass: false }); r = await get('/win/' + isos[0].id + '/hubsetup.cmd'); check('...and not when not asked', !/Bypass/.test(r.body));
  check('script uses Windows line endings', /\r\n/.test(r.body));
  r = await get('/win/' + isos[0].id + '/evil.cmd'); check('other names under /win are refused', r.s === 404);
  await mod.stop();
  console.log(failed ? 'FAILED ' + failed : 'All passed'); process.exit(failed ? 1 : 0);
})();
