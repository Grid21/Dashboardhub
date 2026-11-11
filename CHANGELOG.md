# Changelog

All notable changes to Dashboard Hub. Newest first.

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
