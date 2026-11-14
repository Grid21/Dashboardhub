// The Dashboard Hub manual, shown in the About window. Plain data: each section has a title, extra search words and a body.
// A body line is a paragraph (string), or { steps: [...] } (numbered), or { list: [...] } (bullets), or { tip: '...' }.
(function () {
  const M = [
    {
      id: 'start', title: 'Getting started',
      words: 'first run begin install overview top bar buttons tabs',
      body: [
        'Dashboard Hub is one desktop app for the tools you use to run a network: web panels, a live 3D map of your network, router and switch connections, SSH servers, server management, encrypted notes, network boot and remote screens.',
        'The bar across the top has everything you use most:',
        { list: [
          'Panels: your web dashboards (router pages, NAS, Proxmox, Home Assistant and so on).',
          'Network Map: the live 3D map of your network.',
          'Profile: shows which network profile you are on. Open it from Settings.',
          'Remote view: opens a separate window for PiKVM, JetKVM and NoMachine.',
          '>_ Servers: your SSH server list.',
          'Settings: profiles, server management, network boot, security, backup, background running and update checks.',
          'Updates: install an update file, or go back to an earlier version.',
          'About: the version, license, this manual and a guided tour.',
          'Reload: restarts the page if something looks wrong (Ctrl+R or F5).'
        ] },
        { tip: 'Everything starts from this computer. Dashboard Hub only talks to addresses inside your own network. The only internet traffic is the optional update check and Cisco Meraki, if you use it.' }
      ]
    },
    {
      id: 'panels', title: 'Web panels (dashboards)',
      words: 'panel add website url full screen maximize certificate self-signed reload columns height search ctrl+f',
      body: [
        'A panel is a web page shown inside Dashboard Hub, such as your router, NAS or Proxmox page. Each panel is isolated from the others.',
        { steps: [
          'Click Panels, then + Add panel.',
          'Type a name and the address, for example 192.168.1.50:3001. If you leave off http:// it is added for you. Use https:// for secure ones like TrueNAS.',
          'Click Save. The panel appears and loads.'
        ] },
        { list: [
          'Columns and Panel height (top bar) change how panels are laid out. Panel height has a Full screen choice.',
          'Maximize on a panel makes it fill the window. Use the Exit full screen button or Esc to go back. The page is not reloaded.',
          'Press Ctrl+F inside a panel to search its page.',
          'Reload all reloads every panel at once.',
          'A panel that fails to load or crashes reloads by itself, waiting a little longer each time. Turn this off in Settings ("Reload a panel by itself when it fails").',
          'To save memory, a panel\'s page is only started while the Panels tab is showing. If you are on the Network Map, or the window is hidden, for 5 minutes, the pages go to sleep and wake when you come back (a sleeping panel says so, and you can click it to wake it). You stay signed in. Untick "Let panels sleep when I am away for 5 minutes" in Settings to keep them running all the time.',
          'Self-signed certificates (common in home labs) work. You can tighten this in Settings, Security settings.'
        ] }
      ]
    },
    {
      id: 'notes', title: 'Notes (encrypted)',
      words: 'note password login secret encrypted storage',
      body: [
        'Every panel and every server has its own Notes button. Use it for logins, setup steps or anything you want to remember about that device.',
        { list: [
          'Notes are encrypted with your operating system\'s secure storage.',
          'A dot on the button (Notes ●) means there is a note.',
          'If your computer cannot encrypt, notes are kept in memory only and never written to disk. Dashboard Hub tells you when this happens.',
          'Notes belong to the network profile you are on. Backups never include notes or passwords.'
        ] }
      ]
    },
    {
      id: 'servers', title: 'SSH servers',
      words: 'ssh terminal linux server login key connect putty',
      body: [
        'Save your Linux servers and open a terminal to any of them with one click.',
        { steps: [
          'Click >_ Servers.',
          'Fill in the form at the bottom of the window: name, address, user name and port.',
          'Click Save server. Use Edit to change it later.',
          'Click a server to open it in a terminal window.'
        ] },
        'Each server has its own Notes button. This needs the ssh program, which Linux, macOS and current Windows include.'
      ]
    },
    {
      id: 'map', title: 'The network map',
      words: 'scan 3d network devices find router zoom rotate top view reset tidy offline services list devices live update quick thorough background',
      body: [
        'The Network Map scans your network and draws every machine in an interactive 3D map, with your router in the middle.',
        { steps: [
          'Click Network Map.',
          'Check the Network and Router boxes. Dashboard Hub fills them in for you.',
          'Choose a scan depth (Quick is about 15 seconds, Thorough looks at more ports) and click Scan network.',
          'Click a machine to see its address, hardware address, open ports, system and link speed in the panel on the right.'
        ] },
        { list: [
          'Drag a machine to move it. Drag empty space to turn the map. Scroll to zoom.',
          'Reset view and Top view (in the Map layout and hardware menu) always bring the map back. Tidy up puts every machine back in a neat spiral.',
          'Devices opens a searchable list. Tick several machines to change their type, connection, group or VLAN in one go, or to wake them up.',
          'Live update keeps watching your network and shows machines joining, leaving and returning. Choose how often, from every 15 seconds to every 30 minutes. A green dot says what it is doing.',
          'Show offline hides or shows machines that are not currently on the network.',
          'Show services adds small boxes for web apps, Docker containers and VPNs found on each machine.',
          'The colour key at the top left filters the map by device type. Tick a type to show only that type.',
          'Your map and layout save automatically.'
        ] },
        { tip: 'Dashboard Hub guesses each machine\'s type and shows its reasons. If it guessed wrong, open the machine and set the type yourself.' }
      ]
    },
    {
      id: 'alerts', title: 'Alerts and notifications',
      words: 'alert notification desktop popup toast join leave new device iot windows linux filter type',
      body: [
        'Alerts tell you when something new appears on your network, disconnects or returns.',
        { steps: [
          'On the Network Map, open the Alerts drop-down and choose Off, In the app, or App + desktop notice.',
          'Click the Alerts button in the top bar (next to Remote view) to choose which kinds of device raise alerts.',
          'Tick the kinds you care about, for example Windows and Linux only, or IoT only, and click Save.'
        ] },
        { list: [
          'The kinds are Windows, Linux / Unix, Apple, Android, IoT / smart devices, game consoles, printers, routers and switches, and other / unknown.',
          'The choice applies to both the in-app pop-ups and the desktop notices.',
          'It is saved separately for each network profile.',
          'Alerts only start after the first full scan, so you are not flooded the first time.',
          'Desktop notices keep working while the app is hidden in the tray.'
        ] },
        'The same window has a View Notifications Center button. It opens a separate window with a history of every device that connected and disconnected, for troubleshooting:',
        { list: [
          'Each row shows the device, its type, MAC address, IP address(es), when it connected, when it disconnected, and how long it was online.',
          'Search by name, MAC address or IP address, and filter by device type, online or disconnected, and time range (hour, day, week, month or all time). Click a column heading to sort.',
          'Pick which network profile to look at. Export list (CSV) saves what you see as a spreadsheet file. Clear history deletes the finished records of that profile.',
          'Times are when Dashboard Hub noticed the change, in your computer\'s time zone. It notices changes when it scans, so turn on Live update on the Network Map for the most exact times.',
          'History is kept on this computer only, for up to a year or 5,000 connections per profile.'
        ] }
      ]
    },
    {
      id: 'drawing', title: 'Switches, cables, lines and groups',
      words: 'switch cable draw line group vlan label circle add machine physical',
      body: [
        'Scanning cannot find every switch, and cannot tell which cable goes where. You can add these yourself.',
        { list: [
          'Add switch (in the Map layout and hardware menu) puts a switch on the map. Then connect it to the router and your machines with lines.',
          'Draw lines: click one machine, then another, to draw a line between them. Click the same pair again to remove it.',
          'Draw physical cable is for switches that cannot be found by scanning: click one machine, then the other.',
          'Groups: tick machines in the Devices list, type a name and press Set group. The map draws a coloured circle with the name around them, and they move together when you drag one (Ctrl+drag moves just one). Remove from group takes them out.',
          'VLAN names: type a label such as 20 IoT on a machine or on several selected machines.',
          'Move groups together and Group circles switch each part on or off.'
        ] }
      ]
    },
    {
      id: 'connectors', title: 'Router and switch links',
      words: 'router switch snmp unifi mikrotik openwrt opnsense asus netgear fritz omada meraki cisco aruba hpe ssh connector login',
      body: [
        'Ask your own equipment what it can see: names, Wi-Fi or cable, signal strength and which switch port each machine uses. The map then draws the right lines by itself. Connections are read-only and never change a setting.',
        { steps: [
          'Open Map layout and hardware, then Router & switch links.',
          'Fill in the Add a connection form: choose the kind (see below) and enter its address and login.',
          'Save, then scan again. The map improves as the equipment answers.'
        ] },
        'Supported: SNMP (versions 1, 2c and 3), UniFi, OpenWrt, MikroTik RouterOS 7, OPNsense, ASUS, Netgear, FRITZ!Box, TP-Link Omada, Cisco Meraki (cloud), Cisco IOS XE, Aruba CX, HPE OfficeConnect / ProCurve, and SSH for anything else.',
        { list: [
          'SNMP finder checks every machine on your map for SNMP and lets you add the ones that answer.',
          'Logins are stored encrypted and are never included in a backup.',
          'SSH connections run only a few fixed read-only commands. Device kinds are linux, mikrotik, cisco and other.',
          'If a device cannot report something, such as a link speed, Dashboard Hub says "not reported" instead of guessing.'
        ] },
        { tip: 'For SNMP use version 3, or a read-only community with a name of your own (not "public"), and never expose it to the internet.' }
      ]
    },
    {
      id: 'ports', title: 'Switch and router ports',
      words: 'port speed gbps uplink link switch ports view',
      body: [
        'See every port on a managed switch or router: whether it is linked, its speed (for example 1, 2.5 or 10 Gbps) and which machines are plugged in. The uplink toward your router is marked.',
        'Click a machine\'s name in the port list to jump to it. A machine\'s own panel also says which port it uses. This works with any SNMP device and with UniFi switches and gateways.'
      ]
    },
    {
      id: 'bandwidth', title: 'Bandwidth Monitor',
      words: 'bandwidth traffic upload download dial speed internet',
      body: [
        'Click Bandwidth (top left of the map) for live upload and download dials.',
        { list: [
          'It follows your main router\'s internet connection, or any port you choose, or this computer\'s own network cards when nothing else is available.',
          'It reads the devices\' own counters. A router that does not share counters shows no data.',
          'Most equipment cannot report traffic per machine, so the monitor shows traffic per router, port or network card.'
        ] }
      ]
    },
    {
      id: 'profiles', title: 'Network profiles and Network Guard',
      words: 'profile network guard lock duplicate rename remove switch home office',
      body: [
        'A profile keeps everything for one network separate: its map, panels, SSH servers, notes, router links and server logins. Use one per site or home.',
        { list: [
          'Settings shows the profile list. New, Duplicate, Rename, Lock map and Remove profile are in the same menu.',
          'Network Guard recognises the network you are plugged into by the router\'s fingerprint. If you are on the wrong profile it asks whether to switch, and it stops one network\'s scan overwriting another\'s map.',
          'Lock map makes a profile\'s map read-only so a scan or router check cannot change it.',
          'Backups include every profile.'
        ] }
      ]
    },
    {
      id: 'bmc', title: 'Server management (iLO, iDRAC)',
      words: 'ilo idrac bmc redfish power server management on off restart temperature health',
      body: [
        'Connect to the management chip of a server (HPE iLO, Dell iDRAC and compatible) to see its state and control its power.',
        { steps: [
          'Open Settings, then Server management (iLO / iDRAC)...',
          'Fill in the form: a name, the management (BMC) address, the user name and password, then click Test and save.',
          'Your server appears in the list with its power state, health, temperatures, power draw and hardware details.',
          'Use Power on, Shut down, Restart or Force off. Force off cuts power immediately.'
        ] },
        'You can link a management login to a machine on the map. Its panel then shows the server\'s status, and Wake up can power on a server that has no Wake-on-LAN.'
      ]
    },
    {
      id: 'wol', title: 'Wake-on-LAN',
      words: 'wake wol power on boot remote magic packet',
      body: [
        'Wake one machine, or many, from the map or the Devices list. Dashboard Hub sends the wake signal out of every network card, then watches the map to confirm the machine woke up. Slow starters are given time.',
        { tip: 'The machine must have Wake-on-LAN switched on in its BIOS/UEFI and its network card settings, and must be connected by cable.' }
      ]
    },
    {
      id: 'remote', title: 'Remote view (PiKVM, JetKVM, NoMachine)',
      words: 'remote kvm pikvm jetkvm nomachine nx screen desktop control',
      body: [
        'Remote view opens in its own window, separate from the main app, so it stays open on another screen.',
        { steps: [
          'Click Remote view in the top bar.',
          'Click + Add a device. Enter a name, choose the kind, the address and an optional port.',
          'Click a device to open it in a tab. Open several at once. Right-click a device to edit or remove it.'
        ] },
        { list: [
          'PiKVM, JetKVM and other web KVMs open inside the window. Sign in on the device\'s own page. Dashboard Hub stores only the address, never a password.',
          'Buttons: Reload, Full screen (an Exit button leaves it, so Esc still reaches the remote computer) and Open in browser.',
          'NoMachine is separate, free software that is not part of Dashboard Hub. Install it on this computer and on the computer you want to control. The Add a device form tells you whether it is installed and links NoMachine\'s official download page.',
          'NoMachine uses its own protocol, so Dashboard Hub starts the NoMachine program with the connection filled in. NoMachine asks for the password in its own window.'
        ] }
      ]
    },
    {
      id: 'pxe', title: 'Network boot (PXE)',
      words: 'pxe network boot ubuntu iso install usb uefi bios rocky alma fedora windows unattended autoinstall kickstart netboot.xyz tftp dhcp',
      body: [
        'Boot another computer from this one over the network cable, with no USB stick. Open Settings, then Network boot (PXE)...',
        { steps: [
          'Plug both computers into the same network by cable. Run Dashboard Hub with administrator rights (Windows) or sudo (Linux), because boot ports are protected.',
          'Add the ISO files you want to offer, and list the hardware (MAC) address of each computer allowed to boot.',
          'Press Start network boot. On the other computer, turn on network boot (PXE) in its BIOS or boot menu.',
          'Choose from the boot menu. Press Stop when finished.'
        ] },
        { list: [
          'It is off until you press Start. It only answers computers on your list, and never hands out addresses. Your router stays in charge.',
          'Each listed computer can have its own default: menu, an ISO, netboot.xyz or its own disk.',
          'Check my setup explains problems in plain words. The log shows downloads, stalls and what each computer asked for.',
          'Unattended installs (advanced) fill in the installer\'s answers for Ubuntu Server and Rocky/Alma/Fedora style discs. They erase the first disk, ask you to confirm, and run only once.',
          'Windows installs (experimental) start Windows Setup and connect to a shared folder on a Windows PC.',
          'Large Ubuntu ISOs are copied into the booting computer\'s memory, so it needs roughly the ISO size plus 3 GB of RAM.',
          'UEFI computers can use either of two boot loaders (setting in the window). Secure Boot usually has to be off.'
        ] },
        { tip: 'The window has a testing guide for VirtualBox and similar virtual machines.' }
      ]
    },
    {
      id: 'security', title: 'Security settings',
      words: 'security privacy certificate camera microphone clipboard popup snmp strict standard permissions firewall',
      body: [
        'Open Settings, then Security settings... to decide what panels may do and what Dashboard Hub may do on your network.',
        { list: [
          'Panels: allow self-signed certificates, pop-up windows, the camera, microphone, notifications and clipboard.',
          'Network: switch off the thorough scan, router connections or Cisco Meraki, and require SNMP version 3.',
          'Finding machines: switches for ping and port checks, mDNS/Bonjour, SSDP/UPnP, NetBIOS names and DNS lookups, plus a master switch for SNMP. "Quiet scan, no SNMP" sends nothing and only listens.',
          'Standard and Strictest set everything at once.',
          'Protections that must never be off (page isolation, update-file checks and local-network-only scanning) are fixed on purpose.'
        ] }
      ]
    },
    {
      id: 'backup', title: 'Backup and restore',
      words: 'backup export import restore save file move computer',
      body: [
        'Open Settings, then Backup... to export or import your panels, servers, notes, profiles and network maps in a single file.',
        { list: [
          'Passwords and router or server logins are never included. You will need to enter them again on a new computer.',
          'Backups are checked and cleaned when imported.',
          'Use it to move to a new computer or to keep a safe copy before big changes.'
        ] }
      ]
    },
    {
      id: 'updates', title: 'Updates and going back',
      words: 'update upgrade hubupdate version install revert earlier rollback github check',
      body: [
        { steps: [
          'Click Updates in the top bar.',
          'Pick the .hubupdate file you were given, or check online if you turned that on.',
          'Click Install and then restart when asked.'
        ] },
        { list: [
          'Update checks are off until you say yes. Turn them on in Settings ("Check for new versions automatically"). Nothing is installed without your click.',
          'Dashboard Hub keeps checked copies of earlier versions. The Updates window lists them, with a button to return to any one. You choose how many to keep (1 to 10).',
          'There is also a way back to the built-in version.',
          'Every file in an update is verified with a checksum, and a small fixed starter program can always start the app, so a bad update cannot lock you out.',
          'Update file tools (Settings) unpack a .hubupdate into its source files or pack a folder back into one.'
        ] }
      ]
    },
    {
      id: 'background', title: 'Running in the background',
      words: 'tray background minimize close gpu graphics blink software drawing',
      body: [
        { list: [
          'Settings has "Keep running in the background when I close the window (X)". Dashboard Hub then hides in the system tray, and alerts and live scans carry on. Click the tray icon to bring it back. Use the tray menu to quit.',
          'Graphics card (GPU): untick this only if the app looks broken or flickers, then restart. If the graphics process crashes 3 times in 10 minutes, Dashboard Hub switches to software drawing by itself and says why.',
          'Gently blink the network lines can be turned off for steady green lines.',
          'In Windows Task Manager, Dashboard Hub always shows a few "Dashboard Hub.exe" lines (the main program, the graphics process, a network helper and the window itself). Each panel that is running adds one more. Sleeping panels give theirs back.'
        ] }
      ]
    },
    {
      id: 'install', title: 'Installing, uninstalling and building',
      words: 'install uninstall remove setup build exe appimage node.js folder delete portable apps features',
      body: [
        'If you only have the source files, double-click BUILD-APP.bat (Windows) or run ./BUILD-APP.sh (Linux). It checks for Node.js and offers to download it if it is missing, then makes a folder called "Dashboard Hub" right next to the build file.',
        { list: [
          'Windows: "Dashboard-Hub-Setup.exe" installs Dashboard Hub for your user account (no administrator needed) with a Start menu entry and a desktop shortcut. "Run without installing" is the same program in a folder you can start straight away.',
          'Linux: "Dashboard-Hub.AppImage". Make it runnable once, then double-click it.',
          'To uninstall on Windows: Settings > Apps > Installed apps > Dashboard Hub > Uninstall.',
          'At the end of an uninstall, Windows asks "Do you also want to delete your Dashboard Hub data?" Choose Yes to remove your panels, notes, profiles, servers and settings, or No (the default) to keep them for a reinstall. If you chose No and change your mind, delete the folder %AppData%\\dashboard-hub (Linux: ~/.config/dashboard-hub).',
          'The "Run without installing" folder and the AppImage have no uninstaller: just delete them.'
        ] }
      ]
    },
    {
      id: 'trouble', title: 'Troubleshooting',
      words: 'problem error fix not working help stuck blank black cannot slow permission fuse appimage',
      body: [
        { list: [
          'The map is blank: click Scan network. If it still looks empty, use Reset view or Top view.',
          'A machine has the wrong type: open it and set the type yourself.',
          'A router or switch shows "not reported": that device does not share that information. Try SNMP or its own connection type.',
          'Scan says you are on a different network: Network Guard stopped it. Switch profile or accept the new network when asked.',
          'A panel will not load: check the address, and whether the device uses https. Allow self-signed certificates in Security settings.',
          'Network boot does nothing: run with administrator rights, use a cable, and press Check my setup. Turn Secure Boot off on the other computer.',
          'Linux: "Cannot mount AppImage, please check your FUSE setup" is not a Dashboard Hub fault. Install FUSE 2 with sudo apt install libfuse2t64 (Ubuntu 22.04 and Mint 21: libfuse2), or start the file with --appimage-extract-and-run.',
          'The app looks broken after an update: open Updates and go back to an earlier version.',
          'Still stuck: click Reload in the top bar, or restart the app.'
        ] }
      ]
    },
    {
      id: 'keys', title: 'Tips and shortcuts',
      words: 'shortcut key keyboard ctrl esc f5 tip',
      body: [
        { list: [
          'Ctrl+R or F5: reload Dashboard Hub.',
          'Ctrl+F inside a panel: search that page.',
          'Esc: leave a full-screen panel.',
          'Ctrl+drag on the map: move one machine without its group.',
          'Hover over a machine on the map for a quick summary.',
          'Hover over almost any button for a short explanation.'
        ] }
      ]
    }
  ];
  window.HUB_MANUAL = M;
})();
