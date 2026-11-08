package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

// The picker for text, links and images shared from other apps: a chat to send them to, or a new Codex task.
@Composable
fun ShareSheet(hub: Hub, item: SharedItem) {
    val state by hub.store.state.collectAsState()
    val done = { hub.shared.value = null }
    Sheet(done, "Share", padded = false, full = false) {
        if (!item.text.isNullOrBlank()) {
            SectionHeader("Codex")
            Group {
                ListRow("Add as task", profileLabel(hub.codexProfile), onClick = {
                    if (hub.writes.allowed() && hub.shareToTask(item, hub.codexProfile)) hub.link.value = DeepLink(view = "assistant")
                    done()
                })
            }
        }
        SectionHeader("Send to chat")
        if (state.live.isEmpty()) EmptyState("No open chats")
        else Group {
            state.live.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ListRow(c.title.ifEmpty { "Chat" }, repoName(c), onClick = { hub.shareToChat(c.id, item); done() })
            }
        }
    }
}
