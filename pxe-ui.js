// The "Network boot (PXE)" window: boot another computer from this one over the network.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.pxeApi;
  const dlg = $('pxeDialog'), open = $('pxeMenuBtn');
  if (!api || !dlg || !open) return;
  let timer = null, st = null, macs = [], busy = false, loaded = false;

  function say(t, good) { const m = $('pxeMsg'); m.textContent = t || ''; m.classList.toggle('ok', !!good); }
  function item(main, sub, cls) {
    const d = document.createElement('div'); d.className = 'pxe-item' + (cls ? ' ' + cls : '');
    const n = document.createElement('span'); n.className = 'pxe-name'; n.textContent = main; d.appendChild(n);
    if (sub) { const s = document.createElement('span'); s.className = 'pxe-sub'; s.textContent = sub; d.appendChild(s); }
    return d;
  }
  function renderMacs() {
    const box = $('pxeMacList'); box.textContent = '';
    if (!macs.length) { const e = document.createElement('p'); e.className = 'hint'; e.textContent = 'No computer listed yet.'; box.appendChild(e); }
    macs.forEach((m) => {
      const d = item(m, '');
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Remove'; b.disabled = !!(st && st.running);
      b.addEventListener('click', async () => { macs = macs.filter((x) => x !== m); await save(); renderMacs(); });
      d.appendChild(b); box.appendChild(d);
    });
  }
  async function save() { const r = await api.allow(macs, $('pxeAny').checked); if (r && r.bad && r.bad.length) say('Not a MAC address: ' + r.bad.join(', ') + '. A MAC looks like aa:bb:cc:11:22:33.'); return r; }
  function fillPick() {
    const sel = $('pxeMacPick'); const keep = sel.value; sel.textContent = '';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'or pick from your map...'; sel.appendChild(o0);
    try {
      const data = window.hubNetmap && window.hubNetmap.exportData && window.hubNetmap.exportData();
      Object.values((data && data.devices) || {}).forEach((d) => {
        if (!d || !d.mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(d.mac)) return;
        const o = document.createElement('option'); o.value = d.mac; o.textContent = (d.label || d.hostname || d.ip || 'machine') + ' (' + d.mac + ')'; sel.appendChild(o);
      });
    } catch (e) { /* the map is optional */ }
    sel.value = keep;
  }
  function render(s) {
    st = s;
    const run = !!s.running;
    $('pxeStart').classList.toggle('hidden', run); $('pxeStop').classList.toggle('hidden', !run);
    $('pxeState').textContent = run ? 'Running on ' + s.ip + '. Now boot the other computer from its network (often F12 at power-on).' : 'Not running.';
    $('pxeState').classList.toggle('ok', run);
    ['pxeMacInput', 'pxeMacAdd', 'pxeMacPick', 'pxeAny', 'pxeIp'].forEach((id) => { $(id).disabled = run; });
    if (!loaded) {
      macs = (s.allow && s.allow.macs || []).slice(); $('pxeAny').checked = !!(s.allow && s.allow.any);
      const sel = $('pxeIp'); sel.textContent = '';
      (s.addresses || []).forEach((a) => { const o = document.createElement('option'); o.value = a.address; o.textContent = a.name + ' - ' + a.address; sel.appendChild(o); });
      if (!(s.addresses || []).length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'No network connection found'; sel.appendChild(o); }
      loaded = true;
    }
    if (run && s.ip) $('pxeIp').value = s.ip;
    renderMacs();
    const box = $('pxeIsoList'); box.textContent = '';
    if (!(s.isos || []).length) { const e = document.createElement('p'); e.className = 'hint'; e.textContent = 'No ISO added. You can still use netboot.xyz from the menu.'; box.appendChild(e); }
    (s.isos || []).forEach((x) => {
      const mode = x.mode === 'casper' ? 'Ubuntu-style live disc' : x.mode === 'debianlive' ? 'Debian-style live disc' : 'generic ISO';
      const d = item(x.name, x.ok ? mode + ', ' + Math.round(x.size / 1048576) + ' MB' : 'file not found - put it back or remove it', x.ok ? '' : 'missing');
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Remove';
      b.addEventListener('click', async () => { await api.removeIso(x.id); refresh(); });
      d.appendChild(b); box.appendChild(d);
    });
    const log = $('pxeLog'); const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.textContent = (s.log || []).map((l) => l.t + '  ' + l.msg).join('\n') || 'Nothing yet.';
    if (atEnd) log.scrollTop = log.scrollHeight;
  }
  async function refresh() { try { const s = await api.status(); if (s && s.ok) render(s); } catch (e) { /* closed */ } }

  // the menu entry tells you when it is running, even with the window closed
  const label = open.textContent;
  async function mark() { try { const s = await api.status(); open.textContent = s && s.running ? 'Network boot (PXE) - running...' : label; } catch (e) { /* ignore */ } }
  setInterval(() => { if (!dlg.open && !document.hidden) mark(); }, 5000);

  open.addEventListener('click', async () => { say(''); loaded = false; fillPick(); await refresh(); if (!dlg.open) dlg.showModal(); clearInterval(timer); timer = setInterval(refresh, 1500); });
  dlg.addEventListener('close', () => { clearInterval(timer); timer = null; mark(); });
  $('pxeClose').addEventListener('click', () => dlg.close());
  $('pxeMacAdd').addEventListener('click', async () => {
    const v = $('pxeMacInput').value.trim(); if (!v) return;
    const next = macs.concat([v]); const prev = macs; macs = next;
    const r = await save(); const s = await api.status();
    macs = (s.allow && s.allow.macs || []).slice();
    if (macs.length === prev.length) say('That is not a MAC address. It looks like aa:bb:cc:11:22:33.'); else { say(''); $('pxeMacInput').value = ''; }
    renderMacs();
  });
  $('pxeMacInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('pxeMacAdd').click(); } });
  $('pxeMacPick').addEventListener('change', () => { const v = $('pxeMacPick').value; if (v) { $('pxeMacInput').value = v; $('pxeMacAdd').click(); $('pxeMacPick').value = ''; } });
  $('pxeAny').addEventListener('change', async () => { await save(); say($('pxeAny').checked ? 'Any computer on your network that asks to network boot will be answered.' : ''); });
  $('pxeIsoAdd').addEventListener('click', async () => {
    say(''); const r = await api.addIso();
    if (r && !r.ok && !r.canceled) say(r.error || 'That file could not be added.');
    refresh();
  });
  $('pxeStart').addEventListener('click', async () => {
    if (busy) return; busy = true; say('Starting...');
    try {
      await save();
      const r = await api.start($('pxeIp').value);
      say(r && r.ok ? '' : (r && r.error) || 'Network boot could not start.');
    } catch (e) { say('Network boot could not start.'); }
    busy = false; refresh();
  });
  $('pxeStop').addEventListener('click', async () => { await api.stop(); say(''); refresh(); });
})();
