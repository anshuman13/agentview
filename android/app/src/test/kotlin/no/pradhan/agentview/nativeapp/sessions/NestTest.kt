package no.pradhan.agentview.nativeapp.sessions

import org.junit.Assert.assertEquals
import org.junit.Test

class NestTest {
    private fun chat(id: String, nestedIn: String? = null, last: Long = 0) = SavedSession(id, "Chat $id", "/r/$id", lastModified = last, nestedIn = nestedIn)

    @Test fun findsLoops() {
        assertEquals(true, nestLoops(mapOf("b" to "a"), "a", "b"))
        assertEquals(true, nestLoops(emptyMap(), "a", "a"))
        assertEquals(false, nestLoops(mapOf("b" to "a"), "c", "b"))
    }

    @Test fun listsTargets() {
        val chats = listOf(chat("a"), chat("b", "a"), chat("c"), chat("d"))
        assertEquals(listOf("c", "d"), nestTargets(chats, "a").map { it.sessionId })
        assertEquals(listOf("c", "d"), nestTargets(chats, "b").map { it.sessionId })
        assertEquals(listOf("d"), nestTargets(chats, "a", "/r/d").map { it.sessionId })
    }

    @Test fun groupsNestedRows() {
        val under = nestedRows(listOf(chat("a"), chat("b", "a", 1), chat("c", "a", 2), chat("d", "gone")))
        assertEquals(listOf("c", "b"), under.getValue("a").map { it.sessionId })
        assertEquals(false, "gone" in under)
    }
}
