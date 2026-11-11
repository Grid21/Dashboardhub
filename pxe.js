'use strict';
// Network boot (PXE) for Dashboard Hub. Off until you press Start in the Network boot window; stops when you quit.
//   - "proxy DHCP": only adds boot information to what your router's DHCP already says, never hands out addresses
//   - TFTP: serves the small iPXE boot loaders (vendor/ipxe-files.json, iPXE from https://ipxe.org, GPL-2.0)
//   - web server: serves the boot menu and the ISO files you added (kernel and initrd are read straight out of the ISO)
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORTS = { dhcp: 67, pxe: 4011, tftp: 69, http: 8088 };

// ---------- reading an ISO (ISO 9660 with Rock Ridge long names) ----------
function readAt(fd, pos, len) { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return n === len ? b : b.subarray(0, n); }
function cleanName(raw) { return raw.replace(/;\d+$/, '').replace(/\.$/, ''); }
function parseDir(fd, extent, size, joliet) {
  const out = [];
  const buf = readAt(fd, extent * 2048, Math.min(size, 4 * 1024 * 1024));
  let p = 0;
  while (p < buf.length) {
    const len = buf[p];
    if (len === 0) { p = (Math.floor(p / 2048) + 1) * 2048; continue; }   // records never cross a sector
    const flags = buf[p + 25], idLen = buf[p + 32];
    const id = buf.subarray(p + 33, p + 33 + idLen);
    let name;
    if (idLen === 1 && (id[0] === 0 || id[0] === 1)) { p += len; continue; }   // "." and ".."
    if (joliet) { const u = Buffer.from(id); u.swap16(); name = cleanName(u.toString('utf16le')); }
    else name = cleanName(id.toString('latin1'));
    // Rock Ridge: the real (long, mixed case) name lives in an "NM" entry after the short name
    let su = p + 33 + idLen; if (idLen % 2 === 0) su++;
    const end = p + len;
    let rr = '';
    while (!joliet && su + 4 <= end) {
      const sig = buf.toString('latin1', su, su + 2), l = buf[su + 2];
      if (l < 4) break;
      if (sig === 'NM' && l > 5) rr += buf.toString('utf8', su + 5, su + l);
      su += l;
    }
    out.push({ name: rr || name, dir: !!(flags & 2), extent: buf.readUInt32LE(p + 2), size: buf.readUInt32LE(p + 10), joliet: joliet === true });
    p += len;
  }
  return out;
}
function openIso(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const pvd = readAt(fd, 16 * 2048, 2048);
    if (pvd.length < 2048 || pvd.toString('latin1', 1, 6) !== 'CD001') throw new Error('This does not look like an ISO file.');
    const label = pvd.toString('latin1', 40, 72).trim();
    const root = { extent: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10) };
    // Windows discs often have a nearly empty plain tree and the real file list in the "Joliet" extension: find it too
    let jroot = null;
    for (let sec = 17; sec < 40 && !jroot; sec++) {
      const d = readAt(fd, sec * 2048, 2048);
      if (d.length < 2048 || d.toString('latin1', 1, 6) !== 'CD001' || d[0] === 255) break;
      if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && '@CE'.includes(String.fromCharCode(d[90]))) jroot = { extent: d.readUInt32LE(156 + 2), size: d.readUInt32LE(156 + 10) };
    }
    const cache = new Map();
    const list = (d) => { const k = (d.joliet ? 'j' : 'p') + d.extent; if (!cache.has(k)) cache.set(k, parseDir(fd, d.extent, d.size, d.joliet === true)); return cache.get(k); };
    const findIn = (start, p) => {
      let cur = start;
      const parts = String(p).split('/').filter(Boolean);
      if (!parts.length) return { dir: true, extent: start.extent, size: start.size, joliet: start.joliet };
      for (let i = 0; i < parts.length; i++) {
        const e = list(cur).find((x) => x.name.toLowerCase() === parts[i].toLowerCase());
        if (!e) return null;
        if (i === parts.length - 1) return e;
        if (!e.dir) return null;
        cur = Object.assign({}, e, { joliet: start.joliet });
      }
      return null;
    };
    const find = (p) => findIn(root, p) || (jroot ? findIn(Object.assign({ joliet: true }, jroot), p) : null);
    const entries = (p) => { const d = find(p); return d && d.dir ? list(d) : []; };
    return { fd, label, find, entries, close: () => { try { fs.closeSync(fd); } catch (e) { /* closed */ } } };
  } catch (e) { try { fs.closeSync(fd); } catch (x) { /* closed */ } throw e; }
}
// What kind of ISO is it, and which files inside it start it over the network?
function analyzeIso(file) {
  const iso = openIso(file);
  try {
    const pick = (dir, re) => { const l = iso.entries(dir).filter((e) => !e.dir && re.test(e.name)).sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1)); return l[0] ? dir + '/' + l[0].name : ''; };
    const info = { label: iso.label, mode: 'sanboot', kernel: '', initrd: '', squash: '', repo: false };
    const ck = pick('/casper', /^vmlinuz/i), ci = pick('/casper', /^initrd/i);
    const lk = pick('/live', /^vmlinuz/i), li = pick('/live', /^initrd/i), ls = pick('/live', /^filesystem\.squashfs$/i);
    if (ck && ci) { info.mode = 'casper'; info.kernel = ck; info.initrd = ci; }
    else if (lk && li && ls) { info.mode = 'debianlive'; info.kernel = lk; info.initrd = li; info.squash = ls; }
    else if (iso.find('/sources/boot.wim') && (iso.find('/setup.exe') || iso.find('/sources/setup.exe'))) { info.mode = 'windows'; info.kernel = '/sources/boot.wim'; }
    else {
      // Red Hat family (Rocky, Alma, CentOS, Fedora, RHEL): the installer wants to know where its install image and packages are
      const ak = pick('/images/pxeboot', /^vmlinuz$/i), ai = pick('/images/pxeboot', /^initrd\.img$/i);
      if (ak && ai && iso.find('/images/install.img')) { info.mode = 'anaconda'; info.kernel = ak; info.initrd = ai; info.repo = !!iso.find('/BaseOS') || !!iso.find('/Packages'); }
    }
    return info;
  } finally { iso.close(); }
}

