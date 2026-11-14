#!/usr/bin/env bash
# Dashboard Hub - .hubupdate Decompiler Script (Linux / macOS)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# works whether this script sits next to the tools folder or inside it
if [ -f "$DIR/tools/unpack-update.js" ]; then TOOLS="$DIR/tools"; else TOOLS="$DIR"; fi

echo "============================================================="
echo "  Dashboard Hub .hubupdate Decompiler"
echo "============================================================="
echo

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

TARGET_FILE="$1"

if [ -z "$TARGET_FILE" ]; then
  echo "Usage: ./UNPACK-UPDATE.sh <file.hubupdate>"
  read -r -p "Enter path to .hubupdate file: " TARGET_FILE
fi

if [ -z "$TARGET_FILE" ]; then
  echo "No file provided. Exiting."
  exit 0
fi

node "$TOOLS/unpack-update.js" "$TARGET_FILE" "${@:2}"
