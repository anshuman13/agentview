package no.pradhan.agentview.nativeapp.codex.meetings

import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import org.junit.Assert.assertEquals
import org.junit.Test

class MeetingLinksTest {
    @Test
    fun linksKeepWebUrlsWithTitles() {
        val m = Row("meetings", "cal:1", WORK, f = mapOf("links" to JsonPrimitive("""[{"title":"AIE-1 Fix","url":"https://www.linear.app/x"},{"title":"Bad","url":"javascript:x"},{"url":"https://a.b"}]""")))
        assertEquals(listOf("AIE-1 Fix"), linksOf(m).map { it.title })
        assertEquals("linear.app", linksOf(m)[0].domain)
        assertEquals(0, linksOf(m.copy(f = emptyMap())).size)
    }
}
