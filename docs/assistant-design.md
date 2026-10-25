# Assistant design

Proposal for review. The Assistant gets its own place in the main view, next to Chat, on every screen of the app.
The current pane (three bordered tabs, a filter row and a separate Capture form) goes away.

References: the Claude app (chat layout, composer, drawer), Stilla (approve cards for changes to other tools,
meeting canvas, private ask), Granola (my notes vs AI notes, recipe chips), ChatGPT Pulse (a short daily briefing
that ends), Akiflow and Sunsama (one inbox with a source icon per row), Things and Todoist (fast capture, swipe,
undo instead of confirm). Stilla was bought by Meta in September 2026, so it is a pattern source only.

## Where it lives

| Place | What |
| --- | --- |
| Phone tab bar | First tab, "Assistant", with a badge for items due now. Tap opens it, long-press starts voice capture |
| Desktop | Top icon of the activity bar. The main column switches between the Assistant and the current chat; the chat column keeps working beside it |
| Anywhere | ⌘J (desktop) or the capture button opens a capture sheet over the current screen |
| Chats | "Add to tasks" on a chat message, "Ask the Assistant" on a file or PR |
| Android | Share target, home screen widget, notification actions Done and Snooze (step 8) |

The phone tab bar becomes Assistant, Chat, Chats, Agents, More. Files moves into More, next to Terminal.

## Screens

1. Home: briefing plus conversation, composer pinned at the bottom (three options below)
2. Item sheet: the original message quoted, source link, Done, Snooze, Ask
3. Lists in a drawer: Inbox, Today, Meetings, Notes, Jobs, Devices
4. Meeting: my notes, AI summary, action items as approve cards
5. Jobs: schedule, next run, last result, on/off

## Home, three options

### A. Chat first (Claude app)

The briefing is the first assistant message of the day. Everything else is conversation. Lists live in the drawer.

```
┌──────────────────────────────────┐
│ ☰  Assistant          All ▾   ● │
├──────────────────────────────────┤
│ Good morning. 3 things need you. │
│ ┌──────────────────────────────┐ │
│ │ ◷ 10:00 Standup · in 25 min  │ │
│ │   Prep: 2 open PRs, 1 bug    │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ # Reply to Alex on pricing   │ │
│ │   #frontend · 2h          ○  │ │
│ ├──────────────────────────────┤ │
│ │ ◆ ABC-123 review due today ○ │ │
│ └──────────────────────────────┘ │
│                                  │
│              what did I miss in  │
│              #incidents today? ▌ │
│ Two threads. The importer ...    │
│                                  │
├──────────────────────────────────┤
│ [Plan my day] [Prep standup]     │
│ ┌──────────────────────────────┐ │
│ │ + Ask or capture…      🎤  ↑ │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ ✦Assist  Chat  Chats Agents More │
└──────────────────────────────────┘
```

Good: one surface, feels like Chat. Weak: tasks scroll away as you talk.

### B. Today first with a composer (recommended)

A short Today feed that ends (Pulse), composer always at the bottom. Sending a question slides a conversation
sheet up over the feed; closing it returns to Today. Tasks never scroll away.

```
┌──────────────────────────────────┐
│ ☰  Today, Sat 25        All ▾  ● │
├──────────────────────────────────┤
│ NEXT                             │
│ ┌──────────────────────────────┐ │
│ │ ◷ Standup  10:00 · 25 min    │ │
│ │ 2 PRs waiting, ABC-123 open  │ │
│ │ [Start notes]  [Prep]        │ │
│ └──────────────────────────────┘ │
│ NEEDS YOU · 3                    │
│ #  Reply to Alex on pricing    ○ │
│    "can we ship before Fri?" 2h  │
│ ◆  Review ABC-123              ○ │
│    Linear · due today            │
│ ✉  Sign the lease renewal      ○ │
│    Gmail · Personal              │
│ APPROVE · 2                      │
│ ┌──────────────────────────────┐ │
│ │ Post follow-up in #frontend  │ │
│ │ [Approve]  [Edit]  [Dismiss] │ │
│ └──────────────────────────────┘ │
│ That's all for now.              │
├──────────────────────────────────┤
│ [Plan my day] [Missed in Slack]  │
│ │ + Ask or capture…      🎤  ↑ │ │
├──────────────────────────────────┤
│ ✦Assist  Chat  Chats Agents More │
└──────────────────────────────────┘
```

