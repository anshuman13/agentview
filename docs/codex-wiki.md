# Codex Wiki and Meetings

Codex (the Assistant pane, `web/src/codex/Codex.tsx`) gets a Wiki and Meetings, modelled on Stilla (see
"Stilla walkthrough" and "Meetings in Codex" in `assistant-design.md`). The wiki is the priority and has to look
good: calm typography, generous spacing, one accent colour, no boxed clutter.

The scheduler agent that writes summaries, extracts claims and sends Slack and Linear actions does not exist yet.
This work builds the screens and the data model; the agent fills the tables later. Until then the screens are empty.

## Navigation

The Codex sidebar (desktop) and drawer (phone) become: Today, Upcoming, Meetings, Wiki, Notes, Done, then "Coming
next" with Jobs and Devices. Opening a wiki page or a meeting keeps the list selected and shows a back arrow in the
header. The view state (`list`, `open` id) lives in a small module shared by the nav and the pane.

## Wiki index

```
Desktop (main column ≥ 880px wide)
┌───────────────────────────────────────────────┬──────────────────────┐
│ Wiki                              🔍  + New   │ RECENTLY UPDATED  2⚑ │
│ ┌───────────────────────────────────────────┐ │ ● Platform           │
│ │ ✦ Engineering                             │ │   Edge service owns  │
│ │ What the team runs, who owns what, ...    │ │   auth and budgets   │
│ │ 6 pages · 48 claims · updated 2h ago      │ │   Meeting · 2h       │
│ └───────────────────────────────────────────┘ │ ⚑ Pricing            │
│ TEAMS                                         │   Prices ship Tue    │
│ ┌──────────────┐ ┌──────────────┐ ┌────────┐  │   contested · 1d     │
│ │ Platform     │ │ Data         │ │ + New  │  │ ...                  │
│ │ Gateway, MCP │ │ Importer ... │ │  page  │  │                      │
│ │ 3 Oct        │ │ yesterday    │ │        │  │                      │
│ └──────────────┘ └──────────────┘ └────────┘  │                      │
│ PROJECTS                                      │                      │
│ ...                                           │                      │
│ ┌───────────────────────────────────────────┐ │                      │
│ │ ✦ Ask the wiki…                       ↑   │ │                      │
└─┴───────────────────────────────────────────┴─┴──────────────────────┘
```

- Header: title, search (filters cards and claims by text), "New page" (placeholder: creates an empty page).
- Overview card: the organisation page, wider, with a soft accent wash, its summary and counts.
- Sections (small caps label) of page cards in a responsive grid: title, two-line summary, updated date, a small
  contested marker when the page has contested claims. The last card in each section is a dashed "New page".
- Right column: "Recently updated", a feed of the latest claims (added, superseded, contested) with the page name,
  the claim text clamped to two lines, source icon and age. A pill shows the contested count and filters the feed
  to contested claims. Clicking an entry opens the page scrolled to that claim.
- "Ask the wiki" composer pinned at the bottom; it opens a chat with the wiki claims as context (the existing
  `ask()` path), so it works before the scheduler exists.
- Narrower than 880px (container query) the feed moves below the sections.

## Wiki page

```
┌───────────────────────────────────────────────┬──────────────────┐
│ ← Wiki / Teams                                │ ON THIS PAGE     │
│ Platform                                      │ Ownership        │
│ Runs the agent gateway and the MCP servers.   │ Runbooks         │
│ Updated 2h ago · 14 claims · 1 contested      │ Decisions        │
│                                               │                  │
│ OWNERSHIP                                     │ SOURCES          │
│ Edge service owns auth and budgets for     ¶  │ ◷ 5 meetings     │
│ every MCP call.                               │ # 4 Slack        │
│ ◷ Edge service sync · # #infra · 21 Oct  ⚑    │ ◆ 3 Linear       │
│                                               │ ⑂ 2 PRs          │
│ Vendor MCPs connect directly.                 │                  │
│ ◷ Edge service sync · 21 Oct                  │                  │
│   ̶V̶e̶n̶d̶o̶r̶ ̶M̶C̶P̶s̶ ̶g̶o̶ ̶t̶h̶r̶o̶u̶g̶h̶ ̶t̶h̶e̶ ̶g̶a̶t̶e̶w̶a̶y̶  superseded 21 Oct │                  │
│                                               │                  │
│ ┃ Budgets reset monthly.            Contested │                  │
│ ┃ "They reset weekly since October" (you)     │                  │
└───────────────────────────────────────────────┴──────────────────┘
```

