'use strict';
//   node test/uptime-test.js
// Uptime and history: the logic that turns connect/disconnect records and "Dashboard Hub was watching" periods into
// coloured timelines and plain sentences. Pure logic with made-up records, no network.
process.env.TZ = 'UTC';
const h = require('../notif-history.js');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const MIN = 60000, HR = 3600000;
const T = (day, hh, mm) => Date.UTC(2026, 10, day, hh, mm || 0);            // Nov <day> 2026, UTC
const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
const fmt = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ');
const NAMES = {};          // the map always sends the device's current name, so remember it per device like the app does
const ev = (kind, key, t, extra) => { if (extra && extra.name) NAMES[key] = extra.name; return Object.assign({ kind, key, t, mac: key, ip: '10.0.0.5', name: NAMES[key] || key, os: 'linux', vendor: '' }, extra || {}); };
const fresh = () => ({ profiles: {} });
// watch continuously from a to b with a scan every 'step' minutes
function watch(store, a, b, stepMin) { for (let t = a; t <= b; t += (stepMin || 1) * MIN) h.heartbeat(store, 'p1', 'Home', 3 * MIN * 3, t); }
const prof = (st) => st.profiles.p1;
const segText = (d) => d.segments.map((s) => s[2] + '@' + hhmm(s[0]) + '-' + hhmm(s[1])).join(' ');

console.log('Watching periods');
{
  const st = fresh();
  check('first scan starts a watching period', h.heartbeat(st, 'p1', 'Home', 600000, T(10, 8, 0)) === 'new' && prof(st).watch.length === 1);
  check('a later scan inside the gap extends it', h.heartbeat(st, 'p1', 'Home', 600000, T(10, 8, 5)) === 'extended' && prof(st).watch.length === 1 && prof(st).watch[0].b === T(10, 8, 5));
  check('a long pause starts a new period', h.heartbeat(st, 'p1', 'Home', 600000, T(10, 12, 0)) === 'new' && prof(st).watch.length === 2);
  check('the pause is not counted as watched', h.watchPeriods(prof(st), T(10, 12, 0))[0][1] === T(10, 8, 5));
  check('a clock that goes backwards is ignored', h.heartbeat(st, 'p1', 'Home', 600000, T(10, 11, 0)) === '' && prof(st).watch.length === 2);
  check('bad profile id is refused', h.heartbeat(st, '../x', 'Home', 600000, T(10, 12, 1)) === '');
  h.heartbeat(st, 'p1', 'Home', 1, T(10, 12, 1)); check('the allowed pause is never shorter than 10 minutes', prof(st).gap === h.MIN_GAP);
  h.heartbeat(st, 'p1', 'Home', 99 * HR, T(10, 12, 2)); check('...or longer than 6 hours', prof(st).gap === h.MAX_GAP);
  const round = h.cleanStore(JSON.parse(JSON.stringify(st)));
  check('watching periods survive saving and loading', round.profiles.p1.watch.length === 2 && round.profiles.p1.watchSince === prof(st).watchSince && round.profiles.p1.gap === h.MAX_GAP);
  const junk = h.cleanStore({ profiles: { p1: { name: 'x', sessions: [], watch: [{ a: 'x', b: 1 }, null, { a: T(10, 9), b: T(10, 8) }, { a: T(10, 8), b: T(10, 9) }, 5], gap: 'abc', watchSince: -4 } } });
  check('junk in the saved file is dropped, good entries kept', junk.profiles.p1.watch.length === 1 && junk.profiles.p1.gap === h.MIN_GAP && junk.profiles.p1.watchSince === T(10, 8));
  const big = fresh(); for (let i = 0; i < h.MAX_WATCH + 50; i++) h.heartbeat(big, 'p1', 'Home', 600000, T(1, 0) + i * 2 * HR);
  check('the list of watching periods is capped', prof(big).watch.length <= h.MAX_WATCH);
  const old = fresh(); h.heartbeat(old, 'p1', 'Home', 600000, T(10, 0) - 400 * 24 * HR); h.heartbeat(old, 'p1', 'Home', 600000, T(10, 0));
  check('periods older than a year are removed', prof(old).watch.length === 1);
}

