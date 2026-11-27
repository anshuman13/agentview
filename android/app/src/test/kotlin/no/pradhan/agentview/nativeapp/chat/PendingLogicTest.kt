package no.pradhan.agentview.nativeapp.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingLogicTest {
    @Test
    fun quotesEachCommentedPlanParagraphInOneMessage() {
        val paras = planParagraphs("# Plan\n\nStep one\nmore\n\n```\nx\n\ny\n```")
        assertEquals(listOf("# Plan", "Step one\nmore", "```\nx\n\ny\n```"), paras)
        val long = "Second " + "x".repeat(100)
        assertEquals("Comments on the plan:\n\n> Step one more\nuse a worktree\n\n> Second " + "x".repeat(73) + "…\ntoo big", planFeedback(listOf("Step one\nmore", long, "Third"), mapOf(0 to " use a worktree ", 1 to "too big", 2 to " ")))
        assertEquals("", planFeedback(paras, emptyMap()))
    }

    @Test
    fun unescapesABlockedBashRuleAndKeepsAnyOtherRule() {
        assertEquals("rm -rf (x) \\y", blockedRule("Bash(rm -rf \\(x\\) \\\\y)"))
        assertEquals("WebFetch(domain:x.com)", blockedRule("WebFetch(domain:x.com)"))
    }
}
