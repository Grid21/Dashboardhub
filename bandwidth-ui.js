'use strict';
// Bandwidth Monitor: a show/hide window on the Network Map with upload and download dials and a bar for every place we can read traffic from.
(function () {
  const btn = document.getElementById('mapBwBtn');
  const panel = document.getElementById('bwPanel');
  if (!btn || !panel || !window.netApi || !window.netApi.bandwidth) return;

  const SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500, 5000, 10000, 25000];
  const KEEP = { open: false, scale: 'auto', pin: '' };
  try { Object.assign(KEEP, JSON.parse(localStorage.getItem('hubBw') || '{}')); } catch (e) { /* no saved choice */ }
  const keep = () => { try { localStorage.setItem('hubBw', JSON.stringify(KEEP)); } catch (e) { /* private window */ } };

  const INTERNET_PORT = /(^|[^a-z])(wan|internet|ppp|pppoe|dsl|uplink)([^a-z]|$)/i;     // how routers usually name the port that faces the modem
  let mainIp = '';
  const prev = new Map();           // source key -> { rx, tx, t, bits }
  const rates = new Map();          // source key -> { name, group, up, down, speed, note, t }
  let timer = null, open = false, busy = false, lastSample = null, autoMax = 1, dialUp = 0, dialDown = 0, errors = [];

  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const svgNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const e = document.createElementNS(svgNS, tag); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); return e; };
  function fmt(m) {
    if (!Number.isFinite(m) || m < 0) return '0';
    if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' Gbps';
    if (m >= 100) return Math.round(m) + ' Mbps';
    if (m >= 1) return Number(m.toFixed(1)) + ' Mbps';
    if (m >= 0.001) return Math.round(m * 1000) + ' kbps';
    return '0 Mbps';
  }
  const stepFor = (v) => SCALES.find((s) => s >= v) || SCALES[SCALES.length - 1];

  // ---------- turning running totals into speeds ----------
  function feed(key, meta, rx, tx, t, bits) {
    const p = prev.get(key);
    prev.set(key, { rx: rx, tx: tx, t: t, bits: bits || 64 });
    if (!p || t <= p.t) return;
    const wrap = Math.pow(2, p.bits);
    const d = (a, b) => (a >= b ? a - b : (b < wrap && b > wrap * 0.5 ? a + wrap - b : NaN));      // counter that went round, or one that was reset
    const dr = d(rx, p.rx), dt = d(tx, p.tx);
    if (!Number.isFinite(dr) || !Number.isFinite(dt)) return;
    const secs = (t - p.t) / 1000;
    const down = dr * 8 / secs / 1e6, up = dt * 8 / secs / 1e6;
    const old = rates.get(key);
    const mix = (n, o) => (o === undefined ? n : o * 0.4 + n * 0.6);
    rates.set(key, Object.assign({}, meta, { down: mix(down, old && old.down), up: mix(up, old && old.up), t: t }));
  }
  function ingest(r) {
    lastSample = r;
    errors = [];
    try { mainIp = window.hubNetmap && window.hubNetmap.routerIp ? window.hubNetmap.routerIp() : ''; } catch (e) { mainIp = ''; }
    if (r.local) {
      feed('local|all', { name: 'This computer', group: 'This computer', note: 'all network cards', kind: 'local' }, r.local.rx, r.local.tx, r.at, 64);
      if (r.local.ports.length > 1) r.local.ports.forEach((p) => feed('local|' + p.name, { name: p.name, group: 'This computer', kind: 'local' }, p.rx, p.tx, r.at, 64));
    }
    (r.gear || []).forEach((g) => {
      if (!g.ok) { errors.push((g.name || g.host) + ': ' + (g.error || 'no answer')); return; }
      const t = r.gearAt || r.at;
      // the main router is the machine that brings the internet in: the one in the middle of the map
      const main = !!mainIp && g.host === mainIp;
      const grp = (main ? 'Main router \u00b7 ' : '') + (g.name || g.host);
      const ord = main ? 0 : 1;
      if (g.wan) {      // routers that report their internet / wired / Wi-Fi totals directly
        feed(g.id + '|wan', { name: 'Internet', group: grp, ord: ord, kind: 'wan', main: main }, g.wan.rx, g.wan.tx, t, g.wan.bits);
        if (g.wired) feed(g.id + '|wired', { name: 'Wired devices', group: grp, ord: ord, kind: 'lan' }, g.wired.rx, g.wired.tx, t, g.wired.bits);
        (g.wireless || []).forEach((w, i) => feed(g.id + '|wifi' + i, { name: 'Wi-Fi' + (g.wireless.length > 1 ? ' band ' + (i + 1) : ''), group: grp, ord: ord, kind: 'lan' }, w.rx, w.tx, t, w.bits));
      } else {          // routers and switches that report each port
        (g.ports || []).forEach((p) => {
          const isNet = main && INTERNET_PORT.test(p.name);
          feed(g.id + '|' + p.name, { name: isNet ? p.name + ' (internet)' : p.name, group: grp, ord: ord, kind: isNet ? 'wan' : 'port', main: main, speed: p.speed }, p.rx, p.tx, t, p.bits);
        });
      }
    });
    // forget sources that have gone
    const now = r.at;
    rates.forEach((v, k) => { if (now - v.t > 60000) { rates.delete(k); prev.delete(k); } });
  }

  // ---------- which reading drives the dials ----------
  function dialSource() {
    if (KEEP.pin && rates.has(KEEP.pin)) return { key: KEEP.pin, why: 'chosen by you' };
    let any = null;
    for (const [k, v] of rates) { if (v.kind === 'wan' && v.main) return { key: k, why: 'the main router’s internet connection' }; if (v.kind === 'wan' && !any) any = k; }
    if (any) return { key: any, why: 'a router’s internet connection' };
    if (rates.has('local|all')) return { key: 'local|all', why: 'this computer only (add your router under Router & switch links for the whole network)' };
    return null;
  }

  // ---------- drawing ----------
  const gauges = {};
  function makeGauge(title) {
    const box = el('div', 'bw-gauge');
    box.appendChild(el('div', 'bw-gtitle', title));
    const s = sv('svg', { viewBox: '0 0 200 124', class: 'bw-svg', role: 'img', 'aria-label': title });
    const cols = ['#22d3ee', '#2dd4bf', '#4ade80', '#a3e635', '#facc15', '#fb923c', '#ef4444'];
    const R = 78, cx = 100, cy = 100, segs = cols.length;
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI * (1 - i / segs), a1 = Math.PI * (1 - (i + 1) / segs);
      const p = (a, r) => (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy - r * Math.sin(a)).toFixed(2);
      s.appendChild(sv('path', { d: 'M ' + p(a0, R) + ' A ' + R + ' ' + R + ' 0 0 1 ' + p(a1, R), stroke: cols[i], 'stroke-width': 9, fill: 'none', opacity: 0.9 }));
    }
    const ticks = sv('g', {}); s.appendChild(ticks);
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1 - i / 10), r0 = R - 8, r1 = R - (i % 5 === 0 ? 15 : 12);
      ticks.appendChild(sv('line', { x1: cx + r0 * Math.cos(a), y1: cy - r0 * Math.sin(a), x2: cx + r1 * Math.cos(a), y2: cy - r1 * Math.sin(a), stroke: '#6b7587', 'stroke-width': i % 5 === 0 ? 1.6 : 1 }));
    }
    const l0 = sv('text', { x: 24, y: 118, class: 'bw-tick' }); l0.textContent = '0'; s.appendChild(l0);
    const l1 = sv('text', { x: 176, y: 118, class: 'bw-tick', 'text-anchor': 'end' }); s.appendChild(l1);
    const needle = sv('g', { class: 'bw-needle' });
    needle.appendChild(sv('polygon', { points: '97,100 100,32 103,100', fill: '#67e8f9' }));
    s.appendChild(needle);
    s.appendChild(sv('circle', { cx: 100, cy: 100, r: 6, fill: '#1b1f27', stroke: '#67e8f9', 'stroke-width': 2 }));
    box.appendChild(s);
    const val = el('div', 'bw-gval', '0'); box.appendChild(val);
    return { box: box, needle: needle, max: l1, val: val };
  }
  function setGauge(g, v, max) {
    const frac = Math.max(0, Math.min(1, v / max));
    g.needle.style.transform = 'rotate(' + (-90 + frac * 180).toFixed(1) + 'deg)';
    g.max.textContent = fmt(max).replace(' Mbps', '');
    g.val.textContent = fmt(v);
  }

  function build() {
    panel.textContent = '';
    const head = el('div', 'bw-head');
    const tt = el('div', 'bw-title'); tt.appendChild(el('h3', null, 'Bandwidth Monitor')); tt.appendChild(el('span', 'bw-live', 'live')); head.appendChild(tt);
    const tools = el('div', 'bw-tools');
    const lab = el('label', null, 'Scale '); const sel = el('select'); sel.id = 'bwScale';
    [['auto', 'Auto']].concat(SCALES.filter((x) => [10, 100, 1000, 10000].includes(x)).map((x) => [String(x), fmt(x)])).forEach((o) => { const op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    sel.value = KEEP.scale; sel.addEventListener('change', () => { KEEP.scale = sel.value; keep(); draw(); });
    lab.appendChild(sel); tools.appendChild(lab);
    const x = el('button', 'bw-x', '×'); x.type = 'button'; x.title = 'Hide'; x.setAttribute('aria-label', 'Hide the Bandwidth Monitor'); x.addEventListener('click', () => setOpen(false)); tools.appendChild(x);
    head.appendChild(tools); panel.appendChild(head);
    const gw = el('div', 'bw-gauges');
    gauges.up = makeGauge('Upload'); gauges.down = makeGauge('Download');
    gw.appendChild(gauges.up.box); gw.appendChild(gauges.down.box); panel.appendChild(gw);
    panel.appendChild(el('div', 'bw-source')).id = 'bwSource';
    const rows = el('div', 'bw-rows'); rows.id = 'bwRows'; panel.appendChild(rows);
    const foot = el('div', 'bw-foot'); foot.id = 'bwFoot'; panel.appendChild(foot);
  }

  function draw() {
    if (!gauges.up) return;
    const src = dialSource();
    const cur = src ? rates.get(src.key) : null;
    let max;
    if (KEEP.scale !== 'auto' && Number(KEEP.scale) > 0) max = Number(KEEP.scale);
    else {
      const need = cur ? Math.max(cur.up, cur.down) * 1.15 : 0;
      const want = stepFor(Math.max(need, 1));
      if (want > autoMax) autoMax = want; else if (want < autoMax && need < autoMax * 0.35) autoMax = want;      // grows at once, shrinks only when well below
      max = autoMax;
    }
    dialUp = cur ? cur.up : 0; dialDown = cur ? cur.down : 0;
    setGauge(gauges.up, dialUp, max); setGauge(gauges.down, dialDown, max);
    const sEl = document.getElementById('bwSource');
    sEl.textContent = cur ? 'Dials show: ' + cur.group + ' → ' + cur.name + ' (' + src.why + ')' : 'Waiting for the first reading...';
    // rows, grouped
    const box = document.getElementById('bwRows'); box.textContent = '';
    const groups = new Map();
    rates.forEach((v, k) => { if (!groups.has(v.group)) groups.set(v.group, []); groups.get(v.group).push([k, v]); });
    const ordOf = (g) => (g === 'This computer' ? 9 : groups.get(g)[0][1].ord === 0 ? 0 : 1);
    const order = Array.from(groups.keys()).sort((a, b) => ordOf(a) - ordOf(b) || a.localeCompare(b));
    order.forEach((gname) => {
      const items = groups.get(gname).sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down));
      const sec = el('div', 'bw-group'); sec.appendChild(el('div', 'bw-gname', gname));
      const showAll = expanded.has(gname);
      const shown = showAll ? items : items.slice(0, 8);
      shown.forEach(([k, v]) => {
        const row = el('div', 'bw-row' + (src && src.key === k ? ' pinned' : '')); row.dataset.key = k;
        const nm = el('div', 'bw-name', v.name + (v.note ? ' · ' + v.note : '')); nm.title = v.name;
        row.appendChild(nm);
        const bars = el('div', 'bw-bars');
        [['up', '▲', v.up], ['down', '▼', v.down]].forEach(([cls, ar, val]) => {
          const line = el('div', 'bw-line');
          const track = el('div', 'bw-track'); const fill = el('div', 'bw-fill ' + cls);
          const cap = v.speed && v.speed > 0 ? Math.max(v.speed, 1) : max;
          const f = Math.max(0, Math.min(1, val / cap));
          fill.style.width = (val > 0 ? Math.max(f * 100, 1.5) : 0).toFixed(1) + '%';
          track.appendChild(fill); line.appendChild(track);
          line.appendChild(el('span', 'bw-num', ar + ' ' + fmt(val)));
          bars.appendChild(line);
        });
        row.appendChild(bars);
        const pin = el('button', 'bw-pin', src && src.key === k ? '◎ on dials' : '○ dials'); pin.type = 'button'; pin.title = 'Show this one on the dials';
        pin.addEventListener('click', () => { KEEP.pin = src && src.key === k && KEEP.pin === k ? '' : k; keep(); draw(); });
        row.appendChild(pin);
        sec.appendChild(row);
      });
      if (items.length > 8) {
        const more = el('button', 'bw-more', showAll ? 'Show fewer' : 'Show all ' + items.length); more.type = 'button';
        more.addEventListener('click', () => { if (expanded.has(gname)) expanded.delete(gname); else expanded.add(gname); draw(); });
        sec.appendChild(more);
      }
      box.appendChild(sec);
    });
    const foot = document.getElementById('bwFoot'); foot.textContent = '';
    if (errors.length) errors.slice(0, 3).forEach((e) => foot.appendChild(el('div', 'bw-err', e)));
    const hasGear = lastSample && (lastSample.gear || []).some((g) => g.ok);
    const mainHere = Array.from(rates.values()).some((v) => v.main);
    const mainFound = Array.from(rates.values()).some((v) => v.main && v.kind === 'wan');
    if (hasGear && mainHere && !mainFound) foot.appendChild(el('div', 'bw-note', 'The main router’s internet port was not recognised by name. Press “dials” on the port that goes to your modem, and the dials will use it from then on.'));
    if (hasGear && !mainHere && !Array.from(rates.values()).some((v) => v.kind === 'wan')) foot.appendChild(el('div', 'bw-note', 'None of your saved routers or switches is the main router in the middle of the map, so the dials cannot show the internet connection. Add the main router under Router & switch links.'));
    if (lastSample && !hasGear && !lastSample.saved) foot.appendChild(el('div', 'bw-note', 'Only this computer is shown. To see the whole network, add your main router under Router & switch links. It needs to be one that shares its traffic numbers (SNMP, or a supported router brand).'));
    foot.appendChild(el('div', 'bw-note', 'Speeds are measured from the devices’ own traffic counters, per router, port or network card. Most routers do not report traffic per device, so none is shown for individual devices.'));
  }
  const expanded = new Set();

  async function tick() {
    if (!open || busy || !panel.offsetParent) return;
    busy = true;
    try {
      const r = await window.netApi.bandwidth();
      if (r && r.ok) ingest(r);
    } catch (e) { /* try again next time */ }
    busy = false;
    draw();
  }
  function setOpen(on) {
    open = !!on; KEEP.open = open; keep();
    panel.classList.toggle('closed', !open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    btn.classList.toggle('on', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    clearInterval(timer); timer = null;
    if (open) {
      if (!gauges.up) build();
      tick(); timer = setInterval(() => { if (!document.hidden || window.hubBackground) tick(); }, 1500);
    } else { prev.clear(); rates.clear(); }
  }
  btn.addEventListener('click', () => setOpen(!open));
  panel.classList.add('closed');
  if (KEEP.open) setTimeout(() => setOpen(true), 300);
  window.hubBandwidth = { reset: () => { prev.clear(); rates.clear(); lastSample = null; errors = []; draw(); }, setOpen: setOpen, isOpen: () => open, dials: () => ({ up: dialUp, down: dialDown }), rates: () => Array.from(rates.entries()), tick: tick, _feed: feed };
})();
