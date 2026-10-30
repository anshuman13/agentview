# Features

## Layout

- **Task box** (right): prompt, mode and model menus, context meter, and the timeline below it. An Agents tab at the
  right of its header lists the chat's subagents. ⌥⌘B hides it
- **Editor** (center): File tab follows Claude's edits and shows the diff against HEAD. Markdown files open as a rendered document with an outline, and the preview button shows the source. In the diff, a long press or a right click on a line quotes it into the composer as `path:line`. Browser tab shows your Chrome. Observe, Deploy and MCP open as further tabs here
- **Sidebar** (⌘B): Explorer, Source Control, GitHub Pull Requests, Sessions (open and recent chats) and Workspace (repos, chats, Paseo worktrees)
- **Side chat**: the split icon on a chat row in the Sessions view opens that chat in a second column with its
  own composer (`?beside=<chat id>` does the same); the arrow in its header moves it to the main column
- **Codex** (top of the activity bar): Overview, Tasks, Meetings, Jobs and Wiki, filtered by work or personal
  profile; see [Codex](#codex)
- **Terminal** (bottom, ⌘J): a shell in the chat's folder
- **Share to the app (Android)**: text or a link shared into AgentView asks "Add as task" (saved to Tasks, with a time read from the text) or "Send to chat" (appended to the composer).
- **Phone**: a quick sideways swipe moves between the Codex, Chat, Sessions and Agents tabs, and the new tab slides in from its side; pulling down at the top of Overview, Tasks, Meetings, Wiki or Jobs syncs.
  The done and snooze buttons on Overview rows, Related chips and Remove goal have full-size tap targets
- **Command palette** (⇧⌘P or F1): every view, tab, page, Codex list, model and mode as a searchable list
- **Theme**: the color icon in the status bar cycles Graphite, Dark Modern and Light. With nothing chosen the page
  follows the system setting; `?theme=light` in the URL picks one

## Codex

Codex shows Overview, Tasks, Meetings, Jobs and Wiki for the work profile, the personal profile or both. Under the
nav, the sync line says when the app last synced with the hub, how many changes still wait for the hub, and "Not saved on this device" when the local copy cannot be written. While the hub skips its Slack, Gmail or calendar scan because
that Claude account is at its usage limit, a line below it names the paused scans and the time the limit ends.
When everything is healthy that one line is all the nav shows; clicking it syncs and shows the scan lines. When a scan failed, stalled or is paused, one small
line per source appears below it with the last Slack, Gmail and calendar run, its counts, the error in the warning color,
or "not set up"; Slack and Gmail have a "Scan now" button.

### Overview

- One line per weekly goal with done/total of the tasks linked to it; a line expands to its open tasks, each opening on Tasks; more than 3 goals show +N more
- For each profile with no goals this week and unfinished goals last week, a row offers Carry over to copy their titles and profiles into this week, or Not now to hide the row for the week
- The morning brief the hub writes from 08:00 to 17:00 on weekdays (once a day, late if the hub was down): today's meetings and free time, tasks due, overdue, undated and rolled over, how
  many tasks this week are at risk, Slack asks, Slack promises I made under You said, and meeting actions left from
  the last workday. It shows its title and 3 lines with Show all, folds and hides until tomorrow
- Meetings that ended in the last two hours with their first 3 actions (Open notes for N more), a follow-up draft to copy and the notes
- A Plan strip of free gaps. A tap blocks time for a task due today on the calendar after you confirm the task, start,
  length and title; blocking a task again replaces its earlier event, and blocks show only in the Plan strip, not as
  meetings. The strip shows once a block exists today, otherwise a Plan my day button; Plan my day packs tasks into the free gaps by their estimate (30 minutes without one): tasks linked to this
  week's goals first, due or not, then overdue and due tasks by due time. It shows the plan to trim before Create adds
  the blocks
- Copy standup, shown before 11:00, copies three sections: Yesterday (tasks done and meeting decisions on the previous workday), Today
  (today's meetings and the tasks Plan my day would place, with times) and Blocked (Waiting on items older than two
  days)
- Needs you: one ranked list, shown only when it has rows, that holds overdue tasks, at-risk tasks (due by Friday and
  not fitting in the free work time, with the shortfall), asks and promises to confirm, Slack DMs waiting on me and the
  latest Slack summary's "Needs you" bullets, in that order and each item once. The first 5 show, with Show N more for
  the rest. Tasks have a check and a clock (snooze to tomorrow 09:00, next Monday for work tasks on Friday and Saturday),
  asks the same Mine/Not mine row as in Tasks, DMs Open in Slack, Task and Dismiss, and Slack bullets Task and Done
- Later (folded, count in the header, state remembered): Stale (the 5 oldest tasks untouched for 14 days, with a check and a clock), the follow-through card, Keep in touch and tomorrow's meetings and tasks; hidden when empty
- The next 3 meetings still ahead today with the meeting time left (+N more opens Meetings), and a field on the next meeting's card that adds a
  timestamped line to its notes
- Tasks due today (tomorrow under Later) with a check to mark them done and a clock to snooze them to tomorrow 09:00 (next Monday for work tasks on Friday and Saturday)
- Context (folded like Later): a Slack summary line that opens the Summary page (each chat and Summarize), one line per job report that opens the job, and the digest. Follow-through is meeting actions still open after a week (Task, Done, Dismiss)
- Before 11:00, a card counting meetings, decisions, new claims and open questions since the last visit, until dismissed
- Keep in touch: people I met or DMed on 3 or more days in the last 8 weeks whose time since the last contact is over
  1.5 times their usual gap, most overdue first. Meetings with more than 8 people do not count. A row opens the person
  page and has Copy nudge and Dismiss, which hides the person until the next contact. On a narrow screen the buttons
  wrap below the name

### Tasks

A tap opens the task in place: title and notes are editable for every task, including ones from Slack or a meeting,
with due time, profile, source link, Start, Snooze, Tidy, Copy draft for an ask with a reply draft, Ask and Delete
below; a tap outside closes it and saves. A first line over 120 characters is cut at the last space and the rest goes to the top of the notes. Slack and Gmail promises I made myself show under "You said" next to the
asks under "Is this yours?", where an ask has Copy draft for the reply the scan wrote and Open for its source.
A group of more than one shows Confirm all and Dismiss all, which act on the rows listed in it and offer Undo.
A focused "Is this yours?" row takes y or Enter for Mine, n or Delete for Not mine, and j/k or arrows to move between rows.
The Slack scan does not suggest an ask or promise again when one from the same person and chat with a similar title was
seen, done or dismissed in the last week, nor an ask in a DM where I sent the last message, and it closes that person's suggested DM asks when I sent the last message; an ask answered in the same scan is not saved. The Gmail scan skips an ask or promise from the same sender with a similar title in the same way, and both scans dismiss suggestions nobody reviewed within a week.

- Closed task rows show the due label and the source icon, plus the repeat icon, checklist count and Replied when they apply; the estimate, the "from" day and the notes preview show only in the editor (notes keep their preview)
- Today ends with an Add task button and later days with a small + (its dot switches between work and personal when both are shown), which takes times like
  "friday 10" and stays open for the next one. A bare time like "3pm" in a later day's Add task lands on that day
- Rows with "- [ ]" checklist lines in the notes show how many are ticked, and the open task lists them to tick with a
  tap
- Swiping left names the day the task moves to, and Snooze offers Today for a task due on a later day
- Search (or /) filters tasks by title, notes and people, Overdue has Move to today with one undo, and tasks not
  dragged into an order sort by due time
- Focus timer: Start on an open task shows a bar over Codex with the task, the time so far against its estimate, and
  Stop. Stop adds the whole minutes to the task's time spent, shown as a chip on the task, with an undo. Marking the
  focused task done or deleting it stops the timer and logs the time the same way. One timer
  runs at a time and survives a reload
- An open task without a "~30m" estimate in its title gets one suggested as a chip: the average time spent on at least
  two done tasks whose titles share half their words, rounded to 5 minutes. A tap adds it to the title
- A Repeat menu on an open task sets Never, Daily, Weekdays, Weekly (its due weekday) or Monthly (its due day) by writing or removing the "Repeats:" first line of the notes; other rules show as Custom.
- A goal menu links an open or done task to one of this week's goals of its profile

### Related while writing

Typing in a task's title or notes, a wiki note or a meeting's My notes shows up to 3 matches under the field: current
wiki claims, past meetings and tasks from Slack of the same profile that share at least two key words with the line
being written, most shared words first. A claim or meeting opens in Codex, a Slack task opens its Slack link.

### Meetings

Meetings imports the calendar every half hour and shows notes, summary (pinned text sits under it), decisions, actions and a closed Context fold with talk time and earlier
meetings of the same series, with decisions made and questions asked again; empty notes show a quiet "Add notes" row, and the page has no status line once the transcript is read; the page copies as Markdown or as a
follow-up draft, an action copies as a message or opens a prefilled Linear issue, and the summary format suggests the
template last used for the series. A meeting without a transcript is a quiet, muted "No transcript" (Retry and Dismiss on its page); the hub tries 8 times, or 2 when the previous meeting of the same title had none.

The page of an upcoming meeting has a prep card: points to raise with its attendees (each with a Raised tick), what
they took on last time (earlier meetings of the same profile with the same title or a shared attendee, up to 8 people), my open actions, open questions, and Copy agenda, which copies all of it as a Markdown
checklist without a model call. Raise on a decision or an open task, and the field on a person page, save a point for
the next meeting with that person (picked from the meeting's attendees and recent ones); a point waits for the first
meeting with them after it was raised and counts as raised once that meeting ends. Points stay out of Search.

A person page starts with what waits outside meetings: the first line of their Slack DM summary (full text on hover) with Open in Slack,
one "Waiting on you" list of what they asked you and what you promised them in Slack or Gmail (deduped by source link, each with its age and a Done check that clears it), and your sent mail to them with no reply, then their open tasks (with a Done check, included when the page is copied as Markdown). Below come their
commitments (hidden when there are none), the points to raise with them (included when the page is copied as Markdown), pinned text, meetings and
wiki claims that name them. A section shows its count only when it has more than 5 rows.

The meeting list shows a badge only when something waits for you: actions to review, open actions, Now or soon, or a missing transcript. Rows carry no recording length, repeat icon or topic chips. The header has no Sync calendar button: the calendar syncs on open, on its interval and on pull-to-refresh. The linear and copy buttons on an action row, and an empty Date chip, show on hover or focus on desktop and stay visible on touch.

The header has one segmented control, Decisions (the log, filtered by person), Load or Week, one view at a time:

- Load: hours per week, share recorded, who you meet most, time and actions done per recurring series, and a series
  value audit: meetings, hours, decisions and my actions per series over 8 weeks, with series that brought no decision
  or action of mine in 4 weeks flagged first as Nothing for you lately with the hours they cost; a tap opens the
  latest meeting
- Week: Goals this week, where up to 3 goals per profile are set and renamed (under All, a Work/Personal choice picks the profile), then the week's decisions, new claims,
  tasks done and open meeting actions. Its Review lists done, slipped and stuck tasks and Waiting on by person: waiting
  tasks and sent mail with no reply after 3 workdays, with Copy nudge and Open. The decision log, Week (with Waiting
  on) and person pages copy as Markdown

Saved topics filter the list, show a timeline of matching meetings, decisions and claims, and count what is new since
you last looked. Topics and person pages list questions the meetings left open until you resolve them. Meeting search
also asks the hub, which keeps each transcript's text, and shows the words around a hit in the transcript; a
summarized meeting's page has a talk time strip in the Context fold (each speaker's share of words in the transcript, top five, with the
action and decision counts) and a collapsed Transcript section. The app-wide Search also lists Transcripts hits from
the hub with the meeting's title, date and the words around the hit; offline the group is left out. Search shows 8 hits per group with a Show N more button, and a Tasks and notes hit opens that task on Tasks. Long lists show
50 rows at a time.

### Wiki

The wiki is built from claims with sources, which can be edited, contested and go through Review. The wiki start page shows the first 3 cards of To review (Show N more for the rest) and, in one closed
fold, Needs a look: claims untouched for 90 days (Stale) and claims a later meeting decision may have changed (Maybe changed), unless a
proposed replacement already waits in Review; each list shows 3 rows and +N more. Recently updated shows 5 rows and labels only contested ones. On
desktop a claim shows Cite and Retire on hover or focus; the page header counts claims without the pending ones. For meetings and Slack channel decisions of the last two weeks the hub
proposes the updated claims for Review (again if a meeting is re-synced with different decisions), marked From <meeting> or From #channel (see [codex-wiki.md](codex-wiki.md)).

### Jobs

The Jobs list shows the Work or Personal badge only when the visible jobs belong to both profiles, and shows Off instead of the next run for a disabled job. The Weekly digest preset appears only while the list is empty. A job page has a switch (no On/Off text) and the When section instead of a Next line in the header. Only the latest run shows its output; older runs are one line (time, status, first line) that opens on a click, 5 runs at first.

## Timeline and steering

Claude reports progress through a `set_status` tool added to every chat: current step, finished parts, next steps
and notes. The timeline shows one card per prompt: Claude's final reply, the files changed with line counts,
commands run and the first error of each failed one, commits, subagents, these notes and the steps behind them.
A finished card ends with the turn's cost and how long it took; a chat row in the Sessions view shows the chat's
cost so far. Switch to the transcript for every message and step in order.

- Sending while Claude works stops whatever it is doing, including an open permission or question, and continues
  with your message
- A message is one request to the Mac and lands or fails visibly; it returns to the box after three failed tries
- Editing the next steps sends the new plan at Claude's next tool call, without stopping it
- The composer shows "No update for Ns" when nothing has arrived from the server for 30 s. The link reopens by
  itself after 50 s of silence, and a message that cannot be delivered goes back into the box with a notice
- Questions, plan approvals and permissions show as buttons in the timeline
- Opening a chat with activity since this browser last showed it puts a "Since you last looked" line above the
  cards: turns, files changed, failed commands and whether a permission is waiting. Tap it to dismiss
- "Fork chat" in the chat settings menu (or the palette) starts a new chat that carries the whole conversation so
  far, so two directions can be tried from the same point
- "Rewind files" under the files of a turn puts them back to how they were before that prompt (later turns' edits
  go too); the conversation itself stays

## Review findings

"Ask Claude to review" on a pull request and the inbox's review prompt run `/code-review <number>`. The findings
it reports show up in the pull request's pane, most severe first: a row opens the file on that line, Fix sends
the finding to the chat, Dismiss hides it for good (kept per repo in `~/.agentview/findings.json`). "Review changes
with Claude" in the Changes view and "Review changes" under the files of the latest turn run `/code-review` on the
working tree; those findings show at the bottom of the Changes view.

A pull request Claude opened with `gh pr create` stays linked to its chat: the pull request row shows "Open chat"
while that chat is open.

## Context

The meter shows the tokens in context and turns red past 200k. AgentView then runs `/compact` when the turn ends.
A failed compact is retried once the context has grown by another 20k tokens.

## Models

New chats start in Auto mode: Claude asks only before risky actions.

**Team** in the model menu: Opus 5.5 plans each task, Sonnet 5.5 builds it and asks Opus for advice. Advisor calls
re-read the conversation, so they cost more in long chats. When the chat cannot switch to plan mode, the message
waits in the queue with a notice.

Any chat can ask Fable 5.1 about a hard problem. Each call needs your approval.

**Effort** in the same menu (or the palette) sets how hard the model thinks, from low to max, per chat. New chats start at medium. The footer
pill shows the current level next to the model.

## Workspace

Repos come from `~/workspace` and `~/workspace_personal`. Set `AGENTVIEW_ROOTS` (colon-separated) to change that.
Chats start only inside these folders or Paseo worktrees.

- Chats keep running in the background. Ones that need you are marked and listed first
- Failing CI on your pull request shows under Needs you, and a fix chat starts by itself, once per pushed
  commit; the item then says "Fixing in" with the chat and opens it. `autofix` in `~/.agentview/attention.json`
  limits that to the listed repo names, `false` turns it off
- A chat closes after 10 idle minutes with no one viewing it. Reopen it from Recent
- Chats and Paseo worktrees idle for 12 hours can be deleted (worktree branches are kept)

## Notifications

When a chat asks a question, needs a permission or finishes a turn, AgentView notifies you. On the Mac the server
shows a system notification with a sound if no window is viewing that chat, at most one per chat every 30 seconds;
clicking it opens that chat in the browser (a GitHub item opens the Sessions view).
The browser shows its own notification while the tab is hidden; clicking it opens the chat. The bell in the status
bar turns browser notifications on or off.

For a phone in the background, the same notifications can go to an [ntfy](https://ntfy.sh) topic. Push is off
until you set `AGENTVIEW_NTFY`, or `ntfy` in `~/.agentview/observe.json`, to a topic name or a full URL on your own
server, then subscribe to it in the ntfy app. Tapping the push opens the chat. The assistant hub uses the same topic for meeting and task reminders and the 08:00 morning brief; it sends no reminders from 17:00 to 08:00, and tasks that fell due overnight go out with the first morning check. Tasks of one profile that come due in the same check go out as one "N work tasks due" (or personal) push (first 5 titles, then "+N more") with no Done or Snooze; a single due task keeps both. A meeting that started up to 5 minutes ago still gets its heads-up ("starts now"), so an 08:00 meeting is covered. Open tasks roll to today each day, but only weekday rolls count toward sending a task back to review after 3.
Urgent Slack and Gmail asks that arrive while a calendar meeting runs (not all-day events, time blocks or
events with no other attendees) are held
and sent as one push, "N urgent while you were in <meeting>", within a minute after it ends. Asks you accepted
or dismissed meanwhile are left out, and a queued push for an ask you already reviewed is dropped.

A chat that runs for 15 minutes without sending anything is reported once the same way and gets a slow yellow dot
in the chat list until its next message.

## Loop mode

The loop pill in the composer turns a prompt into a plan, build, test cycle. Opus plans in plan mode, detailed
enough that someone who missed the conversation could build from it, and starts building as soon as the plan is
ready. A plan that deletes data, changes a schema, auth or security, reaches outside the repo, pushes or deploys,
or guesses at an open question waits for your approval instead, and rejecting it stops the loop. Sonnet then tests the result as a separate model and ends with a verdict, and
Opus fixes whatever the tester found, up to the number of rounds you pick. Phases show as violet markers in the
timeline and transcript, the composer footer shows the current phase and round, and Stop ends the loop. Claude
exiting during a step ends it too.

## Personal and work Claude accounts

`./claude-alt.sh` sets up `~/.claude-alt` for the work Claude login next to the personal one in `~/.claude`. It shares settings, skills, plugins and chat
history with `~/.claude` and keeps its own login; log in once with `CLAUDE_CONFIG_DIR=~/.claude-alt claude` and
`/login`. When a turn ends on a usage limit, the chat moves to the other account and continues where it stopped,
and new chats start there until the limit resets. The composer menu shows the account (Personal or Work) and switches it by hand. The status bar shows the account with
its weekly and 5-hour usage as `w25 h15`, and the even weekly pace (100/7 % a day, to the hour) on hover. When the
week is ahead of that pace or either window passes 80%, it turns yellow and a click switches the chat to the other
account. A switch restarts the Claude process, so Claude recreates the chat's scheduled jobs in the new one.
Only the CLI's own usage-limit notice counts as a limit, so a reply that mentions a rate limit does not switch.
Before a new chat starts, a limit mark is checked against the account's live usage, at most every 5 minutes and
without sending a prompt. The mark is cleared when the 5-hour and weekly windows are under 100% and no per-model
weekly window is full; a failed check keeps it.

## Loops

`/loop 10m <prompt>` sends the prompt again every 10 minutes, `/loop until 07:00 <prompt>` sends it again as soon
as each round ends until that time, `/loop 30m until 07:00 <prompt>` combines the two, and `/loop at 01:50 <prompt>`
sends it once at that time. When a turn ends on a usage limit, the timeline shows the reset time and a "Continue at
HH:MM" link that schedules the last prompt that way. A fire that lands while
Claude is still working waits for the round to end. The loop lives in the AgentView server, so it survives a server
restart and never depends on the CLI's own scheduled jobs. Your messages and Stop interrupt the current round but
keep the loop; `/loop off` ends it. The composer footer shows the round and the next fire time; tap it to stop.

`/goal <condition>` asks Claude to check the condition whenever it goes idle and to keep working until it is met.
Claude replies GOAL MET to end it; the check also stops by itself after 20 rounds. `/goal off` ends it early, and
the footer shows the check count the way it shows loop rounds.

## Agents

The Agents tab in the task box header lists the subagents of the chat with their status, elapsed time and tokens.
Click one for its report, prompt and steps. On the phone it is a tab of its own.

## Deep links

`?view=github` opens a sidebar view (explorer, changes, github, chats, sessions), `?page=observe` opens a page
(observe, deploy, mcp), `?chat=<id>` opens a running chat and `?session=<id>` reopens a saved one. The parameters
are read once and removed from the address bar.

## Pages

Observe, Deploy and MCP Servers open as tabs in the editor area (the lower three activity bar icons, or the command
palette), so they get the full width instead of the sidebar. One page is open at a time; opening another replaces it.

## Shortcuts

⌘ on a Mac, Ctrl elsewhere. Letter shortcuts stay out of the way of text fields. Closing a task, an inline editor
or a page puts focus back on what opened it.

| Key | Action |
| --- | --- |
| ⌘O | Start a chat in a repo |
| ⌘P | Open a file |
| ⇧⌘P or F1 | Command palette |
| ⌘B | Toggle the sidebar |
| ⌥⌘B | Toggle the task box |
| ⌘J | Toggle the terminal |
| ⌘E | Switch between file and browser |
| ⌘K | Clear the terminal |
| Enter | Send; Shift+Enter for a new line |
| Tab | Accept the suggested command or the ghost text |
| Shift+Tab | Cycle the permission mode |
| ↑ / ↓ | Step through sent prompts when the box is empty |
| Esc | Close a popup or clear a filter |
| y / n / a | Allow, deny or always allow the top permission card |
| 1-9 | Pick an answer on the top question card |
| ⌘Enter | Commit in Source Control; run the query in Observe |
| j / k | Move between tasks in Tasks; Enter or Space opens, Esc closes, x done (or back to open on a done task), s snooze, Delete removes |
| n / | New task for today (opens Tasks from Overview or other Codex pages); search tasks (on Tasks) |

## Keyboard and screen readers

- A screen reader hears when Claude finishes a turn (its last reply, or the error it stopped on) and when it asks a
  question or for a permission, not every streamed word
- Answering a question or permission card moves focus to the next card, or to the composer after the last one
- The composer is labeled and its suggestion list is a listbox. The command palette, the file picker and the other
  pickers (repo, model, saved prompts) list results as listboxes; closing a picker or a confirm dialog returns focus
  to where it was
- Transcript steps, open editors, Source Control rows, terminal tabs and the collapsible sections in the ops panes open
  with Enter or Space. The file tree is a tree: arrow keys move, Right and Left open and close folders, Enter opens
- Errors and deploy progress in the Observe, Deploy, GitHub and MCP panes are announced; closing a detail there
  returns focus to the list
- In Codex, snack messages are announced, with "Undo available" when they have Undo. Goals, Keep in touch, Related
  and the Slack DMs under Since <meeting> are lists, and Esc in a goal field restores its text. Dismissing a person
  in Keep in touch focuses the next one; when Dismiss removes a whole Overview section, focus moves to the next
  control below it, or to the page heading
