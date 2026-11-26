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
      mk('Devices', () => openDev(h), 'Give machines names and groups, ignore some, or add one by hand');
      mk('Edit', () => { editing = h.id; $('hubName').value = h.name; $('hubUrl').value = h.url; $('hubCode').value = ''; $('hubCode').placeholder = 'New access code (leave empty to keep it)'; $('hubsAddTitle').textContent = 'Change this server'; $('hubCancel').hidden = false; $('hubsAdd').open = true; });
      mk('Remove', async () => { if (!confirm('Remove "' + h.name + '" from this list? The server itself is not touched.')) return; const r = await api.remove(h.id); list = r.list || []; draw(); });
      card.appendChild(row); box.appendChild(card);
      check(h, st);
    });
  }
  // ----- the devices of one server: names, groups, ignore, add by hand, forget -----
  const devDlg = $('hubDevDialog');
  let devHub = null;
  const dmsg = (t, good) => { const m = $('hdMsg'); m.textContent = t || ''; m.className = 'hint ' + (t ? (good ? 'ok' : 'bad') : ''); };
  function devRow(d) {
    const row = document.createElement('div'); row.className = 'pxe-row hd-row' + (d.ignored ? ' hd-ign' : ''); row.dataset.key = d.key;
    const dot = document.createElement('span'); dot.className = 'hd-dot ' + (d.online ? 'on' : 'off'); dot.title = d.online ? 'Online' : 'Offline';
    const n = document.createElement('input'); n.type = 'text'; n.maxLength = 60; n.className = 'hd-n'; n.placeholder = d.shownName; n.value = d.name; n.dataset.was = d.name;
    const g = document.createElement('input'); g.type = 'text'; g.maxLength = 30; g.className = 'hd-g'; g.placeholder = 'Group'; g.setAttribute('list', 'hdGroups'); g.value = d.group; g.dataset.was = d.group;
    const info = document.createElement('span'); info.className = 'hint hd-info'; info.textContent = [d.ip, d.vendor, d.os, d.manual ? 'added by hand' : '', d.self ? 'this server' : ''].filter(Boolean).join('  \u00b7  ');
    const lab = document.createElement('label'); lab.className = 'hd-ig'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'hd-i'; cb.checked = d.ignored; cb.dataset.was = d.ignored ? '1' : ''; cb.disabled = d.isRouter || d.self;
    lab.appendChild(cb); lab.appendChild(document.createTextNode(' Ignore'));
    const parts = [dot, n, g, lab];
    if (!d.isRouter && !d.self && (!d.online || d.manual)) { const f = document.createElement('button'); f.type = 'button'; f.textContent = 'Forget'; f.title = 'Remove it from the server\'s list (it comes back if it shows up again)'; f.addEventListener('click', async () => { if (!confirm('Remove "' + d.shownName + '" from the list?')) return; const r = await api.devices(devHub.id, { op: 'forget', key: d.key }); if (r && r.ok !== false) { row.remove(); dmsg('Removed.', true); } else dmsg((r && r.error) || 'Could not remove it.'); }); parts.push(f); }
    parts.push(info);
    parts.forEach((x) => row.appendChild(x));
    return row;
  }
  async function loadDev() {
    const r = await api.devices(devHub.id, { op: 'list' });
    if (!r || r.ok === false) { dmsg((r && r.error) || 'Could not read the devices.'); return false; }
    $('hdList').textContent = ''; (r.devices || []).forEach((d) => $('hdList').appendChild(devRow(d)));
    const dl = $('hdGroups'); dl.textContent = ''; (r.groups || []).forEach((g) => { const o = document.createElement('option'); o.value = g; dl.appendChild(o); });
    return true;
  }
  async function openDev(h) {
    devHub = h; $('hdTitle').textContent = 'Devices of ' + h.name; dmsg('Loading...');
    $('hsAuto').checked = !!h.auto; $('hsAutoMsg').textContent = h.auto ? (autoMsgs[h.id] || 'On. The first automatic send happens shortly after Dashboard Hub starts or when the map changes.') : '';
    if (await loadDev()) { dmsg(''); if (!devDlg.open) devDlg.showModal(); } else { const st = document.querySelector('#hubsList .hint'); if (st) st.textContent = $('hdMsg').textContent; }
  }
  $('hsSend').addEventListener('click', async () => {
    if (!devHub) return;
    const m = $('hsMsg'); const what = { names: $('hsNames').checked, groups: $('hsGroups').checked, positions: $('hsPos').checked, add: $('hsAdd').checked, panels: $('hsPanels').checked, info: $('hsInfo').checked, links: $('hsLinks').checked, ignored: $('hsIgnored').checked };
    if (!what.names && !what.groups && !what.positions && !what.add && !what.panels && !what.info && !what.links && !what.ignored) { m.className = 'hint bad'; m.textContent = 'Tick at least one thing to send.'; return; }
    if (what.panels && !confirm('This replaces the panels on the server with the panels of this computer. Continue?')) return;
    m.className = 'hint'; m.textContent = 'Sending...';
    let net = null; try { net = window.hubNetmap ? window.hubNetmap.exportData() : null; } catch (e) { net = null; }
    const r = await api.sync(devHub.id, what, net);
    if (!r || r.ok === false) { m.className = 'hint bad'; m.textContent = (r && r.error) || 'Could not send.'; return; }
    const bits = [r.matched + ' machine' + (r.matched === 1 ? '' : 's') + ' matched'];
    if (what.names) bits.push(r.names + ' name' + (r.names === 1 ? '' : 's') + ' set');
    if (what.groups) bits.push(r.groups + ' group' + (r.groups === 1 ? '' : 's') + ' set');
    if (what.positions) bits.push(r.moved + ' moved');
    if (what.info) bits.push((r.info || 0) + ' with details');
    if (what.links && r.links !== null && r.links !== undefined) bits.push(r.links + ' link' + (r.links === 1 ? '' : 's'));
    if (what.ignored && r.hidden) bits.push(r.hidden + ' hidden');
    if (what.add) bits.push(r.added + ' added');
    if (r.panels !== null && r.panels !== undefined) bits.push(r.panels + ' panel' + (r.panels === 1 ? '' : 's'));
    if (r.skipped) bits.push(r.skipped + ' not on the server');
    m.className = 'hint ok'; m.textContent = 'Done: ' + bits.join(', ') + '.'; await loadDev();
  });
  $('hdClose').addEventListener('click', () => devDlg.close());
  $('hdSave').addEventListener('click', async () => {
    if (!devHub) return;
    const changes = [];
    document.querySelectorAll('#hdList .hd-row').forEach((row) => {
      const n = row.querySelector('.hd-n'), g = row.querySelector('.hd-g'), i = row.querySelector('.hd-i'), c = { key: row.dataset.key };
      if (n.value.trim() !== n.dataset.was) c.name = n.value.trim();
      if (g.value.trim() !== g.dataset.was) c.group = g.value.trim();
      if ((i.checked ? '1' : '') !== i.dataset.was) c.ignored = i.checked;
      if (Object.keys(c).length > 1) changes.push(c);
    });
    if (!changes.length) { dmsg('Nothing changed.', true); return; }
    dmsg('Saving...');
    const r = await api.devices(devHub.id, { op: 'save', changes: changes });
    if (r && r.ok !== false) { await loadDev(); dmsg('Saved ' + r.saved + ' change' + (r.saved === 1 ? '' : 's') + '.', true); } else dmsg((r && r.error) || 'Could not save.');
  });
  $('hdAdd').addEventListener('click', async () => {
    if (!devHub) return;
    dmsg('Adding...');
    const r = await api.devices(devHub.id, { op: 'add', ip: $('hdAddIp').value, name: $('hdAddName').value, group: $('hdAddGroup').value });
    if (r && r.ok !== false) { $('hdAddIp').value = ''; $('hdAddName').value = ''; $('hdAddGroup').value = ''; await loadDev(); dmsg(r.online ? 'Added. It answers, so it is online.' : 'Added. It does not answer a ping right now, so it shows as offline.', true); } else dmsg((r && r.error) || 'Could not add it.');
  });
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
    $('hcUpdate').value = c.update || 'auto'; updHint(info.update);
    const al = c.alerts || {}; $('hcAlUrl').value = al.url || ''; $('hcAlFmt').value = al.format || 'ntfy'; $('hcAlNew').checked = al.onNew !== false; $('hcAlLeft').checked = al.onLeft !== false; $('hcAlBack').checked = al.onBack === true; $('hcAlMsg').textContent = '';
  }
  function updHint(u) {
    const h = $('hcUpdHint'), b = $('hcUpdNow');
    if (!u) { h.textContent = 'This server is too old to update itself. Rebuild it once from the newest Docker bundle.'; b.hidden = true; return; }
    b.hidden = false;
    let t = 'Running ' + u.version + '.';
    if (u.error) t += ' Last check: ' + u.error;
    else if (u.available && u.needsRebuild) t += ' Version ' + u.latest + ' is ready but needs a one-time rebuild of the container.';
    else if (u.available) t += ' Version ' + u.latest + ' is ready' + (u.canInstall ? '.' : ', but this container must be rebuilt once before it can install updates by itself.');
    else if (u.latest) t += ' This is the newest version.';
    else t += ' Not checked yet.';
    h.textContent = t; b.textContent = u.available && u.canInstall && !u.needsRebuild ? 'Install ' + u.latest + ' now' : 'Check now';
    b.dataset.install = u.available && u.canInstall && !u.needsRebuild ? '1' : '';
  }
  const alertsNow = () => ({ url: $('hcAlUrl').value.trim(), format: $('hcAlFmt').value, onNew: $('hcAlNew').checked, onLeft: $('hcAlLeft').checked, onBack: $('hcAlBack').checked });
  $('hcAlTest').addEventListener('click', async () => {
    if (!cfgHub) return;
    const m = $('hcAlMsg'); m.className = 'hint'; m.textContent = 'Sending...';
    const r = await api.alertTest(cfgHub.id, alertsNow());
    m.textContent = r && r.ok ? (r.message || 'Sent.') : ((r && r.error) || 'Not sent.'); m.className = 'hint ' + (r && r.ok ? 'ok' : 'bad');
  });
  $('hcUpdNow').addEventListener('click', async () => {
    if (!cfgHub) return;
    const install = !!$('hcUpdNow').dataset.install;
    $('hcUpdHint').textContent = install ? 'Installing...' : 'Checking...';
    const r = await api.update(cfgHub.id, install);
    if (!r || r.ok === false) { $('hcUpdHint').textContent = (r && r.error) || 'Could not check.'; return; }
    if (r.updated) { $('hcUpdHint').textContent = r.message + ' Give it a minute, then press Check on the server list.'; $('hcUpdNow').hidden = true; return; }
    if (r.message && !r.status) { $('hcUpdHint').textContent = r.message; return; }
    updHint(r.status); if (r.message) $('hcUpdHint').textContent += ' ' + r.message;
  });
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
    const r = await api.setConfig(cfgHub.id, { name: $('hcName').value, network: net, router: router, scanSeconds: Number($('hcScan').value), update: $('hcUpdate').value, alerts: alertsNow(), panels: panels });
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
  // ---------- keep a server's map up to date automatically ----------
  // The server keeps what it was sent, so when this computer is away (on the go) the server still shows your layout.
  const AUTO_WHAT = { names: true, groups: true, positions: true, add: false, panels: false, info: true, links: true, ignored: true };
  const autoMsgs = {}; let autoBusy = false, autoTimer = null; const autoSig = {};
  function autoSignature(net) {
    const keys = Object.keys(net.devices).sort();
    return JSON.stringify([keys.map((k) => { const d = net.devices[k]; return [k, d.label || '', d.group || '', d.pos ? [Math.round(d.pos.x * 100), Math.round(d.pos.z * 100)] : null, d.info || null, d.vlan || '']; }),
      (net.links || []).map((l) => [l.a, l.b, l.cable === true, l.wireless === true]).sort(), (net.ignored || []).slice().sort(), net.groupCircles !== false, net.groupCluster !== false]);
  }
  function autoSay(id, text) { autoMsgs[id] = text; if (devHub && devHub.id === id && $('hsAutoMsg')) $('hsAutoMsg').textContent = text; }
  async function autoRun(force) {
    if (autoBusy) return; autoBusy = true;
    try {
      const r = await api.list(); const hubs = ((r && r.list) || []).filter((h) => h.auto);
      if (!hubs.length) return;
      let net = null; try { net = window.hubNetmap ? window.hubNetmap.exportData() : null; } catch (e) { net = null; }
      if (!net || !net.devices || Object.keys(net.devices).length < 2) return;
      const sig = autoSignature(net);
      for (const h of hubs) {
        if (!force && autoSig[h.id] === sig) continue;
        const lst = await api.devices(h.id, { op: 'list' });
        if (!lst || lst.ok === false) { autoSay(h.id, 'The server could not be reached. It will try again in a few minutes.'); continue; }
        // only send when this computer is on the same network as the server (the machines must match), so a trip to another network does not scramble the server's map
        const theirMac = new Set((lst.devices || []).map((d) => String(d.mac || '').toLowerCase()).filter(Boolean)), theirIp = new Set((lst.devices || []).filter((d) => !d.mac && d.ip).map((d) => d.ip));
        const mine = Object.keys(net.devices).map((k) => net.devices[k]).filter((d) => d && !d.isRouter && (d.mac || d.ip));
        const hit = mine.filter((d) => (d.mac && theirMac.has(String(d.mac).toLowerCase())) || (!d.mac && d.ip && theirIp.has(d.ip)) || (d.ip && theirIp.has(d.ip))).length;
        const theirCount = theirMac.size + theirIp.size;
        if (!(hit >= 1 && hit >= Math.min(2, mine.length) && hit * 5 >= Math.min(mine.length, theirCount))) { autoSig[h.id] = sig; autoSay(h.id, 'Not sent: this computer’s map is for a different network than the server’s. The server keeps its last map.'); continue; }
        const x = await api.sync(h.id, AUTO_WHAT, net);
        if (!x || x.ok === false) { autoSay(h.id, 'Could not send: ' + ((x && x.error) || 'unknown problem') + '. It will try again in a few minutes.'); continue; }
        autoSig[h.id] = sig; autoSay(h.id, 'Sent automatically at ' + new Date().toLocaleTimeString() + ' (' + x.matched + ' machines matched).');
      }
    } catch (e) { /* try again later */ } finally { autoBusy = false; }
  }
  function autoSoon(ms) { if (autoTimer) clearTimeout(autoTimer); autoTimer = setTimeout(() => { autoTimer = null; autoRun(false); }, ms); }
  window.addEventListener('hub-map-changed', () => autoSoon(20000));
  setTimeout(() => autoRun(false), 25000);
  setInterval(() => autoRun(false), 5 * 60000);
  window.__hubAutoRun = autoRun;
  $('hsAuto').addEventListener('change', async () => {
    if (!devHub) return; const on = $('hsAuto').checked;
    const r = await api.auto(devHub.id, on);
    if (!r || !r.ok) { $('hsAuto').checked = !on; $('hsAutoMsg').textContent = (r && r.error) || 'Could not change that.'; return; }
    devHub.auto = on; list = r.list || list;
    if (on) { $('hsAutoMsg').textContent = 'Sending now...'; await autoRun(true); if (autoMsgs[devHub.id]) $('hsAutoMsg').textContent = autoMsgs[devHub.id]; }
    else $('hsAutoMsg').textContent = 'Automatic sending is off.';
  });

})();
