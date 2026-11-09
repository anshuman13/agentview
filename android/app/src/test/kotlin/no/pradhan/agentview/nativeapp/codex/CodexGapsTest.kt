package no.pradhan.agentview.nativeapp.codex

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import no.pradhan.agentview.nativeapp.app.notices
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotForm
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotOps
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotReply
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotState
import no.pradhan.agentview.nativeapp.codex.autopilot.activityValue
import no.pradhan.agentview.nativeapp.codex.autopilot.awayValue
import no.pradhan.agentview.nativeapp.codex.autopilot.channelsPatch
import no.pradhan.agentview.nativeapp.codex.autopilot.coversValue
import no.pradhan.agentview.nativeapp.codex.autopilot.formOf
import no.pradhan.agentview.nativeapp.codex.autopilot.formPatch
import no.pradhan.agentview.nativeapp.codex.autopilot.modeLine
import no.pradhan.agentview.nativeapp.codex.autopilot.modelValue
import no.pradhan.agentview.nativeapp.codex.autopilot.neverValue
import no.pradhan.agentview.nativeapp.codex.autopilot.parseAutopilot
import no.pradhan.agentview.nativeapp.codex.autopilot.replyBadge
import no.pradhan.agentview.nativeapp.codex.autopilot.spendLine
import no.pradhan.agentview.nativeapp.codex.autopilot.togglePatch
import no.pradhan.agentview.nativeapp.codex.meetings.cadenceOf
import no.pradhan.agentview.nativeapp.codex.meetings.encodeResolved
import no.pradhan.agentview.nativeapp.codex.meetings.nextInSeries
import no.pradhan.agentview.nativeapp.codex.meetings.openAcrossSeries
import no.pradhan.agentview.nativeapp.codex.meetings.openQuestions
import no.pradhan.agentview.nativeapp.codex.meetings.parseResolved
import no.pradhan.agentview.nativeapp.codex.meetings.parseSeriesKey
import no.pradhan.agentview.nativeapp.codex.meetings.seriesKeyOf
import no.pradhan.agentview.nativeapp.codex.meetings.seriesMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.seriesOf
import no.pradhan.agentview.nativeapp.codex.meetings.seriesPeople
import no.pradhan.agentview.nativeapp.codex.meetings.seriesRepeats
import no.pradhan.agentview.nativeapp.codex.meetings.summaryLines
import no.pradhan.agentview.nativeapp.codex.meetings.visibleQuestions
import no.pradhan.agentview.nativeapp.codex.meetings.withResolved
import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.Writes
import no.pradhan.agentview.nativeapp.net.pin
import no.pradhan.agentview.nativeapp.net.rename
import no.pradhan.agentview.nativeapp.net.send
import no.pradhan.agentview.nativeapp.sessions.items
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.workspace.ReviewOps
import no.pradhan.agentview.nativeapp.workspace.approveAllChanges
import no.pradhan.agentview.nativeapp.workspace.extendOrder
import no.pradhan.agentview.nativeapp.workspace.rejectChanges
import no.pradhan.agentview.nativeapp.workspace.reviewQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private fun at(d: Int, h: Int, mi: Int = 0, m: Int = 11) = ZonedDateTime.of(2026, m, d, h, mi, 0, 0, ZoneId.of("UTC")).toInstant().toEpochMilli()

private fun r(table: String, id: String, profile: String = WORK, vararg v: Pair<String, Any?>): Row {
    val f = SYNCED_FIELDS.getValue(table).associateWith { JsonNull as JsonElement }.toMutableMap()
    for ((k, x) in v) f[k] = toJson(x)
    return Row(table, id, profile, updatedAt = NOW - 1000, f = f)
}

private fun ask(id: String, draft: String? = "ok", vararg v: Pair<String, Any?>) = item(id, "suggested", null, WORK, "source" to "slack", "draft" to draft, "people" to "Ada Lovelace", *v)

private fun mtg(id: String, title: String, start: Long, vararg v: Pair<String, Any?>) = r("meetings", id, WORK, "title" to title, "starts_at" to start, "ends_at" to start + 3_600_000, *v)

private fun store(scope: TestScope, writable: () -> Boolean = { true }, notices: MutableList<String> = mutableListOf()) = CodexStore(scope, { _, _ -> "{}" }, { "{}" }, writable, { notices.add(it) }, { 5000L }, EmptyCoroutineContext)

