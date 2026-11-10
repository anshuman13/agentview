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
| `agent/` | `AgentDriver` interface (`types.ts`), the provider registry (`registry.ts`: driver factory and limit check per provider, and the provider each chat last ran on), the Claude driver (`claude/`, also OpenRouter through the SDK's base URL): SDK query, message handling, history, MCP, and the Codex driver (`codex/`): JSON-RPC to `codex app-server`, event mapping, approvals, plan usage. The `agentview` tools (status, wiki, data, chat search, report findings) are one registry in `tools/`, served in process to Claude and over stdio to Codex |
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

## Providers

A chat runs on `claude`, `openrouter` (the Claude driver with another environment) or `codex`. Each difference between
them uses one mechanism, the first that fits; clients never branch on the provider name for anything else.

1. Step vocabulary: Claude Code tool names (`Bash`, `Edit`, `mcp__<server>__<tool>`...) are the step and card vocabulary.
   A driver maps its own items onto them (`agent/codex/events.ts`); there are no per-provider `ChatEvent` kinds.
2. Provider table `shared/providers.ts`, mirrored in Android `net/Providers.kt`: `providerLabel`, `billing`
   (`usd`, `none`, `plan`) and `providerModes` (the permission modes a provider offers). Fixed per provider.
3. Capabilities (`SessionInfo.capabilities`) name only the controls a provider cannot serve; the UI hides each and says so
   (`chat/capabilitiesLogic.ts`, Android `CapabilitiesLogic.kt`). `mcpEdit` is Add, toggle and Log in on MCP servers,
   `connectors` the claude.ai connectors.
4. Driver methods (`AgentDriver` in `agent/types.ts`) are what the session asks of the agent: `compact`, `command`,
   `review`, `roleModel`, `inject`. The session never writes a provider's slash command as text.
5. `SessionInfo` fields hold what differs by chat or model: `contextWindow`, `models[].efforts`, `resumeCommand`,
   `instructionFiles`. The registry (`agent/registry.ts`) is the per-provider table on the server: driver, transcript,
   memory files, resume line, MCP servers.
6. The session owns what is provider neutral (`session/`): `@chat` expansion, PR and findings pick-up, limits arrive as
   `host.limit`, every driver calls `host.compacted`, and the command router owns `/loop`, `/goal`, `/tries`, `/compact`
   and `/code-review`. Drivers only report raw facts.
7. AgentView tools live once in `agent/tools/`. Claude and OpenRouter get them through the in-process adapter, Codex
   through a stdio MCP server (`agent/tools/stdio.ts`) the host starts, named `agentview` so steps render the same.
8. Words: text tied to one chat uses `providerLabel`; text that is not says "the agent". The hub Ask chat and other hub
   background work stay on Claude.
9. Which provider runs: `createChat` takes the explicit choice, else the provider of the session being resumed, else
   `defaultProvider` in settings. Inheritance (Fork chat, tries) passes the provider explicitly.

## Access

Only this Mac and NetBird peers may connect, and requests from other origins are refused (`server/src/http/access.ts`).

## Setup for a new user

Nothing is specific to one person or company until `~/.agentview/settings.json` says so. The server creates it on the first
start and fills in what applied on that Mac (a hub there, a deploy service reachable, extra Claude accounts logged in);
anywhere else it is empty. Keys, all optional:

| Key | Default | Effect |
|---|---|---|
| `deployUrl` | empty | Base URL of the deploy service. Empty hides the Deploy page, its nav item, palette entries and the Android screen, and `/api/deploy/*` answers 404. |
| `owner` | "the owner" | Name in the Slack auto-reply texts. |
| `hubUrl` | `http://localhost:7790` | How phones and other Macs reach the hub; used in push action links and by a server without a local hub. |
| `accountLabels` | Account 1, Account 2, Account 3 | Names of the `main`, `alt` and `alt2` Claude accounts, for example `{ "main": "Personal", "alt": "Work" }`. |
| `roots` | `["~/workspace"]` | Folders whose subfolders are the repos listed in Workspace and offered for new projects. `AGENTVIEW_ROOTS` (colon-separated) overrides it. |
| `personalRoot` | empty | Folder whose chats use the personal profile, wiki and account (`main`); it is also a root. Empty means every folder is work. |
| `featureUse` | `false` | Opt-in counts of which features are used. On, the web app posts a feature id per action to `/api/feature-use` and the server adds it to today's count in `~/.agentview/feature-use.json` (day, feature id, count; 90 days kept; nothing else, nothing sent anywhere). Turning it off deletes the file. |
| `unattended` | `{ "allowWrite": [], "allowedDomains": ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"] }` | Limits of a scheduled coding chat: folders it may write besides its worktree and the temp folder, and the hosts its sandbox and WebFetch may reach. `localhost`, IP addresses and `*.netbird.cloud` entries are dropped; github.com is not a default. |

The server reads the file on each request and the host process applies the labels at start, so restart the server after editing
`accountLabels`, `roots` or `personalRoot`. The phone app starts on `http://localhost:7777` until a Mac address is saved in its Mac address screen.
Grafana, Snowflake, ntfy and Sentry stay in `~/.agentview/observe.json` and show only when configured there.
