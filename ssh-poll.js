'use strict';
// Reads the address tables of a switch or router over SSH, without SNMP. It runs the system's own "ssh" program (the same one the
// SSH buttons use) with a fixed list of read-only "show" commands. Nothing typed by the user is ever run on the device:
// the commands come from the list below. Logins use your SSH key or agent; a password is supported on Linux and macOS.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const MAC_RE = /\b([0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|[0-9a-f]{6}-[0-9a-f]{6})\b/i;
const IP_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

// Each kind of device: what to run, and how to read the answer. parse(outputs) returns [{ mac, ip, name, port }].
const PROFILES = {
  linux: {
    label: 'Linux, OpenWrt, pfSense-like routers (ip neigh + DHCP leases)',
    commands: ['ip -4 neigh show', 'cat /tmp/dhcp.leases /var/lib/misc/dnsmasq.leases 2>/dev/null'],
    parse(out) {
      const rows = [];
      String(out[0] || '').split(/\r?\n/).forEach((l) => {
        const m = /^(\d{1,3}(?:\.\d{1,3}){3})\s.*?\blladdr\s+(\S+)\s+(.*)$/.exec(l.trim());
        if (!m || /\b(FAILED|INCOMPLETE)\b/.test(m[3])) return;
        const dev = /\bdev\s+(\S+)/.exec(l);
        rows.push({ ip: m[1], mac: m[2], port: dev ? dev[1] : '' });
      });
      String(out[1] || '').split(/\r?\n/).forEach((l) => {
        const p = l.trim().split(/\s+/);                       // epoch mac ip hostname clientid
        if (p.length >= 4 && /^\d+$/.test(p[0]) && MAC_RE.test(p[1]) && IP_RE.test(p[2])) rows.push({ mac: p[1], ip: p[2], name: p[3] === '*' ? '' : p[3], lease: true });
      });
      return rows;
    }
  },
  mikrotik: {
    label: 'MikroTik RouterOS (ARP + DHCP leases)',
    commands: ['/ip/arp/print terse', '/ip/dhcp-server/lease/print terse'],
    parse(out) {
      const rows = [];
      const kv = (line) => { const o = {}; String(line).replace(/([a-z][a-z-]*)=(\S*)/g, (_, k, v) => { o[k] = v; return ''; }); return o; };
      String(out[0] || '').split(/\r?\n/).forEach((l) => { const o = kv(l); const flags = (/^\s*\d+\s+([A-Z]*)\s*(?:\S+=|$)/.exec(l) || [])[1] || '';       // X = disabled, I = invalid
        if (o.address && o['mac-address'] && !/[XI]/.test(flags)) rows.push({ ip: o.address, mac: o['mac-address'], port: o.interface || '' }); });
      String(out[1] || '').split(/\r?\n/).forEach((l) => { const o = kv(l); if (o.address && o['mac-address']) rows.push({ ip: o.address, mac: o['mac-address'], name: o['host-name'] || o.comment || '', lease: true }); });
      return rows;
    }
  },
  cisco: {
    label: 'Cisco IOS / IOS XE (ARP + MAC address table with ports)',
    commands: ['show ip arp', 'show mac address-table dynamic'],
    parse(out) {
      const rows = [];
      String(out[0] || '').split(/\r?\n/).forEach((l) => {
        if (!/^Internet\b/i.test(l.trim())) return;
        const ip = IP_RE.exec(l), mac = MAC_RE.exec(l);
        if (ip && mac) rows.push({ ip: ip[1], mac: mac[1] });
      });
      const ports = new Map();
      String(out[1] || '').split(/\r?\n/).forEach((l) => {
        const mac = MAC_RE.exec(l); if (!mac) return;
        const port = /\b((?:Gi|Fa|Te|Twe|Fo|Hu|Eth|Po|Ap|Gig|Fast|Ten)[A-Za-z]*\d+(?:\/\d+){0,3})\s*$/i.exec(l.trim());
        if (port) ports.set(mac[1].toLowerCase(), port[1]);
      });
      rows.forEach((r) => { const k = String(r.mac).toLowerCase(); if (ports.has(k)) r.port = ports.get(k); });
      return rows;
    }
  },
  other: {
    label: 'Other switch or router (runs "show arp", reads address/MAC pairs)',
    commands: ['show arp'],
    parse(out) {
      const rows = [];
      String(out[0] || '').split(/\r?\n/).forEach((l) => { const ip = IP_RE.exec(l), mac = MAC_RE.exec(l); if (ip && mac) rows.push({ ip: ip[1], mac: mac[1] }); });
      return rows;
    }
  }
};

