'use strict';
//   xvfb-run -a node test/ssh-ui-test.js    (a pretend ssh program is put first on the PATH)
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT_DIR || '/home/claude/.npm-global/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, ok, d) => { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'pathssh-'));
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh
for a in "$@"; do last="$a"; done
case "$last" in
  "ip -4 neigh show") echo "192.168.0.10 dev br-lan lladdr aa:bb:cc:00:00:10 REACHABLE"; echo "192.168.0.11 dev br-lan lladdr aa:bb:cc:00:00:11 STALE";;
  cat*) echo "1730000000 aa:bb:cc:00:00:10 192.168.0.10 living-room-tv *";;
  *) exit 1;;
esac
`, { mode: 0o755 });
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sshud-'));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--user-data-dir=' + ud], env: Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH }) });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#tabMap'); await page.click('#tabMap'); await sleep(500);
  await page.click('#mapConnBtn'); await sleep(600);
  const types = await page.evaluate(() => [...document.getElementById('connType').options].map((o) => o.value + '|' + o.textContent));
  check('"SSH" is in the list of connection types', types.some((t) => /^ssh\|.*SSH/.test(t)), JSON.stringify(types.slice(-3)));
  await page.selectOption('#connType', 'ssh'); await sleep(200);
  const ui = await page.evaluate(() => ({ port: document.getElementById('connPort').value, httpsHidden: document.getElementById('connHttpsRow').classList.contains('hidden'), kindLabel: document.getElementById('connSiteLabel').textContent, kindShown: !document.getElementById('connSiteRow').classList.contains('hidden'), userShown: !document.getElementById('connUserRow').classList.contains('hidden'), secret: document.getElementById('connSecretLabel').textContent, help: document.getElementById('connHelp').textContent, v3: document.getElementById('connV3Auth').classList.contains('hidden') }));
  check('port 22 is filled in', ui.port === '22');
  check('the https option is hidden', ui.httpsHidden);
  check('there is a "device kind" box and a user name box', ui.kindShown && /Device kind/.test(ui.kindLabel) && ui.userShown);
  check('the password box explains that empty means SSH key', /empty = use your SSH key/.test(ui.secret), ui.secret);
  check('the help text explains what it does and that no SNMP is needed', /No SNMP needed/.test(ui.help) && /fixed read-only/.test(ui.help));
  check('no SNMP-only boxes are showing', ui.v3);
  await page.fill('#connHost', '192.168.0.2'); await page.fill('#connUser', 'admin'); await page.fill('#connSite', 'linux');
  await page.click('#connTest'); await sleep(2500);
  let say = await page.evaluate(() => document.getElementById('connMsg').textContent);
  check('Test says it works and counts the machines', /It works\. 2 machines reported/.test(say), say);
  await page.fill('#connUser', '-oBad'); await page.click('#connTest'); await sleep(800);
  say = await page.evaluate(() => document.getElementById('connMsg').textContent);
  check('a bad user name is explained in plain words', /Type the SSH user name/.test(say), say);
  await page.fill('#connUser', 'admin'); await page.fill('#connName', 'Core router'); await page.click('#connSave'); await sleep(1200);
  const saved = await page.evaluate(() => window.connApi.list());
  const c = (saved.list || saved).find((x) => x.type === 'ssh');
  check('the connection is saved with its device kind and no password', c && c.site === 'linux' && c.username === 'admin' && c.hasSecret === false, JSON.stringify(c));
  // it reaches the map: ask the devices now
  await page.click('#connSync'); await sleep(3500);
  const msg2 = await page.evaluate(() => document.getElementById('connMsg').textContent);
  check('"Ask them now" reads the machines through SSH', /Core router|192\.168\.0\.2/.test(msg2) && !/did not work|refused|not installed/i.test(msg2), msg2);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await app.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})();
