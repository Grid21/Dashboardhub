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
