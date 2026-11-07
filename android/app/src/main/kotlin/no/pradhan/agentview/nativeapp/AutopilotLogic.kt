package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

// web/src/codex/jobs/autopilotRows.ts and data/store.ts: the settings of replying on my behalf in Slack.
@Serializable class AutopilotAway(val from: String = "", val to: String = "", val backup: String = "", val note: String = "")

@Serializable class AutopilotConfig(
    val enabled: Boolean = false,
    val dry_run: Boolean = false,
    val away: AutopilotAway = AutopilotAway(),
    val escalate: List<String> = emptyList(),
    val manager: String? = null,
    val dms: Boolean = true,
    val model: String = "sonnet",
)

@Serializable class ScanHealth(val ok: Long? = null, val failed: Long? = null, val error: String? = null)
@Serializable class ModelSpend(val model: String = "", val usd: Double = 0.0)
@Serializable class HubSpend(val usd: Double = 0.0, val models: List<ModelSpend> = emptyList(), val jobs: Map<String, Double> = emptyMap())
@Serializable class AutopilotSpend(val today: HubSpend = HubSpend(), val week: HubSpend = HubSpend())
@Serializable class AutopilotReply(val id: String = "", val who: String? = null, val chat: String? = null, val status: String = "", val text: String? = null, val url: String? = null, val at: Long = 0)

@Serializable class AutopilotState(
    val config: AutopilotConfig = AutopilotConfig(),
    val mode: String = "off",
    val watched: List<String> = emptyList(),
    val covered: List<String> = emptyList(),
    val scan: ScanHealth? = null,
    val spend: AutopilotSpend? = null,
    val replies: List<AutopilotReply> = emptyList(),
)

fun parseAutopilot(body: String): AutopilotState = protocolJson.decodeFromString(AutopilotState.serializer(), body)

fun autopilotWhen(t: Long, now: Long) = if (t >= dayStart(now)) clock(t) else dayLabel(t)
fun autopilotDay(d: String): String = runCatching { dayLabel(atHour(LocalDate.parse(d), 12)) }.getOrDefault(d)

fun modeLine(s: AutopilotState, waiting: Int): String {
    val a = s.config.away
    if (!s.config.enabled) return "Off"
    val line = if (s.mode == "away") "Away until ${autopilotDay(a.to)}" else if (a.from.isNotEmpty() && a.to.isNotEmpty()) "Drafts only until ${autopilotDay(a.from)}" else "Drafts only"
    val failed = s.replies.count { it.status == "error" }
    return listOf(line, if (waiting > 0) "$waiting waiting for you" else "", if (failed > 0) "$failed failed" else "", if (s.config.dry_run) "Dry run" else "").filter { it.isNotEmpty() }.joinToString(" · ")
}

private fun usd(n: Double) = "$" + if (n < 10) String.format(java.util.Locale.ENGLISH, "%.2f", n) else Math.round(n).toString()
private fun modelName(m: String) = m.replace(Regex("^claude-"), "").replace(Regex("-\\d{8}$"), "")

fun spendLine(s: AutopilotState): String {
    val sp = s.spend ?: return ""
    val w = sp.week
    if (w.models.isEmpty()) return ""
    val by = w.models.joinToString(", ") { "${modelName(it.model)} ${usd(it.usd)}" }
    val jobs = w.jobs.values.sum()
    return "Hub Claude use: today ${usd(sp.today.usd)} · 7 days ${usd(w.usd)} ($by)" + if (jobs > 0) " · jobs ${usd(jobs)}" else ""
}

fun awayValue(s: AutopilotState) = s.config.away.let { if (it.from.isNotEmpty() && it.to.isNotEmpty()) "${autopilotDay(it.from)} to ${autopilotDay(it.to)}" else "Off" }
fun coversValue(s: AutopilotState) = "${if (s.config.dms) "DMs and " else ""}${s.covered.size} of ${s.watched.size} channels"

fun neverValue(s: AutopilotState): String {
    val people = listOfNotNull(s.config.manager?.takeIf { it.isNotEmpty() }) + s.config.escalate
    return if (people.size > 1) "${people.size} people" else people.firstOrNull() ?: "Nobody"
}

fun modelValue(s: AutopilotState) = if (s.config.model == "opus") "Opus" else "Sonnet"

fun activityValue(s: AutopilotState, now: Long): String {
    val h = s.scan
    val week = s.spend?.week?.usd?.takeIf { it > 0 }
    val scan = when {
        h?.error != null && (h.failed ?: 0L) >= (h.ok ?: 0L) && h.failed != null -> "Scan failed ${autopilotWhen(h.failed, now)}"
        h?.ok != null && h.ok > 0 -> "Scan ${autopilotWhen(h.ok, now)}"
        else -> ""
    }
    return listOf(scan, if (week != null) "${usd(week)} in 7 days" else "").filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "No scan yet" }
}

// A held reply whose ask I closed or dismissed is no longer waiting on me.
fun replyBadge(r: AutopilotReply, items: List<Row>): Pair<String, String> {
    val item = if (r.status == "held") items.firstOrNull { it.id == r.id && it.source == "slack" } else null
    if (item != null && item.status != "suggested" && item.status != "open") return if (item.status == "dismissed") "Skipped" to "skipped" else "Done" to "done"
    return when (r.status) {
        "held" -> "Needs you" to "waiting"
        "sent" -> "Sent" to "sent"
        "dry" -> "Skipped" to "skipped"
        "error" -> "Failed" to "failed"
        "skipped" -> "Skipped" to "skipped"
        else -> r.status to "skipped"
    }
}

// The form of the Away, Never answers sheets as one config patch; null when nothing changed.
data class AutopilotForm(val from: String = "", val to: String = "", val backup: String = "", val note: String = "", val escalate: String = "", val manager: String = "")

fun formOf(s: AutopilotState) = AutopilotForm(s.config.away.from, s.config.away.to, s.config.away.backup, s.config.away.note, s.config.escalate.joinToString(", "), s.config.manager ?: "")

fun formPatch(form: AutopilotForm, s: AutopilotState): String? {
    if (form == formOf(s)) return null
    return buildJsonObject {
        put("away", buildJsonObject { put("from", form.from); put("to", form.to); put("backup", form.backup); put("note", form.note) })
        put("escalate", JsonArray(form.escalate.split(',').map { it.trim() }.filter { it.isNotEmpty() }.map(::JsonPrimitive)))
        put("manager", form.manager)
    }.toString()
}

fun togglePatch(key: String, on: Boolean): String = buildJsonObject { put(key, on) }.toString()
fun modelPatch(model: String): String = buildJsonObject { put("model", model) }.toString()
fun channelsPatch(s: AutopilotState, name: String): String {
    val next = if (name in s.covered) s.covered - name else s.covered + name
    return buildJsonObject { put("channels", JsonArray(next.map(::JsonPrimitive))) }.toString()
}

// Every save goes through Writes, so a read-only run refuses it; a load is a read.
class AutopilotOps(private val remote: AssistantRemote, private val writes: Writes) {
    suspend fun load() = parseAutopilot(remote.autopilot(null))

    fun save(patch: String, done: (AutopilotState?) -> Unit = {}) {
        var out: AutopilotState? = null
        writes.run("Could not save", { out = parseAutopilot(remote.autopilot(patch)) }) { done(out) }
    }
}
