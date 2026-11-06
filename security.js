'use strict';
// Security settings you can change. Everything not listed here (page isolation, update-file checks, "only addresses inside your own network") is fixed on purpose.
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  certs: 'local',            // 'local': accept self-signed certificates for your panels and local network; 'strict': only valid certificates
  allowMedia: true,          // panels may use camera / microphone / speakers (your own panels and local network only)
  allowNotifications: true,  // panels may show desktop notifications
  allowClipboard: true,      // panels may read the clipboard
  popups: true,              // panels may open new web windows (web addresses only)
  thoroughScan: true,        // the "thorough" scan (ports 1 to 1024) is available
  connectors: true,          // router / switch / controller connections may run
  meraki: true,              // Cisco Meraki (cloud) may be contacted
  snmpV3Only: false          // refuse SNMP version 1 and 2c (they send the community name as plain text)
});
const STRICT = Object.freeze({ certs: 'strict', allowMedia: false, allowNotifications: false, allowClipboard: false, popups: false, thoroughScan: false, connectors: true, meraki: false, snmpV3Only: true });

function clean(o) {
  const out = Object.assign({}, DEFAULTS);
  if (!o || typeof o !== 'object') return out;
  if (o.certs === 'strict' || o.certs === 'local') out.certs = o.certs;
  Object.keys(DEFAULTS).forEach((k) => { if (typeof DEFAULTS[k] === 'boolean' && typeof o[k] === 'boolean') out[k] = o[k]; });
  return out;
}

let dir = null, cache = null;
function file() { return path.join(dir, 'security.json'); }
function init(userDataDir) { dir = userDataDir; cache = null; }
function get() {
  if (cache) return cache;
  let v = null;
  try { v = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { /* none saved yet: the defaults apply */ }
  cache = clean(v);
  return cache;
}
// only known settings with valid values count; anything else is ignored, so junk can never loosen a setting
function validPatch(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (o.certs === 'strict' || o.certs === 'local') out.certs = o.certs;
  Object.keys(DEFAULTS).forEach((k) => { if (typeof DEFAULTS[k] === 'boolean' && typeof o[k] === 'boolean') out[k] = o[k]; });
  return out;
}
function set(o) {
  const next = clean(Object.assign({}, get(), validPatch(o)));
  try {
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) { return { ok: false, error: 'The security settings could not be saved.' }; }
  cache = next;
  return { ok: true, settings: next };
}
function preset(name) { return set(name === 'strict' ? STRICT : DEFAULTS); }

module.exports = { DEFAULTS, STRICT, clean, init, get, set, preset };
