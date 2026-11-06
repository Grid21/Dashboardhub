// The "new version available" bar and the update-check controls in Settings.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.updaterApi;
  if (!api) return;
  const bar = $('updateBanner'), title = $('ubTitle'), sub = $('ubSub'), notes = $('ubNotes'), notesText = $('ubNotesText');
  const btn = { install: $('ubInstall'), page: $('ubOpenPage'), later: $('ubLater'), skip: $('ubSkip'), yes: $('ubYes'), no: $('ubNo'), restart: $('ubRestart'), close: $('ubClose') };
  const auto = $('updAuto'), checkNow = $('updCheckNow'), hint = $('updHint');
  let scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; setInterval(() => { if (st.enabled) check(false); }, 12 * 3600 * 1000); }
  let offered = null;          // the newer version being offered right now
  let st = { configured: false, asked: false, enabled: false, current: '' };

  function show(parts) {
    title.textContent = parts.title || ''; sub.textContent = parts.sub || '';
    Object.keys(btn).forEach((k) => btn[k].classList.toggle('hidden', !(parts.buttons || []).includes(k)));
    notes.classList.toggle('hidden', !parts.notes);
    notesText.textContent = parts.notes || '';
    notes.open = false;
    bar.classList.remove('hidden');
  }
  function hide() { bar.classList.add('hidden'); }
  function setHint(t) { if (hint) hint.textContent = t || ''; }
  function busy(on) { Object.values(btn).forEach((b) => { b.disabled = on; }); }

  function offer(r) {
    offered = r;
    show({
      title: 'Dashboard Hub ' + r.latest + ' is available.',
      sub: 'You have ' + r.current + '. Nothing is installed unless you click Install.',
      notes: r.notes || '',
      buttons: [r.assetName ? 'install' : 'page', 'later', 'skip']
    });
  }

  async function check(manual) {
    let r;
    try { r = await api.check(manual); } catch (e) { r = { ok: false, error: 'Could not check for updates.' }; }
    if (manual) {
      if (!r.ok) setHint(r.notConfigured ? 'Update checks are not set up for this copy yet.' : r.error || 'Could not check for updates.');
      else if (r.available) { setHint('Version ' + r.latest + ' is available.'); offer(r); }
      else setHint('You are up to date (' + (r.current || st.current) + ').');
    } else if (r.ok && r.offer) offer(r);
    return r;
  }

  // the Updates window (file installer) can check online too, whatever you answered before, and shows the result right there
  const dlgCheck = $('updDlgCheck'), dlgMsg = $('updDlgMsg');
  if (dlgCheck) dlgCheck.addEventListener('click', async () => {
    dlgMsg.textContent = 'Checking...'; dlgCheck.disabled = true;
    const r = await check(true);
    dlgCheck.disabled = false;
    if (!r.ok) dlgMsg.textContent = r.notConfigured ? 'Update checks are not set up for this copy yet.' : (r.error || 'Could not check for updates.');
    else if (r.available) {
      dlgMsg.textContent = 'Version ' + r.latest + ' is available. Showing it now...';
      setTimeout(() => { const d = $('updateDialog'); if (d && d.open) d.close(); }, 700);          // so the "new version" bar is in view
    } else dlgMsg.textContent = 'You are up to date (' + (r.current || st.current) + ').';
  });
  const dlgFolder = $('updDlgFolder');
  if (dlgFolder) dlgFolder.addEventListener('click', async () => {
    let r; try { r = await api.openFolder(); } catch (e) { r = { ok: false, error: 'Could not open the folder.' }; }
    dlgMsg.textContent = r && r.ok ? 'Opened the updates folder.' : ((r && r.error) || 'Could not open the folder.');
  });
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'updatesBtn' && dlgMsg) dlgMsg.textContent = ''; }, true);

  btn.later.addEventListener('click', async () => { try { await api.snooze(); } catch (e) { /* ignore */ } hide(); });
  btn.skip.addEventListener('click', async () => { if (offered) { try { await api.skip(offered.latest); } catch (e) { /* ignore */ } } hide(); });
  btn.close.addEventListener('click', hide);
  btn.page.addEventListener('click', () => { show({ title: 'Version ' + (offered && offered.latest) + ' is on GitHub.', sub: 'Open ' + (offered && offered.page) + ' in your browser and download it from there.', buttons: ['close'] }); });
  btn.yes.addEventListener('click', async () => { try { await api.setEnabled(true); } catch (e) { /* ignore */ } st.enabled = true; st.asked = true; if (auto) auto.checked = true; hide(); schedule(); check(false); });
  btn.no.addEventListener('click', async () => { try { await api.setEnabled(false); } catch (e) { /* ignore */ } st.enabled = false; st.asked = true; if (auto) auto.checked = false; hide(); });

  btn.install.addEventListener('click', async () => {
    busy(true);
    title.textContent = 'Downloading ' + (offered ? offered.latest : '') + '...'; sub.textContent = '';
    let d;
    try { d = await api.download(); } catch (e) { d = { ok: false, error: 'The download failed.' }; }
    if (!d.ok) { busy(false); show({ title: 'Could not download the update.', sub: d.error || '', buttons: offered && offered.assetName ? ['install', 'later'] : ['close'] }); return; }
    // hand it to the starter program, which checks it again and asks you to confirm
    let info = null; try { info = await window.updateApi.info(); } catch (e) { /* ignore */ }
    let r;
    try {
      if (info && info.stubApi >= 3) r = await window.updateApi.installFile(d.name);
      else {
        // an older starter program installs from its file box: the downloaded file is handed to it, so there is nothing to look for
        const armed = await api.armInstall(d.name);
        if (!armed || !armed.ok) throw new Error('arm');
        r = await window.updateApi.install();
        if (r && r.ok) { try { await api.tidy(); } catch (e) { /* tidy-up only */ } }
      }
    } catch (e) { r = { ok: false, error: 'Could not install the update.' }; }
    busy(false);
    if (r && r.ok) show({ title: 'Version ' + (r.version || (offered && offered.latest) || '') + ' is installed. Restart needed.', sub: 'Dashboard Hub has to restart before the new version runs. Click "Restart now", or close the app and open it again. Your panels, notes and settings are kept.', buttons: ['restart', 'close'] });
    else if (r && r.canceled) { show({ title: 'Update not installed.', sub: 'The downloaded file is kept until you check again.', buttons: ['install', 'later', 'skip'] }); }
    else show({ title: 'Could not install the update.', sub: (r && r.error) || 'Open Updates and choose "Install update from file" instead.', buttons: ['close'] });
  });
  btn.restart.addEventListener('click', async () => { btn.restart.disabled = true; try { await window.updateApi.restart(); } catch (e) { sub.textContent = 'Could not restart automatically. Close the app and open it again.'; btn.restart.disabled = false; } });

  if (auto) auto.addEventListener('change', async () => {
    try { await api.setEnabled(auto.checked); } catch (e) { /* ignore */ }
    st.enabled = auto.checked; st.asked = true;
    setHint(auto.checked ? 'Checking is on. Nothing installs unless you click Install.' : 'Checking is off.');
    if (auto.checked) { schedule(); check(false); }
  });
  if (checkNow) checkNow.addEventListener('click', async () => { setHint('Checking...'); checkNow.disabled = true; await check(true); checkNow.disabled = false; });

  async function start() {
    try { st = await api.status(); } catch (e) { return; }
    if (auto) { auto.checked = !!st.enabled; if (!st.configured) { auto.disabled = true; setHint('Update checks are not set up for this copy yet.'); } }
    if (!st.configured) return;                                       // nothing to ask about yet
    if (!st.asked) {
      show({ title: 'Check for new versions automatically?', sub: 'Dashboard Hub would ask GitHub, and nothing else, whether a newer version exists. It never installs anything unless you click Install. You can change this in Settings.', buttons: ['yes', 'no'] });
      return;
    }
    if (st.enabled) {
      schedule();
      setTimeout(() => check(false), 8000);                            // after the app has settled
    }
  }
  start();
})();
