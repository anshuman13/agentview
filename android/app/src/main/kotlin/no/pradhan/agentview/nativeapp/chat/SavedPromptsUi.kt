package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.sessions.matchesWords
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.Sheet

// The prompts sent from any chat on this phone, newest first; a tap puts one in this chat's composer.
@Composable
fun SavedPromptsSheet(hub: Hub, prompts: List<String>, chat: String, onDismiss: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val words = queryWords(query)
    val shown = prompts.asReversed().filter { words.isEmpty() || matchesWords(words, it) }
    Sheet(onDismiss = onDismiss, title = "Saved prompts", padded = false, full = false, count = prompts.size.takeIf { it > 0 }?.toString()) {
        if (prompts.isEmpty()) {
            EmptyState("No saved prompts yet", "Prompts you send from this phone show here", icon = "history")
            return@Sheet
        }
        SearchField(query, { query = it }, "Filter prompts")
        if (shown.isEmpty()) EmptyState("No prompt matches", icon = "search")
        shown.forEach { text ->
            ListRow(text, lines = 1, onClick = { hub.useAgain(chat, text); onDismiss() })
        }
    }
}
