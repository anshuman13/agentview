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
- **Phone**: a quick sideways swipe moves between the Codex, Chat, Sessions and Agents tabs, and the new tab slides in from its side; pulling down at the top of Overview, Tasks, Meetings, Wiki or Jobs syncs
- **Command palette** (⇧⌘P or F1): every view, tab, page, model and mode as a searchable list
- **Theme**: the color icon in the status bar cycles Graphite, Dark Modern and Light. With nothing chosen the page
  follows the system setting; `?theme=light` in the URL picks one

## Codex

Codex shows Overview, Tasks, Meetings, Jobs and Wiki for the work profile, the personal profile or both. Under the
nav, the sync line says when the app last synced with the hub. While the hub skips its Slack or calendar scan because
that Claude account is at its usage limit, a line below it names the paused scans and the time the limit ends.

### Overview

- One line per weekly goal with done/total of the tasks linked to it
- The morning brief the hub writes at 08:00 on weekdays: today's meetings and free time, tasks due and overdue, how
  many tasks this week are at risk, Slack asks, Slack promises I made under You said, and meeting actions left from
  the last workday. It folds and hides until tomorrow
- Meetings that ended in the last two hours with their actions, a follow-up draft to copy and the notes
- Since <meeting>: for the latest meeting that ended in the last two hours, the Slack and Gmail asks and the Slack DMs
  that came in while it ran or up to 30 minutes after (the scans run every 15 and 30 minutes). Dismiss hides it for
  that meeting
- A Plan strip of free gaps. A tap blocks time for a task due today on the calendar after you confirm the task, start,
  length and title; blocking a task again replaces its earlier event, and blocks show only in the Plan strip, not as
  meetings. Plan my day packs tasks into the free gaps by their estimate (30 minutes without one): tasks linked to this
  week's goals first, due or not, then overdue and due tasks by due time. It shows the plan to trim before Create adds
  the blocks
- Copy standup copies three sections: Yesterday (tasks done and meeting decisions on the previous workday), Today
  (today's meetings and the tasks Plan my day would place, with times) and Blocked (Waiting on items older than two
  days)
- At risk: tasks due by Friday that will not fit in the free work time before they are due, with the shortfall
- The meetings still ahead today with the meeting time left, and a field on the next meeting's card that adds a
  timestamped line to its notes
- Overdue and due tasks with a check to mark them done and a clock to snooze them to tomorrow 09:00
- What the latest Slack summary says needs you (Task turns one into a task with its link, Done hides it), job reports
  and a follow-through card for meeting actions still open after a week
- A card counting meetings, decisions, new claims and open questions since the last visit, until dismissed
- Keep in touch: people I met or DMed on 3 or more days in the last 8 weeks whose time since the last contact is over
  1.5 times their usual gap, most overdue first. Meetings with more than 8 people do not count. A row opens the person
  page and has Copy nudge and Dismiss, which hides the person until the next contact

### Tasks

A tap opens the task in place: title and notes are editable for every task, including ones from Slack or a meeting,
with due time, profile, source link, Start, Snooze, Tidy, Copy draft for an ask with a reply draft, Ask and Delete
below; a tap outside closes it and saves. Slack and Gmail promises I made myself show under "You said" next to the
asks under "Is this yours?", where an ask has Copy draft for the reply the scan wrote and Open for its source.

- Each day ends with Add task (its dot switches between work and personal when both are shown), which takes times like
  "friday 10" and stays open for the next one. A bare time like "3pm" in a later day's Add task lands on that day
- Rows with "- [ ]" checklist lines in the notes show how many are ticked, and the open task lists them to tick with a
  tap
- Swiping left names the day the task moves to, and Snooze offers Today for a task due on a later day
- Search (or /) filters tasks by title, notes and people, Overdue has Move to today with one undo, and tasks not
  dragged into an order sort by due time
- Focus timer: Start on an open task shows a bar over Codex with the task, the time so far against its estimate, and
  Stop. Stop adds the whole minutes to the task's time spent, shown as a chip on the task, with an undo. One timer
  runs at a time and survives a reload
