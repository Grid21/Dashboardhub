'use strict';
// LAN scanner. Runs in the app's background process (never inside a web panel).
//
// What it does, in plain words:
//   1. Knocks on a few common ports and sends a ping to every address in your
//      network, so every machine that is switched on answers or shows up.
//   2. Reads the computer's own list of nearby devices (the "ARP table") to get
//      each machine's MAC address.
//   3. Checks each machine for open ports, reads the greeting some services send
//      (SSH, web servers) and looks the MAC address up in a maker table.
//   4. Makes an educated guess whether it is Windows, Linux, Apple or a network device.
//
// It only ever talks to addresses inside private home/office ranges, and it
// never sends anything except normal connection attempts and pings.

const net = require('net');
const tls = require('tls');
const os = require('os');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const discovery = require('./discovery');

// ---------- port lists ----------
const SERVICES = {
  21: 'FTP', 22: 'SSH', 873: 'rsync (file sharing)', 3260: 'iSCSI (storage)', 5005: 'WebDAV (file sharing)', 5006: 'WebDAV, secure (file sharing)', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 81: 'HTTP', 110: 'POP3', 111: 'RPC',
  135: 'Windows RPC', 139: 'NetBIOS', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB (file sharing)',
  465: 'SMTPS', 514: 'Syslog', 515: 'Printer (LPD)', 548: 'AFP (Apple file sharing)', 554: 'RTSP (camera stream)',
  587: 'SMTP', 631: 'Printer (IPP)', 993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS proxy', 1433: 'SQL Server',
  1521: 'Oracle DB', 1723: 'VPN (PPTP)', 1883: 'MQTT', 2049: 'NFS', 2375: 'Docker API', 3000: 'Web app',
  3001: 'Uptime Kuma / web app', 3306: 'MySQL', 3389: 'Remote Desktop', 5000: 'Synology DSM / web app',
  5001: 'Synology DSM (HTTPS)', 5432: 'PostgreSQL', 5555: 'Android debug', 5900: 'VNC', 5985: 'Windows remote (WinRM)',
  6379: 'Redis', 7878: 'Radarr', 8006: 'Proxmox', 8080: 'Web (alt)', 8081: 'Web (alt)', 8096: 'Jellyfin',
  8123: 'Home Assistant', 8200: 'Web (alt)', 8384: 'Syncthing', 8443: 'HTTPS (alt)', 8888: 'Web (alt)',
  8989: 'Sonarr', 9000: 'Portainer / web app', 9090: 'Web (alt)', 9091: 'Transmission', 9100: 'Printer (raw)',
  9443: 'Portainer (HTTPS)', 19999: 'Netdata', 32400: 'Plex', 62078: 'Apple iPhone/iPad sync',
  943: 'OpenVPN Access Server', 1194: 'OpenVPN', 1880: 'Node-RED', 2376: 'Docker API (TLS)', 3002: 'Web app', 4533: 'Navidrome',
  5055: 'Overseerr', 5173: 'Web app (dev)', 5230: 'Memos', 5601: 'Kibana', 5678: 'n8n', 6767: 'Bazarr', 7474: 'Neo4j', 8082: 'Web (alt)',
  8083: 'Web (alt)', 8085: 'Web (alt)', 8086: 'InfluxDB', 8088: 'Web (alt)', 8090: 'Web (alt)', 8112: 'Deluge', 8181: 'Tautulli',
  8686: 'Lidarr', 8787: 'Readarr', 8920: 'Jellyfin (HTTPS)', 9001: 'Portainer agent / web app', 9117: 'Jackett', 9200: 'Elasticsearch',
  9696: 'Prowlarr', 10000: 'Webmin', 28080: 'Web (alt)'
};

const QUICK_PORTS = Object.keys(SERVICES).map(Number).sort((a, b) => a - b);
const THOROUGH_PORTS = (() => {
  const set = new Set(QUICK_PORTS);
  for (let p = 1; p <= 1024; p++) set.add(p);
  return Array.from(set).sort((a, b) => a - b);
})();

// Ports used only to find out who is alive
const DISCOVERY_PORTS = [80, 443, 22, 445, 135, 139, 3389, 8080, 62078, 53];

const HTTP_PORTS = new Set([1880, 3002, 4533, 5055, 5173, 5230, 5601, 5678, 6767, 7474, 8082, 8083, 8085, 8086, 8088, 8090, 8112, 8181, 8686, 8787, 9001, 9117, 9200, 9696, 10000, 28080, 80, 81, 3000, 3001, 5000, 7878, 8000, 8008, 8080, 8081, 8096, 8123, 8200, 8384, 8888, 8989, 9000, 9090, 9091, 19999, 32400]);
const HTTPS_PORTS = new Set([443, 5001, 8006, 8443, 8920, 9443]);

