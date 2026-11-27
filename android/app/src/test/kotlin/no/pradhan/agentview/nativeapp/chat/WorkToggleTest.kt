package no.pradhan.agentview.nativeapp.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WorkToggleTest {
    @Test fun opensClosesAndSwitches() {
        assertEquals("t1", workToggle(null, "t1"))
        assertNull(workToggle("t1", "t1"))
        assertEquals("t2", workToggle("t1", "t2"))
    }
}
