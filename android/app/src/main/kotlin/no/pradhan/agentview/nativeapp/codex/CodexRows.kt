package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.text

const val WORK = "work"
const val PERSONAL = "personal"

// shared/tables.ts: the synced columns of the tables the Codex screens read.
val ITEM_FIELDS = listOf("title", "text", "source", "source_url", "people", "at", "status", "meeting_id", "rolls", "rolled_from", "rank", "draft", "spent", "time_log", "goal", "priority", "tags", "remind", "assignee", "snoozed_until")
val SYNCED_FIELDS = mapOf(
    "items" to ITEM_FIELDS,
    "meetings" to listOf("title", "starts_at", "ends_at", "people", "calendar_url", "recorded_ms", "notes", "summary", "decisions", "transcript", "tries", "room", "room_me", "organizer_me", "others", "links"),
    "chats" to listOf("name", "kind", "url", "summary", "last_at", "waiting"),
    "pages" to listOf("title", "section", "summary", "sort", "state"),
    "facts" to listOf("text", "item_id", "superseded_by", "page_id", "heading", "sources", "at", "contested", "state", "replaces", "added_by"),
    "jobs" to listOf("name", "schedule", "prompt", "enabled", "next_run_at", "tools"),
    "runs" to listOf("job_id", "started_at", "finished_at", "status", "output", "cost"),
    "briefs" to listOf("kind", "text", "rows", "from_at", "to_at"),
)

