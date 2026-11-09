'use strict';
//   xvfb-run -a node test/shares-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const sc = require(path.join(ROOT, 'scanner.js'));
  const win = ['Shared resources at \\\\10.7.0.30', '', 'Share name  Type  Used as  Comment', '-------------------------------------------------------------------------------', 'Movies      Disk           Family movies', 'Printer1    Print          Office printer', 'Users       Disk', 'The command completed successfully.'].join('\r\n');
  const w = sc.parseNetView ? sc.parseNetView(win) : null;
  check('Windows "net view" output is read', w && w.length === 3 && w[0].name === 'Movies' && w[0].comment === 'Family movies' && w[1].type === 'Print' && w[2].name === 'Users', JSON.stringify(w));
  const mac = ['Share                                           Type    Comments', '-------------------------------', 'Public                                          Disk    Shared files', 'IPC$                                            Pipe    IPC Service', '2 shares listed'].join('\n');
  const m = sc.parseSmbutil(mac);
  check('macOS "smbutil" output is read', m.length === 2 && m[0].name === 'Public' && m[0].comment === 'Shared files', JSON.stringify(m));
  const sm = sc.parseSmbclientG('Disk|media|My media\nPrinter|hp|HP\nIPC|IPC$|IPC Service (Samba)\nSMB1 disabled');
  check('Linux "smbclient" output is read', sm.length === 3 && sm[0].name === 'media' && sm[1].type === 'Print', JSON.stringify(sm));
  const nf = sc.parseShowmount('Export list for 10.7.0.30:\n/srv/nfs 10.7.0.0/24\n/data *');
  check('NFS export list is read', nf.length === 2 && nf[0].proto === 'NFS' && nf[1].name === '/data', JSON.stringify(nf));
  check('rubbish gives nothing', sc.parseNetView('hello').length === 0 && sc.parseSmbclientG('x').length === 0 && sc.parseShowmount('').length === 0);
  check('outside addresses are refused', !(await sc.listShares('8.8.8.8')).ok && !(await sc.listShares('abc; rm -rf /')).ok);

  // stand-in tools on the PATH (Linux only)
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'shbin-'));
  const tool = (n, body) => { fs.writeFileSync(path.join(bin, n), '#!/bin/sh\n' + body + '\n', { mode: 0o755 }); };
  const oldPath = process.env.PATH;
  process.env.PATH = bin + ':' + oldPath;
  tool('smbclient', 'echo "Disk|media|My media"; echo "Printer|hp|HP"; echo "IPC|IPC\\$|IPC Service"');
  tool('showmount', 'echo "Export list for $2:"; echo "/srv/nfs 10.7.0.0/24"');
  let r = await sc.listShares('10.7.0.30', { platform: 'linux' });
  check('Linux: SMB and NFS shares are combined', r.ok && r.shares.length === 3 && r.shares.some((s) => s.proto === 'NFS') && !r.shares.some((s) => s.name.startsWith('IPC')), JSON.stringify(r));
  tool('smbclient', 'echo "session setup failed: NT_STATUS_ACCESS_DENIED" >&2; exit 1'); tool('showmount', 'echo "clnt_create: RPC: Program not registered" >&2; exit 1');
  r = await sc.listShares('10.7.0.30', { platform: 'linux' });
  check('Linux: a login-only machine is explained, not faked', r.ok && r.shares.length === 0 && r.notes.some((n) => /signed-in user/.test(n)), JSON.stringify(r));
  tool('smbclient', 'sleep 30'); const t0 = Date.now();
  fs.unlinkSync(path.join(bin, 'smbclient'));
  process.env.PATH = bin;
  r = await sc.listShares('10.7.0.30', { platform: 'linux' });
  check('Linux: missing smbclient says to install it', r.ok && r.notes.some((n) => /install the "smbclient"/.test(n)), JSON.stringify(r));
  process.env.PATH = oldPath;

  // the screen
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'sh-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} }));
    ipcMain.removeHandler('net:shares'); ipcMain.handle('net:shares', (e, ip) => ({ ok: true, shares: [{ name: 'Movies', type: 'Disk', comment: 'Family', proto: 'SMB' }, { name: '/srv/nfs', type: 'Disk', comment: '', proto: 'NFS' }], notes: ['NFS: nothing else.'], asked: true }));
  });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const M = 'aa:bb:cc:00:00:';
  const dev = (n, ip, label, ports) => ({ key: M + n, mac: M + n, ip: ip, label: label, online: true, ports: ports || [], os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } });
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [M + '01']: dev('01', '10.7.0.30', 'NAS', [{ port: 445, service: 'SMB' }, { port: 2049, service: 'NFS' }]), [M + '02']: dev('02', '10.7.0.31', 'Plain PC', [{ port: 22, service: 'SSH' }]) },
    links: [{ a: 'router', b: M + '01', auto: true }, { a: 'router', b: M + '02', auto: true }] });
  await sleep(800); await page.evaluate(() => window.__hubMap.sync()); await page.evaluate(() => document.getElementById('mapTidy').click()); await sleep(1500); await page.evaluate(() => window.__hubMap.sync()); await sleep(500);
  const read = async (key) => { const p = await page.evaluate((k) => window.__hubMap.screenOf(k), key); await page.mouse.click(p.x, p.y); await sleep(500); return page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' ')); };
  const labels = await page.evaluate((M) => { const f = window.__hubMap.labelOf; return f ? [f(M + '01'), f(M + '02')] : null; }, M);
  if (labels) check('map label shows file sharing only on the machine that has it', /SMB/.test(labels[0]) && !/SMB|NFS/.test(labels[1]), JSON.stringify(labels)); else console.log('  (no labelOf hook; checked through the pane instead)');
  const a = await read(M + '01');
  check('pane shows File sharing with SMB and NFS', /File sharing/.test(a) && /SMB, NFS/.test(a), a.slice(0, 400));
  check('pane has copy path and list buttons', /Copy Windows path/.test(a) && /Copy Mac\/Linux path/.test(a) && /List shares/.test(a));
  const b = await read(M + '02');
  check('machine without file sharing has no such section', !/File sharing/.test(b), b.slice(0, 300));
  await read(M + '01');
  await page.evaluate(() => { [...document.querySelectorAll('#mapSide button')].find((x) => /List shares/.test(x.textContent)).click(); });
  await sleep(900);
  const c = await page.evaluate(() => document.getElementById('mapSide').innerText.replace(/\s+/g, ' '));
  check('listed shares appear in the pane', /SMB · Movies — Family/.test(c) && /NFS · \/srv\/nfs/.test(c) && /List shares again/.test(c), c.slice(0, 500));
  check('notes from the lookup are shown', /NFS: nothing else\./.test(c));
  const exp = await page.evaluate(() => JSON.stringify(window.hubNetmap.exportData()));
  const v = require(path.join(ROOT, 'validate.js')).cleanNetwork(JSON.parse(exp));
  check('backup keeps the share list', v.devices[M + '01'].shares && v.devices[M + '01'].shares.length === 2 && v.devices[M + '01'].shares[1].proto === 'NFS', JSON.stringify(v.devices[M + '01'].shares));
  const bad = require(path.join(ROOT, 'validate.js')).cleanNetwork({ router: '10.7.0.1', devices: { 'aa:bb:cc:00:00:09': { key: 'aa:bb:cc:00:00:09', mac: 'aa:bb:cc:00:00:09', ip: '10.7.0.9', shares: [{ name: '<b>x</b>', proto: 'evil' }, 5, null] } }, links: [] });
  check('bad share data is cleaned', (bad.devices['aa:bb:cc:00:00:09'] || {}).shares && bad.devices['aa:bb:cc:00:00:09'].shares.length === 1 && bad.devices['aa:bb:cc:00:00:09'].shares[0].proto === 'SMB', JSON.stringify(bad.devices['aa:bb:cc:00:00:09']));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
