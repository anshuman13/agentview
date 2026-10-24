#!/bin/sh
# Installs dist/AgentView.apk on the phone over USB or wireless debugging.
# macOS can block adb from the local network, so a phone found on Wi-Fi is reached through Apple's nc on a local port.
cd "$(dirname "$0")/.."
A="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
D=$($A devices | awk 'NR>1 && $2=="device" {print $1; exit}')
if [ -z "$D" ]; then
  browse() { dns-sd "$@" & p=$!; sleep 3; kill $p; }
  NAME=$(browse -B _adb-tls-connect._tcp local. 2>/dev/null | awk '/ Add / {print $NF; exit}')
  [ -n "$NAME" ] || { echo "No phone found. Turn on Wireless debugging on it."; exit 1; }
  AT=$(browse -L "$NAME" _adb-tls-connect._tcp local. 2>/dev/null | awk '/can be reached at/ {print $(NF-2); exit}')
  HOST=${AT%:*}
  IP=$(dscacheutil -q host -a name "${HOST%.}" | awk '/ip_address/ {print $2; exit}')
  FIFO=$(mktemp -u)
  mkfifo "$FIFO"
  nc -l 127.0.0.1 5599 < "$FIFO" | nc "$IP" "${AT##*:}" > "$FIFO" &
  trap '$A disconnect 127.0.0.1:5599 >/dev/null; pkill -f "nc -l 127.0.0.1 5599"; rm -f "$FIFO"' EXIT
  sleep 1
  $A connect 127.0.0.1:5599
  D=127.0.0.1:5599
fi
$A -s "$D" install -r dist/AgentView.apk
