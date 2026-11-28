#!/bin/zsh
# Runs every 15 minutes: a snapshot of all AgentView data kept 24 hours,
# and on the first run of each day the dated copies kept 14 days.
set -euo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.agentview}"
ASSISTANT_DIR="${ASSISTANT_DIR:-$STATE_DIR/assistant}"
TRAVEL_DIR="${TRAVEL_DIR:-$STATE_DIR/travel}"
BACKUPS_DIR="$ASSISTANT_DIR/backups"
QUARTER_DIR="$BACKUPS_DIR/quarter"
DAY=$(date +%Y-%m-%d)
mkdir -p "$BACKUPS_DIR" "$QUARTER_DIR"

SNAP=$(mktemp -d)
trap 'rm -r "$SNAP"' EXIT
mkdir "$SNAP/databases"

# Databases are copied consistently with VACUUM INTO, never as live files.
sqlite3 "$ASSISTANT_DIR/assistant.db" "VACUUM INTO '$SNAP/databases/assistant.sqlite'"
for db in "$STATE_DIR"/*.db(N); do
  sqlite3 "$db" "VACUUM INTO '$SNAP/databases/${db:t:r}.sqlite'"
done

# state.tgz: every file in ~/.agentview except the browser profile, logs, backups, live databases and travel.
# $1 is the target, the rest extra tar excludes.
state_tar() {
  local target=$1; shift
  tar -czf "$target.tmp" -C "$STATE_DIR" \
    --exclude ./chrome --exclude ./logs --exclude ./assistant --exclude ./travel --exclude ./mini-backups \
    --exclude './*.db' --exclude './*.db-wal' --exclude './*.db-shm' --exclude './*.sock' --exclude ./notify.fifo --exclude './*.log' \
    "$@" . -C "$SNAP" databases
  mv -f "$target.tmp" "$target"
}

state_tar "$QUARTER_DIR/state-$(date +%Y-%m-%d-%H%M).tgz" --exclude ./claude-ref
find "$QUARTER_DIR" -name 'state-*.tgz' -mmin +1440 -delete

if [ ! -f "$BACKUPS_DIR/state-$DAY.tgz" ]; then
  cp "$SNAP/databases/assistant.sqlite" "$BACKUPS_DIR/assistant-$DAY.db.tmp"
  mv -f "$BACKUPS_DIR/assistant-$DAY.db.tmp" "$BACKUPS_DIR/assistant-$DAY.db"
  if [ -d "$TRAVEL_DIR" ]; then
    tar -czf "$BACKUPS_DIR/travel-$DAY.tgz.tmp" -C "$TRAVEL_DIR" .
    mv -f "$BACKUPS_DIR/travel-$DAY.tgz.tmp" "$BACKUPS_DIR/travel-$DAY.tgz"
  fi
  state_tar "$BACKUPS_DIR/state-$DAY.tgz"
fi
find "$BACKUPS_DIR" -maxdepth 1 \( -name 'assistant-*.db' -o -name 'travel-*.tgz' -o -name 'state-*.tgz' \) -mtime +14 -delete
