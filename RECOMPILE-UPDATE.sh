#!/usr/bin/env bash
# Dashboard Hub - Recompile .hubupdate Package (Linux / macOS)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# works whether this script sits next to the tools folder or inside it
if [ -f "$DIR/tools/make-update.js" ]; then TOOLS="$DIR/tools"; else TOOLS="$DIR"; fi

echo "============================================================="
echo "  Dashboard Hub .hubupdate Compiler (Drag & Drop / CLI)"
echo "============================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js was not found in your PATH."
  echo "Please install Node.js (LTS version) from https://nodejs.org"
  exit 1
fi

SRC_FOLDER="$1"
if [ -z "$SRC_FOLDER" ]; then
  SRC_FOLDER="$DIR"
  echo "Compiling from current project folder: $SRC_FOLDER"
else
  echo "Compiling from: $SRC_FOLDER"
fi

echo
read -r -p "Enter version number (e.g. 1.10.3, or press Enter to read from source): " VER_INPUT
read -r -p "Enter release notes for this update (optional): " NOTES_INPUT

CMD=(node "$TOOLS/make-update.js" --src "$SRC_FOLDER")

if [ -n "$VER_INPUT" ]; then
  CMD+=(--version "$VER_INPUT")
fi

if [ -n "$NOTES_INPUT" ]; then
  CMD+=(--notes "$NOTES_INPUT")
fi

echo
"${CMD[@]}"
