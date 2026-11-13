package no.pradhan.agentview.nativeapp.chat

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.codex.meetings.Pending
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.Pending
import no.pradhan.agentview.nativeapp.net.ServerMessage
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.appendTo
import no.pradhan.agentview.nativeapp.ops.Findings

const val ROW_WINDOW = 150
const val CACHED_CHATS = 8

// The last rows of the most recently viewed chats (web/src/app/store.ts cache).
class RecentChats(private val size: Int = CACHED_CHATS) {
    data class Entry(val events: List<ChatEvent>, val earlier: Int)

    private val map = LinkedHashMap<String, Entry>()
    val ids: List<String> @Synchronized get() = map.keys.toList()

    @Synchronized fun put(id: String, events: List<ChatEvent>, earlier: Int) {
        if (events.isEmpty()) return
        val kept = events.takeLast(ROW_WINDOW)
        map.remove(id)
        map[id] = Entry(kept, earlier + events.size - kept.size)
        while (map.size > size) map.remove(map.keys.first())
    }

    @Synchronized fun get(id: String) = map[id]
    @Synchronized fun retainOnly(live: Set<String>) { map.keys.retainAll(live) }
    @Synchronized fun clear() = map.clear()
}

data class StoreState(
    val live: List<LiveChat> = emptyList(),
    val runs: List<ChatRun> = emptyList(),
    val shownId: String = "",
    val events: List<ChatEvent> = emptyList(),
    val earlier: Int = 0,
    val settled: Boolean = false,
    val session: SessionInfo? = null,
    val pending: List<Pending> = emptyList(),
)

// Holds the live list and the events of the viewed chat; the server streams events for one chat at a time.
class ChatStore(
    private val persist: (String, RecentChats.Entry) -> Unit = { _, _ -> },
    private val restore: (String) -> RecentChats.Entry? = { null },
) {
    val state = MutableStateFlow(StoreState())
    val cache = RecentChats()

    // The chat the user asked for; an init for any other chat is a leftover of an earlier view.
    @Volatile var wanted = ""
        private set

    @Volatile private var switching = false

    // The next init for a chat other than the wanted one is the answer to new_session or open_session.
    fun expectSwitch() { switching = true }
    fun cancelSwitch() { switching = false }

    fun handle(m: ServerMessage) {
        when (m) {
            is ServerMessage.Init -> {
                if (switching && m.chatId != wanted) { wanted = m.chatId; switching = false }
                else if (wanted.isNotEmpty() && m.chatId != wanted) return
                state.update {
                    val page = if (it.settled && it.shownId == m.chatId) mergeTail(it.events, it.earlier, m.events, m.earlier) else m.events to m.earlier
                    it.copy(shownId = m.chatId, events = page.first, earlier = page.second, settled = true, session = m.session, pending = m.pending)
                }
            }
            is ServerMessage.Event -> state.update { s ->
                if (!s.settled) return@update s
                val i = s.events.indexOfLast { it.id == m.event.id }
                s.copy(events = if (i < 0) s.events + m.event else s.events.toMutableList().also { it[i] = m.event })
            }
            is ServerMessage.Append -> state.update { s ->
                if (!s.settled) return@update s
                val i = s.events.indexOfLast { it.id == m.id }
                val ev = if (i < 0) null else appendTo(s.events[i], m.offset, m.text)
                if (ev == null) s else s.copy(events = s.events.toMutableList().also { it[i] = ev })
            }
            is ServerMessage.Live -> {
                cache.retainOnly(m.chats.map { it.id }.toSet())
                state.update { it.copy(live = m.chats) }
            }
            is ServerMessage.Runs -> state.update { it.copy(runs = m.runs) }
            is ServerMessage.SessionUpdate -> state.update { s -> if (s.settled && m.session.id == s.shownId) s.copy(session = merged(s.session, m)) else s }
            is ServerMessage.PendingAdded -> state.update { s -> if (s.settled && s.pending.none { it.id == m.request.id }) s.copy(pending = s.pending + m.request) else s }
            is ServerMessage.Resolved -> state.update { s -> if (s.pending.any { it.id == m.id }) s.copy(pending = s.pending.filter { it.id != m.id }) else s }
            is ServerMessage.Error, is ServerMessage.Findings, is ServerMessage.FileChanged, is ServerMessage.Approval, is ServerMessage.Other -> {}
        }
    }

    // Shows the cached rows of a chat at once, or none; its init replaces them. `fill` adds the rows saved on disk.
    fun show(id: String) {
        wanted = id
        val was = state.getAndUpdate { s ->
            if (id == s.shownId) s
            else cache.get(id).let { hit -> s.copy(shownId = id, events = hit?.events ?: emptyList(), earlier = hit?.earlier ?: 0, settled = false, session = null, pending = emptyList()) }
        }
        if (was.shownId != id) remember(was)
    }

    // The rows saved on disk for a chat just shown, unless rows arrived while they were read.
    suspend fun fill(id: String) {
        if (cache.get(id) != null) return
        val hit = withContext(Dispatchers.IO) { restore(id) } ?: return
        state.update { s -> if (s.shownId == id && !s.settled && s.events.isEmpty()) s.copy(events = hit.events, earlier = hit.earlier) else s }
    }

    // Older rows fetched for `chat`; dropped when the view moved on while they loaded.
    fun prepend(chat: String, older: List<ChatEvent>, earlier: Int) {
        state.update { s ->
            if (s.shownId != chat) return@update s
            val have = s.events.mapTo(HashSet()) { it.id }
            s.copy(events = older.filter { it.id !in have } + s.events, earlier = earlier)
        }
    }

    // Shows an optimistic user row until the server echoes the message.
    fun addLocal(chat: String, e: ChatEvent) {
        state.update { s -> if (s.shownId == chat) s.copy(events = s.events + e) else s }
    }

    fun dropLocal(chat: String, id: String) {
        state.update { s -> if (s.shownId == chat) s.copy(events = s.events.filter { it.id != id }) else s }
    }

    fun close() = remember(state.value)

    private fun remember(s: StoreState) {
        if (s.shownId.isEmpty() || !s.settled) return
        cache.put(s.shownId, s.events, s.earlier)
        cache.get(s.shownId)?.let { persist(s.shownId, it) }
    }

    fun reset() {
        wanted = ""
        switching = false
        cache.clear()
        state.value = StoreState()
    }
}

fun merged(held: SessionInfo?, m: ServerMessage.SessionUpdate): SessionInfo =
    if (held == null) m.session
    else m.session.copy(
        commands = if ("commands" in m.keeps) held.commands else m.session.commands,
        mcp = if ("mcp" in m.keeps) held.mcp else m.session.mcp,
    )

// A tail init for the chat on screen keeps the older events already held before the init's first id.
// They are kept only while the count before that id still adds up; a removed or moved event ahead of it breaks the count and the init alone stands.
fun mergeTail(held: List<ChatEvent>, heldEarlier: Int, tail: List<ChatEvent>, earlier: Int): Pair<List<ChatEvent>, Int> {
    val at = if (tail.isEmpty()) -1 else held.indexOfFirst { it.id == tail[0].id }
    val kept = if (at >= 0 && heldEarlier + at == earlier) held.subList(0, at) else emptyList()
    return (kept + tail) to maxOf(0, earlier - kept.size)
}
