#!/usr/bin/env bash
# Removes Dashboard Hub from a Linux computer.
#
#   bash UNINSTALL-Linux.sh                 asks you before each step
#   bash UNINSTALL-Linux.sh --keep-data     removes the program but keeps your panels, notes and map
#   bash UNINSTALL-Linux.sh --yes           no questions: removes the program, KEEPS your data
#   bash UNINSTALL-Linux.sh --yes --delete-data   no questions: removes everything, including your data
#
# Your data = panels, notes, SSH servers, network map, installed updates. It lives in:
#   ~/.config/Dashboard Hub
# Make a backup first if you might want it again (in the app: Backup > Export).

ASSUME_YES=0
DELETE_DATA_FLAG=0
KEEP_DATA=0
for a in "$@"; do
  case "$a" in
    --yes) ASSUME_YES=1 ;;
    --delete-data) DELETE_DATA_FLAG=1 ;;
    --keep-data) KEEP_DATA=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"

if [ -z "$HOME" ] || [ "$HOME" = "/" ]; then echo "Cannot tell which home folder to use. Nothing was removed."; exit 1; fi

ask() {   # ask "question"  -> returns 0 for yes
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  local reply
  read -r -p "$1 [y/N] " reply
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

echo "Dashboard Hub uninstaller"
echo "-------------------------"

# 1. close the app if it is running (never this script itself, even if its folder is called dashboard-hub)
running_pids() {
  { pgrep -x "dashboard-hub" 2>/dev/null; pgrep -f "Dashboard-Hub[^ ]*\.AppImage" 2>/dev/null; } | sort -u | grep -v -x -e "$$" -e "$PPID"
}
if [ -n "$(running_pids)" ]; then
  echo "Dashboard Hub looks like it is still running."
  if ask "Close it now?"; then
    running_pids | xargs -r kill 2>/dev/null
    sleep 2
  else
    echo "Please close Dashboard Hub and run this again. Nothing was removed."
    exit 1
  fi
fi

removed=0
remove_path() {   # remove_path "path"   (only ever called with exact paths below)
  if [ -n "$1" ] && [ -e "$1" ] && [ "$1" != "/" ] && [ "$1" != "$HOME" ]; then
    rm -rf -- "$1" && { echo "  removed: $1"; removed=$((removed + 1)); }
  fi
}

# 2. the program file(s): the AppImage
echo
echo "Looking for the program..."
apps=()
for f in "$HERE"/Dashboard-Hub*.AppImage "$HERE"/dist/Dashboard-Hub*.AppImage "$HOME"/Applications/Dashboard-Hub*.AppImage "$HOME"/Downloads/Dashboard-Hub*.AppImage "$HOME"/Dashboard-Hub*.AppImage; do
  [ -f "$f" ] && apps+=("$f")
done
if [ ${#apps[@]} -eq 0 ]; then
  echo "  No Dashboard-Hub AppImage was found in the usual places."
  echo "  If you keep it somewhere else, delete that file yourself."
else
  for f in "${apps[@]}"; do
    if ask "Delete the program file $f ?"; then remove_path "$f"; fi
  done
fi

# 3. menu entries and icons that tools like AppImageLauncher may have made
for f in "$DATA_HOME"/applications/*ashboard*ub*.desktop "$DATA_HOME"/applications/appimagekit-dashboard*.desktop; do
  [ -f "$f" ] && remove_path "$f"
done
for f in "$DATA_HOME"/icons/hicolor/*/apps/*ashboard*ub*.png "$DATA_HOME"/icons/hicolor/*/apps/dashboard-hub*.png; do
  [ -f "$f" ] && remove_path "$f"
done

# 4. your data
echo
DATA_DIRS=("$CONFIG_HOME/Dashboard Hub" "$CONFIG_HOME/dashboard-hub")
found_data=0
for d in "${DATA_DIRS[@]}"; do [ -d "$d" ] && found_data=1; done
if [ "$found_data" = "1" ]; then
  if [ "$KEEP_DATA" = "1" ]; then
    echo "Keeping your data (panels, notes, SSH servers, map) in: $CONFIG_HOME/Dashboard Hub"
  elif [ "$ASSUME_YES" = "1" ] && [ "$DELETE_DATA_FLAG" != "1" ]; then
    echo "Keeping your data (add --delete-data to remove it too)."
  else
    echo "Your data (panels, encrypted notes, SSH servers, network map, installed updates) is stored in:"
    for d in "${DATA_DIRS[@]}"; do [ -d "$d" ] && echo "  $d"; done
    echo "Removing it cannot be undone. In the app, Backup > Export makes a copy you can import later."
    do_delete=0
    if [ "$ASSUME_YES" = "1" ]; then do_delete=1
    else
      read -r -p "Type DELETE (capital letters) to remove your data, or just press Enter to keep it: " reply
      [ "$reply" = "DELETE" ] && do_delete=1
    fi
    if [ "$do_delete" = "1" ]; then
      for d in "${DATA_DIRS[@]}"; do remove_path "$d"; done
    else
      echo "Keeping your data."
    fi
  fi
else
  echo "No saved data was found."
fi

echo
echo "Done. $removed item(s) removed."
