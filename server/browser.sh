#!/bin/sh
url=$(printf %s "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
curl -sf -XPOST -H 'content-type: application/json' --data "{\"url\":\"$url\"}" \
  "http://127.0.0.1:${AGENTVIEW_PORT:-7777}/api/open" >/dev/null || open "$1"
