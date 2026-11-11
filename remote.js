'use strict';
// Remote view: the list of remote-control devices (PiKVM, JetKVM, other web KVMs, NoMachine) and the pieces that need no window.
// - PiKVM / JetKVM / "other web KVM": their own web page is shown inside the Remote view window.
// - NoMachine: its protocol is private, so the NoMachine program you installed is started with the connection filled in.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  pikvm: { label: 'PiKVM', scheme: 'https', port: 443 },
  jetkvm: { label: 'JetKVM', scheme: 'http', port: 80 },
  web: { label: 'Other web KVM or page', scheme: 'https', port: 443 },
  nomachine: { label: 'NoMachine', port: 4000 }
};
const MAX = 100;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const V6_RE = /^[0-9A-Fa-f:]{2,45}$/;

function cleanDevice(d, old) {
  d = d || {};
  const type = String(d.type || '');
  if (!TYPES[type]) return { error: 'Choose what kind of device this is.' };
  const name = String(d.name == null ? '' : d.name).trim().slice(0, 60);
  if (!name) return { error: 'Give it a name, for example "Rack PiKVM".' };
  let raw = String(d.host == null ? '' : d.host).trim();
  let scheme = TYPES[type].scheme || '';
  let port = d.port === '' || d.port == null ? 0 : parseInt(d.port, 10);
  // a full web address pasted in is taken apart
  const m = /^(https?):\/\/([^\/?#]+)/i.exec(raw);
  if (m && type !== 'nomachine') {
    scheme = m[1].toLowerCase(); raw = m[2];
    const pm = /^(.*):(\d{1,5})$/.exec(raw);
    if (pm && !/^\[?[0-9A-Fa-f:]*\]?$/.test(raw) || (pm && /^\[.*\]:\d+$/.test(raw))) { raw = pm[1]; if (!port) port = parseInt(pm[2], 10); }
  }
  raw = raw.replace(/^\[|\]$/g, '');
  const hostOk = HOST_RE.test(raw) || (raw.includes(':') && V6_RE.test(raw));
  if (!raw || !hostOk) return { error: 'The address must be a name or IP address such as 192.168.0.50 (no spaces or slashes).' };
  if (port && (!(port >= 1 && port <= 65535))) return { error: 'The port must be a number from 1 to 65535.' };
  const out = { id: old && old.id || String(d.id || '').replace(/[^a-z0-9]/g, '').slice(0, 12) || crypto.randomBytes(5).toString('hex'), name, type, host: raw.toLowerCase(), port: port || 0 };
  if (scheme) out.scheme = scheme;
  if (type === 'nomachine') {
    const user = String(d.user == null ? '' : d.user).trim();
    if (user && !/^[A-Za-z0-9._@\\-]{1,64}$/.test(user)) return { error: 'The user name can only have letters, numbers and . _ - @ \\' };
    out.user = user;
  }
  return { device: out };
}
function cleanList(list) {
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).slice(0, MAX).forEach((d) => {
    const c = cleanDevice(d, d && /^[a-z0-9]{3,12}$/.test(String(d.id || '')) ? { id: d.id } : null);
    if (c.device && !seen.has(c.device.id)) { seen.add(c.device.id); out.push(c.device); }
  });
  return out;
}
function defaultPort(dev) { return dev.port || (dev.type === 'nomachine' ? TYPES.nomachine.port : dev.scheme === 'http' ? 80 : 443); }
function webUrl(dev) {
  if (!dev || dev.type === 'nomachine') return '';
  const h = dev.host.includes(':') ? '[' + dev.host + ']' : dev.host;
  const def = dev.scheme === 'http' ? 80 : 443;
  const p = dev.port && dev.port !== def ? ':' + dev.port : '';
  return dev.scheme + '://' + h + p + '/';
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function nxsText(dev) {
  const L = ['<!DOCTYPE NXClientSettings>', '<NXClientSettings application="nxclient" version="2.0">', ' <group name="General">',
    '  <option key="Connection service" value="nx" />', '  <option key="Server host" value="' + esc(dev.host) + '" />', '  <option key="Server port" value="' + defaultPort(dev) + '" />', ' </group>'];
  if (dev.user) L.push(' <group name="Login">', '  <option key="User" value="' + esc(dev.user) + '" />', ' </group>');
  L.push('</NXClientSettings>', '');
  return L.join('\n');
}
function nxCandidates(platform, env) {
  env = env || {};
  const L = [];
  if (env.NXPLAYER_PATH) L.push(env.NXPLAYER_PATH);
  if (platform === 'win32') {
    [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean).forEach((b) => L.push(b + '\\NoMachine\\bin\\nxplayer.exe'));
  } else if (platform === 'darwin') {
    L.push('/Applications/NoMachine.app/Contents/Frameworks/bin/nxplayer');
  } else {
    L.push('/usr/NX/bin/nxplayer', '/usr/NX/scripts/nxplayer', '/usr/bin/nxplayer');
  }
  return L.filter((x, i) => L.indexOf(x) === i);
}
function findNxplayer(platform, env, exists) {
  for (const c of nxCandidates(platform, env)) { try { if (exists(c)) return c; } catch (e) { /* next */ } }
  return '';
}
// writes the connection file and starts NoMachine with it; nothing is run through a shell
function launchNx(dev, o) {
  return new Promise((resolve) => {
    if (!dev || dev.type !== 'nomachine') { resolve({ ok: false, error: 'That is not a NoMachine device.' }); return; }
    const exe = findNxplayer(o.platform, o.env, o.exists || fs.existsSync);
    if (!exe) { resolve({ ok: false, notInstalled: true, error: 'NoMachine is not installed on this computer (or Dashboard Hub cannot find it).' }); return; }
    let file;
    try { fs.mkdirSync(o.dir, { recursive: true }); file = path.join(o.dir, dev.id + '.nxs'); fs.writeFileSync(file, nxsText(dev), { mode: 0o600 }); } catch (e) { resolve({ ok: false, error: 'The connection file could not be written.' }); return; }
    let done = false; const fin = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      const child = o.spawn(exe, ['--session', file], { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (e) => fin({ ok: false, error: 'NoMachine could not be started: ' + (e && e.code || 'error') }));
      child.once('spawn', () => { try { child.unref(); } catch (e) { /* fine */ } fin({ ok: true, program: exe }); });
      setTimeout(() => fin({ ok: true, program: exe }), 1500);
    } catch (e) { fin({ ok: false, error: 'NoMachine could not be started.' }); }
  });
}

function load(file) { try { return cleanList(JSON.parse(fs.readFileSync(file, 'utf8')).devices); } catch (e) { return []; } }
function save(file, list) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ devices: list }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { TYPES, cleanDevice, cleanList, webUrl, nxsText, nxCandidates, findNxplayer, launchNx, load, save, defaultPort };
