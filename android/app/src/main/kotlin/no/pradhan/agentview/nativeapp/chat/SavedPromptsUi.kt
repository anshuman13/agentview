package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Composable
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet

// The prompts sent from any chat on this phone, newest first; a tap puts one in this chat's composer.
@Composable
fun SavedPromptsSheet(hub: Hub, prompts: List<String>, chat: String, onDismiss: () -> Unit) {
    Sheet(onDismiss = onDismiss, title = "Saved prompts", padded = false, full = false) {
        prompts.asReversed().forEach { text ->
            ListRow(text, lines = 1, onClick = { hub.useAgain(chat, text); onDismiss() })
        }
    }
}
