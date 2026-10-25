#!/bin/zsh
set -euo pipefail

ASSISTANT_DIR="${ASSISTANT_DIR:-$HOME/.agentview/assistant}"
DB="$ASSISTANT_DIR/assistant.db"
BACKUPS_DIR="$ASSISTANT_DIR/backups"
LOG_DIR="$ASSISTANT_DIR"
TARGET="$BACKUPS_DIR/assistant-$(date +%Y-%m-%d).db"
TEMP_TARGET="$TARGET.tmp"

mkdir -p "$BACKUPS_DIR" "$LOG_DIR"

# Run the backup to a temporary file
if ! sqlite3 "$DB" "VACUUM INTO '$TEMP_TARGET'"; then
  rm -f "$TEMP_TARGET"
  exit 1
fi

# Move temporary file to target, replacing any existing file for the same day
mv -f "$TEMP_TARGET" "$TARGET"

# Delete backups older than 14 days
find "$BACKUPS_DIR" -name 'assistant-*.db' -mtime +14 -delete
