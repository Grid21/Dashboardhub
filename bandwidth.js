'use strict';
// Running byte totals for this computer's own network cards (Linux, macOS, Windows). The Bandwidth Monitor turns two readings into a speed.
const fs = require('fs');
const { execFile } = require('child_process');

const VIRTUAL = /^(lo|veth|docker|br-|virbr|vmnet|vboxnet|tun|tap|utun|awdl|llw|bridge|gif|stf|ap\d|anpi|dummy|ifb)/i;

function parseProcNetDev(text) {
  const out = [];
  String(text).split('\n').slice(2).forEach((line) => {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m) return;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 9 || VIRTUAL.test(m[1])) return;
    if (Number.isFinite(f[0]) && Number.isFinite(f[8])) out.push({ name: m[1], rx: f[0], tx: f[8] });
  });
  return out;
}
function parseNetstatIb(text) {      // macOS: netstat -ibn
  const lines = String(text).split('\n');
  const head = (lines[0] || '').trim().split(/\s+/);
  const ri = head.indexOf('Ibytes'), ti = head.indexOf('Obytes');
  if (ri < 0 || ti < 0) return [];
  const seen = new Set(), out = [];
  lines.slice(1).forEach((line) => {
    const f = line.trim().split(/\s+/);
    if (f.length < head.length - 1 || !/^<Link#/.test(f[2] || '')) return;
    if (VIRTUAL.test(f[0]) || seen.has(f[0])) return;
    // rows without an address column have one field fewer, so count from the end
    const off = f.length - head.length;
    const rx = Number(f[ri + off]), tx = Number(f[ti + off]);
    if (Number.isFinite(rx) && Number.isFinite(tx)) { seen.add(f[0]); out.push({ name: f[0], rx: rx, tx: tx }); }
  });
  return out;
}
function parseNetstatE(text) {       // Windows: netstat -e  ("Bytes   123   456")
  const m = /^\s*Bytes\s+(\d+)\s+(\d+)/mi.exec(String(text));
  return m ? [{ name: 'All network cards', rx: Number(m[1]), tx: Number(m[2]) }] : [];
}
function run(cmd, args) {
  return new Promise((resolve) => {
    try { execFile(cmd, args, { timeout: 4000, windowsHide: true, maxBuffer: 2e6 }, (err, stdout) => resolve(err ? '' : String(stdout))); } catch (e) { resolve(''); }
  });
}
async function localCounters(platform) {
  const p = platform || process.platform;
  let ifs = [];
  if (p === 'linux') { try { ifs = parseProcNetDev(fs.readFileSync('/proc/net/dev', 'utf8')); } catch (e) { /* not readable */ } }
  else if (p === 'darwin') ifs = parseNetstatIb(await run('netstat', ['-ibn']));
  else if (p === 'win32') ifs = parseNetstatE(await run('netstat', ['-e']));
  if (!ifs.length) return null;
  return { kind: 'local', ports: ifs.slice(0, 16), rx: ifs.reduce((a, x) => a + x.rx, 0), tx: ifs.reduce((a, x) => a + x.tx, 0) };
}
module.exports = { localCounters, parseProcNetDev, parseNetstatIb, parseNetstatE };
