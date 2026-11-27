package no.pradhan.agentview.nativeapp.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileSearchTest {
    @Test fun searchStartsAtTwoCharacters() {
        assertNull(fileQuery(" a "))
        assertEquals("ab", fileQuery(" ab "))
    }

    @Test fun parsesHitsAsPathLineRows() {
        val r = parseSearch("""{"hits":[{"path":"src/a.ts","line":2,"text":"const Needle = 2;"}],"more":true}""")
        assertEquals(true, r.more)
        assertEquals("src/a.ts:2", hitPlace(r.hits.single()))
    }
}
