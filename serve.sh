#!/bin/sh
# Builds the web app into a fresh folder and swaps it in only when the build succeeds, then runs the server.
# A failed build keeps the last good one, and the server reports it.
cd "$(dirname "$0")"
FAILED="$HOME/.agentview/web-build-failed"
rm -rf web/dist-next
if npx -w web vite build --outDir dist-next --emptyOutDir --logLevel warn; then
  rm -rf web/dist-old
  [ -d web/dist ] && mv web/dist web/dist-old
  mv web/dist-next web/dist
  rm -rf web/dist-old "$FAILED"
else
  rm -rf web/dist-next
  mkdir -p "$(dirname "$FAILED")" && touch "$FAILED"
fi
cd server && exec bun src/index.ts
