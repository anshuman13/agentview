#!/bin/sh
set -e
cd "$(dirname "$0")"

APP=dist/AgentView.app
BIN=$APP/Contents/MacOS/AgentView
LABEL=no.pradhan.agentview.bar
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
JOB="gui/$(id -u)/$LABEL"
BUILT=
if [ ! -x "$BIN" ] || [ menubar/AgentViewBar.swift -nt "$BIN" ] || [ start.sh -nt "$BIN" ]; then
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>no.pradhan.agentview.bar</string>
  <key>CFBundleName</key><string>AgentView</string>
  <key>CFBundleExecutable</key><string>AgentView</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
  mkdir -p "$APP/Contents/Resources"
  cp app/src-tauri/icons/icon.icns "$APP/Contents/Resources/"
  swiftc -O menubar/AgentViewBar.swift -o "$BIN"
  codesign --force --sign - --identifier $LABEL "$APP"
  BUILT=1
fi

pkill -x agentview-bar 2>/dev/null || true
# launchd starts AgentView at login and again whenever it crashes or is killed. Quit in the menu stops it until the next login or ./start.sh.
if ! launchctl print "$JOB" >/dev/null 2>&1; then
  pkill -f "$PWD/$BIN" && sleep 2
  mkdir -p "$(dirname "$AGENT")"
  cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>Program</key><string>$PWD/$BIN</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
elif [ -n "$BUILT" ]; then
  launchctl kickstart -k "$JOB"
elif pgrep -f "$PWD/$BIN" >/dev/null; then
  echo "AgentView is running. Use the menu bar icon to restart the server."
  exit 0
else
  launchctl kickstart "$JOB"
fi
echo "AgentView is starting on http://localhost:7777 (logs in ~/.agentview/logs)"
