#!/usr/bin/env bash
# Dashboard Hub - uninstall (Linux / macOS)
#
# Asks before removing each part, and shows exactly what it found. It only touches Dashboard Hub's own files:
#   - the "Dashboard Hub" folder the build scripts made (next to this file)
#   - the libraries downloaded on first run (the node_modules folder next to this file)
#   - the copy of Node.js that Dashboard Hub's scripts downloaded for themselves (never a Node.js you installed yourself)
#   - menu / launcher entries made for the AppImage
#   - YOUR DATA (panels, notes, network profiles, saved servers, settings). This one is always asked separately and the
#     answer is "no" unless you type y, so a reinstall keeps everything.
# It never deletes this source folder itself. When it is finished it tells you where it is so you can delete it by hand.
#
# For scripts and tests only:  HUB_UNINSTALL_YES=1 answers "yes" to the program parts (never to your data);
#                              HUB_UNINSTALL_DATA=1 also answers "yes" to your data.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
HOME_DIR="${HOME:-}"
case "$(uname -s)" in
  Darwin) DATA_DIR="$HOME_DIR/Library/Application Support/dashboard-hub" ;;
  *)      DATA_DIR="${XDG_CONFIG_HOME:-$HOME_DIR/.config}/dashboard-hub" ;;
esac
NODE_DIR="${HUB_NODE_DIR:-$HOME_DIR/.local/share/dashboard-hub-node}"
APPS_DIR="${XDG_DATA_HOME:-$HOME_DIR/.local/share}"

echo "============================================================="
echo "  Dashboard Hub - uninstall"
echo "============================================================="
echo

if [ -z "$HOME_DIR" ] || [ ! -d "$HOME_DIR" ]; then
  echo "Your home folder could not be found, so nothing was changed."
  exit 1
fi

# refuses anything that is empty, the top of the disk, or the home folder itself
safe_rm() {
  local p="$1"
  case "$p" in ""|"/"|"$HOME_DIR"|"$HOME_DIR/") echo "  (refused to remove \"$p\")"; return 1 ;; esac
  rm -rf -- "$p"
}

ask() {   # ask "question" default(y/n) -> 0 for yes
  local q="$1" def="$2" ans
  if [ "${HUB_UNINSTALL_YES:-}" = "1" ] && [ "$def" = "y" ]; then return 0; fi
  if [ "${HUB_UNINSTALL_DATA:-}" = "1" ] && [ "$def" = "n" ]; then return 0; fi
  if [ ! -t 0 ] && [ -z "${HUB_UNINSTALL_ANSWERS:-}" ]; then return 1; fi
  if [ "$def" = "y" ]; then read -r -p "$q [Y/n] " ans; case "$ans" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
  else read -r -p "$q [y/N] " ans; case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac; fi
}

size_of() { du -sh "$1" 2>/dev/null | cut -f1; }

# 1. a running Dashboard Hub would keep files in use
if pgrep -x dashboard-hub >/dev/null 2>&1 || pgrep -f "Dashboard-Hub\.AppImage" >/dev/null 2>&1; then
  echo "Dashboard Hub is running. Please close it first (then run this again)."
  echo "If it is not visible, look for it in the system tray."
  if ! ask "Close it for you now?" n; then exit 1; fi
  pkill -f "Dashboard-Hub.AppImage" 2>/dev/null; pkill -x dashboard-hub 2>/dev/null; sleep 2
fi

removed=0; kept=0
item() {   # item "what it is" "path" "default"
  local what="$1" p="$2" def="${3:-y}"
  [ -e "$p" ] || return 0
  echo "$what"
  echo "    $p  ($(size_of "$p"))"
  if ask "    Remove it?" "$def"; then safe_rm "$p" && { echo "    removed."; removed=$((removed + 1)); }; else echo "    kept."; kept=$((kept + 1)); fi
  echo
}

item "The finished program (made by BUILD-APP):" "$DIR/Dashboard Hub" y
item "The libraries Dashboard Hub downloaded on its first run:" "$DIR/node_modules" y
item "The copy of Node.js that Dashboard Hub's scripts downloaded for themselves (a Node.js you installed yourself is never touched):" "$NODE_DIR" y

shopt -s nullglob
launchers=("$APPS_DIR"/applications/dashboard-hub*.desktop "$APPS_DIR"/applications/appimagekit-dashboard-hub*.desktop "$APPS_DIR"/icons/hicolor/*/apps/dashboard-hub* "$APPS_DIR"/icons/hicolor/*/apps/appimagekit-dashboard-hub*)
if [ ${#launchers[@]} -gt 0 ]; then
  echo "Menu / launcher entries for Dashboard Hub:"
  for f in "${launchers[@]}"; do echo "    $f"; done
  if ask "    Remove them?" y; then for f in "${launchers[@]}"; do safe_rm "$f"; done; echo "    removed."; removed=$((removed + 1)); else echo "    kept."; kept=$((kept + 1)); fi
  echo
fi

if [ -e "$DATA_DIR" ]; then
  echo "YOUR DATA: panels, notes, network profiles, saved servers and settings."
  echo "    $DATA_DIR  ($(size_of "$DATA_DIR"))"
  echo "    Keep this if you might install Dashboard Hub again. Removing it cannot be undone."
  if ask "    Delete your data too?" n; then safe_rm "$DATA_DIR" && { echo "    removed."; removed=$((removed + 1)); }; else echo "    kept."; kept=$((kept + 1)); fi
  echo
fi

echo "============================================================="
echo "  Finished: $removed removed, $kept kept."
echo "============================================================="
echo
echo "This source folder was not deleted. If you no longer want it, delete this folder yourself:"
echo "    $DIR"
exit 0
