DASHBOARD HUB - DECOMPILER & RECOMPILER TOOLS
=============================================

These tools allow you to decompile, inspect, edit,
and recompile Dashboard Hub .hubupdate packages.

WINDOWS (DRAG & DROP):
----------------------
1. TO DECOMPILE:
   Drag any .hubupdate (or .txt / .json) file and drop it onto UNPACK-UPDATE.bat.
   It creates a folder named decompiled-update-vX.X.X with all the source code!

2. TO RECOMPILE:
   Drag that decompiled folder (or any folder you modified) and drop it onto
   RECOMPILE-UPDATE.bat.
   It prompts for version & notes, and automatically generates:
     - Dashboard-Hub-update-X.X.X.hubupdate (for the app)
     - Dashboard-Hub-update-X.X.X.txt (for easy chat sharing)
   and opens the output folder in Windows Explorer!

LINUX / MAC:
------------
1. chmod +x UNPACK-UPDATE.sh RECOMPILE-UPDATE.sh
2. ./UNPACK-UPDATE.sh path/to/file.hubupdate
3. ./RECOMPILE-UPDATE.sh path/to/decompiled-folder
