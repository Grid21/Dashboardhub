// test helper: stands in for the system "open file" box so the test can see where it would open and pick a file
const { dialog } = require('electron');
const fs = require('fs');
global.__dialogCalls = [];
dialog.showOpenDialog = async function (a, b) {
  const o = b !== undefined ? b : a;
  global.__dialogCalls.push({ title: o.title, defaultPath: o.defaultPath });
  const next = global.__nextPick;
  global.__nextPick = null;
  return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
};
require('../main.js');
