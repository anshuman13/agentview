package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceNewChatTest {
    private val models = listOf(ModelInfo("default", "Default"), ModelInfo("opus", "Opus"))

    @Test
    fun modelsRoundTrip() {
        assertEquals(models, parseModels(encodeModels(models)))
        assertEquals(emptyList<ModelInfo>(), parseModels("nonsense"))
        assertEquals(emptyList<ModelInfo>(), parseModels(null))
    }

    @Test
    fun startsOnTheLastModelWhenOffered() {
        assertEquals("opus", startModel(models, "opus"))
        assertEquals("default", startModel(models, "gone"))
        assertEquals("default", startModel(models, null))
        assertNull(startModel(emptyList(), "opus"))
    }

    @Test
    fun twoPanesFrom840dp() {
        assertFalse(isExpanded(839))
        assertTrue(isExpanded(840))
        assertFalse(isExpanded(411))
    }

    @Test
    fun newSessionCarriesModelOnlyWhenChosen() {
        assertTrue(newSessionCmd(cwd = "/a", model = "opus").contains("\"model\":\"opus\""))
        assertFalse(newSessionCmd(cwd = "/a").contains("model"))
        assertTrue(newSessionCmd(cwd = "/a", fork = "s1").contains("\"fork\":\"s1\""))
    }

    @Test
    fun promptListsChatsAndForbidsWrites() {
        val p = voicePrompt("what needs me", listOf(LiveChat("1", "Fix login", pending = 1), LiveChat("2", "", running = true)))
        assertTrue(p.startsWith("what needs me"))
        assertTrue(p.contains("- Fix login: needs me"))
        assertTrue(p.contains("- Untitled: working"))
        assertTrue(p.contains("Do not send prompts"))
    }

    @Test
    fun answerWaitsForTheFinishedReply() {
        val q = "what needs me"
        val user = ChatEvent("u", "user", text = "$q\n\nMy open chats")
        assertNull(voiceAnswer(listOf(user), q))
        assertNull(voiceAnswer(listOf(user, ChatEvent("a", "assistant", text = "One", streaming = true)), q))
        assertEquals("Two chats.", voiceAnswer(listOf(ChatEvent("old", "assistant", text = "stale"), user, ChatEvent("a", "assistant", text = "Two chats. ")), q))
        assertNull(voiceAnswer(listOf(ChatEvent("a", "assistant", text = "stale")), q))
        val tool = ChatEvent("t", "tool_use", text = "")
        assertNull(voiceAnswer(listOf(user, ChatEvent("a", "assistant", text = "Let me check."), tool), q, busy = true))
        assertEquals("Final.", voiceAnswer(listOf(user, ChatEvent("a", "assistant", text = "Let me check."), tool, ChatEvent("b", "assistant", text = "Final.")), q))
        assertNull(voiceAnswer(listOf(user, ChatEvent("a", "assistant", text = "old answer")), q, before = 1))
        assertEquals("new", voiceAnswer(listOf(user, ChatEvent("a", "assistant", text = "old"), user.copy(id = "u2"), ChatEvent("b", "assistant", text = "new")), q, before = 1))
    }

    @Test
    fun spokenTextDropsMarkdown() {
        val md = "## Status\n- **Login** is [done](http://x)\n```\ncode\n```\n1. next `step`"
        assertEquals("Status Login is done next step", spokenText(md))
        assertTrue(spokenText("word ".repeat(500), 50).length <= 51)
    }

    @Test
    fun chunksStayShortAndKeepEverything() {
        assertEquals(listOf("One. Two."), speechChunks("One. Two.", 20))
        assertEquals(listOf("One sentence here.", "Another one."), speechChunks("One sentence here. Another one.", 20))
        val long = "word ".repeat(100).trim()
        val chunks = speechChunks(long, 50)
        assertTrue(chunks.all { it.length <= 50 })
        assertEquals(long, chunks.joinToString(" "))
        assertEquals(emptyList<String>(), speechChunks("  "))
    }

    @Test
    fun startModesSetNothingForChatAndPlanOrAutoOtherwise() {
        assertEquals(listOf(null, "plan", "auto"), START_MODES.map { it.mode })
        assertEquals("Chat", START_MODES.first().label)
    }
}
