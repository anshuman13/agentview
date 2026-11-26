package no.pradhan.agentview.nativeapp.codex

import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.plural

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
    val scans: List<SyncScan> = emptyList(),
    val paused: List<SyncPaused> = emptyList(),
    val reconnecting: Boolean = false,
    val lastSync: Long = 0,
)

// When the shown data last synced (shared/syncText.ts): the time today, "yesterday", the weekday within a week, else the date.
fun syncedAt(last: Long, now: Long): String {
    if (last == 0L) return "Never synced"
    val days = -daysFrom(last, now)
    val at = when {
        days == 0L -> clock(last)
        days == 1L -> "yesterday ${clock(last)}"
        days < 7 -> "${DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH).format(Instant.ofEpochMilli(last).atZone(codexZone))} ${clock(last)}"
        else -> dayLabel(last)
    }
    return "Last synced $at"
}

// The sync status line Settings shows (web codex/nav.tsx syncLine).
fun syncLine(st: CodexState, now: Long): String {
    val waiting = if (st.pending > 0) " · ${plural(st.pending, "change")} waiting" else ""
    val base = when {
        st.reconnecting -> "Reconnecting to the hub…"
        !st.error.isNullOrEmpty() -> "Sync failed: ${st.error}"
        st.lastSync > 0 -> "Synced ${agoShort(st.lastSync, now, " ago")}"
        else -> "Not synced yet"
    }
    return base + waiting
}

private const val PARK_AFTER = 3

// A row is parked after its third reject under one key; editing it gives it a new key (web engine.ts rejectKey).
private fun rejectKey(r: Row) = "${r.table}|${r.profile}|${r.id}|${r.updatedAt}|${r.times}"

private fun parkedNotice(count: Int) = if (count == 1) "1 change not synced, edit it to retry" else "$count changes not synced, edit them to retry"

private val RETRY_AFTER_MS = listOf(2_000L, 5_000L, 15_000L)

// The wait before the next retry of a sync that failed because the hub could not be reached, null when the error shows (web hubRetry).
fun hubRetry(failures: Int, error: Throwable): Long? {
    val status = (error as? ApiError)?.code ?: if (error is IOException) 0 else return null
    return if (status in listOf(0, 502, 503, 504)) RETRY_AFTER_MS.getOrNull(failures) else null
}

