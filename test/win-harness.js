// test helper: this test machine has no window manager, so "maximize" is pretended
const { BrowserWindow } = require('electron');
global.__maxCalled = false;
BrowserWindow.prototype.maximize = function () { global.__maxCalled = true; this.__fakeMax = true; };
BrowserWindow.prototype.isMaximized = function () { return !!this.__fakeMax; };
require('../main.js');
