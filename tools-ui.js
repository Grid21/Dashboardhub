// The "Update file tools" window and the "Password manager for panels" window.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.toolsApi;
  const dlg = $('toolsDialog');
  if (!api || !dlg) return;
  const msg = $('toolsMsg'), form = $('toolsPackForm'), reveal = $('toolsReveal');
  function say(t, good) { msg.textContent = t || ''; msg.classList.toggle('ok', !!good); }
  function busy(on) { ['toolsUnpack', 'toolsPackPick', 'toolsPackGo'].forEach((id) => { $(id).disabled = on; }); }

  $('toolsMenuBtn').addEventListener('click', () => {
    say(''); reveal.classList.add('hidden'); form.classList.add('hidden');
    if (!dlg.open) dlg.showModal();
  });
  $('toolsClose').addEventListener('click', () => dlg.close());

  $('toolsUnpack').addEventListener('click', async () => {
    busy(true); say('Working...'); reveal.classList.add('hidden');
    try {
      const r = await api.unpack();
      if (r.canceled) say('');
      else if (!r.ok) say(r.error || 'That did not work.');
      else {
        let t = 'Unpacked ' + r.count + ' files from version ' + r.version + ' into: ' + r.folder + '.';
        if (r.skipped && r.skipped.length) t += ' Skipped ' + r.skipped.length + ' that were not safe or were damaged: ' + r.skipped.map((x) => x.name + ' (' + x.why + ')').join(', ') + '.';
        say(t, true); reveal.classList.remove('hidden');
      }
    } catch (e) { say('That did not work.'); }
    busy(false);
  });

  $('toolsPackPick').addEventListener('click', async () => {
    busy(true); say('Working...'); reveal.classList.add('hidden');
    try {
      const r = await api.packPick();
      if (r.canceled) { say(''); }
      else if (!r.ok) { form.classList.add('hidden'); say(r.error || 'That did not work.'); }
      else {
        $('toolsPackInfo').textContent = 'Folder "' + r.folder + '": ' + r.fileCount + ' files will be packed.';
        $('toolsVersion').value = r.version || ''; $('toolsNotes').value = r.notes || '';
        form.classList.remove('hidden'); say('');
      }
    } catch (e) { say('That did not work.'); }
    busy(false);
  });

  $('toolsPackGo').addEventListener('click', async () => {
    busy(true); say('Working...');
    try {
      const r = await api.pack({ version: $('toolsVersion').value, notes: $('toolsNotes').value });
      if (r.canceled) say('');
      else if (!r.ok) say(r.error || 'That did not work.');
      else { say('Created the update file for version ' + r.version + ' (' + r.fileCount + ' files): ' + r.file, true); reveal.classList.remove('hidden'); }
    } catch (e) { say('That did not work.'); }
    busy(false);
  });

  reveal.addEventListener('click', () => { api.reveal().catch(() => {}); });
})();

// The "Password manager for panels" window: load one password manager extension into the panels (optional).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.pmApi;
  const dlg = $('pmDialog'), open = $('pmMenuBtn');
  if (!api || !dlg || !open) return;
  let st = null;
  function say(t, good) { const m = $('pmMsg'); m.textContent = t || ''; m.classList.toggle('ok', !!good); }
  async function refresh() {
    try { st = await api.status(); } catch (e) { return; }
    if (!st || !st.ok) return;
    const sel = $('pmKey');
    if (!sel.options.length) (st.choices || []).forEach((c) => { const o = document.createElement('option'); o.value = c.key; o.textContent = c.name; sel.appendChild(o); });
    if (st.key && document.activeElement !== sel) sel.value = st.key;
    const c = (st.choices || []).find((x) => x.key === sel.value);
    $('pmCost').textContent = c ? c.cost : '';
    $('pmState').textContent = st.installed ? (st.name + (st.version ? ' ' + st.version : '') + ' is installed' + (st.enabled ? (st.loaded ? ' and in use in the panels.' : ', but it did not start.') : ' but switched off.')) + (st.error ? ' ' + st.error : '') : 'Nothing installed.';
    $('pmOn').disabled = !st.installed; $('pmOn').checked = !!st.enabled;
    $('pmPopup').disabled = !(st.loaded && st.hasPopup); $('pmRemove').disabled = !st.installed;
  }
  async function pick(kind) {
    say('Installing...');
    const r = await api.pick($('pmKey').value, kind);
    if (r && r.canceled) { say(''); return; }
    say(r && r.ok ? (r.name || 'The extension') + ' is installed. Reload your panels (the ↻ button on a panel), open its pop-up window and log in to your account.' : ((r && r.error) || 'That could not be installed.'), !!(r && r.ok));
    refresh();
  }
  open.addEventListener('click', async () => { say(''); await refresh(); if (!dlg.open) dlg.showModal(); });
  $('pmClose').addEventListener('click', () => dlg.close());
  $('pmKey').addEventListener('change', refresh);
  $('pmFile').addEventListener('click', () => pick('file'));
  $('pmFolder').addEventListener('click', () => pick('folder'));
  $('pmOn').addEventListener('change', async () => { const r = await api.enable($('pmOn').checked); say(r && r.ok ? ($('pmOn').checked ? 'Switched on. Reload your panels.' : 'Switched off.') : ((r && r.error) || 'Could not change that.'), !!(r && r.ok)); refresh(); });
  $('pmPopup').addEventListener('click', async () => { const r = await api.popup(); if (!r || !r.ok) say((r && r.error) || 'Could not open it.'); });
  $('pmRemove').addEventListener('click', async () => { const r = await api.remove(); say(r && r.ok ? 'Removed.' : 'Could not remove it.', !!(r && r.ok)); refresh(); });
})();

