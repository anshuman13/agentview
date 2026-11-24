package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class WorkFoldTest {
    private var n = 0L
    private fun id(p: String) = "$p${++n}"
    private fun user() = ChatEvent(id("u"), "user", text = "go", at = n * 1000)
    private fun say(text: String) = ChatEvent(id("a"), "assistant", text = text, at = n * 1000)
    private fun tool(name: String, input: JsonObject = JsonObject(emptyMap())) = ChatEvent(id("t"), "tool_use", name = name, input = input, at = n * 1000)
    private fun result(of: ChatEvent, err: Boolean = false, text: String = "ok") = ChatEvent(id("r"), "tool_result", toolUseId = of.id, text = text, isError = err, at = n * 1000)
    private fun done(cost: Double) = ChatEvent(id("d"), "result", costUsd = cost, at = n * 1000)
    private fun path(p: String) = JsonObject(mapOf("file_path" to JsonPrimitive(p), "content" to JsonPrimitive("x")))
    private fun fold(events: List<ChatEvent>) = foldTurns(buildTranscript(events), events)
    private fun kinds(rows: List<FoldRow>) = rows.map { r -> if (r is FoldRow.Fold) "fold" else (r as FoldRow.Row).it::class.simpleName }
    private val work = Work(12, 3, 1, 0, 120_000, 0.4)

    @Test
    fun titleKeepsToolsAndFilesAndMovesTheRestToTheDetail() {
        assertEquals(WorkTitle("12 tools · 3 files", "", "1 agent · 2m · $0.40"), workTitle(work, false, "usd"))
        assertEquals(WorkTitle("18 tools · 3 files", "4 failed", "1 agent · 2m · $0.40"), workTitle(work.copy(tools = 18, failed = 4), false, "usd"))
    }

    @Test
    fun titleOmitsZeroPartsUnbilledCostAndTheRunningDuration() {
        assertEquals("2m", workTitle(work.copy(tools = 1, files = 0, agents = 0, cost = 0.0), false, "usd").detail)
        assertEquals("1 agent", workTitle(work, true, "plan").detail)
        assertEquals("2 failed", workTitle(work.copy(failed = 2), false, "usd").failed)
        assertEquals("Work", workTitle(work.copy(tools = 0, files = 0), false, "usd").text)
        assertEquals(WorkTitle("Session started with claude", "", ""), workTitle(work.copy(tools = 0, files = 0, note = "Session started with claude"), false, "usd"))
        assertEquals("", workTitle(work.copy(tools = 0, files = 0, failed = 2), false, "usd").text)
    }

    @Test
    fun workMovesIntoOneFoldAboveTheLastReply() {
        val u = user()
        val rows = fold(listOf(u, say("looking"), tool("Bash"), say("done")))
        assertEquals(listOf("User", "fold", "Assistant"), kinds(rows))
        assertEquals(listOf("Assistant", "Step"), (rows[1] as FoldRow.Fold).hidden.map { it::class.simpleName })
        assertEquals(listOf("User", "fold"), kinds(fold(listOf(user(), tool("Bash")))))
    }

    @Test
    fun aTurnWithNothingHiddenHasNoFold() {
        val rows = fold(listOf(user(), say("hello"), user(), tool("Bash"), say("done")))
        assertEquals(listOf("User", "Assistant", "User", "fold", "Assistant"), kinds(rows))
        assertEquals(listOf(true), rows.filterIsInstance<FoldRow.Fold>().map { it.last })
    }

    @Test
    fun blockedErrorsAndSpecAndSketchCardsStayVisible() {
        val events = listOf(
            user(), tool("Bash"),
            ChatEvent("b1", "blocked"), ChatEvent("s1", "system", text = "Hook blocked Bash", error = true), ChatEvent("s2", "system", text = "Compact"),
            tool("Write", path("/w/.claude/specs/a.md")), tool("Write", path("/w/.claude/sketches/a.html")), say("done"),
        )
        assertEquals(listOf("User", "Blocked", "System", "File", "File", "fold", "Assistant"), kinds(fold(events)))
    }

    @Test
    fun foldCountsToolsDistinctFilesAgentsAndFailures() {
        val bad = tool("Bash")
        val agent = tool("Agent")
        val e1 = tool("Edit", JsonObject(mapOf("file_path" to JsonPrimitive("/w/a.ts"), "old_string" to JsonPrimitive("a"), "new_string" to JsonPrimitive("b"))))
        val e2 = tool("Edit", JsonObject(mapOf("file_path" to JsonPrimitive("/w/b.ts"), "old_string" to JsonPrimitive("a"), "new_string" to JsonPrimitive("b"))))
        val refused = tool("Bash")
        val events = listOf(user(), bad, result(bad, true, "boom"), agent, e1, result(e1), e2, result(e2), refused, result(refused, true, "The user doesn't want to proceed"), say("ok"), done(0.3), user(), say("hi"), done(0.5))
        val first = fold(events).filterIsInstance<FoldRow.Fold>().first()
        assertEquals(Work(5, 2, 1, 1, events.first { it.kind == "result" }.at - events[0].at, 0.0), first.work)
    }

    @Test
    fun costIsTheRiseOverThePreviousLoadedResultAndNoneForTheFirst() {
        val events = listOf(user(), tool("Bash"), say("ok"), done(52.0), user(), tool("Bash"), say("hi"), done(52.3))
        val costs = fold(events).filterIsInstance<FoldRow.Fold>().map { it.work.cost }
        assertEquals(0.0, costs[0], 1e-9)
        assertEquals(0.3, costs[1], 1e-9)
    }

    @Test
    fun claimsAreTheClaimLinesOfWikiResultsOncePerIdWithTheirPage() {
        val text = listOf("- page [p1] Notes (Work, live)", "- [c1] (2026-11-01, live) Uses bun (on Notes / Tools)", "- [c2] (undated, proposed) Prefers (short) replies").joinToString("\n")
        val search = tool("mcp__agentview__wiki_search")
        val page = tool("mcp__agentview__wiki_page")
        val events = listOf(user(), search, result(search, text = text), page, result(page, text = "# Notes\n- [c1] (2026-11-01, live) Uses bun (on Notes / Tools)"), say("ok"))
        assertEquals(listOf(Claim("c1", "Uses bun", "Notes / Tools"), Claim("c2", "Prefers (short) replies", "")), fold(events).filterIsInstance<FoldRow.Fold>().first().claims)
    }

    @Test
    fun noClaimsForNoMatchAnErrorOrAnotherTool() {
        val none = tool("mcp__agentview__wiki_search")
        val bad = tool("mcp__agentview__wiki_page")
        val other = tool("Bash")
        val text = "- [c1] (undated, live) Uses bun"
        val events = listOf(user(), none, result(none, text = "Nothing matches."), bad, result(bad, true, text), other, result(other, text = text), say("ok"))
        assertEquals(emptyList<Claim>(), fold(events).filterIsInstance<FoldRow.Fold>().first().claims)
    }

    @Test
    fun theServersEventsForAMemoryWriteFoldIntoRemembered() {
        val events = protocolJson.decodeFromString<List<ChatEvent>>(File("../../shared/fixtures/remembered-history.json").readText())
        assertEquals(listOf("/Users/x/.claude-alt/projects/-Users-x-repo/memory/prefs.md"), fold(events).filterIsInstance<FoldRow.Fold>().single().remembered)
    }

    @Test fun foldLineShowsNowWhileLiveAndTheLastDoneTaskAfter() {
        val steps = listOf(StatusStep("a", "Read the code", true), StatusStep("b", "Fix the bug", true), StatusStep("c", "Run the checks", false))
        assertEquals("Reading tokens.css", foldLine(steps, "Reading tokens.css", true, 3))
        assertEquals("Run the checks", foldLine(steps, "", true, 3))
        assertEquals("Working", foldLine(emptyList(), "", true, 0))
        assertEquals("Fix the bug", foldLine(steps, "old", false, 3))
        assertEquals("Used 2 tools", foldLine(emptyList(), "", false, 2))
        assertEquals("", foldLine(emptyList(), "", false, 0))
    }
}