Good: glanceable in two seconds, the composer handles capture and questions. Weak: two layers (feed and sheet).

### C. Inbox triage (Superhuman, Linear inbox)

One item at a time, full width, swipe through to zero. Fast for clearing Slack and mail, poor as a home screen.
Proposed as a mode inside B ("Triage 12" button on the Inbox section), not as home.

```
┌──────────────────────────────────┐
│ ←  Inbox              4 of 12    │
├──────────────────────────────────┤
│ # #frontend · Alex · 2h          │
│                                  │
│ "Can we ship the new pricing     │
│  before Friday? Finance needs    │
│  it for the board deck."         │
│                                  │
│ Suggested: task "Reply to Alex   │
│ on pricing", due today, Work     │
│                                  │
│                                  │
├──────────────────────────────────┤
│ ← Skip   [Make task]   Done →    │
└──────────────────────────────────┘
```

## Item row and sheet

The row holds a source icon, a title, one line of context (quote or reason, channel, person, age) and a round
check. Swipe right for Done, left for Snooze with presets; a snackbar offers Undo. Work and Personal is a thin
colour bar at the left edge instead of a chip.

```
Item sheet (tap a row)
┌──────────────────────────────────┐
│ ▔▔▔                              │
│ Reply to Alex on pricing         │
│ # #frontend · Alex · 2h · Work   │
│ ┌──────────────────────────────┐ │
│ │ "Can we ship the new pricing │ │
│ │  before Friday?"             │ │
│ └──────────────────────────────┘ │
│ Open in Slack ↗                  │
│ Changed on pixel-9 · 09:12       │
│                                  │
│ [✓ Done] [◷ Snooze ▾] [✦ Ask]    │
└──────────────────────────────────┘
```

## Composer

The same component as the Chat composer: + (photo, file, link a meeting), text, mic, send. Plain text is read as
a capture or a question: "call the bank tomorrow 9" becomes a task with the date highlighted as you type; "what did
Alex ask for?" becomes a question. The created item shows as a card with Undo. Recipe chips sit above the field
and change with the time of day (Plan my day in the morning, Wrap up in the evening).

## Stilla walkthrough (2026-10-25)

Read-only pass over the signed-in web app.

| Page | What it is |
| --- | --- |
| Rail | Home, Meetings, Skills, Automations, More (Wiki, Pull requests); notifications and account at the bottom |
| Home | Centred composer ("Tell Stilla what to do"), a two-column grid of recipe rows (Plan my day, Prep for my next meeting, Check my follow-ups, Draft my weekly update, Review my PRs...), each with the source icons it uses. Sidebar: Recents and Folders |
| Meetings | Filters (My meetings, Date) and search at the top, Take notes button with a language menu. Upcoming card with today's date, then past meetings grouped by day: calendar icon, title, time, an "0 of 3" action count, avatars |
| Meeting | Two panes. Left: "Recording stopped on ... by ..." then the agent's thread: a canvas preview card, an approve card per action (Send Slack message with ✕ and ✓), a short reply listing what it could not turn into actions. Composer at the bottom ("Chat with Stilla and others"). Right: the canvas, a document with summary, discussion, decisions and next steps, with comments and version history |
| Canvas with actions | Proposal cards for Linear issues: id, title, text, field chips (team, cycle, state, priority, assignee), View diff, Reject, Update issue |
| Automations | Table: name, trigger, last run, next run, runs, creator, sharing. Detail: health (success rate over 20 runs), average duration, instructions, trigger and model, runs table, and a composer to change it in words |
| Skills | Cards with author, use count, Install. Tabs: Installed, Organization, Discover, Built-in |
| Folders, Canvases | Tables of canvases with a chat bound to the folder at the bottom; sharing and resources in a right panel |
| Wiki | Organisation pages as cards, a recently updated feed on the right, Ask the wiki composer |
| Notifications | Small popover, "You're all caught up" |

Patterns to take: every page has its own composer scoped to that page; the agent's output is a document (canvas)
next to the thread, not inside it; actions are approve cards; meetings list shows open action counts.

## Meetings in Codex

Same split as Stilla, mapped to our layout: the meeting canvas in the main column, the conversation in the right
chat pane (a chat bound to the meeting). On the phone the canvas is the page and the chat opens from a button.

