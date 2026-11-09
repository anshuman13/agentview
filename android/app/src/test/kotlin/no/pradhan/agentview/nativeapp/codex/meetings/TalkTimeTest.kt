package no.pradhan.agentview.nativeapp.codex.meetings

import no.pradhan.agentview.nativeapp.chat.CMD_PREVIEW
import no.pradhan.agentview.nativeapp.chat.cmdPreview
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.jobs.toolLabels
import no.pradhan.agentview.nativeapp.codex.wiki.agoText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TalkTimeTest {
    @Test fun countsWordsPerLabel() {
        val s = talkTime("Transcript\n00:01\nAda Lovelace: one two three\nBob Ray: four\nAda Lovelace: five six")
        assertEquals(listOf("Ada Lovelace", "Bob Ray"), s.map { it.name })
        assertEquals(5, s[0].words)
        assertEquals(5.0 / 6, s[0].share, 1e-9)
    }

    @Test fun aOneOffLabelWithoutHeadingIsNotASpeaker() {
        assertTrue(talkTime("Summary: we agreed on things\nand more").isEmpty())
    }

    @Test fun nameLinesWithTextBelow() {
        val s = talkTime("Ada Lovelace\nhello there you\nBob Ray\nhi\nAda Lovelace\nok then\nBob Ray\nyes")
        assertEquals("Ada Lovelace", s[0].name)
        assertEquals(5, s[0].words)
    }
}

class LeftoversTest {
    @Test fun commandPreviewClampsByCharacters() {
        val path = "/Users/oda/workspace/" + "a".repeat(300)
        val p = cmdPreview("$path --flag")
        assertTrue(p.startsWith("$ /Users/oda/workspace/"))
        assertEquals(CMD_PREVIEW + 3, p.length)
        assertTrue(p.endsWith("…"))
        assertEquals("$ ls ⏎ pwd", cmdPreview("ls\npwd"))
    }

    @Test fun agoTextUsesTheWebAge() {
        val now = 10L * 86_400_000
        assertEquals("2d ago", agoText(now - 2 * 86_400_000L - 1000, now))
        assertEquals("1d ago", agoText(now - 86_400_000L, now))
        assertEquals("3h ago", agoText(now - 3 * 3_600_000L, now))
        assertEquals("now", agoText(now - 5000, now))
    }

    @Test fun toolChips() {
        assertEquals(listOf("Chrome", "linear", "claude.ai Slack", "mcp__x__*"), toolLabels("browser, mcp__linear__*,mcp__claude_ai_Slack__*,mcp__x__*", listOf("linear", "claude.ai Slack")))
    }
}