console.log('\nA device that drops off while Dashboard Hub is watching');
{
  const st = fresh();
  watch(st, T(10, 0), T(10, 12), 1);
  h.apply(st, 'p1', 'Home', [ev('seen', 'printer', T(10, 0, 0), { name: 'Office printer', os: 'printer' })], T(10, 12));
  h.apply(st, 'p1', 'Home', [ev('left', 'printer', T(10, 3, 12))], T(10, 12));
  h.apply(st, 'p1', 'Home', [ev('back', 'printer', T(10, 5, 20))], T(10, 12));
  const now = T(10, 12), tl = h.timeline(prof(st), T(10, 0), now, now), d = tl.devices[0];
  check('one device in the report', tl.devices.length === 1 && d.name === 'Office printer');
  check('its stretches are up, down, up', d.segments.map((s) => s[2]).join(',') === 'up,down,up', segText(d));
  check('the red stretch is exactly the time it was off', d.segments[1][0] === T(10, 3, 12) && d.segments[1][1] === T(10, 5, 20), segText(d));
  check('time down is 2 h 8 min', d.downMs === 128 * MIN, d.downMs);
  check('uptime percent is worked out from watched time only', Math.abs(d.pct - Math.round(1000 * (720 - 128) / 720) / 10) < 0.2, d.pct);
  const lines = h.story(tl, now, fmt);
  check('one plain sentence tells the story', lines.length === 1 && lines[0].text === 'Office printer went offline at 11-10 03:12, and came back at 11-10 05:20 (off for 2 h 8 min).', lines[0] && lines[0].text);
  check('the summary says what happened', /1 device watched · 1 time a device went offline \(1 device\) · Dashboard Hub was watching 100% of this period/.test(h.summary(tl, now)), h.summary(tl, now));
  check('the default wording says "today 3:12 AM"', /went offline at today 3:12 AM/.test(h.story(tl, now)[0].text), h.story(tl, now)[0].text);
  const later = h.story(h.timeline(prof(st), T(10, 0), T(11, 12), T(11, 12)), T(11, 12))[0].text;
  check('...and "yesterday" a day later', /yesterday 3:12 AM/.test(later), later);
}

console.log('\nStill offline');
{
  const st = fresh(); watch(st, T(10, 0), T(10, 12), 1);
  h.apply(st, 'p1', 'Home', [ev('seen', 'nas', T(10, 0, 0), { name: 'NAS' }), ev('left', 'nas', T(10, 9))], T(10, 12));
  const now = T(10, 12), tl = h.timeline(prof(st), T(10, 0), now, now), l = h.story(tl, now, fmt);
  check('it says the device has not come back and for how long', l.length === 1 && l[0].text === 'NAS went offline at 11-10 09:00, and has not come back yet (off for 3 h so far).', l[0] && l[0].text);
  check('the red stretch runs to now', tl.devices[0].segments[tl.devices[0].segments.length - 1][2] === 'down' && !tl.devices[0].online);
  check('the summary counts it as offline right now', /1 offline right now/.test(h.summary(tl, now)));
}

console.log('\nDashboard Hub was closed overnight');
{
  const st = fresh();
  watch(st, T(10, 18), T(10, 22), 1);                      // watched until 22:00, then closed
  h.apply(st, 'p1', 'Home', [ev('seen', 'cam', T(10, 18, 0), { name: 'Camera' }), ev('seen', 'tv', T(10, 18, 0), { name: 'TV' })], T(10, 22));
  watch(st, T(11, 8), T(11, 9), 1);                        // opened again at 08:00
  h.apply(st, 'p1', 'Home', [ev('left', 'cam', T(11, 8, 1))], T(11, 9));      // the camera was off by then
  const now = T(11, 9), tl = h.timeline(prof(st), T(10, 18), now, now);
  const cam = tl.devices.find((x) => x.name === 'Camera'), tv = tl.devices.find((x) => x.name === 'TV');
  check('the closed hours are gray (unknown), never green or red', cam.segments.some((s) => s[2] === 'unknown' && s[0] === T(10, 22) && s[1] >= T(11, 7, 59)) && tv.segments.some((s) => s[2] === 'unknown'), segText(cam));
  check('the TV that stayed on is green before and after the gap', tv.segments[0][2] === 'up' && tv.segments[tv.segments.length - 1][2] === 'up', segText(tv));
  check('the TV has no "went offline" sentence', tv.downs.length === 0 && h.story(tl, now, fmt).every((x) => !/TV/.test(x.text)));
  const cl = h.story(tl, now, fmt).find((x) => /Camera/.test(x.text));
  check('the camera sentence says "sometime between", not a made-up time', cl && /stopped answering sometime between 11-10 22:00 and 11-11 08:01, while Dashboard Hub was not watching/.test(cl.text), cl && cl.text);
  check('the camera turns red only when watching resumed', cam.segments[cam.segments.length - 1][2] === 'down' && cam.segments[cam.segments.length - 1][0] <= T(11, 8, 1) && cam.segments[cam.segments.length - 1][0] >= T(11, 7, 59), segText(cam));
  check('the unwatched night hours do not count as down time (only the hour after watching resumed does)', cam.downMs > 55 * MIN && cam.downMs < 65 * MIN, cam.downMs);
  check('the report says how much of the period was watched', tl.watchedPct > 20 && tl.watchedPct < 40, tl.watchedPct);
}

