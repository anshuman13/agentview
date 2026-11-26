package no.pradhan.agentview.nativeapp.ops

import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.protocolJson

// shared/protocol.ts UsageReport, read by web/src/ops/usageLogic.ts.
@Serializable data class UsageWindow(val pct: Double = 0.0, val resetsAt: Long? = null)
@Serializable data class UsageModel(val name: String = "", val pct: Double = 0.0, val resetsAt: Long? = null)
@Serializable data class UsageExtra(val enabled: Boolean = false, val limit: Double? = null, val used: Double? = null, val pct: Double? = null, val currency: String? = null)
@Serializable data class UsageLatest(val at: Long = 0, val fiveHour: UsageWindow? = null, val week: UsageWindow? = null, val models: List<UsageModel> = emptyList(), val extra: UsageExtra? = null)
@Serializable data class UsagePoint(val at: Long = 0, val fiveHour: Double? = null, val week: Double? = null)
@Serializable data class UsageDay(val day: String = "", val input: Long = 0, val output: Long = 0, val cacheWrite: Long = 0, val cacheRead: Long = 0)
@Serializable data class UsageAccount(val account: String = "", val name: String = "", val latest: UsageLatest? = null, val series: List<UsagePoint> = emptyList(), val days: List<UsageDay> = emptyList())
@Serializable data class UsageReport(val accounts: List<UsageAccount> = emptyList())

fun parseUsage(body: String): UsageReport = protocolJson.decodeFromString(UsageReport.serializer(), body)

private const val HOUR = 3_600_000L
private const val WEEK = 7 * 24 * HOUR
val TOKEN_KINDS = listOf("input", "output", "cacheWrite", "cacheRead")
val TOKEN_LABEL = mapOf("input" to "Input", "output" to "Output", "cacheWrite" to "Cache write", "cacheRead" to "Cache read")
private val MODEL_LABEL = mapOf("seven_day_opus" to "Opus", "seven_day_sonnet" to "Sonnet", "seven_day_oauth_apps" to "OAuth apps")

private fun round4(n: Double) = Math.round(n * 10000) / 10000.0
private fun num(n: Double) = if (n == Math.floor(n) && !n.isInfinite()) n.toLong().toString() else n.toString()

data class LimitRow(val label: String, val pct: Int, val text: String)
data class UsagePt(val x: Double, val y: Double)
data class DayBar(val day: String, val label: String, val total: Long, val parts: List<Double>)
data class UsageLines(val fiveHour: List<UsagePt>, val week: List<UsagePt>)

fun UsageDay.kind(k: String): Long = when (k) { "input" -> input; "output" -> output; "cacheWrite" -> cacheWrite; else -> cacheRead }

// "resets in 2h 30m", "resets in 3d 20h"; empty when the reset time is unknown.
fun resetText(resetsAt: Long?, now: Long): String {
    if (resetsAt == null) return ""
    val m = maxOf(0L, Math.round((resetsAt - now) / 60_000.0))
    val d = m / 1440
    val h = (m % 1440) / 60
    val min = m % 60
    val text = if (d > 0) "${d}d ${h}h" else if (h > 0) "${h}h ${min}m" else "${min}m"
    return "resets in $text"
}

private fun windowRow(label: String, pct: Double, resetsAt: Long?, now: Long) = LimitRow(label, Math.round(pct).toInt(), resetText(resetsAt, now))

// The bars on a card: 5-hour, weekly, per-model weekly, then monthly extra usage.
fun limitRows(latest: UsageLatest?, now: Long): List<LimitRow> {
    if (latest == null) return emptyList()
    val rows = mutableListOf<LimitRow>()
    latest.fiveHour?.let { rows += windowRow("5-hour", it.pct, it.resetsAt, now) }
    latest.week?.let { rows += windowRow("Weekly", it.pct, it.resetsAt, now) }
    for (m in latest.models) rows += windowRow(MODEL_LABEL[m.name] ?: m.name, m.pct, m.resetsAt, now)
    latest.extra?.let { x ->
        val text = if (!x.enabled) "off" else if (x.used != null && x.limit != null) "${num(x.used)} of ${num(x.limit)}" + (x.currency?.takeIf { it.isNotEmpty() }?.let { " $it" } ?: "") else ""
        rows += LimitRow("Extra usage", Math.round(x.pct ?: 0.0).toInt(), text)
    }
    return rows
}

// 7-day line points: x from 0 (a week ago) to 1 (now), y in percent; samples without the window are skipped.
fun seriesLines(series: List<UsagePoint>, now: Long): UsageLines {
    val start = now - WEEK
    fun line(pick: (UsagePoint) -> Double?) = series.filter { pick(it) != null && it.at >= start }.map { UsagePt(round4((it.at - start).toDouble() / WEEK), pick(it)!!) }
    return UsageLines(line { it.fiveHour }, line { it.week })
}

private fun dayTotal(d: UsageDay) = TOKEN_KINDS.sumOf { d.kind(it) }

// Stacked bars: each part's height as a share of the busiest day, in TOKEN_KINDS order.
fun dayBars(days: List<UsageDay>): List<DayBar> {
    val max = days.maxOfOrNull(::dayTotal)?.coerceAtLeast(0) ?: 0
    return days.map { d -> DayBar(d.day, (d.day.drop(8).toIntOrNull() ?: 0).toString(), dayTotal(d), TOKEN_KINDS.map { if (max > 0) round4(d.kind(it).toDouble() / max) else 0.0 }) }
}

fun tokenTotals(days: List<UsageDay>): Map<String, Long> = TOKEN_KINDS.associateWith { k -> days.sumOf { it.kind(k) } }

fun tokens(n: Long): String {
    fun short(v: Double, unit: String) = num(Math.round(v * 10) / 10.0) + unit
    return if (n >= 1e9) short(n / 1e9, "B") else if (n >= 1e6) short(n / 1e6, "M") else if (n >= 1e3) short(n / 1e3, "k") else n.toString()
}
