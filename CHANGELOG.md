# Changelog

All notable changes to Dashboard Hub. Newest first.

## 1.42.0
- **Docker server keeps your Desktop layout automatically.** In Remote servers > Devices > "Copy this computer's map to the server" there is a new tick box, **Keep this server up to date automatically** (off by default, set per server). When on, Desktop sends names, groups, places, details, cables and ignored machines to the server about 20 seconds after you change the map, when Dashboard Hub starts, and every few minutes if a send failed. The server keeps what it was sent, so when you take Desktop on the go the server still shows your layout. Safety: nothing is sent when this computer's map is for a different network than the server's (the machines must match), so a trip to another network cannot scramble the server's map. Turning the box on sends once right away, and the line under it says when the last send happened.
- **Docker browser page: offline machines are no longer drawn on the map** (2D and 3D). Only online machines show. The Devices list and Uptime still list them, and they come back on the map as soon as they are online again.
- Planned next: device-type colours in the server's map; placing machines the server finds new next to their group.

## 1.41.1
- **Fix: the "Help me identify this" panel closed by itself** a few seconds after opening it, because the side pane redraws on every refresh. It now stays open (with its online answer) until you close it or pick another machine.

## 1.41.0
- **New: "Help me identify this" for unknown devices (Desktop).** Click any machine on the map and press the button in its pane. It lists everything known (maker, made-up "private" address detection, name, ping TTL, open ports, web page titles), explains what it probably is (for example an Espressif chip means a smart plug or hobby gadget, port 9100 means a printer, port 62078 means an iPhone), and offers:
  - **Search the web for this** - opens your browser with a ready-made search (maker + name + page title, or the first part of the MAC address).
  - **Ask an online maker list** - asks the free api.macvendors.com service who owns the address. It asks you first, and sends only the address (nothing else about your network). It is skipped for made-up private addresses, which have no maker. A found name can be saved as the brand with one click.
  - **Unplug test** - start it, unplug the device you suspect, and it tells you the moment this machine stops answering.
  There is no free official "what is this device" service on the internet, so this gathers the clues and points you to where answers are; it can still be wrong, and a silent gadget with a made-up address may stay a mystery.
- Planned next: automatic sending of the Desktop map to the Docker server when it changes; device-type colours in the server's map.

## 1.40.0
- **Docker server's map now looks like the Desktop map.** The coloured group circles (with their names) and the pink cable lines are drawn in both the 3D and 2D map of the browser page, and the server follows the Desktop's "group circles" setting when you send a map over. Placement already came across with the map data; the circles were what made it look different.
- **Browser page, 3D map: names no longer appear and disappear** every few seconds. Names are chosen in a fixed order and a name that was showing stays showing unless something truly needs its place.
- **Scan status line** on the browser page stays visible for a few seconds instead of being overwritten by the next refresh.
- Not done yet (planned next): automatic sending of the Desktop map to the server when it changes, and a "Help me identify this" tool on Desktop.

## 1.39.2
- **Browser page, 3D map: names and IP addresses were missing once the map had more than 60 machines** (for example after importing a Desktop map that added machines). The old rule hid every name in a crowd unless you zoomed in a lot. Now every name is shown unless it would land on top of another name: the router, this machine and the selected one always show, the others nearest first, and zooming in or turning the view reveals more. Names are drawn on top of the boxes with a thin outline so they stay readable. (The 2D map always showed all names.)

## 1.39.1
- **Browser page: tick boxes in Settings were stretched across the page** (the box far from its words, as in the alert options and the new Map data box). They are now small and sit right next to their words. A new check measures this.

## 1.39.0
- **Copy your whole saved map between Dashboard Hub Desktop and the Docker server.**
  - **Send from Desktop (live):** Settings > Remote servers > Devices > "Copy this computer's map to the server" now sends the full saved map of the active profile, not just names and places: **groups, places on the map, details (brand, model, notes, web address, VLAN), cables and links between machines, the group circle settings, and the machines you ignored** (they are hidden on the server too). Tick what you want. Older Desktop versions still work with a new server and the other way round.
  - **By file (cross-platform):** the server's browser page has a new **Map data** box in its Settings tab. **Download map data** saves a file that Dashboard Hub Desktop imports with Backup > Import. **Import** loads a file saved by Dashboard Hub Desktop (Backup > Export) or by another server. If the file holds several networks you choose which one; you choose which parts to bring in (names, groups, places, details, cables, ignored machines, adding machines the server has not found yet, panels). Notes, passwords and server logins in a Desktop file are never sent to the server.
  - **The browser map now shows what it receives:** details appear when you tap a machine (device, notes, web address, VLAN), cables are drawn as the links you set up (wireless links dashed) instead of everything hanging off the router, and ignored machines stay hidden. Machines the file does not mention still hang off the router.
  - The browser page accepts bigger messages now (up to 8 MB), so a map of well over a thousand machines can be sent.
  - **Desktop fix:** a Backup > Import (and Import into this computer) used to forget which machines you had chosen to ignore; the list is now kept.
  - Tested: container receiving, exporting and importing (98 server checks), the exported file read by Desktop's own backup reader, a two-network Desktop file, junk files, a 1400-machine map, the browser page uploading and downloading files on a phone-sized screen, and Desktop's window sending a real saved map to a real server process. As always, real hardware and a real container were not tested.

## 1.38.3
- **Browser page, 2D map: the mouse wheel now zooms into the middle of the picture** instead of toward wherever the mouse pointer happens to be (which made the map slide away to one side). Use **Fit** to get everything back in view. Pinching on a phone still zooms between your fingers. The 3D wheel already zoomed on the middle; its first view was centred in 1.38.2 and is re-checked here in a wide desktop-size window as well as a phone-size one.

## 1.38.2
- **Browser page: the 3D map is now centred when it opens** (it sat lower than the middle). The view now measures where the dots really land on the screen, centres them and zooms so they fill most of the space; the **Fit** button does the same. Checked with a phone-sized simulated browser.

## 1.38.1
- **Browser page, Uptime tab: the "What happened" log moved to the bottom.** The bars for every device now come first. The log sits underneath in its own box that scrolls (it now holds up to 300 events instead of 40) and has a **Hide / Show** button; the choice is remembered on that browser. This is the page used by both the Docker server and Dashboard Hub Desktop's "Phone and browser access". The Desktop Notifications Center is unchanged.

