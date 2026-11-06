# Features

## Layout

- **Task box** (right): prompt, mode and model menus, context meter, and the timeline below it. An Agents tab at the
  right of its header lists the chat's subagents. ⌥⌘B hides it
- **Editor** (center): File tab follows Claude's edits and shows the diff against HEAD. Markdown files open as a rendered document with an outline, and the preview button shows the source. In the diff, a long press or a right click on a line quotes it into the composer as `path:line`. The pencil in the file bar turns the file into an editor; Save or Cmd+S writes it back (project files only, never inside credential folders). Gitignored `.env` files show in the explorer without the eye toggle. Browser tab shows your Chrome. Observe, Deploy and MCP open as further tabs here
- **Sidebar** (⌘B): Explorer, Source Control, GitHub Pull Requests, Sessions (open and recent chats) and Workspace (repos, chats, Paseo worktrees). In Workspace a repo with no live chat starts folded to its header, and a repo shows its 5 latest chats with Show more. The search box in both views finds chats by every word of the query across title, first prompt, repo and (Workspace) branch
- **Side chat**: the split icon on a chat row in the Sessions view opens that chat in a second column with its
  own composer (`?beside=<chat id>` does the same); the arrow in its header moves it to the main column
- **Pinned chats**: the pin icon on a chat row in the Sessions view keeps that chat in a Pinned group above the repos (newest pin first, also shown in Needs you while waiting). Pins are stored on the Mac in `~/.agentview/pins.json`, so every device sees them after its next reconnect or reload; deleting or binning a chat drops its pin
- **Codex** (top of the activity bar): Overview, Tasks, Meetings, Jobs and Wiki, filtered by work or personal
  profile; see [Codex](#codex)
- **Terminal** (bottom, ⌘J): a shell in the chat's folder
- **Share to the app (Android)**: text or a link shared into AgentView asks "Add as task" (saved to Tasks, with a time read from the text) or "Send to chat" (appended to the composer).
- **Phone**: a quick sideways swipe moves between the Codex, Chat, Sessions and Agents tabs, and the new tab slides in from its side; an open meeting action swipes right for Done and left to Not mine (Dismissed on Overview); pulling down at the top of Overview, Tasks, Meetings, Wiki or Jobs syncs. The interval sync runs only while the app is visible. The tab bar shows a count only on Chat (waiting); Sessions (waiting elsewhere) and Agents (running) show a dot.
  The done and snooze buttons on Overview rows, Related chips and Remove goal have full-size tap targets
- **Command palette** (⇧⌘P or F1): every view, tab, page, Codex list, model and mode as a searchable list; pinned chats are listed first as "Chat: <title>" and open that chat
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

- Above the Reply queue, one row counts the asks older than 3 days ("N asks older than 3 days", with the oldest age); tapping it filters the queue to them (see Reply queue below)
- One line per weekly goal with done/total of the tasks linked to it and a thin progress bar; a goal whose open tasks' estimates (or 30 minutes each), summed, exceed the free work time left this week (today from now through Friday, 08:00-17:00, minus that profile's meetings and focus blocks; none on the weekend) is marked At risk; a line expands to its open tasks, each opening its task page; goals with all linked tasks done drop off; more than 3 goals show +N more
- For each profile with no goals this week and unfinished goals last week, a row offers Carry over to copy their titles and profiles into this week, or Not now to hide the row for the week
- From Friday 14:00 through Sunday (browser local time), a folded "Weekly review" card per profile (none for a profile with no goals and no done tasks this week) lists this week's goals with done/total and Done or Missed (Missed: open tasks left or no linked tasks), tasks done this week and meeting hours; Carry over creates the Missed titles as goals next Monday, skipping titles already there (case and spacing ignored), up to the limit of 3 goals in next week ("K not carried (limit 3)" for the rest; "Carried over N" once they are there); the cross hides the card until tomorrow
- The morning brief the hub writes from 08:00 to 17:00 on weekdays (once a day, late if the hub was down): today's meetings and free time, tasks due, overdue, undated and rolled over, how
  many tasks this week are at risk, Slack asks oldest first with who and age (older than today under Waiting from yesterday or older), Slack promises I made under You said, and meeting actions left from
  the last workday; a note left at the last wrap-up opens it as Yesterday you noted (Monday also shows Saturday's and Sunday's). The hub's 17:00 day digest of Slack replies and the away digest are Report cards of their own: count badges and the time in the header, then one group per outcome (failed or escalated open, the rest folded behind their count with the first 3 rows and Show all), each row opening the task with an open icon for the Slack link, and an N waiting line that scrolls to the Reply queue. Fold state is kept per card and group; the cross hides one card until tomorrow, and a digest written before rows existed is not shown. The morning brief keeps its folded text card
