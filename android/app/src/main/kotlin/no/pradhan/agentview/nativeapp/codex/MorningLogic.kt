package no.pradhan.agentview.nativeapp.codex

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import no.pradhan.agentview.nativeapp.net.protocolJson

// shared/morning.ts: today's morning brief rows as Duet's "Topic: status" lines.
data class MorningRow(val section: String, val title: String, val meta: String)
data class MorningLine(val label: String, val text: String)

private val LABELS = linkedMapOf("note" to "Note", "meetings" to "Meetings", "plan" to "Time", "tasks" to "Tasks", "waiting" to "Waiting", "asks" to "Slack asks", "said" to "You said", "left" to "From last workday")

private fun MorningRow.one() = if (meta.isNotEmpty()) "$title ($meta)" else title

fun morningLines(rows: List<MorningRow>): List<MorningLine> = LABELS.mapNotNull { (section, label) ->
    val of = rows.filter { it.section == section }
    if (of.isEmpty()) null
    else MorningLine(label, if (section == "plan" || section == "note") of.joinToString(", ") { it.one() } else of[0].one() + if (of.size > 1) " and ${of.size - 1} more" else "")
}

fun parseMorningRows(json: String?): List<MorningRow> = runCatching {
    (protocolJson.parseToJsonElement(json ?: "[]") as? JsonArray).orEmpty().mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        fun s(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
        val title = (o["title"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
        MorningRow(s("section") ?: "", title, s("meta") ?: "")
    }
}.getOrDefault(emptyList())

fun morningBriefs(briefs: List<Row>, profile: String?, now: Long) =
    briefs.filter { !it.deleted && it.str("kind") == "morning" && it.long("from_at") == dayStart(now) && matchesProfile(profile, it) }
