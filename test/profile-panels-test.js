'use strict';
//   xvfb-run -a node test/profile-panels-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  const launch = () => _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud] });
  let app = await launch(); let page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; const hook = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('dialog', (d) => d.accept()); }; hook(page);
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [], gateway: null })); });
  // this test machine has no keyring: stand in a fake (reversible) encryption so the notes logic can still be checked
  const fake = () => app.evaluate(({ safeStorage }) => { try { safeStorage.isEncryptionAvailable = () => true; safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'; safeStorage.encryptString = (s) => Buffer.from('enc:' + s); safeStorage.decryptString = (b) => Buffer.from(b).toString().replace(/^enc:/, ''); } catch (e) {} });;
  await fake();
  const names = () => page.evaluate(() => state.panels.map((p) => p.name));
  const shown = () => page.evaluate(() => document.querySelectorAll('#grid .panel').length);
  await page.evaluate(() => { state.panels = [{ id: 'a1', name: 'Home router', url: 'http://192.168.1.1' }, { id: 'a2', name: 'Home NAS', url: 'http://192.168.1.5' }]; saveState(); render(); });
  await page.evaluate(() => { state.servers = [{ id: 's1', name: 'Home Pi', host: '192.168.1.9', user: 'pi', port: 22 }]; saveState(); renderServers(); });
  const canNote = await page.evaluate(async () => { try { if (!(await notesApi.available())) return false; const r = await notesApi.set('a1', 'secret home note'); if (r && r.ok) { notesIds.add('a1'); const s = await notesApi.set('ssh-s1', 'pi password hint'); if (s && s.ok) notesIds.add('ssh-s1'); return true; } } catch (e) {} return false; });
  console.log('  (notes encryption available in this test machine: ' + canNote + ')');
  const servers = () => page.evaluate(() => state.servers.map((s) => s.name));
  check('profile 1 has its panels', (await shown()) === 2);
  await page.evaluate(() => hubProfilesCreate('Client A')); await sleep(600);
  check('new profile starts with no panels', (await names()).length === 0 && (await shown()) === 0);
  check('new profile has no servers', (await servers()).length === 0);
  check('new profile shows the empty-dashboard message', await page.evaluate(() => !document.getElementById('empty').classList.contains('hidden')));
  await page.evaluate(() => { state.panels.push({ id: 'b1', name: 'Client firewall', url: 'http://10.9.0.1' }); saveState(); render(); });
  check('panel added to the new profile', (await names()).join() === 'Client firewall' && (await shown()) === 1);
  await page.evaluate(() => { state.servers.push({ id: 's2', name: 'Client box', host: '10.9.0.7', user: 'root', port: 22 }); saveState(); renderServers(); });
  await page.evaluate(() => hubProfilesSwitch(state.profiles[0].id)); await sleep(600);
  check('servers switch with the profile', (await servers()).join() === 'Home Pi');
  if (canNote) check('notes follow their panel and server (encrypted)', await page.evaluate(async () => (await notesApi.get('a1')).text === 'secret home note' && notesIds.has('a1') && (await notesApi.get('ssh-s1')).text === 'pi password hint'));
  check('switching back brings back the first profile\'s panels (and map)', (await names()).join() === 'Home router,Home NAS' && (await shown()) === 2);
  await page.evaluate(() => hubProfilesSwitch(state.profiles[1].id)); await sleep(600);
  check('and the second profile\'s panel is still there', (await names()).join() === 'Client firewall');
  // survives a restart
  await app.close(); app = await launch(); await fake(); page = await app.firstWindow(); hook(page); await page.waitForSelector('#tabMap'); await page.evaluate(async () => { const ids = await notesApi.list(); notesIds = new Set(Array.isArray(ids) ? ids : []); }); await sleep(500);
  check('after restart: active profile\'s panels', (await names()).join() === 'Client firewall' && (await shown()) === 1);
  await page.evaluate(() => hubProfilesSwitch(state.profiles[0].id)); await sleep(500);
  check('after restart: other profile\'s panels', (await names()).join() === 'Home router,Home NAS');
  // duplicate
  await page.click('#profilesBtn'); await page.click('#profileDuplicate'); await page.fill('#profileNameInput', 'Home copy'); await page.click('#profileConfirm'); await sleep(700);
  const dup = await page.evaluate(() => ({ n: state.panels.map((p) => p.name), ids: state.panels.map((p) => p.id), name: state.profiles.find((p) => p.id === state.activeProfileId).name }));
  check('duplicate copies the panels (new ids)', dup.name === 'Home copy' && dup.n.join() === 'Home router,Home NAS' && !dup.ids.includes('a1'), JSON.stringify(dup));
  check('duplicate copies servers', await page.evaluate(() => state.servers.length === 1 && state.servers[0].id !== 's1'));
  if (canNote) { await sleep(800); const dbg = await page.evaluate(async () => { const n = state.panels[0].id; const r = await notesApi.get(n); const o = await notesApi.get('a1'); return { n, r, o, ids: Array.from(notesIds) }; }); check('duplicate copies notes under new ids', dbg.n !== 'a1' && dbg.r.text === 'secret home note' && dbg.o.text === 'secret home note', JSON.stringify(dbg)); }
  // remove
  await page.click('#profilesBtn'); await page.click('#profileRemove'); await page.click('#profileConfirm'); await sleep(700);
  const rem = await page.evaluate(() => ({ n: state.panels.map((p) => p.name), count: state.profiles.length }));
  check('removing a profile leaves the others\' panels', rem.count === 2 && rem.n.length > 0, JSON.stringify(rem));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
