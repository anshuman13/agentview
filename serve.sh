#!/bin/sh
# Installs dependencies when the lockfile changes and builds the web app, when it changed, into a fresh folder, swapping it in only when the build succeeds. Then runs the server.
# A failed build keeps the last good one, and the server reports it.
cd "$(dirname "$0")"
FAILED="$HOME/.agentview/web-build-failed"
if [ bun.lock -nt node_modules/.installed ]; then
  bun install && touch node_modules/.installed
fi
# The build is skipped when nothing under web/ or shared/ (files, or folders, for a deleted file) is newer than the last good one.
STAMP=web/dist/.built
if [ ! -f "$STAMP" ] || [ -f "$FAILED" ] || [ -n "$(find web shared bun.lock -newer "$STAMP" -not -path 'web/dist*' -not -path '*/node_modules*' 2>/dev/null | head -1)" ]; then
  rm -rf web/dist-next
  if (cd web && bun --bun vite build --outDir dist-next --emptyOutDir --logLevel warn); then
    rm -rf web/dist-old
    [ -d web/dist ] && mv web/dist web/dist-old
    mv web/dist-next web/dist
    rm -rf web/dist-old "$FAILED"
    # Last, after the moves that touch web/ itself.
    touch "$STAMP"
  else
    rm -rf web/dist-next
    mkdir -p "$(dirname "$FAILED")" && touch "$FAILED"
  fi
fi
cd server && exec bun src/index.ts
