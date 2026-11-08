package no.pradhan.agentview.nativeapp

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import java.io.File

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

@Serializable
data class Queued(val id: String, val chat: String, val text: String, val steer: Boolean = false, val at: Long = 0)

// Prompts typed while the socket was down, kept on disk and sent in order once it is back.
class Outbox(private val kv: KeyValue) {
    private val serializer = ListSerializer(Queued.serializer())
    val items = MutableStateFlow(runCatching { protocolJson.decodeFromString(serializer, kv.get("outbox") ?: "[]") }.getOrDefault(emptyList()))
    private val lock = Mutex()

    private fun save() = kv.put("outbox", protocolJson.encodeToString(serializer, items.value))

    fun forChat(chat: String) = items.value.filter { it.chat == chat }

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

    // Sends the oldest first and stops at the first that fails, which stays queued.
    suspend fun flush(send: suspend (Queued) -> Boolean) = lock.withLock {
        while (true) {
            val next = items.value.firstOrNull() ?: break
            if (!send(next)) break
            cancel(next.id)
        }
    }
}

@Serializable
data class SavedChat(val id: String, val title: String = "", val earlier: Int = 0, val events: List<ChatEvent> = emptyList())

// The rows of the last viewed chats as files, so a chat opens without the server.
class TranscriptDisk(private val dir: File, private val keep: Int = CACHED_CHATS, private val maxBytes: Int = MAX_CHAT_BYTES) {
    private var stamp = 0L

    private fun file(id: String) = File(dir, id.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(80).ifEmpty { "chat" } + ".json")

    fun save(id: String, title: String, entry: RecentChats.Entry) {
        if (entry.events.isEmpty()) return
        var events = entry.events
        var earlier = entry.earlier
        var json = encode(SavedChat(id, title, earlier, events))
        while (json.length > maxBytes && events.size > 1) {
            val drop = maxOf(1, events.size / 5)
            events = events.drop(drop)
            earlier += drop
            json = encode(SavedChat(id, title, earlier, events))
        }
        if (json.length > maxBytes) return
        dir.mkdirs()
        val f = file(id)
        f.writeText(json)
        stamp = maxOf(System.currentTimeMillis(), stamp + 1)
        f.setLastModified(stamp)
        (dir.listFiles() ?: emptyArray()).sortedByDescending { it.lastModified() }.drop(keep).forEach { it.delete() }
    }

    fun load(id: String): SavedChat? = runCatching {
        protocolJson.decodeFromString(SavedChat.serializer(), file(id).readText()).takeIf { it.id == id }
    }.getOrNull()

    fun list(): List<SavedChat> = (dir.listFiles() ?: emptyArray()).sortedByDescending { it.lastModified() }.mapNotNull { f ->
        runCatching { protocolJson.decodeFromString(SavedChat.serializer(), f.readText()) }.getOrNull()
    }

    fun remove(id: String) { file(id).delete() }

    private fun encode(c: SavedChat) = protocolJson.encodeToString(SavedChat.serializer(), c)
}
