'use strict';
// Notifications Center window: shows which devices connected and disconnected, and when.
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.notifApi;
  const OS_NAMES = { router: 'Router', windows: 'Windows', linux: 'Linux / Unix', apple: 'Apple (macOS / iOS)', android: 'Android', iot: 'IoT / smart device', console: 'Game console', printer: 'Printer', network: 'Router / network device', switch: 'Switch', unknown: 'Unknown' };
  const MAX_ROWS = 1000;
  const state = { profile: '', profiles: [], sessions: [], now: Date.now(), sortKey: 'recent', sortDir: -1 };
  let shown = [];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const fmt = (t) => new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function human(ms) {
    if (ms === null || ms === undefined) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'under 1 min';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), rest = m % 60;
    if (h < 48) return h + ' h' + (rest ? ' ' + rest + ' min' : '');
    const d = Math.floor(h / 24);
    return d + ' d' + (h % 24 ? ' ' + (h % 24) + ' h' : '');
  }
  const dur = (s) => (s.start === null ? null : Math.max(0, (s.end === null ? state.now : s.end) - s.start));
  const label = (s) => s.name || s.ips[s.ips.length - 1] || s.mac || s.key;
  const activity = (s) => Math.max(s.start || 0, s.end || 0);

  function message(text, bad) { const m = $('ncMsg'); m.textContent = text || ''; m.classList.toggle('bad', !!bad); }

  function filtered() {
    const q = $('ncSearch').value.trim().toLowerCase();
    const kind = $('ncKind').value, status = $('ncStatus').value, range = Number($('ncRange').value);
    return state.sessions.filter((s) => {
      if (kind !== 'all' && (kind === 'network' ? !['router', 'network', 'switch'].includes(s.os) : s.os !== kind)) return false;
      if (status === 'online' && s.end !== null) return false;
      if (status === 'gone' && s.end === null) return false;
      if (range && s.end !== null && state.now - s.end > range) return false;       // online devices always count
      if (q) {
        const hay = (label(s) + ' ' + s.mac + ' ' + s.ips.join(' ') + ' ' + s.vendor + ' ' + (OS_NAMES[s.os] || '')).toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  function sortList(list) {
    const k = state.sortKey, d = state.sortDir;
    const val = (s) => k === 'name' ? label(s).toLowerCase() : k === 'os' ? (OS_NAMES[s.os] || '').toLowerCase() : k === 'start' ? (s.start === null ? -1 : s.start) : k === 'end' ? (s.end === null ? Infinity : s.end) : k === 'dur' ? (dur(s) === null ? -1 : dur(s)) : activity(s);
    return list.slice().sort((a, b) => { const x = val(a), y = val(b); return x < y ? -d : x > y ? d : 0; });
  }

  function timeCell(t, kind, isStart) {
    const td = el('td', 'nc-time');
    if (t === null) { td.appendChild(el('span', 'nc-unknown', 'Unknown')); td.appendChild(el('span', 'nc-note', 'online before watching began')); return td; }
    td.appendChild(document.createTextNode(fmt(t)));
    if (isStart && kind === 'seen') td.appendChild(el('span', 'nc-note', 'already online when watching began'));
    else if (isStart && kind === 'back') td.appendChild(el('span', 'nc-note', 'came back'));
    else if (isStart && kind === 'new') td.appendChild(el('span', 'nc-note', 'first time seen'));
    return td;
  }

  function render() {
    state.now = Date.now();
    const all = filtered();
    shown = sortList(all);
    const body = $('ncRows');
    body.textContent = '';
    shown.slice(0, MAX_ROWS).forEach((s) => {
      const tr = document.createElement('tr');
      const c1 = el('td'); c1.appendChild(el('div', 'nc-name', label(s))); if (s.vendor) c1.appendChild(el('div', 'nc-vendor', s.vendor)); tr.appendChild(c1);
      tr.appendChild(el('td', '', OS_NAMES[s.os] || 'Unknown'));
      tr.appendChild(el('td', 'nc-mono', s.mac || 'not known'));
      tr.appendChild(el('td', 'nc-mono', s.ips.length ? s.ips.join('\n') : 'not known'));
      tr.lastChild.style.whiteSpace = 'pre-line';
      tr.appendChild(timeCell(s.start, s.startKind, true));
      if (s.end === null) { const td = el('td', 'nc-time'); const sp = el('span', 'nc-online'); sp.appendChild(el('span', 'nc-dot on')); sp.appendChild(document.createTextNode('Online now')); td.appendChild(sp); tr.appendChild(td); } else tr.appendChild(timeCell(s.end, null, false));
      const d = dur(s);
      tr.appendChild(el('td', 'nc-time', d === null ? '' : human(d) + (s.end === null ? ' so far' : '')));
      body.appendChild(tr);
    });
    document.querySelectorAll('#ncTable th.sortable').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === state.sortKey) th.classList.add(state.sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    });
    const online = state.sessions.filter((s) => s.end === null).length;
    $('ncCount').textContent = state.sessions.length
      ? shown.length + ' of ' + state.sessions.length + ' records' + (shown.length > MAX_ROWS ? ' (showing the newest ' + MAX_ROWS + '; narrow the filters, or export to see all)' : '') + '. ' + online + ' online now.'
      : '';
    const empty = $('ncEmpty');
    empty.classList.toggle('hidden', shown.length > 0);
    $('ncTable').classList.toggle('hidden', shown.length === 0);
    if (!state.profile) empty.textContent = 'No network history yet. Open the Network Map in Dashboard Hub and scan your network. Devices that connect and disconnect will be listed here.';
    else if (!state.sessions.length) empty.textContent = 'Nothing recorded for this network yet. Scan your network on the Network Map (turn on Live update to keep watching), and every device that connects or disconnects will be listed here.';
    else empty.textContent = 'Nothing matches the search and filters above.';
    $('ncExport').disabled = shown.length === 0;
    $('ncClear').disabled = !state.sessions.length;
  }

  function fillProfiles() {
    const sel = $('ncProfile');
    sel.textContent = '';
    state.profiles.forEach((p) => { const o = el('option', '', p.name + ' (' + p.count + ')'); o.value = p.id; sel.appendChild(o); });
    if (!state.profiles.length) { const o = el('option', '', 'No history yet'); o.value = ''; sel.appendChild(o); }
    sel.value = state.profile;
    sel.disabled = state.profiles.length < 2;
  }

  async function load(profile) {
    if (!api) return;
    const r = await api.data(profile === undefined ? state.profile : profile);
    if (!r || !r.ok) return;
    state.now = r.now; state.profiles = r.profiles;
    let pid = r.profile;
    if ((!pid || !r.profiles.some((p) => p.id === pid)) && r.profiles.length) {
      pid = r.profiles[0].id;
      const again = await api.data(pid);
      if (again && again.ok) { state.sessions = again.sessions; state.now = again.now; }
    } else state.sessions = r.sessions;
    state.profile = pid || '';
    fillProfiles();
    render();
  }

  let timer = null;
  const soon = () => { if (timer) return; timer = setTimeout(() => { timer = null; load(); }, 300); };

  const q = new URLSearchParams(location.search);
  const first = (q.get('profile') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

  // type filter
  const kindSel = $('ncKind');
  [['all', 'All types']].concat([['windows', 'Windows'], ['linux', 'Linux / Unix'], ['apple', 'Apple (macOS / iOS)'], ['android', 'Android'], ['iot', 'IoT / smart devices'], ['console', 'Game consoles'], ['printer', 'Printers'], ['network', 'Routers, switches and network devices'], ['unknown', 'Other / unknown']]).forEach((k) => { const o = el('option', '', k[1]); o.value = k[0]; kindSel.appendChild(o); });

  $('ncProfile').addEventListener('change', (e) => { state.profile = e.target.value; load(state.profile); });
  ['ncSearch'].forEach((id) => $(id).addEventListener('input', render));
  ['ncKind', 'ncStatus', 'ncRange'].forEach((id) => $(id).addEventListener('change', render));
  document.querySelectorAll('#ncTable th.sortable').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.sortDir = -state.sortDir; else { state.sortKey = k; state.sortDir = k === 'name' || k === 'os' ? 1 : -1; }
    render();
  }));
  $('ncExport').addEventListener('click', async () => {
    message('');
    const r = await api.export(state.profile, shown.map((s) => s.id));
    if (r && r.ok) message('Saved ' + r.count + ' records to ' + r.file);
    else if (r && !r.cancelled) message((r && r.error) || 'Could not save the file.', true);
  });
  $('ncClear').addEventListener('click', async () => {
    message('');
    const r = await api.clear(state.profile);
    if (r && r.ok) { message('History cleared.'); load(); }
  });

  if (api) {
    api.onChanged(soon);
    api.onProfile((id) => { if (typeof id === 'string') { state.profile = id; load(id); } });
  }
  setInterval(() => { if (!document.hidden) render(); }, 30000);       // keeps "so far" times fresh
  state.profile = first;
  load(first);
  window.hubNotifTest = { state: state, render: render };
})();