// The "Phone and browser access" window: a small read-only web page for phones and other computers (off until turned on).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.webApi;
  const dlg = $('webDialog'), open = $('webMenuBtn');
  if (!api || !dlg || !open) return;
  function say(t, good) { const m = $('webMsg'); m.textContent = t || ''; m.classList.toggle('ok', !!good); }
  async function refresh() {
    let st; try { st = await api.status(); } catch (e) { return; }
    if (!st || !st.ok) return;
    $('webOn').disabled = !st.hasCode; $('webOn').checked = !!st.on;
    if (document.activeElement !== $('webPort')) $('webPort').value = st.port;
    $('webState').textContent = st.on ? 'On. ' + (st.signedIn ? st.signedIn + ' browser(s) signed in.' : 'Nobody is signed in.') : (st.hasCode ? 'Off.' : 'Off. Set an access code first.');
    const box = $('webUrls'); box.textContent = '';
    if (st.on) {
      box.appendChild(document.createTextNode('Open one of these in the browser on your phone or other computer:'));
      (st.urls || []).forEach((u) => { const d = document.createElement('div'); d.textContent = u.url + '   (' + u.name + ')'; d.style.userSelect = 'text'; box.appendChild(d); });
      if (!(st.urls || []).length) box.appendChild(document.createTextNode(' (no network address found)'));
    }
    if (st.error) say(st.error);
  }
  open.addEventListener('click', async () => { say(''); await refresh(); if (!dlg.open) dlg.showModal(); });
  $('webClose').addEventListener('click', () => dlg.close());
  $('webSetCode').addEventListener('click', async () => {
    const r = await api.setCode($('webCode').value);
    if (r && r.ok) { $('webCode').value = ''; say('Access code saved. Anyone signed in before has been signed out.', true); } else say((r && r.error) || 'Could not save the code.');
    refresh();
  });
  $('webOn').addEventListener('change', async () => {
    const want = $('webOn').checked;
    const r = await api.setOn(want);
    if (want && r && !r.on) say(r.error || 'It could not start.'); else say(want ? 'Turned on.' : 'Turned off.', true);
    refresh();
  });
  $('webSetPort').addEventListener('click', async () => {
    const r = await api.setPort($('webPort').value);
    say(r && r.ok ? (r.error || 'Port saved.') : ((r && r.error) || 'Could not save the port.'), !!(r && r.ok && !r.error));
    refresh();
  });
  $('webSignOut').addEventListener('click', async () => { await api.signOut(); say('Everyone has been signed out.', true); refresh(); });
})();