// ---------- unattended install answers ----------
// SHA-512 password hash ("$6$...", what Linux installers want), so the password itself is never stored or sent
const CRYPT64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function sha512crypt(password, salt, rounds) {
  const crypto = require('crypto');
  rounds = rounds || 5000;
  const pw = Buffer.from(String(password), 'utf8'), sl = Buffer.from(String(salt).slice(0, 16), 'latin1');
  const h = (parts) => crypto.createHash('sha512').update(Buffer.concat(parts)).digest();
  const B = h([pw, sl, pw]);
  const A = [pw, sl];
  let n = pw.length; while (n > 64) { A.push(B); n -= 64; } A.push(B.subarray(0, n));
  for (let i = pw.length; i > 0; i >>= 1) A.push(i & 1 ? B : pw);
  const Ad = h(A);
  const dp = []; for (let i = 0; i < pw.length; i++) dp.push(pw);
  const DP = h(dp);
  const rep = (d, len) => { const o = Buffer.alloc(len); for (let i = 0; i < len; i++) o[i] = d[i % 64]; return o; };
  const P = rep(DP, pw.length);
  const ds = []; for (let i = 0; i < 16 + Ad[0]; i++) ds.push(sl);
  const S = rep(h(ds), sl.length);
  let C = Ad;
  for (let i = 0; i < rounds; i++) {
    const parts = [i & 1 ? P : C];
    if (i % 3) parts.push(S);
    if (i % 7) parts.push(P);
    parts.push(i & 1 ? C : P);
    C = h(parts);
  }
  const order = [[0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48], [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13], [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41]];
  let out = '';
  const put = (w, k) => { for (let i = 0; i < k; i++) { out += CRYPT64[w & 63]; w >>= 6; } };
  order.forEach(([a, b, c]) => put((C[a] << 16) | (C[b] << 8) | C[c], 4));
  put(C[63], 2);
  return '$6$' + sl.toString('latin1') + '$' + out;
}
function cleanAnswers(o, old) {
  const crypto = require('crypto');
  const t = (v) => String(v == null ? '' : v).trim();
  const user = t(o.username), host = t(o.hostname), tz = t(o.timezone), kb = t(o.keyboard).toLowerCase(), pw = String(o.password == null ? '' : o.password);
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) return { error: 'The user name must be lower case letters, numbers, - or _, starting with a letter (for example: admin).' };
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/i.test(host)) return { error: 'The computer name can only have letters, numbers and - (for example: server1).' };
  if (!/^[A-Za-z0-9_+\/-]{1,40}$/.test(tz) || /\.\./.test(tz)) return { error: 'The time zone looks like America/New_York or UTC.' };
  if (!/^[a-z]{2,10}$/.test(kb)) return { error: 'The keyboard layout is a short code such as us, gb or de.' };
  if (pw.length > 128) return { error: 'The password is too long (128 letters at most).' };
  let hash = old && old.hash || '';
  if (pw) { let salt = ''; const r = crypto.randomBytes(16); for (let i = 0; i < 16; i++) salt += CRYPT64[r[i] & 63]; hash = sha512crypt(pw, salt); }
  if (!hash) return { error: 'Type a password for the new user.' };
  return { answers: { username: user, hostname: host, timezone: tz, keyboard: kb, hash } };
}
function userDataText(a, id) {
  return ['#cloud-config', 'autoinstall:', '  version: 1', '  locale: en_US.UTF-8', '  keyboard: {layout: ' + a.keyboard + '}', '  timezone: ' + a.timezone,
    '  identity: {hostname: ' + a.hostname + ', username: ' + a.username + ', password: "' + a.hash + '"}', '  ssh: {install-server: true, allow-pw: true}',
    '  storage: {layout: {name: direct}}', '  updates: security', '  shutdown: reboot', ''].join('\n');
}
function kickstartText(a, base, repo) {
  return ['text', 'reboot', repo ? 'url --url=' + base : '# no packages on this disc: the installer picks an online mirror', 'lang en_US.UTF-8', "keyboard --xlayouts='" + a.keyboard + "'", 'timezone ' + a.timezone + ' --utc',
    'network --bootproto=dhcp --hostname=' + a.hostname + ' --activate', 'rootpw --lock', 'user --name=' + a.username + ' --groups=wheel --iscrypted --password=' + a.hash,
    'zerombr', 'clearpart --all --initlabel', 'autopart', 'firstboot --disable', '%packages', '@^minimal-environment', '%end', ''].join('\n');
}

