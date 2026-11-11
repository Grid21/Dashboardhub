#!/usr/bin/env bash
# Dashboard Hub - .hubupdate Decompiler Script (Linux / macOS)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================="
echo "  Dashboard Hub .hubupdate Decompiler"
echo "============================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js was not found in your PATH."
  echo "Please install Node.js (LTS version) from https://nodejs.org"
  exit 1
fi

TARGET_FILE="$1"

if [ -z "$TARGET_FILE" ]; then
  echo "Usage: ./UNPACK-UPDATE.sh <file.hubupdate>"
  read -r -p "Enter path to .hubupdate file: " TARGET_FILE
fi

if [ -z "$TARGET_FILE" ]; then
  echo "No file provided. Exiting."
  exit 0
fi

node "$DIR/tools/unpack-update.js" "$TARGET_FILE" "${@:2}"
