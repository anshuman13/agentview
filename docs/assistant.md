# Assistant

A personal assistant for the phone: a task tracker fed by Slack, meetings, mail and Linear, personal meeting notes,
and a scheduler that runs jobs. It must open instantly on the phone, work offline, keep data on my own devices and
cost nothing per month.

## Layout

| Device | Role |
| --- | --- |
| Mac mini | Hub: the main SQLite database, the sync API and the scheduler, running as launchd services |
| Phone | Full local copy in SQLite, the Assistant screen, voice capture transcribed on the phone |
| Laptop | Client like the phone, keeping its copy in the browser's IndexedDB, plus a nightly copy of the mini's database as a backup |

Devices reach the mini over NetBird. The phone reads and writes its own copy and syncs when the mini is reachable,
so a power cut, an outage or a reboot at home only pauses scans and sync.

## Stack

- Bun with `bun:sqlite`, one database file, in the `assistant/` workspace of this repo
- Sync: every row carries a version; clients push their changes and pull "changes since N"; last edit wins per field
- Search: SQLite FTS5 for keywords, plus embeddings from a small local multilingual model (Norwegian and English),
  compared in memory
- Backups: `VACUUM INTO` a dated file, copied nightly to the laptop, plus Time Machine

## Profiles and accounts

Everything shows in one merged view; each row has a `profile` (work or personal) shown as a tag and usable as a filter.

Collection stays per account. claude.ai connectors belong to the Claude account, so the account picks the connectors:

| Profile | Claude account | Connectors |
| --- | --- | --- |
| work | work account | Slack, Gmail, Calendar, Drive, Linear |
| personal | personal account | Gmail, Calendar, Drive |

Each profile has its own Claude config folder on the mini (nothing linked to `~/.claude`) and its own MCP list.
Jobs are pinned to their account with no fallback: at a usage limit they wait and retry. Questions that need both
sides run on the personal account.

## Data

| Table | Contents |
| --- | --- |
| items | Tasks, notes, captures, meeting notes, Slack and mail snippets: title, text, source link, people, time, status |
| facts | Memory and wiki claims: one-sentence statements with their sources, page and heading; a contradicting fact supersedes the old one, and a claim can be contested |
| pages | Wiki pages grouped in sections |
| meetings | Calendar meetings with my notes, the summary and decisions |
| slack_decisions | Decisions the Slack scan saw in watched channels, with channel, permalink and time; hub only, kept 14 days, read by the wiki update pass |
| transcripts | The Gemini transcript text of each summarized meeting, kept on the hub only (not synced; the apps search it and read it through the hub) |
| actions | Proposed Slack messages, Linear issues and tasks from a meeting, approved or rejected in Codex |
| people | One row per person, with Slack id, emails and calendar names merged |
| links | Item to person and item to item |
| embeddings | Vector per item and fact |
| jobs, runs | Scheduled jobs and their run history |

Raw Slack and mail text is kept for 90 days; tasks, notes and facts stay.

## Slack and Gmail scans

On weekdays from 07 to 19 the hub reads the work account with Haiku and read-only connector tools. Slack is read
every 15 minutes (DMs, mentions and the watched channels), Gmail every 30 minutes (the inbox, without promotions,
social, updates and forums). Messages and mail that ask me to act become suggested tasks in Tasks under "Is this
yours?", one per Slack permalink or Gmail thread, with the sender and a link back. A suggestion closes itself when I
reply before taking it. Urgent ones are pushed with a Make task action inside the push hours (08 to 17 by default).

The same scan call writes a reply draft for each new ask, in my voice, 2 to 4 sentences in the language of the ask,
kept in the item's `draft` column. For it the model reads the ask's thread and calls a local `ask_context` tool, which
returns up to 3 current wiki claims and 3 meeting decisions of the last 30 days that share at least two key words
with the ask. Nothing is sent: the ask row has Copy draft next to the source link. My own promises get no draft.

Both scans also pick up my own promises ("I'll send it tomorrow") from what I wrote, as suggested tasks labelled
"You said" with the link and a due date when I named one. Once a day the Gmail scan also looks at mail I sent in the
last 14 days and keeps the threads where I asked something and nobody replied for 3 workdays, in one `briefs` row of
kind `waiting`. An entry drops when a reply arrives or after 14 days. The weekly review lists them under Waiting on.
The Slack scan also notes decisions settled in the watched channels, kept on the hub for 14 days; the wiki update
pass proposes the claims they change for Review (see [codex-wiki.md](codex-wiki.md)).

Each scan is off until its config file exists in `~/.agentview/assistant`:

```json
// slack.json
{ "me": "<my Slack user id>", "domain": "<workspace>.slack.com", "channels": ["<channel>"], "push": { "from": 8, "to": 17 } }
// gmail.json
{ "me": "<my work address>", "push": { "from": 8, "to": 17 } }
```

## Devices and access

There are no keys to copy. NetBird is the identity: each device has its own WireGuard key enrolled through SSO, and a
device cannot send traffic as another one's address. The hub answers only NetBird peers, names each request by its
peer (`pixel-9`, `macbook`, `macmini`) and records which device changed an item. Removing a device in the NetBird
dashboard cuts it off. AgentView and the hub share this check (`server/src/http/access.ts`). The hub also refuses
requests from web pages other than the phone app (an Origin or cross-site Sec-Fetch-Site header), so a page open in a
browser on a peer cannot write to it.

The phone's copy is encrypted with an Android Keystore key behind fingerprint unlock. If that key is lost, the app
resets the copy and downloads it again from the hub.

## One app

The web UI is bundled into the phone app, so it opens without a Mac. The Assistant is an activity bar entry next to
Chats and Code. The editor connects to the Mac picked in the Macs switcher and shows offline when none is reachable;
the Assistant is the same everywhere: on the phone it reads the encrypted local copy and syncs with the hub, on a Mac
it goes through the AgentView server to the hub. Today (tasks and the next meeting, swipe to finish or snooze),
Capture (mic and text) and Notes; later notifications with Done and Snooze, a share target and a widget.

## Build order

1. Mini hub: database schema, sync API, launchd services, nightly backup (done)
2. NetBird identity instead of device keys
3. Web UI bundled into the phone app; AgentView accepts the app's requests from NetBird peers
4. Assistant pane in the web app on one data layer (local copy on the phone, the server on a Mac); remove the separate page (done)
5. Device list and reset of a lost phone copy
6. Scheduler on the mini: work Slack, Calendar and Linear feeding Today
7. Meeting notes and action items, facts and search (screens and data model done, see
   [codex-wiki.md](codex-wiki.md); the scheduler fills them)
8. Notifications, share target, widget
9. Personal profile collection
