#!/bin/sh
# Installs dependencies when the lockfile changes and builds the web app into a fresh folder, swapping it in only when the build succeeds. Then runs the server.
# A failed build keeps the last good one, and the server reports it.
cd "$(dirname "$0")"
FAILED="$HOME/.agentview/web-build-failed"
if [ package-lock.json -nt node_modules/.installed ]; then
  npm install --no-save --no-audit --no-fund && touch node_modules/.installed
fi
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
