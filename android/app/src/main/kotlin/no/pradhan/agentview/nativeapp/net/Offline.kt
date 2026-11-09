package no.pradhan.agentview.nativeapp.net

import android.content.SharedPreferences
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.CACHED_CHATS
import no.pradhan.agentview.nativeapp.chat.RecentChats
import no.pradhan.agentview.nativeapp.sessions.items

const val MAX_DRAFTS = 30
const val MAX_CHAT_BYTES = 200_000
const val MAX_OUTBOX = 50

interface KeyValue {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

class PrefsKeyValue(private val prefs: SharedPreferences) : KeyValue {
    override fun get(key: String) = prefs.getString(key, null)
    override fun put(key: String, value: String?) { prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply() }
}

// Unsent composer text per chat, kept across restarts; the oldest drafts go first.
class Drafts(private val kv: KeyValue) {
    private val serializer = MapSerializer(String.serializer(), String.serializer())
    private val map = LinkedHashMap<String, String>(runCatching { protocolJson.decodeFromString(serializer, kv.get("drafts") ?: "{}") }.getOrDefault(emptyMap()))

    fun get(chat: String) = map[chat] ?: ""

    fun set(chat: String, text: String) {
        map.remove(chat)
        if (text.isNotEmpty()) map[chat] = text
        while (map.size > MAX_DRAFTS) map.remove(map.keys.first())
        kv.put("drafts", protocolJson.encodeToString(serializer, map))
    }
}

// What a Sessions row shows of an unsent draft, like Slack's "Draft:" in the sidebar.
fun draftSnippet(text: String, max: Int = 40): String? {
    val line = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: return null
    return if (line.length > max) line.take(max - 1).trimEnd() + "…" else line
}

@Serializable
data class Queued(val id: String, val chat: String, val text: String, val steer: Boolean = false, val at: Long = 0)

// Prompts typed while the socket was down, kept on disk and sent in order once it is back.
class Outbox(private val kv: KeyValue) {
    private val serializer = ListSerializer(Queued.serializer())
    val items = MutableStateFlow(runCatching { protocolJson.decodeFromString(serializer, kv.get("outbox") ?: "[]") }.getOrDefault(emptyList()))
    private val lock = Mutex()

    private fun save() = kv.put("outbox", protocolJson.encodeToString(serializer, items.value))

    fun add(q: Queued): Boolean {
        if (items.value.size >= MAX_OUTBOX) return false
        items.value = items.value + q
        save()
        return true
    }

    fun cancel(id: String) {
        items.value = items.value.filter { it.id != id }
        save()
    }

    // Sends the oldest first and stops at the first that fails, which stays queued; returns that error.
    suspend fun flush(send: suspend (Queued) -> String?): String? = lock.withLock {
        while (true) {
            val next = items.value.firstOrNull() ?: break
            val err = send(next)
            if (err != null) return@withLock err
            cancel(next.id)
        }
        null
    }
}

// Titles of the saved chats, newest last, so lists and headers do not read the transcript files.
class ChatTitles(private val kv: KeyValue, private val keep: Int = CACHED_CHATS) {
    private val serializer = MapSerializer(String.serializer(), String.serializer())
    private val map = LinkedHashMap<String, String>(runCatching { protocolJson.decodeFromString(serializer, kv.get("chatTitles") ?: "{}") }.getOrDefault(emptyMap()))

    @Synchronized fun get(id: String) = map[id] ?: ""

    @Synchronized fun set(id: String, title: String) {
        map.remove(id)
        map[id] = title
        while (map.size > keep) map.remove(map.keys.first())
        kv.put("chatTitles", protocolJson.encodeToString(serializer, map))
    }

    @Synchronized fun list(): List<Pair<String, String>> = map.entries.reversed().map { it.key to it.value }
}

@Serializable
data class SavedChat(val id: String, val title: String = "", val earlier: Int = 0, val events: List<ChatEvent> = emptyList())

// The rows of the last viewed chats as files, so a chat opens without the server.
class TranscriptDisk(private val dir: File, private val keep: Int = CACHED_CHATS, private val maxBytes: Int = MAX_CHAT_BYTES) {
    private var stamp = 0L

    private fun file(id: String) = File(dir, id.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(80).ifEmpty { "chat" } + ".json")

    fun save(id: String, title: String, entry: RecentChats.Entry): Boolean {
        if (entry.events.isEmpty()) return false
        var events = entry.events
        var earlier = entry.earlier
        var json = encode(SavedChat(id, title, earlier, events))
        while (json.length > maxBytes && events.size > 1) {
            val drop = maxOf(1, events.size / 5)
            events = events.drop(drop)
            earlier += drop
            json = encode(SavedChat(id, title, earlier, events))
        }
        if (json.length > maxBytes) return false
        dir.mkdirs()
        val f = file(id)
        f.writeText(json)
        stamp = maxOf(System.currentTimeMillis(), stamp + 1)
        f.setLastModified(stamp)
        (dir.listFiles() ?: emptyArray()).sortedByDescending { it.lastModified() }.drop(keep).forEach { it.delete() }
        return true
    }

    fun load(id: String): SavedChat? = runCatching {
        protocolJson.decodeFromString(SavedChat.serializer(), file(id).readText()).takeIf { it.id == id }
    }.getOrNull()

    private fun encode(c: SavedChat) = protocolJson.encodeToString(SavedChat.serializer(), c)
}
