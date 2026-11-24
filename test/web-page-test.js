'use strict';
//   node test/web-page-test.js        (set WEBPAGE_SHOTS=/folder to keep screenshots)
// The phone page in a real browser (a phone-sized window): sign in, panels, map, devices, uptime.
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { chromium, devices } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const remote = require('../remote.js');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.WEBPAGE_SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-'));
  const now = Date.now(), H = 3600000;
  const devs = [{ key: 'router', name: 'Router', ip: '10.0.0.1', online: true, isRouter: true, x: 0, z: 0 }];
  const names = ['NAS', 'Proxmox', 'Pi-hole', 'Printer', 'Laptop', 'Phone', 'Camera', 'TV'];
  names.forEach((n, i) => devs.push({ key: 'k' + i, name: n, ip: '10.0.0.' + (10 + i), mac: '00:11:22:33:44:5' + i, vendor: 'Acme', online: i !== 3, x: Math.cos(i) * 9, z: Math.sin(i) * 9, onlineSince: now - 5 * H, lastSeen: now - 2 * H, ports: [{ port: 80, service: 'http' }, { port: 22, service: 'ssh' }], os: 'Linux' }));
  const snap = remote.webCleanSnapshot({ profile: { id: 'p', name: 'Home network' }, panels: [{ name: 'Portainer', url: 'http://10.0.0.10:9000' }, { name: 'Pi-hole', url: 'http://10.0.0.12/admin' }], devices: devs, links: devs.slice(1).map((d) => ({ a: 'router', b: d.key })) });
  const up = { ok: true, now, from: now - 24 * H, to: now, since: now - 40 * H, watchedPct: 96.5, summary: '8 devices watched · 2 times a device went offline (1 device) · 1 offline right now',
    lines: [{ text: 'Printer went offline at today 3:12 AM, and has not come back yet (off for 11 hours).' }, { text: 'Camera dropped off 3 times between today 1:00 PM and today 2:00 PM (6 minutes offline in total).' }],
    devices: [{ name: 'Printer', pct: 52.1, downs: [1], segments: [[now - 24 * H, now - 11 * H, 'up'], [now - 11 * H, now, 'down']] }, { name: 'NAS', pct: 100, downs: [], segments: [[now - 24 * H, now, 'up']] }, { name: 'Laptop', pct: null, downs: [], segments: [[now - 24 * H, now - 12 * H, 'unknown'], [now - 12 * H, now, 'up']] }] };
  const w = remote.createWebAccess({ file: path.join(dir, 'w.json'), version: '1', getSnapshot: () => snap, getUptime: () => up });
  w.setCode('phone test code'); const port = await freePort(); await w.setPort(port); await w.setOn(true);
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext(Object.assign({}, devices['Pixel 7'], { colorScheme: scheme }));
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) errs.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/'); await sleep(500);
    check(scheme + ': the sign-in box shows first', await page.isVisible('#code') && !(await page.isVisible('#app')));
    await page.fill('#code', 'wrong'); await page.click('#loginForm button'); await sleep(400);
    check(scheme + ': a wrong code shows a message', /not right/.test(await page.textContent('#loginMsg')));
    await page.fill('#code', 'phone test code'); await page.click('#loginForm button'); await sleep(900);
    check(scheme + ': the right code opens the page', await page.isVisible('#app') && /Home network/.test(await page.textContent('#profile')));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, scheme + '-panels.png') });
    check(scheme + ': panels are buttons that open the panel', await page.evaluate(() => { const a = document.querySelectorAll('#t-panels a.tile'); return a.length === 2 && a[0].getAttribute('href') === 'http://10.0.0.10:9000' && a[0].rel.indexOf('noopener') >= 0; }));
    await page.click('[data-tab=map]'); await sleep(600);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, scheme + '-map.png') });
    const px = await page.evaluate(() => { const c = document.getElementById('map'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let colored = 0; for (let i = 0; i < d.length; i += 40) if (d[i + 3] > 0) colored++; return colored; });
    check(scheme + ': the map is drawn', px > 200, px);
    check(scheme + ': the map says how many are online', /8 online of 9/.test(await page.textContent('#mapStat')));
    // tap a device: find a screen position of the NAS via page script
    const tap = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.click(tap.x + tap.w / 2, tap.y + tap.h / 2); await sleep(300);
    check(scheme + ': tapping the middle shows the router details', /Router/.test(await page.textContent('#mapDetail')) || await page.isHidden('#mapDetail'));
    // moving a dot on the computer's page: only for this browser (that page is view-only for the network)
    {
      const dots = () => page.evaluate(() => document.getElementById('map').dhDots());
      let ds = await dots(); const v = ds.find((d) => d.key === 'k2'), r0 = tap;
      await page.mouse.move(r0.x + v.x, r0.y + v.y); await page.mouse.down(); await page.mouse.move(r0.x + v.x + 40, r0.y + v.y + 30, { steps: 6 }); await page.mouse.up(); await sleep(300);
      ds = await dots(); const m = ds.find((d) => d.key === 'k2');
      check(scheme + ': a dot can be dragged on the map', Math.abs(m.x - v.x - 40) < 5 && Math.abs(m.y - v.y - 30) < 5, JSON.stringify([v, m]));
      check(scheme + ': the move is remembered in this browser only', await page.evaluate(() => Object.keys(localStorage).some((k) => /^dh-pos-/.test(k) && /k2/.test(localStorage.getItem(k)))));
      await page.evaluate(() => window.scrollTo(0, 0));
      page.once('dialog', (dl) => dl.accept()); await page.click('#resetPos'); await sleep(600);
      check(scheme + ': Reset forgets the moves', await page.evaluate(() => !Object.keys(localStorage).some((k) => /^dh-pos-/.test(k) && /k2/.test(localStorage.getItem(k)))));
    }
    await page.click('[data-tab=devices]'); await sleep(400);
    check(scheme + ': devices are listed, offline ones first', await page.evaluate(() => { const b = document.querySelectorAll('#devList .dev b'); return b.length === 9 && b[0].textContent === 'Printer'; }));
    await page.fill('#q', 'prox'); await sleep(300);
    check(scheme + ': search narrows the list', await page.evaluate(() => document.querySelectorAll('#devList .dev').length) === 1);
    await page.click('#devList .dev .h'); await sleep(200);
    check(scheme + ': tapping a device shows its details', /10\.0\.0\.11/.test(await page.textContent('#devList .dev .d')) && /22 \(ssh\)/.test(await page.textContent('#devList .dev .d')));
    await page.fill('#q', ''); await page.click('#chips [data-f=off]'); await sleep(300);
    check(scheme + ': the Offline filter works', await page.evaluate(() => document.querySelectorAll('#devList .dev').length) === 1);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, scheme + '-devices.png') });
    await page.click('[data-tab=uptime]'); await sleep(700);
    check(scheme + ': uptime shows the summary, the sentences and a bar for each device', /8 devices watched/.test(await page.textContent('#upSum')) && /Printer went offline/.test(await page.textContent('#upLines')) && await page.evaluate(() => document.querySelectorAll('#upDev .up-row').length) === 3);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, scheme + '-uptime.png') });
    check(scheme + ': no sideways scrolling on the phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.click('#logout'); await sleep(400);
    check(scheme + ': signing out returns to the sign-in box', await page.isVisible('#code'));
    check(scheme + ': no errors in the browser', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close(); await w.stop();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
