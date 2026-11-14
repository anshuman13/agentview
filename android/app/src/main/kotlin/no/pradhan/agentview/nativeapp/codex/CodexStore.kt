package no.pradhan.agentview.nativeapp.codex

import java.io.File
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.net.protocolJson

const val SYNC_DELAY_MS = 400L
const val PUSH_BATCH = 100
const val READ_ONLY_NOTICE = "Read-only check, nothing was saved"

data class CodexState(
    val items: List<Row> = emptyList(),
    val meetings: List<Row> = emptyList(),
    val chats: List<Row> = emptyList(),
    val pages: List<Row> = emptyList(),
    val facts: List<Row> = emptyList(),
    val jobs: List<Row> = emptyList(),
    val runs: List<Row> = emptyList(),
    val briefs: List<Row> = emptyList(),
    val loaded: Boolean = false,
    val error: String? = null,
    val pending: Int = 0,
)

// The hub's items, meetings and chats (web/src/codex/data/remote.ts RemoteStore without the on-device cache): pulled over
// /api/assistant/changes, edited here with per-column times and pushed over /api/assistant/sync.
private const val DONE_KEEP_MS = 60 * 86_400_000L
private val DONE_STATES = setOf("done", "raised")
// The synced columns, so a cache written with other columns is pulled again in full.
private val COLUMNS = SYNCED_FIELDS.entries.joinToString(";") { (t, f) -> "$t:${f.joinToString(",")}" }

