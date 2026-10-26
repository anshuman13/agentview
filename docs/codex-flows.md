# Codex flows (draft 2, built)

Goal: one coherent product. Every object has one home, every list answers one question, and everything a meeting
produces ends up where I already look (Today). Draft 2 folds in a product review and a simulated Monday.

## What is wrong today

| Area | Problem |
| --- | --- |
| Meeting actions | Two systems: the meeting page showed approve cards from an actions table nothing fills; the importer wrote tasks that Today hid (source "meeting" counted as a calendar row) |
| Attribution | Things said from a room microphone are not credited to me, so a meeting I led produced zero actions |
| Trust | An empty "My actions" looks the same whether the import failed, has not run, or found nothing for me |
| Lists | Today, Upcoming, Meetings, Notes, Done, Wiki in a drawer. Upcoming, Meetings and Today's Schedule list the same meetings; Notes and Done have no clear job |
| Done | A 7-day list nobody opens; on the phone it was always empty |
| Calendar import | Hourly 8 to 14 on weekdays, so afternoon meetings miss the pre-meeting push and the Next card |

## The model

```
Meeting ──produces──▶ Summary (for me)
   │                  Actions ─ mine, sure ─────▶ Task (open) ─────▶ Today · Needs you
   │                          ─ mine, maybe ────▶ Task (suggested) ─▶ Today · Is this yours?
   │                          ─ no owner ───────▶ Unassigned (meeting page, "Take it")
   │                          ─ someone else ───▶ Others took (meeting page, Ask)
   └── My notes (typed by me) ──▶ read by the extractor, so "ask Kim about X" comes back as a suggestion

Slack / Linear / mail / me ──▶ Task (open) ──▶ Today or Upcoming (by date)
Task: suggested → open → done
      suggested ✗ → "Not mine" on the meeting page (one tap brings it back)
      suggested for 7 days → moves to the meeting's Unassigned, leaves Today
```

One task type. A meeting action is a task with a link to its meeting. Every extracted action lands in exactly one
of four buckets, so "zero for me" is always explained.

## Lists, one question each

| List | Question | Contents |
| --- | --- | --- |
| Today | What needs me now? | Overdue, Next card, Is this yours?, Needs you, Done today row |
| Upcoming | What is coming? | "Later today", then 7 days by day: meetings and dated tasks together |
| Meetings | What happened? | Past meetings only, newest first, with pipeline state; search covers tasks and meetings |
| Wiki | What do I know? | Unchanged |

Cut: the Notes list and the Done list (see decisions below).

## Decisions taken in draft 2

| Topic | Decision |
| --- | --- |
| Notes | No loose-note type. A composer capture becomes a task (undated if no date) or a question to the daily chat. "My notes" live only on the meeting and feed the extractor |
| Done | No list. "Done today · N" row on Today with undo; evening wrap-up; "Draft my weekly update" as an Ask preset that reads this week's done tasks and meeting summaries |
| Room mic | Asked once per meeting, not per action: "Were you on the room mic? [Yes]" converts its actions to mine (sure). Also a toggle on the Next card before the meeting |
| Dismiss | ✗ is never a delete. It moves to "Not mine" on the meeting page, with an undo toast |
| Schedule | Removed from Today. The Next card says "then 14:00 1:1 Kim"; the rest is in Upcoming |
| Meetings list | Past only. The future belongs to Today and Upcoming |
| Counts | "x of y" counts accepted actions only; suggested shown separately as amber "N to review" |
| Push | Only when there is something to act on. Tapping it opens the meeting page. "Nothing for you" is a muted list badge |
| Calendar | Sync on app open plus every 30 min, 07:00 to 19:00 |
| Cut for now | "All ▾" filter and "●" on Today, "Missed Slack" chip, meeting-bound chat (daily chat with the meeting attached instead) |

## Meeting pipeline states

Shown as the badge in the Meetings list and as one line at the top of the meeting page.

| State | Line | Action |
| --- | --- | --- |
| Waiting | "Waiting for transcript · try 2 of 4" | ↻ Sync |
| Processed, for me | "3 for you · 1 to review" | none |
| Processed, none for me | "Nothing for you · 4 others took · 2 unassigned" | Review |
| No transcript | "No Gemini notes found" | Retry · Add actions by hand |

## Flow 1: a meeting from calendar to actions

```
app open / every 30 min   calendar sync ─▶ meeting in Upcoming and the Next card
10 min before             push "Design review in 10 min · 1 open from last time" ─▶ meeting page
before / during           Next card: [Prep] [Take notes] [Room mic is me]
ends                      state Waiting; transcript import every 5 min, up to 4 tries
processed                 push "3 for you from Design review · 1 to confirm" ─▶ meeting page
                          [Confirm all]  or per row ✗ ✓, each row has a date chip
4 tries fail              state No transcript; Today shows one line "Design review: no transcript [Add by hand]"
```

Taps to confirm 3 actions with dates: push 1, Confirm all 1, 3 date chips 3 = 5 (was about 13).

## Flow 2: a normal day

```
08:30  open ─▶ Overdue · 2 (red "2d late"), Next 09:00 standup "then 10:00, 14:00", Needs you · 4
       tap Prep ─▶ daily chat with open PRs and last standup's actions
13:00  "send slides to Kim friday" ─▶ toast "Task · Fri 09:00 · Undo"
       swipe right = done, swipe left = tomorrow 09:00
17:00  Wrap up ─▶ done today, still open, unconfirmed suggestions, tomorrow's first meeting
       [Move open to tomorrow]
Fri    Ask preset "Draft my weekly update"
```

## Wireframes (phone)

### Today

