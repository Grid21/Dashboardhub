'use strict';
// node test/ssh-test.js   (no window needed; a pretend "ssh" program answers like real devices)
const fs = require('fs'), os = require('os'), path = require('path');
const connectors = require('../connectors'), sshpoll = require('../ssh-poll');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -> ' + d : '')); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakessh-')), log = path.join(dir, 'calls.log');
const fake = path.join(dir, 'ssh');
fs.writeFileSync(fake, `#!/bin/sh
# pretend ssh: last argument is the command, the one before is the host
for a in "$@"; do last="$a"; done
host=""; prev=""; for a in "$@"; do if [ "$a" = "$last" ]; then host="$prev"; fi; prev="$a"; done
echo "HOST=$host ARGS=$*" >> "${log}"
echo "ASKPASS=$SSH_ASKPASS REQUIRE=$SSH_ASKPASS_REQUIRE" >> "${log}"
case "$host" in
  10.9.9.2) echo "user@10.9.9.2: Permission denied (publickey,password)." >&2; exit 255;;
  10.9.9.3) echo "ssh: connect to host 10.9.9.3 port 22: Connection refused" >&2; exit 255;;
  10.9.9.4) pw=$("$SSH_ASKPASS" 2>/dev/null); if [ "$pw" != "s3cret pass" ]; then echo "Permission denied" >&2; exit 255; fi;;
esac
case "$last" in
  "ip -4 neigh show"*)
    echo "192.168.0.10 dev br-lan lladdr aa:bb:cc:00:00:10 REACHABLE"
    echo "192.168.0.11 dev br-lan lladdr aa:bb:cc:00:00:11 STALE"
    echo "192.168.0.12 dev br-lan  FAILED"
    echo "192.168.0.13 dev br-lan lladdr aa:bb:cc:00:00:13 INCOMPLETE"
    echo "@@HUB-SPLIT@@"
    echo "1730000000 aa:bb:cc:00:00:10 192.168.0.10 living-room-tv 01:aa:bb:cc:00:00:10"
        echo "1730000001 aa:bb:cc:00:00:11 192.168.0.11 * *"
        echo "1730000002 aa:bb:cc:00:00:99 192.168.0.99 gone-device *";;
  "/ip/arp/print terse")
    echo " 0 D address=192.168.88.10 mac-address=AA:BB:CC:00:01:10 interface=bridge"
    echo " 1   address=192.168.88.11 mac-address=AA:BB:CC:00:01:11 interface=ether3"
    echo " 2 DI address=192.168.88.12 mac-address=AA:BB:CC:00:01:12 interface=bridge";;
  "/ip/dhcp-server/lease/print terse")
    echo " 0 address=192.168.88.10 mac-address=AA:BB:CC:00:01:10 host-name=printer-office server=dhcp1"
    echo " 1 address=192.168.88.11 mac-address=AA:BB:CC:00:01:11 comment=NAS server=dhcp1";;
  "show ip arp")
    echo "Protocol  Address          Age (min)  Hardware Addr   Type   Interface"
    echo "Internet  10.1.1.20               5   aabb.cc00.0220  ARPA   Vlan10"
    echo "Internet  10.1.1.21               -   aabb.cc00.0221  ARPA   Vlan10";;
  "show mac address-table dynamic")
    echo "Vlan    Mac Address       Type        Ports"
    echo "----    -----------       --------    -----"
    echo "  10    aabb.cc00.0220    DYNAMIC     Gi1/0/5"
    echo "  10    aabb.cc00.0221    DYNAMIC     Gi1/0/12"
    echo "Total Mac Addresses for this criterion: 2";;
  "show arp")
    echo "Address         HWtype  HWaddress           Flags Mask  Iface"
    echo "172.16.0.5      ether   aa-bb-cc-00-03-05   C           eth0"
    echo "172.16.0.6      ether   aabbcc-000306       C           eth0";;
  *) echo "unknown command: $last" >&2; exit 1;;
esac
`, { mode: 0o755 });
sshpoll.setSshPath(fake);
const cfg = (o) => Object.assign({ type: 'ssh', host: '10.9.9.1', port: 22, username: 'admin', password: '', site: 'linux' }, o);
const byIp = (r) => Object.fromEntries((r.clients || []).map((c) => [c.ip, c]));

