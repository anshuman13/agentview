#!/bin/sh
case "$1" in http://*|https://*) ;; *) exit 1 ;; esac
url=$(printf %s "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g')
curl -sf -XPOST -H 'content-type: application/json' --data "{\"url\":\"$url\"}" \
  "http://127.0.0.1:${AGENTVIEW_PORT:-7777}/api/open" >/dev/null || open -- "$1"
