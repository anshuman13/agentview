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
- Background tasks (workflow runs, background agents, `run_in_background` shell commands) hold the restart like
  running turns do, and a long-running one holds it to the 10-minute limit.
- Before exiting, the host writes `~/.agentview/restore.json` (open chats, loops, crons, and any stopped work: the
  tasks that were running and whether a turn was in progress); the next host reopens them from there and asks
  each chat with stopped work to resume it.
- Loops, goals and build cycles are runs (`session/runs.ts`) in `~/.agentview/runs.json`; a loop's `runId` in
  `restore.json` links the restarted chat back to its run. The host broadcasts them as `runs` messages, the API
  server caches them like the chats and sends them to clients (last 10 rounds each).
- With no API server for five minutes and nothing running, the host saves and exits.

## Server folders

| Folder | Contents |
| --- | --- |
| `agent/` | `AgentDriver` interface (`types.ts`) and the Claude driver (`claude/`): SDK query, message handling, history, MCP, the `agentview` wiki and data tools |
| `session/` | Provider-neutral chat session: send queue, turns, `/loop` and `/goal` (`repeat.ts`), build cycle (`loop.ts`), approvals, findings, pull request parsing |
| `host/` | Agent host process, socket protocol and the API server's client for it |
| `http/` | Access control, request bodies, SSE ring buffer, static serving, Mac discovery |
| `workspace/` | Files, git, worktrees, terminals |
| `integrations/` | GitHub, attention inbox, notifications, Observe, Deploy, MCP client, the assistant hub proxy (`/api/assistant/*`) |
| `chrome/` | Chrome connection and relay |

`shared/` holds the wire protocol, the hub table list (`tables.ts`) and helpers used by server, web and the hub.

## Assistant hub

`assistant/src/server.ts` runs on the Mac mini on :7790 as a launchd service (`assistant/deploy/`). Its routes live in
`assistant/src/routes/` (sync, tasks, calendar, transcripts) and share the helpers in `routes/http.ts`. Scans, jobs,
transcript import and wiki updates call Claude through `assistant/src/core/claude.ts`, which runs on the profile's account
and refuses at the usage limit. See [assistant.md](assistant.md).

## Client

React with a small store (`web/src/app/store.ts`). It listens on one Server-Sent Events stream (`/api/events`) and sends
commands with `POST /api/cmd`. Each broadcast has an id; after a drop the stream resumes from `Last-Event-ID` through a
ring buffer, or gets a fresh `init` snapshot when the gap is too old. The ring skips appends for chats nobody has
open, except for 5 minutes after the last viewer leaves; a skip leaves a marker so a resume into that chat gets an `init`.

Claude's reply streams as `append` messages that carry only the new text and its offset, at most every 80 ms per text
block. The client adds an append only when the offset fits the text it has; the finished event follows in full, and
`init` snapshots hold the whole text so far.

The `init` for a client opening a chat is a tail: the host `state` op takes a `limit` and `Session.view(limit)` returns the
last `limit` events (150, `ROW_WINDOW`) plus `earlier`, the count left out. Older events come from
`GET /api/chat/events?chat=&before=<event id>&limit=` (host op `events_before`, `Session.before`), at most 500 per page.
`/api/state` and the `init` the session broadcasts hold every event. A tail `init` for the chat on screen keeps the older
events already paged in (`mergeTail` in `web/src/app/runtime/pageEvents.ts`).

`web/src` is grouped by feature: `app` (shell, store, API, palette), `ui` (shared widgets and helpers), `chat`,
`sessions`, `workspace` (files, code, terminal, browser), `ops` (Observe, Deploy, GitHub, MCP), `codex` (with `data`, `jobs`,
`meetings`, `summary`, `wiki`) and `styles`.

Views, panes, pages and popovers load as their own chunks (`web/src/app/lazy.tsx`), and so does the markdown
parser, off the chat's startup path. Views that render chat markdown wait for it, so replies never show as plain text
first. The Codex feed and the sidebar views load when the browser is idle, so opening one never waits on Suspense's 300 ms
fallback hold. The build merges chunks under 20 kB to keep the first load to fewer requests.

The native Android client in `android/` speaks the same protocol; see [Phone and other Macs](macs.md#native-android-app).

## Code shape

- Layers call downward only. Web: components call hooks and `*Logic.ts` files, which call the API module
  (`web/src/app/api.ts`) or the Codex data store (`web/src/codex/data/`); components never call `fetch` themselves.
  Server: `http/` routes call `session/`, `workspace/` and `integrations/`; only `agent/` talks to the Claude SDK.
  Android mirrors web: screens read state holders, which call `net/`.
- Server calls on web live in a feature API file (`chat/chatApi.ts`, `workspace/fileApi.ts`, `ops/opsApi.ts`,
  `sessions/sessionApi.ts`, `sessions/folders.ts`) built on `fetchJson` or `apiUrl`/`api()` from `app/api.ts`. A new call
  goes in the API file of its feature.
- Files by role: `Foo.tsx` renders, `useFoo.ts` holds its state and effects, `fooLogic.ts` (Android `FooLogic.kt`) holds
  pure logic with its tests. Folders are features (`chat`, `sessions`, `workspace`, `ops`, `codex`), not kinds of file.
- Logic that web and Android both carry (prompts, parsers, queue order, labels) changes on both sides in the same commit.
  Where a `shared/fixtures/*.json` case list exists, both test suites run it; add a case there when you change that logic.
- No abstraction with one caller, no generic frameworks, no new dependency for something a few lines do.
- Size is a hint, not a rule: aim for functions under about 50 lines, components under about 80 and files under about
  350. A file or function that does one coherent thing (a switch over message types, a route table) may stay longer.
  Split by responsibility, never just to meet a number.

## Access

Only this Mac and NetBird peers may connect, and requests from other origins are refused (`server/src/http/access.ts`).
