package no.pradhan.agentview.nativeapp.ops

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.chat.Item
import no.pradhan.agentview.nativeapp.net.ChatEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class AgentsLogicTest {
    private val use = ChatEvent("a1", "tool_use", name = "Agent", input = JsonObject(emptyMap()))
    private fun read() = Item.Step("s1", ChatEvent("s1", "tool_use", name = "Read", input = buildJsonObject { put("file_path", "steps.ts") }), null)
    private fun done(text: String, stopped: Boolean = false, err: Boolean = false) = ChatEvent("r1", "tool_result", toolUseId = "a1", text = text, stopped = stopped, isError = err)
    private fun agent(running: Boolean, result: ChatEvent? = null, progress: String? = null, steps: List<Item> = emptyList()) = Item.Agent("a1", use, result, running, progress, steps)

    @Test
    fun runningShowsProgressThenTheLastStepThenStarting() {
        assertEquals("Reading the docs", agentSummary(agent(true, progress = "Reading the docs", steps = listOf(read()))))
        assertEquals("Read steps.ts", agentSummary(agent(true, steps = listOf(read()))))
        assertEquals("Starting…", agentSummary(agent(true)))
    }

    @Test
    fun doneShowsTheFirstReportLineWithoutMarkdownMarks() {
        assertEquals("Result", agentSummary(agent(false, done("## Result\nAll good"))))
        assertEquals("Found it", agentSummary(agent(false, done("---\n- Found it\nmore"))))
        assertEquals(200, agentSummary(agent(false, done("x".repeat(300)))).length)
        assertEquals("No report", agentSummary(agent(false, done(""))))
    }

    @Test
    fun stoppedAndFailedShowTheErrorThenProgressThenAWord() {
        assertEquals("Checking tests", agentSummary(agent(false, done("", stopped = true, err = true), progress = "Checking tests")))
        assertEquals("Boom", agentSummary(agent(false, done("Boom\nstack", err = true))))
        assertEquals("Agent failed", agentSummary(agent(false, done("", err = true))))
        assertEquals("Agent stopped", agentSummary(agent(false, done("", stopped = true))))
    }
}