const IOT_VENDORS = /govee|intellirocks|espressif|tuya|shelly|allterco|sonoff|itead|signify|philips lighting|lifx|wyze|ring llc|nest labs|ecobee|sonos|roku|amazon tech|blink by amazon|meross|yeelight|broadlink|irobot|roborock|ecovacs|nanoleaf|lutron|eufy|\barlo\b|chamberlain|smartthings|azurewave|wiz connected|wiz iot|homewizard|leviton|osram|ledvance|gosund|teckin|\biot\b|smart ?home|smart plug/i;
const SWITCH_VENDORS = /hpe|hewlett|aruba|procurve|cisco|netgear|tp-?link|ubiquiti|ubnt|d-link|zyxel|mikrotik|juniper|dell|extreme|brocade|ruckus|linksys|tenda|trendnet|engenius|allied telesis|mercusys|alcatel|h3c|ruijie|planet technology|moxa|hirschmann|edge-?core/i;
const PRINTER_VENDORS = /epson|seiko epson|canon|brother industries|xerox|lexmark|ricoh|kyocera|konica|minolta|oki data|okidata|toshiba tec|sharp|pantum|zebra tech|dymo|fujifilm business|develop|utax|olivetti|samsung electronics.*print/i;
const PRINTER_TEXT = /printer|laserjet|officejet|deskjet|photosmart|designjet|\benvy\b|ecotank|workforce|expression (home|premium|photo)|pixma|imageclass|imagerunner|maxify|selphy|mfc-?\w+|dcp-?\w+|hl-?l?\d{3,4}|bizhub|aficio|\bmfp\b|\bepson\b|\bpsc\d|\bet-\d{4}|\bxp-\d{3,4}/i;
const CONSOLE_VENDORS = /nintendo|sony interactive|sony computer entertainment|\bvalve corporation/i;
const CONSOLE_TEXT = /xbox|playstation|\bps[345]\b|nintendo|steamdeck|steam deck|steamos/i;
const SWITCH_TEXT = /\bswitch\b|officeconnect|procurve|jetstream|smart managed|easy smart|web smart|instant on|catalyst|edgeswitch|unifi switch|\busw\b|\b(gs|sg|sf|dgs|des|gs1900|cbs|css|crs)-?\d{2,4}[a-z]*\b|\b(1920s?|1820|2530|2930|2540|1910|1810|1950)\b/i;
const PHONE_VENDORS = /samsung|xiaomi|oneplus|oppo|vivo|realme|huawei|honor|motorola|google|nothing technology|tecno|infinix|zte/i;
const WINDOWS_PORTS = new Set([135, 139, 3389, 5985]);

const NETWORK_VENDORS = /ubiquiti|tp-?link|netgear|cisco|mikrotik|linksys|d-link|zyxel|aruba|ruckus|juniper|fortinet|sagemcom|arris|technicolor|actiontec|eero|huawei|zte|netcomm|belkin|tenda|sercomm|calix|ubnt|meraki|asus(tek)?|fritz|avm|draytek|peplink|openwrt/i;
const NAS_VENDORS = /synology|qnap|asustor|terramaster|western digital/i;

// ---------- small helpers ----------
function ipToInt(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function isAllowedAddress(n) {
  return (n >>> 24) === 10 ||                       // 10.0.0.0/8
         (n >>> 20) === 0xAC1 ||                    // 172.16.0.0/12
         (n >>> 16) === 0xC0A8 ||                   // 192.168.0.0/16
         (n >>> 16) === 0xA9FE ||                   // 169.254.0.0/16
         (n >>> 24) === 127;                        // this computer (used for testing)
}

// "192.168.0.0/24" -> list of addresses. Only private ranges and at most 1022 hosts.
function parseCidr(text) {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})\s*$/.exec(String(text || ''));
  if (!m) return { ok: false, error: 'Enter the network like 192.168.0.0/24' };
  const addr = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (addr === null) return { ok: false, error: 'That is not a valid address.' };
  if (prefix < 22 || prefix > 32) return { ok: false, error: 'The network size must be between /22 and /32 (up to about 1000 machines).' };
  const size = Math.pow(2, 32 - prefix);
  const base = Math.floor(addr / size) * size;
  if (!isAllowedAddress(base) || !isAllowedAddress(base + size - 1)) {
    return { ok: false, error: 'For safety only private home/office networks can be scanned (192.168.x.x, 10.x.x.x, 172.16-31.x.x).' };
  }
  const hosts = [];
  const first = prefix >= 31 ? base : base + 1;
  const last = prefix >= 31 ? base + size - 1 : base + size - 2;
  for (let n = first; n <= last; n++) hosts.push(intToIp(n));
  return { ok: true, cidr: intToIp(base) + '/' + prefix, base: base, prefix: prefix, hosts: hosts };
}

function normalizeMac(text) {
  const parts = String(text).toLowerCase().split(/[:-]/);
  if (parts.length !== 6) return null;
  const out = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,2}$/.test(p)) return null;
    out.push(p.length === 1 ? '0' + p : p);
  }
  return out.join(':');
}

function isUsableMac(mac) {
  if (!mac) return false;
  if (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') return false;
  return (parseInt(mac.slice(0, 2), 16) & 1) === 0;   // multicast addresses are not machines
}

function cleanText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 100);
}

function limiter(max) {
  let active = 0;
  const queue = [];
  function pump() {
    while (active < max && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(job.fn).then(job.resolve, job.reject).then(() => { active--; pump(); });
    }
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a program and collect its output. Never throws; never shows a console window.
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    const finish = (ok) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: ok, stdout: out }); } };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } finish(false); }, timeoutMs || 4000);
    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { finish(false); return; }
    child.stdout.on('data', (d) => { if (out.length < 200000) out += d.toString('utf8'); });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

// ---------- reading the computer's own network tables ----------
// Understands "arp -a" (Windows), "ip neigh" and /proc/net/arp (Linux), "arp -an" (Mac).
function parseArp(text) {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/\b(FAILED|INCOMPLETE)\b/i.test(line)) continue;
    const m = /(?:^|[\s(])(\d{1,3}(?:\.\d{1,3}){3})(?=[\s)]).*?(?:^|[\s])([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})(?=\s|$)/i.exec(line);
    if (!m) continue;
    if (ipToInt(m[1]) === null) continue;
    const mac = normalizeMac(m[2]);
    if (!isUsableMac(mac)) continue;
    map.set(m[1], mac);
  }
  return map;
}

async function readArpTable() {
  const map = new Map();
  const merge = (m) => { m.forEach((mac, ip) => map.set(ip, mac)); };
  if (process.platform === 'win32') {
    const r = await run('arp', ['-a'], 5000);
    if (r.stdout) merge(parseArp(r.stdout));
  } else if (process.platform === 'linux') {
    const r = await run('ip', ['neigh', 'show'], 5000);
    if (r.stdout) merge(parseArp(r.stdout));
    if (map.size === 0) {
      try { merge(parseArp(fs.readFileSync('/proc/net/arp', 'utf8').split('\n').filter((l) => !/\s0x0\s/.test(l)).join('\n'))); } catch (e) { /* not available */ }
    }
  } else {
    const r = await run('arp', ['-an'], 5000);
    if (r.stdout) merge(parseArp(r.stdout));
  }
  return map;
}

