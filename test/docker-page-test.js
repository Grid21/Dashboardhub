'use strict';
//   node test/docker-page-test.js
// Editing from the browser page of the Docker version (phone-sized window): name, group, ignore, bring back, add by hand.
// Simulated network (loopback), not a real container.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http');
const { chromium, devices } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const health = (port) => new Promise((r) => http.get({ host: '127.0.0.1', port, path: '/api/health' }, (x) => { x.resume(); r(x.statusCode); }).on('error', () => r(0)));
(async () => {
  const port = await freePort(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'docker', 'server.js')], { env: Object.assign({}, process.env, { DASHBOARD_HUB_DATA: data, DASHBOARD_HUB_PORT: String(port), DASHBOARD_HUB_CODE: 'page test code', DASHBOARD_HUB_NETWORK: '127.0.0.0/24', DASHBOARD_HUB_SCAN_SECONDS: '60' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60 && (await health(port)) !== 200; i++) await sleep(300);
  for (let i = 0; i < 100 && !/Scan finished/.test(log); i++) await sleep(300);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({}, devices['Pixel 7']));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + port + '/'); await page.fill('#code', 'page test code'); await page.click('#loginForm button[type=submit]'); await sleep(1500);
  await page.click('[data-tab=devices]'); await sleep(600);
  check('the Devices tab shows machines', await page.evaluate(() => document.querySelectorAll('#devList .dev').length >= 2));
  check('the edit boxes and the "add by hand" box appear on the Docker version', await page.evaluate(() => document.querySelectorAll('#devList .edit').length >= 2 && /Add a machine by hand/.test(document.getElementById('devList').textContent)));
  // open the first non-router device
  const idx = await page.evaluate(() => { const l = Array.from(document.querySelectorAll('#devList .dev')); const i = l.findIndex((c) => !/Router/.test(c.querySelector('b').textContent)); l[i].querySelector('.h').click(); return i; });
  await sleep(200);
  const card = (await page.$$('#devList .dev'))[idx];
  const first = await (await card.$('b')).textContent();
  const inputs = await card.$$('.edit input[type=text]');
  await inputs[0].fill('Phone test box'); await inputs[1].fill('Lab');
  await (await card.$('.edit button.primary')).click(); await sleep(1500);
  check('Save renames it and the page shows the new name and group', await page.evaluate(() => /Phone test box/.test(document.getElementById('devList').textContent) && /Group: Lab/.test(document.getElementById('devList').textContent)), first);
  // ignore it
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('#devList .dev')).find((x) => /Phone test box/.test(x.textContent)); if (c.querySelector('.d').hidden) c.querySelector('.h').click(); });
  const c2 = await page.evaluateHandle(() => Array.from(document.querySelectorAll('#devList .dev')).find((x) => /Phone test box/.test(x.textContent)));
  await (await c2.asElement().$('.edit input[type=checkbox]')).check(); await (await c2.asElement().$('.edit button.primary')).click(); await sleep(1500);
  check('Ignore takes it off the list', await page.evaluate(() => !/Phone test box/.test(document.getElementById('devList').textContent)));
  await page.evaluate(() => { Array.from(document.querySelectorAll('#devList button')).find((b) => /Show ignored/.test(b.textContent)).click(); }); await sleep(800);
  check('"Show ignored machines" lists it', await page.evaluate(() => /Phone test box/.test(document.getElementById('devList').textContent)));
  await page.evaluate(() => { Array.from(document.querySelectorAll('#devList button')).find((b) => /Bring back/.test(b.textContent)).click(); }); await sleep(1500);
  check('Bring back puts it on the list again', await page.evaluate(() => /Phone test box/.test(document.getElementById('devList').textContent)));
  // add by hand
  const boxIn = await page.$$('#devList .card input'); await boxIn[0].fill('10.55.0.7'); await boxIn[1].fill('Far NAS'); await boxIn[2].fill('Remote');
  await page.evaluate(() => { Array.from(document.querySelectorAll('#devList .card button')).find((b) => b.textContent === 'Add').click(); }); await sleep(2500);
  check('Add puts the machine on the list (offline, it does not answer)', await page.evaluate(() => { const c = Array.from(document.querySelectorAll('#devList .dev')).find((x) => /Far NAS/.test(x.textContent)); return !!c && /offline/.test(c.textContent); }));
  // ----- moving the dots on the map -----
  page.on('dialog', (dl) => dl.accept());
  const serverPos = (k) => page.evaluate(async (key) => { const r = await fetch('/api/state', { credentials: 'same-origin' }).then((x) => x.json()); const d = r.snapshot.devices.find((x) => x.key === key); return d ? { x: d.x, z: d.z } : null; }, k);
  await page.click('[data-tab=map]'); await sleep(800);
  const dots = () => page.evaluate(() => document.getElementById('map').dhDots());
  let ds = await dots(); const box = await (await page.$('#map')).boundingBox();
  const victim = ds.find((d) => d.key !== 'router'), others = ds.filter((d) => d.key !== victim.key);
  const orig = await serverPos(victim.key);
  const away = (px, py) => !others.some((o) => Math.hypot(o.x - px, o.y - py) < 30);
  let tx = box.width - 30, ty = box.height - 30; for (const c of [[box.width - 30, box.height - 30], [30, box.height - 30], [box.width - 30, 30], [30, 30]]) { if (away(c[0], c[1])) { tx = c[0]; ty = c[1]; break; } }
  const others0 = JSON.stringify(others.map((o) => [o.key, Math.round(o.x), Math.round(o.y)]));
  await page.mouse.move(box.x + victim.x, box.y + victim.y); await page.mouse.down(); await page.mouse.move(box.x + (victim.x + tx) / 2, box.y + (victim.y + ty) / 2, { steps: 5 }); await page.mouse.move(box.x + tx, box.y + ty, { steps: 5 }); await page.mouse.up(); await sleep(1200);
  ds = await dots(); const moved = ds.find((d) => d.key === victim.key);
  check('dragging a dot moves that dot to where it was dropped', Math.hypot(moved.x - tx, moved.y - ty) < 6, JSON.stringify([moved, tx, ty]));
  check('and the other dots stay where they were', JSON.stringify(ds.filter((d) => d.key !== victim.key).map((o) => [o.key, Math.round(o.x), Math.round(o.y)])) === others0);
  const saved = await serverPos(victim.key);
  check('the new place is saved on the server', Math.hypot(saved.x - orig.x, saved.z - orig.z) > 1, JSON.stringify([orig, saved]));
  await page.reload(); await sleep(1500); await page.click('[data-tab=map]'); await sleep(800);
  const saved2 = await serverPos(victim.key);
  check('after reloading the page the dot is still in its new place', Math.hypot(saved2.x - saved.x, saved2.z - saved.z) < 0.01 && (await dots()).length === others.length + 1);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  await page.click('#resetPos'); await sleep(1500);
  const back = await serverPos(victim.key);
  check('Reset puts the dots back in the automatic layout', Math.hypot(back.x - orig.x, back.z - orig.z) < 0.01, JSON.stringify([orig, back]));
  ds = await dots(); const t2 = ds.find((d) => d.key !== 'router'), box2 = await (await page.$('#map')).boundingBox();
  await page.mouse.click(box2.x + t2.x, box2.y + t2.y); await sleep(300);
  check('a plain tap still shows the details of a dot', await page.evaluate(() => !document.getElementById('mapDetail').hidden));
  {
    const w0 = await dots(), cb = await (await page.$('#map')).boundingBox(), cen = { x: cb.width / 2, y: cb.height / 2 };
    const ref = w0.filter((d) => Math.hypot(d.x - cen.x, d.y - cen.y) > 60 && d.x > 20 && d.x < cb.width - 20)[0];
    await page.mouse.move(cb.x + 40, cb.y + 40); await page.mouse.wheel(0, -100); await sleep(300);
    const w1 = (await dots()).find((d) => d.key === ref.key);
    const r0 = Math.hypot(ref.x - cen.x, ref.y - cen.y), r1 = Math.hypot(w1.x - cen.x, w1.y - cen.y);
    check('in 2D the wheel zooms into the middle of the picture (a corner mouse position makes no difference)', Math.abs(r1 / r0 - 1.15) < 0.03, r0 + ' -> ' + r1);
    await page.evaluate(() => document.getElementById('fit').click()); await sleep(300);
  }
  // ----- the 3D view -----
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('[data-tab=map]'); await sleep(500);
  await page.click('#mode3'); await sleep(600);
  check('the 3D button switches the map to 3D (and the button now says 2D)', (await page.textContent('#mode3')) === '2D');

  const centred = () => page.evaluate(() => { const c = document.getElementById('map'), r = c.getBoundingClientRect(), d = c.dhDots(), xs = d.map((q) => q.x), ys = d.map((q) => q.y); return { dx: Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - r.width / 2), dy: Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - r.height / 2), inside: Math.min(...xs) > 4 && Math.max(...xs) < r.width - 4 && Math.min(...ys) > 4 && Math.max(...ys) < r.height - 4 }; });
  { const nl = await page.evaluate(() => document.getElementById('map').dhLabelCount); check('the 3D map shows names even with more than 60 machines (only overlapping ones are left out)', nl >= 8 && (await dots()).length > 60, nl + ' labels, ' + (await dots()).length + ' machines'); }
  // ----- group circles, steady names, cable colour -----
  {
    const ds = (await dots()).filter((d) => d.key !== 'router').slice(0, 6);
    for (const [i, d] of ds.entries()) await page.evaluate(async ([k, g]) => { await fetch('/api/action/devices', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Hub': '1' }, body: JSON.stringify({ op: 'save', changes: [{ key: k, group: g }] }) }); }, [d.key, i < 3 ? 'Lab Group' : 'Other Group']);
    await page.evaluate(() => document.getElementById('refresh').click()); await sleep(900);
    const gl = await page.evaluate(() => document.getElementById('map').dhGroups());
    check('groups with two or more machines get a circle (the same rule as Desktop)', gl.length === 2 && gl.every((g) => g.r >= 2.2 && g.hue >= 0 && g.hue < 360) && gl.map((g) => g.name).sort().join() === 'Lab Group,Other Group', JSON.stringify(gl));
    const l1 = await page.evaluate(() => document.getElementById('map').dhLabels.join('|'));
    for (let i = 0; i < 4; i++) { await page.evaluate(() => document.getElementById('refresh').click()); await sleep(500); }
    const l2 = await page.evaluate(() => document.getElementById('map').dhLabels.join('|'));
    check('the names on the 3D map do not flicker when the page refreshes', l1.length > 0 && l1 === l2, l1.length + ' vs ' + l2.length);
    const sn = await page.evaluate(async () => (await (await fetch('/api/state', { credentials: 'same-origin' })).json()).snapshot);
    check('the server tells the page whether to draw the circles', sn.opts && sn.opts.groupCircles === true);
    await page.evaluate(() => { document.getElementById('mode3').click(); }); await sleep(500);
    check('circles are drawn in 2D as well (no page errors)', (await page.evaluate(() => document.getElementById('map').dhGroups().length)) === 2 && errs.length === 0, JSON.stringify(errs));
    await page.evaluate(() => { document.getElementById('mode3').click(); }); await sleep(500);
  }
  {
    // a machine typed in by hand that does not answer is offline: it must not be drawn
    await page.evaluate(async () => { await fetch('/api/action/devices', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Hub': '1' }, body: JSON.stringify({ op: 'add', ip: '10.99.99.99', name: 'Ghost box' }) }); });
    await sleep(3500); await page.evaluate(() => document.getElementById('refresh').click()); await sleep(800);
    const snap = await page.evaluate(async () => (await (await fetch('/api/state', { credentials: 'same-origin' })).json()).snapshot);
    const ghost = snap.devices.find((d) => d.name === 'Ghost box' || d.label === 'Ghost box');
    const names = (await dots()).map((d) => d.name);
    check('an offline machine is not drawn on the map', ghost && ghost.online === false && !names.includes('Ghost box'), JSON.stringify([ghost && ghost.online, names.length]));
    check('online machines are still drawn', names.length >= 2);
  }
  { const cc = await centred(); check('the 3D map is centred and fully in view when it first opens', cc.dx < 12 && cc.dy < 12 && cc.inside, JSON.stringify(cc)); }
  const painted = () => page.evaluate(() => { const c = document.getElementById('map'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) n++; return n; });
  check('the 3D map is drawn', (await painted()) > 300);
  if (process.env.DP_SHOT3) await page.screenshot({ path: process.env.DP_SHOT3 });
  let d3 = await dots(); const b3 = await (await page.$('#map')).boundingBox();
  check('every dot has a place on the screen', d3.length >= 2 && d3.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)));
  const dsBefore = JSON.stringify(d3.map((d) => [Math.round(d.x), Math.round(d.y)])), before3 = d3.slice();
  const farFromAll = (px, py) => !d3.some((o) => Math.hypot(o.x - px, o.y - py) < 40);
  let sx = 25, sy = 25; for (const c of [[25, 25], [b3.width - 25, 25], [25, b3.height - 25], [b3.width - 25, b3.height - 25]]) { if (farFromAll(c[0], c[1])) { sx = c[0]; sy = c[1]; break; } }
  await page.mouse.move(b3.x + sx, b3.y + sy); await page.mouse.down(); await page.mouse.move(b3.x + sx + 60, b3.y + sy + 10, { steps: 6 }); await page.mouse.up(); await sleep(300);
  d3 = await dots();
  check('dragging empty space turns the view', JSON.stringify(d3.map((d) => [Math.round(d.x), Math.round(d.y)])) !== dsBefore);
  const nearKey = before3.reduce((a, b) => (b.y > a.y ? b : a)).key;
  check('dragging to the right turns it so the near side follows your finger to the right', d3.find((d) => d.key === nearKey).x > before3.find((d) => d.key === nearKey).x + 5, JSON.stringify([before3.find((d) => d.key === nearKey), d3.find((d) => d.key === nearKey)]));
  const spread = (arr) => Math.max.apply(null, arr.map((d) => d.x)) - Math.min.apply(null, arr.map((d) => d.x));
  const w0 = spread(d3); await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2); await page.mouse.wheel(0, -300); await sleep(300);
  check('the wheel zooms in', spread(await dots()) > w0 * 1.05);
  await page.evaluate(() => document.getElementById('fit').click()); await sleep(300);
  d3 = await dots();
  // ----- moving the view (pan) -----
  {
    const pa = d3.find((d) => d.key !== 'router'), prePos = await serverPos(pa.key);
    await page.keyboard.down('Shift'); await page.mouse.move(b3.x + pa.x, b3.y + pa.y); await page.mouse.down(); await page.mouse.move(b3.x + pa.x + 25, b3.y + pa.y + 12, { steps: 5 }); await page.mouse.move(b3.x + pa.x + 50, b3.y + pa.y + 20, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift'); await sleep(400);
    const pb = (await dots()).find((d) => d.key === pa.key), postPos = await serverPos(pa.key);
    check('Shift+drag moves the whole view and the spot under the mouse follows it', Math.abs(pb.x - pa.x - 50) < 4 && Math.abs(pb.y - pa.y - 20) < 4, JSON.stringify([pa, pb]));
    check('Shift+drag does not move the device itself', Math.hypot(postPos.x - prePos.x, postPos.z - prePos.z) < 0.001);
    const r0 = (await dots()).find((d) => d.key === pa.key);
    await page.mouse.move(b3.x + 60, b3.y + b3.height - 30); await page.mouse.down({ button: 'right' }); await page.mouse.move(b3.x + 110, b3.y + b3.height - 30, { steps: 8 }); await page.mouse.up({ button: 'right' }); await sleep(300);
    const r1 = (await dots()).find((d) => d.key === pa.key);
    check('right-drag moves the view too', r1.x - r0.x > 20, JSON.stringify([r0, r1]));
    await page.evaluate(() => document.getElementById('fit').click()); await sleep(300);
    d3 = await dots();
    { const cc = await centred(); check('the Fit button centres the 3D map again', cc.dx < 12 && cc.dy < 12 && cc.inside, JSON.stringify(cc)); }
  }
  check('the Scan button is there on the Docker version', await page.evaluate(() => !document.getElementById('scanNow').hidden));
  await page.click('#scanNow'); await sleep(1200);
  check('the Scan button starts a scan and says so', /scan/i.test(await page.textContent('#mapStat')), await page.textContent('#mapStat'));
  await sleep(6500); await page.evaluate(() => document.getElementById('fit').click()); await sleep(300); d3 = await dots();
  const bb = await (await page.$('#map')).boundingBox();
  const gap = (d) => Math.min.apply(null, d3.filter((o) => o.key !== d.key).map((o) => Math.hypot(o.x - d.x, o.y - d.y))), vic = d3.filter((d) => d.key !== 'router').reduce((a, b) => (gap(b) > gap(a) ? b : a)), oth = d3.filter((d) => d.key !== vic.key), pre = await serverPos(vic.key);
  let tx3 = bb.width / 2, ty3 = bb.height - 30; for (const c of [[bb.width / 2, bb.height - 30], [40, bb.height - 30], [bb.width - 40, bb.height - 30], [40, 40], [bb.width - 40, 40]]) { if (!oth.some((o) => Math.hypot(o.x - c[0], o.y - c[1]) < 40)) { tx3 = c[0]; ty3 = c[1]; break; } }
  await page.mouse.move(bb.x + vic.x, bb.y + vic.y); await page.mouse.down(); await page.mouse.move(bb.x + (vic.x + tx3) / 2, bb.y + (vic.y + ty3) / 2, { steps: 5 }); await page.mouse.move(bb.x + tx3, bb.y + ty3, { steps: 5 }); await page.mouse.up(); await sleep(1200);
  const mv = (await dots()).find((d) => d.key === vic.key), post = await serverPos(vic.key);
  check('a box can be dragged across the floor and lands where it was dropped', Math.hypot(mv.x - tx3, mv.y - ty3) < 5, JSON.stringify([mv, tx3, ty3]));
  check('and the new place is saved on the server', Math.hypot(post.x - pre.x, post.z - pre.z) > 0.5);
  await page.click('#mode3'); await sleep(500);
  check('2D brings the flat map back', (await page.textContent('#mode3')) === '3D' && (await painted()) > 300);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.click('#resetPos'); await sleep(1000);
  // ----- the Settings tab -----
  const cfgState = () => page.evaluate(async () => (await (await fetch('/api/state', { credentials: 'same-origin' })).json()).snapshot);
  const cfg = () => page.evaluate(async () => (await fetch('/api/config', { credentials: 'same-origin' })).json());
  check('the Settings tab appears on the Docker version', await page.evaluate(() => !document.getElementById('setTab').hidden));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.click('#setTab'); await sleep(1200);
  check('it shows the name, network, router, scan time, updates and panels', await page.evaluate(() => { const t = document.getElementById('t-settings'); return t.querySelectorAll('select').length >= 4 && /Network to scan/.test(t.textContent) && /Panels/.test(t.textContent) && /Running/.test(t.textContent); }));
  await page.fill('#t-settings input', 'Garage hub');
  await page.evaluate(() => { const s = document.querySelectorAll('#t-settings select'); s[2].value = '900'; });
  await page.click('text=Add a panel'); await sleep(200);
  const pin = await page.$$('#t-settings .prow input'); await pin[0].fill('Portainer'); await pin[1].fill('ftp://nope');
  await page.click('#t-settings button.primary'); await sleep(1000);
  check('a panel with a wrong address is explained and nothing is saved', /http/.test(await page.textContent('#t-settings')) && (await cfg()).config.name !== 'Garage hub');
  await pin[1].fill('http://192.168.0.10:9000');
  await page.click('#t-settings button.primary'); await sleep(1200);
  const c1 = (await cfg()).config;
  check('Save keeps the name, scan time and panel on the server', c1.name === 'Garage hub' && c1.scanSeconds === 900 && c1.panels.length === 1 && c1.panels[0].url === 'http://192.168.0.10:9000', JSON.stringify(c1));
  await page.evaluate(() => { const s = document.querySelectorAll('#t-settings select'); s[3].value = 'check'; });
  await page.click('#t-settings button.primary'); await sleep(1000);
  check('the updates choice is kept', (await cfg()).config.update === 'check');
  await page.click('#t-settings .card > button:not(.primary)'); await sleep(800);
  check('Check now answers in plain words (no update server here)', /Last check|newest|Checking/.test(await page.textContent('#t-settings')));
  await page.evaluate(() => window.scrollTo(0, 0));
  const rx = require('http').createServer((q, s) => { rxGot.push(q.url); q.resume(); s.writeHead(200); s.end('ok'); }), rxGot = [];
  await new Promise((r) => rx.listen(0, '127.0.0.1', r)); const rxUrl = 'http://127.0.0.1:' + rx.address().port + '/pagetopic';
  await page.fill('#t-settings input[placeholder^="https://ntfy"]', rxUrl);
  await page.click('text=Send a test message'); await sleep(1200);
  check('the test message button sends a message to the address typed on the page', rxGot.length === 1 && rxGot[0] === '/pagetopic' && /sent/i.test(await page.textContent('#t-settings')), JSON.stringify(rxGot));
  await page.click('#t-settings button.primary'); await sleep(1200);
  const cAl = (await cfg()).config;
  check('the alert address and choices are saved with the settings', cAl.alerts.url === rxUrl && cAl.alerts.format === 'ntfy' && cAl.alerts.onNew === true && cAl.alerts.onBack === false, JSON.stringify(cAl.alerts));
  // ----- map data: export and import on the page -----
  check('checkboxes in Settings are small and sit next to their words (not stretched across the page)', await page.evaluate(() => { const l = [...document.querySelectorAll('#t-settings label.chk')]; return l.length >= 11 && l.every((x) => { const i = x.querySelector('input').getBoundingClientRect(), r = x.getBoundingClientRect(); return i.width < 30 && i.left - r.left < 6 && r.width > 0; }); }), await page.evaluate(() => [...document.querySelectorAll('#t-settings label.chk')].map((x) => Math.round(x.querySelector('input').getBoundingClientRect().width)).join(',')));
  check('the Map data box is on the Settings page', await page.evaluate(() => !!document.getElementById('mapData') && !!document.getElementById('expBtn') && !!document.getElementById('mapFile') && document.getElementById('impBtn').disabled));
  { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#expBtn')]);
    const tmp = await dl.path(), got = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    check('Download gives a Dashboard Hub export file with the map in it', /^dashboard-hub-map-.*\.json$/.test(dl.suggestedFilename()) && got.app === 'dashboard-hub' && got.format === 1 && got.network && Object.keys(got.network.devices).length > 1 && got.ok === undefined, dl.suggestedFilename());
    check('and it can be read by Dashboard Hub Desktop\'s own backup reader', require('../validate.js').parseBackup(fs.readFileSync(tmp, 'utf8')).ok === true);
    const devs = (await cfgState()).devices.filter((d) => !d.isRouter && !d.self).map((d) => d.key), k0 = devs[0], k1 = devs[1];
    const file = { app: 'dashboard-hub', format: 1, activeProfileName: 'Second', includesNotes: true, servers: [{ name: 'x', note: 'TOPSECRET' }],
      profiles: [{ name: 'First', network: { router: '192.168.0.1', devices: { router: { key: 'router' } }, links: [] }, panels: [] },
        { name: 'Second', network: { router: '192.168.0.1', groupCircles: true, devices: { router: { key: 'router' }, [k0]: Object.assign({}, got.network.devices[k0], { label: 'Imported by page', group: 'FromFile', pos: { x: 12, y: 0, z: -9 }, info: { brand: 'Zyxel', model: 'GS1900', notes: 'in the cupboard', webUrl: 'http://10.1.1.1/' }, vlan: '7' }) }, links: [{ a: 'router', b: k0, cable: true }], ignored: [k1] }, panels: [] }] };
    let sent = ''; page.on('request', (rq) => { if (/importmap/.test(rq.url())) sent = rq.postData() || ''; });
    await page.setInputFiles('#mapFile', { name: 'desktop-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) }); await sleep(600);
    check('choosing a file shows what it holds and unlocks Import; two networks give a chooser', await page.evaluate(() => !document.getElementById('impBtn').disabled && !document.getElementById('impProfile').hidden && document.getElementById('impProfile').options.length === 2 && /Dashboard Hub Desktop/.test(document.getElementById('impMsg').textContent)), await page.textContent('#impMsg'));
    check('the active network is already chosen', (await page.inputValue('#impProfile')) === '1');
    await page.click('#impBtn'); await sleep(1500);
    check('Import reports what it did', /Done:.*matched/.test(await page.textContent('#impMsg')), await page.textContent('#impMsg'));
    check('notes and passwords in the file never leave the browser', sent.length > 0 && !sent.includes('TOPSECRET'), sent.slice(0, 200));
    const after = (await cfgState()).devices.find((d) => d.key === k0);
    check('the server now has the name, group, place and details from the file', after && after.name === 'Imported by page' && after.group === 'FromFile' && after.x === 12 && after.z === -9 && after.info && after.info.brand === 'Zyxel' && after.vlan === '7', JSON.stringify(after));
    check('the ignored machine is hidden', !(await cfgState()).devices.some((d) => d.key === k1));
    await page.click('[data-tab=map]'); await sleep(700);
    await page.evaluate(() => { const c = document.getElementById('map'), d = c.dhDots().find((x) => x.name === 'Imported by page'); window.__pt = d; });
    const pt = await page.evaluate(() => window.__pt), bm = await (await page.$('#map')).boundingBox();
    if (pt) { await page.mouse.click(bm.x + pt.x, bm.y + pt.y); await sleep(400); }
    check('tapping the imported machine on the map shows its details', pt && /Zyxel GS1900/.test(await page.textContent('#mapDetail')) && /in the cupboard/.test(await page.textContent('#mapDetail')) && /VLAN: 7/.test(await page.textContent('#mapDetail')), await page.textContent('#mapDetail'));
    await page.click('[data-tab=settings]'); await sleep(900);
    await page.setInputFiles('#mapFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('this is not json') }); await sleep(500);
    check('a file that is not an export is refused politely', /not a Dashboard Hub export/.test(await page.textContent('#impMsg')) && await page.evaluate(() => document.getElementById('impBtn').disabled));
  }
  check('the quiet hours boxes and the clock note are on the page', await page.evaluate(() => !!document.getElementById('quietFrom') && !!document.getElementById('quietTo') && /server clock now says \d\d:\d\d/.test(document.getElementById('t-settings').textContent)));
  check('on a phone the Settings page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
  await page.fill('#quietFrom', '22:30'); await page.fill('#quietTo', '06:15');
  await page.click('#t-settings button.primary'); await sleep(1200);
  const cQ = (await cfg()).config.alerts;
  check('quiet hours typed on the page are saved', cQ.quietFrom === '22:30' && cQ.quietTo === '06:15' && cQ.url === rxUrl, JSON.stringify(cQ));
  await page.click('[data-tab=panels]'); await sleep(300); await page.click('[data-tab=settings]'); await sleep(1000);
  check('after reopening Settings the quiet hours are shown again', (await page.inputValue('#quietFrom')) === '22:30' && (await page.inputValue('#quietTo')) === '06:15');
  check('the Recent alerts list shows the test message that was sent', await page.evaluate(() => /Recent alerts/.test(document.getElementById('alertLog').textContent) && /Test message/.test(document.getElementById('alertLog').textContent)), await page.textContent('#alertLog'));
  await page.click('#t-settings button:text-is("No quiet hours")'); await page.click('#t-settings button.primary'); await sleep(1200);
  check('"No quiet hours" clears them', (await cfg()).config.alerts.quietFrom === '');
  rx.close();
  await page.click('[data-tab=panels]'); await sleep(800);
  check('the new panel shows on the Panels tab', await page.evaluate(() => /Portainer/.test(document.getElementById('t-panels').textContent)));
  if (process.env.DP_SHOT) await page.screenshot({ path: process.env.DP_SHOT, fullPage: true });
  check('no errors in the page', errs.length === 0, errs.join(' | '));
  await browser.close(); child.kill('SIGTERM');
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
