#!/usr/bin/env bash
# Tests ENSURE-NODE.sh against a local pretend nodejs.org (the real site is not touched).
#   bash test/ensure-node-test.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null; rm -rf "$W"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok    $1"; }
bad() { fail=$((fail+1)); echo "  FAIL  $1   -> $2"; }
chk() { if [ "$2" = "yes" ]; then ok "$1"; else bad "$1" "${3:-}"; fi; }

# --- a pretend nodejs.org with one LTS version (v99.1.0) and one newer non-LTS
D="$W/dist"; V=v99.1.0; PLAT=linux-x64; case "$(uname -m)" in aarch64|arm64) PLAT=linux-arm64;; esac
mkdir -p "$D/$V" "$W/pkg/node-$V-$PLAT/bin"
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo %s; else echo "fake node $@"; fi\n' "$V" > "$W/pkg/node-$V-$PLAT/bin/node"
printf '#!/bin/sh\necho 10.0.0\n' > "$W/pkg/node-$V-$PLAT/bin/npm"
chmod +x "$W/pkg/node-$V-$PLAT/bin/"*
tar -czf "$D/$V/node-$V-$PLAT.tar.gz" -C "$W/pkg" "node-$V-$PLAT"
( cd "$D/$V" && sha256sum "node-$V-$PLAT.tar.gz" > SHASUMS256.txt )
cat > "$D/index.json" <<EOT
[
{"version":"v100.0.0","date":"2030-01-01","files":["linux-x64"],"npm":"11.0.0","lts":false,"security":false},
{"version":"$V","date":"2029-10-01","files":["linux-x64"],"npm":"10.0.0","lts":"Pretend","security":false},
{"version":"v98.0.0","date":"2029-04-01","files":["linux-x64"],"npm":"10.0.0","lts":false,"security":false}
]
EOT
PORT=$((20000 + RANDOM % 20000))
( cd "$D" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >"$W/server.log" 2>&1 ) & SRV=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/index.json" && break; sleep 0.2; done
hits() { grep -c "GET" "$W/server.log"; }

# a PATH with the basic tools but no node
NONODE="$W/bin"; mkdir -p "$NONODE"
for t in bash sh curl wget tar gzip grep sed cut mktemp rm mkdir uname sha256sum shasum cat dirname head tr sleep env python3 timeout; do p="$(command -v $t 2>/dev/null)" && ln -sf "$p" "$NONODE/$t"; done
run() { env -i HOME="$W/home" PATH="$1" NODE_DIST_URL="http://127.0.0.1:$PORT" HUB_NODE_DIR="$W/home/hubnode" HUB_NODE_YES=1 bash -c "source '$ROOT/ENSURE-NODE.sh'; ensure_node; echo RC=\$?; command -v node; node --version" 2>&1; }
mkdir -p "$W/home"

echo "--- Node.js already installed (real node)"
before=$(hits); out="$(run "$(dirname "$(command -v node)"):$NONODE")"
chk "says Node.js is already installed and skips" "$(echo "$out" | grep -q 'already installed - skipping' && echo yes)" "$out"
chk "downloads nothing" "$([ "$(hits)" = "$before" ] && echo yes)"
chk "returns success" "$(echo "$out" | grep -q 'RC=0' && echo yes)"
chk "nothing is put in the home folder" "$([ ! -d "$W/home/hubnode" ] && echo yes)"

echo "--- Node.js missing: downloads and installs"
out="$(run "$NONODE")"
chk "says Node.js is not installed" "$(echo "$out" | grep -q 'not installed on this computer' && echo yes)" "$out"
chk "picks the LTS version, not the newer non-LTS one" "$(echo "$out" | grep -q 'Downloading Node.js v99.1.0' && echo yes)" "$out"
chk "the checksum is verified" "$(echo "$out" | grep -q 'Download checked: OK' && echo yes)"
chk "returns success" "$(echo "$out" | grep -q 'RC=0' && echo yes)"
chk "node now runs from the home folder" "$(echo "$out" | tail -2 | head -1 | grep -q "$W/home/hubnode/bin/node" && echo yes)" "$(echo "$out" | tail -3)"
chk "and reports the new version" "$(echo "$out" | tail -1 | grep -q 'v99.1.0' && echo yes)"
chk "explains how to use it in a terminal" "$(echo "$out" | grep -q 'export PATH' && echo yes)"

echo "--- second run reuses the saved copy"
before=$(hits); out="$(run "$NONODE")"
chk "skips the install (found the copy it saved)" "$(echo "$out" | grep -q 'already installed - skipping' && echo yes)" "$out"
chk "downloads nothing again" "$([ "$(hits)" = "$before" ] && echo yes)"

echo "--- old Node.js (version 18) gets replaced"
mkdir -p "$W/old"; printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v18.20.0; fi\n' > "$W/old/node"; printf '#!/bin/sh\necho 9\n' > "$W/old/npm"; chmod +x "$W/old/"*
rm -rf "$W/home/hubnode"
out="$(run "$W/old:$NONODE")"
chk "says it is too old" "$(echo "$out" | grep -q 'needs version 22 or newer' && echo yes)" "$out"
chk "installs the new one" "$(echo "$out" | tail -1 | grep -q 'v99.1.0' && echo yes)" "$(echo "$out" | tail -3)"

