#!/usr/bin/env bash
# Dashboard Hub - makes sure Node.js is available (Linux / macOS).
#
# The other scripts load this file with:   source ENSURE-NODE.sh && ensure_node || exit 1
#
#  - Node.js already installed (version 22 or newer)  -> nothing is downloaded, it just carries on.
#  - Not installed, or too old                         -> offers to download the official Node.js LTS
#    from nodejs.org, checks its checksum and unpacks it into your own home folder
#    (no administrator password needed, nothing else on your computer is changed).
#
# Settings used by the tests (normally never touched):
#   NODE_DIST_URL   where to download from (default https://nodejs.org/dist)
#   NODE_MIN_MAJOR  oldest Node.js major version that is accepted (default 22, Electron needs 22.12 or newer)
#   HUB_NODE_DIR    where a downloaded copy is kept (default ~/.local/share/dashboard-hub-node)
#   HUB_NODE_YES    set to 1 to skip the "Install now?" question

NODE_DIST_URL="${NODE_DIST_URL:-https://nodejs.org/dist}"
NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-22}"
HUB_NODE_DIR="${HUB_NODE_DIR:-$HOME/.local/share/dashboard-hub-node}"

_hub_have() { command -v "$1" >/dev/null 2>&1; }

# 0 when node and npm both run and node is new enough
_hub_node_ok() {
  _hub_have node && _hub_have npm || return 1
  local v major
  v="$(node --version 2>/dev/null)" || return 1
  v="${v#v}"; major="${v%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge "$NODE_MIN_MAJOR" ]
}

_hub_fetch() {   # _hub_fetch URL OUTPUT-FILE
  if _hub_have curl; then curl -fsSL --retry 2 -o "$2" "$1"
  elif _hub_have wget; then wget -q -O "$2" "$1"
  else return 127; fi
}

_hub_sha256() {  # prints the SHA-256 of a file
  if _hub_have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif _hub_have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else return 127; fi
}

ensure_node() {
  # a copy this script downloaded earlier is not on your normal PATH, so look there first
  if [ -x "$HUB_NODE_DIR/bin/node" ]; then PATH="$HUB_NODE_DIR/bin:$PATH"; export PATH; fi

  if _hub_node_ok; then
    echo "Node.js $(node --version) is already installed - skipping the Node.js install."
    echo
    return 0
  fi

  if _hub_have node; then
    echo "Node.js $(node --version 2>/dev/null) is installed, but Dashboard Hub needs version $NODE_MIN_MAJOR or newer."
  else
    echo "Node.js is not installed on this computer."
  fi
  echo
  echo "Dashboard Hub can download the official Node.js (LTS) from nodejs.org for you."
  echo "It is put in your own folder ($HUB_NODE_DIR),"
  echo "needs no administrator password, and changes nothing else on your computer."
  echo
  if [ "${HUB_NODE_YES:-}" != "1" ] && [ -t 0 ]; then
    read -r -p "Download Node.js now? [Y/n] " ans
    case "$ans" in n|N|no|NO) echo; echo "Okay. Install Node.js $NODE_MIN_MAJOR or newer from https://nodejs.org and run this again."; return 1 ;; esac
  fi

  # which computer is this?
  local os arch plat
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "This kind of computer ($(uname -s)) is not supported by the automatic install. Get Node.js from https://nodejs.org"; return 1 ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; armv7l) arch=armv7l ;; *) echo "This processor ($(uname -m)) is not supported by the automatic install. Get Node.js from https://nodejs.org"; return 1 ;; esac
  plat="$os-$arch"
  if ! _hub_have curl && ! _hub_have wget; then echo "Neither curl nor wget is installed, so nothing can be downloaded. Install one (for example: sudo apt install curl) or get Node.js from https://nodejs.org"; return 1; fi
  if ! _hub_have tar; then echo "The tar program is missing. Install it, or get Node.js from https://nodejs.org"; return 1; fi

  local tmp; tmp="$(mktemp -d 2>/dev/null)" || { echo "Could not make a temporary folder."; return 1; }
  # find the newest LTS version (the list has one version per line, newest first)
  echo "Looking up the current Node.js LTS version..."
  if ! _hub_fetch "$NODE_DIST_URL/index.json" "$tmp/index.json"; then
    echo "Could not reach $NODE_DIST_URL. Check your internet connection and run this again."
    rm -rf "$tmp"; return 1
  fi
  local ver
  ver="$(grep -m1 '"lts":"' "$tmp/index.json" | sed -n 's/.*"version":"\(v[0-9][0-9.]*\)".*/\1/p')" || true
  if [ -z "$ver" ]; then echo "Could not read the Node.js version list. Get Node.js from https://nodejs.org"; rm -rf "$tmp"; return 1; fi

  local file="node-$ver-$plat.tar.gz"
  echo "Downloading Node.js $ver ($plat). This is about 40 MB..."
  if ! _hub_fetch "$NODE_DIST_URL/$ver/$file" "$tmp/$file"; then
    echo "The download failed. Check your internet connection and run this again."
    rm -rf "$tmp"; return 1
  fi

  # make sure the download is exactly what nodejs.org published
  if ! _hub_fetch "$NODE_DIST_URL/$ver/SHASUMS256.txt" "$tmp/SHASUMS256.txt"; then
    echo "Could not download the checksum list, so the file cannot be checked. Nothing was installed."
    rm -rf "$tmp"; return 1
  fi
  local want got
  want="$(grep "  $file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)" || true
  got="$(_hub_sha256 "$tmp/$file")" || { echo "No sha256sum or shasum program, so the download cannot be checked. Nothing was installed."; rm -rf "$tmp"; return 1; }
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "The downloaded file did not pass its safety check, so it was NOT installed."
    rm -rf "$tmp"; return 1
  fi
  echo "Download checked: OK."

  echo "Installing into $HUB_NODE_DIR ..."
  rm -rf "$HUB_NODE_DIR"
  if ! mkdir -p "$HUB_NODE_DIR" || ! tar -xzf "$tmp/$file" -C "$HUB_NODE_DIR" --strip-components=1; then
    echo "Could not unpack Node.js into $HUB_NODE_DIR."
    rm -rf "$tmp" "$HUB_NODE_DIR"; return 1
  fi
  rm -rf "$tmp"

  PATH="$HUB_NODE_DIR/bin:$PATH"; export PATH
  if ! _hub_node_ok; then
    echo "Node.js was unpacked but does not run on this computer. Get it from https://nodejs.org instead."
    return 1
  fi
  echo
  echo "Node.js $(node --version) is installed. Dashboard Hub's scripts will find it by themselves."
  echo "(To use it in your own terminal as well, add this line to the end of ~/.profile:"
  echo "   export PATH=\"$HUB_NODE_DIR/bin:\$PATH\" )"
  echo
  return 0
}
