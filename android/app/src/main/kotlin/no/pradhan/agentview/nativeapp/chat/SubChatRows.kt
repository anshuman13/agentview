package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.readFile
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.SubChat
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

data class SubFeed(val events: List<ChatEvent> = emptyList(), val earlier: Int = 0, val loading: Boolean = false, val error: String? = null)

// Web useSubChats.ts: the chat's earlier sub-chats, the task lines of their build spec, and the transcripts of the rows the reader expanded.
// Kept above the lazy row so a row scrolled out of view keeps what it loaded.
class SubChatsState(private val hub: Hub, private val scope: CoroutineScope) {
    var subs by mutableStateOf<List<SubChat>>(emptyList())
    var tasks by mutableStateOf<List<String>?>(null)
    var unfolded by mutableStateOf(false)
    val feeds = mutableStateMapOf<String, SubFeed>()
    // The search hit to scroll to once its sub-chat is open, and its top within the sub-chat rows once laid out.
    var hit by mutableStateOf<String?>(null)
    var hitY by mutableStateOf<Float?>(null)
    var rowsBox: LayoutCoordinates? = null

    suspend fun load(sessionId: String, chat: String) {
        val list = runCatching { hub.api.subChats(sessionId) }.getOrNull() ?: return
        subs = list
        val spec = chainSpec(list) ?: return
        runCatching { hub.readFile(spec, chat).content }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { tasks = specTasks(it) }
    }

    private fun page(id: String, before: String) {
        feeds[id] = (feeds[id] ?: SubFeed()).copy(loading = true, error = null)
        scope.launch {
            runCatching { hub.api.subChatEvents(id, before) }
                .onSuccess { (events, earlier) -> feeds[id]?.let { f -> feeds[id] = SubFeed(events + if (before.isEmpty()) emptyList() else f.events, earlier) } }
                .onFailure { e -> feeds[id]?.let { f -> feeds[id] = f.copy(loading = false, error = e.message ?: "Could not load the sub-chat") } }
        }
    }

    fun toggle(id: String) { if (feeds[id] == null) page(id, "") else feeds.remove(id) }

    fun open(id: String) { if (feeds[id] == null) page(id, "") }

    fun earlier(id: String) {
        val f = feeds[id] ?: return
        val first = f.events.firstOrNull() ?: return
        if (!f.loading) page(id, first.id)
    }
}

@Composable
fun rememberSubChats(hub: Hub, sessionId: String?, chat: String): SubChatsState {
    val scope = rememberCoroutineScope()
    val state = remember(sessionId) { SubChatsState(hub, scope) }
    LaunchedEffect(sessionId) { if (sessionId != null) state.load(sessionId, chat) }
    return state
}

// Web SubChatRows.tsx `find`: a search hit in an earlier sub-chat unfolds and opens its row, loads earlier pages until the hit's time, then marks the hit to scroll to.
// Runs in Transcript, not in the lazy row, which is not composed while scrolled out of view.
@Composable
fun SeekSubChat(hub: Hub, state: SubChatsState, find: FindRequest?) {
    val target = find?.sub?.takeIf { s -> state.subs.any { it.sessionId == s } }
    val feed = target?.let { state.feeds[it] }
    val shown = foldRows(state.subs, state.unfolded).shown
    LaunchedEffect(find, target, shown, feed) {
        if (find == null || target == null) return@LaunchedEffect
        if (shown.none { it.sessionId == target }) { state.unfolded = true; return@LaunchedEffect }
        if (feed == null) { state.open(target); return@LaunchedEffect }
        if (feed.loading) return@LaunchedEffect
        if (feed.error == null && feed.earlier > 0 && hitBeforeLoaded(feed.events, find.query, find.at)) { state.earlier(target); return@LaunchedEffect }
        hub.findRequest.value = null
        val hits = findInChat(feed.events, find.query, find.at)
        state.hitY = null
        state.hit = hits.getOrNull(findStart(feed.events, hits, find.at))
    }
}

// Web SubChatRows.tsx: one collapsed card per earlier sub-chat, oldest first, folded to the last FOLD_AT; a tap shows its transcript read-only.
@Composable
fun SubChatRows(hub: Hub, state: SubChatsState, chat: String, cwd: String) {
    val (shown, hidden) = foldRows(state.subs, state.unfolded)
    if (shown.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(bottom = Tokens.sp8).onGloballyPositioned { state.rowsBox = it }, verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        if (hidden > 0) MoreLine("Show $hidden earlier") { state.unfolded = true }
        shown.forEach { s ->
            val parts = subChatRow(s, state.tasks)
            val feed = state.feeds[s.sessionId]
            TranscriptBox(hub, "sub:${s.sessionId}", parts.first(), parts.drop(1).joinToString(" · "), open = feed != null, onToggle = { state.toggle(s.sessionId) }) {
                if (feed != null) SubFeedRows(hub, chat, feed, cwd, state) { state.earlier(s.sessionId) }
            }
        }
    }
}

@Composable
private fun SubFeedRows(hub: Hub, chat: String, feed: SubFeed, cwd: String, state: SubChatsState, onEarlier: () -> Unit) {
    val items = remember(feed.events) { buildTranscript(feed.events).filter { it !is Item.Blocked && it !is Item.Review } }
    Column(Modifier.fillMaxWidth().padding(Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        if (feed.earlier > 0) MoreLine(if (feed.loading) "Loading earlier…" else "Show earlier (${feed.earlier} hidden)", onEarlier)
        if (feed.loading && items.isEmpty()) MoreLine("Loading…") {}
        feed.error?.let { Text(it, style = Type.footnote, color = av.err) }
        items.forEach { item ->
            val mark = if (item.id == state.hit) Modifier.onGloballyPositioned { c -> state.rowsBox?.takeIf { it.isAttached }?.let { state.hitY = it.localPositionOf(c, Offset.Zero).y } } else Modifier
            Box(mark) { ItemRow(hub, item, chat, cwd, settled = true, onOpenAgent = {}, readOnly = true) }
        }
    }
}

@Composable
private fun MoreLine(text: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(text, style = Type.callout, color = av.accentText)
    }
}