## 1.38.0
- **Docker: quiet hours for alerts.** In the browser page's Settings tab (and in the saved settings) you can set a **From** and **to** time. Alerts that happen in between are not sent at that moment; when the quiet time ends they go out together as ONE message starting "While it was quiet:". Works across midnight (22:00 to 07:00). Leave both empty for no quiet hours; switching them off sends anything that was waiting right away. The times use the server's own clock; set `TZ` in the compose file (for example `Europe/London`) if it is not your time. The page shows what the server clock says.
- **Docker: recent alerts list.** Settings shows the last 10 alerts: sent, kept for the quiet time, or NOT sent (with the reason, such as the address answering an error), including test messages. It is saved in the data folder (`alert-log.json`), so it survives restarts.
- Tested: 14 new checks (night and day periods, kept and then released as one message, switched off while waiting, wrong or half-filled times, saved settings, list, phone-width page without sideways scrolling). The container's old update method is untouched (nothing new was added to the `docker` folder).

## 1.37.0
- **Tron Legacy colours for Dashboard Hub Desktop.** Settings > Colours has a new choice, **Tron Legacy (neon)**: black glass with a faint grid, glowing cyan lines and capital-letter headings, orange for the main buttons and the tab you are on. It applies to every window (main window, Remote view, Notifications Center) and to the 3D map (cyan floor grid and cyan outlines). It is remembered after a restart. Light, Dark and Automatic are unchanged. Tested for readable text on the main tabs, the Settings menu and the Remote view.
- **Docker browser page: move around the 3D map.** Hold **Shift** and drag, or **right-drag**, to slide the view (the spot under the mouse follows it and no device is moved); on a phone use **two fingers** (they move and zoom at once). The mouse wheel / pinch still zooms and a plain drag still turns the view.
- **Docker browser page: Scan button** on the Map tab (shown when changes are allowed). It starts a network scan on the container now, says so, and refreshes the map a few seconds later.
- Tested with a phone-sized simulated browser: 5 new checks (Shift-drag, right-drag, device not moved, Scan button).

## 1.36.0
- **Sync: copy Dashboard Hub Desktop's map to the Docker server.** In Settings > Remote servers > **Devices**, a new box **"Copy this computer's map to the server"** sends the names, groups and places on the map (of the active profile) from Desktop to the container, and the container's web page (map, 3D map, device list) then shows them. You choose what to send: names, groups, places, machines the server has not found yet (added by hand), and panels (replaces the server's panels, asks first). Machines are matched by MAC address, or by address when there is none; an empty name or group on the computer never wipes the server's; the router and the server itself are left alone. After sending it says how many machines were matched, named, grouped and moved.
- This is a one-way copy, Desktop to server, done when you press the button. Pulling the server's changes back into Desktop is not done yet.
- Tested: 14 new checks on the server (only ticked things copied, matching by MAC or address, empty values, adding, public addresses refused, router untouched, panels, nonsense) and 3 on Desktop's window with a real container process (simulated network).

## 1.35.1
- **3D map on the browser page: left/right turning was the wrong way round.** Dragging to the right now turns the map so the near side follows your finger (like turning a globe). Up/down tilting is unchanged and matches Dashboard Hub Desktop's 3D map. A test now checks the direction.

## 1.35.0
- **3D map on the browser page.** The Map tab has a **3D** button: the same map seen from a tilted camera, every device a little box standing on a grid floor (offline ones red). Drag empty space to turn the view, mouse wheel or two-finger pinch to zoom, tap a box for its details, drag a box to move it across the floor (saved on the Docker server like in the flat map). **Fit** resets the camera, **2D** goes back. Your choice is remembered in that browser. In a big network the names show when you zoom in. It also works on the page served by Dashboard Hub Desktop. It is drawn with plain canvas (no WebGL needed), so it works on any phone browser.
- Tested: 31 checks on the Docker page including the 3D view (turning, zooming, dragging a box, saving, back to 2D). Looked at it in a phone-sized window.

## 1.34.0
- **Docker version: alerts to your phone.** The server can send a message when a **new device** appears, a device **goes offline** or **comes back online** (you choose which). It works with a free **ntfy** topic (ntfy.sh, or your own ntfy server), a **Discord** or **Slack** web hook, or any web address that accepts a POST (plain JSON). One message per scan, at most 15 lines ("...and 5 more"), ignored devices never alert, and the first scan after a fresh start does not flood you with "new device" messages. Set it up in the server's **Settings** (browser page or Dashboard Hub Desktop > Remote servers > Settings > Alerts), with a **Send a test message** button. Nothing is sent until you type an address.
- The alert address is like a password for your topic: it is kept in the server's data folder and only shown to someone who has the access code.
- Tested: 20 checks of the messages (all four types, choices, flood, unreachable or failing address, saving, test button), plus the browser page (23) and Desktop window (33). Not tested: the real ntfy, Discord or Slack.

## 1.33.0
- **Docker version: change its settings from the browser page.** A new **Settings** tab on the server's own page (phone or computer) lets you change the server's name, the network to scan, the router, how often it scans, the update choice (with "Check now / Install now") and its panels, with the same checks and messages as in Dashboard Hub Desktop. Now everything about the Docker version can be managed from either place.
- Tested: 21 checks on the Docker page (including wrong panel address refused, save, update choice, check now).

## 1.32.0
- **Move the dots on the browser map.** On the server's web page, drag any device dot on the Map tab to where you want it; drag empty space to pan, pinch or wheel to zoom, tap a dot for details. On the Docker version the new place is saved on the server (everyone sees it, also after restarts and updates). On the page served by Dashboard Hub Desktop the move is kept only in that browser. **Reset** puts the dots back in the automatic layout.
- Fixed: on a narrow phone screen the tab bar could slide under the page header when the page was scrolled.
- Tested: 14 checks on the Docker page (including dragging, saving, reload, reset), 36 on the Desktop's page, 71 on the server.

## 1.31.0
- **Docker version: edit devices from the browser page.** On the server's own page (phone or computer browser), the Devices tab now lets you open a machine and change its name and group, tick Ignore, show the ignored machines and bring them back, and add a machine by hand. (Settings, network and panels are still edited from Dashboard Hub Desktop.)
- **Old containers keep updating.** The Docker bundle script now also makes the old kind of update pair (`for-old-containers/`) for containers built from 1.29.0 or 1.29.1, and a test runs the real 1.29.1 program against it, so a future change cannot silently cut them off. New standing rule 7 in `DEVELOPMENT-RULES.md`.
- The log no longer prints "Looking for a newer version..." twice.
- Tested: 28 update checks (including the real 1.29.1 program updating itself), 8 checks of the browser page editing, plus all earlier tests. Simulated network, not a real container.

