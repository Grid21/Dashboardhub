'use strict';
//   xvfb-run -a node test/tools-test.js
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib'), crypto = require('crypto');
const T = require('../hubupdate-tools');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  // --- the engine ---
  const src = path.join(tmp, 'src'); fs.mkdirSync(path.join(src, 'vendor'), { recursive: true });
  for (const f of ['app-main.js', 'preload.js', 'renderer.js', 'styles.css']) fs.writeFileSync(path.join(src, f), f.endsWith('.js') ? '// ' + f + '\n' : 'body{}');
  fs.writeFileSync(path.join(src, 'index.html'), '<html></html>'); fs.writeFileSync(path.join(src, 'vendor/data.json'), '{"a":1}');
  fs.writeFileSync(path.join(src, 'main.js'), '// must be skipped'); fs.writeFileSync(path.join(src, 'package.json'), '{"version":"3.4.5"}');
  const d = T.packDefaults(src);
  check('pack: suggests the version from the folder and lists only update files', d.version === '3.4.5' && d.files.includes('vendor/data.json') && !d.files.includes('main.js') && !d.files.includes('package.json'), JSON.stringify(d));
  const built = T.pack(src, '3.4.5', 'hello');
  const f1 = path.join(tmp, built.fileName); fs.writeFileSync(f1, built.text);
  check('pack: file is named like the app expects', built.fileName === 'Dashboard-Hub-update-3.4.5.hubupdate', built.fileName);
  const un = T.unpack(f1, tmp);
  check('unpack: every file comes back identical', un.written.length === 6 && fs.readFileSync(path.join(un.folder, 'app-main.js'), 'utf8') === '// app-main.js\n' && fs.readFileSync(path.join(un.folder, 'vendor/data.json'), 'utf8') === '{"a":1}', JSON.stringify(un.written));
  const un2 = T.unpack(f1, tmp);
  check('unpack: never overwrites an earlier folder', un2.folder !== un.folder && fs.existsSync(un.folder), un2.folder);
  const bad = (() => { try { T.pack(src, 'abc', ''); } catch (e) { return e.message; } })();
  check('pack: a bad version is refused with a clear message', /version/i.test(bad || ''), bad);
  const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty);
  check('pack: a folder that is not an update is refused', (() => { try { T.pack(empty, '1.0.0', ''); } catch (e) { return /missing/i.test(e.message); } })() === true);
  // hostile file
  const e = (r) => ({ sha256: crypto.createHash('sha256').update(r).digest('hex'), gz: zlib.gzipSync(r).toString('base64') });
  const evil = path.join(tmp, 'evil.hubupdate');
  fs.writeFileSync(evil, JSON.stringify({ app: 'dashboard-hub', format: 1, version: '9.9.9', files: { '../../escape.js': e(Buffer.from('x')), '/abs.js': e(Buffer.from('x')), 'good.js': e(Buffer.from('y')), 'bad.js': { sha256: 'a'.repeat(64), gz: zlib.gzipSync(Buffer.from('z')).toString('base64') } } }));
  const un3 = T.unpack(evil, tmp);
  check('unpack: a hostile file cannot write outside its folder', !fs.existsSync(path.join(tmp, '..', 'escape.js')) && !fs.existsSync(path.join(tmp, 'escape.js')) && un3.written.join() === 'good.js' && un3.skipped.length === 3, JSON.stringify(un3.skipped));
  check('not-an-update files are refused', (() => { fs.writeFileSync(path.join(tmp, 'x.txt'), 'hello'); try { T.info(path.join(tmp, 'x.txt')); } catch (e2) { return /not a Dashboard Hub/.test(e2.message); } })() === true);
  // --- in the app, with pretend file boxes ---
  const harness = path.join(tmp, 'h.js');
  fs.writeFileSync(harness, "const { dialog } = require('electron'); global.__q = [];\n" +
    "dialog.showOpenDialog = async () => { const n = global.__q.shift(); return n ? { canceled: false, filePaths: [n] } : { canceled: true, filePaths: [] }; };\n" +
    "dialog.showSaveDialog = async () => { const n = global.__q.shift(); return n ? { canceled: false, filePath: n } : { canceled: true }; };\n" +
    "require(" + JSON.stringify(path.join(ROOT, 'main.js')) + ");\n");
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [harness, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'tlu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (x) => errors.push(String(x)));
  await page.waitForSelector('#tabMap');
  const queue = (...a) => app.evaluate((_, q) => { global.__q.push(...q); }, a);
  await page.click('#settingsBtn'); await page.click('#toolsMenuBtn'); await sleep(300);
  check('the Update file tools window opens from Settings', await page.evaluate(() => document.getElementById('toolsDialog').open));
  check('Settings menu closed itself', await page.evaluate(() => { const b = document.getElementById('toolsMenuBtn'); return b.offsetParent === null; }));
  const outParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tlo-'));
  await queue(f1, outParent); await page.click('#toolsUnpack'); await sleep(700);
  const m1 = await page.textContent('#toolsMsg');
  check('Unpack from the window works and says where', /Unpacked 6 files from version 3.4.5/.test(m1) && fs.readdirSync(outParent).some((x) => /^decompiled-update-v3\.4\.5/.test(x)), m1);
  await queue(src); await page.click('#toolsPackPick'); await sleep(600);
  check('Pack: choosing a folder fills in the version', await page.inputValue('#toolsVersion') === '3.4.5' && await page.isVisible('#toolsPackForm'));
  await page.fill('#toolsVersion', '3.4.6'); await page.fill('#toolsNotes', 'from the window');
  const outFile = path.join(outParent, 'made.hubupdate'); await queue(outFile); await page.click('#toolsPackGo'); await sleep(700);
  const m2 = await page.textContent('#toolsMsg');
  let madeOk = false; try { const i = T.info(outFile); madeOk = i.version === '3.4.6' && i.notes === 'from the window' && i.files.length === 6; } catch (x) { /* no */ }
  check('Pack from the window makes a valid update file', madeOk && /Created the update file for version 3.4.6/.test(m2), m2);
  await page.fill('#toolsVersion', 'zzz'); await page.click('#toolsPackGo'); await sleep(400);
  check('a bad version shows a plain message and writes nothing', /version/i.test(await page.textContent('#toolsMsg')) && fs.readdirSync(outParent).filter((x) => /\.hubupdate$/.test(x)).length === 1);
  await queue(path.join(tmp, 'x.txt')); await page.click('#toolsUnpack'); await sleep(500);
  check('picking a file that is not an update shows a plain message', /not a Dashboard Hub/.test(await page.textContent('#toolsMsg')), await page.textContent('#toolsMsg'));
  await page.click('#toolsUnpack'); await sleep(300);
  check('cancelling a file box does nothing and shows nothing', (await page.textContent('#toolsMsg')) === '');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
