// The Security settings window (Settings menu).
(function () {
  const $ = (id) => document.getElementById(id);
  const dlg = $('securityDialog'), btn = $('securityMenuBtn');
  if (!dlg || !btn || !window.securityApi) return;
  const MAP = { secPopups: 'popups', secMedia: 'allowMedia', secNotif: 'allowNotifications', secClip: 'allowClipboard', secThorough: 'thoroughScan', secConn: 'connectors', secMeraki: 'meraki', secV3: 'snmpV3Only' };
  const say = (t) => { $('secMsg').textContent = t || ''; };

  function fill(s) {
    $('secCerts').value = s.certs;
    Object.keys(MAP).forEach((id) => { $(id).checked = !!s[MAP[id]]; });
  }
  async function load() {
    try { const r = await window.securityApi.get(); if (r && r.ok) fill(r.settings); } catch (e) { say('The settings could not be read.'); }
  }
  async function save(patch) {
    let r; try { r = await window.securityApi.set(patch); } catch (e) { r = { ok: false, error: 'The settings could not be saved.' }; }
    if (r && r.ok) { fill(r.settings); say('Saved.'); } else { say((r && r.error) || 'The settings could not be saved.'); load(); }
  }
  btn.addEventListener('click', () => { say(''); load(); if (!dlg.open) dlg.showModal(); });
  $('secCerts').addEventListener('change', () => save({ certs: $('secCerts').value }));
  Object.keys(MAP).forEach((id) => $(id).addEventListener('change', () => save({ [MAP[id]]: $(id).checked })));
  const preset = async (name) => {
    let r; try { r = await window.securityApi.preset(name); } catch (e) { r = null; }
    if (r && r.ok) { fill(r.settings); say(name === 'strict' ? 'Strictest settings applied.' : 'Standard settings restored.'); } else say('The settings could not be saved.');
  };
  $('secDefault').addEventListener('click', () => preset('default'));
  $('secStrict').addEventListener('click', () => preset('strict'));
  $('secClose').addEventListener('click', () => dlg.close());
})();
