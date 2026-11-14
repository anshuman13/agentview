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

    private fun round(outcome: String) = Round(1, 0, outcome, "x", 0.1)
    private fun run(id: String, state: String = "running", kind: String = "loop", rounds: List<Round> = emptyList(), why: String = "", endedAt: Long? = null, needsYou: Boolean = false, every: Long? = null) =
        ChatRun(id, kind, round = 4, max = 20, nextAt = 14 * 3_600_000L + 20 * 60_000L, state = state, why = why, rounds = rounds, endedAt = endedAt, needsYou = needsYou, every = every)

    @Test fun loopNowTakesTheNewerOfStatusAndRound() {
        val r = run("a", rounds = listOf(Round(1, 400, "progress", "round", 0.0))).copy(startedAt = 100)
        assertEquals(LoopNow("Working", 500, "status", next = "a", stepsLeft = 2), loopNow(r, LiveNow("Working", 500, next = listOf("a", "b"))))
        assertTrue(Regex("Round 1 · \\d\\d:\\d\\d · progress: round").matches(loopNow(r, LiveNow("Working", 300)).title))
        assertEquals("First round 14:20", loopNow(r.copy(rounds = emptyList()), LiveNow("Old", 50)).title)
        assertEquals("12 min", agentAge(0, 12 * 60_000))
        assertEquals("1 h 5 min", agentAge(0, 65 * 60_000))
    }

    @Test fun mergedQuietRoundsReadAsARange() {
        val q = { n: Int, report: String? -> Round(n, 14 * 3_600_000L, "quiet", "", 0.0, report) }
        assertEquals("Rounds 4-9 · 14:00 · nothing to do", roundGroupText(mergeQuiet(listOf(q(4, null), q(5, null), q(9, null))).single()))
        assertEquals("Round 4 · 14:00 · nothing to do", roundGroupText(mergeQuiet(listOf(q(4, null))).single()))
        assertEquals("Weekly report", roundGroupText(mergeQuiet(listOf(q(4, "t1"))).single()))
    }

    @Test fun triesColumnsFollowTheChatAndItsLastReport() {
        val tries = listOf(RunTry(1, "c1", "s1", "tries/a-1"), RunTry(2, "c2", "s2", "tries/a-2"), RunTry(3, "c3", "s3", "tries/a-3", dropped = true))
        val r = run("t", kind = "tries", rounds = listOf(Round(1, 0, "done", "Try 1: patched it", 0.5), Round(2, 0, "question", "Try 2: which one?", 0.2))).copy(tries = tries)
        val live = listOf(LiveChat("c1", sessionId = "s1", edits = Edits(4, 1), cost = 0.7))
        assertEquals("Tries · 2 chats", runLine(r))
        assertEquals(TryColumn(1, "tries/a-1", "Done", "patched it", Edits(4, 1), 0.7, false), tryColumn(r, tries[0], live))
        assertEquals("Needs you", tryColumn(r, tries[1], live).state)
        assertEquals("Archived", tryColumn(r, tries[2], live).state)
    }

    @Test fun stateLineForRunningPausedAndDone() {
        assertEquals("Loop · round 4 · next 14:20", runLine(run("a").copy(max = 0)))
        assertEquals("Goal · round 4 of 20 · next 14:20", runLine(run("a", kind = "goal")))
        assertEquals("Goal · round 4 · next 14:20", runLine(run("a", kind = "goal", every = 3_600_000L).copy(max = 0)))
        assertEquals("Build cycle · round 4/20 · Test", runLine(run("a", kind = "cycle"), "test"))
        assertEquals("Build cycle · round 4/20", runLine(run("a", kind = "cycle"), "passed"))
        assertEquals("Paused · usage limit until 18:00", runLine(run("a", "paused", why = "usage limit until 18:00")))
        assertEquals("Paused", runLine(run("a", "paused")))
        assertEquals("Loop · round 4 · next 14:20", runLine(run("a", "done").copy(max = 0)))
        assertEquals("Build cycle stopped", stoppedText(run("a", kind = "cycle"), true))
    }

    @Test fun plannedEndsStayDoneForNewAndOldReasons() {
        for (why in listOf("Goal met after 12 rounds", "Stopped at 09:00 · 41 rounds", "Usage cap 100% reached", "Ran for 28 days, start it again to continue", "goal met", "end time 18:00"))
            assertEquals(why, "Done", goalBadge(run("a", "done", why = why, kind = "goal")).first)
        assertEquals("Failed", goalBadge(run("a", "done", why = "Not met after 20 rounds", kind = "goal")).first)
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

    @Test fun badgeAndSessionsCount() {
        fun live(id: String, pending: Int = 0, run: LiveRun? = null) = LiveChat(id, pending = pending, run = run)
        assertEquals(RunBadge.Next, runBadge(LiveRun("r", state = "running", nextAt = 1)))
        assertEquals(RunBadge.Paused, runBadge(LiveRun("r", state = "paused", why = "you paused it")))
        assertEquals(RunBadge.Needs, runBadge(LiveRun("r", state = "paused", why = "waiting for your approval", needsYou = true)))
        assertEquals(RunBadge.Needs, runBadge(LiveRun("r", state = "running", outcome = "question", needsYou = true)))
        val chats = listOf(live("a", 2), live("b", run = LiveRun("r", outcome = "blocked", needsYou = true)), live("c", run = LiveRun("r2")), live("shown", 5))
        assertEquals(3, sessionsBadge(chats, "shown"))
    }
}
