package no.pradhan.agentview.nativeapp.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SketchLogicTest {
    private class Fake(override var javaScript: Boolean = true, override var blockNetwork: Boolean = false, override var fileAccess: Boolean = true, override var contentAccess: Boolean = true) : SketchSettings

    @Test fun lockSketchTurnsEverythingOff() {
        val s = Fake()
        lockSketch(s)
        assertFalse(s.javaScript)
        assertTrue(s.blockNetwork)
        assertFalse(s.fileAccess)
        assertFalse(s.contentAccess)
    }

    @Test fun desktopPageAsksForTheWideViewportInOurHead() {
        val wide = sketchPage("<h1>x</h1>", "dark", true)
        assertTrue(wide.startsWith("<html data-theme=\"dark\"><head><meta http-equiv=\"Content-Security-Policy\""))
        assertTrue(wide.contains("<meta name=\"viewport\" content=\"width=1280\"></head><h1>x</h1>"))
        val own = sketchPage("<meta name=\"viewport\" content=\"width=device-width\"><h1>x</h1>", "dark", true)
        assertFalse(own.contains("device-width"))
        assertEquals(sketchDoc("<h1>x</h1>", "dark"), sketchPage("<h1>x</h1>", "dark", false))
    }

    @Test fun onlyListedNamesOpen() {
        assertTrue(sketchOpenable("a.html", listOf("a.html")))
        assertFalse(sketchOpenable("../a.html", listOf("../a.html")))
        assertFalse(sketchOpenable("b.html", listOf("a.html")))
    }
}
