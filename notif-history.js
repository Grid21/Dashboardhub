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

function emptyProfile(name) { return { name: str(name, 60) || 'Network', seq: 0, sessions: [] }; }

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

module.exports = { KINDS, OS_IDS, MAX_SESSIONS, profileId, cleanEvent, cleanStore, apply, prune, duration, humanDuration, toCsv, csvCell };
