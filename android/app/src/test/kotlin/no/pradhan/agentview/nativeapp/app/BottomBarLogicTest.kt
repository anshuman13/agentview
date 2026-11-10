package no.pradhan.agentview.nativeapp.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BottomBarLogicTest {
    private fun after(vararg events: BarEvent) = barHidden(events.fold(BarState(), ::barState))

    @Test fun backWithTheKeyboardUpShowsTheBarOnlyWithAnEmptyDraft() {
        assertFalse(after(BarEvent.Focus, BarEvent.KeyboardUp, BarEvent.KeyboardDown))
        assertTrue(after(BarEvent.Focus, BarEvent.KeyboardUp, BarEvent.TextFilled, BarEvent.KeyboardDown))
    }
}
