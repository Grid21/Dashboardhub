# Dashboard Hub

**Your whole network and every tool you use to run it, in one desktop app.**

Web panels, encrypted notes, SSH shortcuts, a live 3D map of your network, router and switch connections, server power control, traffic dials, Wake-on-LAN and more. It's built for home labs, small offices and IT professionals who look after more than one network. It runs on your own computer, with no account to create and no service to sign up for.

---

## How to install and start Dashboard Hub

You don't need to know any programming. You need **Node.js 24 LTS or newer** (the free "LTS" download from [nodejs.org](https://nodejs.org)).

1. **Install Node.js.** Go to [nodejs.org](https://nodejs.org), click the **LTS** download (version 24 or newer) and install it with the default choices. To check, open a terminal (Command Prompt on Windows) and type `node -v`. It should show `v24` or higher.
2. **Get Dashboard Hub.** On the project's GitHub page click **Code**, then **Download ZIP**, and unzip it to a folder you'll keep. (Or clone it with GitHub Desktop.)
3. **Start it.**
   - **Windows:** double-click `RUN-APP.bat`.
   - **Linux:** open a terminal in that folder and run `./RUN-APP.sh` (if it says permission denied, run `chmod +x RUN-APP.sh` first).
4. **The first start takes a few minutes.** It downloads what it needs and needs an internet connection. After that it starts quickly.

**Want a finished program instead of running from the folder?** Double-click `BUILD-APP.bat` on Windows (it makes `dist\Dashboard-Hub.exe`), or run `./BUILD-APP.sh` on Linux (it makes `dist/Dashboard-Hub.AppImage`). If the project's Releases page has a ready-made `Dashboard-Hub.exe`, you can download and run that directly, with no Node.js needed.

**Updating later:** open **Updates** in the top bar. You can check online (if you turn that on), or install a `.hubupdate` file you were given. You can also go back to earlier versions there, and choose how many are kept.

---

## Why Dashboard Hub?

Most of us run a network with a pile of separate tools: a browser full of bookmarks, an SSH client, a notes app, a network scanner, a router admin page for each router, an SNMP viewer, a tab for each server's management chip. Dashboard Hub puts those jobs in one place, and connects them to each other.

- **One app instead of ten tabs.** Your dashboards, servers, notes and network map live side by side. Click a machine on the map and see its ports, link speed, file shares, power state and management chip, without opening anything else.
- **Works with the gear you already own.** It talks to many router, switch and controller brands (UniFi, MikroTik, OpenWrt, OPNsense, ASUS, Netgear, FRITZ!Box, Omada, Meraki, Cisco, Aruba CX, HPE and anything that speaks SNMP). It doesn't lock you into one vendor.
- **Built for people with more than one network.** Each network gets its own profile with its own map, panels, servers, notes, router links and server logins. Dashboard Hub notices when you've plugged into a different network and offers to switch for you.
- **Honest about what it knows.** If a router can't report a link speed, the app says "not reported". It doesn't invent a number. Every guess (like a machine's operating system) comes with the reasons behind it, and you can correct it.
- **Private and local.** Your data stays on your computer. Passwords and notes are encrypted with your operating system's own secure storage and are never put in a backup. It only talks to addresses inside your own network.
- **Read-only by design.** The router and switch connections only read information. They never change a setting on your equipment.
- **Made to be understood.** Plain-language messages, clear errors that say what to check, and a manual update file system that doesn't need an installer or an internet connection.

---

## Major features

### 1. Live 3D network map
- Scans your network (ping, common-port checks and the ARP table) and draws every machine in an interactive 3D map, with your router in the middle.
- **Three scan depths**: quick (about 15 seconds), thorough, and a quiet background scan.
- **Live update**: the map keeps watching and shows machines joining, leaving and coming back. Intervals run from 15 seconds to 30 minutes.
- **Smart identification**: guesses the type of every machine (router, switch, Windows, Linux, Apple, Android, smart-home device, game console, printer, network gear) and shows the reasons for the guess. You can override it.
- **Maker lookup**: names the manufacturer from the hardware address.
- **Alerts**: in-app notices or desktop notifications when something new appears, leaves or returns, and they keep working while the app is hidden in the tray.
- **Drawing tools**: add switches and your own machines, draw cables, group and label machines, add VLAN names, tidy the layout, and use a top-down view.
- **Device list**: search, filter and select several machines to change their type, connection, group or VLAN in one go, or to wake them up.
- Your map and layout save automatically.

### 2. Router, switch and controller connections
- Ask your gear what it can see: names, Wi-Fi or cable, signal strength, and which switch port each machine uses. The map then draws the right lines on its own.
- **Supported out of the box**: SNMP (versions 1, 2c and 3, so most managed switches and routers), UniFi, OpenWrt, MikroTik RouterOS 7, OPNsense, ASUS (original firmware and usually Merlin), Netgear (including Nighthawk and Orbi), FRITZ!Box, TP-Link Omada, Cisco Meraki (cloud), Cisco IOS XE, Aruba CX and HPE OfficeConnect / ProCurve.
- **SNMP finder**: checks every machine on your map for SNMP and adds the ones that answer with a single click.
- Logins are stored encrypted and are never put in a backup. Connections are read-only.
- Quickly notices a switch that's been unplugged or switched off.

### 3. Switch and router port view
- See every port on a managed switch or router: linked or not, its speed (for example 1 Gbps, 2.5 Gbps or 10 Gbps), and which machines are plugged into it. The uplink toward your router is marked.
- Click a machine's name in the port list to jump to it. A machine's own pane says which port it's on.
- Works with any SNMP device and with UniFi switches and gateways.

### 4. Bandwidth Monitor
- A show-and-hide window with live **upload and download dials** and tidy bars for every source of traffic data.
- Follows **your main router's internet connection** whatever its brand, or any port you choose, or this computer's own network cards when nothing else is available.
- Reads traffic per router, port or network card from the devices' own counters. Routers that don't share counters just show no data.

### 5. Network profiles (made for IT professionals)
- One profile per network: **its own map, panels, SSH servers, encrypted notes, router and switch links, and server-management logins**. A new profile starts clean.
- **Network Guard**: recognises which network you're on by the router's fingerprint. If you're on the wrong profile, it asks whether to switch. It also stops one network's scan from overwriting another network's map.
- **Lock a profile's map** so it can't be changed by mistake.
- Duplicate, rename or remove profiles. Backups include every profile.

### 6. Server management (iLO, iDRAC and other BMCs)
- Connect to server management chips over the standard Redfish interface (HPE iLO, Dell iDRAC and compatible).
- See power state, health, temperatures, power draw and hardware details. Power on, shut down gracefully, restart or force off.
- Link a management login to a machine on the map, so its pane shows the server's status and "wake up" can power on a server that doesn't support Wake-on-LAN.

### 7. Wake-on-LAN
- Wake one machine or many from the map or the device list.
- Sends the wake signal out of every network card, then watches the map to confirm it woke up. Slow starters get time to boot.

### 7b. Network boot (PXE) — new, early
- Boot another computer from this one over the network cable, with no USB stick: Settings → "Network boot (PXE)...".
- Off until you press Start. It only answers the computers (MAC addresses) you list, never hands out addresses (your router's DHCP stays in charge), and the menu itself never installs or erases anything.
- Offers Ubuntu/Debian-style live ISOs you add, other ISOs in a generic way, and the netboot.xyz menu (live, rescue and installer images; the booting computer needs internet).
- Early feature: tested with simulated network boots and a real app, but not yet on real network-boot hardware. Needs administrator rights on Windows (or `sudo` on Linux) because boot ports are protected.

### 8. Web dashboard panels
- Put all your web tools (router pages, NAS, Proxmox, Home Assistant, Grafana and more) in panels in one place, each in its own isolated web view.
- Works with the **self-signed certificates** most home-lab tools use.
- **Full screen for any panel**: a Maximize button makes a panel fill the whole window to work in it, with an Exit full screen button (or Esc) to go back. The page inside is not reloaded.
- Search inside a panel with Ctrl+F, reload everything with one click.

### 9. Encrypted notes and SSH shortcuts
- **Notes per panel and per server**, encrypted with your operating system's secure storage.
- **SSH server list**: save your servers and open them in a terminal with one click.

### 10. Backup and restore
- Export and import your panels, servers, notes, profiles and network maps in one file.
- Passwords and logins are **never** included.

### 11. Manual update system
- **Optional update checks (off until you say yes)**: the app can look for a newer version on this project's GitHub releases page. You choose what happens: **Install**, **Remind me later** or **Skip this version**. Nothing is ever installed without your click, and it asks again before installing.
- Updates are a single small file that works with no installer and no internet connection needed. You can also pick a downloaded update file by hand.
- **Go back to an earlier version**: Dashboard Hub keeps a checked copy of the versions it ran, and the Updates window lists them with a button to return to any one. You choose how many earlier versions to keep (1 to 10, standard 4), like the backup count in backup programs. There is also a way back to the built-in version.
- Each file inside is verified with a checksum. A small fixed starter program can always start the app, so a bad update can't leave you locked out.

---

## Minor features

### Network map extras
- **Link speed** on every device pane (wired and Wi-Fi, in both directions), with a manual setting for cables that no router can report, and an uplink speed for switches.
- **File-sharing detection**: marks machines that offer SMB, NFS, Apple file sharing, FTP, WebDAV, rsync or iSCSI. A "List shares" button shows what a machine shares (when it allows it without a login), and the network path can be copied in one click.
- **DNS server detection**: finds which machines answer DNS (your router, a Pi-hole, a Windows or Linux DNS server) and says what software they run. It shows this in the device pane, along with a list of the DNS servers on the network. Which server a phone or smart device is set to use can't be seen from outside, and the app says so instead of guessing.
- **How long a device has been online**: every device pane shows "Seen online for X days" (counted while Dashboard Hub is watching) and when it was first seen. Where the device itself reports it, the pane also shows its own uptime (SNMP switches, routers and access points, and UniFi gear) or how long a client has been connected (UniFi). When a device doesn't report it, the app says so.
- **Network printers** are detected and shown as their own type.
- **Game console detection** (PlayStation, Xbox, Nintendo, Steam Deck).
- **Services list** per machine: see detected web services and VPNs, rename or hide them, and open them in your browser.
- **Offline machines** can be hidden or shown, and a colour key filters the map by device type.
- **Run LAN speedtest**: refreshes what your routers and switches report about the link rate of the selected machines.
- Mark which machine is **this computer**, and see its own link speed.

### Dashboard and app extras
- **Update file tools built in**: unpack any `.hubupdate` into its source files, or pack a folder back into one, from inside the app, with plain-language messages and no command line.
- **About window**: shows the version, the license and a table of every network port the app uses, handy when your network has a firewall.
- **Security settings** (Settings menu): choose whether panels may use self-signed certificates, open pop-up windows, or use the camera, microphone, notifications and clipboard; switch off the thorough scan, router connections or Cisco Meraki; and require SNMP version 3. "Standard" and "Strictest" buttons set everything at once. The protections that must never be off (page isolation, update-file checks, local-network-only scanning) are fixed on purpose.
- **Run in the background**: an option to hide in the system tray when you close the window (Windows and Linux), with notifications and live scans carrying on.
- **Graphics card (GPU) switch** with a status line, for machines with driver trouble.
- A tidy **Settings menu** that holds profiles, backup, server management and the tray and GPU options.
- Dark interface with clear plain-language messages.
- Single-instance behaviour when running in the tray.

### Safety and privacy details
- The scanner and every connector only talk to **addresses inside your own network** (the two deliberate exceptions are Meraki's cloud connection, if you use it, and the optional update check, which contacts only GitHub).
- The app's pages are isolated from the system (no direct system access), and every internal request is checked.
- Notes, router logins and server logins are encrypted with the operating system's secure storage. When a computer can't encrypt, they're kept in memory only and never written to disk.
- Backups are cleaned and checked when imported.
- **Any switch or router over SSH (no SNMP):** add a connection of type "SSH". The app runs a few fixed read-only commands on the device and reads its ARP table, MAC table (which switch port each machine is on) and DHCP leases. Device kinds: linux (OpenWrt and other Linux routers), mikrotik, cisco (IOS / IOS XE) or other (anything that answers "show arp"). Login uses your SSH key (empty password) or, on Linux and macOS, a password. Commands cannot be typed in, only the listed ones run. Needs the `ssh` program (Linux, macOS and current Windows include it).
- **Finding machines without SNMP:** the scan never needs SNMP. Settings > Security > "Finding machines" has a switch for each way of finding machines: ping and port checks, mDNS/Bonjour, SSDP/UPnP, NetBIOS names and DNS name lookups, plus a master switch for SNMP. "Quiet scan, no SNMP" sends no pings or port checks and only listens, so it finds machines that announce themselves or that this computer already knows (ARP table). Router and controller connections (UniFi, MikroTik, OPNsense, OpenWrt and others) also list machines without SNMP. Each machine records which methods found it. The About window lists the ports each method uses.
- **Device groups:** tick machines in the Devices list, type a name and press "Set group" (or "Remove from group" to take them out). The map draws a coloured circle with the name around them and they move together when you drag one (Ctrl+drag moves just one). "Move groups together" and "Group circles" switch each part on or off.
- **Graphics safety:** the 3D map stops drawing completely while the window is hidden, minimised or in the tray, and idles at a low, steady rate when nothing changes (independent of monitor refresh rate). It survives a graphics-driver reset (context loss/restore), falls back gracefully on weak graphics, caps its picture size, and never runs two draw loops. If the graphics process crashes 3 times in 10 minutes, the app switches to software drawing by itself and explains why in Settings. A crashed main page reloads automatically.

### Quality
- Extensive automated tests cover the scanner, the router and switch connectors, the update system, profiles, the network guard, notifications and the interface. It has been tested on real home-lab hardware as well as on simulated devices (more about that below).

---

## Honest status and limits

We'd rather you hear this from us first:

- **Tested on real home-lab hardware and on simulated hardware.** It has run on a real home lab (an ASUS router, a Netgear access point, an HPE switch and a mix of other devices), and the scanner and connectors are also tested against stand-in devices and sample outputs, which is how brands without a test unit are covered. Other brands should work through the standard methods (SNMP and each vendor's own interface), but reports from real equipment are very welcome.
- **Routers and switches only share what they choose to.** An unmanaged switch can't report its ports. Many consumer routers don't report link speeds, port details or traffic per device. When that happens, Dashboard Hub says so instead of guessing.
- **Per-device bandwidth** isn't available from most gear, so the Bandwidth Monitor shows traffic per router, port or network card.
- **Operating systems**: developed and tested on Windows and Linux. macOS code paths exist but have had little real-world testing.
- **Network boot (PXE) is new.** The protocol parts are tested against simulated computers, but not yet against real PXE hardware. It needs a cable connection, administrator rights, and a computer whose BIOS can network boot. Secure Boot usually has to be off.
- Listing a machine's file shares often needs a login. On Linux it also needs the `smbclient` package.

---

## Run it or build it yourself

You don't need to know any programming. You only need **Node.js 24 LTS or newer** (the free "LTS" download from [nodejs.org](https://nodejs.org)). The step-by-step version is at the top of this page.

| I want to... | Windows | Linux |
|---|---|---|
| **Run** Dashboard Hub straight from the source | double-click `RUN-APP.bat` | run `./RUN-APP.sh` |
| **Build** the finished program | double-click `BUILD-APP.bat` (makes `dist\Dashboard-Hub.exe`) | run `./BUILD-APP.sh` (makes `dist/Dashboard-Hub.AppImage`) |

The first time, these download what they need (a few minutes, internet connection required). Developers can also use `npm install`, `npm start` and `npm run dist`.
**Linux: "Cannot mount AppImage, please check your FUSE setup"?** That is not a Dashboard Hub bug. An AppImage needs a small system library called FUSE 2, and newer Ubuntu-based systems (Linux Mint 22, Ubuntu 24.04) do not include it. Fix it once in a terminal: `sudo apt install libfuse2t64` (on Mint 21 / Ubuntu 22.04 use `sudo apt install libfuse2`). Or skip the fix and start it with `./Dashboard-Hub.AppImage --appimage-extract-and-run`. Running from the source folder with `./RUN-APP.sh` never needs FUSE.

macOS: the code is written to be cross-platform, but there is no macOS build set up yet and it has had little testing.

---

## Get involved
- **Report a device**: tell us the brand and model of a router, switch or printer that wasn't recognised or behaved oddly.
- **License**: free software under the **GNU General Public License v3 or later (GPL-3.0-or-later)**. You can use it, study it, change it and share it. If you share a modified version, you must share its source under the same license, so improvements stay open for everyone. See the `LICENSE` file.
- **Open source and easy to build on**: Dashboard Hub is written in plain JavaScript on Node.js and Electron, so the source is readable as it is. Anyone can open the code, change it and run it with `npm start`. Standard build tooling (electron-builder, already set up for Windows and Linux) packages it into a finished program. Update files (`.hubupdate`) are plain, checksummed bundles, and a built-in **Update file tools** window (Settings menu) and a command-line compiler and decompiler let the community unpack and pack them, so it's simple to inspect an update, make your own and add new router brands, device types and features.
- **Contributing**: _(to be added)_ By contributing you agree your work is released under the same license.

*Please scan responsibly: only scan networks you own or have permission to scan.*
