'use strict';
// Notifications Center history: which devices connected and disconnected, and when.
// Pure logic (no Electron), so it can be tested on its own. Every incoming value is checked and cleaned.
//
// A "session" is one stretch of a device being online:
//   { id, key, mac, ips: [..], name, os, vendor, start, startKind, end }
//   start: time (ms) it was noticed connecting, or null when it was already online before Dashboard Hub saw it
//   startKind: 'new' (first time ever seen), 'back' (came back), 'seen' (already online when watching began)
//   end: time (ms) it was noticed disconnecting, or null while it is still online

const KINDS = ['seen', 'new', 'back', 'left', 'ip'];
const OS_IDS = ['windows', 'linux', 'apple', 'android', 'iot', 'console', 'printer', 'router', 'network', 'switch', 'unknown'];
const MAX_SESSIONS = 5000;           // per network profile
const KEEP_MS = 365 * 24 * 3600 * 1000;
const MAX_IPS = 8;
const MAX_WATCH = 3000;              // watching periods kept per profile
const MIN_GAP = 10 * 60 * 1000, MAX_GAP = 6 * 3600 * 1000;

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const validIp = (v) => typeof v === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v) && v.split('.').every((p) => Number(p) <= 255);
const validMac = (v) => typeof v === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v);
const profileId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '');

function cleanEvent(e, now) {
  if (!e || typeof e !== 'object' || !KINDS.includes(e.kind)) return null;
  const key = str(e.key, 80);
  if (!key) return null;
  let t = Number(e.t);
  if (!Number.isFinite(t) || t < 946684800000 || t > now + 5 * 60 * 1000) t = now;     // not before 2000 and not in the future
  return {
    kind: e.kind, key: key, t: Math.round(t),
    mac: validMac(e.mac) ? e.mac.toLowerCase() : '',
    ip: validIp(e.ip) ? e.ip : '',
    name: str(e.name, 80), vendor: str(e.vendor, 60),
    os: OS_IDS.includes(e.os) ? e.os : 'unknown'
  };
}

// watch: the stretches of time Dashboard Hub was really scanning this network ({a, b}); gap: how long a pause still counts as "watching"
// watchSince: when watching was first recorded (older sessions come from before this record existed)
function emptyProfile(name) { return { name: str(name, 60) || 'Network', seq: 0, sessions: [], watch: [], gap: MIN_GAP, watchSince: 0 }; }

// load whatever is on disk and keep only well-formed data
function cleanStore(raw) {
  const out = { profiles: {} };
  const src = raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  Object.keys(src).slice(0, 50).forEach((id) => {
    if (!profileId(id)) return;
    const p = src[id];
    if (!p || typeof p !== 'object') return;
    const prof = emptyProfile(p.name);
    prof.seq = Number.isInteger(p.seq) && p.seq >= 0 ? p.seq : 0;
    prof.gap = Number.isFinite(p.gap) ? Math.min(MAX_GAP, Math.max(MIN_GAP, Math.round(p.gap))) : MIN_GAP;
    (Array.isArray(p.watch) ? p.watch : []).slice(-MAX_WATCH).forEach((w) => {
      if (w && Number.isFinite(w.a) && Number.isFinite(w.b) && w.a > 946684800000 && w.b >= w.a) prof.watch.push({ a: Math.round(w.a), b: Math.round(w.b) });
    });
    prof.watch.sort((x, y) => x.a - y.a);
    prof.watchSince = Number.isFinite(p.watchSince) && p.watchSince > 946684800000 ? Math.round(p.watchSince) : (prof.watch.length ? prof.watch[0].a : 0);
    (Array.isArray(p.sessions) ? p.sessions : []).slice(0, MAX_SESSIONS).forEach((s) => {
      if (!s || typeof s !== 'object') return;
      const key = str(s.key, 80);
      if (!key) return;
      const num = (v) => (Number.isFinite(v) && v > 946684800000 ? Math.round(v) : null);
      prof.sessions.push({
        id: str(String(s.id || ''), 12) || String(++prof.seq), key: key, mac: validMac(s.mac) ? s.mac.toLowerCase() : '',
        ips: (Array.isArray(s.ips) ? s.ips : []).filter(validIp).slice(0, MAX_IPS), name: str(s.name, 80), os: OS_IDS.includes(s.os) ? s.os : 'unknown', vendor: str(s.vendor, 60),
        start: num(s.start), startKind: ['seen', 'new', 'back'].includes(s.startKind) ? s.startKind : 'seen', end: num(s.end)
      });
    });
    out.profiles[id] = prof;
  });
  return out;
}

