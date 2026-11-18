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
