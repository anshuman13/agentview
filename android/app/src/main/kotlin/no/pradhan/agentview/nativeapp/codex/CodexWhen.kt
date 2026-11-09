package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.s

// web/src/codex/data/when.ts: the date, time and relative span written inside a task's text.
private val DATE_RE = Regex("\\b(today|tomorrow|tmrw|next week|end of (?:the )?week|eow|(?:on )?next (?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?|(?:on )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?)\\b", RegexOption.IGNORE_CASE)
private val PART_RE = Regex("\\b(?:this |in the )?(morning|noon|lunch|afternoon|evening|tonight)\\b", RegexOption.IGNORE_CASE)
private val TIME_RE = Regex("\\b(?:at |kl\\.? )?(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)?\\b(?!\\s*(?:min|hour|hr|h\\b|day|week|%))", RegexOption.IGNORE_CASE)
private val REL_RE = Regex("\\b(?:in\\s+(an?|one|half an?|\\d+)\\s*(minutes?|mins?|m|hours?|hrs?|h|days?|weeks?)\\b(?:\\s+from now)?|(an?|one|\\d+)\\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\\s+(?:from now|later)\\b)", RegexOption.IGNORE_CASE)
private val AT_RE = Regex("^(at|kl)", RegexOption.IGNORE_CASE)
private val PARTS = mapOf("morning" to 9, "noon" to 12, "lunch" to 12, "afternoon" to 14, "evening" to 19, "tonight" to 19)

class When(val at: Long?, val spans: List<IntRange>)

private fun clockOf(t: MatchResult, hint: Int?): Pair<Int, Int>? {
    var h = t.groupValues[1].toInt()
    val minute = t.groups[2]?.value?.toInt() ?: 0
    if (h > 23 || minute > 59) return null
    val ampm = t.groups[3]?.value?.lowercase()
    if (ampm == "pm" && h < 12) h += 12
    if (ampm == "am" && h == 12) h = 0
    if (ampm == null && hint != null && hint >= 12 && h < 12) h += 12
    return h to minute
}

private fun span(m: MatchResult, offset: Int = 0) = (offset + m.range.first)..(offset + m.range.last)
private fun today(now: Long) = Instant.ofEpochMilli(now).atZone(codexZone).toLocalDate()
private fun dow(now: Long) = today(now).dayOfWeek.value % 7
private fun nz7(n: Int) = if (n == 0) 7 else n

private fun at(now: Long, days: Int, hour: Int, minute: Int = 0) = atHour(today(now).plusDays(days.toLong()), hour, minute)

// "in 1 hour", "2 hours from now", "tomorrow 9", "fri at 14:30", "this evening", "today"; "today" alone gives at = null, which keeps the task in Today.
fun parseWhen(text: String, now: Long): When? {
    REL_RE.find(text)?.let { r ->
        val n = r.groups[1]?.value ?: r.groupValues[3]
        val unit = (r.groups[2]?.value ?: r.groupValues[4]).lowercase()
        val amount = if (n.startsWith("half", true)) 0.5 else if (Regex("^(an?|one)$", RegexOption.IGNORE_CASE).matches(n)) 1.0 else n.toDouble()
        val key = if (unit == "m" || unit.startsWith("min")) 'm' else unit[0]
        val spans = mutableListOf(span(r))
        val perDay = if (key == 'd') 1 else if (key == 'w') 7 else 0
        var target = now
        if (perDay > 0 && (amount * perDay) % 1.0 == 0.0) {
            val day = today(now).plusDays((amount * perDay).toLong())
            val rest = text.substring(r.range.last + 1)
            val t = TIME_RE.find(rest)
            if (t != null && (t.groups[2] != null || t.groups[3] != null || AT_RE.containsMatchIn(t.value)) && rest.substring(0, t.range.first).isBlank()) {
                val (h, m) = clockOf(t, null) ?: return null
                spans.add(span(t, r.range.last + 1))
                return When(atHour(day, h, m), spans)
            }
            val clock = Instant.ofEpochMilli(now).atZone(codexZone).toLocalTime()
            target = day.atTime(clock).atZone(codexZone).toInstant().toEpochMilli()
        } else if (perDay > 0) target = now + (amount * perDay * DAY_MS).toLong()
        else target = now + (amount * if (key == 'm') 60_000 else 3_600_000).toLong()
        return When((target + 59_999) / 60_000 * 60_000, spans)
    }
    val d = DATE_RE.find(text)
    val p = PART_RE.find(text)
    var days: Int? = null
    var eow = false
    var hour: Int? = p?.let { PARTS[it.groupValues[1].lowercase()] }
    if (d != null) {
        val w = d.groupValues[1].lowercase().removePrefix("on ")
        val dw = dow(now)
        when {
            w == "today" -> days = 0
            w == "tomorrow" || w == "tmrw" -> days = 1
            w == "next week" -> days = nz7((8 - dw) % 7)
            w == "eow" || w.startsWith("end of") -> { eow = true; days = if (dw == 0) -2 else 5 - dw }
            w.startsWith("next ") -> { val i = WEEKDAYS.indexOfFirst { it.startsWith(w.substring(5, 8)) }; days = nz7((8 - dw) % 7) + ((i + 6) % 7) }
            else -> { val i = WEEKDAYS.indexOfFirst { it.startsWith(w.take(3)) }; days = nz7((i - dw + 7) % 7) }
        }
    }
    val anchor = if (d != null && p != null) (if (d.range.first > p.range.first) d else p) else d ?: p
    val offset = anchor?.let { it.range.first + it.value.length } ?: 0
    val rest = text.substring(offset)
    val t = TIME_RE.find(rest)
    val timed = t != null && (t.groups[2] != null || t.groups[3] != null || AT_RE.containsMatchIn(t.value) || (anchor != null && rest.substring(0, t.range.first).isBlank()))
    if (d == null && p == null && !timed) return null
    val spans = listOfNotNull(d, p).map { span(it) }.toMutableList()
    var minute = 0
    if (timed && t != null) {
        val (h, m) = clockOf(t, hour) ?: return null
        hour = h
        minute = m
        spans.add(span(t, offset))
    }
    if (eow) {
        hour = hour ?: 17
        if (at(now, days ?: 0, hour, minute) <= now) days = (days ?: 0) + 7
    }
    if (hour == null) {
        if (days == 0) return When(null, spans)
        hour = 9
    }
    if (days == null) days = if (at(now, 0, hour, minute) > now) 0 else 1
    return When(at(now, days, hour, minute), spans.sortedBy { it.first })
}

fun stripWhen(text: String, w: When?): String {
    var out = text
    for (s in (w?.spans ?: emptyList()).sortedByDescending { it.first }) out = out.substring(0, s.first) + out.substring(s.last + 1)
    return out
        .replace(Regex("^\\s*(?:add a task to|add a task|remind me to|reminder to)\\s+", RegexOption.IGNORE_CASE), "")
        .replace(Regex("[\\s,]*(?:and )?(?:set|add) a reminder\\s*$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\s{2,}"), " ").trim()
}
