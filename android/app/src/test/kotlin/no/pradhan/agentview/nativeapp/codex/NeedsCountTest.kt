package no.pradhan.agentview.nativeapp.codex

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

private fun ms(d: Int, h: Int) = ZonedDateTime.of(2026, 11, d, h, 0, 0, 0, ZoneId.of("UTC")).toInstant().toEpochMilli()

class NeedsCountTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    private fun chat(id: String, waiting: Int = 1) = Row("chats", id, WORK, f = mapOf("name" to JsonPrimitive(id), "kind" to JsonPrimitive("dm"), "waiting" to JsonPrimitive(waiting), "last_at" to JsonPrimitive(NOW)))
    private fun brief(text: String, toAt: Long = NOW) = Row("briefs", "b", WORK, f = mapOf("kind" to JsonPrimitive("slack"), "text" to JsonPrimitive(text), "to_at" to JsonPrimitive(toAt)))

    @Test fun onlyLiveOpenWorkCounts() {
        val yesterday = ms(6, 9)
        val items = listOf(
            item("late", "open", yesterday),
            item("done", "done", yesterday), item("dismissed", "dismissed", yesterday),
            item("gone", "open", yesterday).copy(deleted = true),
            item("snoozed", "suggested", null, WORK, "source" to "slack", "tags" to "needs-you", "snoozed_until" to NOW + 1000),
            item("said:1", "suggested", null, WORK, "source" to "slack", "tags" to "needs-you"),
            item("ask", "suggested"),
            item("draft", "suggested", null, WORK, "source" to "slack", "draft" to "ok"),
        )
        val st = CodexState(items = items, chats = listOf(chat("a"), chat("b", 0), chat("c").copy(deleted = true)))
        assertEquals(listOf("Overdue", "Ask", "Ask", "Ask", "Dm"), needsList(st, null, NOW).map { it::class.simpleName })
        assertEquals(6, needsView(st, null, NOW).total)
    }

    @Test fun hiddenDmsAndBriefBulletsCount() {
        val st = CodexState(chats = listOf(chat("a"), chat("b")), briefs = listOf(brief("**Needs you**\n- [Plan](https://x.test/1): Do it now. Later.\n  - sub\n- **Bold**: why\n\n**Decided**\n- [Other](https://x.test/2): no")))
        assertEquals(4, needsView(st, null, NOW).total)
        assertEquals(2, needsView(st, null, NOW, setOf(waitKey(chat("a")), slackKey(Bullet("Plan", "https://x.test/1", "")))).total)
        assertEquals("Do it now.", briefBullets((st.briefs[0].str("text"))!!)[0].why)
    }

    @Test fun aSlackSummaryOlderThanThreeDaysAddsNothing() {
        val st = CodexState(briefs = listOf(brief("**Needs you**\n- [Plan](https://x.test/1): Do it now.", NOW - 4 * DAY_MS)))
        assertEquals(0, needsView(st, null, NOW).total)
    }

    @Test fun aTaskThatCannotFitBeforeItsDueTimeIsAtRisk() {
        val mon = ms(9, 10)
        val big = item("big", "open", ms(9, 11)).copy(f = item("big", "open", ms(9, 11)).f + ("title" to JsonPrimitive("Write ~3h")))
        val st = CodexState(items = listOf(big, item("fine", "open", ms(10, 17)).copy(f = item("x").f + ("at" to JsonPrimitive(ms(10, 17))))))
        val risk = needsList(st, null, mon).filterIsInstance<Need.Risk>()
        assertEquals(1, risk.size)
        assertEquals(120L, risk[0].short)
        assertEquals(0, needsList(st, null, ms(7, 10)).filterIsInstance<Need.Risk>().size)
    }

    @Test fun atRiskTasksLeaveTheTodayList() {
        val mon = ms(9, 10)
        val big = item("big", "open", ms(9, 11)).copy(f = item("big", "open", ms(9, 11)).f + ("title" to JsonPrimitive("Write ~3h")))
        val st = CodexState(items = listOf(big))
        val risky = riskKeys(needsList(st, null, mon))
        assertEquals(setOf(big.key), risky)
        val s = split(st.items, null, mon)
        assertEquals(1, overviewToday(s, null, mon).todo.size + (if (overviewToday(s, null, mon).upNextTask != null) 1 else 0))
        val t = overviewToday(s, null, mon, risky)
        assertEquals(0, t.todo.size)
        assertEquals(null, t.upNextTask)
    }
}
