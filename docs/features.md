# Features

## Layout

- **Task box** (right): prompt, mode and model menus, context meter, and the timeline below it. A More menu at the
  right of its header holds Agents (the chat's subagents), what is waiting elsewhere, usage, the Mac name and team or advisor counts. ⌥⌘B hides it
- **Editor** (center): File tab follows Claude's edits and shows the diff against HEAD. Markdown files open as a rendered document with an outline, and the preview button shows the source. In the diff, a long press or a right click on a line quotes it into the composer as `path:line`. The pencil in the file bar turns the file into an editor; Save or Cmd+S writes it back (project files only, never inside credential folders). Gitignored `.env` files show in the explorer without the eye toggle. Browser tab shows your Chrome. Observe, Deploy and MCP open as further tabs here
- **Sidebar** (⌘B): Explorer, Source Control, GitHub Pull Requests, Sessions (open and recent chats; one bar holds the search box and a New session in a repo button) and Workspace (repos, chats, Paseo worktrees). In Workspace a repo with no live chat starts folded to its header, and a repo shows its 5 latest chats with Show more. The search box in both views finds chats by every word of the query across title, first prompt, repo and (Workspace) branch
- **Chat rows** (Sessions view: Pinned, Needs you, repo groups, Recent): a title and one meta line (repo, the branch when it is not the default, then the Running status, "No activity for 15 min" or the time since last activity such as "3 h ago" or "yesterday", then the +/- counts of a finished chat). One badge shows the state: Needs you, Failed (the last turn errored, cleared when the next turn starts), Running, or Done (activity since you last opened the chat). A blue dot before the title marks Done and Needs you chats. A repo group header is one line: the repo name, at most one count badge (Needs you, else running, else unread) and New chat; a chat starting in a collapsed group opens it for 8 seconds without changing the saved collapse state. The time you last opened each chat is kept in `~/.agentview/seen.json`, so opening a chat clears its Done badge on every device; a chat with no entry is never Done. The Sessions tab dot and the sidebar count cover open chats other than the one you are viewing that are Done or Need you, plus attention items. Repo groups list a group with a Needs you chat first, then the rest by latest activity, and the order holds while a chat is open, except that Needs you groups still move to the top. Chat rows take keys: j / k or arrows move between rows and Enter opens one, and ⇧⌘] / ⇧⌘[ (Ctrl+Shift off Mac) view the next or previous open chat in row order, wrapping. One More button opens a menu: Retry (Failed chats), Pin or Unpin, Rename, Open beside (desktop), Close chat (open chats), Archive. Retry opens the chat and resends its last prompt as a new prompt. Open beside shows that chat in a second column with its own composer (`?beside=<chat id>` does the same); the arrow in its header moves it to the main column. Rename edits the title in place (Enter or leaving saves, Esc cancels); a double click on a chat title (desktop) or a long press on the row (phone) starts the same edit; a long press on a chat row renames and does not open the menu. The rename is written to the transcript, so it survives reload. A live chat with running agents shows a collapsed Agents section under its row with the count; opening it lists each agent with its name, Running (and the workflow name) and elapsed time, and a tap opens that agent in the Agents pane of that chat. Archive always moves the chat to the bin, whatever its age, and the bin keeps it for 24 hours
- **Chat transcript**: opening a chat sends its last 150 events; the rest is paged in on demand. The Show earlier row at the top reads "Show earlier (N hidden)"; tapping reveals rows the window hides, then loads 150 older events ("Loading earlier" while it runs, taps ignored) and keeps the scroll on the same row. The last 30 rows paint first and the rest follow in steps of 30 with the scroll held, and settled replies keep their rendered markdown so a revisit does not parse them again. The last 150 events of the 8 most recently viewed chats are kept, so switching back shows them at once while the server's init is on its way. The row is gone at the start of the held history, and a failed load shows a notice and leaves the row for a retry.
- **Pinned chats**: Pin on a chat row's menu in the Sessions view keeps that chat in a Pinned group above the repos (newest pin first, also shown in Needs you while waiting). Pins are stored on the Mac in `~/.agentview/pins.json`, so every device sees them after its next reconnect or reload; deleting, archiving or binning a chat drops its pin
- **Codex** (top of the activity bar): Overview, Tasks, Meetings, Jobs and Wiki, filtered by work or personal
  profile; see [Codex](#codex)
- **Terminal** (bottom, ⌘J): a shell in the chat's folder
- **Share to the app (Android)**: text or a link shared into AgentView asks "Add as task" (saved to Tasks, with a time read from the text), "Send to chat" (appended to the composer), or, when a meeting is running or starts within 15 minutes, "Add to meeting notes" (a time-stamped line in that meeting's notes).
- **Command palette** (⇧⌘P or F1): every view, tab, page, Codex list, model and mode as a searchable list; pinned chats are listed first as "Chat: <title>" and open that chat; it also opens tasks, meetings and wiki pages by title, with the last five opened there first; a query also ends the list with a "See all N results" row (tasks and notes, meetings, wiki and jobs matching the query, under the Show filter) that opens Search with the query filled in
- **Theme**: the color icon in the status bar cycles Graphite, Dark Modern and Light. With nothing chosen the page
  follows the system setting; `?theme=light` in the URL picks one

## Phone

At max-width 480px (900px where noted) the app is one column with a tab bar. Task-specific phone behaviour (the + button, quick-add sheet, date sheet, Select) is under Tasks; sharing into the app is under [Share to the app (Android)](#layout).

- **Tabs**: a quick sideways swipe moves between the Codex, Chat, Sessions and Agents tabs, and the new tab slides in from its side. The tab bar shows a count only on Chat (waiting); Sessions (waiting elsewhere) and Agents (running) show a dot
- **Installing on the phone**: `npm run android -w app` builds `dist/AgentView.apk` and prints its path; it needs no phone connected. `npm run phone` installs it with adb through `app/phone.sh`, over USB or Android wireless debugging. The installed version is the commit sha of the build
- **Launcher badge**: the launcher icon shows the Needs you count (up to 99) when the phone build has the badge plugin, and nothing on the web
- **Haptics**: a swipe action, a task completion, a long press, a pull refresh and a drag drop give a short native tap in the phone app, and fall back to the WebView vibration; the web and desktop give none (see Row density in the design system)
- **Sync**: the interval sync runs only while the app is visible
- **Offline badge**: an Offline and reconnecting badge shows after 2 s without the stream and hides on reconnect
- **Bottom-sheet menus**: a Menu opens as a bottom sheet at max-width 480px. A long press of 500ms on a row with a More menu opens it with a haptic tap; the kebab stays
- **Swipe undo**: every row swipe that completes, snoozes, moves, deletes, pins or archives shows one snack with Undo for 5 s; a newer swipe replaces it, so only the latest can be undone
- **Chat actions**: a chat row in Sessions swipes right to Pin or Unpin and left to Archive, with Undo; a running or waiting chat only swipes right, and a chat with no session id yet does not swipe
- **Section headers**: grouped Section headers on Overview (Today), Tasks and Meetings stick to the top while the list scrolls
- **Pull to refresh**: at max-width 900px, pulling down 64px at the top of Overview, Tasks, Meetings, Wiki or Jobs syncs
- **Scroll restore**: Back from a task or meeting returns the list to its scroll position, kept per list and profile filter (Tasks and Meetings)
- **Edge swipe back**: at max-width 900px, a right swipe of at least 70px from within 20px of the left edge closes the open page or sheet like Back. It does nothing on a list or inside a Row swipe, and is off in the Android app (Android 10 or later), where system gesture navigation owns the edge
- **Keyboard inset**: `--kb-inset` holds the keyboard height (from 100px), so the New task and date sheets sit above the keyboard and the task page scrolls the focused field into view
- **Meeting actions**: an open meeting action swipes right for Done and left to Not mine
- **Touch targets**: Rows, Section actions and Chips are 44px high at max-width 480px and on coarse pointers; the done buttons on Overview rows, Related chips and Remove goal have full-size tap targets

## Codex

Codex shows Overview, Tasks, Meetings, Jobs and Wiki for the work profile, the personal profile or both. Under the
nav, the sync line says when the app last synced with the hub, how many changes still wait for the hub, and "Not saved on this device" when the local copy cannot be written. While the hub skips its Slack, Gmail or calendar scan because
that Claude account is at its usage limit, a line below it names the paused scans and the time the limit ends.
When everything is healthy that one line is all the nav shows; clicking it syncs and shows the scan lines. When a scan failed, stalled or is paused, one small
line per source appears below it with the last Slack, Gmail and calendar run, its counts, the error in the warning color,
or "not set up"; Slack and Gmail have a "Scan now" button.

### Overview

- Overview shows three blocks, each hidden when empty: Up next, Needs you and Today. While data loads it shows a skeleton
- Up next is one card. It is the next meeting today that has not ended (a running meeting counts, at any time today): title, one meta line (a countdown, then time, room, N people; "Starts in 30 min" before the start, "Ends in 20 min" while it runs, "Starts now" under a minute), a Live badge while it runs, a More menu with Prep, Open calendar (when the meeting has a link) and Notes (opens the meeting page with the notes field in edit mode); tapping the card opens the meeting. With no meeting left today it is the first open task due today by due time, with a Done button (Undo in the snack) and its title opening the task; overdue tasks never fill it. With neither, one "Nothing today" empty state shows the next meeting or dated task as its hint ("Next: <when> <title>") and a New task button; adding a task for today replaces it with the card
- Needs you is one row with a count badge and a chevron, shown only when the count is above zero. The count is the Needs you list plus the Reply queue rows. The row opens a bottom sheet headed Needs you with the total, then Tasks, Asks and Replies, each with its own count (a group with no rows is left out; the total ignores the older-than-3-days filter); Esc, the scrim, a drag down and the back gesture close it and focus returns to the row, and it closes by itself when the count reaches zero. Tasks holds overdue and at-risk tasks and the open actions of meetings that ended in the last two hours; Asks holds asks and promises to confirm, Slack DMs waiting on me, the latest Slack summary's "Needs you" bullets, each once (three or more overdue collapse into one row with Move N overdue to today in the Tasks header), "Just ended · title" rows with Copy follow-up and Notes in the More menu, one row "N asks older than 3 days" that filters the Reply queue to them, and one row "N wiki claims wait for you" that opens the claim review; each group shows 5 rows then Show all N
- Today is a Section and one grouped list of the rest of today's meetings and the open tasks due today or overdue, overdue first, then in time order; a task already in Up next or in Needs you as at risk is left out. A meeting row is its title and time, with a Live badge while it runs, and opens the meeting; in the 10 minutes before the start, a meeting with a link shows "Starts in N min" and a Join button that opens the link in a new tab. A task row is its title and due time (a Late badge when overdue), a check button (Done with Undo) and a More menu (Snooze to tomorrow with Undo, Open). Seven rows show, then Show all N expands the list in place. Once a task is done today the header also shows a quiet "N of M done" badge, M being N plus the open tasks due today or overdue (at-risk ones included, meetings not)
- The Overview ask bar is one input line with mic and send while idle; the recipe chip (Prep next meeting within an hour of one, Draft my weekly update on Thursday and Friday afternoons, otherwise Plan my day, What's next or Wrap up my day) appears on focus, and the Task/Ask, profile and When? chips appear once there is text. A personal ask also sends my personal meetings from today to three days ahead and asks the chat to suggest alternatives and change the calendar only after confirmation
- Summary page (in the nav, no longer a row on Overview): a TickTick-style report with Date (Today, This week, Last week, This month) and Status (All, Completed, Not completed) rows, Completed and Not completed Sections of task Rows (day as meta) that open the task, and a Copy button for Markdown; below it a link to the Slack asks to review; chats with a summary in the range grouped into DMs, Mentions and Channels Sections, 5 rows each then Show all N; the Sonnet summary folded to 8 lines; and Summarize.
- Replies (the Reply queue, in the Needs you sheet): each ask is one row with its title, person and age, a state badge (Needs you or FAQ), the draft clamped to 2 lines, and Send plus a More menu (Edit, History, Open thread, Snooze: In 1 hour, Later today 16:00 until 15:00, Next workday 09:00, then Skip). A snoozed ask leaves the queue and every count until its time passes (synced across devices, one Undo), then returns in queue order with "Snoozed" after its age. History shows the last 3 replies sent to that person (date and first line, newest first), loads when first opened and reloads after a reply to that person goes out. Send all FAQ answers and Copy access and limit requests sit in the section header. Asks older than 3 days also show as one row above the queue ("N asks older than 3 days", oldest age): tapping it filters the queue to them, with an Older than 3 days chip that clears the filter and Dismiss all N in place of the batch buttons. Dismiss all keeps the drafts, sends nothing and shows one Undo. On a desktop pointer an ask takes keys: j / k or arrows move between asks, Enter opens the task, s sends the draft, x skips (both ignored while that ask is busy), and focus moves to the next ask after one leaves; with nothing focused j or k focuses the first ask. The section header is then always a More menu (batch actions, then a disabled hint line with the keys), except in the filtered view.

### Tasks


A tap opens the task as its own page, with a back button in the header: title and notes are editable for every task, including ones from Slack or a meeting (see the layout below); Back, Esc, ⌘Enter or a phone swipe-back closes it, saves, and returns to the list at the same scroll with focus on its row (Meetings does the same on phones). A first line over 120 characters is cut at the last space and the rest goes to the top of the notes. Slack and Gmail promises I made myself show under "You said" next to the
asks under "Is this yours?", where an ask has Copy draft for the reply the scan wrote and Open for its source.
A group of more than one shows Confirm all and Dismiss all, which act on the rows listed in it and offer Undo.
A focused "Is this yours?" row takes y or Enter for Mine, n or Delete for Not mine, and j/k or arrows to move between rows.
The Slack scan does not suggest an ask or promise again when one from the same person and chat with a similar title was
seen, done or dismissed in the last week, nor an ask in a DM where I sent the last message, and it closes that person's suggested DM asks when I sent the last message; an ask answered in the same scan is not saved. The Gmail scan skips an ask or promise from the same sender with a similar title in the same way, and both scans dismiss suggestions nobody reviewed within a week.

- Closed task rows are calm like TickTick: a check circle coloured by profile (blue Work, magenta Personal), the title (one line), a meta line of the exact time such as 14:30 (none for the 09:00 and 19:00 slots, Nd late in red for overdue) then at most one of Repeats, the checklist count or High or Medium priority as text (no tags on the row), a Needs you badge on suggested tasks, and a More menu (Open, Snooze, Tomorrow, Move to the other profile, Delete; Not done on done rows; Open and Delete on notes) shown on hover or focus on desktop; the source, people, Replied and the estimate show on the task page. Notes keep a preview line
- A #tag chip on the task page opens the tag page: a Section header with the tag and an open-task count, the tasks as Rows in a grouped card, and an EmptyState when none are open
- The + sheet takes times like "friday 10" (also "next tue 3pm", "end of week" or "eow" for Friday 17:00, and "in 3 days 3pm") and stays open for the next one. A typed duration like "30m", "1.5h" or "1h30m" (not after in, every, for or about) becomes the task's estimate, saved as "~30m" in the title; this applies to the phone quick add and the Ask bar in task mode too
- A round blue + floats at the bottom right of Tasks, like TickTick, and is the only add control; the n key and the palette's add task open the same sheet. A tap opens a quick-add sheet with the title, a description,
  a date button, a Work/Personal toggle (when both are shown) and send; Enter or send saves and keeps the sheet open for the next task.
  Typed times like "friday 10" still work when no date is picked. The flag sets High, Medium or Low priority, the tag button
  starts a #tag in the title (each #word becomes a tag), and the mic dictates the title; a long press on the + opens the sheet already listening
- Tasks have a priority (a red, orange or blue flag on the row), tags and a reminder. On the task page the Add chip offers
  Priority, Tag, Repeat and Estimate (the priority chip then changes the priority, the x on a tag chip removes it), and the reminder is in the date sheet on the phone and
  in More on desktop: on time (the default), 5 or 30 minutes, 1 hour or 1 day early, or none. The hub pushes the reminder at that time
- On the phone, picking a date (from the quick add or a task's date chip) opens a date sheet: Today, Tomorrow, Next Monday and This evening
  pick at once; otherwise a day in the month view, an optional time, a reminder and (in quick add) a repeat, then the check to confirm
- Rows with "- [ ]" checklist lines in the notes show how many are ticked as text in the meta line; the list is read and ticked on the task page
- The task page is laid out like TickTick's task detail (the header has only Back). A Section header shows the live title ("Untitled" when empty) with a filled Done button ("Not done" on a done task, none on a note) and a More menu (Snooze, Tomorrow, Move, then the rest, Clear due time, Delete). A chip row under it holds the due chip ("Today 10:00", "Tomorrow", "Mon 3 Nov" or "No due"; shown on open and suggested tasks and on any task with a due time), the priority chip, a chip per tag and a Repeat chip (each only when set), then a quiet Add chip (hidden on notes and while the tag field is open). On an open repeating task with a due time the chip opens a menu: "Skip this one · Tue 09:00" moves the same task to the next occurrence after the later of its due time and now (one Undo, nothing marked done), and "Pick date and time…" opens the picker.
  The row also has a "..." menu (Focus, Add estimate, Log time with +15m, +30m and +1h, Goal, Open meeting, source link, Snooze, Tidy, Make task, Copy draft, Raise, Move, Ask Claude, Delete). The body is a large title,
  the Description notes, and the checklist as subtask rows ending in "Add subtask", which adds a line inline; rows drag (or Alt+Arrow) to reorder. There is no bottom bar; an existing estimate, the time spent and the people show as one muted line under the notes (none when there are none)
- The task page lists the http(s) links in the notes under the Description as a Links section (count in the header, shown only when there are links): one row per link, in order, up to 8 then "+N more", each opening in a new tab with the page title and the domain. The title comes from the API server (`/api/link-title`, which refuses private addresses and caches); until it arrives, or when it fails, the row shows the domain and the path. The list follows the text as typed
- The task page Snooze menu adds After next meeting (the end of the meeting running now or next today, through back-to-back ones) and Next free slot (the first 08:00-17:00 gap with 15 minutes left after now + 5 minutes), each with its time, from the task's own profile's meetings; an item is hidden when it has no target before 17:00
- Swiping left names the day the task moves to, and Snooze offers Today for a task due on a later day
- Select (header button, or on touch holding a row and releasing without moving) starts selection mode on Tasks: a tap toggles open tasks (done rows and notes cannot be picked), swipe, drag, + and Move to today are off, and a bar shows N selected with Done, Move to tomorrow, Snooze (later of tomorrow 09:00 and the next 09:00 after the due time), Delete and Cancel. Each action applies to all selected, shows one snack and has one Undo that skips rows edited since (for Done on a repeating task it also deletes the new occurrence). Esc, Cancel, switching list or filter and opening search leave the mode
- Search (or /) filters tasks by title, notes, people and tags, Overdue has Move all to today in its header with one undo, group headers are Section headers with a count, and Done (closed by default) has Clear that removes the done-today rows with one undo, and tasks not
  dragged into an order sort by due time
- Focus timer: Start on an open task shows a bar over Codex with the task, the time so far against its estimate, and
  Stop. Stop adds the whole minutes to the task's time spent, shown as a chip on the task, with an undo, and logs the session (start and length) in the task page's Time log fold (shown only with sessions or added time, closed by default, newest first, a Remove per session that lowers the time spent with an undo, and an "Earlier or added by hand" line for time not in a session; the +15m, +30m and +1h chips log no session). A History fold under it (shown only with entries, closed, newest first) lists when the status, due date and assignee last changed, one row each with the current value and the time. Marking the
  focused task done or deleting it stops the timer and logs the time the same way. One timer
  runs at a time and survives a reload. Focus, in a task row's More menu, starts a 25 minute
  timer (Stop while it runs): the bar counts down and the
  server sends one push (ntfy, when set) at the end. At zero the bar reads Time's up with Log 25m and Discard; nothing
  is logged automatically, and an expired timer shows the same after a reload. A timed focus logs at most 25 minutes
- An open task without a "~30m" estimate in its title gets one suggested as a chip: the average time spent on at least
  two done tasks whose titles share half their words, rounded to 5 minutes. A tap adds it to the title
- The Repeat chip (or Repeat under Add) on a task sets Never, Daily, Weekdays, Weekly (its due weekday) or Monthly (its due day) by writing or removing the "Repeats:" first line of the notes; other rules show as Custom. The chip only opens its menu on an open task, and Repeat is not offered under Add on other tasks. Estimate under Add offers 15m, 30m, 1h and 2h and writes the ~estimate suffix on the title.
- A goal menu links an open or done task to one of this week's goals of its profile

### Related while writing

Typing in a task's title or notes, a wiki note or a meeting's My notes shows up to 3 matches under the field: current
wiki claims, past meetings and tasks from Slack of the same profile that share at least two key words with the line
being written, most shared words first. A claim or meeting opens in Codex, a Slack task opens its Slack link. Hits are Rows under a Related header with a count.

A task page also shows a Related section under the notes as soon as it opens: up to 5 past meetings and Slack tasks of
the same profile that share two key words with the saved title, or one key word and a person on the task, most shared
words first, then newest. It is left out when nothing matches and follows the saved title, not each keystroke.

### Meetings

Meetings imports the calendar every half hour. The meeting page shows, always: the header (Notes or Join, a More menu), one plain meta line (weekday and time, room, N people, then Recorded N min), a status line and a room mic question only when they apply, My actions, To review, summary (pinned text sits under it), decisions, Prep and My notes. One collapsed More section at the bottom (closed on every visit) holds the Add an action input, the Context fold (talk time, earlier meetings of the series, the series chip and the attendees), Unassigned, Others took, Not mine, the Transcript and the inline Ask about this meeting bar. An action is a Row: one title line, one meta line, a state badge, one button for its status and a More menu (Not mine, Assign, Snooze, Edit, Delete).
Earlier meetings of the same series show in Context, with decisions made and questions asked again; a meeting in a recurring series (2 or more past meetings with the same title) shows a series chip in Context that opens a Series page (a Section header with the title, Open next when a meeting is upcoming, a More menu with Open calendar and Notes template, which cycles 1:1, Standup, Decision for the series, then chips for the cadence when gaps are regular and the number of people): open actions across all occurrences (oldest meeting first, tick or Not mine in place, "Nothing open" when none) and the occurrences newest first with decision and open action counts, rows beyond 5 behind +N more, Back returns to the meeting; empty notes show a quiet "Add notes" row that opens a field with 1:1, Standup and Decision chips filling Markdown headings (the series' last pick comes first and selected, never inserted on its own), and the page has no status line once the transcript is read; the page copies as Markdown (summary, decisions and open actions) or as a
follow-up draft, an action copies as a message or opens a prefilled Linear issue, and the summary format suggests the
template last used for the series. A meeting without a transcript is a quiet, muted "No transcript" (Retry and Dismiss on its page); the hub tries 8 times, or 2 when the previous meeting of the same title had none.

The page of an upcoming or running meeting has a Prep section: points to raise with its attendees (each with a Raised tick), what
they took on last time (earlier meetings of the same profile with the same title or a shared attendee, up to 8 people), my open actions, open questions, and Copy agenda (all of it, uncapped) as a Markdown
checklist without a model call. The Prep card (and section) has a "Prep" header with a count badge per kind and a Copy agenda button, then one group per kind: Open actions, Decisions (folded), Open questions and Tasks. Each group shows its first 3 rows and "Show all N"; a row is one title line and one meta line (meeting and day, or the person for a task) and opens its meeting or task. Fold state is kept per meeting. Raise on a decision or an open task, and the field on a person page, save a point for
the next meeting with that person (picked from the meeting's attendees and recent ones); a point waits for the first
meeting with them after it was raised and counts as raised once that meeting ends. Points stay out of Search.

A person page starts with what waits outside meetings: the first line of their Slack DM summary (full text on hover) with Open in Slack,
one "Waiting on you" list of what they asked you and what you promised them in Slack or Gmail (each item once, so two asks from one message both show, each a row with its source and age, a Needs you badge when suggested, a Done button and a More menu with Open and the Slack or Gmail source), and your sent mail to them with no reply, then their open tasks (rows like the Tasks list with a Done check and a More menu, all included when the page is copied as Markdown). Waiting on you, open tasks and meetings each show their first 5 rows and a "Show all N" button, folded again on reload or for another person. Below come their
commitments (hidden when there are none), the points to raise with them (included when the page is copied as Markdown), pinned text, meetings and
wiki claims that name them. A section shows its count whenever it has rows.

A meeting list row is the title, one meta line (time, then the room, then N people; a transcript hit replaces it while searching), at most one state badge (Live while it runs) and a More menu on hover, focus or always on the phone with Open calendar and Notes (opens the meeting page with the notes field in edit mode); the same row serves Overview, Tomorrow and person pages. On the phone an open action swipes right for Done and left to Not mine, with Undo. Rows carry no recording length, repeat icon or topic chips. The calendar syncs on open, on its interval, on pull-to-refresh on the phone and from a small sync icon next to the title on desktop. An action row (meeting page, Series page, Overview Review, Just ended, Needs you asks) is a title and one meta line (due date as text, the assignee's first name, the reason clamped to 2 lines), at most one quiet badge (Needs you, Overdue, Done) and two visible actions: one button for its status (Done, Mine, Take it, Restore, Not done) and a kebab. The kebab lists Assign (open meeting actions; Me and the attendees; an action assigned to someone else leaves the "N of M" counts of the page and the list), Snooze, Edit (opens the task page), New Linear issue (open meeting actions), Copy as message and Delete with Undo; rows without a meeting get Open source and Copy draft instead of the meeting items.

The header has one segmented control, Decisions (the log, filtered by person), Load or Week, one view at a time:

- Load: hours per week, share recorded, who you meet most, time and actions done per recurring series, and a series
  value audit: meetings, hours, decisions and my actions per series over 8 weeks, with series that brought no decision
  or action of mine in 4 weeks flagged first as Nothing for you lately with the hours they cost; a tap opens the
  latest meeting
- Week: Goals this week, where up to 3 goals per profile are set and renamed (under All, a Work/Personal choice picks the profile), with an All goals button that opens the goals history (the page follows the Profile filter, lists next week (when it has goals), this week and the 7 before it, each goal as a header with its done/total task count and a row per task (due date, open before done; tap opens the task), and a menu with Rename, Move to next week or Reopen this week for past goals, and Delete; Back returns to Week), then the week's decisions, new claims,
  tasks done and open meeting actions. Its Review lists done, slipped and stuck tasks and Waiting on by person: waiting
  tasks and sent mail with no reply after 3 workdays, with Copy nudge and Open. The decision log, Week (with Waiting
  on) and person pages copy as Markdown

The list header holds the Lists menu, the title, search and a More menu with Decisions, Load, Week, Take notes, Sync calendar, the four filters and Track a topic. The filters (Mine for meetings I organise, With actions, Not recorded, Series) are check items in that menu; they narrow the past list together with search and topics, hide the coming days while on, show as chips above the list only while on (each chip turns its filter off), and are remembered per device; Mine fills from the next calendar import on, so older meetings never match it. The topic bar shows only while a topic is selected or after Track a topic was chosen this visit. Day headers (Today, Tomorrow, weekday, past days) stand alone, upcoming days first, with no Upcoming or Earlier header.

Saved topics filter the list, show a timeline of matching meetings, decisions and claims, and count what is new since
you last looked. Topics and person pages list questions the meetings left open until you resolve them. Meeting search
also asks the hub, which keeps each transcript's text, and shows the words around a hit in the transcript; a
summarized meeting's page has a talk time strip in the Context fold (each speaker's share of words in the transcript, top five, with the
action and decision counts) and a collapsed Transcript section with a search field (any word of the query is highlighted, with a count, Enter and Shift+Enter or the arrows step through the matches; the query stays when the section closes and its count shows in the header). The app-wide Search is not in the sidebar; the palette's See all row opens it with the query in its focused field, Back and Esc return to the list open before, and it also lists Transcripts hits from
the hub with the meeting's title, date and the words around the hit; offline the group is left out. Search shows 5 hits per group with a Show all N button, and a Tasks and notes hit opens that task on Tasks. Long lists show
50 rows at a time.

### Wiki

The wiki is built from claims with sources, which show as kind chips (Slack, Linear, PR, Doc, Meeting; the label is the tooltip) that open in a new tab, and which can be edited, contested and go through Review. The wiki start page is a search and one grouped list per section that has pages (Teams, Projects, People, Practices, Pages); a row is the page tile and the title, with one Needs you badge (Needs review) when the page has a proposed claim, and no meta line; its More menu holds Open and Archive (Archive retires the page with an Undo snack; its claims stay). The header has New page (one title field at the top of the list; Enter or blur creates the page in Pages and opens it, Esc cancels) and a More menu with Feed, Notes and Ask, each opening a bottom sheet; an empty wiki shows No pages yet with New page. Memory is reached from search hits and claims. The start page also shows To review: one card per page with proposed claims (the first 3 claims and Read all N, Approve all or Reject all; a decided card stays in its slot as a stub while the list is open) and the first 3 loose claims (Show N more). The Overview row "N wiki claims wait for you" and the One at a time button open Review claims: one claim at a time with its page, sources, big Reject, Skip and Approve, "n of N", swipe right to approve and left to reject; a skipped claim comes back at the end. On a page, each heading is a section with its claim count (without the pending claims) above a grouped list of claim rows (claim text up to 2 lines, then one meta line with Proposed or Contested by and one source chip, no date; no row has more than two actions). A normal claim has a More menu (Edit, Cite, Contest, Resolve while contested, then the other sources, the mentions, Open Claude chat and a disabled Updated date line, Retire last; a long press on the row opens it, as a bottom sheet on phones); a proposed claim has Reject and Approve and swipes the same way; a stale claim has Confirm and More (its date line reads Still true? Updated <date>); a retired claim has More with Restore last. A heading with 2 or more proposed claims gets Approve N. Search hits are rows with the page title as meta. Decisions within 8 s share one Undo ("4 in a row"), and a batch of 5 or more keeps Undo up for 10 s. The start page also shows, in one closed
fold, Needs a look: claims untouched for 90 days (Stale) and claims a later meeting decision may have changed (Maybe changed), unless a
proposed replacement already waits in Review; each list shows 3 rows and +N more. Feed (Recently updated) shows 5 rows and labels only contested ones. The start page search filters pages and claims as you type, and a claim hit opens its page at the claim. On a page, each current claim's More menu lists its mentions: open tasks (by due time) and then meetings (newest first, with the day) whose text names the page title as a whole phrase and shares a key word with the claim; a claim with no match lists none. A wiki page header is the page title with a Propose claim button and a More menu (Rename, Ask, which opens a bottom sheet with the Ask field, Review while the page has proposed claims, Copy as Markdown for the live claims and their source labels, Archive; Memory has no Rename, Ask or Archive). Propose claim opens a field that saves a proposed claim for Review (Undo removes it); Archive retires the page, returns to the start page and has an Undo snack. In Older, a live claim past 90 days shows Confirm (sets its date to today, so it returns under its heading and Claude uses it again; Undo restores the date) and a More menu with Edit, Cite, Contest and Retire, whose date line starts with Still true?; the Older header adds an N to confirm badge and stays closed. For meetings and Slack channel decisions of the last two weeks the hub
proposes the updated claims for Review (again if a meeting is re-synced with different decisions), marked From <meeting> or From #channel (see [codex-wiki.md](codex-wiki.md)).

### Jobs

The first Jobs row is Autopilot (Reply for me in Slack): its mode in one line and a Switch; a tap opens its page, a grouped list of Away, Covers, Never answers, Model, Dry run and Activity, each with its value. All but Dry run open a bottom sheet (Activity holds the Seen list and the spend); the info button explains how it works. See [autopilot.md](autopilot.md).

Each Jobs list row is one line of title and one line of meta: the schedule in words and the next run, nothing else. A row has at most one badge, in the order Running, Queued, Failed (the latest run failed), Off (disabled). It has no Run now button; a More menu holds Run now, Edit, Disable or Enable, and Delete (soft delete with an Undo snack), and on phones a long press on the row opens the same menu. There is no switch or last-run line; the runs are on the job page. Run now, on a row or the job page, is off while a run is going, queued or the prompt is blank, and runs the job once within a minute, also when the job is off, and the run appears in the job page's Runs row and sheet. The Weekly digest preset appears only while the list is empty. A job page has no switch: its header is a Section labelled with the account, holding the same single badge as the list, a filled Run now and a More menu (Edit focuses the name, Disable or Enable, Delete). The Allowed tools section has an Add connector button that opens a menu of Chrome and each shown MCP server (named with its scope, a check on those already allowed); picking one toggles it, and the allowed ones show as removable chips (unknown entries show their raw text). Every change saves at once, and an empty list saves as none. Below Allowed tools the job page has one Runs row: the last run's time and its badge (Running, Succeeded or Failed) with a chevron, or "Not run yet" with nothing to tap. It opens a sheet (Esc, the scrim, the back gesture or a drag closes it, and focus returns to the row) of the 10 latest runs as rows (time, duration and cost such as `12 s · $0.04`, and one badge); a row with output opens it on a tap, the latest starts open, and a run with no output is not tappable. The hub stores each run's cost in a `cost` column from the SDK result (empty for failed, interrupted and older runs). An opened run has a Copy button, and the latest run has a Search field that highlights matches, shows the count, and steps through them with Enter and Shift+Enter.

## Timeline and steering

Claude reports progress through a `set_status` tool added to every chat: current step, finished parts, next steps
and notes. The timeline shows one card per prompt: Claude's final reply, the files changed with line counts,
commands run and the first error of each failed one, commits, subagents, these notes and the steps behind them. Once a turn is finished, its files, commits, commands
and subagents fold into one line ("3 files +40 -2 · 1 commit · 5 commands, 1 failed · 2 agents") that opens on a tap,
so Review changes and Rewind files take one more tap; pending requests, blocked cards and notes stay visible, and a
running turn shows everything open.
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
- `/tries 3 <prompt>` (2 to 4) starts the prompt in that many new chats, each in its own worktree on a `tries/` branch
  off the default branch, so the best attempt can be kept. Paseo makes the worktrees; without Paseo they are plain git
  worktrees in a hidden `.tries` folder next to the repo. These show under Workspace and a clean one can be removed at once
- `@chat:` in the web composer lists the other chats by title; picking one inserts `@chat:<session id>`, and the server
  adds that chat's transcript path to the prompt so Claude can read it (the chat shows the prompt as typed)
- "Fork chat" in the chat settings menu (web and phone, or the palette) starts a new chat that carries the whole conversation so
  far, so two directions can be tried from the same point
- In the phone review pager, tapping a changed line opens the comment sheet, which also has Revert this change: the file
  is saved with that one block of changed lines put back to the last commit
- On the phone, the last reply of each finished turn has Save as note, which saves the chat title and the reply as a
  Codex note in the chat's profile (like Slack's saved messages)
- "Memory" in the phone chat menu lists the repo's CLAUDE.md, each account's CLAUDE.md and its memory files for the folder
  (name, description, where it comes from); a tap shows the file (like Windsurf's memories panel). Read-only, from /api/memory.
  The web has the same list under Memory in the chat settings menu
- On the phone, a prompt starting with ! runs as a shell command in the chat's last terminal (or a new one) and opens the
  Terminal page, as on the web
- Typing 3 or more characters in the phone Sessions search also searches every chat's prompts and replies (from
  /api/sessions/search, newest first, at most 3 per chat); a Messages section lists the matching text with the chat,
  You or Claude and the age, and a tap opens that chat, like Slack's message search
- "TODOs" in the phone chat menu lists TODO and FIXME comments from tracked files, with Aider-style comments that start or
  end with AI! (do this) or AI? (answer this) first; a tap puts a prompt for that comment in the composer
- Phone Sessions rows of a chat with an unsent draft start with a red "Draft:" and its first line, like Slack's sidebar
- "Remind me" in the phone chat menu adds an open task "Check <chat>" due in 1 hour, 3 hours or tomorrow at 9:00, linked to
  the chat; the hub pushes it when due (like Slack's remind me about this)
- "Share chat" in the phone chat menu sends the loaded prompts and replies as Markdown to the Android share sheet
- "Continue in terminal" in the same menu copies `cd <repo> && claude --resume <id>`, with `CLAUDE_CONFIG_DIR` for
  a Work account, to pick the chat up in the Claude CLI. Stop the chat first so two processes do not write to it
- "Rewind files" under the files of a turn puts them back to how they were before that prompt (later turns' edits
  go too); the conversation itself stays. On the phone, a prompt that changed files has the same Rewind files link under it
  while Claude is idle

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
- A Paseo worktree whose branch has a merged PR and nothing uncommitted shows Merged and can be removed at once

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

Agents in the More menu of the task box header opens a pane that lists the subagents of the chat with their status, elapsed time and tokens.
Click one for its report, prompt and steps. On the phone it is a tab of its own.
Agents started by a Workflow call are listed under a section named after the workflow, and update live while it runs, while the chat is open, also during a turn.
In Sessions, a live chat with running agents has an Agents section under its row; tapping an agent switches to that chat if needed and opens it here.

## Deep links

`?view=github` opens a sidebar view (explorer, changes, github, chats, sessions), `?page=observe` opens a page
(observe, deploy, mcp, settings), `?chat=<id>` opens a running chat and `?session=<id>` reopens a saved one. The parameters
are read once and removed from the address bar.

## Pages

Observe, Deploy and MCP Servers open as tabs in the editor area (the lower three activity bar icons, or the command
palette), so they get the full width instead of the sidebar. One page is open at a time; opening another replaces it.

Without a Grafana MCP server, Observe makes no Grafana requests. Observe's Grafana section shows a card per entry in a repo's `grafana.panels` (`{ title, query, unit }`, a PromQL query in
`~/.agentview/observe.json`): the last value, a 6 hour sparkline with min and max in the hover title, and a link to Explore.
A failing panel shows its error without affecting the others. With no panels, a button asks Claude to suggest some from the
service's dashboards. The refresh button reloads the panels too.

Observe's Settings section is a Section header (open by default only for a project with no saved config) with a JSON field and a Save button. The header shows a badge: Unsaved after an edit, Saved after a save, Failed with the error under the field when the JSON is invalid or the save fails. An edit made while saving is kept. Changing the project clears the badge.

Settings is a page of its own (activity bar, More sheet, palette). It has three groups, each a Section header over a grouped list. About holds a read-only App version row (the web build's short commit sha, or "Unknown") and a Design row that opens `/design`; the Design row shows in dev mode or when the hub runs with `ASSISTANT_DEBUG=1`. Appearance holds a Theme row showing Dark or Light; tapping it switches the theme, the same toggle and saved choice as the status bar icon. Phone holds an Installed version row (`0.1.0+<sha>`) and shows only in the phone app.

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
| j / k or arrows, Enter in Sessions | Move between chat rows (stops at the ends; with nothing focused j or k focuses the first row unless Tasks or a Reply queue ask is showing); Enter opens |
| ⇧⌘] / ⇧⌘[ | Next or previous open chat (Sessions view), wraps |
| j / k | Move between tasks in Tasks; Enter or Space opens, Esc closes, x done (or back to open on a done task), s snooze, Delete removes |
| j / k, Enter, s, x on a Reply queue ask | Move between asks, open the task, send the draft, skip the ask |
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
- In Codex, snack messages are announced, with "Undo available" when they have Undo. Goals, Related
  and the Slack DMs under Since <meeting> are lists, and Esc in a goal field restores its text

- Codex lists share design tokens in tokens.css: `--row-h` (40px), `--row-title` and `--row-meta` (md and sm type), `--meta-fg` (muted secondary text) and `--hairline` (1px separators). Task rows, section headers with counts and the Slack Summary page use them.
