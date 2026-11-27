package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.net.ChatEvent
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
    fun marksHookResultsAsErrors() {
        val items = buildTranscript(listOf(ChatEvent("h", "system", text = "Hook blocked Bash: no rm", error = true), ChatEvent("s", "system", text = "Interrupted")))
        assertEquals(listOf(true, false), items.map { (it as Item.System).error })
    }
}
