package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// web shared/findInChat.ts: the ids, oldest first, of the rows the transcript draws holding every word of the query, ignoring case: user prompts and each turn's last top-level reply; none under two characters.
fun findInChat(events: List<ChatEvent>, query: String): List<String> {
    val q = query.trim().lowercase()
    if (q.length < 2) return emptyList()
    val words = q.split(Regex("\\s+"))
    val hits = mutableListOf<String>()
    var reply: ChatEvent? = null
    fun has(e: ChatEvent) = e.text.lowercase().let { t -> words.all(t::contains) }
    fun endTurn() { reply?.takeIf(::has)?.let { hits.add(it.id) }; reply = null }
    for (e in events) {
        if (e.kind == "user") { endTurn(); if (has(e)) hits.add(e.id) }
        else if (e.kind == "assistant" && e.parent == null) reply = e
    }
    endTurn()
    return hits
}

// "n of N" for the current hit; "No matches" for none, and "· loaded only" while earlier events are not loaded.
fun findLabel(cur: Int, count: Int, earlier: Int) =
    (if (count == 0) "No matches" else "${cur + 1} of $count") + if (earlier > 0) " · loaded only" else ""

// The find bar under the chat header: a field, the hit count and Previous and Next; each step scrolls the transcript to the hit.
@Composable
fun FindBar(hub: Hub, events: List<ChatEvent>, earlier: Int, onClose: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var cur by remember { mutableStateOf(0) }
    val hits = remember(events, query) { findInChat(events, query) }
    val at = cur.coerceIn(0, maxOf(hits.size - 1, 0))
    LaunchedEffect(query) { cur = 0 }
    LaunchedEffect(hits.firstOrNull(), query) { hits.firstOrNull()?.let { hub.showTurn.value = it } }
    val go = { to: Int -> cur = to; hits.getOrNull(to)?.let { hub.showTurn.value = it }; Unit }
    SearchField(query, { query = it }, "Find in chat")
    Row(Modifier.padding(start = Tokens.listPad, end = Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
        Text(if (query.trim().length >= 2) findLabel(at, hits.size, earlier) else "", Modifier.weight(1f), style = Type.footnote, color = av.fgMuted)
        if (query.trim().length >= 2) {
            IconBtn("arrow-up", "Previous", { go((at - 1 + hits.size) % hits.size) }, enabled = hits.isNotEmpty())
            IconBtn("arrow-down", "Next", { go((at + 1) % hits.size) }, enabled = hits.isNotEmpty())
        }
        IconBtn("close", "Close", onClose)
    }
}
