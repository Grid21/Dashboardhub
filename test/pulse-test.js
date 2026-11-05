'use strict';
//   xvfb-run -a node test/pulse-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'pu-'))] });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('net:interfaces'); ipcMain.handle('net:interfaces', () => ({ ok: true, interfaces: [{ name: 'eth0', address: '10.7.0.9', cidr: '10.7.0.0/24' }], gateway: '10.7.0.1', gatewayMac: 'aa:aa:aa:00:00:01', speeds: {} })); });
  await page.click('#tabMap'); await sleep(400);
  await page.evaluate(() => { state.profiles[0].fp = null; saveState(); }); await page.evaluate(() => window.hubNetmap.guardCheck()); await sleep(300);
  const D = 'aa:bb:cc:00:00:04', A = 'aa:bb:cc:00:00:01', B = 'aa:bb:cc:00:00:02', C = 'aa:bb:cc:00:00:03';
  const mk = (k, ip, extra) => Object.assign({ key: k, mac: k, ip, label: k.slice(-2), online: true }, extra || {});
  await page.evaluate((d) => window.hubNetmap.importData(d, true), { router: '10.7.0.1', cidr: '10.7.0.0/24', scannedOnce: true,
    devices: { router: { key: 'router', ip: '10.7.0.1', isRouter: true }, [A]: mk(A, '10.7.0.2'), [B]: mk(B, '10.7.0.3'), [C]: mk(C, '10.7.0.4'), [D]: mk(D, '10.7.0.5', { online: false }) },
    links: [{ a: 'router', b: A, auto: true }, { a: 'router', b: B, auto: true, wireless: true }, { a: 'router', b: C, cable: true }, { a: 'router', b: D, auto: true }] });
  await sleep(800); await page.evaluate(() => window.__hubMap.sync()); await sleep(500);
  const seen = { A: [], B: [], C: [] };
  for (let i = 0; i < 24; i++) {
    const r = await page.evaluate(([a, b, c]) => ({ A: window.__hubMap.linkOpacity('router', a), B: window.__hubMap.linkOpacity('router', b), C: window.__hubMap.linkOpacity('router', c) }), [A, B, C]);
    seen.A.push(r.A); seen.B.push(r.B); seen.C.push(r.C); await sleep(130);
  }
  const rng = (arr) => { const v = arr.map((x) => x.op); return Math.max(...v) - Math.min(...v); };
  const lo = (arr) => Math.min(...arr.map((x) => x.op));
  check('a solid green line fades in and out', seen.A[0].pulse && rng(seen.A) > 0.15, rng(seen.A));
  check('a dotted green line fades in and out', seen.B[0].pulse && seen.B[0].dashed && rng(seen.B) > 0.15, rng(seen.B));
  check('the fade is gentle (never fully invisible)', lo(seen.A) >= 0.38 && lo(seen.B) >= 0.38, lo(seen.A) + ' / ' + lo(seen.B));
  check('dotted lines keep their dashes while faded (dash cut-off is below the lowest fade)', seen.B[0].alphaTest < lo(seen.B), seen.B[0].alphaTest);
  check('a hand-drawn pink cable stays steady', !seen.C[0].pulse && rng(seen.C) === 0, JSON.stringify(seen.C[0]));
  const off = []; for (let i = 0; i < 12; i++) { off.push(await page.evaluate(([d]) => window.__hubMap.linkOpacity('router', d), [D])); await sleep(130); }
  check('a line to an OFFLINE machine does not blink', off[0] && !off[0].pulse && off.every((x) => x.op === 1), JSON.stringify(off[0]));
  await page.evaluate(([d]) => { const x = window.hubNetmap.exportData(); x.devices[d].online = true; window.hubNetmap.importData(x, true); }, [D]); await sleep(700); await page.evaluate(() => window.__hubMap.sync()); await sleep(300);
  const on = []; for (let i = 0; i < 14; i++) { on.push(await page.evaluate(([d]) => window.__hubMap.linkOpacity('router', d), [D])); await sleep(130); }
  check('when that machine comes back online, its line starts blinking', on[0] && on[0].pulse && Math.max(...on.map((x) => x.op)) - Math.min(...on.map((x) => x.op)) > 0.1, JSON.stringify(on[0]));
  // the Settings switch
  const sample = async () => { const v = []; for (let i = 0; i < 14; i++) { v.push(await page.evaluate(([a]) => window.__hubMap.linkOpacity('router', a).op, [A])); await sleep(130); } return Math.max(...v) - Math.min(...v); };
  check('Settings has a "blink the network lines" tick box, on by default', await page.evaluate(() => { const c = document.getElementById('pulseCheck'); return !!c && c.checked && /blink/i.test(c.parentElement.textContent); }));
  await page.evaluate(() => { const c = document.getElementById('pulseCheck'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  const steady = await sample();
  check('unticking it makes the lines steady (fully solid)', steady === 0 && (await page.evaluate(([a]) => window.__hubMap.linkOpacity('router', a).op, [A])) === 1, steady);
  await page.reload(); await page.waitForSelector('#tabMap'); await sleep(600);
  check('the choice is remembered after a restart/reload', await page.evaluate(() => document.getElementById('pulseCheck').checked === false));
  await page.evaluate(() => { const c = document.getElementById('pulseCheck'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#tabMap'); await sleep(1200);
  const back = await page.evaluate(() => { const m = window.__hubMap; return m && m.linkOpacity ? 'has' : 'no'; });
  // selected link stops pulsing
  await page.evaluate(([a]) => { const s = window.__hubMap; if (s.selectLink) s.selectLink('router', a); }, [A]);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