```
┌──────────────────────────────────┐
│ ☰  Good morning, Mon 26          │
├──────────────────────────────────┤
│ Overdue · 2                      │
│  ○ Send budget to Ola   2d late  │
│  ○ Review gateway PR    1d late  │
│ Next                             │
│ ┌──────────────────────────────┐ │
│ │ ◷ 10:00 Design review · 25m  │ │
│ │ Kim, Ola · 1 open from last  │ │
│ │ [✦ Prep] [✎ Notes] [🎙 Me]   │ │
│ │ then 14:00 1:1 Kim           │ │
│ └──────────────────────────────┘ │
│ Is this yours? · Claude rollout  │
│ ┌──────────────────────────────┐ │
│ │ Set up SSO for the team  ✗ ✓ │ │
│ │ Create the Slack channel ✗ ✓ │ │
│ │ [Confirm all]                │ │
│ └──────────────────────────────┘ │
│ 4 older to review ▸              │
│ Needs you · 3                    │
│ ┌──────────────────────────────┐ │
│ │ ○ Build pricing table   Fri  │ │
│ │   ◷ Claude rollout           │ │
│ │ ○ Call the bank              │ │
│ └──────────────────────────────┘ │
│ Done today · 2              ▸    │
├──────────────────────────────────┤
│ [Wrap up my day]                 │
│ │ Add a task or ask…     🎤  ↑ │ │
└──────────────────────────────────┘
```

Suggestions are grouped by meeting. Older than a day collapse into "N older to review"; after 7 days they leave
Today for the meeting's Unassigned.

Empty Today: "All clear · next: Tue 09:00 Standup".

### Meeting page

```
┌──────────────────────────────────┐
│ ←  Meetings               ↗ Cal  │
│ Claude rollout                   │
│ Mon 26 Oct · 09:00-10:00         │
│ Processed 10:12 · 2 for you      │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ Were you on the room mic?    │ │
│ │ 3 actions from it  [Yes, me] │ │
│ └──────────────────────────────┘ │
│ My actions        1 of 2 done    │
│  ○ Build pricing table   [Fri]   │
│  ● Share doc                     │
│ To review · 1                    │
│  Set up SSO …            ✗ ✓     │
│ + Add an action                  │
│                                  │
│ Summary                          │
│ Contract signed. Announcement …  │
│                                  │
│ My notes                         │
│ - ask Kim about training date    │
│                                  │
│ Unassigned · 2 ▸   [Take it]     │
│ Others took · 4 ▸                │
│ Not mine · 1 ▸     [Restore]     │
├──────────────────────────────────┤
│ │ Ask about this meeting… 🎤 ↑ │ │
└──────────────────────────────────┘
```

### Upcoming

```
┌──────────────────────────────────┐
│ ☰  Upcoming                      │
├──────────────────────────────────┤
│ Later today                      │
│  14:00 ◷ 1:1 Kim                 │
│ Tomorrow, Tue 27                 │
│  09:00 ◷ Standup                 │
│  ○ Send slides to Kim     09:00  │
│ Wed 28                           │
│  ○ Build pricing table           │
│ Nothing else this week           │
└──────────────────────────────────┘
```

### Meetings list (past)

```
┌──────────────────────────────────┐
│ ☰  Meetings               🔍     │
├──────────────────────────────────┤
│ Today                            │
│ [09:00] Claude rollout  1 review │
│ [08:30] Standup   nothing for you│
│ Fri, Oct 23                      │
│ [10:00] Weekly sync     1 of 2   │
│ [14:00] Vendor call  no notes    │
└──────────────────────────────────┘
```

Badge priority: no notes / waiting > "N review" (amber) > "x of y" (outline) > "nothing for you" (muted).

## Lookups through Ask

"What did Kim say she would do" is answered by Ask over "Others took" across meetings. No person view for now.

## Missing states to build

- Today loading skeleton, empty state
- Calendar not connected or token expired: banner with Reconnect and last sync time
- Search with no results
- Capture offline: queued, synced later (phone store is local, so this already holds)

## Later

- Home screen widget or quick tile straight to voice capture
- "Waiting on" view per person, if Ask is not enough

## Build plan (checked against the code)

Fix first, these break the flows above today:

1. Next card reads calendar items, which nothing writes any more, so it never shows a real meeting. Build it from
   today's meetings.
2. Old importer tasks (source "meeting", no meeting link) are still hidden from Today. One-time migration on the hub.
3. The phone never re-pulls rows synced before it knew the meeting link. Add a one-time repull.
4. The after-meeting push fires on a 30-minute timer, so it can go out before the import and never again. Send it
   from the import instead.
5. Tries are spent on errors and run 20 min apart, so a transcript later than about 65 min is never read, silently.
   Count only real "doc not found" tries, widen the window, and record a synced pipeline state per meeting.
6. A meeting added Friday afternoon reaches the hub Monday, past the 24 h transcript window. Calendar sync change
   above fixes it.
7. A manual Sync re-runs the model and reworded titles come back as new tasks, including dismissed ones. Pass the
   existing actions to the model and match against them.

Then, by size:

| Size | Work |
| --- | --- |
| Small | Today order; Done today row (by status time, not last edit); drop Done and Notes from the drawer; Upcoming "Later today" and 7-day cap; meeting page order; push wording; calendar hours |
| Medium | Pipeline state column; Unassigned, Others took and Not mine (new extractor fields and a synced column); room mic per meeting; Confirm all and date chips; undo toast |
| Later | Weekly update preset; widget |

## Open questions

- Existing loose notes: convert to undated tasks, or attach to the nearest meeting?
- Should "Room mic is me" become a per-room default once I have said yes in the same room twice?
