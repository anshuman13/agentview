package no.pradhan.agentview.nativeapp.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.AlarmClock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.TextStyle
import java.util.Locale

// What the phone does with a phone_alarm message: the clock fields and the weekday that makes Android repeat it, or why it cannot.
sealed interface AlarmPlan {
    // days is the Calendar weekday constant (SUNDAY = 1 to SATURDAY = 7), empty for an alarm with no day extras; weekday is its English name.
    data class Set(val hour: Int, val minute: Int, val days: List<Int>, val weekday: String?) : AlarmPlan
    data class Refused(val error: String) : AlarmPlan
}

// shared server tool phone_alarm: the day rules in the phone's own zone. A day that is the next time HH:MM comes round needs no day extra.
fun alarmPlan(time: String, day: String?, now: ZonedDateTime): AlarmPlan {
    val at = runCatching { LocalTime.parse(time) }.getOrNull()
    if (at == null || time.length != 5) return AlarmPlan.Refused("time must be HH:MM (24 h)")
    val date = day?.let { runCatching { LocalDate.parse(it) }.getOrNull() ?: return AlarmPlan.Refused("day must be YYYY-MM-DD") }
    val today = now.toLocalDate()
    val ahead = at.isAfter(now.toLocalTime())
    val next = if (ahead) today else today.plusDays(1)
    return when {
        date == null || date == next -> AlarmPlan.Set(at.hour, at.minute, emptyList(), null)
        date == today -> AlarmPlan.Refused("time has already passed today")
        date.isBefore(today) -> AlarmPlan.Refused("day is in the past")
        date.isAfter(today.plusDays(6)) -> AlarmPlan.Refused("day must be within the next 7 days")
        else -> AlarmPlan.Set(at.hour, at.minute, listOf(date.dayOfWeek.value % 7 + 1), date.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.ENGLISH))
    }
}

fun alarmIntent(plan: AlarmPlan.Set, label: String): Intent =
    Intent(AlarmClock.ACTION_SET_ALARM)
        .putExtra(AlarmClock.EXTRA_HOUR, plan.hour)
        .putExtra(AlarmClock.EXTRA_MINUTES, plan.minute)
        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        .apply {
            if (label.isNotEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
            if (plan.days.isNotEmpty()) putExtra(AlarmClock.EXTRA_DAYS, ArrayList(plan.days))
        }

// The error line for a failed start of the clock app.
fun alarmFailure(e: Exception) = if (e is ActivityNotFoundException) "No clock app on the phone" else e.message ?: "Could not set the alarm"
