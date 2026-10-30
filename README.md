# AgentView

A web UI for Claude Code, built on the Agent SDK. VS Code layout on the desktop, tab bar on the phone.

## Run

```bash
brew install oven-sh/bun/bun
npm install
./start.sh
```

`start.sh` builds and opens `dist/AgentView.app`, a menu bar app that runs the server on :7777 and a Chrome relay on
:7779, restarts any that exit and keeps the Mac awake. Its menu has Open AgentView, Restart server,
Show logs (`~/.agentview/logs`) and Open at login. Quitting it stops AgentView. It uses the Claude Code CLI you have
installed and its login.

| Command | |
| --- | --- |
| `npm run serve` | Server and vite, no reload on server changes |
| `npm run dev` | Same, with server reload |
| `npm run phone` | Install the latest Android build on a connected phone |
| `npm test` | Unit tests (vitest; server, web and shared) |
| `npm test -w assistant` | Hub tests (bun test) |

Both test runs load `test-setup.ts`, which points the Claude config, usage limit and findings folders at a temp dir.

`PROJECT_DIR=/path` sets the folder for the very first chat; after that AgentView reopens the last chat you viewed.
Restarting the server keeps running chats alive; see [architecture](docs/architecture.md).

## What it does

- Chats in any repo under `~/workspace` and `~/workspace_personal`, running in the background, with a timeline of
  replies, changed files, commands, commits and subagents
- Steering while Claude works, editable next steps, permission and question cards, rewind and fork
- Editor with diffs, Source Control, GitHub pull requests with review findings, a terminal, and your Chrome
- Observe (Grafana, Snowflake), Deploy and MCP server pages
- Codex: Overview, Tasks, Meetings, Jobs and Wiki, synced with an assistant hub that scans Slack, Gmail, the calendar
  and meeting transcripts. A person page adds their Slack DM summary, open asks, your promises and unanswered mail;
  Overview's Keep in touch card lists people gone quiet for over 1.5x their usual gap, with a nudge to copy;
  Copy standup on Overview copies yesterday's done tasks and decisions, today's plan and
  waiting-on items older than two days;
  after a meeting, Overview lists the asks and DMs that came in while it ran, and urgent
  pushes during a meeting wait and arrive as one push when it ends
- Focus timer on a task: Start shows a bar over Codex until Stop, which adds the minutes to the task's time spent; tasks
  without an estimate get one suggested from similar done tasks
- Up to 3 weekly goals set on Meetings > Week; a task links to one, Overview shows done/total per goal and
  Plan my day places goal tasks first
- `/loop` and `/goal`, loop mode (plan, build, test), Team and effort settings
- Notifications on the Mac, in the browser and on the phone through ntfy; works from a phone and across Macs over NetBird

## Docs

- [Features](docs/features.md): layout, timeline, models, workspace, notifications, loops, shortcuts
- [Integrations](docs/integrations.md): Chrome, MCP servers, Grafana and Snowflake
- [Phone and other Macs](docs/macs.md)
- [Assistant plan](docs/assistant.md), [Codex flows](docs/codex-flows.md) and [Codex wiki and meetings](docs/codex-wiki.md)
- [Architecture](docs/architecture.md) and [decisions](docs/decisions.md)
