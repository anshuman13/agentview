package no.pradhan.agentview.nativeapp.codex

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.sessions.items
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private fun ms(y: Int, m: Int, d: Int, h: Int = 0, mi: Int = 0) = ZonedDateTime.of(y, m, d, h, mi, 0, 0, ZoneId.of("UTC")).toInstant().toEpochMilli()

// Saturday 7 November 2026, 10:30.
val NOW = ms(2026, 11, 7, 10, 30)

fun item(id: String, status: String = "open", at: Long? = null, profile: String = WORK, vararg extra: Pair<String, Any?>): Row {
    val f = ITEM_FIELDS.associateWith { JsonNull as kotlinx.serialization.json.JsonElement }.toMutableMap()
    f["title"] = JsonPrimitive("task $id"); f["status"] = JsonPrimitive(status)
    if (at != null) f["at"] = JsonPrimitive(at)
    for ((k, v) in extra) f[k] = toJson(v)
    return Row("items", id, profile, updatedAt = NOW - 1000, f = f)
}

class CodexLogicTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    @Test fun mergeKeepsTheNewerColumnAndFlagsLocalEdits() {
        val local = edited(item("a"), mapOf("title" to "mine"), NOW)
        val incoming = Row("items", "a", WORK, updatedAt = NOW - 5000, version = 3, times = mapOf("title" to NOW - 5000, "status" to NOW + 10), f = ITEM_FIELDS.associateWith { JsonNull } + ("title" to JsonPrimitive("theirs")) + ("status" to JsonPrimitive("done")))
        val m = mergeIncoming(local, incoming)
        assertEquals("mine", m.title)
        assertEquals("done", m.status)
        assertTrue(m.dirty)
        assertEquals(3, m.version)
        assertFalse(mergeIncoming(null, incoming).dirty)
    }

    @Test fun anEditOutdatesTheValueItReplaces() {
        val row = item("a").copy(times = mapOf("title" to NOW + 5000))
        val e = edited(row, mapOf("title" to "x"), NOW)
        assertEquals(NOW + 5001, e.times["title"])
        assertTrue(e.dirty)
    }

    @Test fun onlyTimedColumnsGoToTheHub() {
        val change = rowToChange(edited(item("a"), mapOf("priority" to 3, "deleted" to true), NOW))
        val fields = change["fields"].toString()
        assertTrue(fields.contains("\"priority\":3"))
        assertFalse(fields.contains("title"))
        assertEquals("true", change["deleted"].toString())
        assertEquals(NOW.toString(), change["updated_at"].toString())
    }

    @Test fun captureSplitsTitleAndNotesAndTimesTheFields() {
        val r = newCapture("Call bank\nabout the loan", "open", PERSONAL, NOW, at = NOW + 1, extra = mapOf("tags" to "home"))
        assertEquals("Call bank", r.title)
        assertEquals("about the loan", r.text)
        assertEquals("open", r.status)
        assertEquals("capture", r.source)
        assertEquals(setOf("title", "text", "source", "status", "at", "tags"), r.times.keys)
        assertTrue(r.dirty)
    }

    @Test fun splitSeparatesOverdueTodayAndLater() {
        val items = listOf(
            item("late", at = ms(2026, 11, 6, 9)), item("none"), item("now", at = ms(2026, 11, 7, 8)), item("soon", at = ms(2026, 11, 7, 15)),
            item("tomorrow", at = ms(2026, 11, 8, 9)), item("doneToday", "done").copy(times = mapOf("status" to NOW - 1000)),
            item("doneOld", "done").copy(times = mapOf("status" to ms(2026, 11, 5))), item("gone").copy(deleted = true),
            item("other", profile = PERSONAL), item("ask", "suggested"),
        )
        val s = split(items, WORK, NOW)
        assertEquals(listOf("late"), s.overdue.map { it.id })
        assertEquals(listOf("none", "now"), s.today.map { it.id })
        assertEquals(listOf("soon", "tomorrow"), s.later.map { it.id })
        assertEquals(listOf("doneToday"), s.doneToday.map { it.id })
        assertEquals(listOf("ask"), s.review.map { it.id })
        assertEquals(8, split(items, null, NOW).let { it.overdue.size + it.today.size + it.later.size + it.review.size + it.doneToday.size })
    }

    @Test fun daysGroupByDateWithTodayFirst() {
        val items = listOf(
            item("pm", at = ms(2026, 11, 7, 15)), item("untimed"), item("t1", at = ms(2026, 11, 8, 16)), item("t2", at = ms(2026, 11, 8, 9)),
            item("tue", at = ms(2026, 11, 10, 9)), item("far", at = ms(2026, 11, 20, 9)),
        )
        val days = taskDays(split(items, null, NOW), NOW)
        assertEquals(listOf("Today", "Tomorrow", "Tue, 10 Nov", "Later"), days.map { it.label })
        assertEquals(listOf("untimed", "pm"), days[0].rows.map { it.id })
        assertEquals(listOf("t2", "t1"), days[1].rows.map { it.id })
        assertNull(days[3].day)
    }

    @Test fun rankedRowsKeepTheirDraggedOrder() {
        val rows = listOf(item("a", "open", 3), item("b", "open", 1, WORK, "rank" to 2), item("c", "open", 2, WORK, "rank" to 1))
        assertEquals(listOf("c", "b", "a"), ranked(rows).map { it.id })
    }

    @Test fun dueLabels() {
        assertEquals("2d late", dueText(item("a", at = ms(2026, 11, 5, 9)), NOW))
        assertEquals("1d late", dueText(item("a", at = ms(2026, 11, 6, 14)), NOW, inDay = true))
        assertEquals("tomorrow morning", dueText(item("a", at = ms(2026, 11, 8, 9)), NOW))
        assertNull(dueText(item("a", at = ms(2026, 11, 8, 9)), NOW, inDay = true))
        assertEquals("14:30", dueText(item("a", at = ms(2026, 11, 8, 14, 30)), NOW, inDay = true))
        assertEquals("this evening", dueText(item("a", at = ms(2026, 11, 7, 19)), NOW))
        assertEquals("Tue 14:30", dueText(item("a", at = ms(2026, 11, 10, 14, 30)), NOW))
        assertEquals("20 Nov", dueText(item("a", at = ms(2026, 11, 20, 14)), NOW))
        assertNull(dueText(item("a", "done", at = ms(2026, 11, 5, 9)), NOW))
        assertNull(dueText(item("a"), NOW))
    }

    @Test fun nextNineSkipsTheWeekendForWork() {
        assertEquals(ms(2026, 11, 9, 9), nextNine(NOW, WORK))
        assertEquals(ms(2026, 11, 8, 9), nextNine(NOW, PERSONAL))
        assertEquals(ms(2026, 11, 9, 9), nextNine(ms(2026, 11, 6, 12), WORK))
        assertEquals(ms(2026, 11, 8, 9), nextNine(ms(2026, 11, 7, 23), PERSONAL))
        assertEquals(ms(2026, 11, 9, 9), snoozeLaterAt(ms(2026, 11, 8, 9), NOW, WORK))
        assertEquals(ms(2026, 11, 7, 19), SNOOZES.first { it.label == "Tonight" }.at(NOW, WORK))
        assertEquals(ms(2026, 11, 9, 9), SNOOZES.first { it.label == "Next week" }.at(NOW, WORK))
    }

    @Test fun moveToTodayKeepsTheTimeOfDay() {
        assertEquals(ms(2026, 11, 7, 15), todayAt(ms(2026, 11, 3, 15), NOW))
        assertEquals(NOW, todayAt(ms(2026, 11, 3, 8), NOW))
    }

    @Test fun readsTheDueTimeFromTypedText() {
        val w = parseWhen("call the bank tomorrow 9", NOW)!!
        assertEquals(ms(2026, 11, 8, 9), w.at)
        assertEquals("call the bank", stripWhen("call the bank tomorrow 9", w))
        assertEquals(ms(2026, 11, 7, 12, 30), parseWhen("lunch in 2 hours", NOW)!!.at)
        assertEquals(ms(2026, 11, 13, 14, 30), parseWhen("review fri at 14:30", NOW)!!.at)
        assertEquals(ms(2026, 11, 7, 19), parseWhen("plan this evening", NOW)!!.at)
        assertNull(parseWhen("plan today", NOW)!!.at)
        assertNull(parseWhen("buy milk", NOW))
        assertEquals(ms(2026, 11, 8, 9), parseWhen("call mum tomorrow", NOW)!!.at)
    }

    @Test fun tagsComeOutOfTheTitle() {
        assertEquals("call mum" to listOf("home", "errands"), takeTags("#home call mum #Errands"))
        assertEquals("plain" to emptyList<String>(), takeTags("plain"))
        assertEquals(listOf("a", "b"), tagList(" a  b "))
    }

    @Test fun tagPageListsOpenTasksByDue() {
        val items = listOf(item("a", "open", 5, WORK, "tags" to "home x"), item("b", "open", 2, WORK, "tags" to "Home"), item("c", "done", null, WORK, "tags" to "home"), item("d", "open", null, WORK, "tags" to "homework"))
        assertEquals(listOf("b", "a"), tagTasks(items, "home").map { it.id })
        assertEquals(listOf("home", "x", "homework"), allTags(items, null).sortedBy { listOf("home", "x", "homework").indexOf(it) })
    }

    @Test fun searchMatchesTitleNotesPeopleAndTags() {
        val a = item("a", "open", null, WORK, "text" to "about the Budget")
        val b = item("b", "open", null, WORK, "tags" to "finance")
        val s = split(listOf(a, b, item("c")), null, NOW)
        val days = taskDays(s, NOW)
        assertEquals(listOf("a"), searchTasks(s, days, " budget ").map { it.id })
        assertEquals(listOf("b"), searchTasks(s, days, "#fin").map { it.id })
        assertTrue(searchTasks(s, days, "").isEmpty())
    }

    @Test fun repeatingTaskCreatesItsNextCopy() {
        val r = item("a", "open", ms(2026, 11, 6, 9), WORK, "text" to "Repeats: every monday 09:00")
        val next = nextRepeat(r, NOW, listOf(r))!!
        assertEquals(ms(2026, 11, 9, 9), next.at)
        assertNull(nextRepeat(item("b"), NOW, emptyList()))
        val copy = item("c", "open", ms(2026, 11, 9, 9), WORK, "text" to "Repeats: every monday 09:00").copy(f = r.f + ("at" to JsonPrimitive(ms(2026, 11, 9, 9))))
        assertNull(nextRepeat(r, NOW, listOf(r, copy)))
        val p = parseRepeat("Water plants every friday 8", NOW)!!
        assertEquals("Water plants", p.title)
        assertEquals("Repeats: every friday 08:00", p.text)
        assertEquals(ms(2026, 11, 13, 8), p.at)
    }

    @Test fun goalsGroupByWeekWithProgress() {
        val monday = ms(2026, 11, 2)
        val g = item("g1", GOAL, monday)
        val next = item("g2", GOAL, ms(2026, 11, 9))
        val old = item("g3", GOAL, ms(2026, 10, 26))
        val items = listOf(g, next, old, item("t1", "open", null, WORK, "goal" to "g1"), item("t2", "done", null, WORK, "goal" to "g1"), item("t3", "dismissed", null, WORK, "goal" to "g1"))
        assertEquals(listOf("Next week", "This week", "Last week"), goalHistory(items, NOW).map { it.label })
        assertEquals(2, goalProgress(items, g).total)
        assertEquals(1, goalProgress(items, g).done)
        assertEquals(listOf("t1", "t2"), goalTasks(items, g).map { it.id })
        assertEquals(listOf("g1"), goalsOf(items, NOW).map { it.id })
        assertNull(moveBlock(items, g, NOW))
        assertNotNull(moveBlock(items + next.copy(id = "g4", f = next.f + ("title" to g.f.getValue("title"))), g, NOW))
    }

    @Test fun overviewMeetingsPickTheNextOne() {
        fun meeting(id: String, start: Long, end: Long, profile: String = WORK) = Row("meetings", id, profile, f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as kotlinx.serialization.json.JsonElement } + ("title" to JsonPrimitive(id)) + ("starts_at" to JsonPrimitive(start)) + ("ends_at" to JsonPrimitive(end)) + ("people" to JsonPrimitive("[\"Kim\",\"Lee\"]")))
        val ms1 = listOf(
            meeting("over", ms(2026, 11, 7, 8), ms(2026, 11, 7, 9)), meeting("live", ms(2026, 11, 7, 10), ms(2026, 11, 7, 11)),
            meeting("later", ms(2026, 11, 7, 14), ms(2026, 11, 7, 15)), meeting("block:x", ms(2026, 11, 7, 12), ms(2026, 11, 7, 13)),
            meeting("tomorrow", ms(2026, 11, 8, 9), ms(2026, 11, 8, 10)), meeting("p", ms(2026, 11, 7, 16), ms(2026, 11, 7, 17), PERSONAL),
        )
        val m = meetingsOf(ms1, WORK, NOW)
        assertEquals("live", m.next!!.id)
        assertEquals(listOf("over", "live", "later"), m.today.map { it.id })
        assertEquals("later", m.nextLater!!.id)
        assertEquals("Ends in 30 min", countdown(m.next!!, NOW))
        assertEquals("Starts in 3h 30m", countdown(m.nextLater!!, NOW))
        assertEquals("10:00 - 11:00 · 2 people", meetingMeta(m.next!!, NOW))
        assertTrue(meetingMeta(ms1[4], NOW).startsWith("Sun, 8 Nov, 09:00"))
        assertEquals(4L, joinMinutes(meeting("j", NOW + 3 * 60_000 + 1, NOW + 9_000_000), NOW))
        assertNull(joinMinutes(m.nextLater!!, NOW))
        assertEquals("later", meetingsOf(ms1.filter { it.id != "live" }, WORK, NOW).next!!.id)
    }

    @Test fun needsYouRanksOnceAndCollapsesOverdue() {
        val overdue = (1..3).map { item("o$it", at = ms(2026, 11, 5, 9)) }
        val ask = item("ask", "suggested")
        val items = overdue + ask
        val needs = needsYou(items, emptyList(), emptyList(), null, NOW)
        assertEquals(listOf("OverdueAll", "Ask"), needs.map { it::class.simpleName })
        assertEquals(3, (needs[0] as Need.OverdueAll).rows.size)
        val two = needsYou(overdue.take(2) + ask, emptyList(), emptyList(), null, NOW)
        assertEquals(listOf("Overdue", "Overdue", "Ask"), two.map { it::class.simpleName })
        val chat = Row("chats", "c", WORK, f = mapOf("name" to JsonPrimitive("Kim"), "kind" to JsonPrimitive("dm"), "waiting" to JsonPrimitive(1), "last_at" to JsonPrimitive(NOW)))
        assertEquals(listOf("Ask", "Dm"), needsYou(listOf(ask), emptyList(), listOf(chat, chat.copy(f = chat.f + ("waiting" to JsonNull))), null, NOW).map { it::class.simpleName })
    }

    @Test fun todayShowsTheNextTaskOnlyWithoutAMeeting() {
        val items = listOf(item("a", at = ms(2026, 11, 7, 9)), item("b", at = ms(2026, 11, 7, 15)), item("late", at = ms(2026, 11, 6, 9)))
        val s = split(items, null, NOW)
        val t = overviewToday(s, null, NOW)
        assertEquals("a", t.upNextTask!!.id)
        assertEquals(listOf("b"), t.todo.map { it.id })
        assertEquals(3, t.openCount)
        assertNull(overviewToday(s, s.today.first(), NOW).upNextTask)
        assertEquals("2 of 5 done", doneCount(2, 3))
        assertNull(doneCount(0, 3))
    }

    @Test fun askTextListsOpenItemsAndTheProfileHint() {
        val text = askText("What is due?", WORK, listOf(item("a", "open", ms(2026, 11, 8, 14, 30), WORK, "source" to "slack"), item("b", "done")), now = NOW)
        assertTrue(text.startsWith("What is due?\n\nMy open items in Codex:\n- [work] task a (slack, due Sun 14:30)"))
        assertFalse(text.contains("task b"))
        assertTrue(text.contains("Use my Slack, Calendar, Gmail and Linear connectors"))
        assertTrue(askText("Plan", PERSONAL, emptyList(), now = NOW).contains("No personal meetings in the next 3 days."))
    }

    @Test fun searchHitsEveryWord() {
        val items = listOf(item("a", "open", null, WORK, "text" to "pay the invoice today"), item("b", "dismissed", null, WORK, "text" to "pay invoice"), item("c", GOAL, null, WORK, "text" to "pay invoice"))
        val hits = searchAll(items, emptyList(), "Invoice PAY", null)
        assertEquals(listOf("a"), hits.tasks.map { it.row.id })
        assertEquals("pay the invoice today", hits.tasks[0].snippet)
        assertEquals(0, searchAll(items, emptyList(), "  ", null).total)
    }
}

