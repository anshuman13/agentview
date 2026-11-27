package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.SpawnedBuild
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

// web BuildBar.tsx: pinned under the chat header while a build this chat started is open; a tap opens the build chat.
@Composable
fun BuildBar(hub: Hub, sessionId: String?, events: List<ChatEvent>) {
    if (sessionId == null) return
    var builds by remember(sessionId) { mutableStateOf<List<SpawnedBuild>>(emptyList()) }
    val started = remember(events) { events.count { it.kind == "tool_use" && it.name == BUILD_TOOL } }
    val rows = buildRows(builds)
    val open = rows.isNotEmpty()
    val scope = rememberCoroutineScope()
    LaunchedEffect(sessionId, started, open) {
        while (true) {
            runCatching { hub.api.spawnedBuilds(sessionId) }.onSuccess { builds = it }
            if (!open) break
            delay(30_000)
        }
    }
    if (!open) return
    for (b in rows) {
        ListRow(
            b.title, b.meta.ifEmpty { null }, lines = 1, metaLines = 1, compact = true,
            leading = { AvIcon("tools", null, Tokens.iconSm) },
            state = { Badge(b.status, if (b.needs) BadgeTone.Waiting else BadgeTone.Quiet) },
            trailing = { AvIcon("chevron-right", tint = av.fgMuted) },
            onClick = {
                val chat = b.chatId?.takeIf { id -> hub.store.state.value.live.any { it.id == id } }
                if (chat != null) hub.open(chat) else scope.launch { hub.openSaved(b.sessionId) }
            },
        )
    }
    Hairline()
}
