'use strict';
//   node test/notif-history-test.js
const H = require('../notif-history');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const T0 = Date.UTC(2026, 10, 13, 12, 0, 0), MIN = 60000;
const ev = (kind, t, o) => Object.assign({ kind, key: 'aa:bb:cc:00:00:01', t, mac: 'aa:bb:cc:00:00:01', ip: '192.168.0.10', name: 'Laptop', os: 'windows' }, o || {});
let store = H.cleanStore(null);

// connect then disconnect
H.apply(store, 'default', 'Home network', [ev('new', T0)], T0 + 1);
let s = store.profiles.default.sessions;
check('a new device makes one open session', s.length === 1 && s[0].end === null && s[0].start === T0 && s[0].startKind === 'new');
check('it keeps MAC, IP, name and type', s[0].mac === 'aa:bb:cc:00:00:01' && s[0].ips[0] === '192.168.0.10' && s[0].name === 'Laptop' && s[0].os === 'windows');
H.apply(store, 'default', 'Home network', [ev('left', T0 + 30 * MIN)], T0 + 31 * MIN);
check('leaving closes that session with the time', s[0].end === T0 + 30 * MIN && H.duration(s[0], T0) === 30 * MIN);
H.apply(store, 'default', 'Home network', [ev('left', T0 + 40 * MIN)], T0 + 41 * MIN);
check('a second "left" for the same device does not change anything', s.length === 1 && s[0].end === T0 + 30 * MIN);
H.apply(store, 'default', 'Home network', [ev('back', T0 + 60 * MIN, { ip: '192.168.0.55' })], T0 + 61 * MIN);
check('coming back is a new session (history keeps both)', s.length === 2 && s[1].startKind === 'back' && s[1].end === null);
check('with the new IP address it came back on', s[1].ips.join() === '192.168.0.55');
H.apply(store, 'default', 'Home network', [ev('ip', T0 + 70 * MIN, { ip: '192.168.0.77' })], T0 + 71 * MIN);
check('an address change while online is added to the same session', s.length === 2 && s[1].ips.join() === '192.168.0.55,192.168.0.77');

// first scan, and a device already online
H.apply(store, 'default', 'Home network', [ev('seen', T0, { key: 'aa:bb:cc:00:00:09', mac: 'aa:bb:cc:00:00:09', ip: '192.168.0.9', name: 'NAS', os: 'linux' })], T0);
check('a device already online at the first scan is marked "seen"', s.length === 3 && s[2].startKind === 'seen' && s[2].end === null);
H.apply(store, 'default', 'Home network', [ev('left', T0 + 5 * MIN, { key: 'ip:192.168.0.99', mac: '', ip: '192.168.0.99', name: 'Old thing', os: 'iot' })], T0 + 6 * MIN);
check('a device that left before history began keeps one record with an unknown connect time', s.length === 4 && s[3].start === null && s[3].end === T0 + 5 * MIN && H.duration(s[3], T0) === null);

// matching by MAC when the key changes (IP-keyed device gets its MAC later)
H.apply(store, 'default', 'Home network', [ev('new', T0, { key: 'ip:10.0.0.4', mac: '', ip: '10.0.0.4', name: 'x', os: 'iot' })], T0);
H.apply(store, 'default', 'Home network', [ev('left', T0 + MIN, { key: 'de:ad:be:ef:00:04', mac: 'de:ad:be:ef:00:04', ip: '10.0.0.4', name: 'x', os: 'iot' })], T0 + 2 * MIN);
const x = s.filter((q) => q.ips.includes('10.0.0.4'));
check('a device re-keyed from its IP to its MAC is still the same record', x.length === 1 && x[0].end === T0 + MIN && x[0].mac === 'de:ad:be:ef:00:04', JSON.stringify(x));

// separate profiles
H.apply(store, 'office', 'Office', [ev('new', T0)], T0);
check('each profile has its own history', store.profiles.office.sessions.length === 1 && store.profiles.default.sessions.length === 4 + 1);
check('and keeps its name', store.profiles.office.name === 'Office');

// bad input
const before = JSON.stringify(store);
H.apply(store, '../evil', 'x', [ev('new', T0)], T0);
H.apply(store, 'default', 'x', 'not a list', T0);
H.apply(store, 'default', 'x', [null, 5, { kind: 'explode', key: 'k' }, { kind: 'new' }, { kind: 'new', key: '' }], T0);
check('bad profile ids, bad lists and bad events are ignored', JSON.stringify(store).replace(/"name":"x"/g, '"name":"Home network"') === before.replace(/"name":"x"/g, '"name":"Home network"') || JSON.stringify(store.profiles.default.sessions) === JSON.stringify(JSON.parse(before).profiles.default.sessions));
H.apply(store, 'default', 'Home network', [ev('new', T0, { key: 'k1', mac: 'ZZ', ip: '999.1.1.1', name: '<script>alert(1)</script>\u0007\n' + 'a'.repeat(300), os: 'toaster' })], T0);
const k = store.profiles.default.sessions.find((q) => q.key === 'k1');
check('a bad MAC, bad IP and unknown type are blanked', k && k.mac === '' && k.ips.length === 0 && k.os === 'unknown');
check('control characters are removed and long names are cut', k && !/[\u0000-\u001f]/.test(k.name) && k.name.length <= 80);
H.apply(store, 'default', 'Home network', [ev('new', 0, { key: 'k2', mac: '', ip: '10.9.9.2' }), ev('new', T0 * 3, { key: 'k3', mac: '', ip: '10.9.9.3' })], T0);
const k2 = store.profiles.default.sessions.find((q) => q.key === 'k2'), k3 = store.profiles.default.sessions.find((q) => q.key === 'k3');
check('impossible times (year 1970, far future) are replaced by "now"', k2.start === T0 && k3.start === T0);

