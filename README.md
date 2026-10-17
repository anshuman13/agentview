# AgentView

A web UI for Claude Code, built on the Agent SDK. VS Code layout on the desktop, tab bar on the phone.

## Run

```bash
npm install
./start.sh
```

Opens on http://localhost:5173 (server on :7777). `start.sh` also starts the menu bar app that keeps the Mac awake.
It uses the Claude Code CLI you have installed and its login.

| Command | |
| --- | --- |
| `npm run serve` | Server and vite, no reload on server changes (running turns survive edits) |
| `npm run dev` | Same, with server reload |
| `npm run menubar` | Build and start the keep-awake menu bar app |
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

To show that Chrome in the Browser tab: open `chrome://inspect/#remote-debugging`, tick "Allow remote debugging for
this browser instance", then click Connect in the Browser tab.

macOS only lets apps with Full Disk Access read Chrome's profile folder, so start AgentView from a terminal that has it
(System Settings → Privacy & Security → Full Disk Access). Otherwise the Browser tab can't connect.

## Grafana and Sentry

The Observe view (pulse icon) shows Sentry's unresolved issues and Grafana dashboards for any repo, and sends Loki
questions to the chat through the `grafana` MCP server. Settings live in `~/.agentview/observe.json`, created with an
example on first use and editable in the view:

```json
{
  "sentryToken": "",
  "repos": {
    "comida": {
      "grafana": { "url": "https://org.grafana.net", "dashboards": [{ "title": "Overview", "url": "https://..." }], "lokiSelector": "{app=\"comida\"}" },
      "sentry": { "org": "org", "project": "comida", "url": "https://sentry.io" }
    }
  }
}
```

Sentry needs a token in `SENTRY_AUTH_TOKEN` or `sentryToken`. Repos without settings get a guess from `centro.yaml`
or `.sentryclirc` and the other repos' org and Grafana URL.

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
