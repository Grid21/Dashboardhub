# Dashboard Hub for Docker

A small always-on version of Dashboard Hub with no window. It scans your network on a timer, remembers every device and when it was on or off, and serves the same **view-only page** as "Phone and browser access" (panels, network map, devices, Uptime and history). **Dashboard Hub Desktop** can connect to it and manage it (Settings > Remote servers).

It is free, like the rest of Dashboard Hub (GPL-3.0-or-later).

## What you need
- A **Linux** computer, NAS or Raspberry Pi with **Docker** and **Docker Compose** (the `docker compose` command).
- It must be on the same network as the devices you want to watch.
- Windows and Mac Docker Desktop cannot see your home network devices properly (no host networking), so use a Linux machine.

## Start it
1. Copy the whole Dashboard Hub source folder (the one that contains the `docker` folder) to the Linux machine.
2. Open `docker/docker-compose.yml` in a text editor and **change `DASHBOARD_HUB_CODE`** to an access code of your own (6 or more characters). You can also set the name, your panels and the scan interval there.
3. In a terminal:
   ```
   cd docker
   docker compose up -d --build
   ```
4. Open `http://<address of that machine>:8787/` in a browser and sign in with your access code.
   To see what it is doing: `docker compose logs -f`.

## Connect Dashboard Hub Desktop
In Dashboard Hub Desktop: **Settings > Remote servers... > Add a server**, type a name, the address (for example `http://192.168.1.50:8787`) and the access code. Then you can **Check** it, tell it to **Scan now**, and **Open** its map, devices and uptime in a window. Use your home network or your VPN (for example WireGuard).

## Settings
The settings in `docker-compose.yml` are the **starting** settings: the server uses them the first time it runs. After that, change them in **Dashboard Hub Desktop (Settings > Remote servers > Settings)**: name, network, router, scan time and panels. They are kept in the data volume and win over the compose file from then on. (The access code is the exception: `DASHBOARD_HUB_CODE` always applies when it is set.)

| Starting setting | Meaning |
|---|---|
| `DASHBOARD_HUB_CODE` | Access code (6 or more characters). If you leave it out, a random one is made and shown once in the log. |
| `DASHBOARD_HUB_NAME` | Name shown in Dashboard Hub Desktop and on the page. |
| `DASHBOARD_HUB_NETWORK` | `auto` (default) or a network such as `192.168.1.0/24`. |
| `DASHBOARD_HUB_ROUTER` | `auto` (default) or your router's address, such as `192.168.0.1`. |
| `DASHBOARD_HUB_SCAN_SECONDS` | Time between scans, 60 or more (default 300). |
| `DASHBOARD_HUB_PORT` | Port of the page (default 8787). |
| `DASHBOARD_HUB_PANELS` | Your panels as `Name=address`, separated by `|`. |

Your data (the device list, the history, the access code hash) is kept in the `dashboard-hub-data` Docker volume, so it survives updates and restarts.

## Safety
- The page is plain HTTP and **not encrypted by itself**. Use it on your home network or through your VPN (such as WireGuard). **Never open its port to the internet.**
- Five wrong codes pause sign-in for 10 minutes. The browser page is view only. Only Dashboard Hub Desktop (signed in with your access code) can ask for a scan or change the settings.
- The container drops all extra permissions except the one `ping` needs, and runs with a read-only file system.

## Update
If you built it from a Git repository in **Portainer** (Stacks > Add stack > Repository, compose path `docker/docker-compose.yml`, with "GitOps updates" turned on), Portainer rebuilds it by itself when you push a new version. Put your access code in Portainer's Environment variables, not in a file in the repository.

Otherwise, copy the newer source folder over the old one and run `docker compose up -d --build` again in the `docker` folder. Your data stays.

## What it cannot do yet
- Editing device names and groups, and editing from the browser page (Desktop can edit the name, network, router, scan time and panels). Planned next.
- Updating the server from Dashboard Hub Desktop (for now: rebuild it, see Update).
- Alerts and notifications, SSH, 3D map.
- The Windows desktop program and the Docker version keep separate histories.
- It was tested on a simulated network, not yet in a real container on a real home network. If something does not work, send me `docker compose logs`.
