package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.SpawnedBuild
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// web BuildCard.tsx: a build the agent started with start_build, with its spec, state, task and last round, and Open for the build chat.
@Composable
internal fun BuildCard(hub: Hub, it: Item.Step) {
    val state by hub.store.state.collectAsState()
    val sessionId = state.session?.sessionId
    val index = state.events.filter { e -> e.kind == "tool_use" && e.name == BUILD_TOOL }.indexOfFirst { e -> e.id == it.use.id }.coerceAtLeast(0)
    val tick = state.events.size
    var builds by remember { mutableStateOf<List<SpawnedBuild>>(emptyList()) }
    val card = buildCard(it.use.input.s("spec"), it.use.input.s("request"), it.result?.text, index, builds)
    val active = card.status != "Done" && card.status != "Stopped"
    val scope = rememberCoroutineScope()

    LaunchedEffect(sessionId, tick, active) {
        if (sessionId == null) return@LaunchedEffect
        delay(500)
        while (true) {
            runCatching { hub.api.spawnedBuilds(sessionId) }.onSuccess { b -> builds = b }
            if (!active) break
            delay(30_000)
        }
    }

    val open = card.open
    val meta = listOf(card.tasks, card.round).filter { s -> s.isNotEmpty() }.joinToString(" · ")
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard)) {
        ListRow(
            if (card.title.isNotEmpty()) "Build: ${card.title}" else "Build", leading = { AvIcon("tools", null, Tokens.icon) },
            trailing = if (open == null) null else ({
                Button("Open", {
                    when (open) {
                        is BuildCardOpen.Chat -> hub.open(open.id)
                        is BuildCardOpen.Session -> scope.launch { hub.openSaved(open.id) }
                    }
                }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }),
        )
        Column(Modifier.padding(start = Tokens.listPad + Tokens.leadWidth + Tokens.sp8, end = Tokens.listPad, bottom = Tokens.sp6), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            Text(card.status, style = Type.body, color = av.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (meta.isNotEmpty()) Text(meta, style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