- Header: breadcrumb back to the index and section, title, summary as a lede, meta line.
- Claims grouped under headings. A claim row is one sentence in body text, then a quiet line of source chips
  (icon and label; meeting, Slack channel, Linear id, PR number; links open the source) and the date.
- Hover (desktop) or tap (phone) shows the anchor ¶ (copies a link to `#claim-id`) and Contest.
- Contest opens an inline field for a reason; the claim gets an amber edge, a "Contested" label and the reason
  with who and when. "Resolve" clears it.
- A superseded claim is shown struck through and faint under the claim that replaced it, with its date.
- Right column (desktop): "On this page" heading links and a source count summary. On the phone it is hidden.
- Ask composer scoped to the page ("Ask about Platform").

## Meetings

- List: search (titles, people, notes, summaries, decisions, and transcript text on the hub with a snippet of the hit), then Today, Upcoming and Past grouped by day. Row: calendar icon, title, time range, an open action
  count ("0 of 3") when there are proposals, and initials avatars.
- Meeting page (canvas in the main column): back, title, date and time, people, "Recorded 46 min", link to the
  calendar. Sections: My notes (normal text colour, editable), Summary (AI, muted), Decisions, Actions. A meeting with
  a stored transcript shows Talk time: a bar of the top five speakers' share of words ("Name: text" lines or a name
  line before its text), with the action and decision counts.
- Action approve card: kind icon (Slack ✉, Linear ◆, task ✓), target, title, body, Linear field chips; buttons
  Edit, Reject (✕) and Approve (✓). Approve marks the action approved; the card says "Sends when the scheduler
  runs" until the agent exists. Rejected cards collapse to one line with Undo.
- On the phone the canvas is the page; the composer at the bottom asks about the meeting.

## Phone layout

Single column. Header with the drawer button, title and actions. Wiki index: overview card, sections as a one
column list of compact cards, "Recently updated" after the sections, composer pinned at the bottom. Page: claims
full width, actions always visible as small icons. Meetings and meeting page stack the same way.

## Data model

Hub tables in `assistant/src/db.ts` (synced like `items`: per-field last-write-wins, version per row). `openDb`
adds missing columns to existing tables, so the change is additive. The running hub picks the tables up at its
next restart.

| Table | Columns | Notes |
| --- | --- | --- |
| pages | title, section, summary, sort | Wiki pages; section "overview" is the organisation card |
| facts | text, item_id, superseded_by, page_id, heading, sources, at, contested | A claim. `sources` is JSON `[{kind, label, url}]`; `contested` is JSON `{by, at, note}` or null; `superseded_by` is the newer claim's id |
| meetings | title, starts_at, ends_at, people, calendar_url, recorded_ms, notes, summary, decisions | `notes` are mine, `summary` and `decisions` (JSON list) come from the agent |
| actions | meeting_id, kind, target, title, body, fields, status, result_url | `kind` slack, linear or task; `status` proposed, approved, rejected, sent |

Client (`web/src/codex/data`): the sync engine is generalised from `items` to a table list with per-table fields;
the snapshot gains `pages`, `facts`, `meetings`, `actions`; the phone's local SQLite gets the same tables.

No data goes in the code: this repo is public, so there is no sample data or fixture of real content.

## Work plan

ALL DONE

Progress checklist:

- [x] 1. Write this design doc
- [x] 2. (removed) Preview page
- [x] 3. Data model: hub tables and column migration, client types
- [x] 4. Nav entries for Meetings and Wiki, view state module, routing in Codex
- [x] 5. Wiki index: overview card, sections of page cards (New page card moved to 9)
- [x] 6. Wiki index: Recently updated feed with contested filter, Ask the wiki composer
- [x] 7. Wiki page: header, headings, claim rows with sources, dates and anchors, On this page rail
- [x] 8. Contest and resolve, superseded claims, feed links to claims
- [x] 9. Wiki search and New page placeholder
- [x] 10. Meetings list
- [x] 11. Meeting page with notes, summary, decisions and action approve cards
- [x] 12. Client sync of pages, facts, meetings and actions (remote and phone local store)
- [x] 13. Polish: light theme, phone spacing, empty states, keyboard focus
- [x] 14. Update assistant.md and features.md

## Claude proposes claims

