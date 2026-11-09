# Changelog

All notable changes to Dashboard Hub. Newest first.

## 1.10.89
- NEW (early): Network boot (PXE). Settings -> "Network boot (PXE)..." boots another computer from this one over the network cable. Off until you press Start. It only answers the MAC addresses you list (or "any computer" if you tick it), never hands out addresses, and its menu never installs or erases anything. Offers Ubuntu/Debian-style live ISOs you add, other ISOs in a generic way, and the netboot.xyz menu.
- Needs a cable connection and administrator rights (Windows "Run as administrator", or sudo on Linux). Tested with simulated network boots; not yet on real network-boot hardware.
- About window lists the ports network boot uses (UDP 67, 4011, 69, TCP 8088).

## 1.10.88
- The green dot next to the map toolbar now always has words with it: "Auto scan on: every 15 seconds" when waiting, "Auto scan in progress..." while it blinks, and "Last auto scan: 07:53:22 PM" when done. Hover over the dot for a plain explanation. (Replaces the bare "checked 07:53:22 PM".)

## 1.10.87
- Network Map toolbar tidied: Alerts now sits next to Live update on the first row (no gap), and "Map layout and hardware", Show offline, Move groups together, Group circles and Show services start the second row, followed by the scan message and the "checked" time. The scan message no longer sits in the first row, so the first row can't jump after a scan.

## 1.10.86
- Fixed: the Network Map toolbar sat in a different place before the first scan than after it (Alerts, Live update and the checked-time label jumped when "Done. Found N machines." appeared). The scan message now keeps a fixed-size slot, so the toolbar looks the same before and after. Long messages are cut with "..." and show in full when you hover over them.

## 1.10.85
- Network Map: the map can no longer be pushed out of sight or zoomed out too far. The view stays within the area your machines cover (plus a margin), and zooming out stops at a distance that fits the size of your network. Reset view and Top view work as before.

## 1.10.84
- Fixed: the group name (and VLAN) box in the Device list was cleared while you typed, whenever the map updated. What you type, and the cursor, now stay.
- Device list: a machine that is in a group now shows "Group: name" under it.
- Panels reload themselves when they fail to load or crash (waits 3, 6, 10, 20, 30, then every 60 seconds, and stops once the page loads). Settings -> "Reload a panel by itself when it fails" turns it off.

## 1.10.83
- Network Map toolbar decluttered: Router & switch links, Add switch, Draw physical cable, Draw lines, Top view, Reset view and Tidy up now live in one "Map layout and hardware" dropdown. Picking an item closes the menu; the dropdown lights up while Draw lines or Draw physical cable is switched on.

## 1.10.82
- Streamlining pass over the newer features:
  - SSH connections: a good answer is reused for one minute, and a refused login is not retried automatically for five minutes (protects accounts from lockout). "Ask them now" always asks at once, and editing the connection clears the wait.
  - Linux/OpenWrt routers over SSH are read in one login instead of two.
  - UPnP device descriptions are downloaded once and remembered for 30 minutes, instead of on every background scan.
  - The resting map redraws slower after five minutes of rest (5 per second instead of 10), so the graphics card is woken less when nothing changes.
- Measured and found fine, no change needed: scene updates (0.7 ms with 120 machines and 6 groups) and no graphics leaks when groups are added and removed.

## 1.10.82
- Smoother map: the 3D picture is no longer rebuilt when small things in the toolbar change. Before, the "checked 10:19 PM" label, the scan progress line and similar changes shifted the map by a few pixels, which rebuilt the whole picture (a scan of 250 machines cost about 3 seconds of work in the window; it now costs under 1 second, and the toolbar no longer jumps).
- The picture is only resized when its size really changes.
- Measured and left as is: starting up (about 0.6 s to the window), importing 300 machines (30 ms), the machine list (70 ms), keeping old versions (about 40 ms at start), and SSH checks (one login per check, reused for a minute).

## 1.10.81
- Fixed the app sometimes not coming back after a restart (after installing an update, or after changing the graphics setting). With "keep running in the tray" on, the new copy could start while the old one still held the single-copy lock, think the app was already running, and quit. The old copy now gives the lock back before restarting, and a restarted copy waits up to 20 seconds for the old one to finish closing.
- The graphics-setting restart now uses the same careful restart as updates (portable .exe and Linux AppImage included); before, it could fail to start again from an AppImage.

## 1.10.80
- New connection type **SSH** (no SNMP): reads the ARP table, MAC table with switch ports, and DHCP leases from Linux/OpenWrt routers, MikroTik, Cisco IOS / IOS XE, or any device that answers "show arp". Key login, or a password on Linux and macOS.
- Only a fixed list of read-only commands is ever run; user names and device kinds are checked.
- About window lists the SSH port.

## 1.10.79
- New "Finding machines (no SNMP needed)" section in Settings > Security: separate switches for ping and port checks, mDNS/Bonjour, SSDP/UPnP, NetBIOS names, DNS name lookups, and a master switch that turns SNMP off completely.
- New "Quiet scan, no SNMP" button: listening only, no pings or port checks, no NetBIOS questions, SNMP off.
- Scans now use mDNS, SSDP and NetBIOS to find and name machines (machines that ignore pings but announce themselves are now found).
- Each machine records which methods found it.
- About window lists the ports used by the new methods.

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
