package no.pradhan.agentview.nativeapp.codex

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

private fun at(h: Int, m: Int = 0) = ZonedDateTime.of(2026, 10, 30, h, m, 0, 0, ZoneId.of("UTC")).toInstant().toEpochMilli()

class PlanLogicTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    private fun task(title: String, due: Long?, timed: Boolean = false, goal: Boolean = false) =
        PlanTask(item(title, "open", due, WORK, "title" to title), due, timed, goal)

    private fun titles(out: List<PlanSlot>) = out.map { it.task.title to it.span }

    @Test fun packsByDueTimeThenListOrderAndLeavesOutWhatDoesNotFit() {
        val tasks = listOf(task("Read notes", null), task("Write doc ~1h", at(15)), task("Reply to Mira ~45m", at(11)), task("Huge job ~3h", at(16)))
        val out = packDay(tasks, listOf(at(9, 2) to at(9, 40), at(10) to at(12)))
        assertEquals(
            listOf("Reply to Mira ~45m" to (at(10) to at(10, 45)), "Write doc ~1h" to (at(10, 45) to at(11, 45)), "Read notes" to (at(9, 5) to at(9, 35))),
            titles(out),
        )
    }

    @Test fun goalTasksComeFirst() {
        val tasks = listOf(task("Tidy inbox", at(11)), task("Fix login", null, goal = true))
        assertEquals(listOf("Fix login"), packDay(tasks, listOf(at(10) to at(10, 30))).map { it.task.title })
    }

    @Test fun planTodayFitsOnlyEstimatedTasksAroundMeetingsFromNow() {
        val tasks = listOf(task("No estimate", at(9)), task("Write doc ~1h", at(15)), task("Reply to Mira ~45m", at(11)))
        val out = planToday(tasks, listOf(at(9) to at(10), at(12) to at(16, 30)), at(8, 30))
        assertEquals(listOf("Reply to Mira ~45m" to (at(10) to at(10, 45)), "Write doc ~1h" to (at(10, 45) to at(11, 45))), titles(out))
        assertEquals(emptyList<PlanSlot>(), planToday(tasks, emptyList(), at(16, 30)))
    }

    @Test fun planTodayKeepsTimedTasksBusy() {
        val tasks = listOf(task("Call bank ~30m", at(10), timed = true), task("Write doc ~1h", null))
        assertEquals(listOf("Write doc ~1h" to (at(10, 30) to at(11, 30))), titles(planToday(tasks, listOf(at(8) to at(10)), at(8))))
    }

    @Test fun morningSharpIsDateOnly() {
        assertEquals(listOf(false, true, false), listOf(hasTime(at(9)), hasTime(at(9, 30)), hasTime(null)))
    }
}
