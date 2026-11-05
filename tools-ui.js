// The "Update file tools" window: unpack and pack .hubupdate files.
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
