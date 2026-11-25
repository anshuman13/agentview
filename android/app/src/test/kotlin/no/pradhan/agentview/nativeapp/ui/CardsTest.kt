package no.pradhan.agentview.nativeapp.ui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class CardsTest {
    @Test fun oneColumnOnPhones() {
        assertEquals(1, cardColumns(360.dp))
        assertEquals(1, cardColumns(600.dp))
    }

    @Test fun fitsMinWidthTracksOnWideScreens() {
        assertEquals(2, cardColumns(601.dp))
        assertEquals(3, cardColumns(700.dp))
        assertEquals(4, cardColumns(924.dp))
    }
}
