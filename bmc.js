'use strict';
// Server management (BMC): HPE iLO, Dell iDRAC, Supermicro, Lenovo XCC and anything else that speaks Redfish,
// the standard web interface of modern server management chips. Reads the power state and health, and can
// switch a server on (a BMC stays powered when the server is off) or ask it to shut down or restart.
const { httpRequest, ConnError, isPrivateIp } = require('./connectors');

const cleanText = (v, n) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function cleanBmc(o) {
  o = o && typeof o === 'object' ? o : {};
  const host = String(o.host || '').trim();
  if (!isPrivateIp(host)) throw new Error('Type the address of the management chip (iLO / iDRAC), a local address like 192.168.1.20.');
  const https = o.https !== false;
  const port = Number(o.port) || (https ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port must be a number from 1 to 65535.');
  const mac = String(o.mac || '').trim().toLowerCase().replace(/-/g, ':');
  return {
    name: cleanText(o.name, 60) || host, host: host, port: port, https: https,
    username: cleanText(o.username, 80), password: String(o.password || '').slice(0, 200),
    mac: /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) ? mac : ''
  };
}
// the same, but a login is required (to ask the chip)
function cleanConfig(o) {
  const c = cleanBmc(o);
  if (!c.username) throw new Error('Type the user name of an account on the management chip.');
  return c;
}