class CodexStore(
    private val scope: CoroutineScope,
    private val pull: suspend (since: Long, full: Boolean) -> String,
    private val push: suspend (body: String) -> String,
    private val canWrite: () -> Boolean,
    private val notify: (String) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
    private val parsing: CoroutineContext = Dispatchers.Default,
    private val cache: File? = null,
) {
    val state = MutableStateFlow(CodexState())
    private val tables = SYNCED_FIELDS.keys.associateWith { LinkedHashMap<String, Row>() }
    private val lock = Mutex()
    private var since = 0L
    private var timer: Job? = null

    // Another server of the same hub: the next pull is full, and unsent edits stay to be pushed.
    fun reset() = scope.launch {
        lock.withLock {
            tables.values.forEach { t -> t.values.removeAll { !it.dirty } }
            since = 0
            cache?.delete()
            state.value = CodexState()
            publish()
        }
    }

    // Shows the rows of the last sync at once; the next pull then fetches only what changed since.
    suspend fun restore() = lock.withLock { load() }

    private suspend fun load() {
        val body = withContext(Dispatchers.IO) { cache?.takeIf { it.exists() }?.readText() } ?: return
        try {
            val (version, changes) = parse(body)
            if (since != 0L || state.value.loaded) return
            apply(changes)
            // A cache from a build with other columns lacks the new ones, so the next pull is full.
            if (protocolJson.parseToJsonElement(body).jsonObject["columns"]?.jsonPrimitive?.contentOrNull == COLUMNS) since = version
            publish(loaded = true)
        } catch (e: Exception) {
            cache?.delete()
        }
    }

    // Rows with an unsent edit are not stored, so the copy never holds an edit as synced.
    private suspend fun save() {
        val file = cache ?: return
        val rows = tables.values.flatMap { it.values }
        if (rows.any { it.dirty }) return
        val version = since
        // The rows are an immutable copy, so the JSON is built off the main thread.
        val body = withContext(parsing) {
            buildJsonObject {
                put("version", version)
                put("columns", COLUMNS)
                put("changes", JsonArray(rows.map(::rowToCache)))
            }.toString()
        }
        withContext(Dispatchers.IO) {
            runCatching {
                val tmp = File(file.path + ".tmp")
                tmp.writeText(body)
                tmp.renameTo(file)
            }
        }
    }

    private fun publish(error: String? = state.value.error, loaded: Boolean = state.value.loaded) {
        fun rows(t: String) = tables.getValue(t).values.toList()
        state.value = CodexState(
            rows("items"), rows("meetings"), rows("chats"), rows("pages"), rows("facts"), rows("jobs"), rows("runs"), rows("briefs"),
            loaded, error, tables.values.sumOf { t -> t.values.count { it.dirty } },
        )
    }

    private fun apply(changes: List<Row?>) {
        for (inc in changes) {
            if (inc == null) continue
            val map = tables.getValue(inc.table)
            map[inc.key] = mergeIncoming(map[inc.key], inc)
        }
        prune()
    }

    // Synced tombstones and items done over 60 days ago are not kept (web RemoteStore.prune).
    private fun prune() {
        val cutoff = now() - DONE_KEEP_MS
        for ((table, map) in tables) map.values.removeAll { r ->
            !r.dirty && ((r.deleted && r.version > 0) || (table == "items" && r.str("status") in DONE_STATES && r.updatedAt <= cutoff))
        }
    }

    private data class Page(val version: Long, val changes: List<Row?>, val hasMore: Boolean, val refused: List<JsonObject>)

    private suspend fun parse(body: String): Page = withContext(parsing) {
        val reply = protocolJson.parseToJsonElement(body).jsonObject
        val version = reply["version"]?.jsonPrimitive?.content?.toLongOrNull() ?: error("Unexpected hub response")
        val changes = reply["changes"]?.jsonArray?.map { parseRow(it.jsonObject) } ?: error("Unexpected hub response")
        Page(version, changes, (reply["hasMore"] as? JsonPrimitive)?.content == "true", (reply["rejected"] as? JsonArray)?.map { it.jsonObject } ?: emptyList())
    }

    suspend fun sync() = lock.withLock {
        try {
            val dirty = tables.values.flatMap { t -> t.values.filter { it.dirty } }
            var queue = dirty
            var more = true
            var changed = false
            while (more) {
                val batch = queue.take(PUSH_BATCH)
                queue = queue.drop(batch.size)
                val body = if (batch.isEmpty() && queue.isEmpty()) pull(since, since == 0L) else push(pushBody(batch))
                val (version, changes, hasMore, refused) = parse(body)
                changed = changed || batch.isNotEmpty() || changes.isNotEmpty()
                for (sent in batch) {
                    if (refused.any { it["id"]?.jsonPrimitive?.contentOrNull == sent.id }) continue
                    val map = tables.getValue(sent.table)
                    val cur = map[sent.key]
                    if (cur != null && cur.updatedAt == sent.updatedAt && cur.times == sent.times) map[sent.key] = cur.copy(dirty = false)
                }
                if (queue.isNotEmpty()) continue
                apply(changes)
                more = hasMore && version != since
                since = version
                if (refused.isNotEmpty()) error("${refused.size} change${if (refused.size > 1) "s" else ""} rejected: ${refused[0]["reason"]?.jsonPrimitive?.contentOrNull}")
            }
            if (changed) save()
            publish(error = null, loaded = true)
        } catch (e: Exception) {
            publish(error = e.message ?: "Sync failed", loaded = true)
        }
    }

    private fun pushBody(batch: List<Row>) = JsonObject(mapOf(
        "since" to JsonPrimitive(since),
        "changes" to JsonArray(batch.map(::rowToChange)),
        "full" to JsonPrimitive(since == 0L),
    )).toString()

    private fun syncSoon() {
        timer?.cancel()
        timer = scope.launch { delay(SYNC_DELAY_MS); sync() }
    }

    private fun writable(): Boolean {
        if (canWrite()) return true
        notify(READ_ONLY_NOTICE)
        return false
    }

    fun current(row: Row): Row = tables.getValue(row.table)[row.key] ?: row

    fun update(row: Row, patch: Map<String, Any?>): Boolean {
        if (!writable()) return false
        val next = edited(current(row), patch, now())
        tables.getValue(row.table)[row.key] = next
        publish()
        syncSoon()
        return true
    }

    fun capture(text: String, status: String, profile: String, at: Long? = null, extra: Map<String, Any?> = emptyMap()): Row? {
        if (!writable()) return null
        val row = newCapture(text, status, profile, now(), at, extra)
        tables.getValue("items")[row.key] = row
        publish()
        syncSoon()
        return row
    }

    fun add(row: Row): Boolean {
        if (!writable()) return false
        tables.getValue(row.table)[row.key] = row
        publish()
        syncSoon()
        return true
    }

    fun move(row: Row, to: String, goal: String? = null): Boolean {
        if (!writable()) return false
        val t = now()
        val items = tables.getValue("items")
        val cur = current(row)
        val there = items["$to:${row.id}"]
        val copy = moved(cur, there, to, t, goal)
        items[copy.key] = copy
        items[cur.key] = edited(cur, mapOf("deleted" to true), t)
        publish()
        syncSoon()
        return true
    }
}
