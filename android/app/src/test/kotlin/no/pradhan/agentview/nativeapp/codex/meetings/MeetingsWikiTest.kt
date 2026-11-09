package no.pradhan.agentview.nativeapp.codex.meetings

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import no.pradhan.agentview.nativeapp.app.popRoute
import no.pradhan.agentview.nativeapp.app.pushRoute
import no.pradhan.agentview.nativeapp.app.routesOf
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.DAY_MS
import no.pradhan.agentview.nativeapp.codex.NOW
import no.pradhan.agentview.nativeapp.codex.PERSONAL
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.SYNCED_FIELDS
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.codex.edited
import no.pradhan.agentview.nativeapp.codex.isSolo
import no.pradhan.agentview.nativeapp.codex.item
import no.pradhan.agentview.nativeapp.codex.jobs.JobState
import no.pradhan.agentview.nativeapp.codex.jobs.describeSchedule
import no.pradhan.agentview.nativeapp.codex.jobs.isEnabled
import no.pradhan.agentview.nativeapp.codex.jobs.jobMeta
import no.pradhan.agentview.nativeapp.codex.jobs.jobState
import no.pradhan.agentview.nativeapp.codex.jobs.jobsOf
import no.pradhan.agentview.nativeapp.codex.jobs.runMeta
import no.pradhan.agentview.nativeapp.codex.jobs.runsOf
import no.pradhan.agentview.nativeapp.codex.parseRow
import no.pradhan.agentview.nativeapp.codex.rowToChange
import no.pradhan.agentview.nativeapp.codex.toJson
import no.pradhan.agentview.nativeapp.codex.wiki.contestOf
import no.pradhan.agentview.nativeapp.codex.wiki.olderClaims
import no.pradhan.agentview.nativeapp.codex.wiki.pageClaims
import no.pradhan.agentview.nativeapp.codex.wiki.pageNeedsReview
import no.pradhan.agentview.nativeapp.codex.wiki.searchWiki
import no.pradhan.agentview.nativeapp.codex.wiki.sourcesOf
import no.pradhan.agentview.nativeapp.codex.wiki.statsByPage
import no.pradhan.agentview.nativeapp.codex.wiki.wikiSections
import no.pradhan.agentview.nativeapp.net.Queued
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private fun at(d: Int, h: Int, mi: Int = 0, m: Int = 11) = ZonedDateTime.of(2026, m, d, h, mi, 0, 0, ZoneId.of("UTC")).toInstant().toEpochMilli()

private fun row(table: String, id: String, profile: String = WORK, vararg v: Pair<String, Any?>): Row {
    val f = SYNCED_FIELDS.getValue(table).associateWith { JsonNull as JsonElement }.toMutableMap()
    for ((k, x) in v) f[k] = toJson(x)
    return Row(table, id, profile, updatedAt = NOW - 1000, f = f)
}

private fun act(id: String, status: String, meeting: String, vararg v: Pair<String, Any?>) = item(id, status, null, WORK, "meeting_id" to meeting, *v)

private fun meeting(id: String, title: String, start: Long, end: Long = start + 3_600_000, vararg v: Pair<String, Any?>) =
    row("meetings", id, WORK, "title" to title, "starts_at" to start, "ends_at" to end, *v)

private fun fact(id: String, text: String, page: String? = "p1", heading: String? = "Rules", vararg v: Pair<String, Any?>) =
    row("facts", id, WORK, "text" to text, "page_id" to page, "heading" to heading, "state" to "live", "at" to NOW - 1000, *v)

class MeetingsWikiTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    @Test fun pastMeetingsGroupByDayNewestDayFirst() {
        val a = meeting("cal:a", "Standup", at(7, 8)); val b = meeting("cal:b", "Review", at(7, 9)); val c = meeting("cal:c", "Retro", at(5, 14))
        val future = meeting("cal:f", "Later", at(8, 9))
        val g = groupMeetings(listOf(c, b, a, future), NOW)
        assertEquals(listOf("Today", "Thu, 5 Nov"), g.map { it.label })
        assertEquals(listOf("Standup", "Review"), g[0].rows.map { it.title })
    }

    @Test fun comingDaysStartWithTodayAndSkipEndedMeetings() {
        val ended = meeting("cal:e", "Done", at(7, 8)); val running = meeting("cal:r", "Now", at(7, 10)); val tomorrow = meeting("cal:t", "Tomorrow", at(8, 9))
        val far = meeting("cal:z", "Far", at(20, 9))
        val g = comingDays(listOf(ended, running, tomorrow, far), NOW)
        assertEquals(listOf("Today", "Tomorrow"), g.map { it.label })
        assertEquals(listOf("Now"), g[0].rows.map { it.title })
    }

    @Test fun meetingStateFollowsTheCalendarAndTranscript() {
        assertEquals(MState.Manual, meetingState(meeting("manual", "Notes", at(7, 9)), NOW))
        assertEquals(MState.Upcoming, meetingState(meeting("cal:a", "x", at(7, 12)), NOW))
        assertEquals(MState.Live, meetingState(meeting("cal:a", "x", at(7, 10)), NOW))
        val past = at(6, 9)
        assertEquals(MState.Waiting, meetingState(meeting("cal:a", "x", past, past + 1, "people" to "[\"A\"]"), NOW))
        assertEquals(MState.Done, meetingState(meeting("cal:a", "x", past, past + 1, "transcript" to "done"), NOW))
        assertEquals(MState.Done, meetingState(meeting("cal:a", "x", past, past + 1, "summary" to "ok"), NOW))
        assertEquals(MState.Missing, meetingState(meeting("cal:a", "x", past, past + 1, "transcript" to "missing"), NOW))
        assertEquals(MState.Manual, meetingState(meeting("cal:a", "x", past, past + 1, "people" to "[]"), NOW))
    }

    @Test fun chipsNarrowThePastMeetings() {
        val mine = meeting("cal:a", "Weekly sync 12", at(2, 9), at(2, 10), "organizer_me" to 1, "people" to "[\"Ann\",\"Bob\"]", "transcript" to "done")
        val other = meeting("cal:b", "Weekly sync 13", at(3, 9), at(3, 10), "people" to "[\"Ann\",\"Bob\"]", "transcript" to "missing")
        val single = meeting("cal:c", "One off", at(4, 9), at(4, 10), "people" to "[\"Zed\"]", "transcript" to "done")
        val all = listOf(mine, other, single)
        val task = act("t1", "open", "cal:c")
        assertEquals(listOf("cal:a"), filterMeetings(all, emptyList(), setOf("Mine"), NOW).map { it.id })
        assertEquals(listOf("cal:b"), filterMeetings(all, emptyList(), setOf("Not recorded"), NOW).map { it.id })
        assertEquals(listOf("cal:c"), filterMeetings(all, listOf(task), setOf("With actions"), NOW).map { it.id })
        assertEquals(listOf("cal:a", "cal:b"), filterMeetings(all, emptyList(), setOf("Series"), NOW).map { it.id })
        assertEquals(3, filterMeetings(all, emptyList(), emptySet(), NOW).size)
        assertEquals("weekly sync", seriesTitle("Weekly sync #12 (5 Nov)"))
    }

    @Test fun searchCoversTitlePeopleSummaryAndDecisions() {
        val a = meeting("cal:a", "Budget", at(2, 9), v = arrayOf("summary" to "We agreed on hiring", "people" to "[\"Ann Lee\"]"))
        val b = meeting("cal:b", "Other", at(2, 9), v = arrayOf("decisions" to "[\"Ship friday\"]"))
        assertEquals(listOf("cal:a"), searchMeetings(listOf(a, b), "hiring agreed").map { it.id })
        assertEquals(listOf("cal:b"), searchMeetings(listOf(a, b), "friday").map { it.id })
        assertEquals(listOf("cal:a"), searchMeetings(listOf(a, b), "ann").map { it.id })
        assertEquals(2, searchMeetings(listOf(a, b), "").size)
    }

    @Test fun pageMetaAndActionCounts() {
        val m = meeting("cal:a", "Sync", at(7, 9), at(7, 9, 30), "room" to "Big room", "people" to "[\"A\",\"B\"]", "recorded_ms" to 1_800_000)
        assertEquals("Sat 09:00-09:30 · Big room · 2 people · Recorded 30 min", pageMeta(m))
        val items = listOf(
            act("1", "open", "cal:a"), act("2", "done", "cal:a"), act("3", "suggested", "cal:a"),
            act("4", "dismissed", "cal:a"), act("5", "open", "cal:other"), act("6", "open", "cal:a", "assignee" to "Bob"),
        )
        val c = actionCount(items, m)
        assertEquals(listOf(2, 1, 1, 0, 1), listOf(c.total, c.done, c.review, c.unassigned, c.dismissed))
    }

    @Test fun decisionLogAndSolo() {
        val a = meeting("cal:a", "A", at(2, 9), v = arrayOf("decisions" to "[\"One\",\" \",\"Two\"]"))
        val b = meeting("cal:b", "B", at(4, 9), v = arrayOf("decisions" to "[\"Three\"]"))
        assertEquals(listOf("Three", "One", "Two"), decisionLog(listOf(a, b)).map { it.text })
        assertTrue(isSolo(meeting("cal:s", "Lunch", at(2, 9), v = arrayOf("people" to "[]"))))
        assertEquals(emptyList<String>(), jsonList("not json"))
    }

    @Test fun peopleNamesMatchByEmailOrName() {
        assertEquals("Anna Berg", displayName("anna.berg@example.com"))
        assertTrue(sameName("Anna Berg", "anna.berg@example.com"))
        val a = meeting("cal:a", "A", at(2, 9), v = arrayOf("people" to "[\"anna.berg@example.com\",\"Bob\"]", "others" to "[{\"who\":\"Anna Berg\",\"what\":\"Send slides\"}]"))
        val b = meeting("cal:b", "B", at(4, 9), v = arrayOf("people" to "[\"Anna Berg\"]"))
        assertEquals(listOf("B", "A"), meetingsWith(listOf(a, b), "anna.berg@example.com").map { it.title })
        assertEquals("Anna Berg", nameOf(listOf(a, b), "anna.berg@example.com"))
        assertEquals(listOf("Send slides"), commitmentsOf(listOf(a, b), "Anna Berg").map { it.what })
    }

    @Test fun prepFindsEarlierMeetingsAndClaims() {
        val earlier = meeting("cal:old", "Planning", at(2, 9), v = arrayOf("people" to "[\"Ann\"]", "decisions" to "[\"Use Kotlin\"]"))
        val next = meeting("cal:new", "Planning", at(9, 9), v = arrayOf("people" to "[\"Ann\"]"))
        val items = listOf(act("1", "open", "cal:old"), item("2", "open", null, WORK, "title" to "Ping Ann about budget"))
        val prior = priorWith(next, listOf(earlier, next), items)
        assertEquals(listOf("cal:old"), prior.map { it.meeting.id })
        assertEquals(listOf("Use Kotlin"), prior[0].decisions)
        assertEquals(1, prior[0].open.size)
        val brief = briefFor(next, items, listOf(fact("f1", "Ann owns the budget"), fact("f2", "Unrelated")))
        assertEquals(listOf("Ann"), brief.tasks.map { it.first })
        assertEquals(listOf("f1"), brief.claims.map { it.id })
        assertEquals(listOf("f1"), claimsMentioning(listOf(fact("f1", "Ann owns the budget"), fact("f2", "Unrelated")), "ann").map { it.id })
    }

    @Test fun takeNotesBuildsAManualMeeting() {
        val n = newNotes(PERSONAL, NOW, "n1")
        assertEquals(MState.Manual, meetingState(n, NOW + 60_000))
        assertEquals("Notes", n.title)
        assertEquals(NOW, n.startsAt)
        assertTrue(n.dirty)
        assertEquals(setOf("title", "starts_at", "notes"), rowToChange(n)["field_times"]!!.let { (it as kotlinx.serialization.json.JsonObject).keys })
    }

    @Test fun wikiSectionsFollowTheFixedOrder() {
        val pages = listOf(
            row("pages", "a", WORK, "title" to "Zed", "section" to "Domain"), row("pages", "b", WORK, "title" to "Orca", "section" to "Teams", "sort" to 2),
            row("pages", "c", WORK, "title" to "First", "section" to "Teams", "sort" to 1), row("pages", "o", WORK, "title" to "Over", "section" to "overview"),
            row("pages", "r", WORK, "title" to "Gone", "section" to "Teams", "state" to "retired"), row("pages", "n", WORK, "title" to "Loose"),
        )
        val s = wikiSections(pages)
        assertEquals(listOf("Teams", "Domain", "Pages"), s.map { it.name })
        assertEquals(listOf("First", "Orca"), s[0].pages.map { it.title })
    }

    @Test fun pageClaimsGroupByHeadingAndKeepReplacedOnes() {
        val old = fact("f1", "Old rule", "p1", "Rules", "superseded_by" to "f2", "at" to NOW - 5000)
        val cur = fact("f2", "New rule", "p1", "Rules", "at" to NOW - 4000)
        val other = fact("f3", "A note", "p1", null, "at" to NOW - 100)
        val elsewhere = fact("f4", "Other page", "p2")
        val proposed = fact("f5", "Maybe", "p1", "Rules", "state" to "proposed", "at" to NOW - 3000)
        val g = pageClaims(listOf(old, cur, other, elsewhere, proposed), "p1", NOW)
        assertEquals(listOf("Notes", "Rules"), g.map { it.heading })
        val rules = g[1].claims
        assertEquals(listOf("f5", "f2"), rules.map { it.fact.id })
        assertEquals(listOf("f1"), rules[1].old.map { it.id })
        assertEquals(2, statsByPage(listOf(old, cur, other, elsewhere))["p1"]!!.claims)
    }

    @Test fun oldAndRetiredClaimsMoveToOlder() {
        val ancient = fact("f1", "Ancient", "p1", "Rules", "at" to NOW - 100 * DAY_MS)
        val retired = fact("f2", "Retired", "p1", "Rules", "state" to "retired")
        val fresh = fact("f3", "Fresh")
        val facts = listOf(ancient, retired, fresh)
        assertEquals(listOf("f3"), pageClaims(facts, "p1", NOW).flatMap { g -> g.claims.map { it.fact.id } })
        assertEquals(listOf("f2", "f1").sorted(), olderClaims(facts, "p1", NOW).map { it.id }.sorted())
    }

    @Test fun claimsReadSourcesAndContests() {
        val f = fact("f1", "x", v = arrayOf("sources" to "[{\"kind\":\"slack\",\"label\":\"#team\",\"url\":\"https://s\"}]", "contested" to "{\"by\":\"you\",\"at\":123,\"note\":\"stale\"}"))
        assertEquals(listOf("#team"), sourcesOf(f).map { it.label })
        assertEquals("stale", contestOf(f)!!.note)
        assertEquals(123L, contestAt(f))
        assertNull(contestOf(fact("f2", "y")))
        assertEquals(listOf("f1"), searchWiki(emptyList(), listOf(f), "team").claims.map { it.id })
        assertTrue(pageNeedsReview(row("pages", "p1", WORK, "state" to "proposed"), emptyList()))
        assertFalse(pageNeedsReview(row("pages", "p1"), emptyList()))
    }

    @Test fun schedulesReadAsText() {
        assertEquals("Weekdays at 08:00", describeSchedule("weekdays 08:00"))
        assertEquals("Every hour", describeSchedule("hourly"))
        assertEquals("Mondays at 09:30", describeSchedule("weekly mon 9:30"))
        assertEquals("Every day at 07:00", describeSchedule("daily 07:00"))
        assertEquals("Once, Sun, 1 Nov at 20:38", describeSchedule("once 2026-11-01 20:38"))
        assertEquals("Cron */15 0-8 * * 1-5", describeSchedule("*/15 0-8 * * 1-5"))
    }

    @Test fun jobStatesAndRuns() {
        val job = row("jobs", "j1", WORK, "name" to "Digest", "enabled" to 1, "schedule" to "hourly")
        fun run(id: String, status: String, start: Long) = row("runs", id, WORK, "job_id" to "j1", "status" to status, "started_at" to start, "finished_at" to start + 65_000, "cost" to 0.5)
        assertNull(jobState(job, emptyList(), NOW))
        assertEquals(JobState.Running, jobState(job, listOf(run("r", "running", NOW)), NOW))
        assertEquals(JobState.Failed, jobState(job, listOf(run("r", "error", NOW - 5000)), NOW))
        assertEquals(JobState.Off, jobState(row("jobs", "j2", WORK, "enabled" to 0), emptyList(), NOW))
        val queued = row("jobs", "j3", WORK, "enabled" to 1, "next_run_at" to NOW - 1)
        assertEquals(JobState.Queued, jobState(queued, emptyList(), NOW))
        assertEquals(listOf("new", "old"), runsOf(listOf(run("old", "ok", 1), run("new", "ok", 2)), job).map { it.id })
        assertEquals("1 min 5 s · $0.50", runMeta(run("r", "ok", NOW)))
        assertEquals("Every hour", jobMeta(job, emptyList(), NOW))
    }

    @Test fun jobsListSortsByNameAndFiltersProfile() {
        val a = row("jobs", "a", WORK, "name" to "Beta"); val b = row("jobs", "b", PERSONAL, "name" to "alpha"); val gone = row("jobs", "c", WORK, "name" to "x").copy(deleted = true)
        assertEquals(listOf("alpha", "Beta"), jobsOf(listOf(a, b, gone), null).map { it.str("name") })
        assertEquals(listOf("Beta"), jobsOf(listOf(a, b), WORK).map { it.str("name") })
    }

    @Test fun routesNestAndPop() {
        var t = ""
        t = pushRoute(t, "meetings"); t = pushRoute(t, "meeting:work:cal:x")
        assertEquals(listOf("meetings", "meeting:work:cal:x"), routesOf(t))
        t = popRoute(t)
        assertEquals(listOf("meetings"), routesOf(t))
        assertEquals(emptyList<String>(), routesOf(popRoute(t)))
    }

    @Test fun theStoreKeepsWikiAndJobRows() {
        val body = """{"table":"jobs","id":"j","profile":"work","deleted":false,"updated_at":5,"version":1,"fields":{"name":"Digest","enabled":1},"field_times":{"name":5,"enabled":5}}"""
        val r = parseRow(kotlinx.serialization.json.Json.parseToJsonElement(body) as kotlinx.serialization.json.JsonObject)!!
        assertTrue(isEnabled(r))
        val off = edited(r, mapOf("enabled" to 0, "next_run_at" to null), NOW)
        assertFalse(isEnabled(off))
        assertTrue(off.dirty)
    }
}
