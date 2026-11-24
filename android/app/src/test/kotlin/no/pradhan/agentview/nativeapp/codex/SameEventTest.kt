package no.pradhan.agentview.nativeapp.codex

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SameEventTest {
    private fun ev(id: String, title: String, s: Long = 1, e: Long = 2) = Row("meetings", id, "work", f = mapOf("title" to JsonPrimitive(title), "starts_at" to JsonPrimitive(s), "ends_at" to JsonPrimitive(e)))

    @Test fun treatsTheSameIdOrARewordedCopyAsOneEvent() {
        assertTrue(sameEvent(ev("a", "Standup"), ev("a", "Standup", 5, 6)))
        assertTrue(sameEvent(ev("a", "Flight to Stockholm Arlanda from Gardermoen (D84102)"), ev("b", "Flight to Stockholm (D8 4102)")))
        assertFalse(sameEvent(ev("a", "1:1 Anna"), ev("b", "1:1 Per")))
        assertFalse(sameEvent(ev("a", "Flight to Stockholm"), ev("b", "Flight to Stockholm", 1, 3)))
        assertEquals(listOf("a", "b"), uniqueEvents(listOf(ev("a", "X y z"), ev("b", "Other"), ev("c", "x y z"))).map { it.id })
    }
}
