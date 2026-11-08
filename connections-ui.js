// The "Router & switch links" window: add routers, switches and controllers, test them, and let the
// network map learn from them (names, Wi-Fi or cable, switch ports).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const dialog = $('connDialog');
  if (!dialog || !window.connApi) { const b = $('mapConnBtn'); if (b) b.style.display = 'none'; return; }

  const HELP = {
    snmp: 'Switch on SNMP (read-only) in the device\'s settings. Version 2c needs a "community" name (often "public"); version 3 needs the user name and passwords you set up in the device (at least 8 characters each). Works with most managed switches, routers and access points (HPE / Aruba, Cisco, Netgear, TP-Link, Zyxel, D-Link, MikroTik and more). It also tells you which switch port each machine is plugged into.',
    ssh: 'No SNMP needed. The app logs in over SSH and runs a few fixed read-only "show" commands to read the ARP table, the MAC table (which port each machine is on) and DHCP leases. Device kind: linux (OpenWrt, pfSense-style and other Linux routers), mikrotik, cisco (IOS / IOS XE), or other (any device that answers "show arp"). Leave the password empty to use your SSH key (set it up with ssh-agent or a default key in your .ssh folder). A password works on Linux and macOS; on Windows use a key. The first connection trusts the device\'s SSH identity and remembers it.',
    unifi: 'Use a local UniFi account (a read-only one is enough, not your ubiquiti.com login). Works with UniFi OS consoles (port 443) and classic controllers (port 8443). Shows Wi-Fi or cable, the access point or switch port, and lists your UniFi switches and access points.',
    openwrt: 'Needs the packages uhttpd-mod-ubus and rpcd-mod-luci (normally installed). Log in with the root account. Shows which machines are on Wi-Fi.',
    mikrotik: 'RouterOS 7 or newer: switch on the "www-ssl" service (IP > Services) and use a read-only user. Shows names and which machines are on Wi-Fi.',
    opnsense: 'In System > Access > Users, create an API key for a user who may read diagnostics. Type the key as the user name and the secret as the password. Gives names and addresses (OPNsense does not say who is on Wi-Fi).',
    asus: 'Use the router\'s admin login. Works with the original ASUS firmware (and usually Asuswrt-Merlin). Shows Wi-Fi band or cable, signal strength and names.',
    netgear: 'Use the router\'s admin login (the one for routerlogin.net). Works with many Netgear routers, including the R6400 and other Nighthawk models, and usually Orbi. The address is the router\'s own (often 192.168.1.1); the port is usually 5000 (or 443 with https). In access-point mode the router may not list machines, because the router in front of it knows them: ask that one instead. Cable modems such as the CM2500 have no list of machines, so there is nothing to ask them.',
    fritz: 'In the FRITZ!Box, under Home Network > Network > Network Settings, allow "access for applications" (this switches on TR-064), and use a user that may log in. The port is 49000 (49443 with https). Shows Wi-Fi or cable and names.',
    omada: 'Use an Omada controller account (a viewer account is enough): the software controller (port 8043), or a hardware controller such as the OC200 (port 443). Leave the site name empty to read all sites. Shows Wi-Fi network, access point, signal and the switch port, and lists your Omada gear.',
    meraki: 'Meraki is managed from the cloud, so this one needs the internet. Create an API key in the Meraki dashboard (your profile > API access) and paste it below. You do not type an address. Optionally give one network name to read just that network.',
    cisco: 'On the switch or router (IOS XE 16.8 or newer), switch on RESTCONF ("restconf" and "ip http secure-server") and use a user that may read. Shows the model, port count, and which port each machine is on. Not every model offers every table.',
    arubacx: 'On an Aruba CX switch, switch on the REST API ("https-server rest access-mode read-only" with the management VRF enabled) and use a user that may read. Shows the model, port count and which port each machine is on.',
    hpe: 'Works with HPE OfficeConnect (1810, 1820, 1910, 1920, 1920S, 1950) and ProCurve switches. Switch on SNMP in the web interface (version 2c with community name "public" or your custom community). It reads the switch model, port count, and which switch port each machine is plugged into.'
  };
  const SITE_LABEL = { ssh: ['Device kind: linux, mikrotik, cisco or other', 'linux'], unifi: ['UniFi site name', 'default'], omada: ['Omada site name (empty = all sites)', ''], meraki: ['Network name (empty = all networks)', ''] };

  let types = {}, canEncrypt = true, list = [], editing = null, lastPoll = 0, polling = false;
  const msg = $('connMsg');
  const say = (t, good) => { msg.textContent = t || ''; msg.classList.toggle('ok', !!good); };

  async function load() {
    try {
      const t = await window.connApi.types();
      if (t && t.ok) { types = t.types; canEncrypt = t.canEncrypt; }
      const l = await window.connApi.list();
      if (l && l.ok) list = l.list;
    } catch (e) { /* ignore */ }
  }

  function when(ts) { return ts ? new Date(ts).toLocaleString() : ''; }

  function renderList() {
    const box = $('connList');
    box.textContent = '';
    if (!list.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No connections yet. Add your router or switch below.'; box.appendChild(p); return; }
    list.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'conn-row';
      const main = document.createElement('div');
      main.className = 'conn-main';
      const t = document.createElement('div');
      t.className = 'conn-title';
      t.textContent = (c.name || (types[c.type] ? types[c.type].label : c.type)) + '  ·  ' + c.host;
      const s = document.createElement('div');
      s.className = 'conn-sub' + (c.lastError ? ' bad' : '');
      s.textContent = c.lastError ? 'Last try failed: ' + c.lastError : (c.lastOk ? 'Last worked: ' + when(c.lastOk) : (types[c.type] ? types[c.type].label : ''));
      main.appendChild(t); main.appendChild(s);
      row.appendChild(main);
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
      edit.addEventListener('click', () => startEdit(c));
      const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Remove';
      del.addEventListener('click', async () => {
        if (!confirm('Remove this connection? Its saved login is deleted. Machines already on your map stay.')) return;
        const r = await window.connApi.remove(c.id);
        if (r && r.ok) { list = r.list; if (editing === c.id) resetForm(); renderList(); say('Removed.', true); }
      });
      row.appendChild(edit); row.appendChild(del);
      box.appendChild(row);
    });
  }

  function fillTypes() {
    const sel = $('connType');
    sel.textContent = '';
    Object.keys(types).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = types[k].label; sel.appendChild(o); });
  }

  function applyType(keepValues) {
    const k = $('connType').value;
    const t = types[k];
    if (!t) return;
    $('connHelp').textContent = HELP[k] || '';
    if (!keepValues) { $('connPort').value = String(t.defaults.port); $('connHttps').checked = !!t.defaults.https; }
    const snmp = k === 'snmp' || k === 'hpe';
    const v3 = snmp && $('connSnmpVer').value === '3';
    const cloud = !!t.cloud;
    $('connHostRow').classList.toggle('hidden', cloud);
    $('connPortRow').classList.toggle('hidden', cloud);
    $('connHttpsRow').classList.toggle('hidden', snmp || cloud || k === 'ssh');
    $('connSnmpRow').classList.toggle('hidden', !snmp);
    $('connV3Auth').classList.toggle('hidden', !v3);
    $('connV3Priv').classList.toggle('hidden', !v3 || $('connAuthProto').value === 'none');
    $('connSecret2Row').classList.toggle('hidden', !v3 || $('connAuthProto').value === 'none' || $('connPrivProto').value === 'none');
    $('connUserRow').classList.toggle('hidden', snmp ? !v3 : !t.userLabel);
    $('connUserLabel').textContent = snmp ? 'SNMP user name' : (t.userLabel || 'User name');
    $('connSecretLabel').textContent = v3 ? (snmp && $('connAuthProto').value === 'none' ? 'Password (not used)' : 'Authentication password') : t.secretLabel;
    $('connSiteRow').classList.toggle('hidden', !SITE_LABEL[k]);
    if (SITE_LABEL[k]) { $('connSiteLabel').textContent = SITE_LABEL[k][0]; $('connSite').placeholder = SITE_LABEL[k][1]; }
    $('connSecret').type = snmp && !v3 ? 'text' : 'password';
  }

  function resetForm() {
    editing = null;
    $('connFormTitle').textContent = 'Add a connection';
    ['connName', 'connHost', 'connUser', 'connSecret', 'connSecret2', 'connSite'].forEach((i) => { $(i).value = ''; });
    $('connSnmpVer').value = '2'; $('connAuthProto').value = 'sha'; $('connPrivProto').value = 'aes';
    $('connSecret2').placeholder = '';
    $('connSecret').placeholder = '';
    $('connNew').classList.add('hidden');
    if (types.snmp) { $('connType').value = Object.keys(types)[0]; }
    applyType(false);
  }

  function startEdit(c) {
    editing = c.id;
    $('connFormTitle').textContent = 'Edit connection';
    $('connType').value = c.type;
    $('connSnmpVer').value = String(c.snmpVersion || 2);
    $('connAuthProto').value = c.authProto || 'sha';
    $('connPrivProto').value = c.privProto || 'aes';
    applyType(true);
    $('connName').value = c.name || '';
    $('connHost').value = c.host;
    $('connPort').value = String(c.port);
    $('connHttps').checked = !!c.https;
    $('connUser').value = c.username || '';
    $('connSite').value = c.site || '';
    $('connSecret').value = '';
    $('connSecret').placeholder = c.hasSecret ? '(saved: leave empty to keep it)' : '';
    $('connSecret2').value = '';
    $('connSecret2').placeholder = c.hasSecret2 ? '(saved: leave empty to keep it)' : '';
    $('connNew').classList.remove('hidden');
    say('');
  }

  function formConfig() {
    return {
      id: editing || undefined, type: $('connType').value, name: $('connName').value, host: $('connHost').value.trim(),
      port: $('connPort').value.trim(), https: $('connHttps').checked, username: $('connUser').value, password: $('connSecret').value, site: $('connSite').value.trim(),
      snmpVersion: Number($('connSnmpVer').value), authProto: $('connAuthProto').value, privProto: $('connPrivProto').value, secret2: $('connSecret2').value
    };
  }

  $('connType').addEventListener('change', () => applyType(false));
  ['connSnmpVer', 'connAuthProto', 'connPrivProto'].forEach((i) => $(i).addEventListener('change', () => applyType(true)));
  $('connNew').addEventListener('click', resetForm);

  $('connTest').addEventListener('click', async () => {
    say('Trying...');
    $('connTest').disabled = true;
    try {
      const r = await window.connApi.test(formConfig());
      if (r && r.ok) {
        say('It works. ' + r.count + ' machine' + (r.count === 1 ? '' : 's') + ' reported' + (r.gear ? ', and ' + r.gear + ' switch / access point' + (r.gear === 1 ? '' : 'es') : '') +
          (r.self && r.self.name ? '. This device calls itself "' + r.self.name + '"' + (r.self.brand ? ' (' + r.self.brand + ')' : '') : '') + '.' + (r.note ? ' ' + r.note : ''), true);
      } else {
        say((r && r.error) || 'That did not work.');
      }
    } catch (e) { say('That did not work.'); }
    $('connTest').disabled = false;
  });

  $('connSave').addEventListener('click', async () => {
    const cfg = formConfig();
    const r = await window.connApi.save(cfg);
    if (!r || !r.ok) { say((r && r.error) || 'Could not save.'); return; }
    list = r.list;
    renderList();
    say('Saved.' + (r.stored ? '' : ' This computer cannot encrypt passwords safely, so the login is only kept until you close Dashboard Hub.'), true);
    resetForm();
    syncNow(true);
  });

  async function syncNow(quiet) {
    if (polling) return;
    polling = true;
    const pid = window.hubActiveProfile ? window.hubActiveProfile() : null;
    if (!quiet) { say('Asking your devices...'); $('connSync').disabled = true; }
    try {
      const r = await window.connApi.poll({ force: !quiet });
      if (window.hubActiveProfile && window.hubActiveProfile() !== pid) { polling = false; $('connSync').disabled = false; return; }      // the network profile was switched meanwhile: those answers belong to the other network
      if (r && r.ok && r.list) list = r.list;
      lastPoll = Date.now();
      let recheckSoon = false;
      const lines = [];
      let touched = 0;
      ((r && r.results) || []).forEach((res) => {
        if (res.ok && window.hubNetmap && window.hubNetmap.applyConnector) {
          const a = window.hubNetmap.applyConnector(res);
          touched += a.clients;
          lines.push((res.name || 'Device') + ': ' + a.clients + ' machine' + (a.clients === 1 ? '' : 's') + (a.created ? ' (' + a.created + ' new on the map)' : ''));
        } else if (!res.ok) {
          // a switch or access point that does not answer at all (unplugged, powered off) is marked offline after two missed checks
          if (window.hubNetmap && window.hubNetmap.connectorFailed) window.hubNetmap.connectorFailed(res.host, res.code, res.unreachable === true);
          if (res.code === 'timeout' || res.code === 'refused') recheckSoon = true;
          lines.push((res.name || 'Device') + ': ' + res.error);
        }
      });
      // a device that did not answer is asked once more in a few seconds, so an unplugged switch shows as offline quickly
      if (recheckSoon) setTimeout(() => { lastPoll = 0; syncNow(true); }, 8000);
      if (!quiet) say(lines.length ? lines.join('\n') : (r && r.busy ? 'Already asking...' : 'No connections yet.'), lines.length > 0 && !lines.some((l) => /: (No |The |Check|Could|That)/.test(l)));
      if (dialog.open) renderList();
    } catch (e) { if (!quiet) say('Something went wrong asking the devices.'); }
    polling = false;
    $('connSync').disabled = false;
  }

  // ---------- find devices that answer SNMP ----------
  (function snmpFinder() {
    const go = $('snmpFindGo'), stop = $('snmpFindStop'), out = $('snmpFindList'), note = $('snmpFindMsg'), names = $('snmpFindNames');
    if (!go || !window.connApi.findSnmp) return;
    let running = false, cancel = false;
    const addRow = (f) => {
      const row = document.createElement('div'); row.className = 'conn-row';
      const main = document.createElement('div'); main.className = 'conn-main';
      const t = document.createElement('div'); t.className = 'conn-title';
      t.textContent = f.ip + '  ·  ' + (f.name || f.descr || 'answers SNMP') + (f.brand ? '  (' + f.brand + ')' : '');
      const s = document.createElement('div'); s.className = 'conn-sub';
      s.textContent = 'Answered with community name "' + f.community + '" (SNMP version ' + (f.version === 1 ? '1' : '2c') + ')';
      main.appendChild(t); main.appendChild(s); row.appendChild(main);
      const b = document.createElement('button'); b.type = 'button';
      if (list.some((c) => c.host === f.ip)) { b.textContent = 'Already added'; b.disabled = true; }
      else {
        b.textContent = 'Add';
        b.addEventListener('click', async () => {
          b.disabled = true;
          let r;
          try { r = await window.connApi.save({ type: 'snmp', name: f.name || '', host: f.ip, port: 161, password: f.community, snmpVersion: f.version === 1 ? 1 : 2, username: '' }); } catch (e) { r = { ok: false, error: 'Could not be saved.' }; }
          if (r && r.ok) { list = r.list || list; b.textContent = 'Added'; say('Added ' + f.ip + '. Asking it now...', true); renderList(); syncNow(false); }
          else { b.disabled = false; say((r && r.error) || 'Could not be saved.'); }
        });
      }
      row.appendChild(b); out.appendChild(row);
    };
    go.addEventListener('click', async () => {
      if (running) return;
      const comms = names.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!comms.length) { note.textContent = 'Type at least one community name to try (the usual one is "public").'; return; }
      const devs = (window.hubNetmap && window.hubNetmap.deviceIps ? window.hubNetmap.deviceIps() : []);
      if (!devs.length) { note.textContent = 'The map has no machines yet. Scan your network first, then search.'; return; }
      running = true; cancel = false; out.textContent = ''; go.disabled = true; stop.classList.remove('hidden');
      let done = 0, found = 0;
      for (let i = 0; i < devs.length && !cancel; i += 24) {
        const chunk = devs.slice(i, i + 24);
        note.textContent = 'Asking machine ' + Math.min(done + 1, devs.length) + ' to ' + Math.min(done + chunk.length, devs.length) + ' of ' + devs.length + '... (' + found + ' found so far)';
        let r;
        try { r = await window.connApi.findSnmp({ ips: chunk.map((x) => x.ip), communities: comms }); } catch (e) { r = { ok: false, error: 'The search could not run.' }; }
        if (!r || !r.ok) { note.textContent = (r && r.error) || 'The search could not run.'; break; }
        r.found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })).forEach((f) => { addRow(f); found++; });
        done += chunk.length;
      }
      if (note.textContent.startsWith('Asking')) note.textContent = (cancel ? 'Stopped. ' : 'Done. ') + found + ' of ' + done + ' machines answered SNMP.' + (found < done ? ' The others have SNMP switched off, use a different community name, or are not network equipment.' : '');
      running = false; go.disabled = false; stop.classList.add('hidden');
    });
    stop.addEventListener('click', () => { cancel = true; });
  })();

  $('connSync').addEventListener('click', () => syncNow(false));

  $('mapConnBtn').addEventListener('click', async () => {
    await load();
    fillTypes();
    resetForm();
    renderList();
    say(canEncrypt ? '' : 'Note: this computer has no safe place to keep passwords (on Linux it needs a keyring such as GNOME Keyring). Logins will only be remembered until you close Dashboard Hub.');
    dialog.showModal();
  });
  $('connClose').addEventListener('click', () => dialog.close());

  // after every scan or live tick, quietly ask the saved devices too (not more often than every 8 seconds)
  window.hubConnections = {
    syncNow: () => { if (list.length && Date.now() - lastPoll > 3000) syncNow(true); },
    // another network profile is showing: forget this one's links and load the new profile's
    reload: async () => {
      list = []; lastPoll = 0; editing = null;
      try { await load(); } catch (e) { /* ignore */ }
      if (typeof resetForm === 'function') { try { resetForm(); } catch (e) { /* ignore */ } }
      if (dialog.open) renderList();
    },
    // asks every saved router / access point / switch right now and puts what they report onto the map
    refreshNow: async () => {
      for (let i = 0; i < 40 && polling; i++) await new Promise((r) => setTimeout(r, 250));
      if (!list.length) { try { await load(); } catch (e) { /* ignore */ } }
      if (!list.length) return { ok: false, none: true };
      await syncNow(true);
      return { ok: true, count: list.length };
    }
  };
  if (window.hubNetmap && window.hubNetmap.onScanDone) {
    window.hubNetmap.onScanDone(() => { if (list.length && Date.now() - lastPoll > 3000) syncNow(true); });
  }
  load().then(() => { if (list.length) setTimeout(() => syncNow(true), 3000); });
  // the routers and switches are asked on their own clock (not only after a scan), so changes show within seconds
  setInterval(() => {
    if (!list.length || document.hidden || !document.body.classList.contains('view-map')) return;
    const live = window.hubNetmap && window.hubNetmap.liveSeconds ? window.hubNetmap.liveSeconds() : 0;
    const every = live > 0 ? Math.max(5, Math.min(10, live)) : 20;
    if (Date.now() - lastPoll < every * 1000 - 500) return;
    syncNow(true);
  }, 2000);
})();