```
Meetings list (Codex sidebar: Today, Upcoming, Meetings, Notes, Done)
┌──────────────────────────────────────────┐
│ Meetings                   🔍  [● Notes] │
│ TODAY                                    │
│ ◷ Standup            10:00-10:15   ○○○ │
│ UPCOMING                                 │
│ ◷ Pricing sync   Tue 14:00-15:00   ○○+4 │
│ PAST · Wed 21 Oct                        │
│ ◷ Edge service    14:00-15:00  0/3  ○○ │
└──────────────────────────────────────────┘

Meeting page (main column; chat on the right is bound to it)
┌──────────────────────────────────────────┐
│ ← Edge service · Wed 21 Oct 14:00   ↗Cal │
│ Ben, Maria, +9          Recorded 46 min  │
├──────────────────────────────────────────┤
│ MY NOTES                                 │
│ - ask Maria about warehouse MCP          │
│ SUMMARY (grey, AI)                       │
│ Gateway handles auth and budgets ...     │
│ DECISIONS                                │
│ - Vendor MCPs connect directly           │
│ ACTIONS · 0 of 3                         │
│ ┌──────────────────────────────────────┐ │
│ │ ✉ Slack to #infra: who owns ...      │ │
│ │              [Edit] [✕] [✓ Approve]  │ │
│ ├──────────────────────────────────────┤ │
│ │ ◆ Linear: Add gateway to SSO         │ │
│ │              [Edit] [✕] [✓ Approve]  │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

## Meetings (earlier sketch)

```
┌──────────────────────────────────┐
│ ←  Standup · 10:00     ● Rec 12m │
├──────────────────────────────────┤
│ My notes                         │
│ - pricing slip to next week      │
│ - ask Ola about importer         │
│                                  │
│ ✦ Summary (grey, AI)             │
│ Pricing moves to Tue. Importer   │
│ alerts owned by Ola.             │
│                                  │
│ ACTION ITEMS                     │
│ ○ Tell finance about Tue  [Add]  │
│ ○ Ola: fix importer alert [Add]  │
│ [Add all]                        │
├──────────────────────────────────┤
│ │ Ask about this meeting…  🎤  ↑ │
└──────────────────────────────────┘
```

My own notes stay in the normal text colour, AI text is grey (Granola). Recording and transcription run on the
phone; nothing joins the call.

## Jobs

```
┌──────────────────────────────────┐
│ ←  Jobs                    + New │
├──────────────────────────────────┤
│ Morning briefing           [on]  │
│ Weekdays 07:30 · next Mon 07:30  │
│ Last: today 07:31, 6 cards ✓     │
│──────────────────────────────────│
│ Slack scan (work)          [on]  │
│ Every 15 min · next 10:15        │
│ Last: 10:00, 2 new items ✓       │
│──────────────────────────────────│
│ Friday Linear summary      [off] │
│ Fri 16:00                        │
└──────────────────────────────────┘
```

New jobs are made from the composer in plain words ("every Friday at 4 summarise my Linear"); the Assistant
answers with an approve card showing the schedule and account.

## Desktop

```
┌──┬─────────────┬──────────────────────────────┬────────────────┐
│✦ │ Inbox    12 │ Today, Sat 25          All ▾ │ Chat: agentview│
│▤ │ Today     3 │ NEXT  Standup 10:00 [Notes]  │                │
│⑂ │ Meetings    │ NEEDS YOU                    │  ...           │
│◎ │ Notes       │ # Reply to Alex         ○    │                │
│▣ │ Jobs        │ ◆ Review ABC-123        ○    │                │
│  │ Devices     │ APPROVE                      │                │
│  │             │ Post follow-up  [Approve]    │                │
│  │             │ ┌──────────────────────────┐ │ ┌────────────┐ │
│  │             │ │ + Ask or capture…  🎤  ↑ │ │ │ composer   │ │
└──┴─────────────┴──────────────────────────────┴────────────────┘
```

The Assistant icon at the top of the activity bar shows the lists in the sidebar and the Today feed in the main
column; the chat stays on the right.

## Visual rules

- No bordered segmented tabs or outline chips in a row; sections are small caps labels in a single scroll
- Rows, not boxed cards, for items; cards only for the next meeting and approve proposals
- Source icons: Slack #, Linear ◆, Gmail ✉, Calendar ◷, capture ✎
- One accent colour for actions; Work and Personal only as the left edge colour
- Empty Today: one line ("Nothing needs you") and two prompt chips

## Open questions

- Recommended: B as home, C as a mode, A's conversation as the sheet B opens
- Agents tab vs Files in the phone bar: this moves Files into More