Any chat can propose memory and wiki claims on its own judgement; nothing goes live until I approve it in Codex.
The data lives only in the hub database, never in this repo.

### Tools

The in-process `agentview` MCP server in `server/src/agent/claude/options.ts` gets wiki tools next to
`set_status`. They read and write the hub through its `/sync` API (`HUB` in `server/src/integrations/assistant.ts`).

| Tool | Does |
| --- | --- |
| `wiki_search(query)` | Pages and claims matching every word, with state (live, proposed, rejected); Claude calls it before proposing |
| `wiki_page(id)` | One page's live claims by heading |
| `wiki_propose(text, sources, page?, heading?, replaces?)` | Proposes a one-sentence claim. No page means memory. `replaces` names a live claim it would supersede. `page` can be an existing id or a new title and section |

There is no delete or edit tool; contest, resolve and delete stay with me.

### Rules in the system prompt

Propose facts that stay true: decisions, ownership, how a system works, people and my preferences. One sentence,
with a source (the chat link, plus Slack, Linear or PR links when known). Search first; do not repeat a live,
proposed or rejected claim; use `replaces` when a claim contradicts a live one. Never propose secrets, credentials,
tokens or file contents.

### Profile

Work by default. Personal for personal life (events, family, health, money) and for personal projects: a chat whose
folder is under `~/workspace_personal` (such as agentview) proposes personal claims. The tool picks the profile from
the chat's folder; Claude can mark a claim personal when it is about my personal life.

### Data model

| Table | New columns | Notes |
| --- | --- | --- |
| facts | state, replaces, added_by | `state` proposed, live or rejected (null means live, so existing rows stay live); `replaces` is the live claim a proposal would supersede; `added_by` is `claude:<chat id>`, `meeting:<id>`, `slack:<id>` or `you` |
| pages | state | A page Claude proposes is `proposed` until a claim on it is approved |

Approving a claim sets it live, makes its proposed page live, and sets `superseded_by` on the claim it replaces.
Rejecting keeps the row as `rejected` so Claude sees it in `wiki_search` and does not propose it again.

### Review in Codex

- Wiki index: a "To review" section above the sections with a count, one approve card per proposal: the claim,
  target page and heading (or Memory), what it replaces (struck through), sources, the chat it came from. Buttons
  Edit, Reject and Approve, as on the meeting action cards. Rejected cards collapse with Undo.
  Proposals on a live page are grouped into one card per page, except ones that replace a claim, which get their own
  card so the old text shows.
- The nav shows the review count next to Wiki.
- A "Memory" card in the index lists live claims without a page.
- Live claims Claude proposed show a small "Claude" source chip linking to the chat.

### Updates from meeting decisions

The transcript import saves each meeting's decisions. Every 5 minutes the hub looks at meetings of the last 14 days
with decisions, once per meeting (meta key `wikiupdate:<profile>:<id>`). A claim is a candidate when it is current, on
a live page, older than the meeting, and a decision shares two key words with it while the decision or meeting title
names the page (the "Maybe changed" rule, in `shared/claimMatch.ts`). For a meeting with candidates one Haiku call on
the profile's account, with only a save tool, writes a replacement ("As of <date>, ...") for each claim the decisions
change. Each is saved as a proposed claim with `replaces`, a meeting source and `added_by` `meeting:<id>`, unless the
same text already replaces that claim. Its review card says "From <meeting title>". A meeting stopped by the usage
limit is tried again on the next run.

Slack decisions go the same way. The Slack scan also returns decisions settled in the watched channels (a short line,
the channel, the permalink and the time), kept once per permalink and line in the hub-only `slack_decisions` table for
14 days. Each one is looked at once (meta key `wikiupdate:work:slack:<id>`), with the channel name in place of the
meeting title, in the same queue and limits as meetings. Its proposals have a Slack source with the permalink and
`added_by` `slack:<id>`, and the review card says "From #channel".

### Steps

- [x] 15. Columns `state`, `replaces`, `added_by` and pages `state`; client types; proposed and rejected rows hidden from pages, feed and search
- [x] 16. Server hub helper and `wiki_search`, `wiki_page`
- [x] 17. `wiki_propose` with profile from the chat folder, and the prompt rules
- [x] 18. To review section with approve cards, nav count, Memory card, Claude chip
- [ ] 19. Check in Chrome: a chat proposes, I approve on desktop and on the phone
