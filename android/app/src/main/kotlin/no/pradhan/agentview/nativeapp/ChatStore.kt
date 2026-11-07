package no.pradhan.agentview.nativeapp

import kotlinx.coroutines.flow.MutableStateFlow

const val ROW_WINDOW = 150
const val CACHED_CHATS = 8

// The last rows of the most recently viewed chats (web/src/app/store.ts cache).
class RecentChats(private val size: Int = CACHED_CHATS) {
    data class Entry(val events: List<ChatEvent>, val earlier: Int)

    private val map = LinkedHashMap<String, Entry>()
    val ids: List<String> get() = map.keys.toList()

    fun put(id: String, events: List<ChatEvent>, earlier: Int) {
        if (events.isEmpty()) return
        val kept = events.takeLast(ROW_WINDOW)
        map.remove(id)
        map[id] = Entry(kept, earlier + events.size - kept.size)
        while (map.size > size) map.remove(map.keys.first())
    }

    fun get(id: String) = map[id]
    fun retainOnly(live: Set<String>) { map.keys.retainAll(live) }
    fun clear() = map.clear()
}

data class StoreState(
    val live: List<LiveChat> = emptyList(),
    val shownId: String = "",
    val events: List<ChatEvent> = emptyList(),
    val earlier: Int = 0,
    val settled: Boolean = false,
)

// Holds the live list and the events of the viewed chat; the server streams events for one chat at a time.
class ChatStore {
    val state = MutableStateFlow(StoreState())
    val cache = RecentChats()

    // The chat the user asked for; an init for any other chat is a leftover of an earlier view.
    var wanted = ""
        private set

    fun handle(m: ServerMessage) {
        val s = state.value
        when (m) {
            is ServerMessage.Init -> {
                if (wanted.isNotEmpty() && m.chatId != wanted) return
                state.value = s.copy(shownId = m.chatId, events = m.events, earlier = m.earlier, settled = true)
            }
            is ServerMessage.Event -> {
                if (!s.settled) return
                val i = s.events.indexOfLast { it.id == m.event.id }
                state.value = s.copy(events = if (i < 0) s.events + m.event else s.events.toMutableList().also { it[i] = m.event })
            }
            is ServerMessage.Append -> {
                if (!s.settled) return
                val i = s.events.indexOfLast { it.id == m.id }
                val ev = if (i < 0) null else appendTo(s.events[i], m.offset, m.text)
                if (ev != null) state.value = s.copy(events = s.events.toMutableList().also { it[i] = ev })
            }
            is ServerMessage.Live -> {
                cache.retainOnly(m.chats.map { it.id }.toSet())
                state.value = s.copy(live = m.chats)
            }
            is ServerMessage.Other -> {}
        }
    }

    // Shows the cached rows of a chat at once; its init replaces them.
    fun show(id: String) {
        wanted = id
        val s = state.value
        if (id == s.shownId) return
        if (s.shownId.isNotEmpty() && s.settled) cache.put(s.shownId, s.events, s.earlier)
        val hit = cache.get(id)
        state.value = s.copy(shownId = id, events = hit?.events ?: emptyList(), earlier = hit?.earlier ?: 0, settled = false)
    }

    fun close() {
        val s = state.value
        if (s.shownId.isNotEmpty() && s.settled) cache.put(s.shownId, s.events, s.earlier)
    }

    fun reset() {
        wanted = ""
        cache.clear()
        state.value = StoreState()
    }
}