function openSession(prof, ev) {
  for (let i = prof.sessions.length - 1; i >= 0; i--) {
    const s = prof.sessions[i];
    if (s.end !== null) continue;
    if ((ev.mac && s.mac === ev.mac) || s.key === ev.key) return s;
    // a device first seen by its IP address only, whose MAC address is learned later
    if (ev.mac && !s.mac && ev.ip && s.ips.includes(ev.ip)) return s;
  }
  return null;
}

function addIp(s, ip) {
  if (!ip || s.ips.includes(ip)) return;
  s.ips.push(ip);
  if (s.ips.length > MAX_IPS) s.ips.shift();
}

function fill(s, ev) {
  if (ev.mac) { s.mac = ev.mac; s.key = ev.key; }
  if (ev.name) s.name = ev.name;
  if (ev.os && ev.os !== 'unknown') s.os = ev.os;
  if (ev.vendor) s.vendor = ev.vendor;
  addIp(s, ev.ip);
}

// keeps the same list object, only removes entries
function keepOnly(list, fn) {
  let w = 0;
  for (let i = 0; i < list.length; i++) if (fn(list[i])) list[w++] = list[i];
  list.length = w;
}

function prune(prof, now) {
  keepOnly(prof.sessions, (s) => s.end === null || now - s.end < KEEP_MS);
  if (prof.sessions.length > MAX_SESSIONS) {
    // drop the oldest finished records first
    const closed = prof.sessions.filter((s) => s.end !== null).sort((a, b) => a.end - b.end);
    const drop = new Set(closed.slice(0, prof.sessions.length - MAX_SESSIONS).map((s) => s.id));
    keepOnly(prof.sessions, (s) => !drop.has(s.id));
  }
}

// events: array from the map. Returns true when anything changed.
function apply(store, id, name, events, now) {
  now = Number.isFinite(now) ? now : Date.now();
  id = profileId(id);
  if (!id || !Array.isArray(events)) return false;
  if (!store.profiles[id]) {
    if (Object.keys(store.profiles).length >= 50) return false;
    store.profiles[id] = emptyProfile(name);
  }
  const prof = store.profiles[id];
  if (str(name, 60)) prof.name = str(name, 60);
  let changed = false;
  events.slice(0, 500).map((e) => cleanEvent(e, now)).filter(Boolean).sort((a, b) => a.t - b.t).forEach((ev) => {
    const open = openSession(prof, ev);
    if (ev.kind === 'seen' || ev.kind === 'new' || ev.kind === 'back') {
      if (open) { fill(open, ev); changed = true; return; }
      const s = { id: String(++prof.seq), key: ev.key, mac: '', ips: [], name: '', os: 'unknown', vendor: '', start: ev.t, startKind: ev.kind, end: null };
      fill(s, ev);
      prof.sessions.push(s);
      changed = true;
    } else if (ev.kind === 'left') {
      if (open) { fill(open, ev); open.end = Math.max(ev.t, open.start || 0); changed = true; return; }
      // a device that was online before history began: keep one record that only knows when it left
      const known = prof.sessions.some((s) => s.key === ev.key || (ev.mac && s.mac === ev.mac));
      if (known) return;
      const s = { id: String(++prof.seq), key: ev.key, mac: '', ips: [], name: '', os: 'unknown', vendor: '', start: null, startKind: 'seen', end: ev.t };
      fill(s, ev);
      prof.sessions.push(s);
      changed = true;
    } else if (ev.kind === 'ip' && open) {
      fill(open, ev);
      changed = true;
    }
  });
  if (changed) prune(prof, now);
  return changed;
}

function duration(s, now) {
  const from = s.start, to = s.end === null ? now : s.end;
  return from === null || to < from ? null : to - from;
}

