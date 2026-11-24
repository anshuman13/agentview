package no.pradhan.agentview.nativeapp.codex

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IdeasLogicTest {
    private fun t(id: String, title: String, at: Long?) = Row("items", id, "work", f = buildMap { put("title", JsonPrimitive(title)); put("status", JsonPrimitive("open")); at?.let { put("at", JsonPrimitive(it)) } })

    @Test fun picksTasksAnAgentCouldTakeOnSoonestFirst() {
        assertTrue(canDelegate("Draft the Q3 memo"))
        assertFalse(canDelegate("Dentist"))
        val got = pickIdeas(listOf(t("a", "Review PR", null), t("b", "Call mum", 1), t("c", "Research venues", 5), t("d", "Write notes", 2), t("e", "Fix bug", 3)), setOf("work:e"))
        assertEquals(listOf("d", "c", "a"), got.map { it.id })
        assertEquals("I can help: draft the memo", ideaTitle("Draft the memo"))
    }
}
