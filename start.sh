#!/bin/sh
set -e
cd "$(dirname "$0")"

if [ ! -x dist/agentview-bar ] || [ menubar/AgentViewBar.swift -nt dist/agentview-bar ]; then
  mkdir -p dist
  swiftc -O menubar/AgentViewBar.swift -o dist/agentview-bar
fi
pkill -x agentview-bar 2>/dev/null || true
nohup ./dist/agentview-bar >/dev/null 2>&1 &

if lsof -nP -iTCP:7777 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "AgentView is already running on http://localhost:5173"
  exit 0
fi
exec npm run serve
