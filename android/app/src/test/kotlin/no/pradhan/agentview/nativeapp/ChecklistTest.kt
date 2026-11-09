package no.pradhan.agentview.nativeapp

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChecklistTest {
    private fun item(content: String, status: String, active: String = "") = buildJsonObject { put("content", content); put("status", status); put("activeForm", active) }
    private fun write(id: String, vararg items: JsonObject, parent: String? = null) = ChatEvent(id, "tool_use", name = "TodoWrite", input = buildJsonObject { put("todos", JsonArray(items.toList())) }, parent = parent)

    @Test
    fun readsTheNewestListOfTheChatAndNamesWhatIsInProgress() {
        val events = listOf(write("a", item("Old", "pending")), write("b", item("Read", "completed"), item("Test", "in_progress", "Testing"), item("Ship", "pending")), write("c", item("Agent", "pending"), parent = "agent1"))
        val list = latestChecklist(events)!!
        assertEquals(listOf("Read", "Test", "Ship"), list.map { it.content })
        assertEquals("1 of 3", checklistProgress(list))
        assertEquals("Testing", checklistCurrent(list))
        assertNull(latestChecklist(emptyList()))
    }

    @Test
    fun hidesAFinishedListOnceTheTurnHasEnded() {
        val done = latestChecklist(listOf(write("a", item("Read", "completed"))))
        assertTrue(visibleChecklist(done, true) != null)
        assertNull(visibleChecklist(done, false))
        assertNull(visibleChecklist(latestChecklist(listOf(write("a"))), true))
    }

    @Test
    fun quotesEachCommentedPlanParagraphInOneMessage() {
        val paras = planParagraphs("# Plan\n\nStep one\nmore\n\n```\nx\n\ny\n```")
        assertEquals(listOf("# Plan", "Step one\nmore", "```\nx\n\ny\n```"), paras)
        val long = "Second " + "x".repeat(100)
        assertEquals("Comments on the plan:\n\n> Step one more\nuse a worktree\n\n> Second " + "x".repeat(73) + "…\ntoo big", planFeedback(listOf("Step one\nmore", long, "Third"), mapOf(0 to " use a worktree ", 1 to "too big", 2 to " ")))
        assertEquals("", planFeedback(paras, emptyMap()))
    }

    @Test
    fun marksHookResultsAsErrors() {
        val items = buildTranscript(listOf(ChatEvent("h", "system", text = "Hook blocked Bash: no rm", error = true), ChatEvent("s", "system", text = "Interrupted")))
        assertEquals(listOf(true, false), items.map { (it as Item.System).error })
    }
}
