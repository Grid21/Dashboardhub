'use strict';
// Remembers where the main window was (which screen, how big, maximized) so it comes back there after a restart.
const fs = require('fs');
const path = require('path');

function num(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : null; }

function cleanSaved(j) {
  if (!j || typeof j !== 'object') return null;
  const x = num(j.x), y = num(j.y), width = num(j.width), height = num(j.height);
  if (x === null || y === null || width === null || height === null || width < 200 || height < 200) return null;
  return { x, y, width, height, maximized: j.maximized === true };
}

function contains(b, px, py) { return px >= b.x && px < b.x + b.width && py >= b.y && py < b.y + b.height; }

// saved: what we stored. displays: [{ bounds, workArea }] currently connected. defaults: { width, height }.
// Returns { bounds?, width, height, maximized }. bounds is only given when the old screen is still connected.
function pickBounds(saved, displays, defaults) {
  const s = cleanSaved(saved);
  const out = { width: defaults.width, height: defaults.height, maximized: false };
  if (!s || !Array.isArray(displays) || !displays.length) return out;
  // which connected screen holds the middle of the window? (if the external screen was unplugged, none does)
  const cx = s.x + Math.floor(s.width / 2), cy = s.y + Math.floor(s.height / 2);
  const d = displays.find((q) => q && q.bounds && contains(q.bounds, cx, cy));
  if (!d) { out.width = Math.min(s.width, displays[0].workArea.width); out.height = Math.min(s.height, displays[0].workArea.height); out.maximized = s.maximized; return out; }
  const wa = d.workArea || d.bounds;
  const width = Math.min(s.width, wa.width), height = Math.min(s.height, wa.height);
  // keep the whole window on that screen (resolution may have changed)
  const x = Math.max(wa.x, Math.min(s.x, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min(s.y, wa.y + wa.height - height));
  return { bounds: { x, y, width, height }, width, height, maximized: s.maximized };
}

function load(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function save(file, state) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (e) { /* not important: the window just opens in the default place next time */ }
}

module.exports = { pickBounds, cleanSaved, load, save };
