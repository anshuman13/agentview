package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ComposerLogicTest {
    private val cmds = listOf(CommandInfo("compact"), CommandInfo("clear"), CommandInfo("code-review"), CommandInfo("review"), CommandInfo("init"))

    @Test fun quotesAReplyAsMarkdown() {
        assertEquals("> Done.\n>\n> Tests pass.\n\n", quoteReply(" Done.\n\nTests pass. "))
        assertEquals("> alpha beta…\n\n", quoteReply("alpha beta gamma", max = 13))
    }

    @Test
    fun triggerFindsTheSlashWordAtTheCaret() {
        assertEquals(Trigger(0, "co"), commandTrigger("/co", 3))
        assertEquals(Trigger(6, ""), commandTrigger("hello /", 7))
        assertNull(commandTrigger("a/b", 3))
        assertEquals(Trigger(4, "Ses", file = true), commandTrigger("fix @Ses", 8))
        assertNull(commandTrigger("me@x", 4))
        assertEquals(listOf("web/src/Sessions.tsx", "android/Sessions.kt"), rankFiles(listOf("README.md", "android/Sessions.kt", "web/src/Sessions.tsx"), "sessions.t"))
        assertNull(commandTrigger("/co now", 7))
        assertEquals(Trigger(0, "c"), commandTrigger("/c more text", 2))
    }

    @Test
    fun commandsRankPrefixThenInnerThenScattered() {
        assertEquals(listOf("clear", "compact", "code-review"), rankCommands(cmds, "c").map { it.name }.take(3))
        assertEquals(listOf("review", "code-review"), rankCommands(cmds, "rev").map { it.name })
        assertEquals(listOf("code-review"), rankCommands(cmds, "cdrv").map { it.name })
        assertEquals(emptyList<String>(), rankCommands(cmds, "zzz").map { it.name })
        assertEquals(MAX_ROWS, rankCommands(List(20) { CommandInfo("c$it") }, "c").size)
    }

    @Test
    fun acceptingASuggestionReplacesTheWordAndAddsASpace() {
        assertEquals("/compact " to 9, acceptSuggestion("/co", 0, 3, "/compact"))
        assertEquals("hi /clear  tail" to 10, acceptSuggestion("hi /c tail", 3, 5, "/clear"))
    }

    @Test
    fun appendWordAddsOneSeparator() {
        assertEquals("a b", appendWord("a", "b"))
        assertEquals("a b", appendWord("a ", "b"))
        assertEquals("b", appendWord("", "b"))
    }

    @Test
    fun userMessagesSplitIntoTextAndImages() {
        assertEquals(
            listOf(Part.Text("look"), Part.Image("/tmp/a.png"), Part.Text("and this")),
            userParts("look [Image: /tmp/a.png] and this"),
        )
        assertEquals(listOf(Part.Image("/x.png")), userParts("[Image: /x.png] "))
        assertEquals(listOf(Part.Text("plain")), userParts("plain"))
    }

    @Test
    fun modelNamesAndContext() {
        val s = SessionInfo(model = "opus", models = listOf(ModelInfo("opus", "Opus 5.5 (recommended)")))
        assertEquals("Opus 5.5 (recommended)", modelName(s))
        assertEquals("Opus 5.5", shortModel(modelName(s)))
        assertEquals("Opus 4.8", shortModel("claude-opus-4-8"))
        assertEquals("Team", modelName(SessionInfo(team = true)))
        assertEquals(50, contextPercent(100_000))
        assertEquals(100, contextPercent(500_000))
        assertNull(contextPercent(null))
    }

    @Test
    fun settingsChipShowsModelAndNonDefaultMode() {
        assertEquals("Opus 4.8", settingsLabel("claude-opus-4-8", "default"))
        assertEquals("Opus 4.8 · Plan", settingsLabel("claude-opus-4-8", "plan"))
    }

    @Test
    fun sendKindDependsOnRunningAndSteer() {
        assertEquals(SendKind.Prompt, sendKind(false, true))
        assertEquals(SendKind.Queue, sendKind(true, false))
        assertEquals(SendKind.Steer, sendKind(true, true))
    }

    @Test fun bangIsAShellCommand() {
        assertEquals("git status", shellCommand("  ! git status "))
        assertNull(shellCommand("!"))
        assertNull(shellCommand("why ! here"))
    }
}
