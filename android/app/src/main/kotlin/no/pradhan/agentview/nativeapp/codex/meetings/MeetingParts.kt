package no.pradhan.agentview.nativeapp.codex.meetings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import kotlinx.coroutines.delay
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.readWithRoomMic
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

@Composable
internal fun NotesField(hub: Hub, m: Row) {
    val remote = m.str("notes") ?: ""
    var text by remember(m.key) { mutableStateOf(remote) }
    var dirty by remember(m.key) { mutableStateOf(false) }
    val latest by rememberUpdatedState(text)
    val save = {
        if (dirty) {
            dirty = false
            val row = hub.codex.current(m)
            if (latest != (row.str("notes") ?: "")) hub.codex.update(row, mapOf("notes" to latest))
        }
    }
    val flush by rememberUpdatedState(save)
    LaunchedEffect(remote) { if (!dirty) text = remote }
    LaunchedEffect(text) { if (dirty) { delay(NOTES_SAVE_MS); flush() } }
    DisposableEffect(m.key) { onDispose { flush() } }
    TextField(text, { text = it; dirty = true }, Modifier.padding(horizontal = Tokens.listPad), minLines = 3,
        placeholder = "Write your notes. They stay yours; the summary is written separately.")
}

@Composable
internal fun Pending(text: String) = Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted)

@Composable
internal fun Fold(label: String, count: Int, open: Boolean, onToggle: () -> Unit) {
    if (count == 0) return
    SectionHeader(label, count.toString(), open = open, onToggle = onToggle)
}

@Composable
internal fun RoomMic(hub: Hub, m: Row) {
    val room = m.str("room") ?: ""
    var busy by remember(m.key) { mutableStateOf(false) }
    Group {
        ListRow("On the room mic?", room, trailing = {
            Button("No", { hub.codex.update(m, mapOf("room_me" to 0)) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !busy)
            Button(if (busy) "Reading" else "Yes", {
                busy = true
                hub.readWithRoomMic(m) { busy = false }
            }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !busy)
        })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TalkTimeBar(speakers: List<Speaker>, actions: Int, decisions: Int) {
    val top = speakers.take(TALK_TOP)
    val rest = speakers.drop(TALK_TOP).sumOf { it.share }
    val parts = if (rest > 0) top.map { it.name to it.share } + ("Others" to rest) else top.map { it.name to it.share }
    val c = av
    val color = { i: Int -> if (i >= TALK_TOP) c.borderStrong else c.cMeeting.copy(alpha = TALK_ALPHA[i]) }
    SectionHeader("Talk time", "$actions ${if (actions == 1) "action" else "actions"} · $decisions ${if (decisions == 1) "decision" else "decisions"}")
    LRow(Modifier.padding(horizontal = Tokens.sp8).fillMaxWidth().height(Tokens.sp5).clip(RoundedCornerShape(Tokens.radiusPill))) {
        parts.forEachIndexed { i, p -> Box(Modifier.weight(p.second.toFloat().coerceAtLeast(0.001f)).fillMaxHeight().background(color(i))) }
    }
    FlowRow(Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp7), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
        parts.forEachIndexed { i, p ->
            LRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp3), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(Tokens.dot).clip(RoundedCornerShape(Tokens.radiusXs)).background(color(i)))
                Text("${p.first} ${Math.round(p.second * 100)}%", style = Type.footnote, color = av.fgMuted)
            }
        }
    }
}

private const val NOTES_SAVE_MS = 800L
private const val TALK_TOP = 5
private val TALK_ALPHA = floatArrayOf(1f, 0.75f, 0.55f, 0.4f, 0.28f)
