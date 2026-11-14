#!/usr/bin/env bash
# Dashboard Hub - build the Linux program (Dashboard-Hub.AppImage)
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

echo "============================================================="
echo "  Dashboard Hub - build the Linux program (AppImage)"
echo "============================================================="
echo

DIR="$(pwd)"
ENSURE="$DIR/ENSURE-NODE.sh"; [ -f "$ENSURE" ] || ENSURE="$DIR/../ENSURE-NODE.sh"
if [ -f "$ENSURE" ]; then
  # shellcheck disable=SC1090
  source "$ENSURE"
  ensure_node || exit 1
elif ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js was not found in your PATH."
  echo "Please install Node.js (LTS version, 22 or newer) from https://nodejs.org"
  exit 1
fi

echo "Step 1 of 2: getting the building tools (a few minutes the first time,"
echo "internet connection needed)."
echo
if ! npm install --no-audit --no-fund; then
  echo
  echo "The download did not finish. Check your internet connection and run ./BUILD-APP.sh again."
  exit 1
fi

echo
echo "Step 2 of 2: building Dashboard-Hub.AppImage (this can take a few minutes)."
echo
if ! npm run dist:linux; then
  echo
  echo "The build did not finish. The message above says why."
  exit 1
fi

echo
echo "============================================================="
echo "  Done! Your program is in the \"Dashboard Hub\" folder, next to"
echo "  this file:"
echo "  Dashboard Hub/Dashboard-Hub.AppImage"
echo "  (make it runnable once with: chmod +x \"Dashboard Hub/Dashboard-Hub.AppImage\")"
echo "  If it says \"Cannot mount AppImage ... FUSE\", run once:"
echo "    sudo apt install libfuse2t64   (Mint 22 / Ubuntu 24.04)"
echo "    sudo apt install libfuse2      (Mint 21 / Ubuntu 22.04)"
echo "============================================================="
