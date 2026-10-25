#!/bin/zsh
set -euo pipefail

ASSISTANT_DIR="${ASSISTANT_DIR:-$HOME/.agentview/assistant}"
DB="$ASSISTANT_DIR/assistant.db"
BACKUPS_DIR="$ASSISTANT_DIR/backups"
TARGET="$BACKUPS_DIR/assistant-$(date +%Y-%m-%d).db"

mkdir -p "$BACKUPS_DIR"

# Remove any existing target for the same day
if [[ -f "$TARGET" ]]; then
  rm "$TARGET"
fi

# Run the backup
sqlite3 "$DB" "VACUUM INTO '$TARGET'"

# Delete backups older than 14 days
find "$BACKUPS_DIR" -name 'assistant-*.db' -mtime +14 -delete
