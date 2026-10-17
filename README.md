# AgentView

A web UI for Claude Code, built on the Agent SDK. VS Code layout on the desktop, tab bar on the phone.

## Run

```bash
npm install
./start.sh
```

`start.sh` builds and opens `dist/AgentView.app`, a menu bar app that runs everything: the server on :7777, vite on
:5173 and a small Chrome relay on :7779. It restarts any of them that exit, keeps the Mac awake, and has menu items
for Open AgentView, Restart server, Show logs (`~/.agentview/logs`) and Open at login. Quitting it stops AgentView.
To restart only the server from a shell, kill whatever listens on :7777 and the app starts it again.

It uses the Claude Code CLI you have installed and its login.

| Command | |
| --- | --- |
| `npm run serve` | Server and vite, no reload on server changes (running turns survive edits) |
| `npm run dev` | Same, with server reload |
| `npm test` | Unit tests |

`PROJECT_DIR=/path` sets the folder for the very first chat. After that AgentView reopens the last chat you viewed.

## Layout

- **Task box** (right): prompt, mode and model menus, context meter, and the timeline below it
- **Editor** (center): File tab follows Claude's edits and shows the diff against HEAD. Browser tab shows your Chrome
- **Sidebar**: Explorer, Chats (open and recent) and Workspace (repos, chats, Paseo worktrees)
- **Terminal** (bottom): a shell in the chat's folder

## Timeline and steering

Claude reports progress through a `set_status` tool added to every chat: current step, finished parts, next steps
and notes. The timeline shows these with your prompts and Claude's replies.

- Sending while Claude works stops the current step and continues with your message
- Editing the next steps sends the new plan at Claude's next tool call, without stopping it
- Questions, plan approvals and permissions show as buttons in the timeline

## Context

The meter shows the tokens in context and turns red past 200k. AgentView then runs `/compact` when the turn ends.
A failed compact is not retried.

## Chrome

Chats use Claude in Chrome, so Claude browses with your logins. Playwright is off.

To show that Chrome in the Browser tab, click Connect Chrome there. It opens Chrome's remote debugging page; tick
"Allow remote debugging for this browser instance" and click Allow. Chrome turns that checkbox off when it restarts.

The relay in AgentView.app holds the Chrome connection, so server restarts do not bring back Chrome's Allow dialog.
It reads Chrome's port file, which macOS only allows with Full Disk Access: add `dist/AgentView.app` once under
System Settings, Privacy & Security, Full Disk Access (the Browser tab has a button for it). The grant is tied to the
build, so it has to be redone when `menubar/AgentViewBar.swift` changes.

## Pages

Observe, Deploy and MCP Servers open as tabs in the editor area (the lower three activity bar icons, or the command
palette), so they get the full width instead of the sidebar. One page is open at a time; opening another replaces it.

## MCP servers

The MCP Servers page reads the same config as the Claude CLI (`~/.claude.json`, the repo's `.mcp.json`) and connects
to every server itself, like `claude mcp list`: each card shows the connection status, transport, command or URL, version
and tool count, grouped by where the server comes from. Click a card for the env variable names, the error text and the
tool list with descriptions. Servers that log in through OAuth show "OAuth via Claude" until Claude starts in the chat;
from then on the page shows the live status from the chat, with reconnect and disable actions, and claude.ai connectors
and plugin servers appear too. "Check" connects to everything again; results are cached for a minute.

## Grafana, Sentry and Snowflake

The Observe page (pulse icon) reads Sentry, Grafana and Snowflake through MCP servers, the same ones Claude uses:

- Grafana uses the `grafana` server from `~/.claude.json`: dashboards matching the repo (`search_dashboards`), error
  lines from Loki for the last hour (`query_loki_logs`) and error patterns (`query_loki_patterns`, Sift, or grouped
  locally when neither is available), each with an "Open in Grafana" deep link and an "Ask Claude" button.
- Sentry uses a `sentry` server from your Claude MCP config if there is one, otherwise AgentView starts
  `npx -y @sentry/mcp-server@latest` with the token from `sentryToken` (or `SENTRY_AUTH_TOKEN`). Issues list their
  level, culprit, count and last seen; "Details" shows the latest event and stack frames. If the MCP server cannot
  start, the REST API is used and the view says so.
- Snowflake runs the official server with `uvx snowflake-labs-mcp` and a read-only service config written to
  `~/.agentview/snowflake.yaml` (SELECT, SHOW and DESCRIBE only). The section has a connection form (account, user,
  warehouse, role, database, schema, access token or password), a database/schema/table picker, a SQL box (Cmd+Enter
  runs) and a result table capped at 200 rows.

"Add to Claude" writes the Sentry or Snowflake server entry into `~/.claude.json` (after a backup copy) so Claude gets
the same MCP. Settings live in `~/.agentview/observe.json`, created with an example on first use and editable in the
view:

```json
{
  "sentryToken": "",
  "snowflake": { "account": "org-account", "user": "me", "warehouse": "WH", "database": "DB", "schema": "PUBLIC", "role": "", "auth": "pat", "secret": "" },
  "repos": {
    "comida": {
      "grafana": { "url": "https://org.grafana.net", "query": "comida", "dashboards": [{ "title": "Overview", "url": "https://..." }], "lokiSelector": "{app=\"comida\"}" },
      "sentry": { "org": "org", "project": "comida", "url": "https://sentry.io" }
    }
  }
}
```

Repos without settings get a guess from `centro.yaml` or `.sentryclirc` and the other repos' org and Grafana URL.

## Notifications

When a chat asks a question, needs a permission or finishes a turn, AgentView notifies you. On the Mac the server
shows a system notification with a sound if no window is viewing that chat, at most one per chat every 30 seconds.
The browser shows its own notification while the tab is hidden; clicking it opens the chat. The bell in the status
bar turns browser notifications on or off.

## Models

New chats start in Auto mode: Claude asks only before risky actions.

**Team** in the model menu: Opus 5.5 plans each task, Sonnet 5.5 builds it and asks Opus for advice. Advisor calls
re-read the conversation, so they cost more in long chats.

Any chat can ask Fable 5.1 about a hard problem. Each call needs your approval.

## Workspace

Repos come from `~/workspace` and `~/workspace_personal`. Set `AGENTVIEW_ROOTS` (colon-separated) to change that.
Chats start only inside these folders or Paseo worktrees.

- Chats keep running in the background. Ones that need you are marked and listed first
- A chat closes after 10 idle minutes with no one viewing it. Reopen it from Recent
- Chats and Paseo worktrees idle for 12 hours can be deleted (worktree branches are kept)

## Phone

Open the phone icon in the status bar for a QR code. Works on the same Wi-Fi or over NetBird.

## Shortcuts

| Key | Action |
| --- | --- |
| ⌘O | Start a chat in a repo |
| ⌘P | Open a file |
| ⌘B | Toggle the sidebar |
| ⌘J | Toggle the terminal |
| ⌘E | Switch between file and browser |

## Loop mode

The loop pill in the composer turns a prompt into a plan, build, test cycle. Opus plans in plan mode and starts
building as soon as the plan is ready, Sonnet then tests the result as a separate model and ends with a verdict, and
Opus fixes whatever the tester found, up to the number of rounds you pick. Phases show as violet markers in the
timeline and transcript, the composer footer shows the current phase and round, and Stop ends the loop.