- Meetings that ended in the last two hours with their first 3 open actions (suggested ones wait in Do now) (Open notes for N more), a follow-up draft to copy and the notes
- A Plan strip of free gaps. A tap blocks time for a task due today on the calendar after you confirm the task, start,
  length and title; blocking a task again replaces its earlier event, and blocks show only in the Plan strip, not as
  meetings. The strip shows once a block exists today, otherwise a Plan my day button; Plan my day packs tasks into the free gaps by their estimate (30 minutes without one): tasks linked to this
  week's goals first, due or not, then overdue and due tasks by due time. It shows the plan to trim before Create adds
  the blocks
- From 16:00 one Wrap up row with today's done and open counts and Move all to tomorrow; its header (not remembered) opens the first 5 open tasks to move, snooze or drop, with +N more expanding in place; a Note for tomorrow line under Move all saves on Enter or leaving it, one per profile and day (the filter's profile, work for All), and clearing it deletes the note
- The Overview ask bar shows one chip when empty: Prep next meeting within an hour of one, Draft my weekly update on Thursday and Friday afternoons, otherwise Plan my day, What's next or Wrap up my day
- Copy standup, shown before 11:00 and after that as a row in the Context fold, copies three sections: Yesterday (tasks done and meeting decisions on the previous workday), Today
  (today's meetings and the tasks Plan my day would place, with times) and Blocked (Waiting on items older than two
  days)
- Later and Context on Overview are rows of one grouped card that open in place
- Under the Overview greeting, one line with the meetings left, tasks due and overdue count today, or Nothing due today (Weekend, nothing due today on Saturday and Sunday)
- Do now: one ranked list of what to work on, top of the page. The order is: the next meeting when it starts within two hours (Prep),
  tasks due today flagged High or Medium, then Needs you (overdue tasks, at-risk tasks due by Friday that do not fit the free
  work time, asks and promises to confirm, Slack DMs waiting on me, the latest Slack summary's "Needs you" bullets, each once,
  three or more overdue collapsing into Clear N overdue with Move to today), then the rest of today's tasks by priority and
  time. The first card, when it is an open task, has a Focus button. With nothing to do today it sums up the next day with tasks instead of listing them: a few sentences on what to get
  done that day, which the hub writes with Haiku when nothing work is open today (again when that day's tasks or meetings
  change, at most hourly), then big counts (tasks with estimated time, meetings with their time, first meeting) and a Start
  with row for the top task, in one card under that day's name. On a weekend with things to do the list is titled When you
  are back and drops the red numbers; the next day's summary sits above it on a
  weekend and below it on a weekday. The first three are numbered cards (red number when late, waiting or
  about to start) with the thing to do, why and its source, and one action: Done (or Tomorrow) for tasks, Reply (or Handled)
  for Slack and DMs, Mine (or Not mine) for asks. The rest follow under Then with one action each (task rows also swipe right for Done, left for Tomorrow), 5 shown, Show N more
- A meeting starting within 15 minutes or running shows its full card under Now above Do now, with prep, a note field and the room mic toggle
- Later (folded, count in the header, state remembered): Stale (tasks untouched for 14 days that are not overdue, meeting actions or due by tomorrow, oldest first, with a check and a clock), the follow-through card (meeting actions still open after a week: Task, Done, Dismiss), Keep in touch and tomorrow's tasks; hidden when empty. Every list of more than 5 rows in Later and the task lists shows +N more that expands in place, then Show fewer. All folds use one header, Title N, and the meeting page folds (Unassigned, Others took, Not mine) start closed each visit
- The next 3 meetings still ahead today with the meeting time left (+N more opens Meetings), and a field on the next meeting's card that adds a
  timestamped line to its notes
