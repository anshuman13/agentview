# Features

## Layout

- **Task box** (right): prompt, mode and model menus, context meter, and the timeline below it. A More menu at the
  right of its header holds Agents (the chat's subagents), what is waiting elsewhere, usage, the Mac name and advisor counts. ⌥⌘B hides it
- **Editor** (center): File tab follows Claude's edits and shows the diff against HEAD. Markdown files open as a rendered document with an outline, and the preview button shows the source. In the diff, a long press or a right click on a line quotes it into the composer as `path:line`; on a changed block the same gesture opens a menu with Quote line and Revert this change, which asks first and then saves the file with that block put back to the last commit (not offered for new or binary files). The pencil in the file bar turns the file into an editor; Save or Cmd+S writes it back (project files only, never inside credential folders). Gitignored `.env` files show in the explorer without the eye toggle. Browser tab shows your Chrome. Observe, Deploy and MCP open as further tabs here
- **Sidebar** (⌘B): Explorer, Source Control, GitHub Pull Requests, Sessions (open and recent chats; one bar holds the search box and a New session in a repo button) and Workspace (repos, chats, Paseo worktrees). In Workspace a repo with no live chat starts folded to its header, and a repo shows its 5 latest chats with Show more. The search box in both views finds chats by every word of the query across title, first prompt, repo and (Workspace) branch
- **Status chips** under the Sessions search (Running, Unread, Failed) replace the repo groups with a flat list of the
  chats in that state, open ones first; a second click clears it (like Claude desktop's status filter). With Unread on, Mark all read at the right of the chips marks every listed chat read (Slack's mark all read). On the phone the chips (Running, Needs you, Done) are only on a repo's page, with Mark all read after Done; the main Sessions page has just the Work and Personal chips
- **Chat rows** (Sessions view: Pinned, Needs you, repo groups, Recent): a title and one meta line (repo, the branch when it is not the default, then the Running status, "No activity for 15 min" or the time since last activity such as "3 h ago" or "yesterday", then the +/- counts of a finished chat; a chat with a pull request shows "#123" and, for the open chat's repo, a dot for its checks that opens the pull request on GitHub; the phone shows the number as text in the same line). Rows are not indented under their repo, are two lines at most and carry no badge: a dot before the title shows the state (amber Needs you, red Failed, pulsing Running, or the accent unread dot for Done, with that word as its label), and a bold title marks Done and Needs you chats. Failed means the last turn errored, cleared when the next turn starts; Done is activity since you last opened the chat. The state slot at the end holds one item: the run tag when the chat has a run that does not need you, else the bell-slash icon of a muted chat; a run that needs you shows only as the Needs you dot. A chat you did not rename whose first prompt starts with @mentions is titled by its first line without them (the next non-empty line, then "About store.ts" for a file or "Follow-up chat" for a chat), at most 80 characters. A repo group header is one line: the repo name, at most one count badge (Needs you, else running, else unread) and New chat; a chat starting in a collapsed group opens it for 8 seconds without changing the saved collapse state. The time you last opened each chat is kept in `~/.agentview/seen.json`, so opening a chat clears its Done badge on every device; a chat with no entry is never Done. The Sessions tab dot and the sidebar count cover open chats other than the one you are viewing that are Done or Need you, plus attention items. Repo groups list a group with a Needs you chat first, then the rest by latest activity, and the order holds while a chat is open, except that Needs you groups still move to the top. Chat rows take keys: j / k or arrows move between rows and Enter opens one, and ⇧⌘] / ⇧⌘[ (Ctrl+Shift off Mac) view the next or previous open chat in row order, wrapping, and ⌥⇧↓ / ⌥⇧↑ view the next or previous open chat that is Done or Needs you (Slack's jump to unread; "No unread chats" when there is none). One More button opens a menu: Retry (Failed chats; on the phone also Resume for a stalled chat), Pin or Unpin, Mark as unread (a saved chat with no state that you are not viewing; it stores 0 as the seen time, so it shows Done until opened; the phone row menu has it too), Mute or Unmute (Slack's mute: no "Claude finished" browser notification for that chat, Needs you still notifies; kept per browser, and the phone row menu has the same Mute for its notifications; a muted row shows a bell-slash icon), Copy link (`<origin>/?session=<id>`, on the phone too), Rename, Open beside (desktop), Close chat (open chats), Archive. Retry opens the chat and resends its last prompt as a new prompt. Open beside shows that chat in a second column with its own composer (`?beside=<chat id>` does the same); the arrow in its header moves it to the main column. Rename edits the title in place (Enter or leaving saves, Esc cancels); a double click on a chat title (desktop) or a long press on the row (phone) starts the same edit; a long press on a chat row renames and does not open the menu. The rename is written to the transcript, so it survives reload. A live chat with running agents shows a collapsed Agents section under its row with the count; opening it lists each agent with its name, Running (and the workflow name) and elapsed time, and a tap opens that agent in the Agents pane of that chat. Archive always moves the chat to the bin, whatever its age, and the bin keeps it for 24 hours
- **Spec tasks**: a rendered Markdown file under `.claude/specs/` or `.kiro/specs/` with `- [ ]` or `- [x]` lines (web editor and the phone file view) gets a Tasks header with an "N of M done" badge (plus "· 1 in progress" when a task is marked) and a Run menu with "Run all in this chat" and "Run as goal…", hidden when every box is ticked. Each open task has a Start button, or an "In progress" badge when its line ends with ` (in progress)`. Start sends "Do task <n> in <path>: <text>. While you work, append " (in progress)" to its line. When done, tick its box and remove that suffix in one edit before moving on." to the chat, queued while Claude runs, and Run all in this chat sends a `/goal every task in <path> is ticked` with the same ticking rule. The spec prefix of "Start with a spec" carries the rule too, so Claude ticks each box right after finishing the task. The counts follow the file as boxes are ticked (the web editor reloads on `file_changed`, and the phone file view reloads the open file on the same event), and the phone buttons are disabled in read-only mode. The parser is `shared/specTasks.ts` with `shared/fixtures/spec-tasks.json`, mirrored in `workspace/FilesLogic.kt`
- **Start with a spec**: the palette command "Chat: Start with a spec" sets plan mode and fills the composer with a prefix that asks for `.claude/specs/<slug>.md` (numbered, testable Requirements, Design, and Tasks as `- [ ]` lines) and a stop for review without code changes; it does not send. On the phone the New chat sheet's Start as has a fourth choice, Spec, that sets plan mode and puts the same prefix in the new chat's composer. The text is `specPrompt` in `shared/specTasks.ts` with `shared/fixtures/spec-prompt.json`, mirrored in `workspace/FilesLogic.kt`. The Spec card in a chat also has a "Review with fresh eyes" More item (a row on Android) that sends `/spec-review <path>` (`specReviewPrompt` in `shared/specTasks.ts`, never a driver command, not in the slash menu): the agent starts two subagents that see only the spec, one reading it cold and listing what it had to guess, one checking the paths, names, routes and test commands it names against the repo. Chats whose driver has no subagents (Codex, the `subagents` capability) show the row disabled with "Needs subagents, not in this chat"
- **Chat transcript**: opening a chat sends its last 150 events; the rest is paged in on demand. The Show earlier row at the top reads "Show earlier (N hidden)"; tapping reveals rows the window hides, then loads 150 older events ("Loading earlier" while it runs, taps ignored) and keeps the scroll on the same row. A chat that opens with fewer than 3 replies loads earlier pages by itself, up to 3 pages, and stays at the bottom; a failed page is not retried by itself. The last 30 rows paint first and the rest follow in steps of 30 with the scroll held, and settled replies keep their rendered markdown so a revisit does not parse them again. The last 150 events of the 8 most recently viewed chats are kept, so switching back shows them at once while the server's init is on its way. The row is gone at the start of the held history, and a failed load shows a notice and leaves the row for a retry. A prompt you sent that needs more than 6 lines at the current width shows 6 lines with Show more / Show less under it (web keeps an opened prompt open across reloads, the phone across rotation); images and the queued bubble never fold.
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

- **Tabs**: a quick sideways swipe moves between the Codex, Chat, Sessions and Agents tabs, and the new tab slides in from its side. The tab bar shows a count only on Chat (waiting); Codex (Needs you rows plus Reply queue rows), Sessions (chats elsewhere that are Done or Need you) and Agents (agents running in the chat on screen) show a dot. Every badge reads one count store (`appCounts` in `shared/counts.ts`, mirrored on Android), so the tab dots, the activity bar, the status bar, Overview and the MCP numbers agree
- **Bottom bar**: at max-width 900px the tab bar is a floating pill with a filled pill on the selected tab, and the chat composer is a pill row: + on the left (Add files, Use an MCP server, Model and mode with the current mode text), the text in the middle (the pill becomes a rounded box above one line) and a mic while empty, Send once there is text, or Stop while running. While you compose in Chat the tab bar slides away, from focusing the field until you blur it with an empty message or close the keyboard on an empty one; a draft keeps it hidden, and the other tabs always show it. On a window without touch there is no keyboard signal, so the bar stays hidden from focus to blur. The rule is `barState` in `shared/bottomBar.ts` (`BottomBarLogic.kt` on Android). The Android app has the same bar and composer; its + sheet holds Photo, Take photo, Chat settings and the context percent
- **Installing on the phone**: `bun run native` tests and builds the native app, copies it to `dist/AgentView.apk` (served at `/api/app.apk`) and prints its path; `bun run native -- <adb serial>` also installs it
- **Launcher badge**: the launcher icon shows the Needs you count, the list plus the Reply queue rows (up to 99), when the phone build has the badge plugin, and nothing on the web
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
- Needs you is one row with a count badge and a chevron, shown only when the count is above zero. The count is the Needs you list plus the Reply queue rows. The row opens a bottom sheet headed Needs you with the total, then Tasks, Asks and Replies, each with its own count (a group with no rows is left out; the total ignores the older-than-3-days filter); Esc, the scrim, a drag down and the back gesture close it and focus returns to the row, and it closes by itself when the count reaches zero. From 901px wide it opens as a centred dialog instead of a bottom sheet. Rows carry no badge (Overdue and At risk lead the meta line); a DM or Slack row has no X, its More menu ends with Nothing asked and Dismiss and a left swipe dismisses it with Undo. Dismiss syncs across devices: a dismissed DM stops waiting until its next message, and a dismissed bullet is stored on its Slack summary. Nothing asked (also on asks, with Dismiss or Not mine after it) is the manual triage for an FYI: an ask becomes a note, a DM or Slack bullet is saved as a note in Wiki > Notes and the row leaves the sheet at once, with a "Saved as a note" snack and Undo; a failed write keeps the row and says so, and it is disabled in read-only mode on the phone. Tasks holds overdue and at-risk tasks and the open actions of meetings that ended in the last two hours; Asks holds asks and promises to confirm, Slack DMs waiting on me, the latest Slack summary's "Needs you" bullets, each once (three or more overdue collapse into one row with Move N overdue to today in the Tasks header), "Just ended · title" rows with Copy follow-up and Notes in the More menu, one row "N asks older than 3 days" that filters the Reply queue to them, and one row "N wiki claims wait for you" that opens the claim review; each group shows 5 rows then Show all N
- Running is a Section with a count and one grouped list of the chats that run or wait on me (waiting first; a chat waits when its header says Needs you or its run needs you, and a stalled chat is neither), shown between Needs you and Today and hidden when none does. A row is the chat title, the folder and what it does (the status line, or Waiting for you), a Running or Needs you badge; tapping opens the chat. The phone keeps the rows of the last sync on the device and shows them at once on open, then pulls only what changed
- Today is a Section and one grouped list of the rest of today's meetings and the open tasks due today or overdue, overdue first, then in time order; a task already in Up next or in Needs you as at risk is left out. A meeting row is its title and time, with a Live badge while it runs, and opens the meeting; in the 10 minutes before the start, a meeting with a link shows "Starts in N min" and a Join button that opens the link in a new tab. A task row is its title and due time (a Late badge when overdue), a check button (Done with Undo) and a More menu (Snooze to tomorrow with Undo, Open). Seven rows show, then Show all N expands the list in place. Once a task is done today the header also shows a quiet "N of M done" badge, M being N plus the open tasks due today or overdue (at-risk ones included, meetings not)
- The Overview ask bar is one input line with mic and send while idle; the recipe chip (Prep next meeting within an hour of one, Draft my weekly update on Thursday and Friday afternoons, otherwise Plan my day, What's next or Wrap up my day) appears on focus, and the Task/Ask, profile and When? chips appear once there is text. A personal ask also sends my personal meetings from today to three days ahead and asks the chat to suggest alternatives and change the calendar only after confirmation
- Summary page (not in the nav; reached from a Slack row in Needs you and the palette): a TickTick-style report with Date (Today, This week, Last week, This month) and Status (All, Completed, Not completed) rows, Completed and Not completed Sections of task Rows (day as meta) that open the task, and a Copy button for Markdown; below it a link to the Slack asks to review; chats with a summary in the range grouped into DMs, Mentions and Channels Sections, 5 rows each then Show all N; the Sonnet summary folded to 8 lines; and Summarize.
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
An event (a calendar row with no other people and no call link) opens an Event page: its title, the time, My notes and My actions with an add input, and no Summary, Decisions, Prep, Transcript or More.
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

The wiki is built from claims with sources, which show as kind chips (Slack, Linear, PR, Doc, Meeting, Chat; the label is the tooltip) that open in a new tab, and which can be edited, contested and go through Review. The wiki start page is a search and one grouped list per section that has pages (Teams, Projects, People, Practices, Pages); a row is the page tile and the title, with one Needs you badge (Needs review) when the page has a proposed claim, and no meta line; its More menu holds Open and Archive (Archive retires the page with an Undo snack; its claims stay). The header has New page (one title field at the top of the list; Enter or blur creates the page in Pages and opens it, Esc cancels) and a More menu with Feed, Notes and Ask, each opening a bottom sheet; an empty wiki shows No pages yet with New page. Memory is reached from search hits and claims. The start page also shows To review: one card per page with proposed claims (the first 3 claims and Read all N, Approve all or Reject all; a decided card stays in its slot as a stub while the list is open) and the first 3 loose claims (Show N more). The Overview row "N wiki claims wait for you" and the One at a time button open Review claims: one claim at a time with its page, sources, big Reject, Skip and Approve, "n of N", swipe right to approve and left to reject; a skipped claim comes back at the end. On a page, each heading is a section with its claim count (without the pending claims) above a grouped list of claim rows (claim text up to 2 lines, then one meta line with Proposed or Contested by and one source chip, no date; no row has more than two actions). A normal claim has a More menu (Edit, Cite, Contest, Resolve while contested, then the other sources, the mentions, Open Claude chat and a disabled Updated date line, Retire last; a long press on the row opens it, as a bottom sheet on phones); a proposed claim has Reject and Approve and swipes the same way; a stale claim has Confirm and More (its date line reads Still true? Updated <date>); a retired claim has More with Restore last. A heading with 2 or more proposed claims gets Approve N. Search hits are rows with the page title as meta. Decisions within 8 s share one Undo ("4 in a row"), and a batch of 5 or more keeps Undo up for 10 s. The start page also shows, in one closed
fold, Needs a look: claims untouched for 90 days (Stale) and claims a later meeting decision may have changed (Maybe changed), unless a
proposed replacement already waits in Review; each list shows 3 rows and +N more. Feed (Recently updated) shows 5 rows and labels only contested ones. The start page search filters pages and claims as you type, and a claim hit opens its page at the claim. On a page, each current claim's More menu lists its mentions: open tasks (by due time) and then meetings (newest first, with the day) whose text names the page title as a whole phrase and shares a key word with the claim; a claim with no match lists none. A wiki page header is the page title with a Propose claim button and a More menu (Rename, Ask, which opens a bottom sheet with the Ask field, Review while the page has proposed claims, Copy as Markdown for the live claims and their source labels, Archive; Memory has no Rename, Ask or Archive). Propose claim opens a field that saves a proposed claim for Review (Undo removes it); Archive retires the page, returns to the start page and has an Undo snack. In Older, a live claim past 90 days shows Confirm (sets its date to today, so it returns under its heading and Claude uses it again; Undo restores the date) and a More menu with Edit, Cite, Contest and Retire, whose date line starts with Still true?; the Older header adds an N to confirm badge and stays closed. For meetings and Slack channel decisions of the last two weeks the hub
proposes the updated claims for Review (again if a meeting is re-synced with different decisions), marked From <meeting>, From #channel or From chat <title>. A chat that stayed idle for 5 minutes after a message of yours is read by the hub, which proposes up to 3 preferences or corrections you stated as Memory claims (see [codex-wiki.md](codex-wiki.md)).

### Jobs

The first Jobs row is Autopilot (Reply for me in Slack): its mode in one line and a Switch; a tap opens its page, a grouped list of Away, Covers, Never answers, Model, Dry run and Activity, each with its value. All but Dry run open a bottom sheet (Activity holds the Seen list and the spend); the info button explains how it works. See [autopilot.md](autopilot.md).

Each Jobs list row is one line of title and one line of meta: the schedule in words and the next run, nothing else. A row has at most one badge, in the order Running, Queued, Failed (the latest run failed), Off (disabled). It has no Run now button; a More menu holds Run now, Edit, Disable or Enable, and Delete (soft delete with an Undo snack), and on phones a long press on the row opens the same menu. There is no switch or last-run line; the runs are on the job page. Run now, on a row or the job page, is off while a run is going, queued or the prompt is blank, and runs the job once within a minute, also when the job is off, and the run appears in the job page's Runs row and sheet. The Weekly digest preset appears only while the list is empty. A job page has no switch: its header is a Section labelled with the account, holding the same single badge as the list, a filled Run now and a More menu (Edit focuses the name, Disable or Enable, Delete). The Allowed tools section has an Add connector button that opens a menu of Chrome and each shown MCP server (named with its scope, a check on those already allowed); picking one toggles it, and the allowed ones show as removable chips (unknown entries show their raw text). Every change saves at once, and an empty list saves as none. Under Prompt a Repo section has a Pick repo button that opens a menu of the main checkouts (a check on the current one, None last); the picked repo shows as one removable chip, and while one is set Allowed tools is hidden and the hint reads "Runs in a new worktree of <name> on the hub's Mac. Nothing is pushed until you approve it." Such a job opens an unattended chat in a new worktree instead of reading (see [autopilot.md](autopilot.md)), sandboxed to that worktree with no Chrome, no connectors but AgentView's and only the hosts of the `unattended` settings key, so a commit fails there and changes stay uncommitted; on the phone the job page shows a read-only Repo row. Below Allowed tools the job page has one Runs row: the last run's time and its badge (Running, Succeeded or Failed) with a chevron, or "Not run yet" with nothing to tap. It opens a sheet (Esc, the scrim, the back gesture or a drag closes it, and focus returns to the row) of the 10 latest runs as rows (time, duration and cost such as `12 s · $0.04`, and one badge); a row with output opens it on a tap, the latest starts open, and a run with no output is not tappable. The hub stores each run's cost in a `cost` column from the SDK result (empty for failed, interrupted and older runs). An opened run has a Copy button, and the latest run has a Search field that highlights matches, shows the count, and steps through them with Enter and Shift+Enter.

## Timeline and steering

Claude reports progress through a `set_status` tool added to every chat: current step, finished parts, next steps
and notes. The chat shows each turn as its prompt and Claude's final reply, with the turn's work folded into one row
above the reply: "12 tools · 3 files · 1 agent · 2m · $0.40", plus "N failed" in the error colour when a tool failed; a fold with no tool work is titled by what it holds ("Session started with claude-fable-5-1", else "3 notes"), with no duration or cost. The row
is a faint small line at the right edge, boxed only while open, closed by default and kept open per device (id `work:<turn>`); opened, it lists the turn's steps, Explored groups, files,
agents and earlier text in order. A running turn shows a spinner and counts that grow, and no duration. Blocked and Review
cards, error system rows, spec and sketch cards stay visible, and pending requests, the loop card and the to-do card stay above
the composer. A turn with nothing to hide has no row. The More menu's Show work switch (per device, off by default) turns
the folds off and shows every row. The web and the phone share the rule (`workFold.ts`, `WorkFold.kt`).
A chat row in the Sessions view shows the chat's
cost so far. The status bar usage tooltip adds a Spend block with today's and the last 7 days' cost per model across the chats open on the Mac (today is the Mac's day). Spend from before a host restart is not counted, since history reloaded from the CLI transcript has no cost, and a chat past the event cap is approximate because trimming old events counts the first kept total again.

- Sending while Claude works stops whatever it is doing, including an open permission or question, and continues
  with your message
- A message is one request to the Mac and lands or fails visibly; it returns to the box after three failed tries
- Editing the next steps sends the new plan at Claude's next tool call, without stopping it
- On the web the chat's state sits at the right of the chat header ("Idle · 2m ago", "Waiting for you", the live status); the bar under the transcript shows only while a turn runs, a step list exists or a usage limit offers Continue at
- The composer shows "No update for Ns" when nothing has arrived from the server for 30 s. The link reopens by
  itself after 50 s of silence, and a message that cannot be delivered goes back into the box with a notice
- A subagent shows in the chat as a collapsible box: a chevron, its description, a meta line (type, duration once it ended, step count), one Badge (Running, Done, Failed or Skipped) and a summary under the header, clamped to 2 lines. While it runs the summary is the SDK's one-line progress, refreshed about every 30 s, until the first one the last step; once it ends it is the first line of the report. A running agent has a Stop button in the header. Boxes start collapsed; the body shows the steps and the report on the web, the last 3 steps and a Steps and report row that opens the Agents pane on the phone. A build agent's live card follows its box on the phone, not inside the box. Every transcript box (agents, the loop card, spec cards, Explored groups) collapses from its header, and whether it is open is kept per device for the 300 boxes saved last. Summaries are on for Claude chats only (not Codex or OpenRouter), and each costs a small cached fork of the agent every 30 s
- Questions, plan approvals and permissions show as buttons in the chat
- A plan approval card splits the plan into paragraphs; tapping one stages a comment on it. Keep planning with comments
  sends one message that quotes each commented paragraph (first 80 characters, as `> ...`) followed by its comment, and
  without comments just declines the plan
- The latest to-do list Claude wrote (TodoWrite) shows as a card above the composer: "3 of 7" and the item in progress,
  tap for every item with its status. It hides when there is no list, or when all items are done and the turn has ended.
  A chat row in Sessions adds "3/7" to its meta line while the list has items left
- A hook that blocks a tool or fails shows in the chat in the error colour, for example "Hook blocked Bash: reason" or
  "PostToolUse hook failed: reason". Hooks that run fine show nothing
- Opening a chat with activity since this browser last showed it puts a "Since you last looked" line above the
  cards: turns, files changed, failed commands and whether a permission is waiting. Tap it to dismiss
- `/tries 3 <prompt>` (2 to 4) starts the prompt in that many new chats, each in its own worktree on a `tries/` branch
  off the default branch, so the best attempt can be kept. Paseo makes the worktrees; without Paseo they are plain git
  worktrees in a hidden `.tries` folder next to the repo. These show under Workspace and a clean one can be removed at once
  Each try's prompt ends with the ROUND instruction, and the parent chat gets a `tries` run: every try's report is a round
  ("Try 2: ..."). The Open board button on the parent's loop card shows the tries board: a
  column per try (stacked on the phone) with its branch, state, last report, diff size and cost, Open (reopens an idle-closed
  chat) and Keep try N, which asks "Archive the other N chats? Their worktrees stay on disk." The web board also has a
  Send to all field that messages every try still in the run, reopening closed ones. When every try has reported, the
  parent chat gets one turn ("All N tries reported") that compares them and recommends one with a ROUND line, and the run
  ends ("all tries reported"); it also ends when the parent chat closes or on Keep
- `@chat:` in the web composer lists the other chats by title; picking one inserts `@chat:<session id>`, and the server
  adds that chat's transcript path to the prompt so Claude can read it (the chat shows the prompt as typed)
- "Fork chat" in the chat settings menu (web and phone, or the palette) starts a new chat in the same folder and model
  whose first prompt asks Claude to read the old chat (through `@chat:`) and summarise it in at most 15 lines, so the work
  continues from a short brief instead of the full context
- In the phone review pager, tapping a changed line opens the comment sheet, which also has Revert this change: the file
  is saved with that one block of changed lines put back to the last commit
- Replies have no action buttons on the web or the phone; on the phone a hairline divider separates each prompt from the turn before it
- On the phone, the composer's settings chip opens Chat settings with the models listed directly (one tap picks), then
  Goal and Build cycle rows, the permission modes (Supervised follows Auto), Account and Effort. The model you pick
  becomes the default for new chats, including the New chat shortcut. The web chip opens the same settings as a pick
  (Permission mode, Model, Effort, Claude account, Goal, Build cycle, Side chat, Remind me, Fork chat, Copy as Markdown,
  Tools…); its Tools… pick holds Saved prompts, Memory, Hooks, TODOs and Continue in terminal, and the phone's chat menu
  has a Tools… sheet with Images, Dev servers, TODOs, Memory, Hooks and Continue in terminal
- In the web and phone transcripts, 3 or more finished Read, Grep and Glob steps in a row fold into one row such as
  "Explored 4 files, 2 searches"; the header opens the steps, and the group keeps its choice like any transcript box
- On the phone, the New chat sheet has Start as: Auto (the default for new chats), Plan first or Spec (plan mode with the spec prefix in the composer), for every provider (Plan first starts a Codex chat in Default). The mode is set right after the chat opens
- Review each turn (the Supervised choice in the permission mode list of web and phone Chat settings, which sets Auto and turns review on; picking another mode turns it off; the Chat: Toggle Review Changes palette command and Shift+Tab leave it alone, so a chat can show "Plan · Review") lets Claude edit freely, and after a turn that changed files adds a
  Review N changes card with each changed file's hunks against the file as it was before the turn. Each hunk has Keep and
  Undo, each file Keep file and Undo file, the card Keep all; once everything is decided it shows "Kept 3, undid 1".
  The server reads a file's text in a PreToolUse hook before the first Edit, Write, MultiEdit or NotebookEdit of the turn,
  and Undo puts the hunk back in the file's current text, so a card still works after you send a new prompt. A hunk edited
  since says "This change was edited since; open the file to undo it". Undo file on a new file deletes it; binary and
  files over 1 MB can only be kept. The setting and the open before-texts live in the host's memory, so a host restart
  ends both
- Phone Settings has Notification types under Notifications: it opens Android's page for the app, where Approvals, Finished
  chats and Failed chats are separate channels to turn off or give their own sound
- "Memory" in the Tools sheet of the phone chat menu lists the repo's CLAUDE.md, each account's CLAUDE.md and its memory files for the folder
  (a Codex chat lists the repo's AGENTS.md, or CLAUDE.md when there is none, and ~/.codex/AGENTS.md)
  (name, description, where it comes from); a tap shows the file (like Windsurf's memories panel), from /api/memory.
  The web has the same list under Memory in the Tools pick of the chat settings menu. Only the repo instruction file (the first in the chat's `instructionFiles`) can be changed: its file view
  has Edit (the web opens it in the editor tab with the pencil on; the phone shows a field with Save), and the list ends with
  an Add a rule field whose Enter appends `- <text>` to it (created if missing) and shows Rule added with Undo; a failed write
  says "Could not save the rule. Your text is still here." Account and memory files stay read-only
- On the phone, a prompt starting with ! runs as a shell command in the chat's last terminal (or a new one) and opens the
  Terminal page, as on the web
- Typing 3 or more characters in the phone Sessions search also searches every chat's prompts and replies (from
  /api/sessions/search, newest first, at most 3 per chat); a Messages section lists the matching text with the chat,
  You or Claude and the age, and a tap opens that chat, like Slack's message search. The web sidebar Sessions search
  shows the same Messages list under the repos
- Hovering a sent prompt in the web transcript shows Use again, which puts that prompt in the composer to edit and send
  again (like editing a Slack message); queued and stopping prompts do not have it.
- Scrolled up in a web chat that is running or has new rows, a Jump to latest button shows, with the count of finished
  replies that arrived since you scrolled up ("Jump to latest · 2 new replies"), like Slack's new messages pill. The phone's
  Jump to latest shows the same count
- The web transcript draws Slack-style day dividers (Today, Yesterday, "Tuesday 3 November") above each prompt that starts a
  new day, like the phone; a chat that stays within today has none
- "TODOs" in the Tools sheet of the phone chat menu lists TODO and FIXME comments from tracked files, with Aider-style comments that start or
  end with AI! (do this) or AI? (answer this) first; a tap puts a prompt for that comment in the composer. The web Tools pick has the same TODOs list
- Prompt hooks come from `~/.agentview/hooks.json`, keyed by repo folder name like `autofix` in attention.json:
  `{"myrepo": [{"name": "tests", "on": "stop", "prompt": "Run the tests"}, {"name": "lint", "on": "save", "glob": "src/**/*.ts", "prompt": "Lint it"}, {"name": "docs", "on": "manual", "prompt": "Update the docs"}]}`.
  `save` queues the prompt with the path when a matching file changes between turns (once per 30 s per hook), `stop`
  queues it when a turn that changed files ends, and `manual` hooks are listed under Hooks in the Tools sheet (phone) and
  Tools pick (web), where a tap queues them. The prompt shows in the transcript as "Hook: <name>". A hook turn never
  triggers stop hooks, nothing fires while a permission or question waits, and without the file or an entry for the repo
  no hook exists (an invalid entry is skipped with a log line)
- Phone Sessions rows of a chat with an unsent draft start with a red "Draft:" and its first line, like Slack's sidebar; web sidebar rows of open chats do the same, except for the chat you are viewing
- "Remind me" in the phone chat menu adds an open task "Check <chat>" due in 1 hour, 3 hours or tomorrow at 9:00, linked to
  the chat; the hub pushes it when due (like Slack's remind me about this); the web chat settings menu has the same Remind me
- Opening a chat with replies or steps since you last saw it shows a red New line above the first of them, like Slack's
  unread divider: on the web from the seen time before this page opened the chat, on the phone from when the phone last showed it
- "Copy as Markdown" in the web chat settings menu copies the loaded prompts and replies under the chat title
- "Share chat" in the phone chat menu sends the loaded prompts and replies as Markdown to the Android share sheet
- "Side chat" in the same menu, or ⌘; (Ctrl+; off Mac), forks the chat into the side column and keeps the original in the
  main column, so a side question does not land in the running chat (like Claude desktop's side chat)
- "Continue in terminal" in the Tools pick of the web chat settings menu copies `cd <repo> && claude --resume <id>`, with `CLAUDE_CONFIG_DIR` for
  a Work account, to pick the chat up in the Claude CLI (the server builds the line, `session.resumeCommand`). Stop the chat first so two processes do not write to it. The phone Tools sheet has the same Continue in terminal, copying to the clipboard
- A prompt that changed files has a Rewind files link: on the web under the turn's last reply, on the
  phone under the prompt, while Claude is idle. It puts the files back to how they were before that prompt (later turns' edits go
  too); the conversation itself stays

## Review findings

"Ask Claude to review" on a pull request and the inbox's review prompt run `/code-review <number>`. The findings
it reports show up in the pull request's pane, most severe first: a row opens the file on that line, Fix sends
the finding to the chat, Dismiss hides it for good (kept per repo in `~/.agentview/findings.json`). "Review changes
with Claude" in the Changes view and "Review changes" in the chat menu (web and phone; off while Claude runs or when no file changed)
run `/code-review` on the working tree; those findings show at the bottom of the Changes view.

In the web Changes view ⌘-click (Ctrl-click) toggles a file into a selection and Shift-click picks a range within
one section. Discard, Stage and Unstage on a selected row then act on every selected file in that section; Esc
and any git action clear the selection. The phone has no multi-select.

The spec review reports under the target `spec:<slug>`, shown as a Findings section in the opened Spec card (web and phone): the row opens the spec on that line on web and the file on the phone, and Fix makes the agent edit the spec. A repeat review replaces the list and keeps dismissed findings hidden.

A pull request Claude opened with `gh pr create` stays linked to its chat: the pull request row shows "Open chat"
while that chat is open.

Merge when checks pass is a per-PR switch in the pull request pane (web Row, phone More menu), off until you turn it on
and confirm. The server (`integrations/automerge.ts`, entries in `~/.agentview/automerge.json`) checks each armed PR every
60 s and runs `gh pr merge --match-head-commit <head>` once nothing is draft, conflicting or waiting for review, no check
failed or is pending and at least one check passed. A new commit or a re-run is picked up by the next poll. The row shows
why it waits, a merge posts "Merged in <repo>", and a failed merge posts "Auto-merge failed" and stops until you turn it on again.

## Context

The meter shows the tokens in context and turns red past 200k, or past 80% of the model's context window when the agent
reports one (Codex does). AgentView then compacts the conversation when the turn ends.
A failed compact is retried once the context has grown by another 20k tokens.

## Models

New chats start in Auto mode: Claude asks only before risky actions.

The model menu (web and phone) lists the newest version of each family, models without a version and the current
model; **Older models** ("7 more") shows the rest (`newestModels` in `shared/providers.ts`).

**Build** in the model menu (last item, never checked, Claude chats only) starts the build workflow (spec, review,
implement, test) on the brief in the composer. It sends the brief inside a prompt that asks for the Workflow tool, so
the spec cards show the build agents, and the chat's model stays as it is. While Claude works it queues like a normal
message and never steers. With an empty composer it shows "Type the brief in the composer first", and during an upload
"Wait for the upload to finish". The prompt asks for the `/agentview:build` skill of the [build kit](#build-kit), so it
works in any repo.

Any chat can ask Fable 5.1 about a hard problem. Each call needs your approval.

**Effort** in the same menu (or the palette) sets how hard the model thinks, from low to max, per chat. New chats start at medium. The footer
pill shows the current level next to the model.

**OpenRouter**: Settings has a Models section with an OpenRouter key (masked after saving), one OpenRouter model id for
each Claude slot (Opus, Sonnet, Haiku, Fable) and the default slot. They are saved in `~/.agentview/openrouter.json`,
never in the repo. With a key and at least one model, the model menus (chat settings, new chat, palette, phone) list
those models by their OpenRouter id next to Claude's. Picking one runs the Claude Code CLI against OpenRouter; picking
it in a running chat restarts the CLI on the new provider (and says so), so stop the chat first. Each chat remembers its
provider, and a chat without a mark runs on Claude. An OpenRouter chat has no plan usage bar, no cost (the SDK prices
are Anthropic's), no Build, effort or Fable agent and no account menu, because the controls a driver lacks come from
the chat's `capabilities` and are hidden on web and the phone. Without a key nothing new shows. Rows of a chat on OpenRouter or Codex show the provider name before the time, and where a cost would show an
OpenRouter chat shows "-" and a Codex chat "Plan"; the Spend list says such chats are not priced.

**Codex**: chats can run on the Codex CLI with a ChatGPT plan (`codex app-server`, one process per chat). Sign in once with
`codex login` on the Mac; until then Settings shows Codex as "Run codex login on this Mac" and the palette entry only says
so. Start one from the command palette (Chat: New Codex Chat) or the Provider section of the phone's new chat sheet. The
"New chats" select in Settings (Models on web, Providers on the phone) sets the provider a chat starts on when none is picked
(`defaultProvider` in settings.json); Fork chat and tries keep the parent's provider. The
model menu lists Codex's models and the effort menu only the levels the chosen model lists. The permission menu and Shift+Tab
offer the provider's own modes: Default (asks before leaving the workspace sandbox), Auto (never asks, network on) and
Read only (only reads), with no Plan; Plan first and Spec on the phone's new chat sheet start in Default. Approval cards work as for Claude (Always allow lasts for the session). Commands, file changes
(shown as edits with diffs) and MCP calls appear as steps. The usage bar shows the plan's 5-hour and weekly windows;
there is no cost. No rewind, Build or stop task. Codex chats are listed with the sessions (marked Codex), reopen with their
transcript, and are kept in `~/.agentview/codex-chats.json`. Codex chats get the same AgentView tools as Claude ones
(status, wiki, data, chat search, report findings) from a stdio MCP server the host starts for the chat, and the same
instructions; the review buttons send a prompt that ends in report findings, and a plan change reaches the agent
mid-turn. Continue in terminal copies `codex resume <id>` (an OpenRouter chat has no such row). The MCP page of a Codex
chat probes the servers in `~/.codex/config.toml` (read through Codex's own `config/read`), has no Add, Disable or Log in
and no claude.ai connector rows, and says "Edit ~/.codex/config.toml, then Reconnect". Observe reads the same list: its
Ask buttons name the chat's provider and are disabled with "Add <server> to ~/.codex/config.toml" while the server is
missing there. Not yet for Codex: `/compact`, chat search and @chat mentions.

## Workspace

Repos come from the `roots` and `personalRoot` folders in `~/.agentview/settings.json` (default `~/workspace`). `AGENTVIEW_ROOTS` (colon-separated) overrides them.
Chats start only inside these folders or Paseo worktrees.

- Chats keep running in the background. Ones that need you are marked and listed first
- Failing CI on your pull request shows under Needs you, and once autofix is on a fix chat starts by itself, once per pushed
  commit; the item then says "Fixing in" with the chat and opens it. `autofix` in `~/.agentview/attention.json`
  limits that to the listed repo names, `false` or no key leaves it off. The commit to chat map is kept in
  `~/.agentview/autofix.json`, so a restart does not start a second fix chat for a commit
- A chat closes after 10 idle minutes with no one viewing it. Reopen it from Recent
- Chats and Paseo worktrees idle for 12 hours can be deleted (worktree branches are kept)
- A Paseo worktree whose branch has a merged PR and nothing uncommitted shows Merged and can be removed at once

## Notifications

When a chat asks a question, needs a permission or finishes a turn, AgentView notifies you. On the Mac the server
shows a system notification with a sound if no window is viewing that chat, at most one per chat every 30 seconds;
clicking it opens that chat in the browser (a GitHub item opens the Sessions view).
The browser shows its own notification while the tab is hidden; clicking it opens the chat. The bell in the status
bar turns browser notifications on or off.

On the phone, an approval for Edit, Write or MultiEdit shows the file name and "+N -M" in the title and the first 8 changed lines (prefixed + or -) in the expanded text, so you can decide from the shade.

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

## Plan, spec and build

Four ways to have a change built, lightest first:

- **Plan first** (permission mode Plan, or Start as Plan first on the phone): Claude writes a plan and waits in plan mode; approving it lets Claude build in the same chat. For a change small enough to read as one plan.
- **Start with a spec** (palette "Chat: Start with a spec", Start as Spec on the phone): Claude writes `.claude/specs/<slug>.md` with Requirements, Design and `- [ ]` Tasks, then stops. Open the file to see its Tasks header: Start on one task, or Run all in this chat or Run as goal for all of them. For work you steer task by task.
- **[Build cycle](#build-cycle)** (chat settings, Up to N rounds): plan, build and test rounds in the chat, with Sonnet testing what Opus built. No spec file.
- **Build** (model menu, last item, or asking Claude to build a feature): the `/agentview:build` skill of the [build kit](#build-kit). The pm agent writes the spec, the spec reviewer checks it (with a cold reader and a scope check in the first round), a designer sketches the screens of a UI spec, you approve the spec and the sketch, an implementer builds it on a branch in a worktree, a tester checks each acceptance criterion and a code reviewer reads the diff. Claude then cherry-picks what passed onto the main branch.

A build shows as its [Build card](#build-card) in the chat that started it: a strip of steps (Spec, Spec review, Sketch, Your approval, Implement, Test, Code review, Merge), the step that needs you or is running, and the acceptance criteria counts. Tap a step to open its sheet; Your approval is where you approve or request changes, phase by phase. A goal can also run a spec: Run as goal on the Tasks header starts `/goal every task in <path> is ticked`, shown on its loop card like any goal.

The sketch and the approval are optional. By default a spec with a (UI) acceptance criterion gets a sketch: the designer agent writes `.claude/sketches/<slug>.html`, phone layout first, and the Sketch step appears in the strip. Without one the strip has no Sketch step. In the Spec sheet the sketch is one more phase chip, Sketch, shown in a Phone or Desktop frame above Approve; a changes note on it goes back to the designer, a note on the spec goes to the pm and then to the designer so the sketch follows. The implementer and tester get the sketch's path and match its layout, the spec winning where they differ. Ask for "no sketch" or "a sketch" to override the default, and "without approval" to build without waiting for you (the sketch is still written).

## Build cycle

The Build cycle row in the chat settings menu (web and phone; Off or Up to N rounds) turns a prompt into a plan, build, test cycle. Opus plans in plan mode (on Codex the default model, with high effort for plan and build and medium for test), detailed
enough that someone who missed the conversation could build from it, and starts building as soon as the plan is
ready. A plan that deletes data, changes a schema, auth or security, reaches outside the repo, pushes or deploys,
or guesses at an open question waits for your approval instead (from its APPROVAL line when the agent has no plan tool), and rejecting it stops the cycle. Sonnet then tests the result as a separate model and ends with a verdict, and
Opus fixes whatever the tester found, up to the number of rounds you pick. Phases show as violet markers in the
timeline and transcript, the composer footer shows the round, and Stop ends the cycle. Claude
exiting during a step ends it too. When a cycle ends (passed, failed or stopped) it switches itself off, so the next
message is a normal turn. A cycle that a server restart interrupted is not resumed: the chat gets a note and the
setting is Off.

## Personal and work Claude accounts

`./claude-alt.sh` sets up `~/.claude-alt` for a work Claude login and `./claude-alt.sh 2` sets up `~/.claude-alt2` for a third
account, next to the personal one in `~/.claude`. Each shares settings, skills, plugins and chat history with `~/.claude` and keeps its own
login; log in once with `CLAUDE_CONFIG_DIR=<dir> claude` and `/login`. A new chat under the `personalRoot` folder starts on
Personal and any other folder on Work; a reopened chat goes back to the account it was last on. Codex questions go to a daily
chat per profile: work ones run in `~/.agentview/codex-work`, so they get the Work account and the work wiki and data, and
personal ones in this repo. When a turn ends on a usage limit, the chat moves to the next
logged-in account with usage left (the main account, then the second; the third is picked by hand only) and continues where it stopped, and new chats start
there until the limit resets. The composer menu shows the account (Account 1 to 3 unless `accountLabels` in `~/.agentview/settings.json` names them) and switches it by hand. The status bar shows the account with
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
keep the loop; `/loop off` ends it. The loop card above the composer shows the round and the next fire time.

The Goal row in the chat settings menu (web and phone) shows Off, or the run line while a goal or loop runs in the chat. A tap opens the goal sheet with Where set to this chat, or the run's detail when one is active.

The goal sheet ("Chat: New goal" in the palette, the New goal (target) button in the Android Sessions header, "Run as goal…" in the Tasks Run menu of a spec, the target button in the file bar of an open Markdown file and the palette's "File: Run as goal…", and "Run as goal…" in the Android file menu of a Markdown file) builds the `/goal` line from the goal, How often (Until done, 30m, 1h, 2h, or a custom 10m to 168h typed as "45m" or "3h"), Stop at (None, in 1 or 4 hours, 07:00 or a time), Usage cap (50, 70, 90 or Off, hidden for OpenRouter) and Where (a new chat in a folder with a provider, or this chat when none has an active run). A plan goal shows the plan path with its "N of M done" ("No tasks" when the file has none), always starts a new chat in the chat's folder, and runs as "every step is done" when the plan has no unticked tasks. Tapping the Now row of a goal's loop card opens the goal detail: a Goal group with one status badge, the condition, plan progress, next round (an Ended row with how and when it ended once it is done, `finishedLine`) and cost; a Settings group with How often, Stop at, Usage ("Week 42% of 70% cap · 5-hour 30%") and Build limit (None, 3, 5, 10), editable from a menu (`run_edit`); then Pause or Resume, Stop and Open chat, then the rounds, newest first, with each run of "nothing to do" rounds merged into one "Rounds 1-6" row (a weekly report opens its turn). The cap reads the usage of the chat's active Claude account only. The Advisor loop chip at the top of the sheet sets every 4h, cap 70, no stop and a goal text for the chosen folder, and Start sends it to the PM advisor chat (`open_advisor`, not a new chat) instead of `new_session`: each round the PM keeps two specs ahead of the build, asks for a sketch on UI specs, ends with `ROUND: question` when a spec needs approval, starts one build per project after it and asks the Designer for an audit when the backlog is empty and the newest is over 7 days old (`ROUND: nothing` otherwise).

`/goal <condition>` asks Claude to check the condition whenever it goes idle and to keep working until it is met.
Claude replies GOAL MET to end it; the goal also stops by itself after 20 rounds ("Not met after 20 rounds"). `/goal off` ends it early, and
the loop card shows "Goal · round 3 of 20".

`/goal every 1h <condition>` (30m, 2h, 4h or any interval from 10m up to 7 days) starts a standing goal that works on a
heartbeat: each interval Claude reads where things stand, does what moves the goal forward without you, and asks as a
question anything irreversible or outward-facing (push, deploy, delete, send a message) instead of doing it. A heartbeat
is skipped, with no turn and no round, while Claude is busy, a permission or question is pending or the run is paused.
There is no round cap: the goal ends on GOAL MET, on Stop, or after 28 days ("Ran for 28 days, start it again to
continue"). The card reads "Goal · round 12 · next 14:20" (the interval is in the goal detail). Every 7 days one
heartbeat writes a short weekly report (what moved, what is blocked, what is next, at most 8 lines), recorded as a
progress round; the card shows "Weekly report", which jumps to that turn in the chat. "Chat: New
goal" in the palette opens the goal sheet.

Both forms take `until HH:MM` (the next such clock time ends the goal: "Stopped at 18:00 · 41 rounds") and
`cap N%` (1-100) after the interval: `/goal [every 1h] [until 18:00] [cap 70%] <condition>`. With a cap, each round reads
the chat's active Claude or Codex account usage: weekly usage at the cap ends the goal, and while the 5-hour window is
over 90% a standing goal skips the round and an until-done goal waits, shown as Paused, for the window to reset. No
usage figure (OpenRouter) means no cap. The `run_edit` message changes every, the end time and the cap of the running
goal; a new chat can start with a first message (`new_session` `text`), which is how a goal starts in a new chat.

Every `/loop`, `/goal`, build cycle and `/tries` is a run, kept in the host in `~/.agentview/runs.json` (active runs and the
latest 100 ended ones, each with its last 50 rounds) and served at `GET /api/runs`. A round is the outcome of one turn,
its one-line summary and its cost. Loop and goal rounds tell Claude to answer first in plain sentences and finish the reply with
`ROUND: <done|progress|blocked|question|nothing> <one sentence>`; the line is read by the server and hidden from the
transcript, the chat row and push bodies. A round without the line counts as progress. A round pushes "Loop in <repo>: <outcome>" ("Goal in <repo>: <outcome>" for a goal; the body is the first sentence of the ROUND line) only for done, blocked, question or failed, and a run that ends pushes its reason unless you
stopped it (a goal reads "Goal met in <repo>", "Goal stopped in <repo>" or "Goal not met in <repo>"). A usage limit or a pending approval marks the run paused until the next round or the answer. A build
cycle is one run with a round per step.

The loop card sits above the composer while the chat has an active run, as a box that opens by default while the loop is working or needs you, otherwise starts collapsed, and collapses to its header (the state line with Pause and More): a state line ("Loop · round 4 · next 14:20",
"Paused · usage limit until 18:00", "Goal · round 3 of 20", "Build cycle · round 2/3 · Test"), then a Now row with what is
happening: the agent's latest status (with "Next: ..." and the steps left) or the last round ("Round 4 · 02:10 · progress: merged X", "nothing to do" for a quiet round, "First round 02:00" before the first), whichever is newer, with a
running dot while a turn or an agent runs. One running agent gets a row (slug or description, type and minutes) that
opens it; two or more share one "N agents" row listing their names, which opens the agents list. On a goal, last comes
"Plan N of M done" when it has a plan file and nothing else (its condition and cost are in the goal detail); a loop, cycle, tries or job card shows its what text on one line and the total cost. A turn the run did not start, such as a background agent finishing, adds a round when its
reply ends with a ROUND line, with the current round number. Tapping the Now row of a goal card opens its detail; on a loop the Now row
lists the last 10 rows (runs of "nothing to do" rounds merged into one). A loop or goal has Pause (or Resume) and a More menu with Run now and Stop; Run now does nothing
while Claude is busy. A pause is saved and survives
a restart. Stop shows "Loop stopped" or "Goal stopped" with Undo, which starts the same run again within 60 s. A build
cycle only has Stop ("Build cycle stopped", no Undo). The controls take a run id, so they work from any screen. A round
that ends its run (goal met, last round, end time) sends only the run-end push. The chat header (Android) and the web status bar read "Running · 2 agents" while agents run with no turn, "Next round 14:20" between rounds and "Idle" only with no run and no agent.

A run needs you while its last round is blocked or a question, or it is paused for your approval, until a later round
or a message from you in that chat (the server decides this, so web and phone agree). There is no separate list of runs:
a run shows on its chat's loop card and in the goal detail, and a hub job's failed runs on its job page. A coding job's
run that waits for review shows its review card above the composer of its chat instead of the loop card: the summary row
(last round, branch, size and age) with Needs you, the first 3 changed files with Show all, and Commit, push and open a
PR with Approve (behind a confirm) and a More menu with Revise… and Discard. Sessions and Open chats rows of a chat with
an active run show the loop icon with the next time, "Paused" or "Needs you" in warn. The status bar shows "N running"
and "· M need you" in warn while a chat runs or waits on you (the Overview Running counts), and a click opens Sessions. When you open a chat, the recap adds "While you
were away: 6 rounds, 5 quiet, 1 blocked: <line>" from the rounds that ended after the last event you saw.

## Agents

Agents in the More menu of the task box header opens a pane that lists the subagents of the chat with their status, elapsed time and tokens.
Click one for its report, prompt and steps. On the phone it is a tab of its own.
Agents started by a Workflow call are listed under a section named after the workflow, and update live while it runs, while the chat is open, also during a turn.
An agent the chat reports as running but whose start is not in the loaded events shows as a Running row, so the pane says "No agents yet" only when none runs. In Sessions, a live chat with running agents has an Agents section under its row; tapping an agent switches to that chat if needed and opens it here.

## Advisors

Three long-lived chats to talk to about AgentView or any other project: PM (what to build next and why, on Sonnet), Architect (how it fits the code, cost and risk, on Opus) and Designer (sketches screens before they are built, on Sonnet). They have their own Advisors page (activity bar and palette "View: Advisors" on web, More on the phone): a board of one project, from idea to merged build. The header has one project picker (the project picked in it, kept while the app runs, else the open chat's repo, else the repo with the latest activity: `defaultAdvisorRoot` in `shared/advisors.ts`, `shared/fixtures/advisor-root.json`; on the phone the latest commit, not chat activity), Ask PM, Ask Architect and Ask Designer buttons (`open_advisor`: the open chat, else the latest conversation, else a new one) and a Conversations and memory link. With no project the page reads "Pick a project to see its work". The link opens a sheet with, per advisor, a header with its model and New conversation (it closes an idle open chat and starts over, and refuses while the advisor is working), a Talk row (its open chat with the state dot, else its hint), its five latest earlier conversations, and a Memory row ("N facts") that expands to the memory file.

The board joins each line of `<project>/.claude/backlog.md` (`/api/advisors/backlog?root=`, at most 10 lines `<rank>. <slug> | <title> | <why> | <proposed|specced|building|done>`) to the spec with the same slug among the 20 newest `<project>/.claude/specs/*.md` (`/api/advisors/specs?root=`, `buildList`; older specs do not show) and places each card in a stage with `advisorBoard` in `shared/advisors.ts` (`shared/fixtures/advisor-board.json`; the first rule that matches wins): a merged spec or a done line is Done; a built spec or a building line is Building; any spec (whatever its line says) or a specced line is Specced; a proposed line is Ideas. A spec that is running, failed or waiting, such as "Spec needs revision" or a spec review, and not built stays in Specced with its badge; a built spec not yet merged sits in Building. A line with no spec in the list is a backlog-only card: its why instead of the spec meta. Ideas and Specced list backlog rank first, then specs with no line in `specHomeOrder` order; Building and Done list specs in `specHomeOrder` (`shared/builds.ts`, `shared/fixtures/spec-home.json`), then backlog-only cards by rank. Each card offers one action: Ideas, Spec it (the PM writes the spec: `specItemPrompt`, `shared/fixtures/spec-item-prompt.json`); Specced, Approve for a spec awaiting approval, Open chat for one on hold, running, failed or waiting, Build for a line with no spec, else Sketch until a sketch exists, then Build; Building, Open chat; Done, none. Approve and Open chat show nothing for a spec with no build chat or saved session, and a backlog-only Building card has no action. Open chat shows the live chat, else the saved one; Approve also opens the Spec sheet of a live chat. Build starts a new chat in the project (the build from the spec, or the pm agent writes the spec first) and Sketch one running the Designer on the spec. A card is a row with the title, one meta line (`specRowParts` in `shared/builds.ts`, `shared/fixtures/spec-row-parts.json`: a merged spec reads "Merged as <sha>" once), the age of the last change at the right, a Needs you (the spec awaits approval, is on hold or its state is waiting), Running or Failed badge (none in Done), the action and a More menu; tapping the row does nothing. More holds Build (Ideas, when the line can be built) or the next step the action is not (Specced: Sketch, Build), and Move up and Move down on a card with an open backlog line (`POST /api/advisors/backlog/move?root=` with `{ slug, dir }` swaps the line with the nearest open line that way, no PM turn; the first and last open line are disabled, a failure says "Could not move the item"); Done has no More. There is no separate Needs you section: a waiting card shows its badge in its stage, and the board opens on the first stage with such a card, else the first with cards, else Ideas.

When the project has a running or paused Advisor loop (`advisorLoopOf` in `shared/advisors.ts`: the newest goal whose text starts "Advisor loop for <root>,"; `shared/fixtures/advisor-loop.json`), an Advisor loop card heads Building: its last round (`advisorLoopLine`: Paused, Weekly report, the round text or First round) as meta with the outcome dot, "Builds 2 of 5" at the right when the loop has a build limit (`advisorLoopBuilds`), a Needs you badge when its last round is blocked, a question or failed (or it asks), and Open chat. With no loop the card reads Not running with a Start button (`advisorLoopCommand`: every 4h, cap 70, 5 builds, sent to the PM chat, disabled for 10 s after a tap). An Audit card heads Ideas: `<date> · <count>` (or "Not run yet"; `auditCountLine`, `shared/fixtures/audit-count.json`: "12 open", "3 open of 12", "No findings") from the newest `<project>/.claude/audits/<YYYY-MM-DD>.md` (`/api/advisors/audit?root=`, at most 15 lines `<rank>. <screen> | <problem> | <high|med|low> | <fix>`), a Specs from audit button (the PM adds the top findings to the backlog as `proposed`; disabled until a file exists) that gives way to a Running badge while the Designer works, and a More menu with Open latest audit (a sheet of the findings) and Run audit (the Designer walks each screen in headless Chrome at 390px, then 1280px and writes a new audit; no running app: it says so and writes no file). Tapping the card does nothing. The loop and audit cards are not counted. Each stage has a header with its count and, when empty, "Nothing here"; with no backlog Ideas offers Ask PM to rank instead. On a page 600px wide or less (the page's own width, not the window's) the four columns become chips ("Ideas 3", "Specced 2", ...) with one stage, set to the opening stage when a project's board loads and kept across reloads; the phone always uses chips. If the backlog or specs fail to load the page says "Could not load the board". The page reloads when it shows and after each advisor turn (`/api/advisors`). On the phone read-only mode hides every action, Start and the More menus. The palette also has "Chat: Talk to PM", "Talk to Architect", "Talk to Designer" and "Chat: Audit usability" (audits the open chat's project).

Each advisor lives in `~/.agentview/advisors/<id>` on the Mac that runs the hub, so there is one copy of its memory, specs, backlog and audits. On any other Mac the server forwards the advisor routes to that Mac's AgentView (`advisorsMac`), sending the project root relative to the home folder, and `open_advisor` fails with a note to switch Macs. Build and Sketch on the Advisors page send `new_session` with `hub`, which that Mac starts instead (a notice says to switch Macs to follow it), and the Sketches page adds that Mac's sketches of the same project (`/api/advisors/sketches`; a local file of the same name wins), reading a sketch missing here from there (`/api/advisors/sketch`). On every open the server writes its CLAUDE.md from the role in `server/advisors/<id>.md`, a `projects.md` index (per workspace root, one line per folder: last git activity and the first sentence of its README or CLAUDE.md, newest first, rebuilt at most every 10 minutes, about 4 KB) and `.claude/settings.json`. Settings let every advisor read the roots; the PM may edit `<project>/.claude/specs/<slug>.md` (the build kit's spec format) and `<project>/.claude/backlog.md` and the Designer `<project>/.claude/sketches/<slug>.html` (the kit's sketch rules) and `<project>/.claude/audits/**`, and the Architect is denied edits in the roots. Other edits are not allowed by a rule, so the permission mode decides them, and the roles say not to make them. Each keeps `memory.md` (under 150 lines, loaded by the CLAUDE.md), so a new conversation starts with what earlier ones learned. Their chats stay out of the Sessions repo groups unless a search matches them.

## Deep links

`?view=github` opens a sidebar view (explorer, changes, github, chats, sessions, runs), `?page=observe` opens a page
(advisors, observe, deploy, mcp, settings), `?page=sketches&slug=<file name>` opens that sketch (an unknown name shows the list), `?chat=<id>` opens a running chat and `?session=<id>` reopens a saved one. The parameters
are read once and removed from the address bar.

## Pages

Observe, Deploy (only with `deployUrl` set in `~/.agentview/settings.json`), MCP Servers and Sketches open as tabs in the editor area (the lower four activity bar icons, or the command
palette), so they get the full width instead of the sidebar. One page is open at a time; opening another replaces it. The page title shows once: the desktop hero is the title and the page's own controls.

On the phone Observe, Deploy, MCP Servers, Settings, Files, Source Control and Pull Requests have no editor tab strip. One header row replaces it: Back, the title, a muted one-line subtitle (the repo folder; "N connected of M" on MCP; the file's folder in an open file) and at most one trailing control (Refresh on Observe, Deploy and Pull Requests, Check on MCP, the Explorer's More menu on Files, a More menu with Close file on an open file). Back, the system back and the edge swipe return to the tab that was open before, or to Codex when there was none; in an open file Back shows the Explorer first. With nothing set up, Observe, Deploy and MCP show an empty state with one "Set up with Claude" button (the chat's provider) that asks the chat on screen to do the setup.

Without a Grafana MCP server, Observe makes no Grafana requests. Observe's Grafana section shows a card per entry in a repo's `grafana.panels` (`{ title, query, unit }`, a PromQL query in
`~/.agentview/observe.json`): the last value, a 6 hour sparkline with min and max in the hover title, and a link to Explore.
A failing panel shows its error without affecting the others. With no panels, a button asks Claude to suggest some from the
service's dashboards. The refresh button reloads the panels too.

Observe's Settings section is a Section header (closed by default) with a JSON field and a Save button. The header shows a badge: Unsaved after an edit, Saved after a save, Failed with the error under the field when the JSON is invalid or the save fails. An edit made while saving is kept. Changing the project clears the badge.

Settings is a page of its own (activity bar, More sheet, palette). It has four groups, each a Section header over a grouped list. About holds a read-only App version row (the web build's short commit sha, or "Unknown") and a Design row that opens `/design`; the Design row shows in dev mode or when the hub runs with `ASSISTANT_DEBUG=1`. Appearance holds a Theme row showing Dark or Light; tapping it switches the theme, the same toggle and saved choice as the status bar icon. Phone holds an Installed version row (`0.1.0+<sha>`) and shows only in the phone app. Privacy holds a Feature analytics row (On or Off, off by default; a tap turns it on, turning it off asks first and deletes the counts) and a Feature use row (while analytics are on or at least one feature is hidden) that opens a sheet with the 7 or 30 day Chips, Never used and Used lists (5 rows each, then Show all) and a Hidden list. Each hideable row (pages except Settings, palette commands, the More sheet tools, Run all and Run as goal) has a More menu with Hide or Show; it saves at once and shows a snack with Undo. A hidden page leaves the activity bar, the More sheet and the palette, a hidden palette command leaves the palette, a hidden More tool leaves the sheet, and a hidden Run item leaves the spec Tasks Run menu; deep links and chat cards still open a hidden page. With analytics off the sheet shows only Hidden. The info button on the Privacy header explains that the counts are per feature per day, kept on this Mac for 90 days and never sent anywhere. While on, the web app counts page opens, phone tabs, Codex lists, palette commands, the goal, Needs you and More sheets, and Start, Approve, Run all and spec task Start actions, by feature id only (`featureUse` in settings.json). The Android app records the same events (tab changes, More pages, Codex lists, the sheets and the actions; not while read-only) and has the same Privacy group and Feature use sheet under Settings.

## Build card

Each spec has one live card per chat, on the latest transcript item that names it: a successful write or edit of the spec file, or a build agent for that slug (`specCards` in `web/src/chat/transcript/steps.ts`, `specCardIds` on Android, both tested against `shared/fixtures/spec-cards.json`). On the web the card is open by default, titled by the build title (else the slug), with meta "<furthest step> · <conclusion>", the status Badge (Needs you when held) and a More menu (Open spec, Open spec file in a main checkout chat, Hold or Release hold, Review with fresh eyes, Sketch for a spec with no sketch, Build for a spec file no implementer has run on). A sketch card in a chat has a menu with Build and Open spec when a spec of the same slug exists. Android hides Sketch and Build in a read-only run. It shows the flow as one strip of steps, Spec to Merge (seven, or eight with Sketch), each a state mark and its name ("by · result · age" on hover), then, while the build is not done, one row for the step that is running, waiting or failed (else the last one that happened) with its Badge. When the spec has criteria, an Acceptance criteria header shows the counts as Badges with "+N more" to list them (all are listed when one failed), then the review Findings. The `build` workflow waits for approval before implementing: once the spec is reviewed, the Your approval step shows "Waiting for you" with the Needs you Badge until every phase is approved; Request changes sends the note to the pm, which rewrites the spec, and that phase waits for a new decision (`approval: false` skips the wait). Every step except Merge and the ones still to do opens a sheet: Spec and Your approval the spec phases with Approve (Sketch opens the same sheet on its Sketch phase: Phone and Desktop chips and the sketch in a sandboxed frame), Request changes, Start and Run all; Spec review, Implement, Test and Code review that step's runs (newest first) with the picked run's report and Open chat, plus the commit and diff, the test criteria, or the findings and the code Approve. A criterion row opens its full text and evidence. Sheets stack, and Esc or back closes the topmost. On an agent the card follows the agent's box; on a write it replaces that write's row. It loads only while open, polls every 15 s while the build runs, and reloads when a build agent for the spec starts or ends. A removed spec shows the header with "Spec removed". Earlier spec writes are a plain beaker row (slug, "Spec written" or "Spec edited · +N -M") with no tap. A Kiro phase file is titled by its folder. On Android the strip scrolls sideways, with the same criteria, sheets and actions; a build agent's card stays inside its box. There is no page listing builds: a spec no chat has a card for (written outside AgentView) has no home.

The Spec sheet opens on the first phase without an approval. Approve on Requirements or Design moves to the next phase. A pm spec is split by its `##` headings: Problem, Behaviour, Requirements and Non-goals (and the text above the first heading) are Requirements; Design, Touches and Open questions are Design; Tasks and Acceptance criteria are Tasks; `## Review notes` is in none. A Kiro folder maps requirements.md, design.md and tasks.md to the three phases. Each decision is stored in `<builds dir>/<slug>.reviews.json` (the newest per phase wins). For a spec file that git ignores, one line `- <date> <Phase>: Approved|Changes requested: <note>` is also appended under `## Review notes` at the end of the file, so the agents that open the spec read it; a tracked spec file gets the JSON record only. A code decision adds "Code: Approved" or "Code: Changes requested: <note>" (400 when the spec has no implement entry); Hold and Release hold add "Hold: do not start or continue this spec" and "Hold released", with the same JSON records (`phase: "hold"`). `/api/builds/one` carries `hold` (the latest hold or release wins) and `codeReview`. The Android card hides Approve and the menu in a read-only run.

## Build kit

`server/build-kit/` is a local Claude plugin named `agentview` that every Claude chat loads (not OpenRouter or Codex chats), in any repo. It holds the pm, spec-reviewer, spec-reader, zoom-out, architect, implementer, tester and code-reviewer agents (`agentview:pm` and so on), the `build` workflow and the `/agentview:build` skill, which runs pm, review, implement and test for a brief and merges what passed. The kit text is repo-neutral: each agent reads the repo's CLAUDE.md, the docs it names and `.claude/build.md` when that file exists. In this repo `.claude/build.md` carries the design-system, check, restart and `Branch prefix:` rules (a repo without the line gets branches named `build/<slug>`). `usage.mjs`, which prints the weekly and 5-hour usage, lives in the kit too: the drift skill and the untracked local `.claude/loop.md` call `node server/build-kit/usage.mjs --chat` from the repo root.

## Sketches

`/sketch <what>` (Claude and Codex chats; with no text it sketches the screen being discussed) asks the agent for one self-contained HTML mockup in `.claude/sketches/<name>.html`: inline CSS, no scripts, no external URLs, both themes under `html[data-theme]`, working at 390px and 1280px. The user's message keeps the typed `/sketch` text. The Sketches page (activity bar paint can icon, the phone More sheet, `?page=sketches` or "View: Sketches" in the palette) lists the regular `.html` files directly in that folder of the open chat (no symlinks or folders), newest first, five rows then "Show all N"; with none it shows "No sketches yet" and a New sketch button that puts `/sketch ` in the composer. A tap opens the sketch: Back, the name, Desktop / Phone and Light / Dark chips and a menu with Open file and Copy path. The page opens only names the list returned. The sketch runs in an `<iframe sandbox="">` (no scripts, no access to the app) whose `srcdoc` is `sketchDoc` from `shared/sketches.ts`: a Content-Security-Policy meta that blocks every load but inline styles and data images, `<base target="_blank">`, meta refresh removed and the chosen `data-theme` on `<html>`, with cases in `shared/fixtures/sketch-doc.json`. Desktop is 1280 by 800 scaled down to the pane, Phone 390 by 844 scaled to fit; a rewrite by the agent reloads the open frame. A file over 1 MB is not shown. A chat shows a sketch card (paint can icon, the name, "Sketch written" or "Sketch edited · +N -M") for a successful write to a `.claude/sketches/<name>.html` file; a tap opens the page on it. The native Android app has the same page and card (More sheet, `?page=sketches&slug=<file name>`), with Phone first and a Copy path menu only: the sketch runs in a WebView with JavaScript, network, file and content access off and link taps ignored, the page built by a Kotlin port of `sketchDoc` run against the same fixture; Desktop asks for a 1280px viewport. New sketch is refused in a read-only run.

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
| ⌥⇧↓ / ⌥⇧↑ | Next or previous unread open chat (Done or Needs you) |
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
