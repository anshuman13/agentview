package no.pradhan.agentview.nativeapp

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StepsTest {
    private fun obj(vararg p: Pair<String, String>): JsonObject = buildJsonObject { p.forEach { (k, v) -> put(k, v) } }
    private fun use(id: String, name: String, input: JsonObject = obj(), at: Long = 0, parent: String? = null) = ChatEvent(id, "tool_use", name = name, input = input, at = at, parent = parent)
    private fun res(id: String, of: String, text: String = "", err: Boolean = false, at: Long = 0) = ChatEvent(id, "tool_result", toolUseId = of, text = text, isError = err, at = at)

    @Test
    fun pairsToolUseWithItsResult() {
        val items = buildTranscript(listOf(ChatEvent("u", "user", text = "go"), use("t1", "Bash", obj("command" to "ls")), res("r1", "t1", "a.txt", at = 3000), ChatEvent("a", "assistant", text = "done")))
        assertEquals(listOf("User", "Step", "Assistant"), items.map { it::class.simpleName })
        assertEquals("a.txt", (items[1] as Item.Step).result?.text)
    }

    @Test
    fun hidesSetStatusAndEmptyAssistantRows() {
        val items = buildTranscript(listOf(use("s", "mcp__agentview__set_status"), ChatEvent("a", "assistant", text = "  "), ChatEvent("r", "result", costUsd = 1.0)))
        assertTrue(items.isEmpty())
    }

    @Test
    fun mergesConsecutiveEditsOfOneFileAndKeepsFailures() {
        val edit = { id: String, a: String, b: String -> use(id, "Edit", obj("file_path" to "/x/a.kt", "old_string" to a, "new_string" to b)) }
        val items = buildTranscript(listOf(edit("e1", "one", "two\nthree"), res("r1", "e1"), edit("e2", "x", "y"), res("r2", "e2")))
        val f = items.single() as Item.File
        assertEquals(2, f.uses.size)
        assertEquals(3, f.add)
        assertEquals(2, f.del)
        val failed = buildTranscript(listOf(edit("e1", "a", "b"), res("r1", "e1", "No such file", err = true)))
        val ff = failed.single() as Item.File
        assertEquals("No such file", ff.error)
        assertEquals(0, ff.add)
    }

    @Test
    fun nestsSubAgentStepsAndTracksRunning() {
        val agent = use("ag", "Agent", obj("description" to "Look"))
        val child = use("c1", "Read", obj("file_path" to "/a"), parent = "ag")
        val running = buildTranscript(listOf(agent, child)).single() as Item.Agent
        assertTrue(running.running)
        assertEquals(1, running.steps.size)
        val done = buildTranscript(listOf(agent, child, res("r", "ag", "report", at = 5))).single() as Item.Agent
        assertFalse(done.running)
    }

    @Test
    fun editCountsFollowTheWeb() {
        assertEquals(3 to 0, editCount("Write", obj("content" to "a\nb\nc")))
        assertEquals(1 to 1, editCount("Edit", obj("old_string" to "a", "new_string" to "b")))
        assertEquals(12 to 0, editCount("Write", obj("content" to "a\nb\n… 10 more lines")))
        assertNull(editCount("Bash", obj()))
    }

    @Test
    fun labelsReadLikeTheWeb() {
        assertEquals(Label("Read", "src/a.kt"), stepLabel("Read", obj("file_path" to "/p/src/a.kt"), "/p"))
        assertEquals(Label("Ran", "ls -la", mono = true), stepLabel("Bash", obj("command" to "ls -la\npwd")))
        assertEquals(Label("", "List files", cmd = "ls"), stepLabel("Bash", obj("description" to "List files", "command" to "ls")))
        assertEquals(Label("Called", "search (slack)"), stepLabel("mcp__slack__search", obj()))
        assertEquals(Tone.Mcp, stepTone("mcp__x__y"))
    }

    @Test
    fun deniedResultsAndDurations() {
        assertTrue(isDenied(res("r", "t", "The user doesn't want to proceed with this tool use", err = true)))
        assertFalse(isDenied(res("r", "t", "boom", err = true)))
        assertEquals("", duration(900))
        assertEquals("5s", duration(5000))
        assertEquals("3m", duration(180_000))
        assertEquals("2h", duration(7_200_000))
    }

    @Test
    fun costSumsTheRiseOfARunningTotal() {
        val r = { c: Double -> ChatEvent("r$c", "result", costUsd = c) }
        assertEquals(0.5 + 0.3 + 0.2, chatCost(listOf(r(0.5), r(0.8), r(0.2))), 1e-9)
    }

    @Test
    fun gapsFollowAuthorsAndSteps() {
        val user = Item.User("u", "hi", 0, false, false)
        val text = Item.Assistant("a", "ok", false)
        val step = Item.Step("s", use("t", "Bash"), null)
        assertNull(gapAbove(null, user))
        assertEquals(Tokens.sp12, gapAbove(user, text))
        assertEquals(Tokens.sp12, gapAbove(text, user))
        assertEquals(Tokens.sp4, gapAbove(text, step))
        assertNull(gapAbove(step, step))
    }

    @Test fun dayDividersMarkEachNewDay() {
        val zone = java.time.ZoneId.of("Europe/Oslo")
        fun at(d: String) = java.time.LocalDateTime.parse(d).atZone(zone).toInstant().toEpochMilli()
        fun user(id: String, d: String) = Item.User(id, "hi", at(d), false, false)
        val now = at("2026-11-08T22:00")
        val items = listOf(user("a", "2025-12-31T10:00"), user("b", "2026-11-06T09:00"), Item.System("s", "x"), user("c", "2026-11-06T18:00"), user("d", "2026-11-07T08:00"), user("e", "2026-11-08T07:00"))
        assertEquals(mapOf("a" to "31 December 2025", "b" to "Friday, 6 November", "d" to "Yesterday", "e" to "Today"), dayDividers(items, now, zone))
        assertEquals(emptyMap<String, String>(), dayDividers(listOf(user("x", "2026-11-08T09:00"), user("y", "2026-11-08T21:00")), now, zone))
    }

    @Test fun newMarkerIsFirstReplyAfterLastVisit() {
        val items = listOf(Item.User("u1", "a", 10, false, false), Item.Assistant("a1", "x", false), Item.User("u2", "b", 30, false, false), Item.Assistant("a2", "y", false), Item.Assistant("a3", "z", false))
        val ats = mapOf("u1" to 10L, "a1" to 20L, "u2" to 30L, "a2" to 40L, "a3" to 60L)
        assertEquals("a2", newMarker(items, ats, seen = 25, openedAt = 50))
        assertNull(newMarker(items, ats, seen = 0, openedAt = 50))
        assertNull(newMarker(items, ats, seen = 45, openedAt = 50))
    }

    @Test fun chatMarkdownKeepsPromptsAndReplies() {
        val events = listOf(
            ChatEvent("1", "user", "fix it"), ChatEvent("2", "tool_use", name = "Bash"),
            ChatEvent("3", "assistant", "Done."), ChatEvent("4", "user", "later", queued = true),
        )
        assertEquals("# T\n\n**You:** fix it\n\nDone.\n", chatMarkdown("T", events))
    }
}
