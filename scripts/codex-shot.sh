#!/bin/zsh
# Screenshots of the Codex preview at desktop and phone width.
# Usage: scripts/codex-shot.sh <name> [query]   e.g. scripts/codex-shot.sh wiki 'list=wiki&theme=light'
# Starts Vite on port 5188 if it is not running; stop it with: pkill -f 'vite --port 5188'
set -e
cd "${0:A:h}/.."
PORT=5188
OUT=${CODEX_SHOTS:-/tmp/codex-shots}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"
if ! curl -s -o /dev/null "http://localhost:$PORT/preview.html"; then
  (cd web && AV_PORT=1 nohup npx vite --port $PORT --strictPort >/tmp/codex-vite.log 2>&1 &)
  for i in {1..40}; do curl -s -o /dev/null "http://localhost:$PORT/preview.html" && break; sleep 0.5; done
fi
URL="http://localhost:$PORT/preview.html?$2"
shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir=/tmp/codex-chrome --window-size=$1 \
    --virtual-time-budget=4000 --screenshot="$2" "$3" 2>/dev/null
}
shot 1280,860 "$OUT/$1-1280.png" "$URL"
shot 390,844 "$OUT/$1-390.png" "$URL&w=390"
echo "$OUT/$1-1280.png $OUT/$1-390.png"
