package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.net.LiveChat
import org.junit.Assert.assertEquals
import org.junit.Test

class ActivityLogicTest {
    private fun chat(id: String, at: Long, running: Boolean = false, pending: Int = 0, last: String? = null, failed: Boolean = false) =
        LiveChat(id = id, title = id, running = running, pending = pending, lastActive = at, last = last, failed = failed)

    @Test fun outcomeIsTheFirstSentence() {
        assertEquals("Fixed the popup.", outcomeLine("Fixed **the** popup. Then I pushed."))
        assertEquals("", outcomeLine(null))
        assertEquals(90, outcomeLine("x".repeat(200)).length)
    }

    @Test fun listsChatsFinishedTodayNewestFirst() {
        val rows = activity(listOf(chat("old", 5), chat("a", 20, last = "Done."), chat("run", 30, running = true), chat("ask", 30, pending = 1), chat("b", 25, failed = true), chat("shown", 40)), setOf("shown"), 10)
        assertEquals(listOf("b", "a"), rows.map { it.id })
        assertEquals("Stopped with an error", rows[0].line)
        assertEquals("Done.", rows[1].line)
    }
}
