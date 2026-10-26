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
Claude in Chrome is not needed there: chats on that Mac can drive the laptop's Chrome. Chats and terminals get
`BROWSER` set, so logins such as `gcloud auth login` open in that Chrome and show in the Browser tab.

## MCP servers

The MCP Servers page reads the same config as the Claude CLI (`~/.claude.json`, the repo's `.mcp.json`) and connects
to every server itself, like `claude mcp list`: each card shows the connection status, transport, command or URL, version
and tool count, grouped by where the server comes from. Click a card for the env variable names, the error text and the
tool list with descriptions. Servers that log in through OAuth show "OAuth via Claude" until Claude starts in the chat;
from then on the page shows the live status from the chat, with reconnect and disable actions, and claude.ai connectors
and plugin servers appear too. "Check" connects to everything again; results are cached for a minute.

## Grafana and Snowflake

The Observe page (pulse icon) reads Grafana and Snowflake through MCP servers, the same ones Claude uses:

- Grafana comes first and loads right away, using the `grafana` server from `~/.claude.json`. An "Ask about <repo> in
  Grafana" box sends your question to Claude with the repo's Loki selector and dashboards, and Claude answers through
  the grafana MCP with links to the dashboards and Explore queries it used. Below it are the dashboards matching the
  repo (`search_dashboards` plus any pinned in the settings) as links, error lines from Loki for the last hour
  (`query_loki_logs`) and error patterns (`query_loki_patterns`, Sift, or grouped locally when neither is available),
  each with an "Open in Grafana" deep link and an "Ask Claude" button.
- Snowflake (collapsed by default) runs the official server with `uvx snowflake-labs-mcp` and a read-only service
  config written to `~/.agentview/snowflake.yaml` (SELECT, SHOW and DESCRIBE only). The section has a connection form
  (account, user, warehouse, role, database, schema, access token or password), a database/schema/table picker, a SQL
  box (Cmd+Enter runs) and a result table capped at 200 rows.

"Add to Claude" writes the Snowflake server entry into `~/.claude.json` (after a backup copy) so Claude gets the same
MCP. Settings live in `~/.agentview/observe.json`, created with an example on first use and editable in the view:

```json
{
  "snowflake": { "account": "org-account", "user": "me", "warehouse": "WH", "database": "DB", "schema": "PUBLIC", "role": "", "auth": "pat", "secret": "" },
  "repos": {
    "example": {
      "grafana": { "url": "https://org.grafana.net", "query": "example", "dashboards": [{ "title": "Overview", "url": "https://..." }], "lokiSelector": "{app=\"example\"}" }
    }
  }
}
```

Repos without settings get a guess from `centro.yaml` or `catalog-info.yaml` and the other repos' Grafana URL.
