package no.pradhan.agentview.nativeapp.app

import org.junit.Assert.assertEquals
import org.junit.Test

class FeatureUseLogicTest {
    @Test fun recordsOnlyWhenOnWritableAndKnown() {
        assertEquals(true, shouldTrack(true, false, "tab:chat"))
        assertEquals(false, shouldTrack(false, false, "tab:chat"))
        assertEquals(false, shouldTrack(true, true, "tab:chat"))
        assertEquals(false, shouldTrack(true, false, "page:runs"))
    }

    @Test fun lastUsedCountsDays() {
        assertEquals("today", lastUsed("2026-11-10", "2026-11-10"))
        assertEquals("3d ago", lastUsed("2026-11-07", "2026-11-10"))
    }
}
