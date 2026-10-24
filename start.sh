#!/bin/sh
set -e
cd "$(dirname "$0")"

APP=dist/AgentView.app
BIN=$APP/Contents/MacOS/AgentView
if [ ! -x "$BIN" ] || [ menubar/AgentViewBar.swift -nt "$BIN" ] || [ start.sh -nt "$BIN" ]; then
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>no.pradhan.agentview</string>
  <key>CFBundleName</key><string>AgentView</string>
  <key>CFBundleExecutable</key><string>AgentView</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
  swiftc -O menubar/AgentViewBar.swift -o "$BIN"
  codesign --force --sign - --identifier no.pradhan.agentview "$APP"
fi

pkill -x agentview-bar 2>/dev/null || true
if ps -axo comm= | grep -q 'AgentView.app/Contents/MacOS/AgentView$'; then
  echo "AgentView is running. Use the menu bar icon to restart the server, or quit it and run this again."
else
  open "$APP"
  echo "AgentView is starting on http://localhost:7777 (logs in ~/.agentview/logs)"
fi