// size limits
const big = H.cleanStore(null);
const many = [];
for (let i = 0; i < 400; i++) many.push({ kind: 'new', key: 'k' + i, t: T0 + i, name: 'd' + i });
for (let round = 0; round < 14; round++) {
  H.apply(big, 'p', 'P', many.map((e, i) => Object.assign({}, e, { key: 'r' + round + 'k' + i })), T0 + round * 1000);
  H.apply(big, 'p', 'P', many.map((e, i) => ({ kind: 'left', key: 'r' + round + 'k' + i, t: T0 + round * 1000 + 500, name: e.name })), T0 + round * 1000 + 600);
}
check('history is capped at ' + H.MAX_SESSIONS + ' records per profile', big.profiles.p.sessions.length <= H.MAX_SESSIONS && big.profiles.p.sessions.length > 4000, big.profiles.p.sessions.length);
const old = H.cleanStore(null);
H.apply(old, 'p', 'P', [{ kind: 'new', key: 'a', t: T0 - 400 * 86400000 }, { kind: 'left', key: 'a', t: T0 - 399 * 86400000 }, { kind: 'new', key: 'b', t: T0 - 1000 }], T0 - 399 * 86400000 + 10);
H.apply(old, 'p', 'P', [{ kind: 'ip', key: 'b', t: T0, ip: '10.0.0.1' }], T0);
check('finished records older than a year are dropped, open ones stay', old.profiles.p.sessions.length === 1 && old.profiles.p.sessions[0].key === 'b');

// reading a damaged file
const dmg = H.cleanStore({ profiles: { default: { name: 5, sessions: [{ key: 'a', start: 'x', end: -5, ips: ['1.1.1.1', 'bad', 7], os: 'evil' }, null, 3, { nokey: 1 }] }, '../x': { sessions: [] }, ok: 'no' } });
check('a damaged file loads as clean data', Object.keys(dmg.profiles).join() === 'default' && dmg.profiles.default.sessions.length === 1 && dmg.profiles.default.sessions[0].start === null && dmg.profiles.default.sessions[0].end === null && dmg.profiles.default.sessions[0].ips.join() === '1.1.1.1' && dmg.profiles.default.sessions[0].os === 'unknown');
check('garbage instead of a file loads as empty', Object.keys(H.cleanStore('hello').profiles).length === 0 && Object.keys(H.cleanStore(null).profiles).length === 0);

// export
const csv = H.toCsv([{ id: '1', key: 'k', mac: 'aa:bb:cc:00:00:01', ips: ['10.0.0.1', '10.0.0.2'], name: '=HYPERLINK("http://evil")', os: 'iot', vendor: '', start: T0, startKind: 'new', end: T0 + 90 * MIN }, { id: '2', key: 'k', mac: '', ips: [], name: 'Has, comma', os: 'linux', vendor: '', start: null, startKind: 'seen', end: null }], T0 + 100 * MIN);
const lines = csv.trim().split('\r\n');
check('CSV has a header and one line per record', lines.length === 3 && /^Device,Type,MAC address/.test(lines[0]));
check('a name that looks like a spreadsheet formula is neutralised', lines[1].startsWith('"\'=HYPERLINK(""http://evil"")"'), lines[1]);
check('the CSV shows minutes online, IPs and times', /90,Disconnected/.test(lines[1]) && /10\.0\.0\.1 10\.0\.0\.2/.test(lines[1]) && /2026-11-13 12:00:00 UTC/.test(lines[1]) && /2026-11-13 13:30:00 UTC/.test(lines[1]), lines[1]);
check('commas inside a name are quoted and unknown times are said to be unknown', /"Has, comma"/.test(lines[2]) && /unknown/.test(lines[2]) && /Online/.test(lines[2]), lines[2]);
check('durations read in plain words', H.humanDuration(30 * 1000) === 'under 1 min' && H.humanDuration(5 * MIN) === '5 min' && H.humanDuration(134 * MIN) === '2 h 14 min' && H.humanDuration(3 * 24 * 3600000 + 5 * 3600000) === '3 d 5 h' && H.humanDuration(null) === '');

console.log(failed ? '\nFAILED ' + failed : '\nAll ' + passed + ' passed'); process.exit(failed ? 1 : 0);
