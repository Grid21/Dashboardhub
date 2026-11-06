// The Updates dialog: install an update from a file, or go back to the built-in version.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const dialog = $('updateDialog');
  const versionEl = $('updateVersion');
  const noteEl = $('updateNote');
  const msgEl = $('updateMsg');
  const installBtn = $('updateInstall');
  const revertBtn = $('updateRevert');
  const quitBtn = $('updateQuit');
  const restartBtn = $('updateRestart');
  const prevBtn = $('updateRevertPrev');
  const probBox = $('updateProblem');
  let currentProblem = null;

  function say(text, good) {
    msgEl.textContent = text || '';
    msgEl.classList.toggle('ok', !!good);
  }

  function showProblem(p) {
    currentProblem = p || null;
    probBox.classList.toggle('hidden', !p);
    if (!p) return;
    $('updateProblemTitle').textContent = 'Update ' + p.version + ' did not work';
    $('updateProblemWhat').textContent = p.what;
    const ul = $('updateProblemTips');
    ul.textContent = '';
    (p.tips || []).forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    $('updateProblemDetail').textContent = p.detail || '';
  }

  // plain suggestions for an update file that was refused while installing
  function installTips(error) {
    if (/newer full version/.test(error)) return '';
    return ' What you can do: download the update file again (it may have been cut short), and check that it is a .hubupdate file from someone you trust. If it still fails, send me the message above.';
  }

  async function refresh() {
    versionEl.textContent = '';
    noteEl.textContent = '';
    revertBtn.classList.add('hidden');
    prevBtn.classList.add('hidden');
    if (!window.updateApi) { versionEl.textContent = 'Updates are not available in this window.'; installBtn.disabled = true; return; }
    try {
      const i = await window.updateApi.info();
      versionEl.textContent = 'Version ' + i.version + (i.source === 'update' ? ' (installed update, the program itself is ' + i.builtIn + ')' : ' (built-in)');
      noteEl.textContent = i.note || '';
      noteEl.classList.toggle('hidden', !i.note);
      revertBtn.classList.toggle('hidden', i.source !== 'update');
      if (i.previous) { prevBtn.textContent = 'Go back to last working version (' + i.previous.version + ')'; prevBtn.disabled = false; prevBtn.title = 'Switch back to the update you used before this one'; prevBtn.classList.remove('hidden'); }
      else if (i.source === 'update') {
        // always show where the way back is, even when there is nothing to go back to yet
        prevBtn.textContent = 'Go back to last working version (none stored yet)'; prevBtn.disabled = true;
        prevBtn.title = 'When you install your next update, this version is kept so you can come back to it.'; prevBtn.classList.remove('hidden');
        noteEl.textContent = (i.note ? i.note + ' ' : '') + 'No earlier update is stored on this computer yet. After you install your next update, the version you are leaving is kept so you can go back to it.';
        noteEl.classList.remove('hidden');
      }
      showProblem(i.problem);
      loadVersions();
      return i;
    } catch (e) {
      versionEl.textContent = 'Could not read the version.';
    }
  }

  // the last few versions kept on this computer, each with a button to go back to it
  async function loadVersions() {
    const box = $('updVersionsBox'), ul = $('updVersions');
    if (!box || !ul || !window.updaterApi || !window.updaterApi.versions) return;
    let r; try { r = await window.updaterApi.versions(); } catch (e) { r = null; }
    ul.textContent = '';
    const list = r && r.ok && Array.isArray(r.list) ? r.list : [];
    box.classList.toggle('hidden', list.length === 0);
    list.forEach((v) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const when = v.installedAt ? new Date(v.installedAt) : null;
      label.textContent = 'Version ' + v.version + (when && !isNaN(when) ? ' (installed ' + when.toLocaleDateString() + ')' : '');
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'Go back to this version'; b.title = 'Switch to version ' + v.version;
      b.addEventListener('click', async () => {
        if (!confirm('Go back to version ' + v.version + '? Close and reopen the app afterwards. Your panels, notes and settings are kept.')) return;
        b.disabled = true;
        let res; try { res = await window.updaterApi.switchTo(v.version); } catch (e) { res = null; }
        if (res && res.ok) { say('Done. Restart Dashboard Hub now to use version ' + res.version + '?', true); offerRestart(); }
        else { say((res && res.error) || 'Could not switch back.'); b.disabled = false; }
      });
      li.append(label, b);
      ul.appendChild(li);
    });
  }

  $('updatesBtn').addEventListener('click', () => {
    say('');
    quitBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
    restartBtn.disabled = false;
    installBtn.disabled = !window.updateApi;
    refresh();
    dialog.showModal();
  });
  $('updateClose').addEventListener('click', () => {
    if (currentProblem) { try { window.updateApi.dismiss(); } catch (e) { /* ignore */ } currentProblem = null; }
    dialog.close();
  });

  installBtn.addEventListener('click', async () => {
    say('');
    installBtn.disabled = true;
    try {
      const r = await window.updateApi.install();
      if (r && r.ok) {
        say('Version ' + r.version + ' is installed. Restart Dashboard Hub now to start using it? (Or choose "Close the app" and open it yourself later.)', true);
        offerRestart();
        revertBtn.classList.remove('hidden');
      } else if (r && r.error) {
        say(r.error + installTips(r.error));
      }
    } catch (e) {
      say('Something went wrong installing that file.');
    } finally {
      installBtn.disabled = false;
    }
  });

  $('updateProblemOk').addEventListener('click', async () => {
    try { await window.updateApi.dismiss(); } catch (e) { /* ignore */ }
    probBox.classList.add('hidden');
    currentProblem = null;
  });
  $('updateProblemCopy').addEventListener('click', async () => {
    if (!currentProblem) return;
    const text = 'Dashboard Hub update problem\n' + currentProblem.what + '\n\n' + currentProblem.detail;
    try { await navigator.clipboard.writeText(text); say('Copied. You can paste it into a message.', true); }
    catch (e) { say('Could not copy automatically. Select the details above and copy them by hand.'); }
  });

  prevBtn.addEventListener('click', async () => {
    if (!confirm('Go back to the last working version? Close and reopen the app afterwards. Your panels, notes and settings are kept.')) return;
    try {
      const r = await window.updateApi.revert('previous');
      if (r && r.ok) { say('Done. Restart Dashboard Hub now to use version ' + r.version + '?', true); offerRestart(); }
      else say((r && r.error) || 'Could not switch back.');
    } catch (e) { say('Could not switch back.'); }
  });

  revertBtn.addEventListener('click', async () => {
    if (!confirm('Go back to the built-in version? Close and reopen the app afterwards. Your panels, notes and settings are kept.')) return;
    try {
      const r = await window.updateApi.revert();
      if (r && r.ok) { say('Done. Restart Dashboard Hub now to use the built-in version?', true); offerRestart(); }
      else say((r && r.error) || 'Could not switch back.');
    } catch (e) { say('Could not switch back.'); }
  });

  function offerRestart() {
    restartBtn.classList.remove('hidden');
    quitBtn.classList.remove('hidden');
  }
  restartBtn.addEventListener('click', async () => {
    restartBtn.disabled = true;
    say('Restarting... If Dashboard Hub does not come back by itself in a few seconds, open it again by hand.', true);
    try { await window.updateApi.restart(); } catch (e) { say('Could not restart automatically. Close the app and open it again.'); restartBtn.disabled = false; }
  });
  $('reloadApp').addEventListener('click', () => { if (window.updateApi) window.updateApi.reload().catch(() => {}); });
  quitBtn.addEventListener('click', () => { if (window.updateApi) window.updateApi.quit(); });

  // tell the starter this version loaded properly (if it never does, the update turns itself off)
  window.addEventListener('load', () => {
    if (!window.updateApi) return;
    window.updateApi.ready().catch(() => {});
    // if the last start had a problem, say so right away
    window.updateApi.info().then((i) => {
      if (i && i.problem) { say(''); quitBtn.classList.add('hidden'); restartBtn.classList.add('hidden'); installBtn.disabled = false; refresh(); if (!dialog.open) dialog.showModal(); }
    }).catch(() => {});
  });
})();
