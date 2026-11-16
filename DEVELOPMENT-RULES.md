# Dashboard Hub - standing rules for whoever works on the code

These are the owner's rules. They apply to every session and every change.

1. **Never silently remove a file that is supposed to be there.** A file may only be removed when the owner asks for it, or when an
   update genuinely no longer needs it. Then it is added to `tools/removed-files.txt` with the reason. `tools/check-release.js`
   (run automatically by `tools/make-update.js`, and by `npm run check`) fails if a file from `tools/release-files.txt` is missing
   and is not listed there. After adding files, run `node tools/check-release.js --update` to record them.
   This covers the uninstall scripts (`UNINSTALL.bat`, `UNINSTALL.sh`), the installer's uninstaller (`build/installer.nsh` and the
   nsis settings in `package.json`), the build/run/update scripts, the docs and the tests.
2. The owner knows nothing about code and wants everything to actually work. Test before delivering. Be honest that tests use
   simulated devices and virtual machines, not real hardware.
3. Deliver a `.hubupdate` plus the matching source zip (and README.md / FEATURES.md when the docs change) rather than full builds,
   unless Electron truly lacks a module. A `.hubupdate` holds at most 40 files and only `.js`, `.json`, `.html`, `.css` files, so
   scripts (`.bat`, `.sh`) travel in the source zip and must be mentioned to the owner.
4. Work in small stages, one per session; the owner's usage limit runs out. Say in a few words what is being done.
5. Short, plain-language replies. Cumulative update notes. Keep `CHANGELOG.md`. GPL-3.0-or-later. Patch version = fixes, minor = features.
6. README.md and FEATURES.md are identical and start with the install steps and "Node.js 24 LTS or newer".
