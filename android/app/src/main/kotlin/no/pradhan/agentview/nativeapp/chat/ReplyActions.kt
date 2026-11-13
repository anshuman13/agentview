package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.saveReply
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet

// Web chat/transcript/ReplyActions.tsx: one "..." action under a reply that opens Reply, Copy and Save as note.
@Composable
internal fun ReplyActions(hub: Hub, text: String, chat: String, cwd: String) {
    var open by remember { mutableStateOf(false) }
    val clip = LocalClipboardManager.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { IconBtn("ellipsis", "Reply actions", { open = true }) }
    if (open) Sheet(onDismiss = { open = false }, title = "Reply", padded = false, full = false) {
        Group {
            ListRow("Reply", lines = 1, onClick = { open = false; hub.draftPrompt(quoteReply(text)) })
            Hairline()
            ListRow("Copy", lines = 1, onClick = { open = false; clip.setText(AnnotatedString(text)); hub.notice.value = "Copied the reply" })
            Hairline()
            ListRow("Save as note", lines = 1, onClick = { open = false; hub.saveReply(chat, text, cwd) })
        }
    }
}
