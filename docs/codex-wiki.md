# Codex Wiki and Meetings

Codex (the Assistant pane, `web/src/panes/Assistant.tsx`) gets a Wiki and Meetings, modelled on Stilla (see
"Stilla walkthrough" and "Meetings in Codex" in `assistant-design.md`). The wiki is the priority and has to look
good: calm typography, generous spacing, one accent colour, no boxed clutter.

The scheduler agent that writes summaries, extracts claims and sends Slack and Linear actions does not exist yet.
This work builds the screens and the data model with sample data and placeholders; the agent fills the same tables
later.

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
│ │ ✦ Engineering                      │ │   Edge service owns  │
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

- List: search, then Today, Upcoming and Past grouped by day. Row: calendar icon, title, time range, an open action
  count ("0 of 3") when there are proposals, and initials avatars.
- Meeting page (canvas in the main column): back, title, date and time, people, "Recorded 46 min", link to the
  calendar. Sections: My notes (normal text colour, editable), Summary (AI, muted), Decisions, Actions.
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

Client (`web/src/assistant`): the sync engine is generalised from `items` to a table list with per-table fields;
the snapshot gains `pages`, `facts`, `meetings`, `actions`; the phone's local SQLite gets the same tables. Until the
hub has rows, `sample.ts` provides sample data and the screens show a small "Sample" tag.

## Preview and checks

`web/preview.html` renders Codex with an in-memory store of sample data (no server, no hub). Run Vite on port 5188
and screenshot with headless Chrome at 1280x860 and 390x844: `scripts/codex-shot.sh <list> [open-id]`.
Each step runs `npx tsc -p web/tsconfig.json --noEmit`, `npm test`, and the screenshots before its commit.

## Work plan

Progress checklist:

- [x] 1. Write this design doc
- [x] 2. Preview page with an in-memory sample store and the screenshot script
- [x] 3. Data model: hub tables and column migration, client types and sample data
- [ ] 4. Nav entries for Meetings and Wiki, view state module, routing in Codex
- [ ] 5. Wiki index: overview card, sections of page cards, New page card
- [ ] 6. Wiki index: Recently updated feed with contested filter, Ask the wiki composer
- [ ] 7. Wiki page: header, headings, claim rows with sources, dates and anchors, On this page rail
- [ ] 8. Contest and resolve, superseded claims, feed links to claims
- [ ] 9. Wiki search and New page placeholder
- [ ] 10. Meetings list
- [ ] 11. Meeting page with notes, summary, decisions and action approve cards
- [ ] 12. Client sync of pages, facts, meetings and actions (remote and phone local store)
- [ ] 13. Polish: light theme, phone spacing, empty states, keyboard focus
- [ ] 14. Update assistant.md and features.md