function humanDuration(ms) {
  if (ms === null || ms === undefined) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under 1 min';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 48) return h + ' h' + (rest ? ' ' + rest + ' min' : '');
  const d = Math.floor(h / 24);
  return d + ' d' + (h % 24 ? ' ' + (h % 24) + ' h' : '');
}

// ---------- uptime and history ----------
// Called after every finished scan. Returns 'new' when a new watching period started, 'extended' when the current one grew, '' if nothing was done.
function heartbeat(store, id, name, gapMs, now) {
  now = Number.isFinite(now) ? now : Date.now();
  id = profileId(id);
  if (!id) return '';
  if (!store.profiles[id]) {
    if (Object.keys(store.profiles).length >= 50) return '';
    store.profiles[id] = emptyProfile(name);
  }
  const prof = store.profiles[id];
  if (str(name, 60)) prof.name = str(name, 60);
  prof.gap = Number.isFinite(gapMs) ? Math.min(MAX_GAP, Math.max(MIN_GAP, Math.round(gapMs))) : MIN_GAP;
  const last = prof.watch[prof.watch.length - 1];
  if (last && now >= last.b && now - last.b <= prof.gap) { last.b = now; return 'extended'; }
  if (last && now < last.b) return '';                                   // the clock went backwards: ignore
  prof.watch.push({ a: now - 45000, b: now });                             // a scan takes a little while: the period starts just before it ended
  if (!prof.watchSince) prof.watchSince = now - 45000;
  keepOnly(prof.watch, (w) => now - w.b < KEEP_MS);
  if (prof.watch.length > MAX_WATCH) prof.watch.splice(0, prof.watch.length - MAX_WATCH);
  return 'new';
}

// the watching periods as [a, b] pairs; the newest one runs up to "now" while it is still current
function watchPeriods(prof, now) {
  const w = prof.watch.map((x) => [x.a, x.b]);
  const l = w[w.length - 1];
  if (l && now > l[1] && now - l[1] <= prof.gap) l[1] = now;
  return w;
}

