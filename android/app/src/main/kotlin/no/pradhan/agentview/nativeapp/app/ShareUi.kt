package no.pradhan.agentview.nativeapp.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import no.pradhan.agentview.nativeapp.codex.profileLabel

import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.select

// The picker for text, links and images shared from other apps: a chat to send them to, or a new Codex task.
@Composable
fun ShareSheet(hub: Hub, item: SharedItem) {
    val live by hub.store.state.select { it.live }
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
        if (live.isEmpty()) EmptyState("No open chats")
        else Group {
            live.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ListRow(c.title.ifEmpty { "Chat" }, repoName(c), onClick = { hub.shareToChat(c.id, item); done() })
            }
        }
    }
}
