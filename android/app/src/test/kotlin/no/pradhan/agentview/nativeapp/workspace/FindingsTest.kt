package no.pradhan.agentview.nativeapp.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FindingsTest {
    @Test fun scrollsToTheFindingLine() {
        assertEquals(0, findingScroll(1, 100))
        assertEquals(39, findingScroll(40, 100))
    }

    @Test fun clampsPastTheEndToTheLastLine() = assertEquals(9, findingScroll(412, 10))

    @Test fun noScrollForAnEmptyFileOrLineZero() {
        assertNull(findingScroll(5, 0))
        assertNull(findingScroll(0, 100))
    }
}
