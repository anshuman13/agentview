package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.loadEarlier
import no.pradhan.agentview.nativeapp.codex.meetings.stepMatch
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// web shared/findInChat.ts: the ids, oldest first, of the rows the transcript draws holding every word of the query, ignoring case: user prompts and each turn's last top-level reply; none under two characters. With no hit and an `at` (a message hit's time, whose reply may be an earlier one of its turn), the row that ends the turn holding that time.
fun findInChat(events: List<ChatEvent>, query: String, at: Long? = null): List<String> {
    val q = query.trim().lowercase()
    if (q.length < 2) return emptyList()
    val words = q.split(Regex("\\s+"))
    val hits = mutableListOf<String>()
    val turns = mutableListOf<Pair<Long, String>>()
    var reply: ChatEvent? = null
    fun has(e: ChatEvent) = e.text.lowercase().let { t -> words.all(t::contains) }
    fun endTurn() { reply?.takeIf(::has)?.let { hits.add(it.id) }; reply = null }
    for (e in events) {
        if (e.kind == "user") { endTurn(); turns.add(e.at to e.id); if (has(e)) hits.add(e.id) }
        else if (e.kind == "assistant" && e.parent == null) { reply = e; if (turns.isNotEmpty()) turns[turns.size - 1] = turns.last().first to e.id }
    }
    endTurn()
    if (hits.isNotEmpty() || at == null) return hits
    return listOfNotNull((turns.lastOrNull { it.first <= at } ?: turns.firstOrNull())?.second)
}

// A sidebar message hit waiting for its chat: the find bar opens on it once that chat shows. `at` is the hit's time, null when unknown.
class FindRequest(val sessionId: String, val query: String, val at: Long?)

// web shared/findInChat.ts: the index in hits of the hit whose event time is nearest `at`, the earliest on a tie; the last hit when `at` or every hit's time is missing.
fun findStart(events: List<ChatEvent>, hits: List<String>, at: Long?): Int {
    val last = maxOf(hits.size - 1, 0)
    if (at == null) return last
    val times = events.associate { it.id to it.at }
    var best = -1
    var gap = Long.MAX_VALUE
    hits.forEachIndexed { i, id ->
        val t = times[id] ?: 0L
        if (t != 0L && Math.abs(t - at) < gap) { best = i; gap = Math.abs(t - at) }
    }
    return if (best < 0) last else best
}

// "n of N" for the current hit; "No matches" for none, and "· loaded only" while earlier events are not loaded.
fun findLabel(cur: Int, count: Int, earlier: Int) =
    (if (count == 0) "No matches" else "${cur + 1} of $count") + if (earlier > 0) " · loaded only" else ""

// The find bar under the chat header: a field, the hit count and Previous and Next; each step scrolls the transcript to the hit. Load earlier takes their place while a query has no hit and earlier events exist. A request fills the query and picks the hit nearest its time.
@Composable
fun FindBar(hub: Hub, events: List<ChatEvent>, earlier: Int, request: FindRequest?, onClose: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var cur by remember { mutableStateOf(0) }
    val loading by hub.loadingEarlier.collectAsState()
    var from by remember { mutableStateOf<FindRequest?>(null) }
    val hits = remember(events, query, from) { findInChat(events, query, from?.takeIf { it.query == query }?.at) }
    val at = cur.coerceIn(0, maxOf(hits.size - 1, 0))
    LaunchedEffect(request) {
        if (request == null) return@LaunchedEffect
        from = request
        val found = findInChat(events, request.query, request.at)
        query = request.query
        cur = findStart(events, found, request.at)
        found.getOrNull(cur)?.let { hub.showTurn.value = it }
        hub.findRequest.value = null
    }
    LaunchedEffect(hits.firstOrNull(), query) { hits.getOrNull(at)?.let { hub.showTurn.value = it } }
    val go = { to: Int -> cur = to; hits.getOrNull(to)?.let { hub.showTurn.value = it }; Unit }
    SearchField(query, { query = it; cur = 0 }, "Find in chat")
    Row(Modifier.padding(start = Tokens.listPad, end = Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
        Text(if (query.trim().length >= 2) findLabel(at, hits.size, earlier) else "", Modifier.weight(1f), style = Type.footnote, color = av.fgMuted)
        if (query.trim().length >= 2 && hits.isEmpty() && earlier > 0) {
            Button(if (loading) "Loading…" else "Load earlier", { hub.loadEarlier() }, size = ButtonSize.Sm, enabled = !loading)
        } else if (query.trim().length >= 2) {
            IconBtn("arrow-up", "Previous", { go(stepMatch(at, -1, hits.size)) }, enabled = hits.isNotEmpty())
            IconBtn("arrow-down", "Next", { go(stepMatch(at, 1, hits.size)) }, enabled = hits.isNotEmpty())
        }
        IconBtn("close", "Close", onClose)
    }
}