let sshOverride = null;                 // the automatic tests point this at a pretend ssh program
function setSshPath(p) { sshOverride = p || null; }
function findSsh() {
  if (sshOverride) return sshOverride;
  const names = process.platform === 'win32' ? ['ssh.exe'] : ['ssh'];
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32' && process.env.SystemRoot) dirs.push(path.join(process.env.SystemRoot, 'System32', 'OpenSSH'));
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch (e) { /* not here */ } }
  return null;
}

class SshError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

function runOne(c, command, sshPath) {
  return new Promise((resolve, reject) => {
    const args = ['-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'LogLevel=ERROR', '-o', 'NumberOfPasswordPrompts=1',
      '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-p', String(c.port), '-l', c.username];
    const env = Object.assign({}, process.env);
    let helperDir = null;
    if (c.password) {
      helperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubssh-'));
      const helper = path.join(helperDir, 'ask.sh');
      fs.writeFileSync(helper, '#!/bin/sh\nprintf \'%s\\n\' "$HUB_SSH_PW"\n', { mode: 0o700 });
      env.SSH_ASKPASS = helper; env.SSH_ASKPASS_REQUIRE = 'force'; env.DISPLAY = env.DISPLAY || ':0'; env.HUB_SSH_PW = c.password;
    } else {
      args.push('-o', 'BatchMode=yes');
    }
    args.push(c.host, command);
    let out = '', err = '', done = false;
    const cleanup = () => { if (helperDir) { try { fs.rmSync(helperDir, { recursive: true, force: true }); } catch (e) { /* gone */ } } };
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); cleanup(); fn(v); };
    const child = spawn(sshPath, args, { env: env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ended */ } finish(reject, new SshError('timeout', 'timeout')); }, 25000);
    child.stdout.on('data', (d) => { if (out.length < 300000) out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (err.length < 8000) err += d.toString('utf8'); });
    child.on('error', (e) => finish(reject, new SshError('bad', 'The ssh program could not be started: ' + e.message)));
    child.on('close', (code) => {
      if (code === 0 || (out.trim() && code !== 255)) return finish(resolve, out);
      const t = err;
      if (/permission denied|authentication failed|too many authentication/i.test(t)) return finish(reject, new SshError('auth', 'auth'));
      if (/host key verification failed|remote host identification has changed/i.test(t)) return finish(reject, new SshError('bad', 'The device\'s SSH identity has changed since the last time (or is not trusted). Remove its old line from your known_hosts file if you expected this, then try again.'));
      if (/connection refused/i.test(t)) return finish(reject, new SshError('refused', 'refused'));
      if (/timed out|no route to host|network is unreachable|could not resolve/i.test(t)) return finish(reject, new SshError('timeout', 'timeout'));
      if (/command not found|invalid input|unknown command|% invalid|syntax error|bad command/i.test(out + t)) return finish(reject, new SshError('bad', 'The device did not understand the command. Check the "device kind" (linux, mikrotik, cisco or other).'));
      return finish(reject, new SshError('bad', 'The SSH login did not work: ' + (t.trim().split(/\r?\n/).pop() || 'exit code ' + code).slice(0, 160)));
    });
  });
}

// Run every command of a profile; the first must work, later ones are optional (a missing lease file is normal).
async function readDevice(c, profileName) {
  const prof = PROFILES[profileName] || PROFILES.linux;
  const ssh = findSsh();
  if (!ssh) throw new SshError('bad', 'The ssh program is not installed. Install it with your package manager (for example: sudo apt install openssh-client). On Windows: Settings > Apps > Optional features > OpenSSH Client.');
  if (c.password && process.platform === 'win32') throw new SshError('bad', 'On Windows, SSH logins use an SSH key (password login is not supported here). Leave the password empty and set up key login, or use another connection type.');
  const outs = [];
  for (let i = 0; i < prof.commands.length; i++) {
    try { outs.push(await runOne(c, prof.commands[i], ssh)); }
    catch (e) { if (i === 0 || e.kind === 'auth' || e.kind === 'refused' || e.kind === 'timeout') throw e; outs.push(''); }
  }
  return { rows: prof.parse(outs), profile: prof };
}

module.exports = { PROFILES, readDevice, setSshPath, findSsh, SshError, MAC_RE };