const get = async (c, p) => {
  const r = await httpRequest({ host: c.host, port: c.port, https: c.https, path: p, auth: c.username + ':' + c.password, timeout: 8000 });
  if (r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
  if (r.status === 404) throw new ConnError('notfound', p);
  if (r.status < 200 || r.status >= 300) throw new ConnError('bad', 'The management chip answered with an error (' + r.status + ').');
  try { return JSON.parse(r.text); } catch (e) { throw new ConnError('bad', 'The management chip did not answer with Redfish data. Is this the right address and port?'); }
};
const safeGet = async (c, p) => { try { return await get(c, p); } catch (e) { if (e.kind === 'auth') throw e; return null; } };
const firstLink = (j) => (j && Array.isArray(j.Members) && j.Members[0] && j.Members[0]['@odata.id']) || null;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function explain(e) {
  const kind = e && e.kind ? e.kind : 'bad';
  if (kind === 'refused') return { code: 'refused', error: 'Nothing answered at that address and port. Check the address (it is the management chip’s own address, not the server’s) and that its web interface is on.' };
  if (kind === 'timeout') return { code: 'timeout', error: 'No answer from the management chip. Check the address and that this computer can reach it.' };
  if (kind === 'auth') return { code: 'auth', error: 'The user name or password was refused. Use an account of the iLO / iDRAC / BMC itself.' };
  if (kind === 'notfound') return { code: 'bad', error: 'That device does not offer Redfish (an old management chip). Only modern ones are supported.' };
  if (e && e.message === 'tls') return { code: 'bad', error: 'The device did not speak the secure (https) protocol on that port. Try again with "Use https" switched off.' };
  return { code: 'bad', error: (e && e.message && !/^(refused|no answer)$/.test(e.message) ? e.message : 'The device gave an answer that could not be understood.') };
}

// what is the server doing? (power, health, model, temperatures, fans)
async function status(config) {
  let c;
  try { c = cleanConfig(config); } catch (e) { return { ok: false, code: 'config', error: e.message }; }
  try {
    const root = await get(c, '/redfish/v1/');
    const systems = await get(c, (root.Systems && root.Systems['@odata.id']) || '/redfish/v1/Systems');
    const sysPath = firstLink(systems);
    if (!sysPath) throw new ConnError('bad', 'The device lists no computer system.');
    const s = await get(c, sysPath);
    const resetAct = s.Actions && s.Actions['#ComputerSystem.Reset'];
    const allowed = resetAct && (resetAct['ResetType@Redfish.AllowableValues'] || (resetAct['@Redfish.ActionInfo'] ? null : [])) || [];
    const out = {
      ok: true, host: c.host,
      power: cleanText(s.PowerState, 20) || 'Unknown',
      health: cleanText(s.Status && (s.Status.HealthRollup || s.Status.Health), 20) || '',
      state: cleanText(s.Status && s.Status.State, 30) || '',
      manufacturer: cleanText(s.Manufacturer, 60), model: cleanText(s.Model, 80), serial: cleanText(s.SerialNumber, 60), sku: cleanText(s.SKU, 60),
      hostName: cleanText(s.HostName, 60), bios: cleanText(s.BiosVersion, 60),
      cpus: s.ProcessorSummary && num(s.ProcessorSummary.Count) ? num(s.ProcessorSummary.Count) + ' \u00d7 ' + cleanText(s.ProcessorSummary.Model, 80) : '',
      memoryGiB: s.MemorySummary && num(s.MemorySummary.TotalSystemMemoryGiB) ? Math.round(num(s.MemorySummary.TotalSystemMemoryGiB)) : null,
      watts: null, temps: [], fans: [], bmc: null,
      canOn: false, canShutdown: false, canRestart: false
    };
    const has = (v) => !resetAct ? false : (!Array.isArray(allowed) || allowed.length === 0) ? true : allowed.includes(v);
    out.canOn = has('On') || has('PushPowerButton');
    out.canShutdown = has('GracefulShutdown');
    out.canRestart = has('GracefulRestart');
    // the management chip's own firmware
    const mgrs = await safeGet(c, (root.Managers && root.Managers['@odata.id']) || '/redfish/v1/Managers');
    const mp = firstLink(mgrs);
    const m = mp ? await safeGet(c, mp) : null;
    if (m) out.bmc = { model: cleanText(m.Model, 40), firmware: cleanText(m.FirmwareVersion, 40) };
    // temperatures and fans
    const chassisList = await safeGet(c, (root.Chassis && root.Chassis['@odata.id']) || '/redfish/v1/Chassis');
    const cp = firstLink(chassisList);
    const ch = cp ? await safeGet(c, cp) : null;
    const thermalPath = ch && ch.Thermal && ch.Thermal['@odata.id'];
    const th = thermalPath ? await safeGet(c, thermalPath) : null;
    if (th) {
      (Array.isArray(th.Temperatures) ? th.Temperatures : []).slice(0, 40).forEach((t) => {
        const v = num(t.ReadingCelsius);
        if (v !== null && v > -50 && v < 200) out.temps.push({ name: cleanText(t.Name, 40), c: Math.round(v * 10) / 10, health: cleanText(t.Status && t.Status.Health, 20) });
      });
      (Array.isArray(th.Fans) ? th.Fans : []).slice(0, 40).forEach((f) => {
        const v = num(f.Reading !== undefined ? f.Reading : f.ReadingRPM);
        out.fans.push({ name: cleanText(f.Name || f.FanName, 40), reading: v, units: cleanText(f.ReadingUnits || (f.ReadingRPM !== undefined ? 'RPM' : ''), 12), health: cleanText(f.Status && f.Status.Health, 20) });
      });
    }
    // power draw
    const powerPath = ch && ch.Power && ch.Power['@odata.id'];
    const pw = powerPath ? await safeGet(c, powerPath) : null;
    if (pw && Array.isArray(pw.PowerControl) && pw.PowerControl[0]) { const w = num(pw.PowerControl[0].PowerConsumedWatts); if (w !== null && w >= 0 && w < 100000) out.watts = w; }
    out.resetTarget = resetAct && resetAct.target ? String(resetAct.target) : '';
    return out;
  } catch (e) { const x = explain(e); return { ok: false, code: x.code, error: x.error }; }
}

// action: 'on' | 'shutdown' | 'restart'
async function power(config, action) {
  let c;
  try { c = cleanConfig(config); } catch (e) { return { ok: false, code: 'config', error: e.message }; }
  const want = { on: ['On', 'PushPowerButton'], shutdown: ['GracefulShutdown'], restart: ['GracefulRestart'] }[action];
  if (!want) return { ok: false, code: 'config', error: 'Unknown power action.' };
  try {
    const st = await status(c);
    if (!st.ok) return st;
    if (action === 'on' && /^on$/i.test(st.power)) return { ok: true, message: 'The server is already on.' };
    if (action !== 'on' && /^off$/i.test(st.power)) return { ok: false, code: 'bad', error: 'The server is off, so it cannot be ' + (action === 'restart' ? 'restarted' : 'shut down') + '.' };
    if (!st.resetTarget) return { ok: false, code: 'bad', error: 'This management chip does not offer power control.' };
    const root = await get(c, st.resetTarget.replace(/\/Actions\/.*$/, ''));
    const act = root.Actions && root.Actions['#ComputerSystem.Reset'];
    const allowed = act && Array.isArray(act['ResetType@Redfish.AllowableValues']) ? act['ResetType@Redfish.AllowableValues'] : null;
    const type = want.find((w) => !allowed || allowed.includes(w));
    if (!type) return { ok: false, code: 'bad', error: 'This server’s management chip does not allow that action.' };
    const r = await httpRequest({ host: c.host, port: c.port, https: c.https, path: st.resetTarget, method: 'POST', json: { ResetType: type }, auth: c.username + ':' + c.password, timeout: 15000 });
    if (r.status === 401 || r.status === 403) throw new ConnError('auth', 'refused');
    if (r.status < 200 || r.status >= 300) {
      let why = '';
      try { const j = JSON.parse(r.text); why = cleanText(j.error && (j.error.message || (j.error['@Message.ExtendedInfo'] && j.error['@Message.ExtendedInfo'][0] && j.error['@Message.ExtendedInfo'][0].Message)), 160); } catch (e) { /* no detail */ }
      return { ok: false, code: 'bad', error: 'The management chip refused the request (' + r.status + ').' + (why ? ' ' + why : '') };
    }
    return { ok: true, message: action === 'on' ? 'Power-on sent.' : action === 'shutdown' ? 'Shutdown requested.' : 'Restart requested.' };
  } catch (e) { const x = explain(e); return { ok: false, code: x.code, error: x.error }; }
}

module.exports = { cleanBmc, cleanConfig, status, power };
