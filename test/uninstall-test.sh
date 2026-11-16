#!/usr/bin/env bash
# bash test/uninstall-test.sh   - runs UNINSTALL.sh on throwaway folders (it never touches your real files)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ok    $1"; }
bad() { fail=$((fail+1)); echo "  FAIL  $1${2:+   -> $2}"; }
chk() { if eval "$2"; then ok "$1"; else bad "$1" "$2"; fi; }

mk() {   # builds a pretend computer + pretend project folder
  T="$(mktemp -d)"; export HOME="$T/home"; PROJ="$T/proj dir"
  mkdir -p "$HOME/.config/dashboard-hub" "$HOME/.config/other-app" "$HOME/.local/share/dashboard-hub-node/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps" "$HOME/.local/share/other" "$PROJ/Dashboard Hub" "$PROJ/node_modules/electron"
  echo data > "$HOME/.config/dashboard-hub/settings.json"; echo keep > "$HOME/.config/other-app/x"; echo keep > "$HOME/.local/share/other/y"
  echo node > "$HOME/.local/share/dashboard-hub-node/bin/node"
  echo '[Desktop Entry]' > "$HOME/.local/share/applications/appimagekit-dashboard-hub.desktop"; echo '[Desktop Entry]' > "$HOME/.local/share/applications/other.desktop"
  echo png > "$HOME/.local/share/icons/hicolor/256x256/apps/appimagekit-dashboard-hub.png"
  echo app > "$PROJ/Dashboard Hub/Dashboard-Hub.AppImage"; echo x > "$PROJ/node_modules/electron/a"; echo src > "$PROJ/main.js"; echo "keep" > "$PROJ/notes.txt"
  cp "$ROOT/UNINSTALL.sh" "$PROJ/"
  unset HUB_UNINSTALL_YES HUB_UNINSTALL_DATA HUB_UNINSTALL_ANSWERS HUB_NODE_DIR XDG_CONFIG_HOME XDG_DATA_HOME
}
run() { ( cd "$PROJ" && bash ./UNINSTALL.sh "$@" ) ; }
decoys() { [ -f "$HOME/.config/other-app/x" ] && [ -f "$HOME/.local/share/other/y" ] && [ -f "$HOME/.local/share/applications/other.desktop" ] && [ -f "$PROJ/main.js" ] && [ -f "$PROJ/notes.txt" ] && [ -f "$PROJ/UNINSTALL.sh" ]; }

chk "the file exists, starts with a shebang and is executable" '[ -x "$ROOT/UNINSTALL.sh" ] && head -1 "$ROOT/UNINSTALL.sh" | grep -q "^#!/usr/bin/env bash"'
chk "it has no syntax errors" 'bash -n "$ROOT/UNINSTALL.sh"'

mk; out=$(run </dev/null 2>&1)
chk "with no way to answer, nothing at all is removed" '[ -d "$PROJ/Dashboard Hub" ] && [ -d "$PROJ/node_modules" ] && [ -d "$HOME/.local/share/dashboard-hub-node" ] && [ -d "$HOME/.config/dashboard-hub" ] && decoys'
chk "it lists what it found, with their folders" 'echo "$out" | grep -q "proj dir/Dashboard Hub" && echo "$out" | grep -q "dashboard-hub-node" && echo "$out" | grep -q "YOUR DATA"'

mk; out=$(HUB_UNINSTALL_YES=1 run </dev/null 2>&1)
chk "program parts removed: built folder, libraries, downloaded Node.js, launcher entries" '[ ! -e "$PROJ/Dashboard Hub" ] && [ ! -e "$PROJ/node_modules" ] && [ ! -e "$HOME/.local/share/dashboard-hub-node" ] && [ ! -e "$HOME/.local/share/applications/appimagekit-dashboard-hub.desktop" ] && [ ! -e "$HOME/.local/share/icons/hicolor/256x256/apps/appimagekit-dashboard-hub.png" ]'
chk "YOUR DATA is kept unless you say so" '[ -f "$HOME/.config/dashboard-hub/settings.json" ]'
chk "nothing else was touched (other apps, the source files, this script)" 'decoys'
chk "it tells you the source folder was not deleted" 'echo "$out" | grep -q "was not deleted"'

mk; out=$(HUB_UNINSTALL_YES=1 HUB_UNINSTALL_DATA=1 run </dev/null 2>&1)
chk "with a clear yes to data, the data is removed too" '[ ! -e "$HOME/.config/dashboard-hub" ] && decoys'

mk; out=$(printf 'n\ny\nn\ny\nn\n' | HUB_UNINSTALL_ANSWERS=1 run 2>&1)
chk "typed answers are followed one by one (built folder: n, libraries: y, Node: n, launchers: y, data: n)" '[ -d "$PROJ/Dashboard Hub" ] && [ ! -e "$PROJ/node_modules" ] && [ -d "$HOME/.local/share/dashboard-hub-node" ] && [ ! -e "$HOME/.local/share/applications/appimagekit-dashboard-hub.desktop" ] && [ -d "$HOME/.config/dashboard-hub" ] && decoys' "$out"
chk "it counts what it did (2 removed, 3 kept)" 'echo "$out" | grep -q "Finished: 2 removed, 3 kept"'

mk; out=$(printf '\n\n\n\n\n' | HUB_UNINSTALL_ANSWERS=1 run 2>&1)
chk "pressing Enter on every question removes the program parts but keeps your data" '[ ! -e "$PROJ/Dashboard Hub" ] && [ -d "$HOME/.config/dashboard-hub" ] && decoys'

mk; out=$(printf 'y\ny\ny\ny\ny\n' | HUB_UNINSTALL_ANSWERS=1 XDG_CONFIG_HOME="$HOME/.cfg" run 2>&1)
chk "a custom config folder (XDG_CONFIG_HOME) is respected: the default data folder is left alone" '[ -d "$HOME/.config/dashboard-hub" ]'

mk; out=$(HOME="" run </dev/null 2>&1); code=$?
chk "with no home folder it stops and changes nothing" '[ $code -ne 0 ] && [ -d "$PROJ/Dashboard Hub" ]' "code=$code"

mk; out=$(HUB_NODE_DIR="$HOME" HUB_UNINSTALL_YES=1 run </dev/null 2>&1)
chk "it refuses to remove the home folder even if told to" '[ -d "$HOME/.config/other-app" ] && echo "$out" | grep -q refused'

mk; mkdir -p "$PROJ/with space/x"; out=$(HUB_UNINSTALL_YES=1 run </dev/null 2>&1)
chk "folder names with spaces are handled" '[ -d "$PROJ/with space/x" ] && [ ! -e "$PROJ/Dashboard Hub" ]'

echo "$( [ $fail -eq 0 ] && echo "All $pass passed" || echo "$fail failed" )"; exit $((fail>0))
