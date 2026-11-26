# Integrations

## Chrome

Chats use Claude in Chrome, so Claude browses with your logins. Playwright is off.

To show that Chrome in the Browser tab, click Connect Chrome there. It opens Chrome's remote debugging page; tick
"Allow remote debugging for this browser instance" and click Allow. Chrome turns that checkbox off when it restarts.

The relay in AgentView.app holds the Chrome connection, so server restarts do not bring back Chrome's Allow dialog.
It reads Chrome's port file, which macOS only allows with Full Disk Access: add `dist/AgentView.app` once under
System Settings, Privacy & Security, Full Disk Access (the Browser tab has a button for it). The grant is tied to the
build, so it has to be redone when `menubar/AgentViewBar.swift` changes.

On a Mac that only runs agents, AgentView can use its own Chrome instead: `mkdir ~/.agentview/chrome`. AgentView then
starts Chrome with that profile and remote debugging on port 9333, so there is no Allow dialog and no Full Disk Access.
Claude in Chrome is not needed there: chats on that Mac can drive the laptop's Chrome, and they also get a
`browser` MCP server (Playwright attached to port 9333) that drives AgentView's own Chrome with its own logins. Chats and terminals get
`BROWSER` set, so logins such as `gcloud auth login` open in that Chrome and show in the Browser tab.

## MCP servers

The MCP Servers page reads the same config as the Claude CLI (`~/.claude.json`, the repo's `.mcp.json`) and connects
to every server itself, like `claude mcp list`: one table lists each server's type, source and connection status, with a
search box and a filter menu (Show and Source). Click a row for the command or URL, the env variable names, the error text and the
tool list with descriptions. Servers that log in through OAuth show "OAuth via Claude" until Claude starts in the chat;
from then on the page shows the live status from the chat, with reconnect and disable actions, and claude.ai connectors
and plugin servers appear too. "Check" connects to everything again; results are cached for a minute.

