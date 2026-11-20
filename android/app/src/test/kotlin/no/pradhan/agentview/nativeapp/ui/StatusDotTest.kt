package no.pradhan.agentview.nativeapp.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusDotTest {
    @Test fun eachStateHasItsWord() {
        val words = DotState.entries.associateWith { dotWord(it) }
        assertEquals(
            mapOf(
                DotState.Faint to "Not started", DotState.Ok to "Done", DotState.Bad to "Failed", DotState.Warn to "Needs attention",
                DotState.Busy to "Pending", DotState.Running to "Running", DotState.Unread to "Unread", DotState.Idle to null, DotState.Agent to null,
            ),
            words,
        )
    }

    @Test fun runningPulsesOnlyWithAnimations() {
        assertTrue(pulses(DotState.Running, 1f))
        assertTrue(pulses(DotState.Busy, 0.5f))
        assertFalse(pulses(DotState.Running, 0f))
    }

    @Test fun okNeverPulses() {
        assertFalse(pulses(DotState.Ok, 1f))
    }
}
