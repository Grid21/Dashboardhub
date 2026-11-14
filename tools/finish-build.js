'use strict';
// Runs after electron-builder. Tidies the "Dashboard Hub" folder so it only holds what a person needs.
//   Windows: Dashboard-Hub-Setup.exe (installer with an uninstaller) + "Run without installing" folder
//   Linux:   Dashboard-Hub.AppImage
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'Dashboard Hub');
if (!fs.existsSync(out)) { console.log('Nothing to tidy: the "Dashboard Hub" folder was not made.'); process.exit(1); }
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
['builder-debug.yml', 'builder-effective-config.yaml'].forEach((f) => rm(path.join(out, f)));
const win = path.join(out, 'win-unpacked');
if (fs.existsSync(win)) {
  const nice = path.join(out, 'Run without installing');
  rm(nice);
  fs.renameSync(win, nice);
}
rm(path.join(out, 'linux-unpacked'));
console.log('Finished. In the "Dashboard Hub" folder:');
fs.readdirSync(out).forEach((f) => console.log('  ' + f));
