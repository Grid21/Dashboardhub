'use strict';
//   xvfb-run -a node test/backup-profiles-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#tabMap');
  const parse = require(path.join(ROOT, 'validate.js')).parseBackup;
  await app.evaluate(({ ipcMain }, parseSrc) => {
    const { parseBackup } = process.getBuiltinModule('module').createRequire(parseSrc)(parseSrc);
    global.__file = null;
    ipcMain.removeHandler('backup:export'); ipcMain.removeHandler('backup:import');
    ipcMain.handle('backup:export', (e, data) => { global.__file = JSON.stringify(data); return { ok: true, path: 'mem' }; });
    ipcMain.handle('backup:import', () => parseBackup(global.__file));
  }, path.join(ROOT, 'validate.js'));
  const mk = (gw, name, ip) => ({ router: gw, cidr: gw.replace(/\.1$/, '.0') + '/24', scannedOnce: true, devices: { router: { key: 'router', ip: gw, isRouter: true }, ['aa:bb:cc:00:00:' + ip.split('.').pop().padStart(2, '0')]: { key: 'aa:bb:cc:00:00:' + ip.split('.').pop().padStart(2, '0'), mac: 'aa:bb:cc:00:00:' + ip.split('.').pop().padStart(2, '0'), ip: ip, label: name, online: true, os: { id: 'linux', label: 'linux', confidence: 'high', reasons: [] } } }, links: [{ a: 'router', b: 'aa:bb:cc:00:00:' + ip.split('.').pop().padStart(2, '0'), auto: true }] });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate((d) => window.hubNetmap.importData(d, true), mk('10.1.0.1', 'Office PC', '10.1.0.20'));
  await page.evaluate((d) => { state.profiles[0].name = 'Office'; state.profiles[0].fp = { gw: '10.1.0.1', mac: '' }; state.profiles.push({ id: 'cli', name: 'Client A', locked: true, fp: { gw: '10.2.0.1', mac: 'aa:aa:aa:aa:aa:aa' }, network: d }); saveState(); hubProfilesRefresh(); }, mk('10.2.0.1', 'Client Server', '10.2.0.30'));
  await page.evaluate(() => { state.panels = [{ id: 'pa1', name: 'Office router page', url: 'http://10.1.0.1' }]; state.profiles[1].panels = [{ id: 'pb1', name: 'Client NAS', url: 'http://10.2.0.5' }, { id: 'pb2', name: 'Client cam', url: 'http://10.2.0.6' }]; state.servers = [{ id: 'sa', name: 'Office Pi', host: '10.1.0.9', user: 'pi', port: 22 }]; state.profiles[1].servers = [{ id: 'sb', name: 'Client box', host: '10.2.0.7', user: 'root', port: 22 }]; saveState(); render(); });
  await page.evaluate(() => doExport()); await sleep(600);
  const file = JSON.parse(await app.evaluate(() => global.__file));
  check('export holds both profiles', file.profiles && file.profiles.length === 2, JSON.stringify((file.profiles || []).map((p) => p.name)));
  check('export keeps lock + network ID', file.profiles[1].locked === true && file.profiles[1].fp.gw === '10.2.0.1');
  check('export has each profile\'s own map', JSON.stringify(file.profiles[0].network).includes('Office PC') && JSON.stringify(file.profiles[1].network).includes('Client Server'));
  check('export has each profile\'s own panels', file.profiles[0].panels.length === 1 && file.profiles[1].panels.length === 2 && file.profiles[1].panels[0].name === 'Client NAS', JSON.stringify(file.profiles.map((p) => p.panels && p.panels.length)));
  // wipe, then restore (replace)
  await page.evaluate(() => { state.profiles = [{ id: 'default', name: 'Default network', network: null }]; state.activeProfileId = 'default'; saveState(); window.hubNetmap.importData({ router: '192.168.0.1', devices: { router: { ip: '192.168.0.1', isRouter: true } }, links: [], ignored: [] }, true); document.getElementById('importReplace') && (document.getElementById('importReplace').checked = true); });
  await page.evaluate(() => { const c = document.querySelector('#importReplace'); if (c) c.checked = true; });
  await page.evaluate(() => doImport()); await sleep(900);
  const after = await page.evaluate(() => ({ names: state.profiles.map((p) => p.name), locked: state.profiles.map((p) => !!p.locked), act: state.profiles.find((p) => p.id === state.activeProfileId).name, map: JSON.stringify(state.network) }));
  check('restore (replace) brings back both profiles', after.names.length === 2 && after.names.includes('Office') && after.names.includes('Client A'), JSON.stringify(after.names));
  check('lock restored', after.locked[after.names.indexOf('Client A')] === true);
  check('active profile and its map restored', after.act === 'Office' && after.map.includes('Office PC'), after.act);
  const pn = await page.evaluate(() => ({ active: state.panels.map((p) => p.name), other: (state.profiles.find((p) => p.name === 'Client A').panels || []).map((p) => p.name), shown: document.querySelectorAll('#grid .panel').length }));
  check('restore: active profile shows its own panels', pn.active.length === 1 && pn.active[0] === 'Office router page' && pn.shown === 1, JSON.stringify(pn));
  const sv = await page.evaluate(() => ({ a: state.servers.map((s) => s.name), o: (state.profiles.find((p) => p.name === 'Client A').servers || []).map((s) => s.name) }));
  check('restore: each profile keeps its own servers', sv.a.join() === 'Office Pi' && sv.o.join() === 'Client box', JSON.stringify(sv));
  check('restore: other profile keeps its own panels', pn.other.length === 2 && pn.other.includes('Client cam'), JSON.stringify(pn));
  // merge mode: must not mix the backup's map into the current one
  await page.evaluate(() => { const c = document.querySelector('#importReplace'); if (c) c.checked = false; });
  await page.evaluate(() => doImport()); await sleep(900);
  const m = await page.evaluate(() => ({ n: state.profiles.length, names: state.profiles.map((p) => p.name), map: JSON.stringify(state.network) }));
  check('merge adds profiles under new names', m.n === 4 && m.names.filter((x) => /Imported/.test(x)).length === 2, JSON.stringify(m.names));
  check('merge leaves the current panels alone', (await page.evaluate(() => state.panels.length)) === 1);
  check('merge does not pour another network into the live map', !m.map.includes('Client Server'));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
