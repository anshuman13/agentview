# AgentView

A web UI for Claude Code, built on the Agent SDK. VS Code layout on the desktop, tab bar on the phone.

## Run

```bash
npm install
./start.sh
```

`start.sh` builds and opens `dist/AgentView.app`, a menu bar app that runs everything: the server on :7777, vite on
:5173 and a small Chrome relay on :7779. It restarts any of them that exit, keeps the Mac awake, and has menu items
for Open AgentView, Restart server, Show logs (`~/.agentview/logs`) and Open at login. Opening the app again, for
example by double-clicking it, opens the UI in your browser. Quitting it stops AgentView.
To restart only the server from a shell, kill whatever listens on :7777 and the app starts it again.

It uses the Claude Code CLI you have installed and its login.

| Command | |
| --- | --- |
| `npm run serve` | Server and vite, no reload on server changes (running turns survive edits) |
| `npm run dev` | Same, with server reload |
| `npm run phone` | Install the latest Android build on a phone connected over USB or wireless debugging |
| `npm test` | Unit tests |

`PROJECT_DIR=/path` sets the folder for the very first chat. After that AgentView reopens the last chat you viewed.

## Layout

- **Task box** (right): prompt, mode and model menus, context meter, and the timeline below it
- **Editor** (center): File tab follows Claude's edits and shows the diff against HEAD. Markdown files open as a rendered document with an outline, and the preview button shows the source. Browser tab shows your Chrome
- **Sidebar**: Explorer, Chats (open and recent) and Workspace (repos, chats, Paseo worktrees)
- **Terminal** (bottom): a shell in the chat's folder

## Timeline and steering

Claude reports progress through a `set_status` tool added to every chat: current step, finished parts, next steps
and notes. The timeline shows one card per prompt: Claude's final reply, the files changed with line counts,
commands run and the first error of each failed one, commits, subagents, these notes and the steps behind them.
Switch to the transcript for every message and step in order.

- Sending while Claude works stops whatever it is doing, including an open permission or question, and continues
  with your message
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

On a Mac that only runs agents, AgentView can use its own Chrome instead: `mkdir ~/.agentview/chrome`. AgentView then
starts Chrome with that profile and remote debugging on port 9333, so there is no Allow dialog and no Full Disk Access.
Claude in Chrome is not needed there: chats on that Mac can drive the laptop's Chrome. Chats and terminals get
`BROWSER` set, so logins such as `gcloud auth login` open in that Chrome and show in the Browser tab.

## Deep links

`?view=github` opens a sidebar view (explorer, changes, github, chats, sessions), `?page=observe` opens a page
(observe, deploy, mcp), `?chat=<id>` opens a running chat and `?session=<id>` reopens a saved one. The parameters
are read once and removed from the address bar.

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

Open the phone icon in the status bar for a QR code. Works over NetBird.

AgentView only accepts connections from this Mac and the peers `netbird status` lists, and refuses requests and
websockets from other websites, including other servers on localhost.

## Macs

The Mac's name in the status bar (on the phone: the chat header and the More sheet) lists the other Macs on NetBird
that run AgentView, with a dot for whether an agent is working there. Click one to switch to it; a banner names the
Mac you landed on. The phone app remembers the Mac you used last and offers the others when it can't reach it.
A Mac cannot reach its own NetBird address, so the Mac you are viewing from is marked "you are here" and opens on
localhost.

## Another Mac

To run AgentView on a second Mac, such as an always-on Mac mini, first do the parts that need you at the keyboard:

1. Install Homebrew (brew.sh) and Google Chrome, sign in to your Chrome profile and add Claude in Chrome
2. `brew install netbirdio/tap/netbird`, `sudo netbird service install && sudo netbird service start`, `netbird up`,
   then switch off Login expiration for this Mac in the NetBird dashboard
3. `brew install gh && gh auth login` with the GitHub account that owns this repo
4. `brew install --cask claude-code`, run `claude` and log in
5. On the first Mac, run `tar czf ~/Desktop/mini-config.tgz -C ~ .claude/CLAUDE.md .claude/settings.json .claude/skills .gitconfig .gitconfig-work .gitconfig-personal`
   and copy the file to `~/Downloads` on this Mac (AirDrop works)

Then paste this into `claude`:

> Clone anshuman13/agentview with gh into ~/workspace_personal/agentview and follow the "Another Mac" section of its
> README, the steps for Claude.

Steps for Claude:

1. `brew install node git uv`, then `npm install` in the repo
2. Unpack `~/Downloads/mini-config.tgz` into `~` without overwriting existing files, then delete it
3. Run `./start.sh`
4. Check that `curl -s http://localhost:5173/api/connect` lists a NetBird address
5. `brew install rustup && rustup default stable`, then `npm run build -w app` and copy
   `app/src-tauri/target/release/bundle/macos/AgentView.app` to `/Applications` (the desktop window app)
6. Tell me to turn on Open at login in the AgentView menu bar menu, grant Full Disk Access to `dist/AgentView.app`,
   click Allow in Chrome's remote debugging prompt, and add the MCP servers (`claude mcp add`, then `/mcp` to sign in)

The mini does not run local databases, so leave out the `*_local` MCP servers.

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

## Agents

The Agents tab lists the sub-agents of the chat with their status, elapsed time and tokens, and shows each one's report, prompt and steps.
