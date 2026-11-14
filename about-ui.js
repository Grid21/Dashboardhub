// The About window: what Dashboard Hub is, its version and license, and the network ports it uses.
(function () {
  const $ = (id) => document.getElementById(id);
  const btn = $('aboutBtn'), dlg = $('aboutDialog');
  if (!btn || !dlg) return;

  // [what it is for, ports, who is contacted]  (all connections start from this computer)
  const PORTS = [
    ['Finding machines', 'Ping, plus this computer\'s own address table (no port)'],
    ['Reading a switch or router over SSH (optional connection)', 'TCP 22 (or the port you set) to that device'],
    ['Listening for announcements (mDNS and SSDP)', 'UDP 5353 and UDP 1900 (local network multicast), then one web request to a device that answered'],
    ['Asking Windows machines for their name (NetBIOS)', 'UDP 137'],
    ['Looking up machine names', 'DNS (UDP 53) to your own DNS server'],
    ['Checking whether a machine is alive', 'TCP 22, 53, 80, 135, 139, 443, 445, 3389, 8080, 62078'],
    ['Quick scan', 'About 100 common service ports (SSH, web, file sharing, printers, media servers...)'],
    ['Thorough scan', 'The quick-scan ports plus TCP 1 to 1024'],
    ['SNMP and HPE switches', 'UDP 161'],
    ['DNS check', 'UDP and TCP 53'],
    ['Network boot (PXE), only while you press Start in its window', 'UDP 67 and 4011 (boot information), UDP 69 (TFTP), TCP 8088 (menu and ISO files), on the local network'],
    ['Wake-on-LAN', 'UDP broadcast, ports 9 and 7'],
    ['UniFi, MikroTik, OPNsense, Cisco, Aruba', 'TCP 443'],
    ['OpenWrt, ASUS', 'TCP 80'],
    ['Netgear', 'TCP 5000'],
    ['FRITZ!Box', 'TCP 49000'],
    ['TP-Link Omada', 'TCP 8043'],
    ['Server management (iLO, iDRAC)', 'TCP 443'],
    ['Listing a machine\'s file shares', 'SMB 445, NFS'],
    ['Cisco Meraki and the update check (the only internet traffic)', 'HTTPS 443, to Meraki and to GitHub']
  ];
  const body = $('aboutPorts');
  PORTS.forEach((r) => {
    const tr = document.createElement('tr');
    r.forEach((t) => { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); });
    body.appendChild(tr);
  });

  btn.addEventListener('click', async () => {
    const v = $('aboutVersion');
    v.textContent = '';
    try {
      const i = await window.updateApi.info();
      v.textContent = 'Version ' + i.version + (i.source === 'update' ? ' (installed update, the program itself is ' + i.builtIn + ')' : '');
    } catch (e) { v.textContent = ''; }
    dlg.showModal();
  });
  $('aboutClose').addEventListener('click', () => dlg.close());
})();

// The manual inside the About window, with search.
(function () {
  const $ = (id) => document.getElementById(id);
  const dlg = $('aboutDialog'), tabAbout = $('aboutTabAbout'), tabManual = $('aboutTabManual');
  const pane = $('manualPane'), about = $('aboutPane'), list = $('manualList');
  const input = $('manualSearch'), clear = $('manualClear'), count = $('manualCount');
  if (!dlg || !tabAbout || !tabManual || !pane || !list || !Array.isArray(window.HUB_MANUAL)) return;
  const DATA = window.HUB_MANUAL;
  const plain = (b) => (typeof b === 'string' ? b : b.tip ? b.tip : (b.steps || b.list || []).join(' '));
  const full = DATA.map((sec) => ({ sec: sec, text: (sec.title + ' ' + sec.words + ' ' + sec.body.map(plain).join(' ')).toLowerCase(), title: sec.title.toLowerCase(), words: sec.words.toLowerCase() }));

  // put the matched words in <mark> without ever using innerHTML
  function addText(parent, text, terms) {
    if (!terms.length) { parent.appendChild(document.createTextNode(text)); return; }
    const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    text.split(re).forEach((part, i) => {
      if (i % 2 === 1) { const m = document.createElement('mark'); m.textContent = part; parent.appendChild(m); } else if (part) parent.appendChild(document.createTextNode(part));
    });
  }
  function build(sec, terms, open) {
    const d = document.createElement('details');
    d.className = 'manual-sec'; d.id = 'manual-' + sec.id; d.open = open;
    const sm = document.createElement('summary'); addText(sm, sec.title, terms); d.appendChild(sm);
    const body = document.createElement('div'); body.className = 'manual-body';
    sec.body.forEach((b) => {
      if (typeof b === 'string') { const p = document.createElement('p'); addText(p, b, terms); body.appendChild(p); return; }
      if (b.tip) { const p = document.createElement('p'); p.className = 'manual-tip'; const st = document.createElement('b'); st.textContent = 'Tip: '; p.appendChild(st); addText(p, b.tip, terms); body.appendChild(p); return; }
      const ul = document.createElement(b.steps ? 'ol' : 'ul');
      (b.steps || b.list || []).forEach((t) => { const li = document.createElement('li'); addText(li, t, terms); ul.appendChild(li); });
      body.appendChild(ul);
    });
    d.appendChild(body);
    return d;
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter((t) => t.length > 0).slice(0, 6);
    clear.classList.toggle('hidden', !q);
    list.textContent = '';
    if (!terms.length) {
      DATA.forEach((sec) => list.appendChild(build(sec, [], false)));
      count.textContent = DATA.length + ' topics. Type above to search, or click a topic to open it.';
      return;
    }
    // every word must appear somewhere in the topic; title and keyword hits rank first
    const hits = full.filter((f) => terms.every((t) => f.text.includes(t)))
      .map((f) => ({ f: f, score: terms.reduce((n, t) => n + (f.title.includes(t) ? 3 : 0) + (f.words.includes(t) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score);
    hits.forEach((h) => list.appendChild(build(h.f.sec, terms, true)));
    if (!hits.length) {
      const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Nothing in the manual matches "' + input.value.trim() + '". Try a shorter or different word.';
      list.appendChild(p);
    }
    count.textContent = hits.length ? hits.length + (hits.length === 1 ? ' topic matches.' : ' topics match.') : 'No matches.';
  }
  function show(manual) {
    pane.classList.toggle('hidden', !manual);
    about.classList.toggle('hidden', manual);
    tabAbout.classList.toggle('on', !manual); tabManual.classList.toggle('on', manual);
    tabAbout.setAttribute('aria-selected', String(!manual)); tabManual.setAttribute('aria-selected', String(manual));
    if (manual) { render(); input.focus(); }
  }
  tabAbout.addEventListener('click', () => show(false));
  tabManual.addEventListener('click', () => show(true));
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); e.preventDefault(); input.value = ''; render(); } });
  clear.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
  // always open on the About tab with a fresh search
  const aboutBtn = $('aboutBtn');
  if (aboutBtn) aboutBtn.addEventListener('click', () => { input.value = ''; show(false); });
  window.hubManual = { open: (id) => { show(true); const d = id && $('manual-' + id); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } } };
})();