## 1.30.0
- **Docker version, stage 3: device names, groups, ignore and add by hand, from Dashboard Hub Desktop.** In Settings > Remote servers each server has a **Devices** button: give any machine a name and a group, tick **Ignore** to leave a machine off the map, the counts and the history (it stays on the server and can be brought back), **Forget** an offline machine, or **add a machine by hand** by its address (for something the scan cannot see, such as a machine on another network; the server pings it to see if it is online). Names and groups show on the server's page and map and stay after restarts and updates.
- The router and the server itself cannot be ignored or forgotten.
- Tested: 67 checks on the server (including the new device requests, cleaning of names, restart) and 30 on Desktop's window. Simulated network, not a real container. Editing from the browser page is not done yet.

## 1.29.2
- **One file to upload.** The Docker bundle is now always called `dashboard-hub-docker.tar.gz` and the server reads the version from inside it, so there is no separate update list and no fingerprint file. Upload that one file to GitHub; it is used both for the first install (curl) and for updates.
- Tested: 25 checks with a pretend GitHub, including a web page instead of the file.

## 1.29.1
- **Docker version: restarting it now updates it.** Every time the container starts (also when you press Restart in Portainer), it first looks for a newer version on your GitHub and, if there is one, installs it and starts that instead (with "Install new versions by itself" on). Nothing is served from the old version first. If GitHub cannot be reached it just starts normally.
- Tested: 25 checks with a pretend GitHub, including a restart that updates and a start with no connection.

## 1.29.0
- **Docker version: it updates itself.** The server looks in your GitHub repository for `dashboard-hub-docker-latest.json` (shipped next to each Docker bundle), downloads the newer `.tar.gz`, checks its fingerprint, unpacks it into its data folder and restarts itself. A new version that will not start is rolled back and skipped. Settings: Settings > Remote servers > Settings > **Updates** (install by itself / only tell me / off), plus a "Check now / Install ... now" button and the status line. A small starter (`docker/boot.js`) runs the program; `docker/updater.js` does the updating.
- A container built before this version must be rebuilt once from the 1.29.0 bundle. Changes to the Linux part of the image still need a rebuild (the update says so).
- Tested: 22 checks with a pretend GitHub (install, restart, wrong fingerprint, rebuild needed, rollback of a broken version, only-tell-me, Desktop install, unsafe file). Not tested: the real GitHub, a real container.

## 1.28.0
- **Docker version, stage 2: settings and panels from Dashboard Hub Desktop.** In Settings > Remote servers each server now has a **Settings** button: change the server's name, the network to scan (Automatic, one of the server's own networks, or type it), the router address (Automatic or type it, with a hint of what the server found), how often it scans, and its panels (add, rename, reorder, remove). The settings are kept on the server and stay after a restart.
- The compose file's settings are now only the **starting** settings. Once you change something in Desktop, the saved settings win. (The access code still always comes from `DASHBOARD_HUB_CODE` when it is set.) The compose file no longer contains example panels, and its settings can come from a `.env` file or Portainer's Environment variables.
- Fixed: the server's page said "updated NaN days ago".
- Changing the network takes machines of the old network off the map (their history stays); machines outside the scanned network are no longer wrongly marked offline.
- New starting setting `DASHBOARD_HUB_ROUTER`.
- Tested: 48 checks on the server (including refusal of bad settings) and 24 on Desktop's window against it, plus the earlier tests. Still on a simulated network, not a real container.

