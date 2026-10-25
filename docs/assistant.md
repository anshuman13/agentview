# Assistant

A personal assistant for the phone: a task tracker fed by Slack, meetings, mail and Linear, personal meeting notes,
and a scheduler that runs jobs. It must open instantly on the phone, work offline, keep data on my own devices and
cost nothing per month.

## Layout

| Device | Role |
| --- | --- |
| Mac mini | Hub: the main SQLite database, the sync API and the scheduler, running as launchd services |
| Phone | Full local copy in SQLite, the Assistant screen, voice capture transcribed on the phone |
| Laptop | Client like the phone, plus a nightly copy of the mini's database as a backup |

Devices reach the mini over NetBird. The phone reads and writes its own copy and syncs when the mini is reachable,
so a power cut, an outage or a reboot at home only pauses scans and sync.

## Stack

- Node with `better-sqlite3`, one database file, in the `assistant/` workspace of this repo
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
| facts | Memory: short statements linked to the item they came from; a contradicting fact supersedes the old one |
| people | One row per person, with Slack id, emails and calendar names merged |
| links | Item to person and item to item |
| embeddings | Vector per item and fact |
| jobs, runs | Scheduled jobs and their run history |

Raw Slack and mail text is kept for 90 days; tasks, notes and facts stay.

## Phone

The Assistant screen in the Android app: Today (tasks and the next meeting, swipe to finish or snooze), Capture (mic
and text, saved at once) and Notes. Later: notifications with Done and Snooze, a share target for Slack and Gmail,
a home screen widget. The local copy is encrypted with an Android Keystore key behind fingerprint unlock.

## Build order

1. Mini hub: database schema, sync API, launchd services, nightly backup
2. Phone Assistant screen: Today and Capture on the local copy, on-device voice transcription
3. Scheduler on the mini: work Slack, Calendar and Linear feeding Today
4. Meeting notes and action items, facts and search
5. Notifications, share target, widget
6. Personal profile collection
