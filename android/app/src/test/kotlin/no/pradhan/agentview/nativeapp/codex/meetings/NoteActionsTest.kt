package no.pradhan.agentview.nativeapp.codex.meetings

import org.junit.Assert.assertEquals
import org.junit.Test

class NoteActionsTest {
    private val same = { t: String -> t }

    @Test fun takesUntickedLinesWithEitherBulletAndSkipsTickedAndPlainOnes() {
        val notes = "- [ ] send deck\n* [ ] call Ann\n- [x] done already\n- [X] done too\nplain line\n  - [ ] indented\n- [ ]\n- [ ]   "
        assertEquals(listOf("send deck", "call Ann", "indented"), unmadeActions(notes, emptyList(), same))
    }

    @Test fun skipsLinesWhoseNormalizedTitleIsAlreadyAnAction() {
        assertEquals(listOf("book room"), unmadeActions("- [ ] Send the deck!\n- [ ] book room", listOf("send  the DECK"), same))
    }

    @Test fun matchesAfterTheDueDateIsStrippedAndOffersARepeatedLineOnce() {
        val strip = { t: String -> t.removeSuffix(" friday") }
        assertEquals(listOf("ping Bo friday"), unmadeActions("- [ ] send deck friday\n- [ ] ping Bo friday\n- [ ] ping Bo", listOf("send deck"), strip))
    }
}
