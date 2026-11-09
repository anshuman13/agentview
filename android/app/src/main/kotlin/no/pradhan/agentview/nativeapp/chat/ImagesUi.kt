package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color

private val IMAGE = Regex("\\.(png|jpe?g|gif|webp|avif|svg)$", RegexOption.IGNORE_CASE)

// The images a chat looked at, wrote or was sent, newest first, each once.
fun chatImages(events: List<ChatEvent>): List<String> {
    val paths = events.flatMap { e ->
        when (e.kind) {
            "tool_use" -> listOf(e.input.s("file_path")).filter { e.name in setOf("Read", "Write") && IMAGE.containsMatchIn(it) }
            "user" -> userParts(e.text).filterIsInstance<Part.Image>().map { it.path }
            else -> emptyList()
        }
    }
    return paths.asReversed().distinct()
}

@Composable
fun ImagesSheet(hub: Hub, chat: String, images: List<String>, cwd: String, onDismiss: () -> Unit) {
    Sheet(onDismiss = onDismiss, title = "Images", count = images.size.toString()) {
        images.forEach { p ->
            ChatImage(hub, chat, p)
            Text(relPath(p, cwd), Modifier.padding(top = Tokens.sp2, bottom = Tokens.sp6), style = Type.footnote, color = av.fgMuted)
        }
    }
}
