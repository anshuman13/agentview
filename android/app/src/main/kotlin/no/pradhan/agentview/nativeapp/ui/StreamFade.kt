package no.pradhan.agentview.nativeapp.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString

data class Tail(val start: Int, val at: Long)
data class FadeRange(val start: Int, val end: Int, val alpha: Float)

// Each chunk of streamed text fades from the moment it arrived; finished chunks drop out and are not faded again.
fun nextTails(tails: List<Tail>, prevLen: Int, len: Int, now: Long): List<Tail> {
    val live = tails.filter { now - it.at < Tokens.motionDuration && it.start < len }
    return if (len > prevLen) live + Tail(prevLen, now) else live
}

fun fadeRanges(tails: List<Tail>, len: Int, now: Long): List<FadeRange> =
    tails.mapIndexedNotNull { i, t ->
        val end = minOf(tails.getOrNull(i + 1)?.start ?: len, len)
        val p = ((now - t.at).toFloat() / Tokens.motionDuration).coerceIn(0f, 1f)
        if (end > t.start && p < 1f) FadeRange(t.start, end, Tokens.motionEaseIn.transform(p)) else null
    }

// True inside a streaming reply when motion is on; set by Markdown.
val LocalStreamFade = staticCompositionLocalOf { false }

private class FadeState { var tails = emptyList<Tail>(); var len = 0 }

private fun nowMs() = System.nanoTime() / 1_000_000

// Fades in the text added since the last render; returns `text` as is outside a streaming reply.
@Composable
fun fadedText(text: AnnotatedString, color: Color): AnnotatedString {
    if (!LocalStreamFade.current) return text
    val state = remember { FadeState() }
    val len = text.length
    val tails = remember(len) {
        state.tails = nextTails(state.tails, state.len, len, nowMs())
        state.len = len
        state.tails
    }
    var now by remember { mutableLongStateOf(nowMs()) }
    LaunchedEffect(tails) {
        while (tails.any { nowMs() - it.at < Tokens.motionDuration }) withFrameNanos { now = nowMs() }
        now = nowMs()
    }
    val ranges = fadeRanges(tails, len, now)
    if (ranges.isEmpty()) return text
    return buildAnnotatedString {
        append(text)
        for (r in ranges) addStyle(SpanStyle(color = color.copy(alpha = color.alpha * r.alpha)), r.start, r.end)
    }
}
