'use strict';
// Builds a small bundle with only what the Docker version needs (about 1 MB), so it can be fetched with curl:
//   node tools/make-docker-bundle.js <output folder>
// Result: dashboard-hub-docker.tar.gz  (unpack it, edit docker-compose.yml, run: docker compose up -d --build)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || '.');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const name = 'dashboard-hub-docker';
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dhb-'));
const dir = path.join(tmp, name);
fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
['scanner.js', 'discovery.js', 'notif-history.js', 'remote.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)));
// the bundle's package.json also says which image version it needs (dockerBase) so the server can tell when a rebuild is required
const BASE = Number((/DASHBOARD_HUB_BASE=(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'docker', 'Dockerfile'), 'utf8')) || [])[1]) || 1;
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); pj.dockerBase = BASE; if (process.env.DOCKER_NOTES) pj.dockerNotes = String(process.env.DOCKER_NOTES).slice(0, 300);
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'vendor', 'oui.json'), path.join(dir, 'vendor', 'oui.json'));
['server.js', 'updater.js', 'boot.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'docker', f), path.join(dir, f)));
fs.copyFileSync(path.join(ROOT, 'docker', 'README-DOCKER.md'), path.join(dir, 'README-DOCKER.md'));
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
// the same Dockerfile and compose file, with the paths of this flat folder
fs.writeFileSync(path.join(dir, 'Dockerfile'), fs.readFileSync(path.join(ROOT, 'docker', 'Dockerfile'), 'utf8')
  .replace('Build from the folder ABOVE this one (docker-compose.yml does that for you).', 'Build from this folder (docker-compose.yml does that for you).')
  .replace('COPY docker/server.js docker/updater.js docker/boot.js ./docker/', 'COPY server.js updater.js boot.js ./docker/'));
fs.writeFileSync(path.join(dir, 'docker-compose.yml'), fs.readFileSync(path.join(ROOT, 'docker', 'docker-compose.yml'), 'utf8')
  .replace('context: ..', 'context: .').replace('dockerfile: docker/Dockerfile', 'dockerfile: Dockerfile'));
fs.writeFileSync(path.join(dir, '.dockerignore'), '*.md\n*.tar.gz\n');
fs.writeFileSync(path.join(dir, 'VERSION.txt'), 'Dashboard Hub ' + version + ' (Docker bundle)\n');
const readme = fs.readFileSync(path.join(dir, 'README-DOCKER.md'), 'utf8')
  .replace(/1\. Copy the whole Dashboard Hub source folder[\s\S]*?4\. Open/, '1. Get this bundle onto the Linux machine and unpack it, for example:\n   ```\n   curl -L -o dashboard-hub-docker.tar.gz <the address you were given>\n   tar xzf dashboard-hub-docker.tar.gz\n   cd dashboard-hub-docker\n   ```\n2. Open `docker-compose.yml` in a text editor (for example `nano docker-compose.yml`) and **change `DASHBOARD_HUB_CODE`** to an access code of your own (6 or more characters). You can also set the name, your panels and the scan interval there.\n3. Start it:\n   ```\n   docker compose up -d --build\n   ```\n4. Open')
  .replace('copy the newer source folder over the old one and run `docker compose up -d --build` again in the `docker` folder.', 'unpack the newer bundle over the old folder (keep your edited `docker-compose.yml`) and run `docker compose up -d --build` again.');
fs.writeFileSync(path.join(dir, 'README-DOCKER.md'), readme);
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, name + '.tar.gz');
cp.execFileSync('tar', ['-czf', file, '-C', tmp, name]);
// Containers built from 1.29.0 and 1.29.1 look for the OLD kind of update (a numbered file plus a small list with its fingerprint).
// Keep making that pair, so those containers can still update themselves. (test/docker-update-test.js checks it against the real 1.29.1 program.)
const legacy = path.join(out, 'for-old-containers'); fs.mkdirSync(legacy, { recursive: true });
const lname = name + '-' + version + '.tar.gz';
fs.copyFileSync(file, path.join(legacy, lname));
fs.writeFileSync(path.join(legacy, name + '-latest.json'), JSON.stringify({ version: version, file: lname, sha256: require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'), base: BASE, notes: String(process.env.DOCKER_NOTES || '').slice(0, 300) }, null, 1) + '\n');
console.log('Bundle: ' + file + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
fs.rmSync(tmp, { recursive: true, force: true });
