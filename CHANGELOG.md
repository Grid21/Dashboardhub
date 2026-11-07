# Changelog

All notable changes to Dashboard Hub. Newest first.

## 1.10.78
- Group circle rings are now all the same thin thickness, whatever the circle's size.

## 1.10.77
- Group rings made the same thickness for every group (fixed width instead of a share of the circle's size).

## 1.10.76
- Added **Remove from group** button (Devices list and machine pane).
- "Set group" with an empty name no longer clears a group by accident.

## 1.10.75
- The map is now flat: machines sit on one level, no more lifting up and down (Shift+drag removed). Old saved heights are flattened.
- The floor grid now sits just under the machines instead of far below.
- Thinner group circle ring that lies on the floor.

## 1.10.74
- Group circles are now clearly visible (bolder ring and fill, larger group name that is never hidden behind machines).
- Docs: troubleshooting note for the Linux AppImage "Cannot mount AppImage / FUSE" message.

## 1.10.73
- Graphics safety:
  - The 3D map stops drawing while the window is hidden, minimised or in the tray.
  - Idle redraw is a low, steady rate that doesn't depend on monitor refresh rate.
  - The map recovers from graphics-driver resets.
  - Only one draw loop can run at a time; picture size is capped.
  - After 3 GPU crashes in 10 minutes the app switches itself to software drawing and explains why in Settings.
  - A crashed main page reloads automatically.

## 1.10.63 – 1.10.72
- Device uptime: how long a machine has been online.
- About window with the list of network ports the app uses.
- Full screen (Maximize / Exit full screen) for dashboard panels.
- Security settings: certificates, popups, media/notification/clipboard permissions, connector options.
- Version history: keeps recent versions (1–10, default 4) and lets you return to an older one from the Updates window.
- "Open updates folder" button.
- DNS tools fixed.
- Update checker falls back to the updates folder when a release has no file attached.
- Fixed "There is no update file to download" and the install flow ("Restart needed" message).
- Docs: install steps (Node.js 24 LTS or newer) at the top of README/FEATURES.