function parseGateway(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    let m = /^default\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(line.trim());            // Linux: ip route
    if (m) return m[1];
    m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(line);           // Windows: route print
    if (m) return m[1];
    m = /^\s*gateway:\s*(\d{1,3}(?:\.\d{1,3}){3})/i.exec(line);                          // Mac: route get default
    if (m) return m[1];
  }
  return null;
}

async function detectGateway() {
  let r;
  if (process.platform === 'win32') r = await run('route', ['print', '-4', '0.0.0.0'], 5000);
  else if (process.platform === 'linux') r = await run('ip', ['route', 'show', 'default'], 5000);
  else r = await run('route', ['-n', 'get', 'default'], 5000);
  const gw = r.stdout ? parseGateway(r.stdout) : null;
  if (gw) return gw;
  if (process.platform === 'linux') {
    try {
      for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f[1] === '00000000' && f[2]) {
          const n = parseInt(f[2], 16);       // stored in little-endian order
          return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join('.');
        }
      }
    } catch (e) { /* not available */ }
  }
  return null;
}

function prefixFromMask(mask) {
  const n = ipToInt(mask);
  if (n === null) return 24;
  let bits = 0;
  for (let i = 31; i >= 0; i--) { if ((n >>> i) & 1) bits++; else break; }
  return bits;
}

// The networks this computer is connected to
function listInterfaces() {
  const out = [];
  const all = os.networkInterfaces();
  for (const name of Object.keys(all)) {
    for (const a of all[name] || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const n = ipToInt(a.address);
      if (n === null || !isAllowedAddress(n)) continue;
      let prefix = prefixFromMask(a.netmask);
      let trimmed = false;
      if (prefix < 22) { prefix = 24; trimmed = true; }   // huge networks: scan the neighbourhood only
      const parsed = parseCidr(a.address + '/' + prefix);
      if (!parsed.ok) continue;
      const vm = /(?:\.|vlan[ _-]?|\bvl)(\d{1,4})\)?$/i.exec(name);
      const vlan = vm && Number(vm[1]) >= 1 && Number(vm[1]) <= 4094 ? Number(vm[1]) : null;
      out.push({ name: name, address: a.address, mac: normalizeMac(a.mac || ''), cidr: parsed.cidr, trimmed: trimmed, vlan: vlan });
    }
  }
  return out;
}