private fun syncErrorText(error: Throwable) =
    if (error is IOException || (error as? ApiError)?.code in listOf(502, 503, 504)) "Can't reach the hub" else error.message ?: "Sync failed"

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
    // The id of the hub the rows came from; a reply from another hub starts over with a full pull.
    private var hub: String? = null
    private var scans = emptyList<SyncScan>()
    private var paused = emptyList<SyncPaused>()
    private var timer: Job? = null
    private val rejects = HashMap<String, Int>()
    // The rows of each table as last written to the cache, so a save rewrites only the tables that changed.
    private val saved = HashMap<String, List<Row>>()

    // Another server of the same hub: the next pull is full, and unsent edits stay to be pushed.
    fun reset() = scope.launch {
        lock.withLock {
            tables.values.forEach { t -> t.values.removeAll { !it.dirty } }
            since = 0
            clearCache()
            state.value = CodexState()
            publish()
        }
    }

    // Shows the rows of the last sync at once; the next pull then fetches only what changed since.
    suspend fun restore() = lock.withLock { load() }

    // The cache is a small file with the version and columns, and one file of rows per table next to it.
    private fun tableFile(file: File, table: String) = File("${file.path}.$table")

    private fun clearCache() {
        val file = cache ?: return
        file.delete()
        tables.keys.forEach { tableFile(file, it).delete() }
        saved.clear()
    }

    private suspend fun load() {
        val file = cache ?: return
        val head = withContext(Dispatchers.IO) { file.takeIf { it.exists() }?.readText() } ?: return
        try {
            val bodies = withContext(Dispatchers.IO) { tables.keys.associateWith { tableFile(file, it).readText() } }
            val (meta, rows) = withContext(parsing) {
                protocolJson.parseToJsonElement(head).jsonObject to bodies.mapValues { (_, b) -> protocolJson.parseToJsonElement(b).jsonArray.map { parseRow(it.jsonObject) } }
            }
            val version = meta["version"]?.jsonPrimitive?.content?.toLongOrNull() ?: error("Unexpected cache")
            if (since != 0L || state.value.loaded) return
            apply(rows.values.flatten())
            saved.putAll(tables.mapValues { it.value.values.toList() })
            // A cache from a build with other columns lacks the new ones, so the next pull is full.
            if (meta["columns"]?.jsonPrimitive?.contentOrNull == COLUMNS) since = version
            hub = meta["hub"]?.jsonPrimitive?.contentOrNull
            publish(loaded = true, lastSync = meta["synced"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0)
        } catch (e: Exception) {
            clearCache()
        }
    }

    private fun parked(r: Row) = (rejects[rejectKey(r)] ?: 0) >= PARK_AFTER

    // Nothing is stored while a row has an edit still to send, so the copy never holds that edit as synced. A parked row is
    // not waiting to be sent, so it is stored as it is: its edit stays visible after a restart.
    private suspend fun save() {
        val file = cache ?: return
        val rows = tables.mapValues { it.value.values.toList() }
        if (rows.values.any { l -> l.any { it.dirty && !parked(it) } }) return
        // Rows are immutable, so a table whose rows are the same objects as last time is unchanged.
        val changed = rows.filter { (t, l) -> saved[t]?.let { s -> s.size == l.size && s.indices.all { s[it] === l[it] } } != true }
        val head = buildJsonObject { put("version", since); put("columns", COLUMNS); put("hub", hub); put("synced", state.value.lastSync) }.toString()
        val bodies = withContext(parsing) { changed.mapValues { (_, l) -> JsonArray(l.map(::rowToCache)).toString() } }
        withContext(Dispatchers.IO) {
            runCatching {
                fun write(to: File, body: String) = File(to.path + ".tmp").let { it.writeText(body); it.renameTo(to) }
                for ((t, body) in bodies) write(tableFile(file, t), body)
                write(file, head)
                saved.putAll(changed)
            }
        }
    }

    private fun publish(error: String? = state.value.error, loaded: Boolean = state.value.loaded, reconnecting: Boolean = state.value.reconnecting, lastSync: Long = state.value.lastSync) {
        fun rows(t: String) = tables.getValue(t).values.toList()
        state.value = CodexState(
            rows("items"), rows("meetings"), rows("chats"), rows("pages"), rows("facts"), rows("jobs"), rows("runs"), rows("briefs"),
            loaded, error, tables.values.sumOf { t -> t.values.count { it.dirty } }, scans, paused, reconnecting, lastSync,
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

    private data class Page(val version: Long, val changes: List<Row?>, val hasMore: Boolean, val refused: List<JsonObject>, val scans: List<SyncScan>?, val paused: List<SyncPaused>?, val hub: String?)

    private suspend fun parse(body: String): Page = withContext(parsing) {
        val reply = protocolJson.parseToJsonElement(body).jsonObject
        val version = reply["version"]?.jsonPrimitive?.content?.toLongOrNull() ?: error("Unexpected hub response")
        val changes = reply["changes"]?.jsonArray?.map { parseRow(it.jsonObject) } ?: error("Unexpected hub response")
        Page(version, changes, (reply["hasMore"] as? JsonPrimitive)?.content == "true", (reply["rejected"] as? JsonArray)?.map { it.jsonObject } ?: emptyList(),
            reply["scans"]?.let { runCatching { protocolJson.decodeFromJsonElement(ListSerializer(SyncScan.serializer()), it) }.getOrNull() },
            reply["paused"]?.let { runCatching { protocolJson.decodeFromJsonElement(ListSerializer(SyncPaused.serializer()), it) }.getOrNull() },
            (reply["hub"] as? JsonPrimitive)?.contentOrNull)
    }

    // A sync that cannot reach the hub waits here between retries, outside the lock, so the 30 s timer, an edit's sync or
    // a manual sync wakes it instead of starting another.
    private var retryWait: CompletableDeferred<Unit>? = null
    // One sync owns the retry loop; a sync that starts meanwhile asks it to go round once more and returns.
    private var syncing = false
    private var again = false

    suspend fun sync() {
        if (syncing) {
            again = true
            retryWait?.complete(Unit)
            return
        }
        syncing = true
        try {
            var failures = 0
            while (true) {
                again = false
                val error = attempt()
                if (error == null) {
                    if (again) { failures = 0; continue }
                    return
                }
                val wait = hubRetry(failures++, error)
                if (wait == null) return publish(error = syncErrorText(error), loaded = true, reconnecting = false)
                publish(reconnecting = true)
                if (again) continue
                val woken = CompletableDeferred<Unit>().also { retryWait = it }
                withTimeoutOrNull(wait) { woken.await() }
                retryWait = null
            }
        } finally {
            syncing = false
            retryWait = null
            if (state.value.reconnecting) publish(reconnecting = false)
        }
    }

    private suspend fun attempt(): Exception? = lock.withLock {
        try {
            var queue = tables.values.flatMap { t -> t.values.filter { it.dirty && !parked(it) } }
            val parked = mutableListOf<Row>()
            val rejected = mutableListOf<JsonObject>()
            var more = true
            while (more) {
                val batch = queue.take(PUSH_BATCH)
                queue = queue.drop(batch.size)
                val body = if (batch.isEmpty() && queue.isEmpty()) pull(since, since == 0L) else push(pushBody(batch))
                val (version, changes, hasMore, refused, health, held, from) = parse(body)
                if (health != null) scans = health
                if (held != null) paused = held
                for (r in refused) {
                    val sent = batch.find { it.table == r["table"]?.jsonPrimitive?.contentOrNull && it.id == r["id"]?.jsonPrimitive?.contentOrNull }
                    val count = if (sent == null) 0 else (rejects[rejectKey(sent)] ?: 0) + 1
                    if (sent != null) rejects[rejectKey(sent)] = count
                    if (sent != null && count >= PARK_AFTER) parked.add(sent) else rejected.add(r)
                }
                for (sent in batch) {
                    if (refused.any { it["table"]?.jsonPrimitive?.contentOrNull == sent.table && it["id"]?.jsonPrimitive?.contentOrNull == sent.id }) continue
                    rejects.remove(rejectKey(sent))
                    val map = tables.getValue(sent.table)
                    val cur = map[sent.key]
                    if (cur != null && cur.updatedAt == sent.updatedAt && cur.times == sent.times) map[sent.key] = cur.copy(dirty = false)
                }
                if (queue.isNotEmpty()) continue
                if (from != null && from != hub) {
                    val known = hub != null
                    hub = from
                    // Another hub answered with changes since a version of the old one, so pull this one again in full.
                    if (known && since != 0L) { since = 0; continue }
                }
                // A full pull, or a hub behind the cached version (another hub, or this one restored), sends all the hub's
                // rows, so the cached ones it lacks are dropped (unsent edits stay).
                if (since == 0L || version < since) {
                    tables.values.forEach { t -> t.values.removeAll { !it.dirty } }
                    saved.clear()
                }
                apply(changes)
                more = hasMore && version != since
                since = version
            }
            if (parked.isNotEmpty()) notify(parkedNotice(parked.size))
            publish(lastSync = System.currentTimeMillis())
            save()
            if (rejected.isNotEmpty()) error("${rejected.size} change${if (rejected.size > 1) "s" else ""} rejected: ${rejected[0]["reason"]?.jsonPrimitive?.contentOrNull}")
            publish(error = null, loaded = true, reconnecting = false)
            null
        } catch (e: Exception) {
            e
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