// The "Remote servers" window: Dashboard Hub Docker servers that this program checks on and manages.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.hubsApi, dlg = $('hubsDialog'), openBtn = $('hubsMenuBtn');
  if (!api || !dlg || !openBtn) return;
  let editing = null, list = [];
  const say = (t, good) => { const m = $('hubsMsg'); m.textContent = t || ''; m.classList.toggle('ok', !!good); };
  const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
  function resetForm() { editing = null; $('hubName').value = ''; $('hubUrl').value = ''; $('hubCode').value = ''; $('hubCode').placeholder = 'Access code of that server'; $('hubsAddTitle').textContent = 'Add a server'; $('hubCancel').hidden = true; }
  function line(box, text, cls) { const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; box.appendChild(d); return d; }
  function infoText(i) {
    const parts = [];
    parts.push(i.devices + ' devices: ' + i.online + ' online, ' + i.offline + ' offline');
    parts.push(i.running ? 'scanning now' + (i.progress && i.progress.total ? ' (' + Math.round(100 * i.progress.done / i.progress.total) + '%)' : '') : (i.lastScanAt ? 'last scan ' + ago(i.lastScanAt) : 'no scan finished yet'));
    if (i.network) parts.push('network ' + i.network);
    parts.push('version ' + i.version + ', running ' + (i.uptimeSeconds >= 86400 ? Math.round(i.uptimeSeconds / 86400) + ' days' : i.uptimeSeconds >= 3600 ? Math.round(i.uptimeSeconds / 3600) + ' h' : Math.max(1, Math.round(i.uptimeSeconds / 60)) + ' min'));
    return parts.join(' · ');
  }
  async function check(h, box) {
    box.textContent = 'Checking...'; box.className = 'hint';
    let r; try { r = await api.status(h.id); } catch (e) { r = { ok: false, error: 'Could not check.' }; }
    box.className = 'hint ' + (r && r.ok ? 'ok' : 'bad');
    box.textContent = r && r.ok ? (r.info.error ? 'Reachable, but: ' + r.info.error + ' · ' : 'Online · ') + infoText(r.info) : (r && r.error) || 'Could not check.';
  }
  function draw() {
    const box = $('hubsList'); box.textContent = '';
    if (!list.length) { line(box, 'No servers yet.', 'hint'); return; }
    list.forEach((h) => {
      const card = document.createElement('div'); card.className = 'hub-card';
      const head = document.createElement('div'); head.className = 'hub-head';
      const nm = document.createElement('b'); nm.textContent = h.name; head.appendChild(nm);
      const ad = document.createElement('span'); ad.className = 'hint'; ad.textContent = '  ' + h.url; head.appendChild(ad);
      card.appendChild(head);
      const st = line(card, '', 'hint');
      const row = document.createElement('div'); row.className = 'hub-row';
      const mk = (label, fn, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (title) b.title = title; b.addEventListener('click', fn); row.appendChild(b); return b; };
      mk('Check', () => check(h, st));
      mk('Scan now', async () => { st.textContent = 'Asking for a scan...'; const r = await api.scan(h.id); st.className = 'hint ' + (r && r.ok ? 'ok' : 'bad'); st.textContent = r && r.ok ? (r.started ? 'Scan started. Press Check in a minute to see the result.' : (r.message || 'A scan is already running.')) : (r && r.error) || 'Could not start a scan.'; }, 'Ask the server to scan its network right now');
      mk('Open', async () => { const r = await api.open(h.id); if (!r || !r.ok) { st.className = 'hint bad'; st.textContent = (r && r.error) || 'Could not open it.'; } }, 'Open the server\'s map, devices and uptime in a window');
      mk('Settings', () => openCfg(h), 'Change this server\'s name, network, router, scan time and panels');
      mk('Edit', () => { editing = h.id; $('hubName').value = h.name; $('hubUrl').value = h.url; $('hubCode').value = ''; $('hubCode').placeholder = 'New access code (leave empty to keep it)'; $('hubsAddTitle').textContent = 'Change this server'; $('hubCancel').hidden = false; $('hubsAdd').open = true; });
      mk('Remove', async () => { if (!confirm('Remove "' + h.name + '" from this list? The server itself is not touched.')) return; const r = await api.remove(h.id); list = r.list || []; draw(); });
      card.appendChild(row); box.appendChild(card);
      check(h, st);
    });
  }
  // ----- the settings of one server -----
  const cfgDlg = $('hubCfgDialog');
  let cfgHub = null, cfgInfo = null;
  const cmsg = (t, good) => { const m = $('hcMsg'); m.textContent = t || ''; m.className = 'hint ' + (t ? (good ? 'ok' : 'bad') : ''); };
  function panelRow(p) {
    const row = document.createElement('div'); row.className = 'pxe-row hc-panel';
    const n = document.createElement('input'); n.type = 'text'; n.placeholder = 'Name'; n.maxLength = 80; n.value = p ? p.name : ''; n.className = 'hc-pn';
    const u = document.createElement('input'); u.type = 'text'; u.placeholder = 'http://192.168.0.10:9000'; u.maxLength = 2000; u.value = p ? p.url : ''; u.className = 'hc-pu';
    const up = document.createElement('button'); up.type = 'button'; up.textContent = '\u2191'; up.title = 'Move up'; up.addEventListener('click', () => { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); });
    const dn = document.createElement('button'); dn.type = 'button'; dn.textContent = '\u2193'; dn.title = 'Move down'; dn.addEventListener('click', () => { if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); });
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove'; rm.addEventListener('click', () => row.remove());
    [n, u, up, dn, rm].forEach((x) => row.appendChild(x)); $('hcPanels').appendChild(row);
  }
  function fillCfg(info) {
    const c = info.config, net = $('hcNet'), rt = $('hcRouter');
    $('hcName').value = c.name;
    net.textContent = '';
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; net.appendChild(o); };
    add('auto', 'Automatic' + (info.detected.network ? ' (now ' + info.detected.network + ')' : ''));
    (info.interfaces || []).forEach((i) => add(i.cidr, i.cidr + '  (' + i.name + ', this server is ' + i.address + ')'));
    add('custom', 'I will type it');
    const known = Array.from(net.options).some((o) => o.value === c.network);
    net.value = known ? c.network : 'custom';
    $('hcNetCustom').hidden = net.value !== 'custom'; $('hcNetCustom').value = known ? '' : c.network;
    $('hcNetHint').textContent = 'Only home and office addresses can be scanned (192.168.x.x, 10.x.x.x, 172.16-31.x.x).';
    rt.value = c.router === 'auto' ? 'auto' : 'custom'; $('hcRouterCustom').hidden = rt.value !== 'custom'; $('hcRouterCustom').value = c.router === 'auto' ? '' : c.router;
    $('hcRouterHint').textContent = info.detected.router ? 'Found by the server: ' + info.detected.router + '. If that is not your router, choose "I will type it".' : 'The server has not found a router yet.';
    $('hcScan').value = String(c.scanSeconds);
    if (!Array.from($('hcScan').options).some((o) => o.value === String(c.scanSeconds))) { const o = document.createElement('option'); o.value = String(c.scanSeconds); o.textContent = Math.round(c.scanSeconds / 60) + ' minutes'; $('hcScan').appendChild(o); $('hcScan').value = String(c.scanSeconds); }
    $('hcPanels').textContent = ''; (c.panels || []).forEach((p) => panelRow(p));
  }
  async function openCfg(h) {
    cfgHub = h; cmsg('Loading...'); $('hubCfgTitle').textContent = 'Settings of ' + h.name;
    const r = await api.getConfig(h.id);
    if (!r || !r.ok) { cmsg((r && r.error) || 'Could not read the settings.'); const st = document.querySelector('#hubsList .hint'); if (st) st.textContent = (r && r.error) || ''; return; }
    cfgInfo = r.config; fillCfg(r.config); cmsg(''); if (!cfgDlg.open) cfgDlg.showModal();
  }
  $('hcNet').addEventListener('change', () => { $('hcNetCustom').hidden = $('hcNet').value !== 'custom'; });
  $('hcRouter').addEventListener('change', () => { $('hcRouterCustom').hidden = $('hcRouter').value !== 'custom'; });
  $('hcAddPanel').addEventListener('click', () => panelRow(null));
  $('hcClose').addEventListener('click', () => cfgDlg.close());
  $('hcSave').addEventListener('click', async () => {
    if (!cfgHub) return;
    const panels = Array.from(document.querySelectorAll('#hcPanels .hc-panel')).map((r) => ({ name: r.querySelector('.hc-pn').value.trim(), url: r.querySelector('.hc-pu').value.trim() })).filter((p) => p.name || p.url);
    const net = $('hcNet').value === 'custom' ? $('hcNetCustom').value.trim() : $('hcNet').value;
    const router = $('hcRouter').value === 'custom' ? $('hcRouterCustom').value.trim() : 'auto';
    cmsg('Saving...');
    const r = await api.setConfig(cfgHub.id, { name: $('hcName').value, network: net, router: router, scanSeconds: Number($('hcScan').value), panels: panels });
    if (r && r.ok) { cmsg(r.rescanning ? 'Saved. The server is scanning the network again.' : 'Saved.', true); } else cmsg((r && r.error) || 'Could not save.');
  });
  async function load() { const r = await api.list(); list = (r && r.list) || []; if (r && r.encrypted === false) say('This computer cannot encrypt saved codes, so they are kept only until Dashboard Hub closes.'); draw(); }
  openBtn.addEventListener('click', async () => { say(''); resetForm(); await load(); if (!dlg.open) dlg.showModal(); });
  $('hubsClose').addEventListener('click', () => dlg.close());
  $('hubCancel').addEventListener('click', resetForm);
  $('hubSave').addEventListener('click', async () => {
    const r = await api.save({ id: editing, name: $('hubName').value, url: $('hubUrl').value, code: $('hubCode').value });
    if (!r || !r.ok) { say((r && r.error) || 'Could not save.'); return; }
    say(r.kept === false ? 'Saved until Dashboard Hub closes (this computer cannot encrypt codes).' : 'Saved.', true);
    resetForm(); list = r.list || []; draw();
  });
})();
