package no.pradhan.agentview.nativeapp

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Day arithmetic and labels of web/src/codex (days.ts, time.tsx, data/when.ts, data/dates.ts) in the device time zone.
var codexZone: ZoneId = ZoneId.systemDefault()

const val MORNING = 9
const val EVENING = 19
const val DAY_MS = 86_400_000L

private fun date(t: Long): LocalDate = Instant.ofEpochMilli(t).atZone(codexZone).toLocalDate()
fun atHour(day: LocalDate, hour: Int, minute: Int = 0): Long = day.atTime(hour, minute).atZone(codexZone).toInstant().toEpochMilli()
fun dayStart(t: Long): Long = date(t).atStartOfDay(codexZone).toInstant().toEpochMilli()
fun dayEnd(t: Long): Long = date(t).plusDays(1).atStartOfDay(codexZone).toInstant().toEpochMilli()
fun dayPlus(t: Long, days: Long): Long = date(t).plusDays(days).atStartOfDay(codexZone).toInstant().toEpochMilli()
fun hourOf(t: Long) = Instant.ofEpochMilli(t).atZone(codexZone).hour
fun minuteOf(t: Long) = Instant.ofEpochMilli(t).atZone(codexZone).minute

// Whole days from today to the day of t.
fun daysFrom(t: Long, now: Long): Long = java.time.temporal.ChronoUnit.DAYS.between(date(now), date(t))

fun weekStart(now: Long): Long = date(now).minusDays(((date(now).dayOfWeek.value - 1).toLong())).atStartOfDay(codexZone).toInstant().toEpochMilli()

fun clock(t: Long): String = DateTimeFormatter.ofPattern("HH:mm").format(Instant.ofEpochMilli(t).atZone(codexZone))
fun dayLabel(t: Long): String = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH).format(Instant.ofEpochMilli(t).atZone(codexZone))
private fun weekdayDate(t: Long) = DateTimeFormatter.ofPattern("EEE, d MMM", Locale.ENGLISH).format(Instant.ofEpochMilli(t).atZone(codexZone))
private fun weekday(t: Long) = DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH).format(Instant.ofEpochMilli(t).atZone(codexZone))

// "Tomorrow", else the short weekday and date.
fun dayHeading(t: Long, now: Long) = if (daysFrom(t, now) == 1L) "Tomorrow" else weekdayDate(t)

private val jsDow = mapOf(DayOfWeek.SUNDAY to 0, DayOfWeek.MONDAY to 1, DayOfWeek.TUESDAY to 2, DayOfWeek.WEDNESDAY to 3, DayOfWeek.THURSDAY to 4, DayOfWeek.FRIDAY to 5, DayOfWeek.SATURDAY to 6)

// 09:00 tomorrow; for work the weekend is skipped.
fun nextNine(now: Long, profile: String? = null): Long {
    val d = date(now)
    val skip = if (profile == WORK) listOf(0, 0, 0, 0, 0, 2, 1)[jsDow.getValue(d.dayOfWeek)] else 0
    return atHour(d.plusDays(1L + skip), MORNING)
}

fun snoozeLaterAt(at: Long?, now: Long, profile: String? = null) = nextNine(maxOf(at ?: 0, now), profile)

// Move-to-today target: today at the task's own time of day, or now when that time has passed.
fun todayAt(at: Long?, now: Long): Long {
    val from = at ?: now
    val t = atHour(date(now), hourOf(from), minuteOf(from))
    return if (t > now) t else now
}

class Snooze(val label: String, val at: (now: Long, profile: String?) -> Long)

val SNOOZES = listOf(
    Snooze("In 1 hour") { now, _ -> (now + 3_600_000 + 59_999) / 60_000 * 60_000 },
    Snooze("In 3 hours") { now, _ -> now + 3 * 3_600_000 },
    Snooze("Tonight") { now, _ -> if (hourOf(now) < EVENING) atHour(date(now), EVENING) else atHour(date(now).plusDays(1), EVENING) },
    Snooze("Tomorrow") { now, p -> nextNine(now, p) },
    Snooze("Next week") { now, _ -> atHour(date(now).plusDays((((8 - jsDow.getValue(date(now).dayOfWeek)) % 7).takeIf { it != 0 } ?: 7).toLong()), MORNING) },
)

// web/src/codex/time.tsx when: "this morning", "tomorrow 14:30", "Fri 09:00", else the date.
fun whenText(at: Long, now: Long, withTime: Boolean = false): String {
    val days = daysFrom(at, now)
    val part = if (minuteOf(at) == 0 && hourOf(at) == MORNING) "morning" else if (minuteOf(at) == 0 && hourOf(at) == EVENING) "evening" else null
    val time = part ?: clock(at)
    return when {
        days == 0L -> if (part != null) "this $part" else time
        days == 1L -> "tomorrow $time"
        days == -1L -> "yesterday $time"
        days in 2..6 -> "${weekday(at)} $time"
        else -> if (withTime) "${dayLabel(at)} $time" else dayLabel(at)
    }
}

// The due text of an open task row (web Task.tsx dueText): Nd late, the day and time, or only the time under its day.
fun dueText(row: Row, now: Long, inDay: Boolean = false): String? {
    val at = row.at ?: return null
    if (row.status == "note" || row.status == "done") return null
    val late = -daysFrom(at, now)
    val slot = minuteOf(at) == 0 && hourOf(at) in listOf(MORNING, EVENING)
    return when {
        late > 0 -> "${late}d late"
        !inDay -> whenText(at, now)
        slot -> null
        else -> clock(at)
    }
}