// A synced row of the hub (web/src/codex/data/sync.ts): the values by column and the time each column was last written.
data class Row(
    val table: String,
    val id: String,
    val profile: String,
    val updatedAt: Long = 0,
    val version: Long = 0,
    val deleted: Boolean = false,
    val times: Map<String, Long> = emptyMap(),
    val f: Map<String, JsonElement> = emptyMap(),
    val dirty: Boolean = false,
) {
    val key get() = "$profile:$id"

    fun str(k: String): String? = (f[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    fun long(k: String): Long? = (f[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { p ->
        p.longOrNull ?: p.content.toDoubleOrNull()?.toLong() ?: runCatching { Instant.parse(p.content).toEpochMilli() }.getOrNull()
    }

    val title get() = str("title")
    val text get() = str("text")
    val source get() = str("source")
    val sourceUrl get() = str("source_url")
    val people get() = str("people")
    val at get() = long("at")
    val status get() = str("status")
    val meetingId get() = str("meeting_id")
    val rank get() = long("rank")
    val draft get() = str("draft")
    val goal get() = str("goal")
    val priority get() = long("priority")?.toInt() ?: 0
    val tags get() = str("tags")
    val remind get() = long("remind")?.toInt()
    val snoozedUntil get() = long("snoozed_until")
    val rolls get() = long("rolls")
    val startsAt get() = long("starts_at")
    val endsAt get() = long("ends_at")
    val statusTime get() = times["status"] ?: updatedAt
    val madeAt get() = times["source"] ?: updatedAt
}

fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    else -> JsonPrimitive(v.toString())
}

private fun timesOf(o: JsonElement?): Map<String, Long> =
    (o as? JsonObject)?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.longOrNull?.let { k to it } }?.toMap() ?: emptyMap()

fun parseRow(c: JsonObject): Row? {
    val table = c["table"]?.jsonPrimitive?.contentOrNull ?: return null
    val fields = SYNCED_FIELDS[table] ?: return null
    val profile = c["profile"]?.jsonPrimitive?.contentOrNull?.takeIf { it == WORK || it == PERSONAL } ?: return null
    val id = c["id"]?.jsonPrimitive?.contentOrNull ?: return null
    val values = c["fields"] as? JsonObject
    return Row(
        table, id, profile,
        updatedAt = c["updated_at"]?.jsonPrimitive?.longOrNull ?: 0,
        version = c["version"]?.jsonPrimitive?.longOrNull ?: 0,
        deleted = (c["deleted"] as? JsonPrimitive)?.content == "true",
        times = timesOf(c["field_times"]),
        f = fields.associateWith { values?.get(it) ?: JsonNull },
    )
}

// web/src/codex/data/sync.ts mergeIncoming: each column keeps the newer write; a tie takes the hub's value.
fun mergeIncoming(local: Row?, inc: Row): Row {
    val fields = SYNCED_FIELDS.getValue(inc.table)
    val times = (local?.times ?: emptyMap()).toMutableMap()
    val merged = HashMap<String, JsonElement>()
    var localNewer = false
    for (k in fields) {
        val it = inc.times[k] ?: if (local?.times?.get(k) != null) 0L else inc.updatedAt
        val lt = local?.times?.get(k) ?: 0L
        if (local == null || it > lt || (it == lt && inc.times.containsKey(k))) {
            merged[k] = inc.f[k] ?: JsonNull
            times[k] = it
        } else {
            merged[k] = local.f[k] ?: JsonNull
            if (lt > it) localNewer = true
        }
    }
    val idt = inc.times["deleted"] ?: 0L
    val ldt = local?.times?.get("deleted") ?: 0L
    val deleted = if (local == null || idt > ldt || (idt == ldt && inc.times.containsKey("deleted"))) {
        if (idt != 0L) times["deleted"] = idt
        inc.deleted
    } else {
        if (ldt > idt) localNewer = true
        local.deleted
    }
    return Row(inc.table, inc.id, inc.profile, maxOf(local?.updatedAt ?: 0, inc.updatedAt), inc.version, deleted, times, merged, local?.dirty == true || localNewer)
}

// web/src/codex/data/engine.ts edited: an edit always outdates the value it replaces, even when this clock is behind.
fun edited(row: Row, patch: Map<String, Any?>, now: Long): Row {
    val times = row.times.toMutableMap()
    val f = row.f.toMutableMap()
    var deleted = row.deleted
    for ((k, v) in patch) {
        times[k] = maxOf(now, (times[k] ?: 0L) + 1)
        if (k == "deleted") deleted = v == 1 || v == true else f[k] = toJson(v)
    }
    return row.copy(f = f, times = times, deleted = deleted, updatedAt = maxOf(row.updatedAt, now), dirty = true)
}

fun splitTitle(text: String): Pair<String, String?> {
    val first = text.substringBefore('\n')
    val rest = text.substringAfter('\n', "")
    if (first.length <= 120) return first to rest.trim().ifEmpty { null }
    val space = first.lastIndexOf(' ', 120)
    val cut = if (space > 0) space else 120
    return first.substring(0, cut) to (first.substring(cut).trim() + "\n" + rest).trim().ifEmpty { null }
}

// A new task, note or goal; extra columns are timed with the rest.
fun newCapture(text: String, status: String, profile: String, now: Long, at: Long? = null, extra: Map<String, Any?> = emptyMap(), id: String = UUID.randomUUID().toString()): Row {
    val (title, body) = splitTitle(text)
    val values = mutableMapOf<String, Any?>("title" to title, "text" to body, "source" to if (status == "goal") "goal" else "capture", "status" to status)
    if (at != null) values["at"] = at
    values.putAll(extra)
    val blank = Row("items", id, profile, updatedAt = now, f = ITEM_FIELDS.associateWith { JsonNull })
    return edited(blank, values, now).let { r -> r.copy(times = r.times.mapValues { now }) }
}

// web/src/codex/data/sync.ts rowToChange: only the columns that have a time go to the hub.
fun rowToChange(row: Row): JsonObject {
    val fields = SYNCED_FIELDS.getValue(row.table).filter { row.times.containsKey(it) }
    val deletedAt = row.times["deleted"]
    return buildJsonObject {
        put("table", row.table)
        put("id", row.id)
        put("profile", row.profile)
        put("updated_at", deletedAt ?: row.updatedAt)
        put("fields", JsonObject(fields.associateWith { row.f[it] ?: JsonNull }))
        put("field_times", JsonObject(fields.associateWith { JsonPrimitive(row.times.getValue(it)) }))
        if (deletedAt != null) put("deleted", row.deleted)
    }
}

// The item under the other profile keeps its id; every column is timed now so it replaces a row moved away earlier.
fun moved(row: Row, there: Row?, profile: String, now: Long): Row {
    val base = there ?: row.copy(profile = profile, version = 0, times = emptyMap(), deleted = false)
    val values = ITEM_FIELDS.associateWith { row.f[it] } + ("goal" to null) + ("deleted" to false)
    return edited(base, values, now)
}
