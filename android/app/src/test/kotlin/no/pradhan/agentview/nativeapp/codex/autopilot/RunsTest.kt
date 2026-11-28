package no.pradhan.agentview.nativeapp.codex.autopilot

import java.time.ZoneId
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Edits
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveNow
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RunsTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    private fun round(outcome: String) = Round(1, 0, outcome, "x")
    private fun run(id: String, state: String = "running", kind: String = "job", rounds: List<Round> = emptyList(), why: String = "") =
        ChatRun(id, kind, round = 4, nextAt = 14 * 3_600_000L + 20 * 60_000L, state = state, why = why, rounds = rounds, branch = "job/x")

    @Test fun askLineIsTheSentenceOfAWaitingQuestionOrBlockedRound() {
        fun live(outcome: String?, needsYou: Boolean = true, line: String? = "Ship it?") = LiveRun("r", needsYou = needsYou, outcome = outcome, line = line)
        assertEquals("Ship it?", askLine(live("question")))
        assertEquals("Ship it?", askLine(live("blocked")))
        assertEquals(null, askLine(live("progress")))
        assertEquals(null, askLine(live("done")))
        assertEquals(null, askLine(live("question", needsYou = false)))
        assertEquals(null, askLine(live("question", line = null)))
        assertEquals(null, askLine(null))
    }

    @Test fun loopNowTakesTheNewerOfStatusAndRound() {
        val r = run("a", rounds = listOf(Round(1, 400, "progress", "round"))).copy(startedAt = 100)
        assertEquals(LoopNow("Working", 500, "status", next = "a", stepsLeft = 2), loopNow(r, LiveNow("Working", 500, next = listOf("a", "b"))))
        assertTrue(Regex("Round 1 · \\d\\d:\\d\\d · progress: round").matches(loopNow(r, LiveNow("Working", 300)).title))
        assertEquals("First round 14:20", loopNow(r.copy(rounds = emptyList()), LiveNow("Old", 50)).title)    }

    @Test fun triesColumnsFollowTheChatAndItsLastReport() {
        val tries = listOf(RunTry(1, "c1", "s1", "tries/a-1"), RunTry(2, "c2", "s2", "tries/a-2"), RunTry(3, "c3", "s3", "tries/a-3", dropped = true))
        val r = run("t", kind = "tries", rounds = listOf(Round(1, 0, "done", "Try 1: patched it"), Round(2, 0, "question", "Try 2: which one?"))).copy(tries = tries)
        val live = listOf(LiveChat("c1", sessionId = "s1", edits = Edits(4, 1), cost = 0.7))
        assertEquals("Tries · 2 chats", runLine(r))
        assertEquals(TryColumn(1, "tries/a-1", "Done", "patched it", Edits(4, 1), 0.7, false), tryColumn(r, tries[0], live))
        assertEquals("Needs you", tryColumn(r, tries[1], live).state)
        assertEquals("Archived", tryColumn(r, tries[2], live).state)
    }

    @Test fun stateLineForRunningAndPaused() {
        assertEquals("Job · job/x", runLine(run("a")))
        assertEquals("Paused · usage limit until 18:00", runLine(run("a", "paused", why = "usage limit until 18:00")))
        assertEquals("Paused", runLine(run("a", "paused")))
        assertEquals("Tries stopped", stoppedText(run("a", kind = "tries")))
        assertEquals("Job stopped", stoppedText(run("a")))
    }

    @Test fun oldJobPayloadsParse() {
        val old = protocolJson.decodeFromString(ChatRun.serializer(), """{"id":"a","kind":"job"}""")
        assertEquals(null, old.review)
        assertEquals(null, old.pr)
    }

    @Test fun reviewMetaShowsBranchSizeAndAge() {
        val diff = parseRunDiff("""{"branch":"job/x","files":[{"path":"a.ts","additions":3,"deletions":1},{"path":"b.ts","additions":2,"deletions":0}],"diff":""}""")
        val r = ChatRun("p", "job", branch = "job/x", startedAt = 60_000)
        assertEquals("job/x · +5 -1 · 2 files · 2m ago", reviewMeta(r, diff, 180_000))
        assertEquals("job/x · 2m ago", reviewMeta(r, null, 180_000))
    }

    @Test fun runBadges() {
        assertEquals(RunBadge.Next, runBadge(LiveRun("r", state = "running", nextAt = 1)))
        assertEquals(RunBadge.Paused, runBadge(LiveRun("r", state = "paused", why = "you paused it")))
        assertEquals(RunBadge.Needs, runBadge(LiveRun("r", state = "paused", why = "waiting for your approval", needsYou = true)))
        assertEquals(RunBadge.Needs, runBadge(LiveRun("r", state = "running", outcome = "question", needsYou = true)))
    }
}