// ---------- file shares ----------
// Asks one machine which shares it offers WITHOUT a login (SMB: Windows "net view", macOS "smbutil", Linux "smbclient"; NFS: "showmount").
// Many machines only list their shares to a signed-in user; then this says so instead of guessing.
function runFull(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    let child;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(Object.assign({ stdout: out, stderr: err }, r)); } };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } finish({ code: null, timeout: true }); }, timeoutMs || 12000);
    try { child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { finish({ code: null, missing: true }); return; }
    child.stdout.on('data', (d) => { if (out.length < 200000) out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (err.length < 20000) err += d.toString('utf8'); });
    child.on('error', (e) => finish({ code: null, missing: e && e.code === 'ENOENT' }));
    child.on('close', (code) => finish({ code: code }));
  });
}
const cleanShare = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
function parseNetView(text) {          // Windows: "Share name  Type  Used as  Comment"
  const out = [];
  let on = false;
  String(text).split(/\r?\n/).forEach((line) => {
    if (/^-{5,}/.test(line)) { on = true; return; }
    if (!on || !line.trim() || /^The command completed/i.test(line)) return;
    const m = /^(\S.*?)\s{2,}(Disk|Print|IPC)\b\s*(?:\s{2,}(?:\S+\s{2,})?(.*))?$/i.exec(line.trim().length ? line : '');
    if (m) out.push({ name: cleanShare(m[1], 80), type: m[2], comment: cleanShare(m[3], 120), proto: 'SMB' });
  });
  return out;
}
function parseSmbutil(text) {          // macOS: "Share  Type  Comments"
  const out = [];
  let on = false;
  String(text).split(/\r?\n/).forEach((line) => {
    if (/^-{5,}/.test(line)) { on = true; return; }
    if (!on || !line.trim() || /shares? listed/i.test(line)) return;
    const m = /^(\S.*?)\s{2,}(Disk|Printer|Print|Pipe|IPC)\b\s*(.*)$/i.exec(line.trim());
    if (m) out.push({ name: cleanShare(m[1], 80), type: m[2] === 'Print' || m[2] === 'Printer' ? 'Print' : m[2], comment: cleanShare(m[3], 120), proto: 'SMB' });
  });
  return out;
}
function parseSmbclientG(text) {       // Linux "smbclient -g": Disk|name|comment
  const out = [];
  String(text).split(/\r?\n/).forEach((line) => {
    const m = /^(Disk|Printer|IPC)\|([^|]*)\|(.*)$/.exec(line.trim());
    if (m) out.push({ name: cleanShare(m[2], 80), type: m[1] === 'Printer' ? 'Print' : m[1], comment: cleanShare(m[3], 120), proto: 'SMB' });
  });
  return out;
}
function parseShowmount(text) {        // "Export list for host:" then "/path   clients"
  const out = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (i === 0 && /export list/i.test(line)) return;
    const m = /^(\/\S*)\s*(.*)$/.exec(line.trim());
    if (m) out.push({ name: cleanShare(m[1], 120), type: 'Disk', comment: cleanShare(m[2], 120), proto: 'NFS' });
  });
  return out;
}
async function listShares(ip, options) {
  if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { ok: false, error: 'That is not a valid address.' };
  const n = ipToInt(ip);
  if (n === null || !isAllowedAddress(n)) return { ok: false, error: 'Only machines on your own network can be asked.' };
  const platform = (options && options.platform) || process.platform;
  const notes = [];
  let shares = [];
  let smbAsked = false;
  const smbFail = (r, tool) => {
    const t = (r.stdout + ' ' + r.stderr);
    if (/access is denied|system error 5\b|NT_STATUS_ACCESS_DENIED|NT_STATUS_LOGON_FAILURE|NT_STATUS_ACCOUNT_DISABLED|authentication|logon failure|Permission denied|not allowed/i.test(t)) notes.push('SMB: this machine only lists its shares to a signed-in user, so none can be shown here.');
    else if (/system error 53|system error 67|network path was not found|NT_STATUS_HOST_UNREACHABLE|NT_STATUS_CONNECTION_REFUSED|NT_STATUS_IO_TIMEOUT|Connection to .* failed|could not be reached|refused/i.test(t)) notes.push('SMB: the machine did not answer on its file-sharing port.');
    else notes.push('SMB: ' + tool + ' did not return a share list.');
  };
  if (platform === 'win32') {
    const r = await runFull('net', ['view', '\\\\' + ip], 15000);
    smbAsked = true;
    const l = parseNetView(r.stdout);
    if (l.length) shares = shares.concat(l.filter((s) => s.type !== 'IPC')); else if (r.missing) notes.push('SMB: the "net" tool is missing on this computer.'); else smbFail(r, 'Windows');
  } else if (platform === 'darwin') {
    const r = await runFull('smbutil', ['view', '-N', '//guest@' + ip], 15000);
    smbAsked = true;
    const l = parseSmbutil(r.stdout);
    if (l.length) shares = shares.concat(l.filter((s) => s.type !== 'IPC' && s.type !== 'Pipe')); else if (r.missing) notes.push('SMB: the "smbutil" tool is missing on this computer.'); else smbFail(r, 'macOS');
  } else {
    const r = await runFull('smbclient', ['-L', '//' + ip, '-N', '-g'], 15000);
    if (r.missing) notes.push('SMB: to list shares on Linux, install the "smbclient" package.');
    else {
      smbAsked = true;
      const l = parseSmbclientG(r.stdout);
      if (l.length) shares = shares.concat(l.filter((s) => s.type !== 'IPC')); else smbFail(r, 'smbclient');
    }
  }
  const nf = await runFull('showmount', ['-e', ip], 12000);
  const nl = parseShowmount(nf.stdout);
  if (nl.length) shares = shares.concat(nl);
  else if (!nf.missing && /rpc|timed out|refused|unable|can't|cannot/i.test(nf.stdout + nf.stderr)) notes.push('NFS: nothing was listed (the machine may not offer NFS).');
  return { ok: true, shares: shares.slice(0, 60), notes: notes, asked: smbAsked || !nf.missing };
}

// ---------- Wake-on-LAN ----------
// The "magic packet": 6 bytes of 0xFF, then the machine's hardware address 16 times. It is sent as a UDP broadcast
// (ports 9 and 7) out of every network card on a private network, so it reaches the machine whichever one it is on.
function magicPacket(mac) {
  const m = normalizeMac(mac);
  if (!m) return null;
  const bytes = Buffer.from(m.split(':').map((h) => parseInt(h, 16)));
  return Buffer.concat([Buffer.alloc(6, 0xff)].concat(Array.from({ length: 16 }, () => bytes)));
}
function broadcastOf(address, netmask) {
  const a = ipToInt(address), m = ipToInt(netmask);
  if (a === null || m === null) return null;
  const b = ((a | (~m >>> 0)) >>> 0);
  return [(b >>> 24) & 255, (b >>> 16) & 255, (b >>> 8) & 255, b & 255].join('.');
}
// macs: list of hardware addresses. options.targets (tests only): [{ from, to, port }] instead of the real network cards.
async function wakeOnLan(macs, options) {
  const dgram = require('dgram');
  const packets = (Array.isArray(macs) ? macs : []).slice(0, 100).map((m) => ({ mac: m, packet: magicPacket(m) }));
  const good = packets.filter((p) => p.packet);
  const bad = packets.length - good.length;
  if (!good.length) return { ok: false, error: 'No valid hardware (MAC) address to wake.', sent: 0, bad: bad };
  let targets = options && Array.isArray(options.targets) ? options.targets : null;
  if (!targets) {
    targets = [];
    const all = os.networkInterfaces();
    for (const name of Object.keys(all)) {
      for (const a of all[name] || []) {
        if (a.family !== 'IPv4' && a.family !== 4) continue;
        if (a.internal) continue;
        const n = ipToInt(a.address);
        if (n === null || !isAllowedAddress(n)) continue;
        const b = broadcastOf(a.address, a.netmask);
        if (!b) continue;
        for (const port of [9, 7]) { targets.push({ from: a.address, to: b, port: port }); targets.push({ from: a.address, to: '255.255.255.255', port: port }); }
      }
    }
  }
  if (!targets.length) return { ok: false, error: 'This computer is not on a network that can send a wake-up signal.', sent: 0, bad: bad };
  let sent = 0;
  const byFrom = new Map();
  targets.forEach((t) => { if (!byFrom.has(t.from)) byFrom.set(t.from, []); byFrom.get(t.from).push(t); });
  for (const [from, list] of byFrom) {
    await new Promise((resolve) => {
      const sock = dgram.createSocket('udp4');
      let left = 0;
      const done = () => { try { sock.close(); } catch (e) { /* closed */ } resolve(); };
      sock.on('error', done);
      sock.bind(0, from, () => {
        try { sock.setBroadcast(true); } catch (e) { /* ignore */ }
        list.forEach((t) => good.forEach((p) => {
          left++;
          sock.send(p.packet, t.port, t.to, (err) => { if (!err) sent++; if (--left === 0) done(); });
        }));
        if (left === 0) done();
      });
    });
  }
  return sent > 0 ? { ok: true, sent: good.length, bad: bad } : { ok: false, error: 'The wake-up signal could not be sent (no network card accepted it).', sent: 0, bad: bad };
}

// How fast this computer's own network links are right now (Mbps), by adapter name. Never throws.
async function linkSpeeds() {
  const out = {};
  const names = Object.keys(os.networkInterfaces());
  try {
    if (process.platform === 'linux') {
      for (const n of names) {
        if (!/^[A-Za-z0-9_.:-]{1,20}$/.test(n)) continue;
        let v = NaN;
        try { v = Number(fs.readFileSync('/sys/class/net/' + n + '/speed', 'utf8')); } catch (e) { /* not a cabled adapter */ }
        if (Number.isFinite(v) && v > 0) { out[n] = { mbps: v, wireless: false }; continue; }
        const r = await run('iw', ['dev', n, 'link'], 3000);
        const m = r.stdout && /tx bitrate:\s*([\d.]+)\s*MBit\/s/i.exec(r.stdout);
        if (m) out[n] = { mbps: Math.round(Number(m[1])), wireless: true };
      }
    } else if (process.platform === 'win32') {
      const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { $_.Name + '|' + $_.LinkSpeed + '|' + $_.PhysicalMediaType }"], 8000);
      (r.stdout || '').split(/\r?\n/).forEach((line) => {
        const p = line.split('|');
        const m = p.length >= 2 && /([\d.]+)\s*(G|M|K)bps/i.exec(p[1]);
        if (!m) return;
        const mb = Number(m[1]) * (/g/i.test(m[2]) ? 1000 : /k/i.test(m[2]) ? 0.001 : 1);
        if (mb > 0) out[p[0].trim()] = { mbps: Math.round(mb), wireless: /802\.11|native|wireless|wi-?fi/i.test(p[2] || '') || /wi-?fi|wireless/i.test(p[0]) };
      });
    }
  } catch (e) { /* the speed simply stays unknown */ }
  return out;
}

// VPN adapters on THIS computer (WireGuard, OpenVPN, Tailscale, ZeroTier...). Other machines' VPNs
// that only speak UDP (like WireGuard) cannot be seen by a scan: they simply do not answer.
const VPN_NAME_RE = /^(wg\d*|wg-.+|wireguard.*|tun\d+|tap\d+|utun\d+|tailscale\d*|zt.+|ppp\d+|nordlynx|proton\d*|mullvad.*|ovpn.*|openvpn.*)$|wireguard|openvpn|tap-windows|wintun|tailscale|zerotier|nordlynx|protonvpn|mullvad|wan miniport \(.*vpn/i;
function vpnInterfaces() {
  const out = [];
  const all = os.networkInterfaces();
  for (const name of Object.keys(all)) {
    if (!VPN_NAME_RE.test(name)) continue;
    if (!(all[name] || []).some((a) => (a.family === 'IPv4' || a.family === 4) && !a.internal)) continue;
    let kind = 'VPN';
    if (/^wg|wireguard|nordlynx/i.test(name)) kind = 'WireGuard';
    else if (/tailscale/i.test(name)) kind = 'Tailscale';
    else if (/^zt|zerotier/i.test(name)) kind = 'ZeroTier';
    else if (/openvpn|^tun|^tap|tap-windows|ovpn|wintun/i.test(name)) kind = 'OpenVPN / tunnel';
    out.push(cleanText(kind + ' (' + name + ')', 40));
  }
  return out.slice(0, 6);
}

// ---------- MAC address makers ----------
let ouiTable = null;
function loadOui() {
  if (ouiTable) return ouiTable;
  try {
    ouiTable = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor', 'oui.json'), 'utf8'));
  } catch (e) {
    ouiTable = {};
  }
  return ouiTable;
}

function vendorFor(mac) {
  if (!mac) return null;
  const key = mac.replace(/:/g, '').slice(0, 6).toUpperCase();
  const name = loadOui()[key];
  if (name) return cleanText(name, 60);
  // second bit of the first byte set = made-up address (phones hide behind these, and virtual machines use them)
  if ((parseInt(mac.slice(0, 2), 16) & 2) !== 0) return 'Private / randomized address';
  return null;
}

// ---------- probing ----------
function tcpProbe(ip, port, timeout) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (r) => { if (!done) { done = true; s.destroy(); resolve(r); } };
    s.setTimeout(timeout);
    s.once('connect', () => fin('open'));
    s.once('timeout', () => fin('none'));
    s.once('error', (e) => fin(e && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET') ? 'closed' : 'none'));
    try { s.connect(port, ip); } catch (e) { fin('none'); }
  });
}

function parseTtl(text, ip) {
  const escaped = String(ip).replace(/\./g, '\\.');
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!new RegExp(escaped).test(line)) continue;
    const m = /ttl[=:\s]\s*(\d{1,3})/i.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

async function pingHost(ip) {
  let args;
  if (process.platform === 'win32') args = ['-n', '1', '-w', '1000', ip];
  else if (process.platform === 'darwin') args = ['-c', '1', '-W', '1000', ip];
  else args = ['-c', '1', '-W', '1', ip];
  const r = await run('ping', args, 3000);
  return r.stdout ? parseTtl(r.stdout, ip) : null;
}

// Read the first thing a service says (SSH greeting, web server name and page title)
function grabInfo(ip, port) {
  return new Promise((resolve) => {
    const isHttps = HTTPS_PORTS.has(port);
    const isHttp = HTTP_PORTS.has(port);
    let buf = '';
    let done = false;
    let sock;
    const fin = () => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) { /* ignore */ }
      const info = {};
      if (port === 22 || /^SSH-/.test(buf)) {
        const m = /^(SSH-[^\r\n]*)/.exec(buf);
        if (m) info.banner = cleanText(m[1], 100);
      } else if (/^HTTP\//.test(buf)) {
        const server = /^server:\s*([^\r\n]*)/im.exec(buf);
        const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(buf);
        if (server) info.banner = cleanText(server[1], 80);
        if (title) info.title = cleanText(title[1], 80);
      }
      resolve(info);
    };
    const timer = setTimeout(fin, 1500);
    const onData = (d) => {
      buf += d.toString('latin1');
      if (buf.length > 6000 || (port === 22 && /\n/.test(buf)) || /<\/title>/i.test(buf)) { clearTimeout(timer); fin(); }
    };
    const onReady = () => {
      if (isHttp || isHttps) sock.write('GET / HTTP/1.0\r\nHost: ' + ip + '\r\nUser-Agent: DashboardHub\r\nConnection: close\r\n\r\n');
    };
    try {
      if (isHttps) {
        sock = tls.connect({ host: ip, port: port, rejectUnauthorized: false, timeout: 1500 }, onReady);
      } else {
        sock = net.connect({ host: ip, port: port, timeout: 1500 }, onReady);
      }
      sock.on('data', onData);
      sock.on('error', () => { clearTimeout(timer); fin(); });
      sock.on('timeout', () => { clearTimeout(timer); fin(); });
      sock.on('close', () => { clearTimeout(timer); fin(); });
    } catch (e) { clearTimeout(timer); fin(); }
  });
}

