'use strict';
// Server management window (iLO / iDRAC / BMC) and the status section in a machine's pane.
(function () {
  if (!window.bmcApi) return;
  const $ = (id) => document.getElementById(id);
  const dlg = $('bmcDialog');
  if (!dlg) return;
  let list = [];
  let editing = null;
  const cache = new Map();          // id -> { t, res } (the last answer, so the pane does not ask the BMC every redraw)

  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const say = (t, ok) => { const m = $('bmcMsg'); m.textContent = t || ''; m.className = 'notes-msg' + (ok ? ' ok' : ''); };

  async function load() {
    try { const r = await window.bmcApi.list(); list = r && r.ok ? r.list : []; } catch (e) { list = []; }
  }
  function healthClass(h) { return /^ok$/i.test(h) ? 'bmc-ok' : /warning/i.test(h) ? 'bmc-warn' : h ? 'bmc-bad' : ''; }
  function summary(res) {
    if (!res.ok) return [el('div', 'bmc-line bmc-bad', res.error || 'No answer.')];
    const lines = [];
    const l1 = el('div', 'bmc-line');
    const pw = el('b', /^on$/i.test(res.power) ? 'bmc-ok' : '', 'Power: ' + res.power);
    l1.appendChild(pw);
    if (res.health) { l1.appendChild(document.createTextNode('  ·  Health: ')); l1.appendChild(el('span', healthClass(res.health), res.health)); }
    if (res.watts !== null && res.watts !== undefined) l1.appendChild(document.createTextNode('  ·  ' + Math.round(res.watts) + ' W'));
    lines.push(l1);
    const model = [res.manufacturer, res.model].filter(Boolean).join(' ');
    const hw = [model, res.cpus, res.memoryGiB ? res.memoryGiB + ' GiB memory' : ''].filter(Boolean).join(' · ');
    if (hw) lines.push(el('div', 'bmc-line', hw));
    const ids = [res.serial ? 'Serial ' + res.serial : '', res.bios ? 'BIOS ' + res.bios : '', res.bmc && (res.bmc.model || res.bmc.firmware) ? 'BMC ' + [res.bmc.model, res.bmc.firmware].filter(Boolean).join(' ') : ''].filter(Boolean).join(' · ');
    if (ids) lines.push(el('div', 'bmc-line', ids));
    if (res.temps && res.temps.length) lines.push(el('div', 'bmc-line', 'Temperatures: ' + res.temps.slice(0, 6).map((t) => t.name + ' ' + t.c + ' °C').join(' · ')));
    if (res.fans && res.fans.length) lines.push(el('div', 'bmc-line', 'Fans: ' + res.fans.slice(0, 6).map((f) => f.name + ' ' + f.reading + (f.units === 'Percent' ? '%' : f.units === 'RPM' ? ' rpm' : '')).join(' · ')));
    return lines;
  }
  async function act(entry, action, after) {
    const words = { on: 'switch on', shutdown: 'shut down (gracefully)', restart: 'restart (gracefully)' };
    if (action !== 'on' && !confirm('Really ' + words[action] + ' "' + entry.name + '"?\n\nRunning programs on it may be interrupted.')) return;
    say('Sending to ' + entry.name + '...');
    let r;
    try { r = await window.bmcApi.power(entry.id, action); } catch (e) { r = { ok: false, error: 'The request could not be sent.' }; }
    say(r.ok ? entry.name + ': "' + words[action] + '" sent. It can take a minute to show.' : entry.name + ': ' + r.error, r.ok);
    cache.delete(entry.id);
    if (after) after();
  }
  function buttons(entry, res, refresh) {
    const row = el('div', 'btnrow');
    const b = (label, fn) => { const x = el('button', '', label); x.type = 'button'; x.addEventListener('click', fn); row.appendChild(x); return x; };
    b('Refresh', refresh);
    if (res && res.ok) {
      if (res.canOn && !/^on$/i.test(res.power)) b('Power on', () => act(entry, 'on', refresh)).classList.add('primary');
      if (res.canShutdown) b('Shut down', () => act(entry, 'shutdown', refresh));
      if (res.canRestart) b('Restart', () => act(entry, 'restart', refresh));
    }
    return row;
  }
  async function fetchStatus(entry) {
    let r;
    try { r = await window.bmcApi.status(entry.id); } catch (e) { r = { ok: false, error: 'No answer.' }; }
    cache.set(entry.id, { t: Date.now(), res: r });
    return r;
  }

  function renderList() {
    const box = $('bmcList');
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'hint', 'No servers added yet.')); return; }
    list.forEach((entry) => {
      const card = el('div', 'bmc-card');
      card.appendChild(el('h5', '', entry.name + '  (' + entry.host + ')'));
      const body = el('div');
      card.appendChild(body);
      const draw = (res) => {
        body.textContent = '';
        if (!res) { body.appendChild(el('div', 'bmc-line', 'Checking...')); }
        else summary(res).forEach((x) => body.appendChild(x));
        const tools = buttons(entry, res, async () => { body.textContent = 'Checking...'; draw(await fetchStatus(entry)); });
        const e = el('button', '', 'Edit'); e.type = 'button'; e.addEventListener('click', () => startEdit(entry)); tools.appendChild(e);
        const rm = el('button', '', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', async () => { if (!confirm('Remove "' + entry.name + '" from Dashboard Hub? (The server itself is not touched.)')) return; const r = await window.bmcApi.remove(entry.id); list = r && r.ok ? r.list : list; renderList(); });
        tools.appendChild(rm);
        body.appendChild(tools);
      };
      const c = cache.get(entry.id);
      draw(c ? c.res : null);
      if (!c || Date.now() - c.t > 30000) fetchStatus(entry).then(draw);
      box.appendChild(card);
    });
  }

  function fillMacSelect(selected) {
    const sel = $('bmcMac');
    sel.textContent = '';
    const none = el('option', '', '(none)'); none.value = ''; sel.appendChild(none);
    let devs = {};
    try { devs = window.hubNetmap.exportData().devices || {}; } catch (e) { devs = {}; }
    Object.keys(devs).forEach((k) => {
      const d = devs[k];
      if (!d || d.isRouter || !d.mac) return;
      const o = el('option', '', (d.label || d.hostname || d.ip || d.mac) + '  (' + (d.ip || d.mac) + ')'); o.value = d.mac.toLowerCase(); sel.appendChild(o);
    });
    sel.value = selected || '';
    if (selected && sel.value !== selected) { const o = el('option', '', selected); o.value = selected; sel.appendChild(o); sel.value = selected; }
  }
  function startEdit(entry) {
    editing = entry ? entry.id : null;
    $('bmcFormTitle').textContent = entry ? 'Edit "' + entry.name + '"' : 'Add a server';
    $('bmcName').value = entry ? entry.name : '';
    $('bmcHost').value = entry ? entry.host : '';
    $('bmcPort').value = entry ? String(entry.port) : '443';
    $('bmcHttps').checked = entry ? entry.https !== false : true;
    $('bmcUser').value = entry ? entry.username : '';
    $('bmcPass').value = '';
    $('bmcPass').placeholder = entry && entry.hasPassword ? '(leave empty to keep the saved password)' : '';
    fillMacSelect(entry ? entry.mac : '');
    $('bmcCancelEdit').classList.toggle('hidden', !entry);
    say('');
  }

  $('bmcMenuBtn').addEventListener('click', async () => {
    await load();
    startEdit(null);
    renderList();
    dlg.showModal();
  });
  $('bmcClose').addEventListener('click', () => dlg.close());
  $('bmcCancelEdit').addEventListener('click', () => startEdit(null));
  $('bmcSave').addEventListener('click', async () => {
    say('Testing the login...');
    $('bmcSave').disabled = true;
    let r;
    try {
      r = await window.bmcApi.save({ id: editing, name: $('bmcName').value, host: $('bmcHost').value.trim(), port: $('bmcPort').value.trim(), https: $('bmcHttps').checked,
        username: $('bmcUser').value, password: $('bmcPass').value, mac: $('bmcMac').value });
    } catch (e) { r = { ok: false, error: 'The server could not be saved.' }; }
    $('bmcSave').disabled = false;
    if (!r || !r.ok) { say((r && r.error) || 'The server could not be saved.'); return; }
    list = r.list;
    cache.set(r.id, { t: Date.now(), res: r.status });
    say('Saved. The login works.', true);
    startEdit(null);
    say('Saved. The login works.', true);
    renderList();
    if (window.hubNetmap && window.hubNetmap.refresh) window.hubNetmap.refresh();
  });

  // the status section inside a machine's pane (when a saved server is linked to that machine's hardware address)
  window.hubBmcReload = async () => { cache.clear(); editing = null; await load(); try { if (window.hubNetmap && window.hubNetmap.refresh) window.hubNetmap.refresh(); } catch (e) { /* ignore */ } try { if (typeof renderList === 'function' && $('bmcDialog') && $('bmcDialog').open) renderList(); } catch (e) { /* ignore */ } };
  window.hubBmcFor = (mac) => (mac ? list.filter((b) => b.mac && b.mac.toLowerCase() === String(mac).toLowerCase()) : []);
  window.hubBmcPane = function (d, side) {
    const mine = list.filter((b) => b.mac && d.mac && b.mac.toLowerCase() === String(d.mac).toLowerCase());
    mine.forEach((entry) => {
      const sec = el('div', 'bmc-pane');
      sec.appendChild(el('h4', '', 'Server management (' + entry.name + ')'));
      const body = el('div');
      sec.appendChild(body);
      const draw = (res) => {
        body.textContent = '';
        if (!res) body.appendChild(el('div', 'bmc-line', 'Checking...'));
        else summary(res).forEach((x) => body.appendChild(x));
        body.appendChild(buttons(entry, res, async () => { body.textContent = 'Checking...'; draw(await fetchStatus(entry)); }));
      };
      const c = cache.get(entry.id);
      draw(c ? c.res : null);
      if (!c || Date.now() - c.t > 30000) fetchStatus(entry).then((r) => { if (sec.isConnected) draw(r); });
      side.appendChild(sec);
    });
  };
  load();
})();