- From 17:00 a Tomorrow card follows Wrap up: tomorrow's meetings and tasks (5 shown, +N more), counts, free work time, and Plan tomorrow (not on weekends), which previews and creates Focus blocks for tomorrow's unblocked tasks like Plan my day; close hides it until the next day. While it shows, Later and Do now leave out their Tomorrow blocks
- Meetings show on Overview only when running or starting within two hours; the Meetings page has the rest. When Do now falls back to the next day's tasks and that day is tomorrow, Later leaves out its Tomorrow block
- Context (folded like Later): a Slack summary line that opens the Summary page (a TickTick-style report with Date (Today, This week, Last week, This month) and Status (All, Completed, Not completed) rows, Completed and Not completed lines that open the task, and a Copy button for Markdown; below it a link to the Slack asks to review; the 8 latest chats with a summary in the range, Show N more; the Sonnet summary folded to 8 lines; and Summarize), one line per job report that opens the job, and the digest
- Reply queue: each ask is one row with its title, person and age, a state badge (Needs you or FAQ), the draft clamped to 2 lines, and Send plus a More menu (Edit, History, Open thread, Skip). History shows the last 3 replies sent to that person (date and first line, newest first), loads when first opened and reloads after a reply to that person goes out. Send all FAQ answers and Copy access and limit requests sit in the section header. Asks older than 3 days also show as one row above the queue ("N asks older than 3 days", oldest age): tapping it filters the queue to them, with an Older than 3 days chip that clears the filter and Dismiss all N in place of the batch buttons. Dismiss all keeps the drafts, sends nothing and shows one Undo.
- Before 11:00, a card counting meetings, decisions, new claims and open questions since the last visit, until dismissed
- Keep in touch: people I met or DMed on 3 or more days in the last 8 weeks whose time since the last contact is over
  1.5 times their usual gap, most overdue first. Meetings with more than 8 people do not count. A row opens the person
  page and has Copy nudge and Dismiss, which hides the person until the next contact. On a narrow screen the buttons
  wrap below the name. Each row has a one-line field, "Talk about next time": Enter saves the text as a Raise point for
  that person (so it shows on Prep for their next meeting), the field clears for another, and the row meta shows
  "Next: <latest note>" with +N for more

### Tasks

A strip under the Tasks header (hidden in search, selection mode and while the hub is not ready) shows today and the next six days as chips with the weekday, day number and open task count, following the profile filter; today's chip is highlighted and a day with 3 or more meetings or 4 or more hours of them has a dot. Tapping a chip with tasks scrolls to that day's section (smoothly, instantly with reduced motion); a chip with 0 is dimmed and does nothing.

A tap opens the task as its own page, with a back button in the header: title and notes are editable for every task, including ones from Slack or a meeting (see the layout below); Back, Esc, ⌘Enter or a phone swipe-back closes it, saves, and returns to the list at the same scroll with focus on its row. A first line over 120 characters is cut at the last space and the rest goes to the top of the notes. Slack and Gmail promises I made myself show under "You said" next to the
asks under "Is this yours?", where an ask has Copy draft for the reply the scan wrote and Open for its source.
A group of more than one shows Confirm all and Dismiss all, which act on the rows listed in it and offer Undo.
A focused "Is this yours?" row takes y or Enter for Mine, n or Delete for Not mine, and j/k or arrows to move between rows.
The Slack scan does not suggest an ask or promise again when one from the same person and chat with a similar title was
seen, done or dismissed in the last week, nor an ask in a DM where I sent the last message, and it closes that person's suggested DM asks when I sent the last message; an ask answered in the same scan is not saved. The Gmail scan skips an ask or promise from the same sender with a similar title in the same way, and both scans dismiss suggestions nobody reviewed within a week.

- Each day (Today, then Mon 2 Nov and so on) splits its tasks under small Anytime, Morning (before 12:00), Afternoon (before 17:00) and Evening headers with counts, keeping the manual order inside each
- Closed task rows are calm like TickTick: a check circle coloured by profile (blue Work, magenta Personal), the title (up to two lines), and on the right only an exact time such as 14:30 (none for the 09:00 and 19:00 slots, Nd late in red for overdue) with the repeat icon and checklist count when they apply; the source, people, Replied and the estimate show on the task page. Notes keep a preview line
- Today ends with an Add task button and later days with a small + (its dot switches between work and personal when both are shown), which takes times like
  "friday 10" (also "next tue 3pm", "end of week" or "eow" for Friday 17:00, and "in 3 days 3pm") and stays open for the next one. A bare time like "3pm" in a later day's Add task lands on that day. A typed duration like "30m", "1.5h" or "1h30m" (not after in, every, for or about) becomes the task's estimate, saved as "~30m" in the title; this applies to the phone quick add and the Ask bar in task mode too