async function reverseName(ip) {
  try {
    const names = await Promise.race([dns.promises.reverse(ip), sleep(1500).then(() => [])]);
    if (names && names[0]) return cleanText(names[0].replace(/\.$/, ''), 80);
  } catch (e) { /* no name */ }
  return null;
}

// ---------- Windows or Linux? ----------
function guessOs(host, routerIp) {
  const score = { windows: 0, linux: 0, apple: 0, android: 0, iot: 0, console: 0, printer: 0, switch: 0, network: 0 };
  const why = { windows: [], linux: [], apple: [], android: [], iot: [], console: [], printer: [], switch: [], network: [] };
  const add = (k, n, reason) => { score[k] += n; why[k].push(reason); };
  const open = new Set((host.ports || []).map((p) => p.port));
  const vendor = host.vendor || '';

  if (host.ttl) {
    if (host.ttl <= 64) add('linux', 2, 'replies like Linux/Unix (ping TTL ' + host.ttl + ')');
    else if (host.ttl <= 128) add('windows', 3, 'replies like Windows (ping TTL ' + host.ttl + ')');
    else add('network', 3, 'replies like a router/switch (ping TTL ' + host.ttl + ')');
  }
  let winPorts = 0;
  for (const p of WINDOWS_PORTS) if (open.has(p)) winPorts++;
  if (winPorts) add('windows', Math.min(winPorts, 2) * 2, 'Windows services open (' + Array.from(WINDOWS_PORTS).filter((p) => open.has(p)).join(', ') + ')');
  if (open.has(445)) add('windows', 1, 'file sharing (SMB) is open');
  if (open.has(22)) add('linux', 1, 'SSH is open');
  if (open.has(9100)) add('printer', 6, 'raw printing port (9100) is open');
  if (open.has(631)) add('printer', 4, 'network printing (IPP, 631) is open');
  if (open.has(515)) add('printer', 3, 'old-style printing (LPD, 515) is open');
  if (open.has(62078)) add('apple', 5, 'Apple device sync port is open');
  if (open.has(548)) add('apple', 2, 'Apple file sharing is open');
  if (open.has(5555)) add('android', 4, 'Android debug port is open');
  if (open.has(8008) || open.has(8009)) add('iot', 3, 'Google Cast port is open (Chromecast / smart speaker style device)');
  for (const p of [6668, 1883, 8883, 9999, 55443, 38899, 4403]) if (open.has(p)) { add('iot', 3, 'smart-home service port open (' + p + ')'); break; }

  for (const p of host.ports || []) {
    const text = ((p.banner || '') + ' ' + (p.title || '')).toLowerCase();
    if (!text) continue;
    if (/windows|microsoft|iis/.test(text)) add('windows', 5, 'service says it is Windows (' + p.port + ')');
    if (/ubuntu|debian|raspbian|fedora|centos|rocky|alma|alpine|linux|freebsd|arch/.test(text)) add('linux', 4, 'service says it is Linux/Unix (' + p.port + ')');
    else if (/openssh/.test(text) && p.port === 22) add('linux', 1, 'OpenSSH server');
    if (/tasmota|esphome|shelly|tuya|wled|yeelight|sonoff|philips hue|hue bridge|homeassistant|home assistant/.test(text)) add('iot', 4, 'smart-home software (' + p.port + ')');
    if (PRINTER_TEXT.test(text)) add('printer', 5, 'its web page or banner mentions a printer (' + p.port + ')');
    if (SWITCH_TEXT.test(text) && host.ip !== routerIp && !/router|gateway|access point|wireless|nintendo/.test(text)) add('switch', 6, 'its web page or banner mentions a switch (' + p.port + ')');
    if (/android/.test(text)) add('android', 5, 'service says it is Android (' + p.port + ')');
    if (/dropbear|openwrt|routeros|mikrotik|ubnt|unifi/.test(text)) add('network', 3, 'router-style software (' + p.port + ')');
    if (/synology|qnap|truenas|proxmox|unraid|openmediavault/.test(text)) add('linux', 3, 'storage/server software (' + p.port + ')');
  }

  if (/apple/i.test(vendor)) add('apple', 3, 'made by Apple');
  if (host.ttl && host.ttl <= 64 && PHONE_VENDORS.test(vendor) && !open.has(8008) && !open.has(8009) && !open.has(22) && !open.has(445) && !open.has(62078)) add('android', 3, 'phone/tablet maker (' + vendor + ') and no PC-style services');
  if (PRINTER_VENDORS.test(vendor)) add('printer', (open.has(9100) || open.has(631) || open.has(515)) ? 4 : 2, 'printer maker (' + vendor + ')');
  if (PRINTER_TEXT.test(host.hostname || '') && host.ip !== routerIp) add('printer', 5, 'its name looks like a printer (' + host.hostname + ')');
  const consoleMaker = CONSOLE_VENDORS.test(vendor) || /nintendo/i.test(host.hostname || '');
  if (SWITCH_TEXT.test(host.hostname || '') && host.ip !== routerIp && !consoleMaker) add('switch', 5, 'its name mentions a switch');
  if (/officeconnect|procurve/i.test(vendor + ' ' + (host.hostname || '')) && host.ip !== routerIp) add('switch', 6, 'HPE OfficeConnect/ProCurve switch');
  if (SWITCH_VENDORS.test(vendor) && open.has(161) && host.ip !== routerIp) add('switch', 4, 'network gear maker with SNMP (' + vendor + ')');
  if (SWITCH_VENDORS.test(vendor) && score.switch > 0) add('switch', 2, 'network gear maker (' + vendor + ')');
  if (IOT_VENDORS.test(vendor) && !open.has(445) && !open.has(3389) && !open.has(62078)) add('iot', 5, 'smart-device maker (' + vendor + ')');
  if (/raspberry/i.test(vendor)) add('linux', 4, 'Raspberry Pi');
  if (NAS_VENDORS.test(vendor)) add('linux', 3, 'storage device maker (' + vendor + ')');
  if (NETWORK_VENDORS.test(vendor)) add('network', 3, 'network equipment maker (' + vendor + ')');
  if (CONSOLE_VENDORS.test(vendor) && !open.has(445) && !open.has(3389) && !open.has(22) && host.ip !== routerIp) add('console', 6, 'game console maker (' + vendor + ')');
  if (CONSOLE_TEXT.test(host.hostname || '') && host.ip !== routerIp) add('console', /microsoft/i.test(vendor) ? 8 : 5, 'its name looks like a game console (' + host.hostname + ')');
  if (/microsoft/i.test(vendor) && !/hyper/i.test(vendor) && !(CONSOLE_TEXT.test(host.hostname || ''))) add('windows', 2, 'made by Microsoft');
  if (routerIp && host.ip === routerIp) add('network', 4, 'this is your router');
  if (host.self) {
    const mine = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'apple' : 'linux';
    add(mine, 10, 'this is the computer running Dashboard Hub');
  }

  const order = ['windows', 'linux', 'apple', 'android', 'iot', 'console', 'printer', 'switch', 'network'];
  let best = 'unknown';
  let bestScore = 0;
  let second = 0;
  for (const k of order) {
    if (score[k] > bestScore) { second = bestScore; bestScore = score[k]; best = k; }
    else if (score[k] > second) second = score[k];
  }
  if (bestScore < 2) return { id: 'unknown', label: 'Unknown', confidence: 'low', reasons: ['not enough information'] };
  const margin = bestScore - second;
  const confidence = host.self ? 'high' : (bestScore >= 6 && margin >= 3) ? 'high' : (bestScore >= 3 && margin >= 2) ? 'medium' : 'low';
  const labels = { windows: 'Windows', linux: 'Linux / Unix', apple: 'Apple (macOS / iOS)', android: 'Android', iot: 'IoT / smart device', console: 'Game console', printer: 'Printer', switch: 'Switch', network: 'Router / network device' };
  return { id: best, label: labels[best], confidence: confidence, reasons: why[best] };
}

