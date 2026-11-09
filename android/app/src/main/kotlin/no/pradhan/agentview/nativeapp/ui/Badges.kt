package no.pradhan.agentview.nativeapp.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.sessions.state

enum class Status { Neutral, Ok, Warn, Err, Run, Agent, Info }

@Composable
fun Status.color(): Color = when (this) {
    Status.Neutral -> av.fgMuted
    Status.Ok -> av.ok
    Status.Warn -> av.warn
    Status.Err -> av.err
    Status.Run, Status.Agent -> av.agent
    Status.Info -> av.info
}

@Composable
fun Status.container(): Color = when (this) {
    Status.Neutral -> av.sunken
    Status.Ok -> av.okContainer
    Status.Warn -> av.warnContainer
    Status.Err -> av.errContainer
    Status.Run, Status.Agent -> av.agentContainer
    Status.Info -> av.infoContainer
}

@Composable
fun Status.onContainer(): Color = when (this) {
    Status.Neutral -> av.fg
    Status.Ok -> av.onOkContainer
    Status.Warn -> av.onWarnContainer
    Status.Err -> av.onErrContainer
    Status.Run, Status.Agent -> av.onAgentContainer
    Status.Info -> av.onInfoContainer
}

// Static tag (web .chip with a status tone): the status container with its on-container text.
@Composable
fun Tag(text: String, status: Status = Status.Neutral, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.clip(RoundedCornerShape(Tokens.radiusSm)).background(status.container()).padding(horizontal = Tokens.sp3),
        style = Type.footnote.copy(lineHeight = Tokens.lineSm), color = status.onContainer(), maxLines = 1,
    )
}

enum class BadgeTone { Default, Quiet, Waiting, Done, Failed, New, Running }

@Composable
fun Chevron(count: String? = null) {
    if (count != null) Text(count, style = Type.body, color = av.fgMuted)
    AvIcon("chevron-right", null, Tokens.iconSm, Modifier.padding(end = Tokens.sp4), tint = av.fgMuted)
}

// Badge (web Badge): a small pill with a count or a status word.
@Composable
fun Badge(text: String, tone: BadgeTone = BadgeTone.Default, modifier: Modifier = Modifier) {
    val c = av
    val (bg, fg) = when (tone) {
        BadgeTone.Default -> c.sunken to c.fg
        BadgeTone.Quiet -> c.sunken to c.fgMuted
        BadgeTone.Waiting -> c.warnContainer to c.onWarnContainer
        BadgeTone.Done -> c.okContainer to c.onOkContainer
        BadgeTone.Failed -> c.errContainer to c.onErrContainer
        BadgeTone.New -> c.infoContainer to c.onInfoContainer
        BadgeTone.Running -> c.agentContainer to c.onAgentContainer
    }
    Box(modifier.defaultMinSize(minWidth = Tokens.size2xs, minHeight = Tokens.size2xs).clip(RoundedCornerShape(Tokens.radiusPill)).background(bg).padding(horizontal = Tokens.sp2), contentAlignment = Alignment.Center) {
        Text(text, style = Type.label.copy(fontWeight = FontWeight.SemiBold, lineHeight = Tokens.lineXs), color = fg, maxLines = 1)
    }
}

enum class DotState { Faint, Ok, Bad, Warn, Busy, Running, Unread, Idle, Agent }

// Status dot (web .dot): running and busy pulse.
@Composable
fun StatusDot(state: DotState, modifier: Modifier = Modifier) {
    val c = av
    val color = when (state) {
        DotState.Faint -> c.fgFaint
        DotState.Ok -> c.ok
        DotState.Bad -> c.err
        DotState.Warn -> c.warn
        DotState.Busy, DotState.Running -> c.accent
        DotState.Unread -> c.info
        DotState.Idle -> Color.Transparent
        DotState.Agent -> Color.Transparent
    }
    val pulse = if (state == DotState.Busy || state == DotState.Running) {
        val t = rememberInfiniteTransition(label = "dot")
        t.animateFloat(1f, 0.6f, infiniteRepeatable(tween(Tokens.dur * 6), RepeatMode.Reverse), label = "pulse").value
    } else 1f
    val ring = if (state == DotState.Agent) c.agent else null
    Box(modifier.size(Tokens.dot).alpha(pulse).clip(CircleShape).background(color).then(if (ring != null) Modifier.border(Tokens.stroke, ring, CircleShape) else Modifier))
}
