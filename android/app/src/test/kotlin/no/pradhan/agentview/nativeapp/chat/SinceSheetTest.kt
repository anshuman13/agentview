package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.Round
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue

class SinceSheetTest {
    private fun round(n: Int, outcome: String) = Round(n = n, at = n * 10L, outcome = outcome)
    private val rounds = listOf(round(1, "progress"), round(2, "blocked"), round(3, "progress"), round(4, "done"), round(5, "quiet"))

    @Test fun needsEarlierLoadsWhileRepliesAreFewAndPagesRemain() {
        assertTrue(needsEarlier(0, 600, 0))
        assertTrue(needsEarlier(2, 600, 2))
        assertFalse(needsEarlier(3, 600, 0))
        assertFalse(needsEarlier(0, 0, 0))
        assertFalse(needsEarlier(0, 600, 3))
    }

    @Test fun roundsSinceTakesLaterRoundsNewestFirstAndCountsOutcomes() {
        val fresh = roundsSince(rounds, 10)
        assertEquals(listOf(5, 4, 3, 2), fresh.map { it.n })
        assertEquals(listOf("blocked" to 1, "progress" to 1, "done" to 1, "quiet" to 1), outcomeCounts(fresh))
    }

    @Test fun foldedRoundsFoldsMoreThanThreeQuietRoundsButKeepsBlockedOnes() {
        assertEquals(listOf(2), foldedRounds(rounds, false).map { it.n })
        assertEquals(5, foldedRounds(rounds, true).size)
        assertEquals(4, foldedRounds(rounds.take(4), false).size)
    }
}
