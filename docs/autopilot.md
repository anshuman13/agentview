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
- Each new ask gets a reply draft in my voice, with the thread and up to 3 wiki claims and 3 meeting decisions as
  context (`assistant/src/draft.ts`, `ask_context`); Support FAQ claims rank first on a tie, each claim comes with its id
  and source link, and the draft cites the ids in `claims` and ends with "see <link>" when there is one
- Jobs run a prompt on a schedule with read-only tools plus the MCP tools the job lists (`assistant/src/jobs.ts`)
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

The switch is the "Reply for me in Slack" card at the top of Jobs. Collapsed it shows the mode in one line ("Drafts only:
you send every reply", "Away until 14 Nov: answers simple questions itself", with "Dry run" appended). Tapping it shows,
in this order: three plain lines on when it replies, the exact holding note it will send (with the marker its own answers
start with) and how urgent asks reach the phone; the Dry run switch; then three folds: the away dates (dates, backup, an
extra line for the note), the coverage (chips for DMs and each watched channel, temp channels start uncovered, plus the
scan's last run) and the people never to answer; then Seen, the last asks with what was done (Replied, Would reply, Could
answer, Needs you, Escalate, Failed), three at a time. The settings live in the hub's meta table (`GET` and `POST
/autopilot`); a `autopilot.json` next to the database seeds them once.

Each scan logs its token counts and cost to meta `scan:slack:cost` (last 20); the card's scan line shows the last
scan's tokens. The prompt carries only chat summaries with messages in the last 2 days and asks from the last 7.

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

The switch on outside the away dates is assist mode; inside them it is away mode. Dry run, on by default, logs every reply
the hub would send on the ask instead of sending it. Send reply, pressed by me on the push or on the ask, posts even in a
dry run: the app sends the draft as it reads on the phone with the request, so an edit made a moment ago is what goes out, and
a failed send stays on the draft card with a Retry button and the next scan posts it again (3 tries, then one push). If someone answered the thread first, nothing is posted and the ask
closes. An ask the scan tiers hold or escalate (a decision, approval, review, something urgent) is tagged needs-you: its draft is
a holding line, the push says "Needs you" and has no Send action, and the card shows "Needs your decision" with a quiet Send
note. The Overview has a Reply queue: every Slack ask with a draft, the ones that need me first, then oldest first, each with
Send, Edit and Skip in place. The morning brief lists the asks still open oldest first with who asked and the age, the ones
from yesterday or older under their own heading. At the first scan from 17:00 on a weekday the hub writes a day digest
(`briefs` kind `day`, `dayDigest`): what I sent (and how many edited), what failed, what I skipped and what still waits, with
links, and pushes the counts; the app shows it in the brief card. The switch off is the kill switch. The scan reads the settings each
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
backs out if an answer came since), a reply to a bot, a second reply in the same thread (the replies row keeps a thread key; a follow-up in an answered
thread is skipped and pushed to me instead), a
reply to a message older than when the mode turned on, mail (Gmail keeps its own vacation responder; the hub only
drafts).

A post that fails is retried on the next away scans, three tries in all, then pushed to me once (`tries` on the
replies row). Every sent reply starts with a short marker: "(auto-reply from Anshuman's assistant)" in away mode, nothing in
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
   question on a "Support FAQ" page for Review, keyed by permalink so a rerun adds nothing twice (`assistant/src/faq.ts`).
   I approve them before the trip. `ask_context` already feeds live claims into drafts, so nothing else changes.
5. **Away mode.** The scan sends tier A and B as above, at most 10 replies an hour and 40 a day, and at the first
   scan from 17:00 writes the day's digest to `briefs` (kind `away`, `awayDigest`): what it answered, held, escalated
   and skipped, with links. One push a day with the counts. `POST /slack/people` proposes "who owns what" claims on a
   "Who does what" page from the hub's chat summaries and decisions of the last 30 days (`assistant/src/people.ts`). Meetings in the window get a decline with the note only if I enable `"decline": true`.
6. **Dry run.** Run assist mode for a week before the trip. The run log shows how many drafts I sent unchanged, edited
   or skipped per tier. Tier A goes live in away mode only if 80% of its drafts went out unchanged.
7. **Day-to-day offload** (after the trip, same machinery):
   - Linear: a weekday 08:30 job that reads my assigned and mentioned issues, adds tasks for anything blocked on me,
     and drafts a comment per question asked of me, approved like a Slack draft
   - `ai-help`: tier A answers go out with one tap all year, so the FAQ keeps growing from what I send
   - Weekly update and standup already exist as presets; the digest from step 5 becomes the daily "while you were in
     meetings" card in Overview
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
- Whether replies go out as me with a marker, or whether a Slack app user "Anshuman's assistant" is worth the admin ask
- The tier C list: manager and named people
- Which channels count as public enough to answer in (default: the watched list minus `temp-*` and `tmp-*`)