// ---------- the scan ----------
// Which methods noticed this machine (for the machine's details)
function foundVia(ip, info, mac, arp, disc) {
  const via = [];
  if (info && (info.ttl !== null || (info.open && info.open.size > 0) || info.answered)) via.push('Ping / port check');
  if (arp && arp.has(ip)) via.push('ARP table');
  const d = disc && disc.get(ip);
  if (d) d.via.forEach((v) => { if (!via.includes(v)) via.push(v); });
  return via;
}

// options: { cidr, mode: 'quick'|'thorough', router }
// emit(message) is called with progress, host and done messages.
function startScan(options, emit) {
  const parsed = parseCidr(options && options.cidr);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const background = options.mode === 'background';
  const ports = options.mode === 'thorough' ? THOROUGH_PORTS : QUICK_PORTS;
  // machines we already know well: in a background scan their ports are not checked again
  const known = new Set(Array.isArray(options.known) ? options.known.filter((x) => typeof x === 'string') : []);
  const routerIp = ipToInt(options.router) !== null ? options.router : null;
  const loopback = (parsed.base >>> 24) === 127;
  let canceled = false;
  const session = { cancel: () => { canceled = true; } };
  // Which ways of finding machines are allowed (Settings > Security > Finding machines). All on by default.
  const M = Object.assign({ probe: true, mdns: true, ssdp: true, netbios: true, reverseDns: true }, options.methods && typeof options.methods === 'object' ? options.methods : {});
  const testHooks = options.testHooks || {};   // only used by the automatic tests (never passed in from the window)
  // Listening-only discovery starts right away and runs while the other checks work
  const discoveryPromise = (M.mdns || M.ssdp)
    ? discovery.discoverNames(Object.assign({ ms: background ? 1500 : 2300, useMdns: M.mdns, useSsdp: M.ssdp }, testHooks.discovery || {})).catch(() => new Map())
    : Promise.resolve(new Map());

  // A background scan is deliberately gentle: far fewer connections at the same time
  const tcp = limiter(background ? 40 : 200);
  const pings = limiter(background ? 8 : 24);
  const hostsOut = new Map();   // ip -> host record

  const mine = new Map();       // our own addresses
  for (const i of listInterfaces()) mine.set(i.address, i.mac);
  if (loopback) mine.set('127.0.0.1', null);

  async function main() {
    // Phase 1: who is alive?
    emit({ type: 'progress', phase: 'discovery', done: 0, total: parsed.hosts.length, message: 'Looking for machines...' });
    const alive = new Map();    // ip -> { ttl, openPorts:Set, answered }
    let finished = 0;
    await Promise.all(parsed.hosts.map(async (ip) => {
      const info = { ttl: null, open: new Set(), answered: false };
      await Promise.all(!M.probe ? [] : [
        pings(async () => { if (!canceled) info.ttl = await pingHost(ip); }),
        Promise.all(DISCOVERY_PORTS.map((p) => tcp(async () => {
          if (canceled) return;
          const r = await tcpProbe(ip, p, 700);
          if (r === 'open') { info.open.add(p); info.answered = true; }
          else if (r === 'closed') info.answered = true;
        })))
      ]);
      alive.set(ip, info);
      finished++;
      if (finished % 8 === 0 || finished === parsed.hosts.length) {
        emit({ type: 'progress', phase: 'discovery', done: finished, total: parsed.hosts.length, message: 'Looking for machines...' });
      }
    }));
    if (canceled) return;

    const disc = await discoveryPromise;
    let arp = await readArpTable();
    const found = [];
    for (const ip of parsed.hosts) {
      const info = alive.get(ip) || { ttl: null, open: new Set(), answered: false };
      const hasMac = arp.has(ip);
      const isMine = mine.has(ip);
      const answered = info.ttl !== null || info.open.size > 0 || info.answered || (loopback && info.answered);
      if (isMine || answered) {
        found.push(ip);
      } else if (disc.has(ip)) {
        found.push(ip);      // it announced itself (mDNS / SSDP) even though it ignores pings and port checks
      } else if (hasMac && (!M.probe || (!background && !known.has(ip)))) {
        // On initial manual scan, include host if present in ARP so firewalled machines are discovered.
        // A machine the map already knows that no longer answers is NOT kept alive by an old ARP entry (that is how an unplugged switch stayed "online")
        found.push(ip);
      }
    }
    for (const ip of mine.keys()) if (!found.includes(ip) && parsed.hosts.includes(ip)) found.push(ip);

    const toScan = [];
    for (const ip of found) {
      const info = alive.get(ip) || { ttl: null, open: new Set() };
      const mac = arp.get(ip) || mine.get(ip) || null;
      const host = { ip: ip, mac: mac, vendor: vendorFor(mac), hostname: null, ttl: info.ttl, ports: [], self: mine.has(ip), alive: true, scanning: true };
      host.found = foundVia(ip, info, mac, arp, disc);
      host.os = guessOs(host, routerIp);
      hostsOut.set(ip, host);
      if (background && known.has(ip)) {
        // already known: just report that it is still there
        host.scanning = false;
        host.portsSkipped = true;
        emit({ type: 'host', host: host });
      } else {
        toScan.push(ip);
        emit({ type: 'host', host: host });
      }
    }

    // Phase 2: ports, greetings, names
    let hostsDone = 0;
    emit({ type: 'progress', phase: 'ports', done: 0, total: toScan.length, message: 'Checking ports...' });
    const queue = toScan.slice();
    async function worker() {
      while (queue.length && !canceled) {
        const ip = queue.shift();
        const host = hostsOut.get(ip);
        const open = [];
        await Promise.all((M.probe ? ports : []).map((p) => tcp(async () => {
          if (canceled) return;
          if (await tcpProbe(ip, p, 900) === 'open') open.push(p);
        })));
        open.sort((a, b) => a - b);
        const detail = [];
        for (const p of open) {
          const info = (p === 22 || HTTP_PORTS.has(p) || HTTPS_PORTS.has(p)) ? await grabInfo(ip, p) : {};
          detail.push({ port: p, service: SERVICES[p] || null, banner: info.banner || null, title: info.title || null });
        }
        host.ports = detail;
        let nm = host.self ? cleanText(os.hostname(), 80) : (M.reverseDns ? await reverseName(ip) : null);
        const dd = disc.get(ip);
        if (!nm && dd && dd.name) nm = cleanText(dd.name, 80);
        if (!nm && !host.self && M.netbios && (open.includes(139) || open.includes(445) || !M.probe)) {
          const n = await discovery.netbiosName(ip, 900, testHooks.netbiosPort);
          if (n) { nm = cleanText(n, 80); if (!host.found.includes('NetBIOS')) host.found.push('NetBIOS'); }
        }
        host.hostname = nm || null;
        host.os = guessOs(host, routerIp);
        if (host.self) host.vpn = vpnInterfaces();
        host.scanning = false;
        hostsDone++;
        emit({ type: 'host', host: host });
        emit({ type: 'progress', phase: 'ports', done: hostsDone, total: toScan.length, message: 'Checking ports...' });
      }
    }
    await Promise.all(background ? [worker(), worker()] : [worker(), worker(), worker(), worker()]);
    if (canceled) return;

    // The table may have gained entries while we were talking to the machines
    arp = await readArpTable();
    for (const host of hostsOut.values()) {
      if (!host.mac && arp.has(host.ip)) {
        host.mac = arp.get(host.ip);
        host.vendor = vendorFor(host.mac);
        host.os = guessOs(host, routerIp);
        emit({ type: 'host', host: host });
      }
    }
  }

  main().then(
    () => emit({ type: 'done', canceled: canceled, count: hostsOut.size }),
    (e) => emit({ type: 'done', canceled: canceled, count: hostsOut.size, error: String(e && e.message || e) })
  );
  return { ok: true, session: session, cidr: parsed.cidr, total: parsed.hosts.length };
}

module.exports = {
  pingHost, tcpProbe, readArpTable, linkSpeeds, wakeOnLan, magicPacket, listShares, parseNetView, parseSmbutil, parseSmbclientG, parseShowmount,
  startScan, listInterfaces, detectGateway, vpnInterfaces,
  parseCidr, parseArp, parseGateway, parseTtl, guessOs, vendorFor, normalizeMac,
  QUICK_PORTS, THOROUGH_PORTS, SERVICES
};
