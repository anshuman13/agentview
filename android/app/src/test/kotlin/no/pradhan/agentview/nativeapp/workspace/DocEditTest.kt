package no.pradhan.agentview.nativeapp.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DocEditTest {
    @Test fun splitsOnBlankLinesAndKeepsFencesWhole() {
        val text = "# T\n\nOne\ntwo\n\n```\na\n\nb\n```\n\n- x\n"
        assertEquals(listOf("# T", "One\ntwo", "```\na\n\nb\n```", "- x"), docBlocks(text).map { it.raw })
        docBlocks(text).forEach { assertEquals(it.raw, text.substring(it.start, it.start + it.raw.length)) }
    }

    @Test fun replacesABlock() {
        val text = "# T\n\nOld para\nline 2\n\n- a\n"
        val b = docBlocks(text)[1]
        assertEquals("# T\n\nNew\n\n- a\n", replaceBlock(text, b, "New\n"))
        assertNull(replaceBlock("# T\n\nchanged\n", b, "x"))
    }

    @Test fun quotesTheBlockInThePrompt() {
        assertEquals("In notes/a.md, about this part:\n\n> one\n> two\n\nshorter\n\nEdit the file in place and leave the rest as it is.", docAskPrompt("notes/a.md", " one\ntwo ", "shorter "))
    }
}