console.log('\nRecords from before this feature');
{
  const st = fresh();
  h.apply(st, 'p1', 'Home', [ev('seen', 'old', T(1, 8), { name: 'Old laptop' }), ev('left', 'old', T(1, 12))], T(1, 13));
  const now = T(5, 0), tl = h.timeline(prof(st), T(1, 0), now, now), d = tl.devices[0];
  check('known online hours show as green', d.segments.some((s) => s[2] === 'up' && s[0] === T(1, 8) && s[1] === T(1, 12)), segText(d));
  check('time after it left is gray, not red, as nobody was recording', d.segments[d.segments.length - 1][2] === 'unknown' && d.downMs === 0, segText(d));
}

console.log('\nOther cases');
{
  const st = fresh(); watch(st, T(10, 0), T(10, 12), 1);
  h.apply(st, 'p1', 'Home', [ev('new', 'phone', T(10, 6), { name: 'Phone', os: 'android' })], T(10, 12));
  const now = T(10, 12), d = h.timeline(prof(st), T(10, 0), now, now).devices[0];
  check('before a device was first seen it is "not known", not red', d.segments[0][2] === 'none' && d.segments[1][2] === 'up' && d.downMs === 0, segText(d));
  check('uptime is 100% when it never dropped', d.pct === 100);
  // flapping
  const f = fresh(); watch(f, T(10, 0), T(10, 12), 1);
  const evs = [ev('seen', 'bulb', T(10, 0, 1), { name: 'Bulb' })];
  [[1, 2], [3, 4], [5, 6], [7, 8]].forEach(([a, b]) => { evs.push(ev('left', 'bulb', T(10, a))); evs.push(ev('back', 'bulb', T(10, b))); });
  h.apply(f, 'p1', 'Home', evs, T(10, 12));
  const tl = h.timeline(prof(f), T(10, 0), now, now);
  check('four drops give four sentences, newest first', h.story(tl, now, fmt).length === 4 && h.story(tl, now, fmt)[0].at > h.story(tl, now, fmt)[3].at);
  check('the summary counts them', /4 times a device went offline \(1 device\)/.test(h.summary(tl, now)), h.summary(tl, now));
  // nothing watched at all
  const e = fresh(); h.apply(e, 'p1', 'Home', [ev('seen', 'x', T(10, 1))], T(10, 2));
  const tl2 = h.timeline(prof(e), T(10, 0), T(10, 12), T(10, 12));
  check('with no watching periods nothing is shown as down', tl2.devices.every((x) => x.downMs === 0) && tl2.watchedPct === 0);
  check('a window with no devices gives an honest summary', /No devices watched/.test(h.summary(h.timeline(prof(f), T(1, 0), T(1, 6), now), now)));
  // junk in the window
  check('a silly window does not crash', (() => { try { h.timeline(prof(f), NaN, undefined, now); h.timeline(prof(f), 5, -9, now); return true; } catch (x) { return false; } })());
  check('story with no devices is empty', h.story({ devices: [] }, now).length === 0);
  // device names are text, not markup, and long lists are capped
  const many = fresh(); watch(many, T(10, 0), T(10, 2), 1);
  const batch = []; for (let i = 0; i < 400; i++) batch.push(ev('seen', 'm' + i, T(10, 0, 1), { name: '<b>dev' + i + '</b>', mac: ('aa:bb:cc:00:' + (i >> 8).toString(16).padStart(2, '0') + ':' + (i & 255).toString(16).padStart(2, '0')) }));
  for (let i = 0; i < 400; i += 50) h.apply(many, 'p1', 'Home', batch.slice(i, i + 50), T(10, 2));
  const tlm = h.timeline(prof(many), T(10, 0), T(10, 2), T(10, 2));
  check('at most 300 devices are drawn', tlm.devices.length === 300, tlm.devices.length);
}