- An open task without a "~30m" estimate in its title gets one suggested as a chip: the average time spent on at least
  two done tasks whose titles share half their words, rounded to 5 minutes. A tap adds it to the title
- A goal menu links an open or done task to one of this week's goals of its profile

### Related while writing

Typing in a task's title or notes, a wiki note or a meeting's My notes shows up to 3 matches under the field: current
wiki claims, past meetings and tasks from Slack of the same profile that share at least two key words with the line
being written, most shared words first. A claim or meeting opens in Codex, a Slack task opens its Slack link.

### Meetings

Meetings imports the calendar every half hour and shows notes, summary, decisions, actions, pinned text and earlier
meetings of the same series, with decisions made and questions asked again; the page copies as Markdown or as a
follow-up draft, an action copies as a message or opens a prefilled Linear issue, and the summary format suggests the
template last used for the series.

The page of an upcoming meeting has a prep card: points to raise with its attendees (each with a Raised tick), what
they took on last time, my open actions, open questions, and Copy agenda, which copies all of it as a Markdown
checklist without a model call. Raise on a decision or an open task, and the field on a person page, save a point for
the next meeting with that person (picked from the meeting's attendees and recent ones); a point waits for the first
meeting with them after it was raised and counts as raised once that meeting ends. Points stay out of Search.

A person page starts with what waits outside meetings: the summary of their Slack DM with Open in Slack, what they
asked you and what you promised them in Slack or Gmail, and your sent mail to them with no reply. Below come their
commitments, the points to raise with them (included when the page is copied as Markdown), pinned text, meetings and
wiki claims that name them.

The header has a decision log filtered by person, a Load view and a Week view:

- Load: hours per week, share recorded, who you meet most, time and actions done per recurring series, and a series
  value audit: meetings, hours, decisions and my actions per series over 8 weeks, with series that brought no decision
  or action of mine in 4 weeks flagged first as Nothing for you lately with the hours they cost; a tap opens the
  latest meeting
- Week: Goals this week, where up to 3 goals per profile are set and renamed, then the week's decisions, new claims,
  tasks done and open meeting actions. Its Review lists done, slipped and stuck tasks and Waiting on by person: waiting
  tasks and sent mail with no reply after 3 workdays, with Copy nudge and Open. The decision log, Week (with Waiting
  on) and person pages copy as Markdown

Saved topics filter the list, show a timeline of matching meetings, decisions and claims, and count what is new since
you last looked. Topics and person pages list questions the meetings left open until you resolve them. Meeting search
also asks the hub, which keeps each transcript's text, and shows the words around a hit in the transcript; a
summarized meeting's page has a talk time strip (each speaker's share of words in the transcript, top five, with the
action and decision counts) and a collapsed Transcript section. The app-wide Search also lists Transcripts hits from
the hub with the meeting's title, date and the words around the hit; offline the group is left out. Long lists show
50 rows at a time.

### Wiki

The wiki is built from claims with sources, which can be contested and go through Review. The wiki start page lists
claims untouched for 90 days as Stale and claims a later meeting decision may have changed as Maybe changed, unless a
proposed replacement already waits in Review. For meetings and Slack channel decisions of the last two weeks the hub
proposes the updated claims for Review, marked From <meeting> or From #channel (see [codex-wiki.md](codex-wiki.md)).

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
A failed compact is not retried.

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
server, then subscribe to it in the ntfy app. Tapping the push opens the chat. The assistant hub uses the same topic for meeting and task reminders and the 08:00 morning brief.
Urgent Slack and Gmail asks that arrive while a calendar meeting runs (not all-day events or focus blocks) are held
and sent as one push, "N urgent while you were in <meeting>", within a minute after it ends.

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
| j / k | Move between tasks in Tasks; Enter or Space opens, Esc closes, x done, s snooze, Delete removes |
| n / | New task for today; search tasks (on Tasks) |
