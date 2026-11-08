'use strict';
//   xvfb-run -a node test/restart-test.js [rounds]
// Starts the real app (close-to-tray on), asks it to restart the way "Restart now" does, and checks that a new copy comes back.
const path = require('path'), fs = require('fs'), os = require('os'), { spawn, spawnSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..'), ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rounds = Number(process.argv[2]) || 6;
const mains = (ud) => { const o = spawnSync('pgrep', ['-af', 'user-data-dir=' + ud]).stdout.toString().split('\n').filter((l) => l && !/--type=/.test(l) && !/pgrep/.test(l)); return o.map((l) => Number(l.split(' ')[0])); };
async function page(port) { for (let i = 0; i < 40; i++) { try { const b = await chromium.connectOverCDP('http://127.0.0.1:' + port); const ctx = b.contexts()[0]; const p = ctx && ctx.pages().find((x) => /index\.html/.test(x.url())); if (p) return { b, p }; await b.close(); } catch (e) { /* not up yet */ } await sleep(500); } return null; }
(async () => {
  let comeBack = 0;
  for (let r = 1; r <= rounds; r++) {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')); fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ closeToTray: true }));
    const port = 9400 + r;
    const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud, '--remote-debugging-port=' + port], { stdio: 'ignore', detached: true });
    child.unref();
    const first = await page(port);
    if (!first) { check('round ' + r + ': the app starts', false); try { process.kill(-child.pid); } catch (e) { /* gone */ } continue; }
    const pidA = mains(ud)[0];
    await first.p.evaluate(() => { window.updateApi.restart(); });
    await first.b.close().catch(() => {});
    await sleep(9000);
    const now = mains(ud);
    const back = now.length > 0 && !now.includes(pidA);
    let shown = false; if (back) { const again = await page(port); shown = !!again; if (again) await again.b.close().catch(() => {}); }
    console.log('  round ' + r + ': old pid ' + pidA + ', running now ' + JSON.stringify(now) + ', window ' + (shown ? 'shown' : 'NOT shown'));
    if (back && shown) comeBack++;
    spawnSync('pkill', ['-f', 'user-data-dir=' + ud]); await sleep(800);
  }
  // the race itself: the old copy still holds the lock while the new one starts
  {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')); fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ closeToTray: true }));
    const base = [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud];
    const A = spawn(ELECTRON, base.concat(['--remote-debugging-port=9490']), { stdio: 'ignore', detached: true }); A.unref();
    const okA = await page(9490); if (okA) await okA.b.close().catch(() => {});
    const pidA = mains(ud)[0];
    // a plain second copy: must quit by itself and leave the first one alone
    const plain = spawn(ELECTRON, base, { stdio: 'ignore', detached: true }); plain.unref();
    await sleep(6000);
    check('a normal second copy quits at once (one copy only)', mains(ud).length === 1 && mains(ud)[0] === pidA, JSON.stringify(mains(ud)));
    // a copy started by a restart: must wait, and take over once the old copy is gone
    const B = spawn(ELECTRON, base.concat(['--remote-debugging-port=9491', '--hub-relaunched']), { stdio: 'ignore', detached: true }); B.unref();
    await sleep(5000);
    check('the restarted copy waits while the old one is still running', mains(ud).length === 2, JSON.stringify(mains(ud)));
    process.kill(pidA, 'SIGKILL'); await sleep(500);
    const took = await page(9491);
    check('the restarted copy takes over once the old one has gone, and shows its window', !!took);
    if (took) await took.b.close().catch(() => {});
    spawnSync('pkill', ['-f', 'user-data-dir=' + ud]); await sleep(800);
  }
  check('the app came back after every restart (' + comeBack + ' of ' + rounds + ')', comeBack === rounds);
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