private class FakeRemote : AssistantRemote {
    val calls = mutableListOf<String>()
    var reply = """{"status":"sent","url":null}"""
    var fail: String? = null
    override suspend fun autopilot(patch: String?): String { calls.add("autopilot:$patch"); return """{"config":{"enabled":true,"dry_run":false},"mode":"assist"}""" }
    override suspend fun replyHistory(who: String): String { calls.add("history:$who"); return """{"replies":[{"at":1000,"line":"hi"}]}""" }
    override suspend fun sendReply(id: String, edited: Boolean, text: String?): String { calls.add("send:$id:$edited:$text"); fail?.let { throw ApiError(it) }; return reply }
    override suspend fun skipAsk(id: String) { calls.add("skip:$id") }
}

@OptIn(ExperimentalCoroutinesApi::class)
class CodexGapsTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    @Test fun replyQueueOrdersNeedsYouThenFaqThenOldest() {
        val faq = ask("faq", "yes", "tags" to "faq")
        val plain = ask("plain")
        val mine = ask("mine", null, "tags" to "needs-you")
        val old = ask("old", "x").copy(times = mapOf("status" to NOW - 5 * DAY_MS))
        val q = replyQueue(listOf(plain, faq, mine, old, ask("snoozed", "x", "snoozed_until" to NOW + 1000), ask("said:1"), item("t", "open", null, WORK, "source" to "slack")), null, NOW)
        assertEquals(listOf("faq", "old", "plain", "mine"), q.map { it.id }.let { ids -> ids })
    }

    @Test fun aSnoozedAskReturnsWhenItsTimePasses() {
        val a = ask("a", "x", "snoozed_until" to NOW - 1)
        assertEquals(1, replyQueue(listOf(a), null, NOW).size)
        assertEquals(1, replyQueue(listOf(a), WORK, NOW).size)
        assertEquals(0, replyQueue(listOf(a), PERSONAL, NOW).size)
    }

    @Test fun asksOlderThanThreeDaysAreStale() {
        val old = ask("old").copy(times = mapOf("status" to NOW - 4 * DAY_MS))
        assertEquals(listOf("old"), staleAsks(listOf(old, ask("new")), NOW).map { it.id })
    }

    @Test fun snoozeOptionsDropLaterTodayAfterThree() {
        assertEquals(listOf("In 1 hour", "Later today, 16:00", "Next workday, Mon 9 Nov 09:00"), snoozeOptions(NOW, WORK).map { it.label })
        assertEquals(at(7, 16), snoozeOptions(NOW, WORK)[1].at)
        assertEquals(2, snoozeOptions(at(7, 16), WORK).size)
    }

    @Test fun adminRequestsCopyAsOneList() {
        val rows = listOf(ask("a", "x", "tags" to "access", "title" to "Seat", "source_url" to "https://s/1"), ask("b", "x", "tags" to "limit", "title" to "Limit"), ask("c"))
        assertEquals(2, adminCount(rows))
        assertEquals("- Ada Lovelace: Seat https://s/1\n- Ada Lovelace: Limit", adminList(rows))
    }

    @Test fun sendingPostsTheTextAndSyncsAndAReadOnlyRunSendsNothing() = runTest {
        val remote = FakeRemote()
        val snacks = mutableListOf<String>()
        val notices = mutableListOf<String>()
        var readOnly = false
        val ops = ReplyOps(remote, Writes(this, { readOnly }, { notices.add(it) }), store(this), { t, _ -> snacks.add(t) })
        var result: Pair<Boolean, String?>? = null
        ops.send(ask("a"), " hello ", true) { ok, f -> result = ok to f }
        advanceUntilIdle()
        assertEquals(listOf("send:a:true:hello"), remote.calls)
        assertEquals(listOf("Reply sent"), snacks)
        assertEquals(true to null, result)
        readOnly = true
        ops.send(ask("a"), "again", false) { ok, _ -> result = ok to null }
        ops.skip(ask("a"))
        ops.sendAllFaq(listOf(ask("a")))
        advanceUntilIdle()
        assertEquals(1, remote.calls.size)
        assertEquals(false, result?.first)
        assertEquals(listOf(READ_ONLY_SENT, READ_ONLY_SENT, READ_ONLY_SENT), notices)
    }

    @Test fun aFailedSendReportsTheErrorAndAnAnsweredThreadSaysSo() = runTest {
        val remote = FakeRemote()
        val snacks = mutableListOf<String>()
        val notices = mutableListOf<String>()
        val ops = ReplyOps(remote, Writes(this, { false }, { notices.add(it) }), store(this), { t, _ -> snacks.add(t) })
        remote.fail = "Slack said no"
        var failure: String? = null
        ops.send(ask("a"), "x", false) { _, f -> failure = f }
        advanceUntilIdle()
        assertEquals("Slack said no", failure)
        assertEquals(listOf("Slack said no"), notices)
        remote.fail = null
        remote.reply = """{"status":"answered"}"""
        ops.send(ask("a"), "x", false)
        advanceUntilIdle()
        assertEquals(listOf("Not sent: someone already answered in the thread"), snacks)
    }

    @Test fun faqAnswersGoOutOneByOneAndHistoryIsCachedUntilAReplyGoesOut() = runTest {
        val remote = FakeRemote()
        val snacks = mutableListOf<String>()
        val ops = ReplyOps(remote, Writes(this, { false }, {}), store(this), { t, _ -> snacks.add(t) })
        ops.sendAllFaq(listOf(ask("a", "one"), ask("b", "two")))
        advanceUntilIdle()
        assertEquals(listOf("send:a:false:one", "send:b:false:two"), remote.calls)
        assertEquals(listOf("Sent 2 FAQ answers"), snacks)
        ops.history("Ada Lovelace"); ops.history(" ada lovelace ")
        assertEquals(1, remote.calls.count { it.startsWith("history") })
        ops.send(ask("c"), "x", false)
        advanceUntilIdle()
        ops.history("Ada Lovelace")
        assertEquals(2, remote.calls.count { it.startsWith("history") })
    }

    @Test fun autopilotStateReadsTheHubAndPatchesGoThroughWrites() = runTest {
        val s = parseAutopilot("""{"config":{"dms":true,"enabled":true,"auto_send":true,"dry_run":true,"away":{"from":"2026-11-10","to":"2026-11-14","backup":"Bo","note":""},"escalate":["Cy"],"manager":"Di","channels":["a"]},"mode":"away","watched":["a","b"],"covered":["a"],"scan":{"ok":${at(7, 9)},"error":"x","failed":${at(7, 8)}},"spend":{"today":{"usd":1.5,"models":[]},"week":{"usd":12.4,"models":[{"model":"claude-sonnet-5-5-20260101","usd":10.0}],"jobs":{"j":2.0}}},"replies":[{"id":"1","who":"Ada","status":"held","at":1}],"extra":1}""")
        assertEquals("Away until 14 Nov · 1 waiting for you · Dry run".replace("1 waiting", "2 waiting"), modeLine(s, 2))
        assertEquals("10 Nov to 14 Nov", awayValue(s))
        assertEquals("DMs and 1 of 2 channels", coversValue(s))
        assertEquals("2 people", neverValue(s))
        assertEquals("Sonnet", modelValue(s))
        assertEquals("Scan 09:00 · \$12 in 7 days", activityValue(s, NOW))
        assertEquals("Hub Claude use: today \$1.50 · 7 days \$12 (sonnet-5-5 \$10) · jobs \$2.00", spendLine(s))
        assertEquals("Off", modeLine(AutopilotState(), 0))
        val patch = formPatch(AutopilotForm("2026-11-10", "2026-11-14", "Bo", "n", "Cy, Ed ,", "Di"), s)!!
        assertTrue(patch.contains("\"escalate\":[\"Cy\",\"Ed\"]") && patch.contains("\"note\":\"n\""))
        assertNull(formPatch(formOf(s), s))
        assertEquals("""{"channels":["a","b"]}""", channelsPatch(s, "b"))
        assertEquals("""{"channels":[]}""", channelsPatch(s, "a"))
        val remote = FakeRemote()
        var readOnly = false
        val ops = AutopilotOps(remote, Writes(this, { readOnly }, {}))
        var saved: AutopilotState? = null
        ops.save(togglePatch("enabled", true)) { saved = it }
        advanceUntilIdle()
        assertTrue(saved!!.config.enabled)
        readOnly = true
        saved = null
        ops.save(togglePatch("enabled", false)) { saved = it }
        advanceUntilIdle()
        assertNull(saved)
        assertEquals(listOf("autopilot:{\"enabled\":true}"), remote.calls)
        assertEquals("Needs you" to "waiting", replyBadge(s.replies[0], listOf(item("1", "suggested", null, WORK, "source" to "slack"))))
        assertEquals("Skipped" to "skipped", replyBadge(s.replies[0], listOf(item("1", "dismissed", null, WORK, "source" to "slack"))))
        assertEquals("Skipped" to "skipped", replyBadge(AutopilotReply(id = "2", status = "dry"), emptyList()))
    }

    @Test fun seriesOfNeedsSharedGuestsAndListsNewestFirst() {
        val a = mtg("cal:a", "Sync #1", at(25, 9, 0, 10), "people" to """["x@o.com","y@o.com"]""", "decisions" to """["Ship it"]""")
        val b = mtg("cal:b", "Sync #2", at(1, 9), "people" to """["x@o.com","y@o.com"]""", "decisions" to """["ship it"]""")
        val c = mtg("cal:c", "Sync #3", at(14, 9), "people" to """["x@o.com","y@o.com"]""")
        val stranger = mtg("cal:s", "Sync #4", at(2, 9), "people" to """["p@o.com","q@o.com"]""")
        assertEquals(listOf("cal:b", "cal:a"), seriesOf(listOf(a, b, c, stranger), c).map { it.id })
        assertEquals(listOf("ship it"), seriesRepeats(b, a, NOW).decisions)
    }

    @Test fun seriesGroupsRecurringMeetingsAndFindsTheNextOne() {
        val a = mtg("cal:a", "Sync #1", at(25, 9, 0, 10), "people" to """["x@o.com","y@o.com"]""")
        val b = mtg("cal:b", "Sync #2", at(1, 9), "people" to """["x@o.com","y@o.com"]""")
        val c = mtg("cal:c", "Sync #3", at(14, 9), "people" to """["x@o.com"]""")
        val other = mtg("cal:o", "Other", at(3, 9))
        val all = listOf(a, b, c, other)
        val (profile, title) = parseSeriesKey(seriesKeyOf(a))
        assertEquals(WORK to "sync", profile to title)
        assertEquals(listOf("cal:b", "cal:a"), seriesMeetings(all, profile, title, NOW).map { it.id })
        assertEquals("cal:c", nextInSeries(all, profile, title, NOW)?.id)
        assertEquals("Weekly", cadenceOf(listOf(b, a)))
        assertNull(cadenceOf(listOf(a)))
        assertEquals(listOf("x@o.com", "y@o.com"), seriesPeople(listOf(b, a)))
        val open = openAcrossSeries(listOf(item("t1", "open", null, WORK, "meeting_id" to "cal:b"), item("t2", "open", null, WORK, "meeting_id" to "cal:a"), item("t3", "done", null, WORK, "meeting_id" to "cal:a")), listOf(b, a))
        assertEquals(listOf("t2", "t1"), open.map { it.second.id })
    }

    @Test fun openQuestionsComeFromSummariesAndNotesAndResolveForGood() {
        val m1 = mtg("cal:1", "A", at(2, 9), "summary" to "We met. Who owns billing? Fine.\n## Questions\n- When is launch\n- [x] ok", "notes" to "- Who owns billing?")
        val m2 = mtg("cal:2", "B", at(5, 9), "summary" to "Who owns billing?")
        val future = mtg("cal:3", "C", at(20, 9), "summary" to "Why later?")
        val qs = openQuestions(listOf(m1, m2, future), NOW)
        assertEquals(listOf("Who owns billing?", "When is launch", "[x] ok"), qs.map { it.text })
        assertEquals("cal:2", qs[0].meeting.id)
        val next = withResolved(listOf("work:gone?"), qs[0], listOf(m1, m2, future), NOW)
        assertEquals(listOf("work:who owns billing?"), next)
        assertEquals(listOf("When is launch", "[x] ok"), visibleQuestions(qs, next).map { it.text })
        assertEquals(next, parseResolved(encodeResolved(next)))
        assertEquals(listOf("A line", "Two"), summaryLines("- A line\n\n**Two**"))
    }

    @Test fun pointsWaitForTheFirstMeetingWithThePersonAndTurnRaisedAfterIt() = runTest {
        val m = mtg("cal:1", "1:1", at(9, 9), "people" to """["Ada Lovelace"]""")
        val past = mtg("cal:0", "1:1", at(1, 9), "people" to """["Ada Lovelace"]""")
        val p = item("p", POINT, null, WORK, "people" to "Ada Lovelace", "source" to "raise")
        assertEquals("cal:1", pointMeeting(p, listOf(m, past))?.id)
        assertEquals(listOf("p"), pointsFor(m, listOf(p), listOf(m, past)).map { it.id })
        assertEquals(listOf("p"), pointsOf(listOf(p, item("q", POINT)), " ada lovelace").map { it.id })
        assertEquals(0, endedPoints(listOf(p), listOf(m), NOW).size)
        assertEquals(1, endedPoints(listOf(p), listOf(m), at(9, 11)).size)
        assertEquals(listOf("Bo", "Ada Lovelace"), recentPeople(listOf(m, past, mtg("cal:2", "x", at(2, 9), "people" to """["Bo"]""")), WORK, null, NOW))
        assertEquals("Ada", firstName("Ada Lovelace"))

        val snacks = mutableListOf<String>()
        val notices = mutableListOf<String>()
        var writable = true
        val st = store(this, { writable }, notices)
        val acts = PointActions(st, { t, _ -> snacks.add(t) })
        assertTrue(acts.raise("Ask about budget", "Ada Lovelace", WORK))
        val row = st.state.value.items.single()
        assertEquals(POINT, row.status)
        assertEquals("raise", row.source)
        assertEquals("Ada Lovelace", row.people)
        acts.tick(row)
        assertEquals(RAISED, st.current(row).status)
        assertTrue(acts.pin("Decision: ship it", m))
        val pin = pinsOf(st.state.value.items, listOf(m)).single()
        assertEquals("Decision: ship it", pin.text)
        assertEquals("note", pin.status)
        acts.unpin(pin)
        assertTrue(pinsOf(st.state.value.items, listOf(m)).isEmpty())
        assertEquals(listOf("Raise with Ada next time", "Raised", "Pinned", "Unpinned"), snacks)
        writable = false
        assertFalse(acts.raise("x", "Ada", WORK))
        assertFalse(acts.pin("x", m))
        assertEquals(2, notices.size)
    }

    @Test fun reviewApprovesClaimsWithTheirPageAndRejectsThemAsOne() = runTest {
        val page = r("pages", "pg", WORK, "title" to "Billing", "state" to "proposed")
        val old = r("facts", "old", WORK, "text" to "old", "state" to "live", "page_id" to "pg")
        val f1 = r("facts", "f1", WORK, "text" to "one", "state" to "proposed", "page_id" to "pg", "replaces" to "old", "at" to 2)
        val f2 = r("facts", "f2", WORK, "text" to "two", "state" to "proposed", "page_id" to "pg", "at" to 1)
        val changes = approveAllChanges(listOf(f1, f2), listOf(page), listOf(old, f1, f2))
        assertEquals(listOf("f1", "pg", "old", "f2"), changes.map { it.row.id })
        assertEquals("f1", changes[2].patch["superseded_by"])
        assertEquals(listOf("f1", "f2", "pg"), rejectChanges(listOf(f1, f2), listOf(page), listOf(old, f1, f2)).map { it.row.id })
        assertEquals(listOf("f1"), rejectChanges(listOf(f1), listOf(page), listOf(old, f1, f2)).map { it.row.id })

        val snacks = mutableListOf<Pair<String, (() -> Unit)?>>()
        val st = store(this)
        st.add(f1); st.add(f2); st.add(page)
        val ops = ReviewOps(st, { t, u -> snacks.add(t to u) })
        ops.approve(listOf(f1))
        assertEquals("live", st.current(f1).str("state"))
        assertEquals("live", st.current(page).str("state"))
        assertEquals("Approved 1 claim", snacks.last().first)
        snacks.last().second!!.invoke()
        assertEquals("proposed", st.current(f1).str("state"))
        assertEquals("proposed", st.current(page).str("state"))
        ops.reject(listOf(f1, f2))
        assertEquals("rejected", st.current(page).str("state"))
        assertEquals("Rejected 2 claims", snacks.last().first)
    }

    @Test fun reviewKeepsItsOrderAndSkippedClaimsGoToTheBack() {
        val order = extendOrder(extendOrder(emptyList(), listOf("a", "b", "c")), listOf("c", "d"))
        assertEquals(listOf("a", "b", "c", "d"), order)
        assertEquals(listOf("a", "c", "b"), reviewQueue(order, listOf("b"), setOf("a", "b", "c")))
        assertEquals(listOf("c", "b"), reviewQueue(order, listOf("b"), setOf("b", "c")))
    }

    @Test fun recipesMatchOnlyAfterASlash() {
        assertTrue(matchRecipes(DEFAULT_RECIPES, "plain").isEmpty())
        assertEquals(3, matchRecipes(DEFAULT_RECIPES, "/").size)
        assertEquals(listOf("decisions"), matchRecipes(DEFAULT_RECIPES, "/open dec").map { it.id })
        assertEquals(listOf("week"), matchRecipes(DEFAULT_RECIPES, "/WEEK").map { it.id })
    }

    @Test fun goalsAddRenameReopenAndRemoveWithTheirLimits() = runTest {
        val snacks = mutableListOf<String>()
        val st = store(this)
        val goals = GoalActions(st, { t, _ -> snacks.add(t) }, { NOW })
        assertTrue(goals.add("  Ship v2 ", WORK))
        assertTrue(goals.add("Hire", WORK))
        assertTrue(goals.add("Learn", WORK))
        assertFalse(goals.add("Fourth", WORK))
        assertTrue(goals.add("Personal one", PERSONAL))
        val g = goalsOf(st.state.value.items, NOW, WORK)
        assertEquals(listOf("Ship v2", "Hire", "Learn"), g.map { it.title })
        goals.rename(g[0], "hire")
        assertEquals("Ship v2", st.current(g[0]).title)
        assertEquals("Already a goal that week", snacks.last())
        goals.rename(g[0], "Ship v3")
        assertEquals("Ship v3", st.current(g[0]).title)
        val last = item("old", "goal", at(2, 0), WORK, "title" to "Ship v2")
        assertEquals("This week is full ($MAX_GOALS goals)", reopenBlock(st.state.value.items + last, last, NOW))
        goals.remove(g[2])
        assertNull(reopenBlock(st.state.value.items, last, NOW))
        assertEquals("Already this week", reopenBlock(st.state.value.items, item("o2", "goal", at(2, 0), WORK, "title" to "hire"), NOW))
        goals.reopen(last)
        assertEquals("Goal reopened", snacks.last())
    }

    @Test fun needsYouKeepsDraftedSlackAsksForTheReplyQueueAndAddsStaleAndWikiRows() {
        val drafted = ask("d")
        val old = ask("o", "x").copy(times = mapOf("status" to NOW - 4 * DAY_MS))
        val plain = item("p", "suggested", null, WORK, "source" to "email")
        val claim = r("facts", "f", WORK, "state" to "proposed")
        val needs = needsYou(listOf(drafted, old, plain), emptyList(), emptyList(), null, NOW, listOf(claim))
        assertEquals(listOf("Ask", "StaleAsks", "Wiki"), needs.map { it::class.simpleName })
        assertEquals(1, (needs[1] as Need.StaleAsks).count)
        assertEquals(1, (needs[2] as Need.Wiki).count)
        assertEquals(0, needsYou(listOf(drafted), emptyList(), emptyList(), null, NOW).size)
    }

    @Test fun prepGroupsShowThreeRowsWhenFoldedOrCapped() {
        val rows = (1..5).map { DigestLine("r$it") }
        assertEquals(5, visibleRows(DigestGroup("a", "A", rows, true), false).size)
        assertEquals(3, visibleRows(DigestGroup("a", "A", rows, true), false, capOpen = true).size)
        assertEquals(3, visibleRows(DigestGroup("a", "A", rows, false), false).size)
        assertEquals(5, visibleRows(DigestGroup("a", "A", rows, false), true).size)
        val m = mtg("cal:1", "x", at(9, 9), "people" to """["Ada Lovelace"]""")
        val earlier = mtg("cal:0", "x", at(2, 9), "others" to """[{"who":"Ada Lovelace","what":"send deck"},{"who":"Zed","what":"no"}]""")
        assertEquals(listOf("Ada: send deck"), theirActions(m, listOf(earlier)))
    }
}
