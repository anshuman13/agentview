#!/bin/sh
# Sets up a second Claude login that AgentView falls back to on a usage limit.
# It shares settings, skills, plugins and chat history with ~/.claude and keeps its own login.
set -e
MAIN="$HOME/.claude"
ALT="${AGENTVIEW_ALT_CLAUDE:-$HOME/.claude-alt}"
mkdir -p "$ALT"
for f in "$MAIN"/* "$MAIN"/.[!.]*; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  case "$name" in
    policy-limits*|remote-settings*|backups|cache|.last-cleanup|.credentials.json|.claude.json) continue ;;
  esac
  [ -e "$ALT/$name" ] || [ -L "$ALT/$name" ] || ln -s "$f" "$ALT/$name"
done
# User MCP servers and folder trust come from ~/.claude.json, without the main login.
if [ ! -f "$ALT/.claude.json" ] && [ -f "$HOME/.claude.json" ]; then
  (umask 077 && jq 'del(.oauthAccount, .userID)' "$HOME/.claude.json" > "$ALT/.claude.json")
fi
if jq -e '.oauthAccount' "$ALT/.claude.json" >/dev/null 2>&1; then
  echo "Second account: $(jq -r '.oauthAccount.emailAddress // "logged in"' "$ALT/.claude.json")"
else
  echo "Log in to the second account with: CLAUDE_CONFIG_DIR=$ALT claude, then /login"
fi
