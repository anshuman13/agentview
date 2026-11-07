package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Test

class DiffTest {
    private fun show(a: String, b: String) = lineDiff(a, b).joinToString("|") { "${it.mark}${it.text}" }

    @Test
    fun marksAddedAndRemovedLines() {
        assertEquals(" x|-b|+c| z", show("x\nb\nz", "x\nc\nz"))
        assertEquals("+a|+b", show("", "a\nb"))
        assertEquals("-a", show("a", ""))
    }

    @Test
    fun fallsBackToWholeReplacementWhenHuge() {
        val a = (1..600).joinToString("\n") { "a$it" }
        val b = (1..600).joinToString("\n") { "b$it" }
        val d = lineDiff(a, b)
        assertEquals(1200, d.size)
        assertEquals('-', d.first().mark)
        assertEquals('+', d.last().mark)
    }
}
