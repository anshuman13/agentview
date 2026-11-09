# Autopilot

Status: the flag, the tiers, the send path, the ask card with Send, Edit and Skip, the FAQ miner, the voice learner, the
"who does what" pass, the away digest, every-day away scans, claim-cited drafts, the manager setting, retries and the
thread and external checks are built (4 Nov 2026); the other checks are still plans.

Goal: the hub answers people on my behalf. Day to day it drafts and I approve from the phone; on vacation it answers
the safe questions itself, holds the rest with an away note and tells me what matters. Everything it sends says it
is an assistant, and every send is logged and reversible by me.

## What exists

- The work Slack scan reads DMs, mentions and the watched channels (including `ai-help`) every 15 minutes on
  weekdays and turns asks into suggested tasks, one per permalink ([assistant.md](assistant.md#slack-and-gmail-scans))
- Each new ask gets a reply draft in my voice, as short as the ask allows (one line for a DM yes or no, the
  answer or link first in a channel), with the thread and up to 3 wiki claims, 3 decisions (meetings of the
  last 30 days, Slack of the last 14 with their link) and 3 of my open tasks as context, plus an asker block (their role from Who does what, my last 3 replies to them, what I
  promised them) (`assistant/src/slack/draft.ts`, `ask_context`); a short ask matches on one key word, longer ones on two; claims are ranked by relevance and Support FAQ claims rank first on a tie, each
  claim comes with its id and source link, and the draft cites the ids in `claims` and ends with "see <link>" when there
  is one; when the answer is someone else's to give, the draft names and tags them and never guesses an owner; numbers, dates and names come verbatim from a claim or the thread, else the draft asks one precise question back; a claim older than 30 days is quoted "as of" its date; access, invite, seat and limit asks give the Support FAQ step first; a message with several questions gets the covered parts answered and names the part still to check, also in a hold draft; an ask to meet or talk gets one or two free half hours from my calendar over the next two working days (the free_slots tool), never an invented time
- The scan gives each ask a kind; access asks (invites, seats, plan moves, permissions I grant) and limit asks are
  tagged `access` or `limit`, and with two or more in the Reply queue a line offers Copy list, so I grant them in one
  sitting in the admin console
- When I edit or skip a draft the hub keeps the original; the first scan on a Monday (or `POST /slack/corrections`;
  needs 3 pairs) turns the differences into rules the drafter follows and proposes them on the How I
  write page (`assistant/src/slack/corrections.ts`)
- Jobs run a prompt on a schedule with read-only tools plus the MCP tools the job lists (`assistant/src/jobs/jobs.ts`); every
  job can call `ask_context` to read my wiki claims, decisions and open tasks
- Slack commands: a message I write in my DM with myself that starts with "bot" ("bot, what did the infra channel decide
  about the freeze") is picked up by the next Slack scan (every 15 min on weekdays, every day when away) and becomes a
  one-off job named "Slack: ..." that runs on the mini with my memory and voice. It can read Slack, Gmail, the calendar
  and the web and add tasks, but not post to anyone; it drafts instead. Its answer is posted in the thread of my
  message, starting "Assistant: ", or pushed when the post fails (`assistant/src/slack/commands.ts`). Between scans a Haiku
  poll looks only for new commands every 5 minutes in scan hours (about $0.01 a poll), so a command waits minutes
- Pushes through ntfy can carry actions (Done, Snooze on a task)
- The wiki holds approved claims; the wiki update pass proposes claims from Slack decisions

Missing: a send path, a policy that says which draft may go out, an approval step on the phone, an away mode, and an
FAQ the drafts can lean on.

## Modes

| Mode | Who sends | What goes out without me |
| --- | --- | --- |
| off | nobody | nothing (today) |
| assist (daily) | me, one tap | nothing; every draft waits for Send or Skip |
| away (vacation) | the hub | tier A answers and tier B holding notes; tier C only pushes me |

The switch is the "Reply for me in Slack" row at the top of Jobs. It shows the mode in one line ("Drafts only", "Away
until 14 Nov", with waiting, failed and "Dry run" appended) and a Switch; the Switch turns it on or off and a tap
elsewhere opens its page. The page has Back, the title and an info button that opens a sheet with how it works and a
button to the Reply queue. Below is one grouped list, each row a setting with its value: Covers (DMs and the watched
channels), Activity (the last scan and the 7-day spend) and Auto send (beta), a Switch that is off by default. Only with
Auto send on do Away (the dates or Off), Never answers (the manager and the people listed), Model (Sonnet or Opus) and Dry
run (a Switch) show; with it off there is no away mode and the hub only reads and drafts. Away, Covers, Never answers and Model open a sheet with
only their fields; text fields save on blur and on closing the sheet, the chips save at once. Activity opens a sheet with
Seen, the last asks with what was done (Replied, Would reply, Could answer, Needs you, Escalate, Failed), five at a
time, and the spend by model. The settings live in the hub's meta table (`GET` and `POST
/autopilot`); a `autopilot.json` next to the database seeds them once.

Each scan logs its token counts and cost to meta `scan:slack:cost` (last 20); the logged tokens are not shown on the page. Every hub Claude run (scans, drafts, sends, jobs) also adds its cost per model to a day row in meta
`spend:YYYY-MM-DD` (kept 30 days), and the Activity sheet shows today and the last 7 days by model, plus the 7-day total for jobs. A job run also adds its cost to `jobspend:YYYY-MM-DD` by job id (kept 30 days). A run that names its
tools loads only the MCP servers they come from (all connectors were about 187k tokens a run), and a run stopped
early is interrupted so its cost still arrives. The prompt carries only chat summaries with messages in the last 2 days and asks from the last 7.

The card's "Drafts while away by" chips pick Sonnet or Opus (`model` in the config); the scan runs on that model only in
away mode, otherwise on Sonnet. A post run that ends without confirming is followed by one read of the thread, so a reply
that did go out is logged as sent and not retried.

Pushes: urgent asks are pushed in every mode. Away mode also pushes escalate-tier asks and asks from the never-answer
list, which it never answers. Assist mode pushes every ask with a draft in a covered chat, with a Send reply action: the body
holds the quote, the draft and "From <page>: <claim>" for the claim it rests on; the actions are Open, Send reply (Make task
for an ask that needs me) and Skip, which closes the ask with no reply (`POST /slack/skip`).
Pushes go out in the Slack push hours (08:00 to 17:00 by default, weekdays only outside away mode) and wait for a running
meeting to end. In away mode the scan runs every day from 07:00 to 22:00, and it never reads back past the first away day,
so a first away scan answers nothing older than the mode.

The switch on outside the away dates, or with Auto send off, is assist mode; inside them with Auto send on it is away mode. Dry run, on by default, logs every reply
the hub would send on the ask instead of sending it. Send reply, pressed by me on the push or on the ask, posts even in a
dry run: the app sends the draft as it reads on the phone with the request, so an edit made a moment ago is what goes out, and
a failed send stays on the draft card with a Retry button and the next scan posts it again (3 tries, then one push). If someone answered the thread first, nothing is posted and the ask
closes. An ask the scan tiers hold or escalate (a decision, approval, review, something urgent) is tagged needs-you: its draft is
the concrete step I will take and when, or the one missing detail asked back, or empty (never only "will check, get back to you"); the push says "Needs you" and has no Send action, and the card shows "Needs your decision" with a quiet Send
note. The Needs you sheet on Overview has a Reply queue: every Slack ask with a draft, the ones that need me first, then oldest first, each with
Send, Edit and Skip in place and a History fold that loads the last 3 replies sent to that person (date and first line). A tier answer that rests on a live wiki claim with confidence 0.8 or more is tagged faq: the
queue row shows an "FAQ answer" badge, such asks sort right after the ones that need me, the push body says "FAQ answer, 90% sure"
before the claim, and with two or more the queue has one "Send all N FAQ answers" button. The morning brief lists the asks still open oldest first with who asked and the age, the ones
from yesterday or older under their own heading. At the first scan from 17:00 on a weekday the hub writes a day digest
(`briefs` kind `day`, `dayDigest`): what I sent (and how many edited), what failed, what I skipped and what still waits, as JSON `rows`
(`id, who, chat, outcome, reason, edited, url`, reason cut to 6 words), and pushes the counts. The switch off is the kill switch. The scan reads the settings each
time, so no restart is needed. Sent and dry-run replies are in the hub-only `replies`
table, one row per ask, with tier, confidence, the text and the permalink of the post.

## Tiers

The draft step gets three more outputs per ask: `tier`, `confidence` (0 to 1) and `why` (one line).

| Tier | Means | Assist mode | Away mode |
| --- | --- | --- | --- |
| A, answer | A question the wiki, FAQ or the thread itself answers: access, setup, where a doc is, how a thing works, a status I have already written down | push with Send / Skip | send when confidence >= 0.8 and at least one claim id it cites (`claims`, from `ask_context`) is still a live wiki claim, else tier B |
| B, hold | Asks for a decision, an approval, a review, an estimate, my opinion, access I grant, or a meeting | push with Send / Skip of the draft | send one holding note per person per 3 days, and push me each further ask inside those days ("I'm away until X, <backup> covers this, I'll see it when back") and add a task |
| C, escalate | Production incident, a message from my manager (the `manager` setting) or the never-answer list (names match whole words, Slack user ids exactly), legal or HR, anything with "urgent" or "down", anything from outside the company | push now | push now, no reply |

Never sent, whatever the tier: credentials or tokens, anything to a Slack Connect or external channel (the scan sets
`external` on the ask, which escalates it), a reply in a
thread where someone else already answered after the ask (the scan flags it, and the post step re-reads the thread and
backs out if an answer came since, or if the asker withdrew or changed the ask: then the held draft stays with the note "thread changed since draft"), a reply to a bot, a second reply in the same thread (the replies row keeps a thread key; a follow-up in an answered
thread is skipped and pushed to me instead), a
reply to a message older than when the mode turned on, mail (Gmail keeps its own vacation responder; the hub only
drafts).

A post that fails is retried on the next away scans, three tries in all, then pushed to me once (`tries` on the
replies row). Every sent reply starts with a short marker: "(auto-reply from <owner>'s assistant)" in away mode, the owner being the `owner` setting, nothing in
assist mode since I pressed Send myself.

## Build order

1. **Send path and log.** A `replies` table (ask item id, channel, thread, text, tier, confidence, mode, sent_at,
   result url, approved_by: me or hub). A `send_reply` tool in the hub that posts through the work account's Slack
   connector as a thread reply, with `dry_run` in config so the first week only logs. Verify first that the connector
   exposes a send tool on the work account; if it does not, the fallback is a Slack app token in `slack.json` and a
   plain `chat.postMessage` call.
2. **Policy in the draft step.** Add tier, confidence and why to the draft prompt, pass the away window and backup
   name in, and store them on the item. The scan prompt already lists recent asks, so the no-second-reply rule is a
   lookup on `replies`.
3. **Approve from the phone.** The push for a new ask grows Send and Skip actions, and the ask card in Tasks under
   "Is this yours?" shows the draft with Send, Edit and Skip. Send calls `send_reply`; Skip clears the draft. Edit
   opens the draft in the composer and sends on save.
4. **FAQ.** `POST /slack/faq?channel=ai-help&days=90` reads the channel's threads and proposes one claim per answered
   question on a "Support FAQ" page for Review, keyed by permalink so a rerun adds nothing twice (`assistant/src/slack/faq.ts`).
   I approve them before the trip. `ask_context` already feeds live claims into drafts, so nothing else changes.
5. **Away mode.** The scan sends tier A and B as above, at most 10 replies an hour and 40 a day, and at the first
   scan from 17:00 writes the day's digest to `briefs` (kind `away`, `awayDigest`): what it answered, held, escalated
   and skipped, as the same JSON `rows`. One push a day with the counts. `POST /slack/people` proposes "who owns what" claims on a
   "Who does what" page from the hub's chat summaries and decisions of the last 30 days (`assistant/src/slack/people.ts`). Meetings in the window get a decline with the note only if I enable `"decline": true`.
6. **Dry run.** Run assist mode for a week before the trip. The run log shows how many drafts I sent unchanged, edited
   or skipped per tier. Tier A goes live in away mode only if 80% of its drafts went out unchanged.
7. **Day-to-day offload** (after the trip, same machinery):
   - Linear: a weekday 08:30 job that reads my assigned and mentioned issues, adds tasks for anything blocked on me,
     and drafts a comment per question asked of me, approved like a Slack draft
   - `ai-help`: tier A answers go out with one tap all year, so the FAQ keeps growing from what I send
   - Weekly update and standup already exist as presets; the digest from step 5 becomes the daily "while you were in
     meetings" card
   - PR review requests: a job that lists PRs waiting on me and adds a task with the diff summary, no auto-comment

## Checks it runs for me

Scheduled jobs that read a source, write the numbers to a wiki page as dated claims, and push only on a threshold.
Tier A answers in `ai-help` then rest on these claims, so "how much are we spending" and "do I have budget
left" get answered from this week's numbers, not from memory.

| Check | Source | Schedule | Writes | Pushes when |
| --- | --- | --- | --- | --- |
| Claude spend | Claude Enterprise admin usage and the Console cost page, through the `browser` tool (its Chrome holds the admin login) | weekdays 08:00 | month-to-date spend, run rate against the yearly minimum, top 5 departments, users near the extra-budget cap | run rate off by more than 15% from plan, or a user over the cap |
| Seats | Claude Team and Enterprise admin pages | Mondays 08:00 | seats used of 150 and the pending requests | fewer than 5 free seats |
| Cost per department sheet | the cost per department sheet in Drive | weekly | refreshed rows from the spend check, as a new tab, never over the old one | never |
| Access requests | `ai-help` and the request form thread | each scan | a task per request with what is missing | a request older than 2 workdays |
| Usage limits | Settings → Usage for both of my accounts, through the hub's existing limit check | hourly | nothing | a limit that would pause the scans for more than an hour in work hours |
| Grafana alerts | the alert rules the Observe page already reads | hourly in work hours | nothing | a firing alert in a dashboard I own |
| Linear | issues assigned to me or mentioning me | weekdays 08:30 | a task per blocked issue, a drafted comment per question (approved like a Slack draft) | an issue marked urgent |

Rules: a check only reads; the sheet update is the one write and goes to a new tab. Numbers go to the wiki as
claims with the date and the source link, replacing last week's claim, so a question in `ai-help` is
answered with "as of 3 Nov" and a link. A check that fails twice in a row pushes its error once, the same way the
scans do. The browser jobs need the admin pages logged in once in AgentView's Chrome on the mini; a job that lands on
a login page stops and pushes "log in again" instead of guessing.

On vacation the same checks run and the away digest adds one line per check with its latest numbers, so the week's
report writes itself.

## Tests

- Unit: tier and confidence parsing, the never-send rules (own earlier reply, human answered since, external channel,
  bot, old message), the hourly and daily caps, the away window and kill switch
- Hub: a scan with `dry_run` logs a reply row and sends nothing; with the flag off it calls the send tool once per ask
- Manual: a DM from my personal Slack account to my work account in assist mode produces a push with Send, and Send
  posts in the thread with the marker

## Open points for me

- Vacation dates and the backup person's name
- Whether replies go out as me with a marker, or whether a Slack app user for the assistant is worth the admin ask
- The tier C list: manager and named people
- Which channels count as public enough to answer in (default: the watched list minus `temp-*` and `tmp-*`)
