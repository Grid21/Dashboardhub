# Third-party notices

Dashboard Hub itself is licensed under the GNU General Public License v3 or later (see `LICENSE`).
It includes or is built with the following open-source components. All of them are under licenses that are compatible with the GPL.

| Component | Used for | License |
|---|---|---|
| [three.js](https://threejs.org) (bundled in `vendor/three-bundle.js`) | the 3D network map | MIT, Copyright (c) three.js authors |
| [Electron](https://www.electronjs.org) | the desktop app framework (includes Chromium and Node.js) | MIT. Chromium and Node.js carry their own open-source licenses, which Electron includes with every build (`LICENSE` and `LICENSES.chromium.html`) |
| [electron-builder](https://www.electron.build) | building the installer and portable program (development only, not shipped) | MIT |
| IEEE OUI registry data (`vendor/oui.json`) | turning a device's hardware address into a manufacturer name | The IEEE Registration Authority publishes the registry publicly. Manufacturer names belong to their owners. |

## MIT License (applies to three.js, Electron and electron-builder; each under its own authors' copyright)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
