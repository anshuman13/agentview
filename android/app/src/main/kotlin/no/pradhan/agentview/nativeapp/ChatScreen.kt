package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(hub: Hub) {
    val state by hub.store.state.collectAsState()
    val live = state.live.firstOrNull { it.id == state.shownId }
    if (live == null) {
        TopAppBar(title = { Text("Chat") })
        Text("Open a chat from Sessions.", Modifier.padding(Sp.s8), color = av.fgMuted)
        return
    }
    val session = state.session
    val running = session?.running ?: live.running
    val cost = remember(state.events, live.cost) { live.cost ?: chatCost(state.events) }
    var menu by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<String?>(null) }
    val status = statusLine(live, session)
    val sessionId = live.sessionId ?: session?.sessionId

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text(live.title.ifBlank { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(Sp.s3)) {
                        Text(
                            status.text,
                            style = MaterialTheme.typography.labelMedium,
                            color = when (status.tone) { Tone2.Running -> av.accentText; Tone2.Needs -> av.warn; Tone2.Failed -> av.err; Tone2.Idle -> av.fgMuted },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        costLabel(cost).takeIf { it.isNotEmpty() }?.let { Text("· $it", style = MaterialTheme.typography.labelMedium, color = av.fgMuted) }
                    }
                }
            },
            actions = {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Rename") }, enabled = sessionId != null, onClick = { menu = false; dialog = "rename" })
                    DropdownMenuItem(text = { Text("Close chat") }, onClick = { menu = false; if (running || live.pending > 0) dialog = "close" else hub.closeChat(live.id) })
                    DropdownMenuItem(text = { Text("Archive", color = av.err) }, enabled = sessionId != null, onClick = { menu = false; dialog = "archive" })
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = av.bg),
        )
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
    var text by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename chat") },
        text = { OutlinedTextField(text, { if (it.length <= 120) text = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { renameTitle(text, current)?.let(onSave); onDismiss() }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun ConfirmDialog(title: String, detail: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(detail, color = av.fgMuted) },
        confirmButton = { TextButton(onClick = { onConfirm(); onDismiss() }) { Text(action, color = av.err) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
