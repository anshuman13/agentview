package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.chat.buildRows
import no.pradhan.agentview.nativeapp.net.SpawnedBuild
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

// web BuildRows.tsx: the open builds a chat started, as indented rows under its row; a tap opens the build chat.
@Composable
fun BuildRows(hub: Hub, sessionId: String?, members: List<String>?, state: ChatState?, onOpen: () -> Unit) {
    if (sessionId == null || members.isNullOrEmpty()) return
    var builds by remember(sessionId) { mutableStateOf<List<SpawnedBuild>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(sessionId, state) {
        while (true) {
            runCatching { hub.api.spawnedBuilds(sessionId) }.onSuccess { builds = it }
            delay(30_000)
        }
    }
    for (b in buildRows(builds)) {
        ListRow(
            b.title, b.meta.ifEmpty { null }, lines = 1, metaLines = 1, compact = true,
            leading = { AvIcon("tools", null, Tokens.iconSm) },
            state = {
                if (b.needs) Badge(b.status, BadgeTone.Waiting)
                else { if (b.status == "Running") AvIcon("sync", null, Tokens.iconSm, Modifier.padding(end = Tokens.sp1), tint = av.fgMuted); RowLabel(b.status) }
            },
            modifier = Modifier.background(av.groupCard).padding(start = Tokens.leadWidth + Tokens.sp8),
            onClick = {
                val chat = b.chatId?.takeIf { id -> hub.store.state.value.live.any { it.id == id } }
                if (chat != null) { hub.open(chat); onOpen() } else scope.launch { if (hub.openSaved(b.sessionId)) onOpen() }
            },
        )
    }
}
