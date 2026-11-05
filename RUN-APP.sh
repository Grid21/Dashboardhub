#!/usr/bin/env bash
# Dashboard Hub - run from source (Linux)
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

echo "============================================================="
echo "  Dashboard Hub - run from source"
echo "============================================================="
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed on this computer."
  echo
  echo "Install the LTS version from https://nodejs.org (or with your"
  echo "package manager, for example: sudo apt install nodejs npm),"
  echo "then run ./RUN-APP.sh again."
  exit 1
fi

if [ ! -d node_modules/electron ]; then
  echo "First run: downloading what Dashboard Hub needs. This takes a few"
  echo "minutes and needs an internet connection. It only happens once."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "The download did not finish. Check your internet connection and run ./RUN-APP.sh again."
    exit 1
  fi
fi

echo "Starting Dashboard Hub..."
if ! npm start; then
  echo
  echo "Dashboard Hub stopped with an error. The message above says why."
  echo
  echo "On some Linux systems (for example recent Ubuntu) the app's safety"
  echo "sandbox is blocked by the system, which gives an error mentioning"
  echo "'sandbox'. You can run it without that sandbox. This is less safe,"
  echo "so only do it if you trust the code you are running."
  read -r -p "Run it without the sandbox? (y/N) " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    npx electron . --no-sandbox
  fi
fi
