// test helper: answers the "Install this update?" box with a chosen button so no person is needed
const { dialog } = require('electron');
global.__confirm = 0; global.__boxes = [];
dialog.showMessageBox = async function (a, b) { const o = b !== undefined ? b : a; global.__boxes.push(o); return { response: global.__confirm }; };
require('../main.js');
