package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref

// shared/plan.ts atRisk and web/src/codex/summary/needsYou.ts: the two sources of the Needs you list the tasks and asks do not cover.
typealias Span = Pair<Long, Long>

private val EST_RE = Regex("~\\s*(?:(\\d+)\\s*h(?:\\s*(\\d+)\\s*m?)?|(\\d+)\\s*m(?:ins?)?)\\b", RegexOption.IGNORE_CASE)
private const val MIN_GAP_MS = 15 * 60_000L
private const val DEFAULT_MIN = 30L

// Minutes from "~30m", "~1h" or "~1h30m" in a title, or null.
fun estimateMinutes(title: String?): Long? {
    val m = title?.let { EST_RE.find(it) } ?: return null
    val g = m.groupValues
    val n = if (g[3].isNotEmpty()) g[3].toLong() else g[1].toLong() * 60 + (g[2].toLongOrNull() ?: 0)
    return n.takeIf { it > 0 }
}

fun taskMinutes(title: String?) = estimateMinutes(title) ?: DEFAULT_MIN

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

fun workGaps(busy: List<Span>, now: Long, startHour: Int, endHour: Int) =
    freeGaps(busy, maxOf(now, hourAt(now, 0, startHour)), hourAt(now, 0, endHour))

// Meetings with a start and an end after it, under 20 hours long; all-day events drop out.
fun timedMeetings(meetings: List<Row>, profile: String?) =
    meetings.filter { !it.deleted && matchesProfile(profile, it) && it.startsAt != null && it.endsAt != null && it.endsAt!! > it.startsAt!! && it.endsAt!! - it.startsAt!! < 20 * 3_600_000L }

// shared/plan.ts afterNextMeeting: the end of the meeting running now (or the next one today), extended through meetings starting
// before it ends, rounded up to 5 minutes; null when none is left or the result is at the end of work hours or later.
fun afterNextMeeting(busy: List<Span>, now: Long, endHour: Int = 17): Long? {
    val sorted = busy.sortedBy { it.first }
    val first = sorted.firstOrNull { it.first <= now && now < it.second } ?: sorted.firstOrNull { it.first > now } ?: return null
    var end = first.second
    for ((a, b) in sorted) if (a > first.first && a <= end) end = maxOf(end, b)
    val at = toSlot(end)
    return at.takeIf { it < hourAt(now, 0, endHour) }
}

// shared/plan.ts nextFreeSlot: the start of the first work gap with 15 minutes left after now + 5 minutes, rounded up to 5 minutes.
fun nextFreeSlot(busy: List<Span>, now: Long, endHour: Int = 17): Long? {
    for ((a, b) in workGaps(busy, now, 8, endHour)) {
        val start = toSlot(maxOf(a, now + SLOT_MS))
        if (b - start >= MIN_GAP_MS) return start
    }
    return null
}

// The task sheet's Snooze targets from today's timed meetings of the task's profile, as in web TaskMoreMenu.
fun freeTimes(meetings: List<Row>, profile: String?, now: Long): List<Pair<String, Long>> {
    val busy = timedMeetings(meetings, profile).filter { it.startsAt!! in dayStart(now) until dayEnd(now) }.map { it.startsAt!! to it.endsAt!! }
    return listOf("After next meeting" to afterNextMeeting(busy, now), "Next free slot" to nextFreeSlot(busy, now)).mapNotNull { (label, at) -> at?.let { label to it } }
}

// Work gaps for each remaining workday from now through Friday, and the days left after today; null on Saturday and Sunday.
private fun weekGaps(busy: List<Span>, now: Long, startHour: Int, endHour: Int): Pair<Int, List<Span>>? {
    val dow = Instant.ofEpochMilli(now).atZone(codexZone).dayOfWeek.value % 7
    val days = 5 - dow
    if (dow == 0 || days < 0) return null
    return days to (0..days).flatMap { workGaps(busy, maxOf(now, hourAt(now, it, 0)), startHour, endHour) }
}

// Free work minutes from now through Friday, 0 on the weekend.
fun weekFreeMinutes(busy: List<Span>, now: Long, startHour: Int = 8, endHour: Int = 17): Long =
    weekGaps(busy, now, startHour, endHour)?.let { (_, gaps) -> Math.round(gaps.sumOf { (a, b) -> b - a } / 60_000.0) } ?: 0L

// Tasks due by the end of this week's Friday whose estimates, summed in due order, exceed the free work time before their due
// time; overdue tasks count as due at 17:00 today. short is the missing minutes. Empty on Saturday and Sunday.
fun atRisk(tasks: List<Pair<Row, Long>>, busy: List<Span>, now: Long, startHour: Int = 8, endHour: Int = 17): List<Pair<Row, Long>> {
    val (days, gaps) = weekGaps(busy, now, startHour, endHour) ?: return emptyList()
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
