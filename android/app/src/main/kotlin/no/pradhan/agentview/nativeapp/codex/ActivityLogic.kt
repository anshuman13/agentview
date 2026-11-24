package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.net.LiveChat

// shared/activity.ts
data class ActivityRow(val id: String, val title: String, val line: String, val at: Long, val failed: Boolean)

private const val LINE_MAX = 90

fun outcomeLine(last: String?): String {
    val flat = (last ?: "").replace(Regex("[*_`#>]"), "").replace(Regex("\\s+"), " ").trim()
    val first = Regex("^(.+?[.!?])(\\s|$)").find(flat)?.groupValues?.get(1) ?: flat
    return if (first.length > LINE_MAX) first.take(LINE_MAX - 1).trimEnd() + "…" else first
}

// Muse's activity feed: chats that finished today, newest first, each with its outcome and time.
fun activity(live: List<LiveChat>, skip: Set<String>, dayStart: Long, max: Int = 6): List<ActivityRow> =
    live.filter { !it.running && it.pending == 0 && it.id !in skip && it.lastActive >= dayStart }
        .sortedByDescending { it.lastActive }
        .take(max)
        .map { c -> ActivityRow(c.id, c.title.ifBlank { "Untitled" }, outcomeLine(c.last).ifEmpty { if (c.failed) "Stopped with an error" else "Finished" }, c.lastActive, c.failed) }