console.log('\nHiding short drops');
{
  const st = fresh(); watch(st, T(10, 0), T(10, 12), 1);
  const evs = [ev('seen', 'lamp', T(10, 0, 0), { name: 'Lamp' }), ev('seen', 'nas', T(10, 0, 0), { name: 'NAS' })];
  evs.push(ev('left', 'lamp', T(10, 1, 0)), ev('back', 'lamp', T(10, 1, 1)), ev('left', 'lamp', T(10, 2, 0)), ev('back', 'lamp', T(10, 2, 3)), ev('left', 'lamp', T(10, 3, 0)), ev('back', 'lamp', T(10, 3, 10)));
  evs.push(ev('left', 'nas', T(10, 5, 0)));                     // still off
  h.apply(st, 'p1', 'Home', evs, T(10, 12));
  const now = T(10, 12), tl = h.timeline(prof(st), T(10, 0), now, now);
  check('before hiding: the lamp has 3 drops', tl.devices.find((d) => d.name === 'Lamp').downs.length === 3);
  const two = h.hideShort(tl, 2 * MIN);
  check('drops under 2 minutes are left out of the counts', two.devices.find((d) => d.name === 'Lamp').downs.length === 2 && h.story(two, now, fmt).filter((x) => /Lamp/.test(x.text)).length === 2);
  check('a device that is still offline is always kept', two.devices.find((d) => d.name === 'NAS').downs.length === 1);
  check('the bars (segments) are not touched', JSON.stringify(two.devices.find((d) => d.name === 'Lamp').segments) === JSON.stringify(tl.devices.find((d) => d.name === 'Lamp').segments));
  check('the original report is not changed', tl.devices.find((d) => d.name === 'Lamp').downs.length === 3);
  const five = h.hideShort(tl, 5 * MIN);
  check('a 5 minute limit keeps only the lamp\'s 10 minute drop', five.devices.find((d) => d.name === 'Lamp').downs.length === 1);
  const big = h.hideShort(tl, 15 * MIN);
  check('a longer limit hides more and re-sorts', big.devices[0].name === 'NAS' && big.devices.find((d) => d.name === 'Lamp').downs.length === 0, big.devices.map((d) => d.name + d.downs.length).join());
  check('0 means show everything', h.hideShort(tl, 0) === tl);
}

console.log('\nRepeated short drops are grouped');
{
  const st = fresh(); watch(st, T(10, 0), T(10, 23), 1);
  const evs = [ev('seen', 'bulb', T(10, 0, 0), { name: 'Bulb' })];
  [[1, 1, 3], [1, 20, 22], [1, 40, 41], [5, 0, 3], [5, 30, 52]].forEach(([hh, a, b]) => { evs.push(ev('left', 'bulb', T(10, hh, a))); evs.push(ev('back', 'bulb', T(10, hh, b))); });
  h.apply(st, 'p1', 'Home', evs, T(10, 23));
  const now = T(10, 23), tl = h.timeline(prof(st), T(10, 0), now, now);
  const grouped = h.story(tl, now, fmt), every = h.story(tl, now, fmt, true);
  check('every drop has its own sentence when asked', every.length === 5, every.length);
  check('by default the three quick drops in one hour become one line', grouped.length === 3 && grouped.some((x) => /^Bulb dropped off 3 times between 11-10 01:01 and 11-10 01:41 \(.+ offline in total, none longer than 2 min\)\.$/.test(x.text)), JSON.stringify(grouped.map((x) => x.text)));
  check('a drop of 10 minutes or more is never hidden inside a group', grouped.some((x) => /Bulb went offline at 11-10 05:30, and came back at 11-10 05:52 \(off for 22 min\)/.test(x.text)));
  check('a lone short drop hours later keeps its own sentence', grouped.some((x) => /Bulb went offline at 11-10 05:00, and came back at 11-10 05:03/.test(x.text)));
  check('the grouped line is placed at the time of its last drop', grouped[grouped.length - 1].at === T(10, 1, 40));
}
console.log(failed ? 'FAILED ' + failed : 'All ' + passed + ' passed'); process.exit(failed ? 1 : 0);