## 1.27.0
- **New: Dashboard Hub for Docker, stage 1** (the `docker` folder in the source zip; guide in `docker/README-DOCKER.md`). A small always-on version with no window for a Linux box, NAS or Raspberry Pi: it scans the network on a timer (every 5 minutes by default), keeps the device list and Uptime and history in a saved folder, and serves the same view-only page as Phone and browser access. Start it with `docker compose up -d --build`. Settings (access code, name, network, scan interval, port, panels) are in the compose file.
- **New: Remote servers** (Settings > Remote servers...). Dashboard Hub Desktop can now look after Dashboard Hub servers: add one with its address and access code, then **Check** it (devices online and offline, last scan, version), tell it to **Scan now**, or **Open** its map, devices and uptime in a window. Access codes are stored encrypted where the computer allows it and are never shown again.
- The server page gained a few safe extras: an unauthenticated health check for Docker, an info report and a "scan now" action that needs a sign-in and a safety header. Dashboard Hub Desktop's own phone page stays strictly view only.
- Not yet: editing panels, device names and scan settings from the browser or from Desktop (next stages). The Docker image was not built here (no Docker engine on the test machine); the server program inside it was tested on a simulated network.
- Tested: 46 new checks (the server program, Desktop's Remote servers window against it, light and dark pages) plus the earlier tests.

## 1.26.0
- **New: Phone and browser access.** Settings now has **Phone and browser access...**. It is **off** until you turn it on and it needs an access code you choose (6 or more characters; stored only as a scrambled hash). When on, Dashboard Hub serves a small page at an address like `http://192.168.1.20:8787/` (the window shows the exact addresses) that works in mobile Chrome or on another computer's browser, at home or over your VPN.
- The page is **view only**: nothing on it can change anything. Tabs: **Panels** (your panels as buttons that open them), **Map** (the same layout as on the computer, seen from above: drag to move, pinch or wheel to zoom, tap a device for details), **Devices** (search, Online/Offline filter, details) and **Uptime** (24 hours, 7 or 30 days, the plain-words sentences and a bar per device). It follows the phone's light or dark setting and refreshes itself every 15 seconds.
- Safety: five wrong codes pause sign-in for 10 minutes, sign-in lasts 12 hours, "Sign everyone out" and changing the code end all sessions, the port can be changed, and it stops when you turn it off or close Dashboard Hub. The page is plain HTTP (not encrypted by itself), so use it on your home network or through your VPN such as WireGuard and never open the port to the internet. Windows may ask once to allow Dashboard Hub through the firewall (private networks).
- It only works while Dashboard Hub is open and scanning on the computer. The 3D map is not on the phone page; panels open directly in the phone's browser, so the phone must be able to reach each panel's address.
- Tested: 83 checks (the sign-in and limits, read-only rules, the page in a phone-sized browser in light and dark, the Settings window, restart). Tested on this computer only, not yet on a real phone over a real VPN.

## 1.25.1
- Carousel now sets Panel height to Full screen automatically (details under 1.25.0 below).

## 1.25.0
- **New: Carousel.** The Columns menu (1, 2, 3) now has a fourth choice, **Carousel**. It shows one panel at a time, with an arrow button at the left and one at the right of the screen to step to the previous or next panel (after the last one it starts again at the first). Alt + Left / Right arrow work too, a small label shows which panel you are on ("Beta · 2 of 5"), and clicking a panel name in the top bar jumps to it.
- The panels you are not looking at stay loaded, so flipping back is instant and nothing reloads. The arrows hide while a panel is full screen and on the Network Map.
- **Carousel always uses the "Full screen" panel height** (the Panel height menu switches to Full screen and is locked while Carousel is on). Your own height choice comes back when you pick 1, 2 or 3 columns again.
- The choice is remembered after a restart and kept in backups.
- Tested: 23 checks in the real window with simulated panels (flipping, wrapping round, keys, top-bar jump, full screen, removing a panel, restart, backup).

## 1.24.0
- **New: light and dark mode.** Settings now has a **Colours** choice: *Automatic (follow my computer)*, *Light* or *Dark*. Automatic is the default, so Dashboard Hub looks like your computer. Every window follows at once (panels, Network Map and its 3D view, speed gauges, Notifications Center with Uptime and history, Remote view, dialogs), and the choice is remembered after a restart.
- Dark looks exactly as before. The light colours were chosen to keep text easy to read; a test checks the text colour against the background in every window in both modes.
- Websites inside panels also see your choice, so sites that have their own light and dark look will follow it.
- Tested: 35 checks in the real windows (choice saved and restored, every window painted in the right colours, readable text in both modes). Tested on a simulated desktop only, not on a real Windows or Linux desktop that switches theme.

## 1.23.1
- **Fixed: the sentence list in Uptime and history popped on and off** at every refresh (a coding mistake in 1.23.0 flipped it between shown and hidden each time), which also pushed the "Every device" list around. It now stays put, and the scroll position is kept when the page refreshes. A test now refreshes the page six times in a row to make sure.
- **Tidier layout:** the device bars come first (devices that are offline now at the top), then "What happened" in a box with a fixed height that scrolls inside. Click a device to read only its own drops, one sentence each; "show every event" lists everything ungrouped.
- **Less noise from gadgets that keep dropping:** quick drops (under 10 minutes) that repeat within the hour become one line, for example "Office Lamp dropped off 14 times between 3:23 PM and 4:08 PM (22 min offline in total, none longer than 6 min)". Longer drops always keep their own sentence.
- **New: a "Hide drops under 2 / 5 / 15 min" choice** that leaves short drops out of the sentences and counts (a device that is still offline is always kept). The coloured bars are never changed by it.
- Tested: 55 checks on the logic (grouping, hiding short drops, closed-overnight cases, older records) and 31 in the real window (including six refreshes in a row and keeping the scroll position).

## 1.23.0
- **New: Uptime and history** (a new tab in the Notifications Center). A green/red bar for every device over the last 24 hours, 7, 30 or 90 days, a summary, and plain sentences such as "Office printer went offline at yesterday 3:12 AM, and came back at yesterday 5:20 AM (off for 2 h 8 min)". Search a device or show only the ones that went offline; hover a bar for exact times.
- **Honest about gaps:** after every finished scan Dashboard Hub now records that it was watching. Time when it was closed, asleep or not scanning is shown as striped gray "not watched" and never counted as offline. If a device went down while Dashboard Hub was closed, the sentence says "sometime between ... and ..." instead of inventing a time. Older history from before this version has no watching record, so it shows gray except where a device was known to be online.
- The record is stored in the existing `notifications.json` (kept up to a year, only on this computer); Clear history also clears the watching record. A running watching period is saved every 5 minutes and when the app closes.
- Tested with made-up records (42 checks: watching periods, drops, still-offline, closed overnight, older records, flapping, junk files, limits) and with simulated scans in the real window (20 checks). Not tested over days with real devices.

## 1.22.0
- **New (optional, off until used): "Password manager for panels..."** in the Settings menu. Pick Proton Pass, Bitwarden or another one, then choose the extension file (.zip, .crx) or folder you got from the password manager's own website. It is loaded into the panels' own browsing session only (never the app window), one extension at a time, so a panel's login page can be filled in. Includes an "Open its pop-up window" button (Dashboard Hub has no browser toolbar), a switch to turn it off, and Remove. Dashboard Hub never reads, stores or sends passwords; the extension does all of that.
- Safety: zip/crx files are unpacked by Dashboard Hub itself and refused if a file name climbs out of the folder, is absolute, is far too large, or if there is no manifest.json; folders are copied without following links; the extension is given no access to local files.
- Tested with a stand-in extension written for the test (install from zip, .crx, folder and a zip with an outer folder; fills a panel's login at startup too; pop-up window; off; remove; restart; unsafe files refused). **Not tested with the real Proton Pass or Bitwarden**: only part of a browser's extension system exists inside Dashboard Hub, so they may only partly work. Extensions that need a desktop app to unlock cannot work. Dashboard Hub does not download extensions itself, because the official download locations could not be checked.

## 1.21.1
- Wording only: the new DHCP server box, its messages and the manual now say "Dashboard Hub" instead of just "Hub". No other changes.

## 1.21.0
- **New: "Dashboard Hub acts as the DHCP server" (advanced, off by default)** in the Network boot window. Some real computers (a Dell Latitude E5450 in UEFI mode was the case that led to this) ignore Dashboard Hub's normal method of adding the boot file to the router's answer and sit at ">>Start PXE over IPv4." forever, while virtual machines accept it. With this switched on, Dashboard Hub hands out the network address **and** the boot file itself, like Foreman's DHCP does. You choose the address range (or leave it empty: x.x.x.200 - .230) and optionally the router address. Your router's DHCP must be off while it runs (two DHCP servers confuse computers); only listed computers (or "any") are answered.
- The log now names the Dashboard Hub version and which mode started, so test reports show what was running.
- Tested with simulated computers (offer, acknowledge, refuse a wrong address, ignore a request meant for another DHCP server, give the address back, range full, unlisted computer, normal mode unchanged) and the window's settings. **Not tested on real hardware**: whether the Dell accepts it is exactly what this version is for finding out.

## 1.20.1
- **Fix for computers in UEFI mode that stop at ">>Start PXE over IPv4." and never start the download** (seen on a VirtualBox VM and on a Dell; older-BIOS mode worked). Cause: a UEFI computer only accepts Dashboard Hub's answer when it is sent to 255.255.255.255, and on a PC with several network connections (Wi-Fi, a VPN, or VirtualBox's own host-only adapter) the system sent that answer out of the wrong connection; the "subnet broadcast" copy that went out of the right one is ignored by UEFI firmware. Dashboard Hub now sends its answers from a socket tied to the network connection you picked, so they leave through it.
- Proven in the virtual Secure Boot test, which no longer has a special route for the broadcast: before the fix the firmware said "No valid offer received" (this machine's default connection was a different network), after the fix it boots through shim, grub and a signed kernel. Not yet tried on Windows or a real computer.
- If the socket cannot be tied to that connection, the log says so and Dashboard Hub works as before.
- Duplicate copies of the same request (received on both sockets) are answered once.

## 1.20.0
- **Secure Boot network boot.** Computers with Secure Boot ON refuse Dashboard Hub's unsigned boot loaders. The Network boot window now has "Secure Boot computers (advanced)": "Download the signed files" fetches Ubuntu's own Microsoft-signed `shim` and Canonical-signed network `grub` from Ubuntu's official archive (checked against the archive's checksums), and a tick box hands them out to computers that start in UEFI mode. The computer then starts shim, then grub (which shows a menu from Dashboard Hub, including the unattended-install choices), then a signed Ubuntu kernel from your disc. Ubuntu-style discs only. Older-BIOS computers and computers with Secure Boot off keep using the normal loaders.
- Tested with a virtual computer with real Secure Boot firmware (OVMF with Microsoft keys) and the real signed Ubuntu files: the firmware accepted shim and grub, accepted a signed kernel, and refused an unsigned one ("bad shim signature") before loading anything. `test/secureboot-vm-test.js` (16 checks; needs root, QEMU, OVMF, dnsmasq) and `test/pxe-sb-ui-test.js` (10 checks). Not tested on a real computer.
- Found while testing: Dashboard Hub's DHCP reply is broadcast to 255.255.255.255, and on a computer with several network connections (for example Wi-Fi plus a cable to the PXE computer) the system may send that broadcast out of the wrong connection. Not changed yet.
- New: `DEVELOPMENT-RULES.md` and a file guard (`tools/release-files.txt`, `tools/removed-files.txt`): `check-release` now fails if any file from earlier releases disappears without being written down. Rule: files are never removed unless the owner asks or an update no longer needs them.
- Note: the 1.19.1 files already contained the unfinished Secure Boot code in `pxe.js`, switched off and without any buttons. This version finishes it.

## 1.19.1
- **Uninstall scripts are back: `UNINSTALL.bat` (Windows) and `UNINSTALL.sh` (Linux/macOS).** Put them next to the other `.bat`/`.sh` files. They show what they found and ask before removing each part: the finished "Dashboard Hub" program folder, the libraries downloaded on first run, the copy of Node.js the scripts downloaded for themselves (never a Node.js you installed yourself), and launcher entries. `UNINSTALL.bat` starts the Setup program's own uninstaller if Dashboard Hub was installed that way. Your data is always asked separately and is kept unless you say yes. Neither script deletes the source folder itself.
- **They can no longer silently disappear.** `tools/check-release.js` checks that the uninstall scripts, the installer's uninstaller settings (`build/installer.nsh` and the `package.json` installer settings) and the other required files are present. `tools/make-update.js` now refuses to make an update while anything is missing, and `npm run check` runs it by hand.
- BUILD-APP, the README, FEATURES and the in-app manual now mention the uninstall scripts.
- New tests: `test/uninstall-test.sh` (16 checks, runs UNINSTALL.sh on throwaway folders) and `test/release-check-test.js` (14 checks). `UNINSTALL.bat` could only be checked for structure here, not run on Windows.
- Note: `.hubupdate` files can only carry `.js`, `.json`, `.html` and `.css` files, so the two uninstall scripts come with the source zip and must be copied into your Dashboard Hub folder by hand.

## 1.19.0
- **UEFI-aware unattended installs, with a choice of disk (stage A, inspired by how Foreman handles UEFI hosts).**
  - New "Install on which disk" choice: let the installer decide (as before, erases every disk), only the largest internal disk (USB sticks are skipped), or a disk you name (`sda`, `nvme0n1`, `vda`...). Disk names are strictly checked. A named or "largest" disk that is not found stops the install before anything is erased.
  - New "Disk layout" choice for Rocky/Alma/Fedora: "Simple" makes the partitions that fit how the computer really started. A small script inside the installer looks for `/sys/firmware/efi`: UEFI mode gets an EFI partition + /boot + one big root, older BIOS mode gets a BIOS boot partition + /boot + one big root with the boot loader on the chosen disk. Ubuntu discs use their own standard layout on the disk you pick.
  - The network boot log now says whether each computer started in UEFI or BIOS mode when it fetches its answers, and what that means for the install.
  - Default settings write exactly the same answer files as before.
- Fixed the text that said the first disk is erased: it is every disk unless you choose otherwise.
- New tests: `test/pxe-disk-test.js` (19 checks, including running the installer script with pretend disks and a pretend UEFI folder, and checking the answer files with `ksvalidator`) and `test/pxe-disk-ui-test.js` (9). Not yet run in a real installer on real hardware.

## 1.18.3
- **Safety net for unexpected errors.** If something unexpected goes wrong inside the background program, it is now written to `error-log.txt` in your Dashboard Hub data folder (kept small) instead of possibly showing an error box or closing the app.
- Robustness check, stage 2. Two new tests: `test/fuzz-ipc-test.js` sends junk (wrong types, huge text, odd characters) to all 91 channels between the window and the main program (2,408 calls: nothing crashed, hung or returned unsendable data), and `test/corrupt-data-test.js` starts the app with every saved data file damaged in six different ways (it always starts normally). No bugs were found in those areas.
- Robustness check, stages 3 and 4 (tests only, no app change): `test/soak-test.js` runs the app 12 minutes with fast automatic scans and watches memory, processes and page size (all stayed flat); `test/update-e2e-test.js` starts an installed older program with the old 40-file limit, installs real update files through the real "Install update" step, restarts, checks it runs the new version, and goes back to the previous version. It also proves that a too-large update is refused, which is what broke 1.18.0.

## 1.18.2
- **Far fewer PING.EXE programs during a scan.** Before, every address on your network got its own ping (a separate PING.EXE each, up to 24 at once in a manual scan and 8 in an automatic one). Now a ping is only sent to machines that really are there (they answered the port check or are in your computer's address list), and only 8 run at once in a manual scan and 3 in an automatic one. Empty addresses are no longer pinged. Addresses on other networks are still pinged, just fewer at a time.
- The ping is only used to guess the operating system, so scan results are the same; scans of a quiet network are also lighter on the network.
- New test: `test/ping-count-test.js` counts how many pings start and how many run at once. The DNS test now waits properly for slow networks.

## 1.18.1
- **Fixed: 1.18.0 could not be installed.** It showed "Could not install the update. The update file has an unexpected number of files." The starter program that checks update files accepts at most 40 files, and 1.18.0 had grown to 44. This version has exactly 40 again, with no change in what the program does: the stylesheets of the Remote view and Notifications windows now live inside their pages, the tiny Remote view button script moved into `renderer.js`, and the two pop-out windows share one `popout-preload.js` (each window still only gets its own functions).
- If you already tried 1.18.0: nothing was installed, so you can install 1.18.1 directly.
- So this cannot happen unnoticed again: `tools/make-update.js` now refuses to build an update with more than 40 files (unless told otherwise), and the new `test/update-size-test.js` checks the file count and that no file the pages or the program load is missing. The starter's own limit is now 120, but programs built earlier keep 40, so updates stay at 40 or fewer until a new full build is installed.
- Honest note: the 1.18.0 update was built and tested, but I did not run it through the real "Install update" step. The new test and the existing update-install test do now.

## 1.18.0
- **The Alerts button moved to the top bar**, right next to "Remote view" (it used to be on the map's second row as "Alerts for:"). It works from any tab. Its hover text shows how many device kinds are selected.
- **New: Notifications Center**, a separate pop-out window with a history of devices that connected and disconnected, for troubleshooting. Open it from the new **View Notifications Center** button in the Alerts window.
  - Each row shows device name, type, MAC address, IP address(es), when it connected, when it disconnected and how long it was online. A device that changes IP address keeps one row with all its addresses.
  - Search by name, MAC or IP; filter by device type, online / disconnected and time range; sort by clicking column headings; choose the network profile; export what you see as CSV; clear a profile's finished records.
  - History is saved on this computer (`notifications.json`), per network profile, for up to a year or 5,000 connections each. Anything read back from disk is checked and cleaned first.
  - Times are when Dashboard Hub noticed a change, so they are exact with Live update on, and only as exact as the last scan otherwise.
- New tests: `test/notif-history-test.js` (25), `test/notif-center-test.js` (34), `test/tray-notify-test.js` (8). The manual's Alerts topic describes both.
- Honest limit: tested with simulated devices, not on a real network.

## 1.17.1
- The Windows uninstaller now asks, at the end, "Do you also want to delete your Dashboard Hub data?" (panels, notes, network profiles, saved servers and settings). Yes deletes the `%AppData%\dashboard-hub` folder; No (the default button) keeps everything for a reinstall. Nothing is asked or deleted in a silent uninstall or when a newer version is installed over an old one.
- Tested: the installer script compiles with the new question (and fails if the question is deliberately broken, so it really is included). Not tested: clicking through the real uninstaller, which needs Windows.

## 1.17.0
- **The Windows build now makes a real installer with an uninstaller.** `BUILD-APP.bat` produces `Dashboard-Hub-Setup.exe`. It installs for the current user (no administrator needed), lets you pick the folder, adds a Start menu entry and a desktop shortcut, and registers Dashboard Hub in Windows "Installed apps" with a proper Uninstall (also available as "Uninstall Dashboard Hub" in the install folder). Your own data (panels, notes, profiles, settings in `%AppData%\dashboard-hub`) is kept when you uninstall, so a reinstall finds it again.
  - Honest note: I looked through every version I still have (back to 1.10.82) and all of them built only a single portable program, with no uninstaller. If an earlier one had one, it was before those versions.
  - The single-file portable `Dashboard-Hub.exe` is no longer built. The same program is in the `Run without installing` folder instead.
- **The finished program now lands next to the build scripts**, in a folder called `Dashboard Hub`, instead of in `dist`. Windows: `Dashboard-Hub-Setup.exe` and `Run without installing`. Linux: `Dashboard-Hub.AppImage`. Leftover build files are tidied away (new `tools/finish-build.js`).
- **Safer Node.js step on Windows.** After a Windows VM crashed (blue screen) while testing 1.16.1, the Windows part no longer runs the Node.js installer at all. It downloads Node.js's plain zip (checked against nodejs.org's published checksum) and unpacks it into `%LocalAppData%\dashboard-hub-node`: no installer, no administrator prompt, nothing system-wide. I could not reproduce or prove what caused the crash.
- The manual has a new topic, "Installing, uninstalling and building" (22 topics now).
- Tested: the Linux build (AppImage built into `Dashboard Hub`, then started and ran), the Windows packaging step (settings accepted, `Run without installing` folder made) and the Linux/macOS Node.js tests (30 checks). Not tested: the Windows installer itself (needs Windows to build) and the Windows Node.js download.

## 1.16.1
- The install and build files now take care of Node.js. `RUN-APP`, `BUILD-APP`, `RECOMPILE-UPDATE` and `UNPACK-UPDATE` (both `.bat` and `.sh`) first check whether Node.js is installed.
  - Installed and version 22 or newer: it says so and goes straight on, nothing is downloaded.
  - Missing or too old: it asks "Download and install Node.js now? [Y/N]" and then downloads the current official LTS from nodejs.org, checks the download against nodejs.org's published checksum (and refuses to install it if that does not match), and installs it.
    - Windows: new files `ENSURE-NODE.bat` and `ENSURE-NODE.ps1` (they must stay next to the other `.bat` files). Windows asks once for permission, as it does for any installer.
    - Linux and macOS: new file `ENSURE-NODE.sh`. Node.js is unpacked into `~/.local/share/dashboard-hub-node`, needs no administrator password, and the scripts find it by themselves next time.
  - Version 22 is the oldest accepted because the Electron version used here needs Node.js 22.12 or newer.
- New test: `test/ensure-node-test.sh` (30 checks against a pretend nodejs.org: skip when installed, install when missing, replace an old one, refuse a damaged download, handle no internet).
- Honest limit: the Linux/macOS part was tested against a pretend nodejs.org, and the Windows part (`.bat` and `.ps1`) has not been run on a real Windows computer yet.

## 1.16.0
- Fewer background processes and less memory. Every panel's web page is a separate process (a separate "Dashboard Hub.exe" in Task Manager), and until now they were all started when the app opened, even if you were on the Network Map. Now:
  - Panels only start while the Panels tab is showing. Panels drawn while you are on the Network Map stay unstarted ("Not loaded yet") until you open the Panels tab, or click one to load it.
  - After 5 minutes away from the Panels tab, or with the window hidden in the tray or minimised, the pages go to sleep and their processes end. They wake when you come back, and you stay signed in. A short trip to the map changes nothing.
  - New Settings tick box: "Let panels sleep when I am away for 5 minutes (saves memory)". On by default. Untick it to keep panels running all the time.
- In a test with 6 panels, the app went from 10 processes and about 1.1 GB while sitting on the Network Map to 4 processes and about 0.5 GB once the panels were asleep.
- New test: test/panel-sleep-test.js. The manual has a note on this.
- Honest limit: Dashboard Hub always keeps about 4 processes (main program, graphics, network helper, window). Chromium needs them and they cannot be removed. The two extra windows (Remote view and the main window's tools) only start when you open them.

## 1.15.0
- New: a full **Manual** inside the About window. About now has two tabs, About and Manual. The Manual has 21 topics (getting started, panels, notes, SSH servers, the map, alerts, drawing tools, router and switch links, ports, Bandwidth Monitor, profiles, server management, Wake-on-LAN, Remote view, network boot, security, backup, updates, background running, troubleshooting and shortcuts), written in plain language with numbered steps. A search box finds topics as you type: every word must match, title matches come first, matches are opened and highlighted, and a friendly message appears when nothing matches.
- Fixed: the new "Which devices raise alerts?" window had its tick boxes and names spread out and misaligned. They now sit in one tidy column.
- The manual is checked by a test that every button it names really exists in the app.
- The guided tour is not in this version yet. It comes next.

## 1.14.1
- Documentation: README and FEATURES now say the code was written by Claude (an AI assistant) and that the ideas and testing are the owner's.
- License housekeeping: the 3D library file now carries its own MIT notice (library version r186), THIRD-PARTY-NOTICES.md states exactly which iPXE file was built with an embedded start-up script, and it has a note about product names and trademarks. No program behaviour changed.

## 1.14.0
- New: choose which kinds of device raise alerts. On the map's second row, the new "Alerts for:" button opens a window with a tick for Windows, Linux / Unix, Apple, Android, IoT / smart devices, game consoles, printers, routers and switches, and other / unknown. Only ticked kinds produce the in-app pop-ups and the desktop notices when they join, leave or return. "Tick all" and "Untick all" are there for quick changes. The choice is saved with each network profile and kept after restarting.
- Alerts are checked after the scan has identified each device, so a brand-new machine is judged by its real type (for example, a new IoT plug) and not by "unknown".

## 1.13.4
- Fixed: the "Start by itself" drop-down next to a computer's hardware address kept closing and losing its choice. The Network boot window redrew its lists on every status refresh (every 1.5 seconds), which closed any open drop-down. The lists are now redrawn only when something actually changed and never while you are using one of them. Two new checks cover this.
- UEFI firmware that ignores the short answer (a Dell Latitude kept asking over and over, never sending its follow-up request): after three asks in a row without a download, that computer is now answered the classic PXE way instead: the first answer names no file but offers a one-item boot menu and this computer as the boot server, and the file name comes in the answer to the computer's follow-up request on port 4011 (or port 67). If that fails three times too, it switches back, so both styles get tried. Both are explained in the log. BIOS computers and iPXE are never affected. New test: test/pxe-uefi-test.js (13 checks).
- Honest limit: this is the standard PXE method and is tested here against simulated firmware only; it has not yet been seen working on the Dell.

## 1.13.3
- UEFI network boot on a Dell Latitude (and other firmware that behaves the same): the follow-up request that this firmware broadcasts to the normal DHCP port (67) is now answered too, the way proxy-DHCP servers such as dnsmasq do. Before, only the first "who is there?" was answered and the follow-up on port 4011, so a computer that sends its follow-up to port 67 asked again and again and never started the download.
- The Network boot log now notes when a computer sent its follow-up to port 67 or 4011, and after four unanswered asks in 40 seconds it prints the details that matter (boot type, broadcast flag, machine ID, sending address) to make a screenshot useful.
- Housekeeping: removed example addresses, hardware addresses, device names and disc labels taken from a real test setup from the tests, placeholders and documentation (now neutral samples). Vendor and brand names that appear are only for the devices the program supports.

## 1.13.2
- Remote view now has its own button in the top bar, right before "Servers", instead of an entry in the Settings menu.

## 1.13.1
- Remote view: NoMachine is now explained up front. The Add device form for NoMachine shows a notice that NoMachine is separate, free software that is not part of Dashboard Hub and is needed on two computers (this one and the one you want to control), says whether it was found on this computer, and has a "Download NoMachine (official page)" button. If it is missing when you click a device, the tab gives the steps and a "Check again" button. Dashboard Hub deliberately opens NoMachine's own website instead of downloading and installing software by itself.
- Test: remote-ui-test now has 24 checks.

## 1.13.0
- New: **Remote view**, a separate window (Settings → "Remote view (KVM, NoMachine)...") for PiKVM, JetKVM, other web KVMs and NoMachine. Devices are saved by name and address; each opens in a tab. Web KVMs show inside the window with their own sign-in (self-signed certificates accepted for the saved devices only); NoMachine starts your installed NoMachine program with the connection filled in. Full screen mode has an Exit button so Esc reaches the remote computer. The window can only open web views for the exact addresses you saved.
- New files: remote.js, remote.html, remote.css, remote-ui.js, remote-preload.js, remote-open.js. New tests: test/remote-test.js (24 checks), test/remote-ui-test.js (19 checks).
- Honest limit: tested against simulated devices only (fake PiKVM with a self-signed certificate, fake JetKVM, fake NoMachine player), not real hardware.

## 1.12.0
- Windows installs (experimental): Windows discs (Windows 10 and 11) are recognised and started with `wimboot` (built unchanged from the official source). The Windows setup program then connects to a shared folder on a Windows PC and runs Setup from there, like a Windows deployment server, so nothing large goes into the booting computer's memory. New "Windows installs (advanced)" block in the Network boot window: share address, Windows account, and a checkbox to skip the Windows 11 hardware checks. The password is typed on the booting computer and never stored. An `autounattend.xml` at the top of the share is used automatically for a no-questions install.
- ISO reading now understands the "Joliet" file list, which many Windows discs use instead of the plain one.
- New test: test/pxe-win-test.js (19 checks).
- Not tested here on a real Windows setup: only the web side and the generated scripts are checked.

## 1.11.0
- Unattended installs (Network boot window → "Unattended installs (advanced)"): save a user name, password, computer name, time zone and keyboard layout, then choose "UNATTENDED install, ERASES THE DISK, once" in a listed computer's drop-down. Ubuntu Server style discs get an autoinstall `user-data`; Rocky/Alma/Fedora style discs get a kickstart file. Safety: asks for confirmation, only for computers you listed, never shown in the normal menu, and one-shot (the computer goes back to starting from its own disk as soon as it fetches its answers, so it cannot reinstall in a loop). The password is stored only as a SHA-512 hash (checked against `openssl passwd -6`).
- New test: test/pxe-auto-test.js (28 checks).

## 1.10.99
- UEFI: new setting in the Network boot window, "UEFI computers get": the standard loader (`snponly.efi`) or an alternative loader (`ipxe.efi`, iPXE's own network drivers). Use the alternative one if a UEFI computer stalls. Both were tested here in a virtual UEFI computer (QEMU, Intel e1000 card): the menu and a 28 MB kernel downloaded in 1 second with either. A stall that only shows in VirtualBox's UEFI mode is therefore specific to VirtualBox's own network handling, not to the loader or to Dashboard Hub's web server.
- The "What is happening" window now reports big downloads (kernel, initrd, installer image): when they start, when they finish and how long they took, and when a computer stops part way. This shows where a stall happens.
- The UEFI start script now prints the network state (`ifstat`, `route`), gives each try a time limit, and pings the Dashboard Hub computer if it cannot get the menu, so a stall shows a reason on screen.

## 1.10.98
- Rocky Linux, AlmaLinux, CentOS, Fedora and RHEL discs are now recognised and started properly. Before, they were started as a "generic ISO", and the installer stopped with "missing inst.stage2 or inst.repo". The menu now tells the installer where its files are (`inst.stage2=...`, and `inst.repo=...` when the disc carries the packages). ISOs added earlier as "generic" are re-checked automatically.
- New test: test/pxe-rocky-test.js.

## 1.10.97
- Older (BIOS) network boot: the boot loader now has a small script built in. After it gets an address it follows the menu address from Dashboard Hub, retries up to 6 times if that address has not arrived yet, and falls back to the Dashboard Hub computer's address. This fixes "Nothing to boot: No such file or directory" seen in a VM.

## 1.10.96
- Fixed the main Linux ISO problem: Ubuntu's boot script only accepts a download address that ENDS IN ".iso" (`url=*.iso`). Ours ended in "/iso", so Ubuntu silently ignored it, which caused "can't open /dev/sr0: No medium found", the hang, and the fallback to downloading from Ubuntu's website. ISOs are now offered at `.../image.iso` and the menu uses `boot=casper ip=dhcp url=.../image.iso`. (Checked against the real casper 26.04 source.)
- UEFI: computers now get `snponly.efi` (built unchanged from iPXE source), which uses the network card the firmware already opened. The old `ipxe.efi` found no network card in VirtualBox's UEFI mode and stalled right after "autoexec.ipxe... ok". `ipxe.efi` is still available as a fallback.

## 1.10.95
- Network boot (UEFI): the start-up script now prints what it is doing, tries the menu first with the network settings the computer already has (instead of asking for a new address first, which stalled in VirtualBox's UEFI mode), and only then asks for an address and shows the network status.

## 1.10.94
- Fixed: Ubuntu live ISO from the network menu now starts the download instead of looking for a CD drive ("can't open /dev/sr0: No medium found"). The menu line now matches the recipe netboot.xyz uses: `root=/dev/ram0 ramdisk_size=... ip=dhcp url=...`, with the ramdisk size set from the ISO's size.

## 1.10.93
- Fixed: starting an Ubuntu live ISO from the network menu stopped with "wget: bad address ''" / "Unable to find a live file system on the network". The menu line used an old `netboot=url` option that makes Ubuntu ignore the ISO address; it now uses `ip=dhcp url=...` as Ubuntu documents.
- Network boot window: an Ubuntu-style ISO now shows how much memory the booting computer needs (Ubuntu loads the whole disc into RAM), so a VM is not left with too little.

## 1.10.92
- Network boot, UEFI: the server now also offers a tiny `autoexec.ipxe` script over TFTP, which iPXE looks for right after it starts. It points iPXE straight at the menu, so the boot no longer depends on a second DHCP exchange (this was stalling in VirtualBox's UEFI mode right after "autoexec.ipxe... Not found"). If the menu can't be reached, iPXE drops to its command line instead of stopping silently. Works for older BIOS mode too.
- Network boot window: VirtualBox tips now say EFI can be on or off.

## 1.10.91
- Fixed: network boot failed on VirtualBox and other virtual machines with "Could not start download: Operation not supported". Their built-in boot ROM is iPXE without web download support. The server now detects that and first sends its own full boot loader over TFTP, then the menu. The window log says when it does this. If a boot ROM keeps coming back without web support, the server stops answering it after a few tries and says why, instead of looping.

## 1.10.90
- Network boot: each listed computer can now have its own default: show the menu, or start an ISO, netboot.xyz or its own disk by itself after 5 seconds (any key opens the menu instead). If something fails to start, the menu waits calmly instead of retrying forever.
- Network boot: new "Check my setup" button. It checks the chosen connection, the list, the boot files and whether each port can be opened, and explains any problem in plain words.
- Network boot: built-in tips for testing with a VirtualBox (or similar) virtual machine.

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
