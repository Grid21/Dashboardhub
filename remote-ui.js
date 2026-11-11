// The Remote view window: a list of devices on the left, each opens in its own tab.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.remoteApi;
  if (!api) return;
  const KIND = { pikvm: 'PiKVM', jetkvm: 'JetKVM', web: 'Web', nomachine: 'NoMachine' };
  const HINT = {
    pikvm: 'Normally https://address/ (port 443). Sign in with your PiKVM user (admin by default) on the page that opens.',
    jetkvm: 'Normally http://address/ (port 80). Sign in on the page that opens, if you set a password on the JetKVM.',
    web: 'Any device or page that works in a web browser. You can paste a full address such as https://kvm.lan:8443/.',
    nomachine: 'The computer you want to control must run NoMachine (port 4000 by default). The user name is optional: NoMachine asks for the password in its own window.'
  };
  let devices = [], tabs = [], current = '', editing = null;

  const find = (id) => devices.find((d) => d.id === id);
  function webUrl(d) {
    const h = d.host.includes(':') ? '[' + d.host + ']' : d.host, def = d.scheme === 'http' ? 80 : 443;
    return d.scheme + '://' + h + (d.port && d.port !== def ? ':' + d.port : '') + '/';
  }
  function renderList() {
    const box = $('rvList'); box.textContent = '';
    if (!devices.length) { const p = document.createElement('p'); p.className = 'rv-hint'; p.textContent = 'No devices yet.'; box.appendChild(p); }
    devices.forEach((d) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-dev' + (d.id === current ? ' active' : ''); b.title = d.type === 'nomachine' ? d.host + ':' + (d.port || 4000) : webUrl(d);
      const n = document.createElement('span'); n.className = 'rv-name'; n.textContent = d.name; b.appendChild(n);
      const k = document.createElement('span'); k.className = 'rv-kind'; k.textContent = KIND[d.type] || d.type; b.appendChild(k);
      b.addEventListener('click', () => openDevice(d.id));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); edit(d.id); });
      box.appendChild(b);
    });
  }
  function renderTabs() {
    const bar = $('rvTabs'); bar.textContent = '';
    tabs.forEach((t) => {
      const d = find(t.id); if (!d) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-tab' + (t.id === current ? ' active' : '');
      const s = document.createElement('span'); s.textContent = d.name; b.appendChild(s);
      const x = document.createElement('span'); x.className = 'rv-x'; x.textContent = '×'; x.title = 'Close this tab'; b.appendChild(x);
      b.addEventListener('click', (e) => { if (e.target === x) closeTab(t.id); else show(t.id); });
      bar.appendChild(b);
    });
  }
  function show(id) {
    current = id;
    tabs.forEach((t) => t.el.classList.toggle('hidden', t.id !== id));
    $('rvEmpty').classList.toggle('hidden', !!tabs.length);
    const d = find(id), t = tabs.find((x) => x.id === id);
    $('rvBar').classList.toggle('hidden', !d);
    $('rvUrl').textContent = d ? (d.type === 'nomachine' ? d.host + ':' + (d.port || 4000) : webUrl(d)) : '';
    $('rvReload').classList.toggle('hidden', !t || t.kind !== 'web'); $('rvFull').classList.toggle('hidden', !t || t.kind !== 'web'); $('rvBrowser').classList.toggle('hidden', !d || d.type === 'nomachine');
    renderList(); renderTabs();
  }
  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id); if (i < 0) return;
    tabs[i].el.remove(); tabs.splice(i, 1);
    if (current === id) current = tabs.length ? tabs[Math.min(i, tabs.length - 1)].id : '';
    if (current) show(current); else { $('rvEmpty').classList.remove('hidden'); $('rvBar').classList.add('hidden'); renderList(); renderTabs(); }
  }
  function card(html) { const c = document.createElement('div'); c.className = 'rv-card'; html(c); return c; }
  function mk(tag, text, cls) { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  function openDevice(id) {
    const d = find(id); if (!d) return;
    const had = tabs.find((t) => t.id === id);
    if (had && d.type !== 'nomachine') { show(id); return; }
    if (had) { had.el.remove(); tabs.splice(tabs.indexOf(had), 1); }
    const stage = $('rvStage');
    if (d.type === 'nomachine') {
      const c = card((el) => { el.appendChild(mk('h3', 'Starting NoMachine...')); el.appendChild(mk('p', d.host + ':' + (d.port || 4000))); });
      stage.appendChild(c); tabs.push({ id, el: c, kind: 'nx' }); show(id);
      api.nx(id).then((r) => {
        c.textContent = '';
        if (r && r.ok) { c.appendChild(mk('h3', 'NoMachine is opening')); c.appendChild(mk('p', 'It opens in its own NoMachine window, connected to ' + d.host + '. Type the password there. You can close this tab.')); }
        else if (r && r.notInstalled) {
          c.appendChild(mk('h3', 'NoMachine is not installed here'));
          c.appendChild(mk('p', 'NoMachine is separate, free software that is not part of Dashboard Hub. Install it on this computer (it is the program used to connect), and make sure NoMachine is also installed on the computer you want to control.'));
          c.appendChild(mk('p', 'Steps: 1) download and install NoMachine, 2) come back here and click "Check again".'));
          const b = mk('button', 'Open the NoMachine download page', 'primary'); b.type = 'button'; b.addEventListener('click', () => api.nxDownload()); c.appendChild(b);
          const b2 = mk('button', 'Check again'); b2.type = 'button'; b2.addEventListener('click', () => openDevice(id)); c.appendChild(b2);
        } else { c.appendChild(mk('h3', 'NoMachine could not be started')); c.appendChild(mk('p', (r && r.error) || 'Unknown problem.')); }
      }).catch(() => { c.textContent = ''; c.appendChild(mk('h3', 'NoMachine could not be started')); });
      return;
    }
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:remote'); wv.setAttribute('src', webUrl(d));
    const fail = card((el) => {});
    fail.classList.add('hidden'); fail.style.background = 'rgba(20,23,28,.94)'; fail.style.zIndex = 2;
    const retry = () => { fail.classList.add('hidden'); try { wv.reload(); } catch (e) { /* not ready */ } };
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3 || e.isMainFrame === false) return;            // -3 = cancelled by a newer load
      fail.textContent = ''; fail.appendChild(mk('h3', 'Could not reach ' + d.name)); fail.appendChild(mk('p', 'Check the address and port, that the device is on and on this network. (' + (e.errorDescription || 'error') + ')'));
      const b = mk('button', 'Try again', 'primary'); b.type = 'button'; b.addEventListener('click', retry); fail.appendChild(b); fail.classList.remove('hidden');
    });
    wv.addEventListener('did-start-loading', () => fail.classList.add('hidden'));
    const holder = document.createElement('div'); holder.style.cssText = 'position:absolute;inset:0'; holder.appendChild(wv); holder.appendChild(fail);
    holder.classList.add('rv-holder');
    stage.appendChild(holder); tabs.push({ id, el: holder, kind: 'web', wv }); show(id);
  }
  function edit(id) {
    editing = id ? find(id) : null;
    $('rvDlgTitle').textContent = editing ? 'Edit device' : 'Add a device';
    $('rvType').value = editing ? editing.type : 'pikvm'; $('rvName').value = editing ? editing.name : ''; $('rvHost').value = editing ? editing.host : '';
    $('rvPort').value = editing && editing.port ? String(editing.port) : ''; $('rvUser').value = editing && editing.user || '';
    $('rvDelete').classList.toggle('hidden', !editing); $('rvDlgMsg').textContent = ''; typeChanged(); $('rvDialog').showModal();
  }
  function nxCheck() {
    const s = $('rvNxState'); s.className = 'rv-nxstate'; s.textContent = 'Checking this computer...';
    api.nxStatus().then((r) => { const ok = !!(r && r.installed); s.className = 'rv-nxstate ' + (ok ? 'ok' : 'bad'); s.textContent = ok ? '\u2713 NoMachine was found on this computer.' : '\u2717 NoMachine was not found on this computer. Download and install it first.'; }).catch(() => { s.textContent = ''; });
  }
  $('rvNxGet').addEventListener('click', () => api.nxDownload());
  function typeChanged() { const t = $('rvType').value; $('rvNxNote').classList.toggle('hidden', t !== 'nomachine'); if (t === 'nomachine') nxCheck(); $('rvUserRow').classList.toggle('hidden', t !== 'nomachine'); $('rvDlgHint').textContent = HINT[t] || ''; $('rvHost').placeholder = t === 'nomachine' ? 'desktop.lan or 192.168.0.60' : '192.168.0.50'; }
  async function persist(list) {
    const r = await api.save(list);
    if (!r || !r.ok) return r || { ok: false, error: 'Could not save.' };
    devices = r.devices; renderList(); renderTabs();
    return r;
  }
  $('rvAdd').addEventListener('click', () => edit(null));
  $('rvType').addEventListener('change', typeChanged);
  $('rvCancel').addEventListener('click', () => $('rvDialog').close());
  $('rvSave').addEventListener('click', async () => {
    const d = { id: editing ? editing.id : '', type: $('rvType').value, name: $('rvName').value, host: $('rvHost').value, port: $('rvPort').value.trim(), user: $('rvUser').value };
    const list = editing ? devices.map((x) => (x.id === editing.id ? d : x)) : devices.concat([d]);
    const r = await persist(list);
    if (!r.ok) { $('rvDlgMsg').textContent = r.error || 'Could not save.'; return; }
    const wasEditing = editing; $('rvDialog').close();
    if (wasEditing) { const t = tabs.find((x) => x.id === wasEditing.id); if (t) closeTab(wasEditing.id); openDevice(wasEditing.id); } else openDevice(r.devices[r.devices.length - 1].id);
  });
  $('rvDelete').addEventListener('click', async () => {
    if (!editing) return;
    const id = editing.id; const r = await persist(devices.filter((x) => x.id !== id));
    if (!r.ok) { $('rvDlgMsg').textContent = r.error || 'Could not remove.'; return; }
    $('rvDialog').close(); closeTab(id);
  });
  $('rvReload').addEventListener('click', () => { const t = tabs.find((x) => x.id === current); if (t && t.wv) { try { t.wv.reload(); } catch (e) { /* not ready */ } } });
  $('rvBrowser').addEventListener('click', () => { if (current) api.external(current); });
  $('rvEdit').addEventListener('click', () => { if (current) edit(current); });
  let full = false;
  function setFull(on) { full = on; document.body.classList.toggle('rv-full', on); api.fullscreen(on); }
  $('rvFull').addEventListener('click', () => setFull(true));
  $('rvFullExit').addEventListener('click', () => setFull(false));
  window.addEventListener('beforeunload', () => { if (full) api.fullscreen(false); });
  api.list().then((r) => { devices = (r && r.devices) || []; renderList(); const want = new URLSearchParams(location.search).get('open'); if (want && find(want)) openDevice(want); });
})();
