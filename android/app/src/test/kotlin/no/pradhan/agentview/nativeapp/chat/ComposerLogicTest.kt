package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.net.CommandInfo
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.SessionInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ComposerLogicTest {
    private val cmds = listOf(CommandInfo("compact"), CommandInfo("clear"), CommandInfo("code-review"), CommandInfo("review"), CommandInfo("init"))

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

    @Test fun bangIsAShellCommand() {
        assertEquals("git status", shellCommand("  ! git status "))
        assertNull(shellCommand("!"))
        assertNull(shellCommand("why ! here"))
    }

    @Test fun effortsFollowTheModelsList() {
        val models = listOf(ModelInfo("a", efforts = listOf("low", "high", "minimal")), ModelInfo("b"))
        assertEquals(listOf("low", "high"), effortsFor(models, "a"))
        assertEquals(EFFORT_LEVELS, effortsFor(models, "b"))
    }

    @Test fun planStartsInDefaultWhereTheProviderHasNone() {
        assertEquals("default", startModeFor("plan", "codex"))
        assertEquals("plan", startModeFor("plan", "claude"))
        assertNull(startModeFor(null, "codex"))
    }

    @Test
    fun buildSendsTheTrimmedBriefOrShowsANotice() {
        assertEquals(BuildStep.Send("!ls"), buildStep("  !ls\n", 0, false))
        assertEquals(BuildStep.Notice(READ_ONLY_SENT), buildStep("brief", 0, true))
        assertEquals(BuildStep.Notice("Type the brief in the composer first"), buildStep(" \n", 0, false))
        assertEquals(BuildStep.Notice("Wait for the upload to finish"), buildStep("brief", 1, false))
    }
}
