# Architecture

## Processes

`dist/AgentView.app` (built from `menubar/AgentViewBar.swift` by `start.sh`) supervises two processes and restarts
any that exit:

| Process | Port | Role |
| --- | --- | --- |
| API server (`server/src/index.ts`) | :7777 | Web app (the `web/dist` build), event stream, files, git, terminals, GitHub, Observe, Deploy |
| Chrome relay (`server/src/chrome/relay.ts`) | :7779 | Holds the Chrome DevTools connection across server restarts |

The API server starts a fourth process, the agent host (`server/src/host/main.ts`), in its own process group. The
host owns every chat and its Claude CLI process and listens on `~/.agentview/host-<port>.sock`; its log is
`~/.agentview/logs/host.log`. Requests and broadcasts travel as newline-delimited JSON (`server/src/host/protocol.ts`).

## Restarts

- The API server builds `web/` each time it starts, so web changes go live on its next restart.
- Restarting the API server (menu item, `POST /api/restart`, a file change under `npm run dev`) leaves the host and
  running turns alone. Clients reconnect and resume.
- The host hashes its own import graph at boot. On a restart request, and whenever an API server connects, it
  restarts only if that hash changed, after running turns end (at most 10 minutes). `POST /api/restart?full`
  forces it.
- Before exiting, the host writes `~/.agentview/restore.json` (open chats, loops, crons); the next host reopens
  them from there.
- With no API server for five minutes and nothing running, the host saves and exits.

## Server folders

| Folder | Contents |
| --- | --- |
| `agent/` | `AgentDriver` interface (`types.ts`) and the Claude driver (`claude/`): SDK query, message handling, history, MCP, the `agentview` wiki and data tools |
| `session/` | Provider-neutral chat session: send queue, turns, `/loop` and `/goal` (`repeat.ts`), loop mode (`loop.ts`), approvals, findings, pull request parsing |
| `host/` | Agent host process, socket protocol and the API server's client for it |
| `http/` | Access control, request bodies, SSE ring buffer, static serving, Mac discovery |
| `workspace/` | Files, git, worktrees, terminals |
| `integrations/` | GitHub, attention inbox, notifications, Observe, Deploy, MCP client, the assistant hub proxy (`/api/assistant/*`) |
| `chrome/` | Chrome connection and relay |

`shared/` holds the wire protocol, the hub table list (`tables.ts`) and helpers used by server, web and the hub.

## Assistant hub

`assistant/src/server.ts` runs on the Mac mini on :7790 as a launchd service (`assistant/deploy/`). Its routes live in
`assistant/src/routes/` (sync, tasks, calendar, transcripts) and share the helpers in `routes/http.ts`. Scans, jobs,
transcript import and wiki updates call Claude through `assistant/src/claude.ts`, which runs on the profile's account
and refuses at the usage limit. See [assistant.md](assistant.md).

## Client

React with a small store (`web/src/app/store.ts`). It listens on one Server-Sent Events stream (`/api/events`) and sends
commands with `POST /api/cmd`. Each broadcast has an id; after a drop the stream resumes from `Last-Event-ID` through a
ring buffer, or gets a fresh `init` snapshot when the gap is too old.

Claude's reply streams as `append` messages that carry only the new text and its offset, at most every 80 ms per text
block. The client adds an append only when the offset fits the text it has; the finished event follows in full, and
`init` snapshots hold the whole text so far.

`web/src` is grouped by feature: `app` (shell, store, API, palette), `ui` (shared widgets and helpers), `chat`,
`sessions`, `workspace` (files, code, terminal, browser), `ops` (Observe, Deploy, GitHub, MCP), `codex` (with `data`, `jobs`,
`meetings`, `summary`, `wiki`) and `styles`.

## Access

Only this Mac and NetBird peers may connect, and requests from other origins are refused (`server/src/http/access.ts`).
