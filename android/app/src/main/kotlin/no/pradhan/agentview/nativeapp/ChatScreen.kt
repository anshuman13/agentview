package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle

data class StatusLine(val text: String, val tone: Tone2)
enum class Tone2 { Running, Needs, Failed, Idle }

fun statusLine(live: LiveChat, session: SessionInfo?): StatusLine = when {
    live.pending > 0 -> StatusLine("Needs you", Tone2.Needs)
    live.failed -> StatusLine("Failed", Tone2.Failed)
    live.stalled -> StatusLine("No activity for 15 min", Tone2.Failed)
    (session?.running ?: live.running) -> StatusLine(live.status.ifBlank { "Working" }, Tone2.Running)
    else -> StatusLine("Idle", Tone2.Idle)
}

fun costLabel(cost: Double) = if (cost > 0) "$" + String.format(java.util.Locale.US, "%.2f", cost) else ""

@Composable
fun ChatScreen(hub: Hub) {
    val state by hub.store.state.collectAsState()
    val live = state.live.firstOrNull { it.id == state.shownId }
    if (live == null) {
        Column(Modifier.fillMaxSize()) {
            PageHeader("Chat")
            EmptyState("No chat open", "Open a chat from Sessions.")
        }
        return
    }
    val session = state.session
    val running = session?.running ?: live.running
    val cost = remember(state.events, live.cost) { live.cost ?: chatCost(state.events) }
    var dialog by remember { mutableStateOf<String?>(null) }
    val status = statusLine(live, session)
    val sessionId = live.sessionId ?: session?.sessionId

    Column(Modifier.fillMaxSize()) {
        PageHeader(
            live.title.ifBlank { "Untitled" },
            large = false,
            subtitle = {
                val toneColor = when (status.tone) { Tone2.Running -> av.accentText; Tone2.Needs -> av.warn; Tone2.Failed -> av.err; Tone2.Idle -> av.fgMuted }
                val muted = av.fgMuted
                val usage = session?.usage
                val warn = av.warn
                val line = remember(status, cost, toneColor, muted, usage) {
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = toneColor)) { append(status.text) }
                        costLabel(cost).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = muted)) { append(" · $it") } }
                        usageText(usage).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = if (usageHigh(usage)) warn else muted)) { append(" · $it") } }
                    }
                }
                WordClamp(line, Type.subheadline, muted, 1)
            },
        ) {
            MoreButton { close ->
                MenuItem("Rename", "edit", { close(); dialog = "rename" }, enabled = sessionId != null)
                MenuItem("Close chat", "close", { close(); if (running || live.pending > 0) dialog = "close" else hub.closeChat(live.id) })
                MenuSeparator()
                MenuItem("Archive", "archive", { close(); dialog = "archive" }, danger = true, enabled = sessionId != null)
            }
        }
        HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        Transcript(hub, state, live.id, session?.cwd ?: live.cwd, running, Modifier.weight(1f).fillMaxWidth())
        PendingList(state.pending, session?.permissionMode ?: "default", hub)
        Composer(hub, live.id, session, running, state.pending.isNotEmpty())
    }

    when (dialog) {
        "rename" -> RenameDialog(live.title, onSave = { hub.rename(sessionId!!, it) }, onDismiss = { dialog = null })
        "archive" -> ConfirmDialog("Archive this chat?", "${live.title}\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(sessionId!!) }) { dialog = null }
        "close" -> ConfirmDialog("Close this chat?", "Claude is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(live.id) }) { dialog = null }
    }
}

@Composable
fun RenameDialog(current: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    TextDialog("Rename chat", current, "Save", { t -> renameTitle(t, current)?.let(onSave) }, onDismiss, maxLength = 120)
}
