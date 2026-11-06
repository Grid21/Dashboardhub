#!/usr/bin/env bash
# Dashboard Hub - build the Linux program (Dashboard-Hub.AppImage)
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

echo "============================================================="
echo "  Dashboard Hub - build the Linux program (AppImage)"
echo "============================================================="
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed on this computer."
  echo
  echo "Install the LTS version (24 or newer) from https://nodejs.org (or with your"
  echo "package manager, for example: sudo apt install nodejs npm),"
  echo "then run ./BUILD-APP.sh again."
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
echo "  Done! Your program is in the \"dist\" folder:"
echo "  dist/Dashboard-Hub.AppImage"
echo "  (make it runnable once with: chmod +x dist/Dashboard-Hub.AppImage)"
echo "============================================================="
