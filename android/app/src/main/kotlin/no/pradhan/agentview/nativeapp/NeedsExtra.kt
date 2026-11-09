package no.pradhan.agentview.nativeapp

import java.time.Instant

// shared/plan.ts atRisk and web/src/codex/summary/needsYou.ts: the two sources of the Needs you list the tasks and asks do not cover.
typealias Span = Pair<Long, Long>

private val EST_RE = Regex("~\\s*(?:(\\d+)\\s*h(?:\\s*(\\d+)\\s*m?)?|(\\d+)\\s*m(?:ins?)?)\\b", RegexOption.IGNORE_CASE)
private const val MIN_GAP_MS = 15 * 60_000L
private const val DEFAULT_MIN = 30L

fun taskMinutes(title: String?): Long {
    val m = title?.let { EST_RE.find(it) } ?: return DEFAULT_MIN
    val g = m.groupValues
    val n = if (g[3].isNotEmpty()) g[3].toLong() else g[1].toLong() * 60 + (g[2].toLongOrNull() ?: 0)
    return if (n > 0) n else DEFAULT_MIN
}

private fun freeGaps(busy: List<Span>, from: Long, to: Long): List<Span> {
    val out = ArrayList<Span>()
    var at = from
    for ((a, b) in busy.sortedBy { it.first }) {
        if (b <= at) continue
        if (a > at) out.add(at to minOf(a, to))
        at = maxOf(at, b)
        if (at >= to) break
    }
    if (at < to) out.add(at to to)
    return out.filter { it.second - it.first >= MIN_GAP_MS }
}

private fun hourAt(t: Long, plusDays: Int, hour: Int) = atHour(Instant.ofEpochMilli(t).atZone(codexZone).toLocalDate().plusDays(plusDays.toLong()), hour)

private fun workGaps(busy: List<Span>, now: Long, startHour: Int, endHour: Int) =
    freeGaps(busy, maxOf(now, hourAt(now, 0, startHour)), hourAt(now, 0, endHour))

// Tasks due by the end of this week's Friday whose estimates, summed in due order, exceed the free work time before their due
// time; overdue tasks count as due at 17:00 today. short is the missing minutes. Empty on Saturday and Sunday.
fun atRisk(tasks: List<Pair<Row, Long>>, busy: List<Span>, now: Long, startHour: Int = 8, endHour: Int = 17): List<Pair<Row, Long>> {
    val dow = Instant.ofEpochMilli(now).atZone(codexZone).dayOfWeek.value % 7
    val days = 5 - dow
    if (dow == 0 || days < 0) return emptyList()
    val gaps = (0..days).flatMap { workGaps(busy, maxOf(now, hourAt(now, it, 0)), startHour, endHour) }
    fun freeBy(t: Long) = Math.round(gaps.sumOf { (a, b) -> maxOf(0L, minOf(b, t) - a) } / 60_000.0)
    val close = hourAt(now, 0, endHour)
    val horizon = hourAt(now, days + 1, 0)
    val due = tasks.filter { it.second < horizon }.map { it to if (it.second < now) maxOf(close, now) else it.second }.sortedBy { it.second }
    val out = ArrayList<Pair<Row, Long>>()
    var need = 0L
    for ((task, by) in due) {
        need += taskMinutes(task.first.title)
        val short = need - freeBy(by)
        if (short > 0) out.add(task.first to short)
    }
    return out
}

class Bullet(val title: String, val url: String?, val why: String) { val key get() = url ?: title }

private val BULLET = Regex("^[-*]\\s+(.*)$")
private val BULLET_HEAD = Regex("^(?:\\[([^\\]]+)]\\(((?:[^()]|\\([^()]*\\))+)\\)|\\*\\*([^*]+)\\*\\*)\\s*:?\\s*(.*)$")
private val HEADING = Regex("^#{1,6}\\s|^\\*\\*[^*]+\\*\\*:?\\s*$")

// Top-level bullets under the brief's "Needs you" heading: the linked or bold title and the first sentence after it.
fun briefBullets(text: String): List<Bullet> {
    val out = ArrayList<Bullet>()
    var inside = false
    for (line in text.split('\n')) {
        if (line.isBlank()) continue
        val bullet = BULLET.find(line)
        if (bullet == null) {
            if (line[0].isWhitespace()) continue
            if (Regex("needs you", RegexOption.IGNORE_CASE).containsMatchIn(line)) inside = true
            else if (HEADING.containsMatchIn(line)) inside = false
            continue
        }
        if (!inside) continue
        val body = bullet.groupValues[1]
        val m = BULLET_HEAD.find(body)
        val title = if (m != null) m.groupValues[1].ifEmpty { m.groupValues[3] } else body.split(':')[0]
        val rest = if (m != null) m.groupValues[4] else body.drop(title.length + 1)
        val url = safeHref(m?.groupValues?.get(2))
        out.add(Bullet(title.trim(), url, rest.trim().split(Regex("(?<=[.!?])\\s"))[0]))
    }
    return out
}

fun minutesText(n: Long) = if (n >= 60) "${n / 60}h${if (n % 60 != 0L) (n % 60).toString().padStart(2, '0') else ""}" else "${n}m"