(async () => {
  console.log('Linux / OpenWrt (neighbour table + DHCP leases)');
  let r = await connectors.poll(cfg({}));
  let m = byIp(r);
  check('the connection works', r.ok === true, JSON.stringify(r).slice(0, 200));
  check('machines come from the neighbour table', m['192.168.0.10'] && m['192.168.0.11'] && Object.keys(m).length === 2, Object.keys(m).join(','));
  check('failed and incomplete entries are ignored', !m['192.168.0.12'] && !m['192.168.0.13']);
  check('names come from the DHCP leases', m['192.168.0.10'].name === 'living-room-tv', m['192.168.0.10'] && m['192.168.0.10'].name);
  check('a lease for a machine that is not answering is not listed', !m['192.168.0.99']);
  check('a "*" name in the lease file means no name', m['192.168.0.11'].name === '');
  check('the interface is shown', m['192.168.0.10'].via === 'port br-lan', m['192.168.0.10'].via);
  check('addresses are tidied (lower case, colons)', m['192.168.0.10'].mac === 'aa:bb:cc:00:00:10');

  const logins = fs.readFileSync(log, 'utf8').split('\n').filter((x) => x.startsWith('HOST=10.9.9.1')).length;
  check('a Linux router is read in one login, not two', logins === 1, 'logins so far: ' + logins);

  console.log('MikroTik');
  r = await connectors.poll(cfg({ site: 'mikrotik' })); m = byIp(r);
  check('ARP + lease names', r.ok && m['192.168.88.10'] && m['192.168.88.10'].name === 'printer-office' && m['192.168.88.11'].name === 'NAS', JSON.stringify(Object.values(m).map((x) => [x.ip, x.name])));
  check('invalid (disabled) ARP rows are skipped', !m['192.168.88.12']);
  check('it is described as a MikroTik router', r.self.brand === 'MikroTik');

  console.log('Cisco');
  r = await connectors.poll(cfg({ site: 'cisco' })); m = byIp(r);
  check('ARP table read (dotted address format)', r.ok && m['10.1.1.20'] && m['10.1.1.21'] && m['10.1.1.20'].mac === 'aa:bb:cc:00:02:20', JSON.stringify(Object.keys(m)));
  check('the switch port of each machine comes from the MAC table', m['10.1.1.20'].via === 'port Gi1/0/5' && m['10.1.1.21'].via === 'port Gi1/0/12', JSON.stringify(Object.values(m).map((x) => x.via)));
  check('it is described as a switch', r.self.kind === 'switch');

  console.log('Other devices ("show arp")');
  r = await connectors.poll(cfg({ site: 'other' })); m = byIp(r);
  check('address/MAC pairs are found in different formats', r.ok && m['172.16.0.5'] && m['172.16.0.6'] && m['172.16.0.6'].mac === 'aa:bb:cc:00:03:06', JSON.stringify(Object.keys(m)));

  console.log('Problems are explained');
  r = await connectors.poll(cfg({ host: '10.9.9.2' })); check('a refused login says so and mentions the SSH key', r.ok === false && r.code === 'auth' && /SSH key/.test(r.error), JSON.stringify(r));
  r = await connectors.poll(cfg({ host: '10.9.9.3' })); check('a closed SSH port says so', r.ok === false && r.code === 'refused' && /SSH must be switched on/.test(r.error), JSON.stringify(r));
  sshpoll.setSshPath(null); const oldPath = process.env.PATH; process.env.PATH = '/nonexistent';
  r = await connectors.poll(cfg({})); process.env.PATH = oldPath; sshpoll.setSshPath(fake);
  check('a missing ssh program is explained', r.ok === false && /ssh program is not installed/.test(r.error), JSON.stringify(r));

  console.log('Safety');
  fs.writeFileSync(log, '');
  await connectors.poll(cfg({}));
  let L = fs.readFileSync(log, 'utf8');
  check('with no password the login is key-only (BatchMode, never asks)', /BatchMode=yes/.test(L));
  fs.writeFileSync(log, '');
  r = await connectors.poll(cfg({ host: '10.9.9.4', password: 's3cret pass' }));
  L = fs.readFileSync(log, 'utf8');
  check('a password login works through the askpass helper', r.ok === true, JSON.stringify(r).slice(0, 160));
  check('the password is never put on the command line', !/s3cret/.test(L.split('\n').filter((x) => x.startsWith('HOST=')).join('')));
  check('askpass is used and BatchMode is off', /REQUIRE=force/.test(L) && !/BatchMode=yes/.test(L.split('\n').filter((x) => x.startsWith('HOST=')).join('')));
  const helper = (/ASKPASS=(\S+)/.exec(L) || [])[1];
  check('the temporary password helper is deleted afterwards', helper && !fs.existsSync(helper), helper);
  r = await connectors.poll(cfg({ host: '10.9.9.4', password: 'wrong' })); check('a wrong password is reported as a refused login', r.ok === false && r.code === 'auth');
  r = await connectors.poll(cfg({ username: '-oProxyCommand=evil' })); check('a user name that looks like an option is refused', r.ok === false && r.code === 'config');
  r = await connectors.poll(cfg({ username: 'a b' })); check('a user name with spaces is refused', r.ok === false && r.code === 'config');
  r = await connectors.poll(cfg({ site: 'rm -rf' })); check('only the listed device kinds are accepted (no free commands)', r.ok === false && r.code === 'config');
  r = await connectors.poll(cfg({ host: '8.8.8.8' })); check('only private network addresses are allowed', r.ok === false && r.code === 'config');
  r = await connectors.poll(cfg({ username: '' })); check('a user name is required', r.ok === false && r.code === 'config');

  console.log('Policy');
  connectors.setPolicy({ snmpEnabled: false });
  r = await connectors.poll(cfg({})); check('SSH keeps working when SNMP is switched off (this is the SNMP-free way)', r.ok === true);
  connectors.setPolicy({ snmpEnabled: true });
  check('SSH is in the list of connection types', !!connectors.TYPES.ssh && /SSH/.test(connectors.TYPES.ssh.label));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
