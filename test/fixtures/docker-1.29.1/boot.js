'use strict';
// The small starter of the Docker version. It runs the program and restarts it after an update.
//  - If an update was installed in the data folder (/data/app/current.json) and it is newer than the program inside the image, that copy runs.
//  - If an updated copy stops within 30 seconds of starting, it is marked as bad and the program inside the image runs instead.
//  - Exit code 42 from the program means "restart me with the new files".
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const BAKED = path.join(__dirname, '..');
const DATA = process.env.DASHBOARD_HUB_DATA || '/data';
const APP = path.join(DATA, 'app');
const log = (m) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19) + '  [starter] ' + m);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const ver = (dir) => { const j = readJson(path.join(dir, 'package.json')); return j && typeof j.version === 'string' ? j.version : '0.0.0'; };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

function pick() {
  const cur = readJson(path.join(APP, 'current.json'));
  if (cur && /^\d+\.\d+\.\d+$/.test(String(cur.version)) && path.resolve(String(cur.dir)) === path.join(APP, cur.version)) {
    const dir = path.join(APP, cur.version);
    if (fs.existsSync(path.join(dir, 'docker', 'server.js')) && ver(dir) === cur.version && newer(cur.version, ver(BAKED))) return { dir, version: cur.version, updated: true };
  }
  return { dir: BAKED, version: ver(BAKED), updated: false };
}
function markBad(version) {
  try {
    const f = path.join(APP, 'bad.json'), j = readJson(f) || { versions: [] };
    if (!j.versions.includes(version)) j.versions.push(version);
    fs.writeFileSync(f, JSON.stringify(j));
    fs.rmSync(path.join(APP, 'current.json'), { force: true });
  } catch (e) { /* the next start will try again */ }
}
let child = null, stopping = false;
function run() {
  const p = pick(), started = Date.now();
  if (p.updated) log('Running the updated version ' + p.version + '.');
  child = spawn(process.execPath, [path.join(p.dir, 'docker', 'server.js')], { stdio: 'inherit', env: Object.assign({}, process.env, { DASHBOARD_HUB_SRC: p.dir, DASHBOARD_HUB_BOOT: '1', DASHBOARD_HUB_BASE: process.env.DASHBOARD_HUB_BASE || '1' }) });
  child.on('exit', (code, sig) => {
    child = null;
    if (stopping) return process.exit(code || 0);
    if (code === 42) { log('Restarting with the new files.'); return run(); }
    if (p.updated && Date.now() - started < 30000) { log('Version ' + p.version + ' stopped right after starting. Going back to the built-in version.'); markBad(p.version); return run(); }
    process.exit(code === null ? 1 : code);
  });
}
['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => { stopping = true; if (child) child.kill(s); else process.exit(0); }));
run();
