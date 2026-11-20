package no.pradhan.agentview.nativeapp.app

import org.junit.Assert.assertEquals
import org.junit.Test

class SnackLogicTest {
    @Test fun snackStaysFiveSecondsAtLeast() {
        assertEquals(5000L, snackMillis(SNACK_MS, 0))
        assertEquals(5000L, snackMillis(2000, 0))
        assertEquals(8000L, snackMillis(8000, 0))
        assertEquals(12000L, snackMillis(SNACK_MS, 12000))
        assertEquals(5000L, snackMillis(SNACK_MS, 3000))
    }
}
