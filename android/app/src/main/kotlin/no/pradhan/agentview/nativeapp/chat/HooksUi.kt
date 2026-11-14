package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Composable
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.runHook
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.av

// The manual prompt hooks for this chat's repo; a tap queues the hook's prompt.
@Composable
fun HooksSheet(hub: Hub, hooks: List<String>, onDismiss: () -> Unit) {
    Sheet(onDismiss = onDismiss, title = "Hooks", padded = false, full = false) {
        if (hooks.isEmpty()) EmptyState("No hooks for this repo")
        else hooks.forEach { name ->
            ListRow(name, lines = 1, trailing = { AvIcon("play", tint = av.fgMuted) }, onClick = { hub.runHook(name); onDismiss() })
        }
    }
}
