package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.net.CommandInfo
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.sessions.SavedSession
import no.pradhan.agentview.nativeapp.workspace.appendPrompt
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
    fun chatMentionListsChatsByTitle() {
        assertEquals("tri", chatQuery(commandTrigger("see @chat:tri", 13)))
        assertNull(chatQuery(commandTrigger("see @src", 8)))
        assertNull(chatQuery(commandTrigger("/chat:tri", 9)))
        val chats = listOf(SavedSession("a", "/tries worktrees", "/r"), SavedSession("b", "Day dividers", "/r"), SavedSession("c", "", "/r"))
        assertEquals(listOf("a"), rankChats(chats, "tri").map { it.sessionId })
        assertEquals(listOf("a", "b"), rankChats(chats, "").map { it.sessionId })
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

    @Test fun usedAgainPromptJoinsANonEmptyDraftWithItsMarkersAsChips() {
        val back = splitMarks(appendPrompt("half typed [Image: /a/one.png] ", "look at this\n[Image: /a/two.png] "))
        assertEquals("half typed \n\nlook at this\n", back.body)
        assertEquals(listOf("[Image: /a/one.png]", "[Image: /a/two.png]"), back.marks)
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

    @Test
    fun sendAtIsTodayWhileTheTimeIsAheadAndTomorrowOnceItHasPassed() {
        val now = java.time.ZonedDateTime.of(2026, 11, 9, 14, 0, 0, 0, java.time.ZoneId.of("UTC")).toInstant().toEpochMilli()
        assertEquals("today", laterDay(22, 0, now, java.time.ZoneId.of("UTC")))
        assertEquals("tomorrow", laterDay(9, 30, now, java.time.ZoneId.of("UTC")))
        assertEquals("/loop at 22:00 fix it", loopAt("22:00", "fix it"))
    }

    @Test fun offersQuickRepliesOnlyAfterAFinishedQuestion() {
        fun say(t: String, streaming: Boolean = false) = no.pradhan.agentview.nativeapp.net.ChatEvent(t, "assistant", t, streaming)
        val user = no.pradhan.agentview.nativeapp.net.ChatEvent("u", "user", "hi")
        assertEquals(QUICK_REPLIES, quickReplies(listOf(user, say("Should I push it? "))))
        assertEquals(emptyList<String>(), quickReplies(listOf(user, say("Should I push it?", true))))
        assertEquals(emptyList<String>(), quickReplies(listOf(user, say("Done."))))
        assertEquals(emptyList<String>(), quickReplies(listOf(say("Should I?"), user)))
    }

    @Test fun questionChoicesNameTheOptions() {
        assertEquals(listOf("Keep the old one", "Remove it"), questionChoices("Should I keep the old one or remove it?"))
        assertEquals(listOf("Push now", "Wait for review"), questionChoices("Done. Want me to push now, or wait for review?"))
        assertEquals(listOf("Rebase", "Merge"), questionChoices("Options:\n\n- **Rebase**: cleaner history\n- **Merge**: keeps both\n\nWhich one?"))
        assertEquals(listOf("Club seats", "Floor seats"), questionChoices("1. Club seats\n2. Floor seats\nWhich seats?"))
        assertEquals(emptyList<String>(), questionChoices("Should I push it?"))
    }
}
