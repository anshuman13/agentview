package no.pradhan.agentview.nativeapp.codex

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import no.pradhan.agentview.nativeapp.net.protocolJson

// web/src/codex/data/tasks/timeLog.ts: a task's focus sessions; shared/fixtures/time-log.json holds the cases.
class Session(val id: String, val at: Long, val min: Long, val json: JsonObject)

private fun num(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }

// Anything that is not a list of sessions reads as empty.
fun parseLog(raw: String?): List<Session> = runCatching {
    val list = protocolJson.parseToJsonElement(raw ?: "[]") as? JsonArray ?: return emptyList()
    list.mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val at = num(o, "at")
        val min = num(o, "min")
        if (id != null && at != null && min != null && min > 0) Session(id, at.toLong(), min.toLong(), o) else null
    }
}.getOrDefault(emptyList())

// The patch that drops a session and takes its minutes off spent, not below 0.
fun removeSession(raw: String?, spent: Long?, id: String): Map<String, Any?> {
    val list = parseLog(raw)
    val gone = list.firstOrNull { it.id == id }
    val left = list.filter { it.id != id }
    val total = maxOf(0L, (spent ?: 0L) - (gone?.min ?: 0L))
    return mapOf("time_log" to if (left.isEmpty()) null else JsonArray(left.map { it.json }).toString(), "spent" to total.takeIf { it > 0 })
}

// web/src/codex/data/history.ts: when the status, due date and assignee last changed, newest first.
class HistoryEntry(val field: String, val title: String, val at: Long)

private fun historyTitle(r: Row, field: String) = when (field) {
    "status" -> "Status: ${(r.status ?: "").replaceFirstChar { it.uppercase() }}"
    "assignee" -> r.str("assignee")?.takeIf { it.isNotEmpty() }?.let { "Assigned to $it" } ?: "Unassigned"
    else -> r.at?.let { "Due: ${weekdayDate(it)}${if (hourOf(it) != 0 || minuteOf(it) != 0) " ${clock(it)}" else ""}" } ?: "Due date cleared"
}

fun historyOf(r: Row): List<HistoryEntry> = listOf("status", "at", "assignee")
    .mapNotNull { f -> r.times[f]?.takeIf { it > 0 }?.let { HistoryEntry(f, historyTitle(r, f), it) } }
    .sortedByDescending { it.at }

// The clock today, the weekday within a week, else the date.
fun historyTime(at: Long, now: Long): String {
    val days = -daysFrom(at, now)
    return when {
        days < 1 -> clock(at)
        days < 7 -> weekday(at)
        else -> dayLabel(at)
    }
}