echo "--- a damaged download is refused"
rm -rf "$W/home/hubnode"; cp "$D/$V/SHASUMS256.txt" "$W/sums.bak"
sed -i 's/^./0/' "$D/$V/SHASUMS256.txt"
out="$(run "$NONODE")"
chk "refuses it with a clear message" "$(echo "$out" | grep -q 'did not pass its safety check' && echo yes)" "$out"
chk "returns failure" "$(echo "$out" | grep -q 'RC=1' && echo yes)"
chk "installs nothing" "$([ ! -d "$W/home/hubnode" ] && echo yes)"
cp "$W/sums.bak" "$D/$V/SHASUMS256.txt"

echo "--- no internet / site unreachable"
out="$(env -i HOME="$W/home" PATH="$NONODE" NODE_DIST_URL="http://127.0.0.1:1" HUB_NODE_DIR="$W/home/hubnode" HUB_NODE_YES=1 bash -c "source '$ROOT/ENSURE-NODE.sh'; ensure_node; echo RC=\$?" 2>&1)"
chk "explains it could not reach the site" "$(echo "$out" | grep -q 'Could not reach' && echo yes)" "$out"
chk "returns failure" "$(echo "$out" | grep -q 'RC=1' && echo yes)"

echo "--- works under set -e (as RECOMPILE-UPDATE.sh and UNPACK-UPDATE.sh use it)"
out="$(env -i HOME="$W/home" PATH="$NONODE" NODE_DIST_URL="http://127.0.0.1:$PORT" HUB_NODE_DIR="$W/home/hubnode" HUB_NODE_YES=1 bash -c "set -e; source '$ROOT/ENSURE-NODE.sh'; ensure_node || exit 1; echo REACHED; node --version" 2>&1)"
chk "carries on after installing" "$(echo "$out" | tail -2 | head -1 | grep -q REACHED && echo yes)" "$out"
sed -i 's/^./0/' "$D/$V/SHASUMS256.txt"; rm -rf "$W/home/hubnode"
out="$(env -i HOME="$W/home" PATH="$NONODE" NODE_DIST_URL="http://127.0.0.1:$PORT" HUB_NODE_DIR="$W/home/hubnode" HUB_NODE_YES=1 bash -c "set -e; source '$ROOT/ENSURE-NODE.sh'; ensure_node || { echo STOPPED; exit 1; }; echo REACHED" 2>&1)"
chk "stops cleanly (not silently) when the download is bad" "$(echo "$out" | grep -q 'STOPPED' && ! echo "$out" | grep -q REACHED && echo yes)" "$out"
cp "$W/sums.bak" "$D/$V/SHASUMS256.txt"

echo "--- the real scripts (run in a throwaway copy with a pretend npm, so nothing real is installed or built)"
P="$W/proj"; mkdir -p "$P/tools" "$W/fake"
cp "$ROOT"/ENSURE-NODE.sh "$ROOT"/RUN-APP.sh "$ROOT"/BUILD-APP.sh "$ROOT"/RECOMPILE-UPDATE.sh "$ROOT"/UNPACK-UPDATE.sh "$P/"
cp "$ROOT"/tools/*.js "$P/tools/"; echo '{"name":"x","version":"1.0.0"}' > "$P/package.json"; mkdir -p "$P/node_modules/electron"
ln -sf "$(command -v node)" "$W/fake/node"; printf '#!/bin/sh\necho "pretend npm $@"\n' > "$W/fake/npm"; chmod +x "$W/fake/npm"
for s in RUN-APP BUILD-APP RECOMPILE-UPDATE UNPACK-UPDATE; do
  out="$(cd "$P" && env -i HOME="$W/home" PATH="$W/fake:$NONODE" bash "$s.sh" </dev/null 2>&1 | head -12)"
  chk "$s.sh: sees the installed Node.js and skips the install" "$(echo "$out" | grep -q 'already installed - skipping' && echo yes)" "$out"
done
rm -rf "$W/home/hubnode"
out="$(cd "$P" && env -i HOME="$W/home" PATH="$NONODE" NODE_DIST_URL="http://127.0.0.1:$PORT" HUB_NODE_DIR="$W/home/hubnode" HUB_NODE_YES=1 bash UNPACK-UPDATE.sh </dev/null 2>&1 | head -20)"
chk "UNPACK-UPDATE.sh: installs Node.js first, then carries on with its own work" "$(echo "$out" | grep -q 'Download checked: OK' && echo "$out" | grep -q 'No file provided\|Usage' && echo yes)" "$out"
rm -rf "$W/home/hubnode"
out="$(cd "$P" && env -i HOME="$W/home" PATH="$NONODE" NODE_DIST_URL="http://127.0.0.1:$PORT" HUB_NODE_DIR="$W/home/hubnode" HUB_NODE_YES=1 bash RUN-APP.sh </dev/null 2>&1 | head -30)"
chk "RUN-APP.sh: installs Node.js, then goes on to start the app" "$(echo "$out" | grep -q 'Download checked: OK' && echo "$out" | grep -q 'Starting Dashboard Hub' && echo yes)" "$out"
mkdir -p "$W/loose"; cp "$ROOT/RUN-APP.sh" "$W/loose/"
out="$(cd "$W/loose" && env -i HOME="$W/home" PATH="$NONODE" bash RUN-APP.sh </dev/null 2>&1 | head -5)"
chk "if ENSURE-NODE.sh is missing, a plain message is shown" "$(echo "$out" | grep -q 'Node.js was not found' && echo yes)" "$out"
bash -n "$ROOT/ENSURE-NODE.sh" && ok "ENSURE-NODE.sh has no syntax errors"

echo; [ $fail -eq 0 ] && echo "All $pass passed" || echo "FAILED $fail (passed $pass)"; exit $fail