const WIN_DEFAULT = { unc: '', user: '', bypass: false };
function cleanWinShare(o) {
  const t = (v) => String(v == null ? '' : v).trim();
  const unc = t(o.unc), user = t(o.user), bypass = o.bypass === true;
  if (unc && !/^\\\\[A-Za-z0-9._-]{1,63}\\[A-Za-z0-9._$-]{1,80}$/.test(unc)) return { error: 'The share address looks like \\\\192.168.1.10\\WinSetup (two backslashes, the PC, a backslash, the share name; no spaces).' };
  if (user && !/^[A-Za-z0-9._-]{1,32}(\\[A-Za-z0-9._-]{1,32})?$/.test(user)) return { error: 'The Windows user name has letters, numbers, . - or _ (for example MYPC\\hubsetup).' };
  return { win: { unc, user, bypass } };
}
// What the Windows setup program does when it starts on the booting computer: connect to your shared folder, then run Setup from it
function winShellIni() { return ['[LaunchApps]', '%SYSTEMROOT%\\System32\\wpeinit.exe', '%SYSTEMROOT%\\System32\\cmd.exe, /k %SYSTEMROOT%\\System32\\hubsetup.cmd', ''].join('\r\n'); }
function winSetupCmd(w) {
  const L = ['@echo off', 'echo.', 'echo ===== Dashboard Hub: Windows setup =====', 'echo Waiting for the network...', 'set /a n=0', ':waitnet', 'ipconfig | find "IPv4" >nul && goto gotnet', 'set /a n+=1', 'if %n% GEQ 30 goto gotnet', 'ping 127.0.0.1 -n 3 >nul', 'goto waitnet', ':gotnet', 'ipconfig | find "IPv4"'];
  if (w.bypass) L.push('echo Skipping the Windows 11 hardware checks (as you chose in Dashboard Hub)...', 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f >nul', 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f >nul', 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f >nul', 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f >nul', 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f >nul');
  L.push(':connect', 'echo.', 'echo Connecting to ' + w.unc + ' as ' + w.user + '. Type that Windows account\'s password when asked (nothing shows while you type).', 'net use Z: ' + w.unc + ' /user:' + w.user + ' *', 'if errorlevel 1 goto failed',
    'if exist Z:\\autounattend.xml (echo Found autounattend.xml on the share: installing without questions.& Z:\\setup.exe /unattend:Z:\\autounattend.xml) else (Z:\\setup.exe)', 'goto :eof',
    ':failed', 'echo.', 'echo Could not connect. Check the share name, the user name, the password and that the Windows PC is on.', 'echo Press any key to try again.', 'pause >nul', 'goto connect', '');
  return L.join('\r\n');
}

// ---------- DHCP packets ----------
const MAGIC = Buffer.from([0x63, 0x82, 0x53, 0x63]);
function parseDhcp(msg) {
  if (msg.length < 240 || msg[0] !== 1 || !msg.subarray(236, 240).equals(MAGIC)) return null;
  const opts = {};
  let p = 240;
  while (p < msg.length) {
    const c = msg[p++];
    if (c === 255) break;
    if (c === 0) continue;
    const l = msg[p++];
    if (p + l > msg.length) break;
    opts[c] = msg.subarray(p, p + l); p += l;
  }
  const mac = Array.from(msg.subarray(28, 28 + Math.min(16, msg[2] || 6))).map((x) => x.toString(16).padStart(2, '0')).join(':');
  return { xid: msg.subarray(4, 8), flags: msg.subarray(10, 12), ciaddr: msg.subarray(12, 16), giaddr: msg.subarray(24, 28), chaddr: msg.subarray(28, 44), mac, opts };
}
function isPxeClient(d) {
  const vc = d.opts[60] ? d.opts[60].toString('latin1') : '';
  return /^PXEClient/.test(vc) || (d.opts[77] && d.opts[77].toString('latin1').includes('iPXE'));
}
function clientArch(d) { return d.opts[93] && d.opts[93].length >= 2 ? d.opts[93].readUInt16BE(0) : 0; }
function isIpxe(d) { return !!(d.opts[77] && d.opts[77].toString('latin1').includes('iPXE')) || !!d.opts[175]; }
// iPXE lists what it can do inside DHCP option 175 (tag 19 = web/HTTP, 20 = secure web/HTTPS). A boot ROM built into a
// network card or a virtual machine is often iPXE without those, so it must first be handed our fuller boot loader.
function ipxeFeatures(d) {
  const set = new Set();
  const o = d.opts[175];
  if (!o) return set;
  let p = 0;
  while (p + 2 <= o.length) {
    const t = o[p], l = o[p + 1];
    if (p + 2 + l > o.length) break;
    set.add(t); p += 2 + l;
  }
  return set;
}
function ipxeCanHttp(d) { return isIpxe(d) && ipxeFeatures(d).has(19); }
function ipBuf(ip) { return Buffer.from(ip.split('.').map(Number)); }
function buildReply(req, type, serverIp, bootfile) {
  const b = Buffer.alloc(240);
  b[0] = 2; b[1] = 1; b[2] = 6; b[3] = 0;
  req.xid.copy(b, 4); req.flags.copy(b, 10);
  req.ciaddr.copy(b, 12);                          // yiaddr stays 0.0.0.0: the real DHCP server gives the address
  ipBuf(serverIp).copy(b, 20);                     // siaddr: where to fetch the boot file
  req.chaddr.copy(b, 28);
  Buffer.from(bootfile, 'latin1').copy(b, 108, 0, 127);
  MAGIC.copy(b, 236);
  const o = [];
  const add = (code, data) => { o.push(Buffer.from([code, data.length]), data); };
  add(53, Buffer.from([type]));
  add(54, ipBuf(serverIp));
  add(60, Buffer.from('PXEClient'));
  add(66, Buffer.from(serverIp));
  add(67, Buffer.from(bootfile));
  add(43, Buffer.from([6, 1, 8, 255]));            // PXE discovery control: use the boot file from this offer
  if (req.opts[97]) add(97, req.opts[97]);
  o.push(Buffer.from([255]));
  return Buffer.concat([b].concat(o));
}

// ---------- TFTP (read only, only the two boot loaders) ----------
function startTftp(port, files, log) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const err = (e, ri, code, text) => { const p = Buffer.alloc(5 + text.length); p.writeUInt16BE(5, 0); p.writeUInt16BE(code, 2); p.write(text, 4); try { e.send(p, ri.port, ri.address); } catch (x) { /* gone */ } };
    sock.on('message', (msg, ri) => {
      if (msg.length < 4 || msg.readUInt16BE(0) !== 1) { err(sock, ri, 4, 'Only reading is allowed'); return; }
      const parts = msg.subarray(2).toString('latin1').split('\0');
      const name = path.basename(parts[0] || '').toLowerCase();
      const buf = files[name];
      if (!buf) { err(sock, ri, 1, 'File not found'); log('tftp-miss', ri.address, parts[0]); return; }
      const opt = {};
      for (let i = 2; i + 1 < parts.length; i += 2) opt[parts[i].toLowerCase()] = parts[i + 1];
      const t = dgram.createSocket('udp4');
      let blk = 512, last = null, tries = 0, timer = null, n = 0, done = false;
      const total = () => Math.floor(buf.length / blk) + 1;
      const stop = () => { done = true; clearTimeout(timer); try { t.close(); } catch (x) { /* closed */ } };
      const send = (p) => { last = p; tries = 0; t.send(p, ri.port, ri.address); arm(); };
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (done) return; if (++tries > 6) { stop(); return; } t.send(last, ri.port, ri.address); arm(); }, 1000); };
      const data = (k) => { const off = (k - 1) * blk; const c = buf.subarray(off, off + blk); const p = Buffer.alloc(4 + c.length); p.writeUInt16BE(3, 0); p.writeUInt16BE(k & 0xffff, 2); c.copy(p, 4); send(p); };
      t.on('message', (m, r) => {
        if (r.address !== ri.address || r.port !== ri.port || m.length < 4) return;
        const op = m.readUInt16BE(0);
        if (op === 5) { stop(); return; }
        if (op !== 4) return;
        const ack = m.readUInt16BE(2);
        if (ack !== (n & 0xffff)) return;           // an old repeat
        if (n >= total()) { log('tftp-done', ri.address, name); stop(); return; }
        n++; data(n);
      });
      t.on('error', stop);
      t.bind(0, () => {
        log('tftp-start', ri.address, name);
        if (opt.blksize || opt.tsize !== undefined || opt.timeout) {
          const kv = [];
          if (opt.blksize) { blk = Math.max(8, Math.min(1432, parseInt(opt.blksize, 10) || 512)); kv.push('blksize', String(blk)); }
          if (opt.tsize !== undefined) kv.push('tsize', String(buf.length));
          if (opt.timeout) kv.push('timeout', opt.timeout);
          const oack = Buffer.concat([Buffer.from([0, 6]), Buffer.from(kv.join('\0') + '\0')]);
          n = 0; send(oack);
        } else { n = 1; data(1); }
      });
    });
    sock.once('error', (e) => { try { sock.close(); } catch (x) { /* closed */ } reject(e); });
    sock.bind(port, () => resolve(sock));
  });
}

