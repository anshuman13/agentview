package no.pradhan.agentview.nativeapp.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class StreamFadeTest {
    @Test fun newTextGetsATailAndOlderTextKeepsItsPlaceInTheFade() {
        val a = nextTails(emptyList(), 0, 10, 1000)
        val b = nextTails(a, 10, 16, 1100)
        assertEquals(listOf(Tail(0, 1000), Tail(10, 1100)), b)
        val r = fadeRanges(b, 16, 1100)
        assertEquals(listOf(0 to 10, 10 to 16), r.map { it.start to it.end })
        assertEquals(0f, r[1].alpha, 0f)
        assert(r[0].alpha > 0f && r[0].alpha < 1f)
    }

    @Test fun finishedTextIsNotFadedAgain() {
        val now = Tokens.motionDuration + 1L
        val t = nextTails(listOf(Tail(0, 0)), 10, 12, now)
        assertEquals(listOf(FadeRange(10, 12, 0f)), fadeRanges(t, 12, now))
    }

    @Test fun nothingIsAddedWhenTheTextDidNotGrow() {
        assertEquals(emptyList<Tail>(), nextTails(emptyList(), 8, 8, 0))
    }
}
