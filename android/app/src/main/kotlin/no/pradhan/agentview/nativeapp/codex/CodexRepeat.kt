package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import java.time.LocalDate
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.codex.meetings.Repeats

// web/src/codex/data/recur.ts: a "Repeats: every monday 09:00" first line in the notes makes a done task create its next copy.
private val RULE_RE = Regex("\\bevery\\s+(day|weekday|week|month\\s+on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?|(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?)\\b(?:\\s+(?:at\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)?\\b)?", RegexOption.IGNORE_CASE)

val WEEKDAYS = listOf("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")

private class Rule(val kind: String, val dow: Int, val dom: Int, val h: Int, val m: Int)

private fun pad(n: Int) = n.toString().padStart(2, '0')
private fun ord(n: Int) = "$n${if (n % 100 in 11..13) "th" else listOf("th", "st", "nd", "rd").getOrElse(n % 10) { "th" }}"

private fun ruleLine(r: Rule): String {
    val t = "${pad(r.h)}:${pad(r.m)}"
    return when (r.kind) {
        "dow" -> "Repeats: every ${WEEKDAYS[r.dow]} $t"
        "month" -> "Repeats: every month on the ${ord(r.dom)} $t"
        else -> "Repeats: every ${r.kind} $t"
    }
}

private fun jsDow(d: LocalDate) = d.dayOfWeek.value % 7

private fun occursOn(r: Rule, d: LocalDate) = when (r.kind) {
    "day" -> true
    "weekday" -> jsDow(d) in 1..5
    else -> r.kind == "dow" && jsDow(d) == r.dow
}

// The first matching time strictly after `after`; a month day past the month's end falls on its last day.
private fun nextAfter(r: Rule, after: Long): Long? {
    val base = Instant.ofEpochMilli(after).atZone(codexZone).toLocalDate()
    for (k in 0L until 400L) {
        val day = if (r.kind == "month") {
            val first = base.withDayOfMonth(1).plusMonths(k)
            first.withDayOfMonth(minOf(r.dom, first.lengthOfMonth()))
        } else base.plusDays(k)
        val t = atHour(day, r.h, r.m)
        if ((r.kind == "month" || occursOn(r, day)) && t > after) return t
    }
    return null
}

private fun read(m: MatchResult, now: Long): Rule? {
    val w = m.groupValues[1].lowercase()
    var h = m.groups[4]?.value?.toInt() ?: 9
    val mi = m.groups[5]?.value?.toInt() ?: 0
    val ap = m.groups[6]?.value?.lowercase()
    if (ap == "pm" && h < 12) h += 12
    if (ap == "am" && h == 12) h = 0
    if (h > 23 || mi > 59) return null
    if (w == "day" || w == "weekday") return Rule(w, 0, 1, h, mi)
    if (w == "week") {
        val first = nextAfter(Rule("day", 0, 1, h, mi), now) ?: now
        return Rule("dow", jsDow(Instant.ofEpochMilli(first).atZone(codexZone).toLocalDate()), 1, h, mi)
    }
    if (m.groups[2] != null) {
        val dom = m.groupValues[2].toInt()
        return if (dom in 1..31) Rule("month", 0, dom, h, mi) else null
    }
    return Rule("dow", WEEKDAYS.indexOfFirst { it.startsWith(m.groupValues[3].lowercase().take(3)) }, 1, h, mi)
}

class Repeat(val title: String, val text: String, val at: Long)

// "Water plants every monday 9" gives the title, the "Repeats:" line and the first due time.
fun parseRepeat(typed: String, now: Long): Repeat? {
    val m = RULE_RE.find(typed) ?: return null
    val r = read(m, now) ?: return null
    val title = (typed.substring(0, m.range.first) + " " + typed.substring(m.range.last + 1)).replace(Regex("\\s{2,}"), " ").trim()
    val at = nextAfter(r, now)
    return if (title.isNotEmpty() && at != null) Repeat(title, ruleLine(r), at) else null
}

// The first rule time after the later of the due time and now, or null.
fun skipTarget(row: Row, now: Long): Long? {
    val text = row.text?.takeIf { isRepeat(it) } ?: return null
    val m = RULE_RE.find(text.substringBefore('\n')) ?: return null
    val r = read(m, now) ?: return null
    return nextAfter(r, maxOf(row.at ?: now, now))
}

// The copy to create when a repeating task is done, or null; skips a copy that already exists.
fun nextRepeat(row: Row, now: Long, rows: List<Row>): Repeat? {
    val at = skipTarget(row, now) ?: return null
    val dup = rows.any { it.profile == row.profile && it.id != row.id && !it.deleted && it.status == "open" && it.title == row.title && it.text == row.text && it.at == at }
    return if (dup) null else Repeat(row.title ?: "", row.text!!, at)
}
