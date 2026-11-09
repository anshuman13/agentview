package no.pradhan.agentview.nativeapp

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.time.ZoneId

class RunsTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    private fun round(outcome: String) = Round(1, 0, outcome, "x", 0.1)
    private fun run(id: String, state: String = "running", kind: String = "loop", rounds: List<Round> = emptyList(), why: String = "", endedAt: Long? = null) =
        ChatRun(id, kind, round = 4, max = 20, nextAt = 14 * 3_600_000L + 20 * 60_000L, state = state, why = why, rounds = rounds, endedAt = endedAt)

    private fun name(e: RunEntry) = when (e) { is RunEntry.Chat -> e.run.id; is RunEntry.Job -> "job:${e.row.id}" }

    @Test fun stateLineForRunningPausedAndDone() {
        assertEquals("Loop · round 4 · next 14:20", runLine(run("a")))
        assertEquals("Goal · check 4 of 20", runLine(run("a", kind = "goal")))
        assertEquals("Build cycle · round 4/20 · Test", runLine(run("a", kind = "cycle"), "test"))
        assertEquals("Build cycle · round 4/20", runLine(run("a", kind = "cycle"), "passed"))
        assertEquals("Paused · usage limit until 18:00", runLine(run("a", "paused", why = "usage limit until 18:00")))
        assertEquals("Paused", runLine(run("a", "paused")))
        assertEquals("Loop · round 4 · next 14:20", runLine(run("a", "done")))
        assertEquals("Build cycle stopped", stoppedText(run("a", kind = "cycle")))
    }

    @Test fun bandsSplitNeedsRunningAndFinished() {
        fun job(id: String, enabled: Long = 1) = Row("jobs", id, WORK, f = mapOf("name" to JsonPrimitive(id), "enabled" to JsonPrimitive(enabled)))
        fun jobRun(job: String, status: String) = Row("runs", "r$job", WORK, f = mapOf("job_id" to JsonPrimitive(job), "status" to JsonPrimitive(status), "started_at" to JsonPrimitive(1)))
        val runs = listOf(
            run("blocked", rounds = listOf(round("progress"), round("blocked"))),
            run("cleared", rounds = listOf(round("blocked"), round("done"))),
            run("approval", "paused", why = "waiting for your approval"),
            run("paused", "paused", why = "you paused it"),
            run("old", "done", rounds = listOf(round("blocked")), endedAt = 5),
        )
        val b = runBands(runs, listOf(job("bad"), job("busy"), job("quiet"), job("off", 0)), listOf(jobRun("bad", "error"), jobRun("busy", "running")), 10)
        assertEquals(setOf("blocked", "approval", "job:bad"), b.needs.map(::name).toSet())
        assertEquals(setOf("cleared", "paused", "job:busy"), b.running.map(::name).toSet())
        assertEquals(listOf("old"), b.finished.map { it.id })
    }

    @Test fun badgeAndSessionsCount() {
        fun live(id: String, pending: Int = 0, run: LiveRun? = null) = LiveChat(id, pending = pending, run = run)
        assertEquals(RunBadge.Next, runBadge(LiveRun("r", state = "running", nextAt = 1)))
        assertEquals(RunBadge.Paused, runBadge(LiveRun("r", state = "paused", why = "you paused it")))
        assertEquals(RunBadge.Needs, runBadge(LiveRun("r", state = "paused", why = "waiting for your approval")))
        assertEquals(RunBadge.Needs, runBadge(LiveRun("r", state = "running", outcome = "question")))
        val chats = listOf(live("a", 2), live("b", run = LiveRun("r", outcome = "blocked")), live("c", run = LiveRun("r2")), live("shown", 5))
        assertEquals(3, sessionsBadge(chats, "shown"))
    }
}
