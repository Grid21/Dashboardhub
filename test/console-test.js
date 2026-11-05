'use strict';
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron test/console-test.js   (or plain node)
const sc = require('../scanner.js');
let passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  ok    ' + n); } else { failed++; console.log('  FAIL  ' + n + (d !== undefined ? '   -> ' + d : '')); } }
const g = (h) => sc.guessOs(Object.assign({ ip: '10.0.0.50', ports: [] }, h), '10.0.0.1').id;
check('PlayStation (Sony Interactive) -> console', g({ vendor: 'Sony Interactive Entertainment Inc.', ttl: 64 }) === 'console');
check('Nintendo Switch -> console (not a network switch)', g({ vendor: 'Nintendo Co.,Ltd', hostname: 'Nintendo-Switch', ttl: 64 }) === 'console');
check('Nintendo with no hostname -> console', g({ vendor: 'Nintendo Co., Ltd.', ttl: 64 }) === 'console');
check('Steam Deck (Valve) -> console', g({ vendor: 'Valve Corporation', ttl: 64 }) === 'console');
check('Xbox by name (Microsoft maker) -> console', g({ vendor: 'Microsoft Corp.', hostname: 'XboxOne', ttl: 128 }) === 'console');
check('Windows PC from Microsoft Surface stays Windows', g({ vendor: 'Microsoft Corporation', hostname: 'SURFACE-PC', ttl: 128, ports: [{ port: 445 }, { port: 3389 }] }) === 'windows');
check('Microsoft device with no console hint stays Windows', g({ vendor: 'Microsoft Corp.', ttl: 128 }) === 'windows');
check('PS5 by name when maker unknown -> console', g({ hostname: 'PS5-12345', ttl: 64 }) === 'console');
check('real network switch still a switch', g({ vendor: 'Netgear', hostname: 'Switch-Office', ports: [{ port: 161 }, { port: 80, title: 'Smart Managed Switch' }], ttl: 255 }) === 'switch');
check('a PC with a Sony Interactive-looking name but SSH/SMB open is not forced to console', g({ vendor: 'Sony Interactive Entertainment Inc.', ports: [{ port: 445 }, { port: 3389 }], ttl: 128 }) !== 'console');
check('label is Game console', sc.guessOs({ ip: '10.0.0.50', ports: [], vendor: 'Nintendo Co.,Ltd', ttl: 64 }, '10.0.0.1').label === 'Game console');
const v = require('../validate.js');
const net = v.cleanNetwork({ router: '10.0.0.1', devices: { router: { key: 'router', ip: '10.0.0.1', isRouter: true }, 'aa:bb:cc:00:00:01': { key: 'aa:bb:cc:00:00:01', mac: 'aa:bb:cc:00:00:01', ip: '10.0.0.5', osOverride: 'console', os: { id: 'console', label: 'Game console', confidence: 'high', reasons: [] }, online: true } }, links: [] });
const dv = net && net.devices['aa:bb:cc:00:00:01'];
check('backup keeps the console type', dv && dv.os && dv.os.id === 'console' && dv.osOverride === 'console', JSON.stringify(dv && [dv.os, dv.osOverride]));
console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