// ---------- which machines may be answered ----------
function normMac(m) {
  const h = String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return h.length === 12 ? h.match(/../g).join(':') : '';
}

// ---------- the module ----------
function create(opts) {
  const dataDir = opts.dataDir;
  const ports = Object.assign({}, PORTS, opts.ports || {});
  const testing = opts.testing || {};              // tests send replies to 127.0.0.1 instead of the network broadcast
  const store = path.join(dataDir, 'pxe.json');
  let isos = [];
  let wimbootBuf = null;
  let winShare = Object.assign({}, WIN_DEFAULT);
  let answers = null;                               // unattended install answers (the password is kept only as a hash)
  const delivered = new Map();                      // 'mac id' -> time the install answers were fetched (they stay available for 30 minutes)
  let uefiLoader = 'snponly';                       // which UEFI boot loader to hand out: 'snponly' (uses the firmware's network card) or 'ipxe' (iPXE's own card drivers)
  let allow = { macs: [], any: false };
  let choice = {};   // per computer: what to start by itself ('menu', 'local', 'netbootxyz' or 'iso:<id>')   // which machines may be answered (nothing is answered until you list one)
  try { const j = JSON.parse(fs.readFileSync(store, 'utf8')); if (j.allow && Array.isArray(j.allow.macs)) allow = { macs: j.allow.macs.map(normMac).filter(Boolean).slice(0, 50), any: j.allow.any === true }; if (j.choice && typeof j.choice === 'object') Object.keys(j.choice).slice(0, 50).forEach((k) => { const m = normMac(k); if (m && /^(menu|local|netbootxyz|iso:[a-z0-9]{3,12}(:auto)?)$/.test(String(j.choice[k]))) choice[m] = String(j.choice[k]); }); if (j.answers && typeof j.answers === 'object') { const c = cleanAnswers(Object.assign({}, j.answers, { password: '' }), j.answers); if (c.answers) answers = c.answers; } if (j.winShare && typeof j.winShare === 'object') { const c = cleanWinShare(j.winShare); if (c.win) winShare = c.win; } if (j.uefiLoader === 'ipxe' || j.uefiLoader === 'snponly') uefiLoader = j.uefiLoader; if (Array.isArray(j.isos)) isos = j.isos.filter((x) => x && typeof x.path === 'string' && /^[a-z0-9]{3,12}$/.test(x.id)).slice(0, 40); } catch (e) { /* none yet */ }
  isos.forEach((x) => { if (x.mode === 'sanboot') { try { const i = analyzeIso(x.path); if (i.mode !== 'sanboot') { x.mode = i.mode; x.kernel = i.kernel; x.initrd = i.initrd; x.squash = i.squash; x.repo = i.repo === true; } } catch (e) { /* file missing */ } } });
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(store, JSON.stringify({ isos, allow, choice, uefiLoader, answers, winShare }), { mode: 0o600 }); } catch (e) { /* not saved */ } };

  let running = false, ip = '', loaders = null, servers = {}, httpSrv = null;
  const logLines = [];
  const clients = new Map();                        // ip -> { mac, since, what }
  const seenOnce = new Set();
  const ignored = new Set();
  const loops = new Map();
  const log = (kind, who, what) => {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let msg = '';
    if (kind === 'discover') msg = who + ' asked how to network boot (' + what + ').';
    else if (kind === 'offer') msg = 'Told ' + who + ' to fetch ' + what + '.';
    else if (kind === 'tftp-start') msg = 'Sending ' + what + ' to ' + who + '...';
    else if (kind === 'tftp-done') msg = 'Sent ' + what + ' to ' + who + '.';
    else if (kind === 'tftp-miss') msg = who + ' asked for a file that is not offered: ' + String(what).slice(0, 60);
    else if (kind === 'menu') msg = who + ' is looking at the boot menu.';
    else if (kind === 'iso') msg = who + ' is downloading ' + what + '.';
    else if (kind === 'info') msg = what;
    if (!msg) return;
    logLines.push({ t, msg }); if (logLines.length > 80) logLines.shift();
    if (who && /^\d+\.\d+\.\d+\.\d+$/.test(who)) { const c = clients.get(who) || { since: t }; c.last = msg; c.t = t; clients.set(who, c); }
    if (opts.onLog) { try { opts.onLog(msg); } catch (e) { /* ignore */ } }
  };

  function loadLoaders() {
    if (loaders) return loaders;
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor', 'ipxe-files.json'), 'utf8'));
    loaders = { 'undionly.kpxe': Buffer.from(j.undionly, 'base64'), 'ipxe.efi': Buffer.from(j.efi, 'base64') };
    wimbootBuf = j.wimboot ? Buffer.from(j.wimboot, 'base64') : null;   // Windows: boots the Windows setup program (wimboot, GPL-2.0-or-later)
    if (j.snponly) loaders['snponly.efi'] = Buffer.from(j.snponly, 'base64');   // UEFI: uses the network card the firmware already opened
    return loaders;
  }
  const safeText = (s) => String(s || '').replace(/[\u0000-\u001f\u007f$#{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');

  const autoable = (x) => !!x && (x.mode === 'casper' || x.mode === 'anaconda');
  function menuScript() {
    const base = 'http://' + ip + ':' + ports.http;
    const ok = isos.filter((x) => x.ok !== false);
    const L = ['#!ipxe', 'set base ' + base, 'set dflt local', 'set tmo 20000'];
    // a computer you gave its own choice starts that by itself after 5 seconds (any key opens the menu instead)
    Object.keys(choice).forEach((m, i) => {
      const c = choice[m];
      const label = c === 'local' ? 'local' : c === 'netbootxyz' ? 'netbootxyz' : (/^iso:/.test(c) && ok.some((x) => 'iso:' + x.id === c.replace(/:auto$/, '')) && (!/:auto$/.test(c) || (answers && autoable(ok.find((x) => 'iso:' + x.id === c.replace(/:auto$/, ''))))) ? 'iso' + c.slice(4).replace(/:auto$/, 'auto') : '');
      if (!label || !allow.macs.includes(m)) return;
      L.push('iseq ${net0/mac} ' + m + ' || goto skip' + i, 'set dflt ' + label, 'set tmo 5000', ':skip' + i);
    });
    L.push(':menu', 'menu Dashboard Hub network boot', 'item --gap -- Choose what to start on this computer (nothing is installed or erased by this menu itself):');
    ok.forEach((x) => L.push('item iso' + x.id + ' ' + safeText(x.name) + (x.mode === 'sanboot' ? ' (generic ISO, may not work on every computer)' : '')));
    L.push('item --gap -- ', 'item netbootxyz netboot.xyz: many live, rescue and installer images (this computer needs internet)', 'item shell iPXE command line (advanced)', 'item --default --key d local Boot from this computer\'s own disk (starts by itself after 20 seconds)');
    L.push('choose --default ${dflt} --timeout ${tmo} sel || goto local', 'goto ${sel}');
    ok.forEach((x) => {
      const b = '${base}/iso/' + x.id;
      L.push(':iso' + x.id, 'echo Starting ' + safeText(x.name) + ' ...');
      if (x.mode === 'casper') L.push('kernel ' + b + '/f' + enc(x.kernel) + ' boot=casper ip=dhcp url=' + b + '/image.iso cloud-config-url=/dev/null --- || goto failed', 'initrd ' + b + '/f' + enc(x.initrd) + ' || goto failed', 'boot || goto failed');
      else if (x.mode === 'debianlive') L.push('kernel ' + b + '/f' + enc(x.kernel) + ' boot=live components fetch=' + b + '/f' + enc(x.squash) + ' ip=dhcp || goto failed', 'initrd ' + b + '/f' + enc(x.initrd) + ' || goto failed', 'boot || goto failed');
      else if (x.mode === 'windows') L.push('kernel ${base}/wimboot', 'initrd ' + b + '/f' + enc(x.kernel) + ' boot.wim || goto failed', 'initrd ${base}/win/' + x.id + '/winpeshl.ini winpeshl.ini || goto failed', 'initrd ${base}/win/' + x.id + '/hubsetup.cmd hubsetup.cmd || goto failed', 'boot || goto failed');
      else if (x.mode === 'anaconda') L.push('kernel ' + b + '/f' + enc(x.kernel) + ' inst.stage2=' + b + '/f' + (x.repo ? ' inst.repo=' + b + '/f' : '') + ' ip=dhcp || goto failed', 'initrd ' + b + '/f' + enc(x.initrd) + ' || goto failed', 'boot || goto failed');
      else L.push('sanboot ' + b + '/iso || goto failed');
    });
    if (answers) ok.filter(autoable).forEach((x) => {   // hidden entries: only a computer you chose "unattended" for starts here, never someone picking from the menu
      const b = '${base}/iso/' + x.id, au = '${base}/auto/' + x.id + '/${net0/mac:hexhyp}/';
      L.push(':iso' + x.id + 'auto', 'echo Starting UNATTENDED install of ' + safeText(x.name) + ' ...');
      if (x.mode === 'casper') L.push('kernel ' + b + '/f' + enc(x.kernel) + ' boot=casper ip=dhcp url=' + b + '/image.iso autoinstall ds=nocloud-net;s=' + au + ' ---  || goto failed', 'initrd ' + b + '/f' + enc(x.initrd) + ' || goto failed', 'boot || goto failed');
      else L.push('kernel ' + b + '/f' + enc(x.kernel) + ' inst.stage2=' + b + '/f' + (x.repo ? ' inst.repo=' + b + '/f' : '') + ' inst.ks=' + au + 'ks.cfg ip=dhcp || goto failed', 'initrd ' + b + '/f' + enc(x.initrd) + ' || goto failed', 'boot || goto failed');
    });
    L.push(':netbootxyz', 'echo Contacting netboot.xyz ...', 'chain --autofree https://boot.netboot.xyz/menu.ipxe || goto failed', 'goto menu');
    L.push(':shell', 'shell', 'goto menu', ':failed', 'set dflt local', 'set tmo 60000', 'echo That did not start. Press a key to go back to the menu.', 'prompt --timeout 15000 Press any key', 'goto menu', ':local', 'exit');
    return L.join('\n') + '\n';
  }

  function serveFile(req, res, file, start, length, type, label, who) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let a = 0, b = length - 1, status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1] === '') { a = Math.max(0, length - parseInt(range[2], 10)); }
      else { a = parseInt(range[1], 10); if (range[2]) b = Math.min(length - 1, parseInt(range[2], 10)); }
      if (a > b || a >= length) { res.writeHead(416, { 'Content-Range': 'bytes */' + length }); res.end(); return; }
      status = 206;
    }
    const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 };
    if (status === 206) h['Content-Range'] = 'bytes ' + a + '-' + b + '/' + length;
    res.writeHead(status, h);
    if (req.method === 'HEAD') { res.end(); return; }
    const s = fs.createReadStream(file, { start: start + a, end: start + b });
    let sent = 0; const t0 = Date.now(); const want = b - a + 1;
    s.on('data', (c) => { sent += c.length; });
    s.on('error', () => { try { res.destroy(); } catch (e) { /* gone */ } });
    res.on('close', () => {
      s.destroy();
      if (!label || want < 1048576) return;                   // only say something about big files (kernel, initrd, install image)
      const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
      if (res.writableFinished) log('info', '', who + ' finished downloading ' + label + ' (' + mb(want) + ' in ' + Math.max(1, Math.round((Date.now() - t0) / 1000)) + ' s).');
      else log('info', '', who + ' stopped downloading ' + label + ' part way (' + mb(sent) + ' of ' + mb(want) + ' sent). If this keeps happening the computer\'s network card or the network is dropping the connection.');
    });
    if (label && want >= 1048576) { const k = who + label; if (!seenOnce.has(k)) { seenOnce.add(k); log('info', '', who + ' started downloading ' + label + ' (' + (want / 1048576).toFixed(1) + ' MB).'); } }
    s.pipe(res);
  }
  function handleHttp(req, res) {
    const who = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    let u; try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (u === '/boot.ipxe') { const s = Buffer.from(menuScript()); res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': s.length }); if (req.method === 'GET') { res.end(s); log('menu', who); } else res.end(); return; }
    if (u === '/wimboot' && wimbootBuf) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': wimbootBuf.length }); if (req.method === 'GET') res.end(wimbootBuf); else res.end(); return; }
    const wm = /^\/win\/([a-z0-9]{3,12})\/(winpeshl\.ini|hubsetup\.cmd)$/.exec(u);
    if (wm) {
      const xw = isos.find((i) => i.id === wm[1] && i.ok !== false && i.mode === 'windows');
      if (!xw || !winShare.unc || !winShare.user) { res.writeHead(404); res.end(); return; }
      const buf = Buffer.from(wm[2] === 'winpeshl.ini' ? winShellIni() : winSetupCmd(winShare), 'latin1');
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': buf.length }); if (req.method === 'GET') res.end(buf); else res.end(); return;
    }
    const am = /^\/auto\/([a-z0-9]{3,12})\/([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\/(user-data|meta-data|vendor-data|ks\.cfg)$/i.exec(u);
    if (am) {
      const mac = normMac(am[2]), xi = isos.find((i) => i.id === am[1] && i.ok !== false);
      const key = mac + ' ' + am[1], when = delivered.get(key);
      const live = choice[mac] === 'iso:' + am[1] + ':auto', grace = when && Date.now() - when < 30 * 60 * 1000;
      if (!mac || !xi || !answers || !autoable(xi) || !(live || grace)) { res.writeHead(404); res.end(); return; }
      const file = am[3];
      let body = '';
      if (file === 'user-data') body = xi.mode === 'casper' ? userDataText(answers, xi.id) : '';
      else if (file === 'meta-data') body = 'instance-id: hub-' + xi.id + '-' + mac.replace(/:/g, '') + '\n';
      else if (file === 'ks.cfg') body = xi.mode === 'anaconda' ? kickstartText(answers, 'http://' + ip + ':' + ports.http + '/iso/' + xi.id + '/f', xi.repo === true) : '';
      if (file === 'vendor-data') body = '';
      if (!body && file !== 'vendor-data') { res.writeHead(404); res.end(); return; }
      const buf = Buffer.from(body); res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': buf.length });
      if (req.method === 'GET') res.end(buf); else res.end();
      if (req.method === 'GET' && (file === 'user-data' || file === 'ks.cfg') && live) {
        delivered.set(key, Date.now()); choice[mac] = 'local'; save();   // one shot: next time this computer starts from its own disk
        log('info', '', mac + ' fetched its install answers. It will install by itself now, and from now on it starts from its own disk.');
      }
      return;
    }
    const m = /^\/iso\/([a-z0-9]{3,12})\/(iso|image\.iso|f\/.+)$/.exec(u);
    const x = m && isos.find((i) => i.id === m[1] && i.ok !== false);
    if (!x) { res.writeHead(404); res.end(); return; }
    let st; try { st = fs.statSync(x.path); } catch (e) { res.writeHead(404); res.end(); return; }
    const isIso = m[2] === 'iso' || m[2] === 'image.iso';
    const key = who + x.id + m[2].slice(0, 12);
    if (isIso && !seenOnce.has(key)) { seenOnce.add(key); log('iso', who, x.name); }
    if (isIso) { serveFile(req, res, x.path, 0, st.size, 'application/octet-stream', null, who); return; }
    let iso; try { iso = openIso(x.path); } catch (e) { res.writeHead(500); res.end(); return; }
    let e; try { e = iso.find(m[2].slice(2)); } finally { iso.close(); }
    if (!e || e.dir) { res.writeHead(404); res.end(); return; }
    serveFile(req, res, x.path, e.extent * 2048, e.size, 'application/octet-stream', m[2].slice(2), who);
  }

  const asks = new Map();                           // mac -> times it asked in the last 40 s
  function dhcpHandler(sock, isProxyPort) {
    return (msg, ri) => {
      const d = parseDhcp(msg);
      if (!d || !d.opts[53] || !isPxeClient(d)) return;
      const mt = d.opts[53][0];
      if (!allow.any && !allow.macs.includes(normMac(d.mac))) {   // not a machine you listed: stay silent so no other computer's boot is touched
        if (mt === 1 && !ignored.has(d.mac)) { ignored.add(d.mac); log('info', '', d.mac + ' asked to network boot, but it is not on your list, so it was ignored.'); }
        return;
      }
      if (!isProxyPort && mt !== 1 && mt !== 3) return;            // port 67: "who is there?" and the follow-up request that some firmware (Dell, Intel UEFI) broadcasts here instead of to port 4011
      if (isProxyPort && mt !== 3) return;                         // port 4011: the follow-up request
      const arch = clientArch(d);
      let file = '';
      const weakIpxe = isIpxe(d) && !ipxeCanHttp(d);                    // iPXE that cannot download over the web yet
      if (weakIpxe && !isProxyPort) {                                   // seen over and over = our own loader cannot do it either: stop instead of looping
        const now = Date.now(); const h = (loops.get(d.mac) || []).filter((x) => now - x.t < 90000);
        const xid = d.xid.toString('hex');
        if (!h.some((x) => x.xid === xid)) h.push({ t: now, xid });
        loops.set(d.mac, h);
        if (h.length >= 5) { if (h.length === 5) log('info', '', d.mac + ' keeps coming back with a boot loader that cannot download over the web, so it was left alone. Try a different network card type in the virtual machine, or boot it from a USB stick.'); return; }
      }
      if (ipxeCanHttp(d)) file = 'http://' + ip + ':' + ports.http + '/boot.ipxe';
      else if (arch === 0) file = 'undionly.kpxe';
      else if (arch === 7 || arch === 9) file = (uefiLoader === 'snponly' && loaders['snponly.efi']) ? 'snponly.efi' : 'ipxe.efi';
      else { log('info', '', d.mac + ' asked for a boot type this version does not offer (code ' + arch + ').'); return; }
      const reply = buildReply(d, isProxyPort || mt === 3 ? 5 : 2, ip, file);
      const note = (k, text) => { const key = d.mac + k + d.xid.toString('hex'); if (!seenOnce.has(key)) { seenOnce.add(key); log('info', '', text); } };
      if (!isProxyPort && mt === 1) {
        const now = Date.now(); const h = (asks.get(d.mac) || []).filter((t) => now - t < 40000); h.push(now); asks.set(d.mac, h);
        if (h.length === 4) log('info', '', d.mac + ' keeps asking but never starts the download, so its firmware may not accept the answer. What it sent: boot type ' + arch + ', ' + ((d.flags[0] & 0x80) ? 'asks for a broadcast reply' : 'no broadcast flag') + ', ' + (d.opts[97] ? 'has' : 'no') + ' machine ID. Answers went out from ' + ip + '. Send this line and a photo of its screen.');
      }
      if (!isProxyPort && mt === 3) {
        note('req67', d.mac + ' sent its follow-up request to the normal DHCP port: answered it too.');
        const to = testing.replyTo || '255.255.255.255';
        sock.send(reply, testing.replyPort || 68, to, () => { /* best effort */ });
        if (!testing.replyTo && ip) { const p = ip.split('.'); sock.send(reply, 68, p[0] + '.' + p[1] + '.' + p[2] + '.255', () => { /* best effort */ }); }
        return;
      }
      if (!isProxyPort) {
        log('discover', d.mac, arch === 0 ? 'older BIOS mode' : arch === 7 || arch === 9 ? 'UEFI mode' : 'type ' + arch);
        log('offer', d.mac, file.replace(/^http:\/\/[^/]+\//, ''));
        if (weakIpxe) log('info', '', d.mac + "'s built-in boot ROM cannot download over the web, so it is sent a fuller boot loader first.");
        const to = testing.replyTo || '255.255.255.255';
        sock.send(reply, testing.replyPort || 68, to, () => { /* best effort */ });
        if (!testing.replyTo && ip) { const p = ip.split('.'); sock.send(reply, 68, p[0] + '.' + p[1] + '.' + p[2] + '.255', () => { /* best effort */ }); }
      } else {
        note('req4011', d.mac + ' sent its follow-up request to the boot-file port: answered it.');
        sock.send(reply, ri.port, ri.address, () => { /* best effort */ });
      }
    };
  }
  const bindUdp = (port) => new Promise((resolve, reject) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.once('error', (e) => { try { s.close(); } catch (x) { /* closed */ } reject(e); });
    s.bind(port, () => { try { s.setBroadcast(true); } catch (e) { /* not needed */ } resolve(s); });
  });
  const nice = (e, port) => {
    if (e && e.code === 'EACCES') return 'Port ' + port + ' needs more permission. ' + (process.platform === 'win32' ? 'Close Dashboard Hub and start it again with "Run as administrator".' : process.platform === 'linux' ? 'On Linux, run once in a terminal:  sudo sysctl -w net.ipv4.ip_unprivileged_port_start=67  (lasts until restart), or start Dashboard Hub with sudo.' : 'Start Dashboard Hub as an administrator.');
    if (e && e.code === 'EADDRINUSE') return 'Another program already uses port ' + port + '. ' + (port === 67 || port === 4011 ? 'It may be a DHCP or network-boot program on this computer (or Windows Internet Connection Sharing). Close it, then try again.' : port === 69 ? 'It may be another TFTP server. Close it, then try again.' : 'Close it, or it may be another copy of Dashboard Hub.');
    return 'Port ' + port + ' could not be opened (' + ((e && e.message) || 'unknown') + ').';
  };

  async function start(o) {
    if (running) return { ok: true };
    const want = o && typeof o.ip === 'string' ? o.ip : '';
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(want)) return { ok: false, error: 'Pick which network connection of this computer the booting machine is plugged into.' };
    if (!allow.any && !allow.macs.length) return { ok: false, error: 'Add the MAC address of the computer you want to network boot first (or tick "any computer"). This keeps other computers on your network from being touched.' };
    try { loadLoaders(); } catch (e) { return { ok: false, error: 'The boot loader files are missing from this copy of Dashboard Hub.' }; }
    ip = want;
    const opened = [];
    let step = ports.http;
    try {
      httpSrv = http.createServer(handleHttp);
      await new Promise((resolve, reject) => { httpSrv.once('error', reject); httpSrv.listen(ports.http, '0.0.0.0', resolve); });
      step = ports.tftp; // iPXE looks for "autoexec.ipxe" next to the boot loader it was started from: a tiny script that points it straight at the menu
      const menuUrl = 'http://' + ip + ':' + ports.http + '/boot.ipxe';
      const autoexec = Buffer.from(['#!ipxe', 'echo Dashboard Hub network boot: script started', 'ifstat', 'route', 'echo Getting the menu from ' + menuUrl, 'chain --timeout 15000 ' + menuUrl + ' && exit', 'echo That did not work with the settings the computer already has. Asking for an address...', 'dhcp || echo (could not get an address)', 'ifstat', 'route', 'chain --timeout 15000 ' + menuUrl + ' && exit', 'echo Still no menu. Testing the connection to ' + ip + ' ...', 'ping -c 3 ' + ip + ' || echo (no answer from ' + ip + ': firewall, wrong network or network card problem)', 'chain --timeout 30000 ' + menuUrl + ' || shell', ''].join('\n'));
      servers.tftp = await startTftp(ports.tftp, Object.assign({}, loaders, { 'autoexec.ipxe': autoexec }), log); opened.push('tftp');
      step = ports.dhcp; servers.dhcp = await bindUdp(ports.dhcp); servers.dhcp.on('message', dhcpHandler(servers.dhcp, false));
      step = ports.pxe; servers.pxe = await bindUdp(ports.pxe); servers.pxe.on('message', dhcpHandler(servers.pxe, true));
    } catch (e) {
      await stop(true);
      return { ok: false, error: nice(e, step) };
    }
    running = true;
    log('info', '', 'Network boot server started on ' + ip + '. Boot the other computer from its network now.');
    return { ok: true };
  }
  async function stop(quiet) {
    const was = running;
    running = false;
    Object.keys(servers).forEach((k) => { try { servers[k].close(); } catch (e) { /* closed */ } });
    servers = {};
    if (httpSrv) { try { httpSrv.close(); if (httpSrv.closeAllConnections) httpSrv.closeAllConnections(); } catch (e) { /* closed */ } httpSrv = null; }
    clients.clear(); seenOnce.clear(); ignored.clear(); loops.clear();
    if (was && !quiet) log('info', '', 'Network boot server stopped.');
    return { ok: true };
  }

  function addIso(file, name) {
    if (typeof file !== 'string' || !file) return { ok: false, error: 'No file chosen.' };
    if (isos.length >= 40) return { ok: false, error: 'That is the most ISO files the list holds (40).' };
    let info, st;
    try { st = fs.statSync(file); if (!st.isFile()) throw new Error('not a file'); info = analyzeIso(file); }
    catch (e) { return { ok: false, error: /ISO/.test(e.message) ? e.message : 'That file could not be read as an ISO.' }; }
    if (isos.some((x) => x.path === file)) return { ok: false, error: 'That ISO is already in the list.' };
    const id = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');
    const nm = safeText(name) || safeText(info.label) || safeText(path.basename(file, path.extname(file)));
    isos.push({ id, name: nm, path: file, mode: info.mode, kernel: info.kernel, initrd: info.initrd, squash: info.squash, repo: info.repo === true, size: st.size });
    save();
    return { ok: true, id };
  }
  function removeIso(id) { isos = isos.filter((x) => x.id !== id); Object.keys(choice).forEach((m) => { if (choice[m] === 'iso:' + id || choice[m] === 'iso:' + id + ':auto') delete choice[m]; }); save(); return { ok: true }; }
  function renameIso(id, name) { const x = isos.find((i) => i.id === id); if (x && safeText(name)) { x.name = safeText(name); save(); } return { ok: true }; }

  function setAnswers(o) {
    const c = cleanAnswers(o || {}, answers);
    if (c.error) return { ok: false, error: c.error };
    answers = c.answers; save(); return { ok: true };
  }
  function setWinShare(o) {
    const c = cleanWinShare(o || {});
    if (c.error) return { ok: false, error: c.error };
    winShare = c.win; save(); return { ok: true };
  }
  function setUefiLoader(v) { if (v !== 'snponly' && v !== 'ipxe') return { ok: false, error: 'Unknown loader' }; uefiLoader = v; save(); return { ok: true }; }
  function setAllow(o) {
    const macs = [];
    (Array.isArray(o && o.macs) ? o.macs : []).forEach((m) => { const n = normMac(m); if (n && !macs.includes(n) && macs.length < 50) macs.push(n); });
    const bad = (Array.isArray(o && o.macs) ? o.macs : []).filter((m) => String(m || '').trim() && !normMac(m));
    allow = { macs, any: !!(o && o.any === true) };
    Object.keys(choice).forEach((m) => { if (!macs.includes(m)) delete choice[m]; });
    ignored.clear(); save();
    return { ok: true, bad: bad.map((x) => String(x).slice(0, 30)) };
  }
  function setChoice(mac, what) {
    const m = normMac(mac); const c = String(what || 'menu');
    if (!m || !allow.macs.includes(m)) return { ok: false, error: 'That computer is not on your list.' };
    if (!/^(menu|local|netbootxyz|iso:[a-z0-9]{3,12}(:auto)?)$/.test(c)) return { ok: false, error: 'That choice is not offered.' };
    if (/:auto$/.test(c)) {
      const x = isos.find((i) => 'iso:' + i.id === c.slice(0, -5) && i.ok !== false);
      if (!answers) return { ok: false, error: 'Fill in and save the install answers first.' };
      if (!autoable(x)) return { ok: false, error: 'Unattended installs work with Ubuntu Server style and Rocky/Alma/Fedora style discs.' };
    }
    if (c === 'menu') delete choice[m]; else choice[m] = c;
    save(); return { ok: true };
  }
  // "Check my setup": can the ports be opened, is the address this computer's own, are the boot loaders there?
  async function check(want) {
    const out = []; const add = (ok, text) => out.push({ ok, text });
    const mine = localAddresses().map((a) => a.address);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(want || ''))) add(false, 'No network connection is chosen.');
    else if (!mine.includes(want) && want !== '127.0.0.1') add(false, 'The chosen address ' + want + ' is not one of this computer\'s own addresses any more. Pick the connection again.');
    else add(true, 'Using this computer\'s address ' + want + '.');
    if (!allow.any && !allow.macs.length) add(false, 'No computer is listed yet (add its MAC address).'); else add(true, allow.any ? 'Any computer will be answered.' : allow.macs.length + ' computer(s) listed.');
    try { loadLoaders(); add(true, 'The boot loader files are present.'); } catch (e) { add(false, 'The boot loader files are missing from this copy of Dashboard Hub.'); }
    if (running) add(true, 'Network boot is running, so its ports are open.');
    else {
      const tryUdp = (port) => new Promise((resolve) => { const k = dgram.createSocket({ type: 'udp4', reuseAddr: true }); k.once('error', (e) => { try { k.close(); } catch (x) { /* closed */ } resolve(e); }); k.bind(port, () => { try { k.close(); } catch (x) { /* closed */ } resolve(null); }); });
      const tryTcp = (port) => new Promise((resolve) => { const k = http.createServer(); k.once('error', (e) => resolve(e)); k.listen(port, '0.0.0.0', () => k.close(() => resolve(null))); });
      for (const [port, fn] of [[ports.dhcp, tryUdp], [ports.pxe, tryUdp], [ports.tftp, tryUdp], [ports.http, tryTcp]]) {
        const e = await fn(port);
        if (e) add(false, nice(e, port)); else add(true, 'Port ' + port + ' can be opened.');
      }
    }
    if (process.platform === 'win32') add(true, 'Windows may ask to allow Dashboard Hub through the firewall when you press Start. Choose "Private networks".');
    return { ok: true, checks: out, good: out.every((c) => c.ok) };
  }
  function localAddresses() {
    const out = [];
    const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach((n) => (ifs[n] || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push({ name: n, address: a.address }); }));
    return out;
  }
  function status() {
    isos.forEach((x) => { try { fs.accessSync(x.path, fs.constants.R_OK); x.ok = true; } catch (e) { x.ok = false; } });
    return {
      running, ip, uefiLoader, winShare: Object.assign({}, winShare), answers: answers ? { username: answers.username, hostname: answers.hostname, timezone: answers.timezone, keyboard: answers.keyboard, hasPassword: true } : null, allow: { macs: allow.macs.slice(), any: allow.any, choice: Object.assign({}, choice) }, ports: { dhcp: ports.dhcp, pxe: ports.pxe, tftp: ports.tftp, http: ports.http }, addresses: localAddresses(),
      isos: isos.map((x) => ({ id: x.id, name: x.name, path: x.path, mode: x.mode, size: x.size, ok: x.ok !== false })),
      clients: Array.from(clients.entries()).map(([a, c]) => ({ ip: a, last: c.last, t: c.t })), log: logLines.slice(-40)
    };
  }
  return { start, stop, addIso, removeIso, renameIso, setAllow, setChoice, setUefiLoader, setAnswers, setWinShare, check, status, menuScript, _isos: () => isos };
}

module.exports = { sha512crypt, create, analyzeIso, openIso, parseDhcp, buildReply, normMac, ipxeFeatures, PORTS };
