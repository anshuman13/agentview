package no.pradhan.agentview.nativeapp.ui

import androidx.compose.ui.graphics.Color
import kotlin.math.pow
import org.junit.Assert.assertTrue
import org.junit.Test

class ContrastTest {
    private fun lum(c: Color): Double {
        fun ch(v: Float) = v.toDouble().let { if (it <= 0.03928) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
        return 0.2126 * ch(c.red) + 0.7152 * ch(c.green) + 0.0722 * ch(c.blue)
    }

    private fun ratio(a: Color, b: Color): Double {
        val (hi, lo) = listOf(lum(a), lum(b)).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun check(name: String, min: Double, pairs: List<Pair<Color, Color>>) =
        pairs.forEachIndexed { i, (a, b) -> assertTrue("$name pair $i is ${ratio(a, b)}", ratio(a, b) >= min) }

    @Test fun rolesMeetContrast() {
        for ((name, c) in listOf("dark" to DarkColors, "light" to LightColors)) {
            val surfaces = listOf(c.bg, c.containerLow, c.surface, c.raised, c.sunken)
            val text = listOf(c.fg, c.fgMuted, c.accent, c.ok, c.warn, c.err, c.agent, c.info)
            check(name, 4.5, text.flatMap { t -> surfaces.map { t to it } })
            check(name, 3.0, listOf(c.fgFaint, c.borderStrong, c.work, c.personal).flatMap { t -> listOf(c.bg, c.surface).map { t to it } })
            check(
                name, 4.5, listOf(
                    c.onAccent to c.accent, c.onPrimaryContainer to c.primaryContainer, c.onSecondaryContainer to c.accentSoft,
                    c.inverseOnSurface to c.inverseSurface, c.inversePrimary to c.inverseSurface,
                    c.onOkContainer to c.okContainer, c.onWarnContainer to c.warnContainer, c.onErrContainer to c.errContainer,
                    c.onAgentContainer to c.agentContainer, c.onInfoContainer to c.infoContainer, c.onErr to c.err, c.onAgent to c.agent,
                ),
            )
        }
    }
}