// For every device: coloured stretches between "from" and "to" ('up', 'down', 'unknown' = not watched, 'none' = not known yet),
// how long it was up and down, and every time it went offline. Nothing is guessed: time when Dashboard Hub was not watching stays 'unknown'.
function timeline(prof, from, to, now) {
  now = Number.isFinite(now) ? now : Date.now();
  to = Math.min(Number.isFinite(to) ? to : now, now);
  from = Number.isFinite(from) ? Math.min(from, to - 60000) : to - 86400000;
  const W = watchPeriods(prof, now);
  const legacyBefore = prof.watchSince || Infinity;                      // before watching was recorded, only the known online stretches are certain
  const inW = (m) => W.some((w) => m >= w[0] && m <= w[1]);
  // When a device is first found missing right after Dashboard Hub was closed for a while, it went down some time in that unwatched
  // stretch: the red part starts when watching resumed, and the sentence says "sometime between".
  const endInfo = (s) => {
    if (s.end === null) return { end: null, shown: null, gapFrom: null };
    const k = W.findIndex((w) => w[0] <= s.end && s.end <= w[1]);
    if (k > 0 && s.end - W[k][0] <= 10 * 60000 && W[k][0] - W[k - 1][1] > prof.gap && (s.start === null || s.start <= W[k - 1][1])) return { end: s.end, shown: W[k][0], gapFrom: W[k - 1][1] };
    return { end: s.end, shown: s.end, gapFrom: null };
  };
  const groups = new Map();
  prof.sessions.forEach((s) => { const k = s.mac || s.key; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(Object.assign({}, s, { _i: endInfo(s) })); });
  const out = [];
  groups.forEach((list, k) => {
    list.sort((a, b) => (a.start === null ? -Infinity : a.start) - (b.start === null ? -Infinity : b.start));
    const first = list[0].start === null ? -Infinity : list[0].start;
    const cuts = new Set([from, to]);
    const add = (t) => { if (t !== null && t > from && t < to) cuts.add(t); };
    W.forEach((w) => { add(w[0]); add(w[1]); });
    add(legacyBefore === Infinity ? null : legacyBefore);
    list.forEach((s) => { add(s.start); add(s._i.shown); });
    const pts = Array.from(cuts).sort((a, b) => a - b);
    const segs = [];
    let up = 0, down = 0, touched = false;
    for (let i = 0; i + 1 < pts.length; i++) {
      const x = pts[i], y = pts[i + 1], m = (x + y) / 2;
      const inSess = list.some((s) => (s.start === null || s.start <= m) && (s._i.shown === null || s._i.shown > m));
      let st;
      if (m < legacyBefore) st = inSess ? 'up' : 'unknown';
      else if (!inW(m)) st = 'unknown';
      else if (inSess) st = 'up';
      else st = first <= m ? 'down' : 'none';
      if (st === 'up') { up += y - x; touched = true; } else if (st === 'down') { down += y - x; touched = true; }
      const l = segs[segs.length - 1];
      if (l && l[2] === st) l[1] = y; else segs.push([x, y, st]);
    }
    if (!touched) return;
    // every time it went offline inside the period
    const downs = [];
    list.forEach((s, i) => {
      if (s.end === null || s.end < from || s.end > to) return;
      const nxt = list.slice(i + 1).find((q) => q.start !== null && q.start >= s.end) || null;
      downs.push({ at: s.end, back: nxt ? nxt.start : null, lenMs: nxt ? Math.max(0, nxt.start - s._i.shown) : Math.max(0, to - s._i.shown), gapFrom: s._i.gapFrom });
    });
    const latest = list[list.length - 1];
    const named = list.slice().reverse().find((s) => s.name) || latest;
    out.push({
      key: k, name: named.name || latest.ips[latest.ips.length - 1] || latest.mac || latest.key, os: (list.slice().reverse().find((s) => s.os !== 'unknown') || latest).os,
      mac: latest.mac, ip: latest.ips[latest.ips.length - 1] || '', online: list.some((s) => s.end === null), segments: segs,
      upMs: up, downMs: down, pct: up + down > 0 ? Math.round(1000 * up / (up + down)) / 10 : null, downs: downs
    });
  });
  out.sort((a, b) => (a.online ? 1 : 0) - (b.online ? 1 : 0) || b.downs.length - a.downs.length || (a.pct === null ? 101 : a.pct) - (b.pct === null ? 101 : b.pct) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
  let watched = 0;
  W.forEach((w) => { watched += Math.max(0, Math.min(w[1], to) - Math.max(w[0], from)); });
  return { from: from, to: to, devices: out.slice(0, 300), watchedMs: watched, watchedPct: Math.round(1000 * Math.min(1, watched / Math.max(1, to - from))) / 10, since: prof.watchSince || 0 };
}

// Many small gadgets (lamps, plugs, phones asleep) drop off for a minute or two all day. This leaves out drops shorter than ms from the
// sentences and counts (a device that is still offline is always kept). The coloured bars are not changed: they stay truthful.
function hideShort(tl, ms) {
  if (!(ms > 0)) return tl;
  const devices = tl.devices.map((d) => Object.assign({}, d, { downs: d.downs.filter((x) => x.back === null || x.lenMs >= ms) }));
  devices.sort((a, b) => (a.online ? 1 : 0) - (b.online ? 1 : 0) || b.downs.length - a.downs.length || (a.pct === null ? 101 : a.pct) - (b.pct === null ? 101 : b.pct) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
  return Object.assign({}, tl, { devices: devices });
}

// "today 3:12 AM", "yesterday 11:40 PM", "Mon, Nov 9, 3:12 AM"
function friendlyTime(now) {
  return (t) => {
    const d = new Date(t), n = new Date(now);
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const diff = Math.round((day(n) - day(d)) / 86400000);
    if (diff === 0) return 'today ' + clock;
    if (diff === 1) return 'yesterday ' + clock;
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + clock;
  };
}

// The sentences, newest first. fmt turns a time into words (tests give their own).
// A device that keeps dropping for a few minutes and coming back gets ONE line for the whole bout, not one line per drop.
const BRIEF_MS = 10 * 60000, BOUT_GAP_MS = 60 * 60000;
function story(tl, now, fmt, every) {        // every = true: one sentence per drop, nothing grouped
  fmt = fmt || friendlyTime(now);
  const lines = [];
  const one = (d, x) => {
    let t;
    if (x.gapFrom !== null) t = d.name + ' stopped answering sometime between ' + fmt(x.gapFrom) + ' and ' + fmt(x.at) + ', while Dashboard Hub was not watching';
    else t = d.name + ' went offline at ' + fmt(x.at);
    if (x.back !== null) t += ', and came back at ' + fmt(x.back) + ' (off for ' + (x.gapFrom !== null ? 'at least ' : '') + humanDuration(x.lenMs) + ').';
    else t += d.online ? '.' : ', and has not come back yet (off for ' + humanDuration(x.lenMs) + ' so far).';
    return { at: x.at, key: d.key, count: 1, text: t };
  };
  tl.devices.forEach((d) => {
    const bouts = [];
    let cur = null;
    d.downs.slice().sort((a, b) => a.at - b.at).forEach((x) => {
      const brief = x.back !== null && x.gapFrom === null && x.lenMs < BRIEF_MS;
      if (!brief || every) { lines.push(one(d, x)); cur = null; return; }
      if (cur && x.at - cur.lastBack <= BOUT_GAP_MS) { cur.list.push(x); cur.lastBack = x.back; } else { cur = { list: [x], lastBack: x.back }; bouts.push(cur); }
    });
    bouts.forEach((c) => {
      if (c.list.length === 1) { lines.push(one(d, c.list[0])); return; }
      const total = c.list.reduce((n, x) => n + x.lenMs, 0), longest = c.list.reduce((n, x) => Math.max(n, x.lenMs), 0);
      lines.push({ at: c.list[c.list.length - 1].at, key: d.key, count: c.list.length,
        text: d.name + ' dropped off ' + c.list.length + ' times between ' + fmt(c.list[0].at) + ' and ' + fmt(c.lastBack) + ' (' + humanDuration(total) + ' offline in total, none longer than ' + humanDuration(longest) + ').' });
    });
  });
  lines.sort((a, b) => b.at - a.at);
  return lines.slice(0, every ? 600 : 200);
}

function summary(tl, now) {
  const total = tl.devices.length;
  const withDowns = tl.devices.filter((d) => d.downs.length);
  const drops = withDowns.reduce((n, d) => n + d.downs.length, 0);
  const notOnline = tl.devices.filter((d) => !d.online).length;
  const parts = [];
  parts.push(total ? total + ' device' + (total === 1 ? '' : 's') + ' watched' : 'No devices watched in this period');
  if (total) parts.push(drops ? drops + ' time' + (drops === 1 ? '' : 's') + ' a device went offline (' + withDowns.length + ' device' + (withDowns.length === 1 ? '' : 's') + ')' : 'no device went offline');
  if (notOnline) parts.push(notOnline + ' offline right now');
  parts.push('Dashboard Hub was watching ' + tl.watchedPct + '% of this period');
  return parts.join(' · ');
}

const csvCell = (v) => {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;               // a spreadsheet must never treat a name as a formula
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const when = (t) => (t === null || t === undefined ? '' : new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
const NOTE = { new: 'First time seen', back: 'Came back', seen: 'Already online when watching began' };

function toCsv(sessions, now) {
  const head = ['Device', 'Type', 'MAC address', 'IP address(es)', 'Connected (UTC)', 'Disconnected (UTC)', 'Minutes online', 'Status', 'How it was noted'];
  const rows = sessions.map((s) => {
    const d = duration(s, now);
    return [s.name || (s.ips[s.ips.length - 1] || s.mac || s.key), s.os, s.mac, s.ips.join(' '), when(s.start), when(s.end), d === null ? '' : Math.round(d / 60000), s.end === null ? 'Online' : 'Disconnected', s.start === null ? 'Connect time unknown (online before watching began)' : NOTE[s.startKind] || ''];
  });
  return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { KINDS, OS_IDS, MAX_SESSIONS, MAX_WATCH, MIN_GAP, MAX_GAP, profileId, cleanEvent, cleanStore, apply, prune, duration, humanDuration, toCsv, csvCell, heartbeat, watchPeriods, timeline, story, summary, friendlyTime, hideShort };
