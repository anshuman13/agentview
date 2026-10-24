#!/bin/sh
set -e
cd "$(dirname "$0")"

APP=dist/AgentView.app
BIN=$APP/Contents/MacOS/AgentView
LABEL=no.pradhan.agentview.bar
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
JOB="gui/$(id -u)/$LABEL"
INFO='<?xml version="1.0" encoding="UTF-8"?>
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
</plist>'
# A rebuild makes macOS forget Full Disk Access, so it happens only when the app's code or Info.plist changes.
STAMP=$({ cat menubar/AgentViewBar.swift; echo "$INFO"; } | shasum | cut -d' ' -f1)
BUILT=
if [ ! -x "$BIN" ] || [ "$(cat dist/.bar-stamp 2>/dev/null)" != "$STAMP" ]; then
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  echo "$INFO" > "$APP/Contents/Info.plist"
  cp app/src-tauri/icons/icon.icns "$APP/Contents/Resources/"
  swiftc -O menubar/AgentViewBar.swift -o "$BIN"
  codesign --force --sign - --identifier $LABEL "$APP"
  echo "$STAMP" > dist/.bar-stamp
  BUILT=1
  echo "AgentView was rebuilt: remove it from Full Disk Access in System Settings and add it again."
fi

pkill -x agentview-bar 2>/dev/null || true
RUNNING=$(pgrep -f "$PWD/$BIN" || true)
# launchd starts AgentView at login and again whenever it crashes or is killed. Quit in the menu stops it until the next login or ./start.sh.
if ! launchctl print "$JOB" >/dev/null 2>&1; then
  [ -n "$RUNNING" ] && kill $RUNNING && sleep 2
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
elif [ -z "$BUILT" ] && [ -n "$RUNNING" ] && launchctl print "$JOB" | grep -q "pid = $RUNNING$"; then
  echo "AgentView is running. Use the menu bar icon to restart the server."
  exit 0
else
  # After a rebuild, or when the running copy was opened outside launchd (Quit & Reopen in System Settings does that).
  [ -n "$RUNNING" ] && kill $RUNNING && sleep 2
  launchctl kickstart "$JOB"
fi
echo "AgentView is starting on http://localhost:7777 (logs in ~/.agentview/logs)"