- On the phone a round blue + floats at the bottom right of Tasks, like TickTick. A tap opens a quick-add sheet with the title, a description,
  a date button, a Work/Personal toggle (when both are shown) and send; Enter or send saves and keeps the sheet open for the next task.
  Typed times like "friday 10" still work when no date is picked. The flag sets High, Medium or Low priority, the tag button
  starts a #tag in the title (each #word becomes a tag), and the mic dictates the title; a long press on the + opens the sheet already listening
- Tasks have a priority (a red, orange or blue flag on the row), tags (shown as #tag on the row) and a reminder. On the task page the flag
  next to More sets the priority, the tag button adds tags (tap a tag to list its open tasks in both profiles, its x removes it), and the reminder is in the date sheet on the phone and
  in More on desktop: on time (the default), 5 or 30 minutes, 1 hour or 1 day early, or none. The hub pushes the reminder at that time
- On the phone, picking a date (from the quick add or a task's date chip) opens a date sheet: Today, Tomorrow, Next Monday and This evening
  pick at once; otherwise a day in the month view, an optional time, a reminder and (in quick add) a repeat, then the check to confirm
- Rows with "- [ ]" checklist lines in the notes show how many are ticked; a tap on the count opens the list under the row to tick, and the task page lists them too
- The task page is laid out like TickTick's task detail (the header has only Back). A top row has the check circle, coloured blue for Work and magenta for Personal, the due chip ("Today 10:00", "Tomorrow", "Mon 3 Nov" or "Date")
  and a "..." menu (Add estimate, Log time with +15m, +30m and +1h, Goal, Open meeting, source link, Snooze, Tidy, Make task, Copy draft, Raise, Move, Ask Claude, Delete). The body is a large title,
  the Description notes, and the checklist as subtask rows ending in "Add subtask", which adds a line inline; rows drag (or Alt+Arrow) to reorder. A sticky bottom bar has the
  repeat and focus buttons; an existing estimate shows as muted text under the notes
- The task page lists the http(s) links in the notes under the Description as a Links section (count in the header, shown only when there are links): one row per link, in order, up to 8 then "+N more", each opening in a new tab with the page title and the domain. The title comes from the API server (`/api/link-title`, which refuses private addresses and caches); until it arrives, or when it fails, the row shows the domain and the path. The list follows the text as typed
- The task page Snooze menu adds After next meeting (the end of the meeting running now or next today, through back-to-back ones) and Next free slot (the first 08:00-17:00 gap with 15 minutes left after now + 5 minutes), each with its time, from the task's own profile's meetings; an item is hidden when it has no target before 17:00
- Swiping left names the day the task moves to, and Snooze offers Today for a task due on a later day
- Select (header button, or on touch holding a row and releasing without moving) starts selection mode on Tasks: a tap toggles open tasks (done rows and notes cannot be picked), swipe, drag, + and Move to today are off, and a bar shows N selected with Done, Move to tomorrow, Snooze (later of tomorrow 09:00 and the next 09:00 after the due time), Delete and Cancel. Each action applies to all selected, shows one snack and has one Undo that skips rows edited since (for Done on a repeating task it also deletes the new occurrence). Esc, Cancel, switching list or filter and opening search leave the mode
- Search (or /) filters tasks by title, notes, people and tags, Overdue has Move to today with one undo, and tasks not
  dragged into an order sort by due time
- Focus timer: Start on an open task shows a bar over Codex with the task, the time so far against its estimate, and
  Stop. Stop adds the whole minutes to the task's time spent, shown as a chip on the task, with an undo, and logs the session (start and length) in the task page's Time log fold (closed by default, newest first, a Remove per session that lowers the time spent with an undo, and an "Earlier or added by hand" line for time not in a session; the +15m, +30m and +1h chips log no session). Marking the
  focused task done or deleting it stops the timer and logs the time the same way. One timer
  runs at a time and survives a reload. The first Do now card, when it is an open task, has Focus, which starts a 25 minute
  timer (Stop while it runs): the bar counts down, a chip in the Overview header shows the time left and opens the task, and
  the server sends one push (ntfy, when set) at the end. At zero the bar reads Time's up with Log 25m and Discard; nothing
  is logged automatically, and an expired timer shows the same after a reload. A timed focus logs at most 25 minutes
- An open task without a "~30m" estimate in its title gets one suggested as a chip: the average time spent on at least
  two done tasks whose titles share half their words, rounded to 5 minutes. A tap adds it to the title
- A Repeat menu on an open task sets Never, Daily, Weekdays, Weekly (its due weekday) or Monthly (its due day) by writing or removing the "Repeats:" first line of the notes; other rules show as Custom.
- A goal menu links an open or done task to one of this week's goals of its profile

### Related while writing

Typing in a task's title or notes, a wiki note or a meeting's My notes shows up to 3 matches under the field: current
wiki claims, past meetings and tasks from Slack of the same profile that share at least two key words with the line
being written, most shared words first. A claim or meeting opens in Codex, a Slack task opens its Slack link.

A task page also shows a Related section under the notes as soon as it opens: up to 5 past meetings and Slack tasks of
the same profile that share two key words with the saved title, or one key word and a person on the task, most shared
words first, then newest. It is left out when nothing matches and follows the saved title, not each keystroke.

### Meetings

Meetings imports the calendar every half hour and shows notes, summary (pinned text sits under it), decisions, actions and a closed Context fold with talk time and earlier
meetings of the same series, with decisions made and questions asked again; a meeting in a recurring series (2 or more past meetings with the same title) shows a chip under the title that opens a Series page: open actions across all occurrences (oldest meeting first, tick or Not mine in place, "Nothing open" when none) and the occurrences newest first with decision and open action counts, rows beyond 5 behind +N more, Back returns to the meeting; empty notes show a quiet "Add notes" row that opens a field with 1:1, Standup and Decision chips filling Markdown headings (the series' last pick comes first and selected, never inserted on its own), and the page has no status line once the transcript is read; the page copies as Markdown (summary, decisions and open actions) or as a
follow-up draft, an action copies as a message or opens a prefilled Linear issue, and the summary format suggests the
template last used for the series. A meeting without a transcript is a quiet, muted "No transcript" (Retry and Dismiss on its page); the hub tries 8 times, or 2 when the previous meeting of the same title had none.

The page of an upcoming or running meeting has a Prep section: points to raise with its attendees (each with a Raised tick), what
they took on last time (earlier meetings of the same profile with the same title or a shared attendee, up to 8 people), my open actions, open questions, and Copy agenda, which copies all of it as a Markdown
checklist without a model call. On the card, Last time lists up to 3 open actions and 3 decisions per meeting (+N more), open questions show their meeting's day, and tasks about an attendee are one line each (up to 3 per person); every line is a button that opens its meeting or task. Raise on a decision or an open task, and the field on a person page, save a point for
the next meeting with that person (picked from the meeting's attendees and recent ones); a point waits for the first
meeting with them after it was raised and counts as raised once that meeting ends. Points stay out of Search.

A person page starts with what waits outside meetings: the first line of their Slack DM summary (full text on hover) with Open in Slack,
one "Waiting on you" list of what they asked you and what you promised them in Slack or Gmail (each item once, so two asks from one message both show, each with its age and a Done check that clears it), and your sent mail to them with no reply, then their open tasks (with a Done check, included when the page is copied as Markdown). Below come their
commitments (hidden when there are none), the points to raise with them (included when the page is copied as Markdown), pinned text, meetings and
wiki claims that name them. A section shows its count whenever it has rows.

The meeting list shows a badge only when something waits for you: actions to review, open actions, Now or soon, or a missing transcript. On the phone an open action swipes right for Done and left to Not mine, with Undo. Rows carry no recording length, repeat icon or topic chips. The calendar syncs on open, on its interval, on pull-to-refresh on the phone and from a small sync icon next to the title on desktop. On a meeting page an open action has an assignee chip beside its date: Me (shown on hover or focus on desktop) or an attendee's first name (always shown); its menu lists Me and the attendees, and an action assigned to someone else leaves the "N of M" counts of the page and the list, while Today and the other lists still show it. The linear and copy buttons on an action row, and an empty Date chip, show on hover or focus on desktop and stay visible on touch.

The header has one segmented control, Decisions (the log, filtered by person), Load or Week, one view at a time:

- Load: hours per week, share recorded, who you meet most, time and actions done per recurring series, and a series
  value audit: meetings, hours, decisions and my actions per series over 8 weeks, with series that brought no decision
  or action of mine in 4 weeks flagged first as Nothing for you lately with the hours they cost; a tap opens the
  latest meeting
- Week: Goals this week, where up to 3 goals per profile are set and renamed (under All, a Work/Personal choice picks the profile), with an All goals button that opens the goals history (the page follows the Profile filter, lists this week and the 7 before it with done of total tasks, a progress bar and a Done or Missed badge, a menu with Reopen this week for past goals and Open tasks; Back returns to Week), then the week's decisions, new claims,
  tasks done and open meeting actions. Its Review lists done, slipped and stuck tasks and Waiting on by person: waiting
  tasks and sent mail with no reply after 3 workdays, with Copy nudge and Open. The decision log, Week (with Waiting
  on) and person pages copy as Markdown

Four chips above the topics (Mine for meetings I organise, With actions, Not recorded, Series) narrow the past list together with search and topics, hide Upcoming while on, and are remembered per device; Mine fills from the next calendar import on, so older meetings never match it.

Saved topics filter the list, show a timeline of matching meetings, decisions and claims, and count what is new since
you last looked. Topics and person pages list questions the meetings left open until you resolve them. Meeting search
also asks the hub, which keeps each transcript's text, and shows the words around a hit in the transcript; a
summarized meeting's page has a talk time strip in the Context fold (each speaker's share of words in the transcript, top five, with the
action and decision counts) and a collapsed Transcript section. The app-wide Search also lists Transcripts hits from
the hub with the meeting's title, date and the words around the hit; offline the group is left out. Search shows 8 hits per group with a Show N more button, and a Tasks and notes hit opens that task on Tasks. Long lists show
50 rows at a time.

### Wiki

The wiki is built from claims with sources, which can be edited, contested and go through Review. The wiki start page shows To review: one card per page with proposed claims (the first 3 claims and Read all N, Approve all or Reject all; a decided card stays in its slot as a stub while the list is open) and the first 3 loose claims (Show N more). The Overview row "N wiki claims wait for you" and the One at a time button open Review claims: one claim at a time with its page, sources, big Reject, Skip and Approve, "n of N", swipe right to approve and left to reject; a skipped claim comes back at the end. On a page, a proposed claim swipes the same way and a heading with 2 or more proposed claims gets Approve N. Decisions within 8 s share one Undo ("4 in a row"), and a batch of 5 or more keeps Undo up for 10 s. The start page also shows, in one closed
fold, Needs a look: claims untouched for 90 days (Stale) and claims a later meeting decision may have changed (Maybe changed), unless a
proposed replacement already waits in Review; each list shows 3 rows and +N more. Recently updated shows 5 rows and labels only contested ones. The start page search filters pages and claims as you type, and a claim hit opens its page at the claim. On a page, each current claim shows a Mentions line after its sources: up to 3 chips for open tasks (by due time) and then meetings (newest first, with the day) whose text names the page title as a whole phrase and shares a key word with the claim, then +N more to show the rest; a claim with no match shows no line. A page header Copy button copies the page's live claims and their source labels as Markdown. On
desktop a claim shows Cite and Retire on hover or focus; the page header counts claims without the pending ones. For meetings and Slack channel decisions of the last two weeks the hub
proposes the updated claims for Review (again if a meeting is re-synced with different decisions), marked From <meeting> or From #channel (see [codex-wiki.md](codex-wiki.md)).

### Jobs

The Jobs list shows the Work or Personal badge only when the visible jobs belong to both profiles, and shows Off for a disabled job that is not queued, and Queued while a run is waiting. A job that spent in the last 7 days shows `7 days $x.xx` in its row, read from the hub's per-job `jobspend:` rows. Run now on the job page runs the job once within a minute, also when the job is off, and the run appears in the Runs list. The Weekly digest preset appears only while the list is empty. A job page has a switch (no On/Off text) and the When section instead of a Next line in the header. Only the latest run shows its output; older runs are one line (time, status, first line) that opens on a click, 5 runs at first. Each run with output has a Copy button (older runs show it once opened), and the latest run has a Search field that highlights matches, shows the count, and steps through them with Enter and Shift+Enter.

## Timeline and steering

Claude reports progress through a `set_status` tool added to every chat: current step, finished parts, next steps
and notes. The timeline shows one card per prompt: Claude's final reply, the files changed with line counts,
commands run and the first error of each failed one, commits, subagents, these notes and the steps behind them.
A finished card ends with the turn's cost and how long it took; a chat row in the Sessions view shows the chat's
cost so far. The status bar usage tooltip adds a Spend block with today's and the last 7 days' cost per model across the chats open on the Mac (today is the Mac's day, and a team-mode chat counts under its session model). Spend from before a host restart is not counted, since history reloaded from the CLI transcript has no cost, and a chat past the event cap is approximate because trimming old events counts the first kept total again. Switch to the transcript for every message and step in order.

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
server, then subscribe to it in the ntfy app. Tapping the push opens the chat. The assistant hub uses the same topic for meeting and task reminders and the 08:00 morning brief; it sends no reminders from 17:00 to 08:00, and tasks that fell due overnight go out with the first morning check, as does the nudge for a transcript that landed overnight. Tasks of one profile that come due in the same check go out as one "N work tasks due" (or personal) push (first 5 titles, then "+N more") with no Done or Snooze; a single due task keeps Done and Snooze. A meeting gets a heads-up only when there is something to prep (open actions of yours from the previous one, its decisions or open questions, or a calendar link); one that started up to 5 minutes ago still gets it ("starts now"), so an 08:00 meeting is covered. A job run pushes only when it fails or when the job's prompt asks for a push; a successful report shows in the Context fold only. Open tasks roll to today each day (a rolled evening task is caught up on weekday mornings only), but only weekday rolls count toward sending a task back to review after 3.
Urgent Slack and Gmail asks that arrive while a calendar meeting runs (not all-day events, time blocks or
events with no other attendees) are held; an ask the scan marks urgent goes out during the meeting anyway. Within a minute
after it ends, up to 3 held asks go out one by one with their own Open, Send reply and Skip, more as one push "N urgent while
you were in <meeting>". Asks you accepted
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

`./claude-alt.sh` sets up `~/.claude-alt` for a work Claude login and `./claude-alt.sh 2` sets up `~/.claude-alt2` for Work
Enterprise, next to the personal one in `~/.claude`. Each shares settings, skills, plugins and chat history with `~/.claude` and keeps its own
login; log in once with `CLAUDE_CONFIG_DIR=<dir> claude` and `/login`. A new chat under `~/workspace_personal` starts on
Personal and any other folder on Work; a reopened chat goes back to the account it was last on. Codex questions go to a daily
chat per profile: work ones run in `~/.agentview/codex-work`, so they get the Work account and the work wiki and data, and
personal ones in this repo. When a turn ends on a usage limit, the chat moves to the next
logged-in account with usage left (Personal, then Work; Work Enterprise is for documents only and is never picked on its own) and continues where it stopped, and new chats start
there until the limit resets. The composer menu shows the account (Personal, Work or Work Enterprise) and switches it by hand. The status bar shows the account with
its weekly and 5-hour usage as `w25 h15` (read when a turn ends, every 10 minutes while the chat is open, and on a click while a Claude process is open), and the even weekly pace (100/7 % a day, to the hour) on hover. When the
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

Without a Grafana MCP server, Observe makes no Grafana requests. Observe's Grafana section shows a card per entry in a repo's `grafana.panels` (`{ title, query, unit }`, a PromQL query in
`~/.agentview/observe.json`): the last value, a 6 hour sparkline with min and max in the hover title, and a link to Explore.
A failing panel shows its error without affecting the others. With no panels, a button asks Claude to suggest some from the
service's dashboards. The refresh button reloads the panels too.

## Shortcuts

⌘ on a Mac, Ctrl elsewhere. Letter shortcuts stay out of the way of text fields. Closing a task page, an inline editor
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
| ⌘I | Focus the assistant |
| ? | Show the keyboard shortcuts (outside text fields) |
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

The palette's Keyboard shortcuts command shows the same list.

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

- Codex lists share design tokens in tokens.css: `--row-h` (40px), `--row-title` and `--row-meta` (md and sm type), `--meta-fg` (muted secondary text) and `--hairline` (1px separators). Task rows, section headers with counts and the Slack Summary page use them.
