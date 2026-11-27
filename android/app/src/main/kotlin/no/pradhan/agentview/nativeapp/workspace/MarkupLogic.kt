package no.pradhan.agentview.nativeapp.workspace

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Web shared/markup.ts: marks drawn over the browser frame, with points as fractions of the frame (0 to 1).
sealed interface Mark {
    val c: String
    data class Pen(override val c: String, val pts: List<Float>) : Mark
    data class Box(override val c: String, val x0: Float, val y0: Float, val x1: Float, val y1: Float) : Mark
    data class Text(override val c: String, val x: Float, val y: Float, val text: String) : Mark
}

val MARK_COLOURS = listOf("Clay" to "#D97757", "Red" to "#E5372E", "Blue" to "#2D7FF9", "Green" to "#30A14E", "Black" to "#1F1E1D", "White" to "#FFFFFF")

fun markHex(c: String) = (MARK_COLOURS.firstOrNull { it.first == c } ?: MARK_COLOURS[0]).second

// What to draw for each mark on a frame w by h pixels.
sealed interface MarkOp {
    val color: String
    data class Pen(override val color: String, val width: Int, val pts: List<Double>) : MarkOp
    data class Box(override val color: String, val width: Int, val x: Double, val y: Double, val w: Double, val h: Double) : MarkOp
    data class Text(override val color: String, val size: Int, val x: Double, val y: Double, val text: String) : MarkOp
}

private fun r1(n: Double) = (n * 10).roundToInt() / 10.0

fun markOps(marks: List<Mark>, w: Int, h: Int): List<MarkOp> {
    val side = min(w, h)
    val width = max(2, (side / 160.0).roundToInt())
    val size = max(12, (side / 28.0).roundToInt())
    return marks.mapNotNull { m ->
        val color = markHex(m.c)
        when (m) {
            is Mark.Pen -> if (m.pts.size < 4) null else MarkOp.Pen(color, width, m.pts.mapIndexed { i, v -> r1(v.toDouble() * if (i % 2 == 1) h else w) })
            is Mark.Box -> {
                val bw = r1(abs(m.x1 - m.x0).toDouble() * w)
                val bh = r1(abs(m.y1 - m.y0).toDouble() * h)
                if (bw < 2 && bh < 2) null else MarkOp.Box(color, width, r1(min(m.x0, m.x1).toDouble() * w), r1(min(m.y0, m.y1).toDouble() * h), bw, bh)
            }
            is Mark.Text -> m.text.trim().takeIf { it.isNotEmpty() }?.let { MarkOp.Text(color, size, r1(m.x.toDouble() * w), r1(m.y.toDouble() * h), it) }
        }
    }
}
