#!/bin/sh
# Builds dist/AgentView.apk, versioned with the HEAD commit short sha, and prints its path. Run through env.sh.
cd "$(dirname "$0")/.." || exit 1
STEP=start
trap '[ $? -eq 0 ] || echo "build-apk failed at: $STEP" >&2' EXIT
set -e
SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != main ] || [ -n "$(git status --porcelain)" ]; then
  echo "warning: building $SHA from $BRANCH with uncommitted changes or off main" >&2
fi
rm -f dist/AgentView.apk dist/AgentView.apk.txt
cd app
STEP="web build"
npm run build:ui >&2
STEP="build stamp"
date +%s > www/build.txt
STEP="android build"
tauri android build --apk --target aarch64 --config "{\"version\":\"0.1.0+$SHA\"}" >&2
STEP="copy apk"
mkdir -p ../dist
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk ../dist/AgentView.apk
cp www/build.txt ../dist/AgentView.apk.txt
cd ../dist
echo "$PWD/AgentView.apk"
