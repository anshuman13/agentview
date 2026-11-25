package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TimeDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// The date sheet's choices (web data/tasks/dateSheet.ts), checked by shared/fixtures/date-sheet.json.
val REMINDS: List<Pair<Int?, String>> = listOf(null to "On time", 5 to "5 min early", 30 to "30 min early", 60 to "1 hour early", 1440 to "1 day early", -1 to "None")
fun remindLabel(r: Int?) = REMINDS.firstOrNull { it.first == r }?.second ?: "$r min early"
val REPEATS = listOf("never" to "None", "daily" to "Daily", "weekdays" to "Weekdays", "weekly" to "Weekly", "monthly" to "Monthly")
fun repeatLabel(c: String) = REPEATS.firstOrNull { it.first == c }?.second ?: "Custom"

private fun localDay(t: Long): LocalDate = Instant.ofEpochMilli(t).atZone(codexZone).toLocalDate()

// A day and an optional "HH:MM" make a due time: today without a time is no due time, a later day without one is 09:00.
fun composeDue(day: LocalDate, time: String?, now: Long): Long? {
    if (time != null) return atHour(day, time.substringBefore(':').toInt(), time.substringAfter(':').toInt())
    return if (day == localDay(now)) null else atHour(day, MORNING)
}

class QuickDay(val icon: String, val label: String, val day: LocalDate, val time: String? = null)

// Today, Tomorrow, Next Monday, and This evening before 19:00. A quick day without a time keeps the picked time.
fun quickDays(now: Long): List<QuickDay> {
    val today = localDay(now)
    val js = today.dayOfWeek.value % 7
    return listOfNotNull(
        QuickDay("calendar", "Today", today),
        QuickDay("arrow-right", "Tomorrow", today.plusDays(1)),
        QuickDay("arrow-circle-right", "Next Monday", today.plusDays(((8 - js) % 7).let { if (it == 0) 7L else it.toLong() })),
        if (hourOf(now) < EVENING) QuickDay("color-mode", "This evening", today, "$EVENING:00") else null,
    )
}

// The month grid from Monday: blanks before the 1st, then each day.
fun monthCells(month: YearMonth): List<LocalDate?> = List(month.atDay(1).dayOfWeek.value - 1) { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }

class DuePick(val at: Long?, val cadence: String = "never", val remind: Int? = null)

// web DateSheet: quick days, the month, then Time, Reminder and Repeat rows. onDone(null) is No date.
@Composable
fun DateSheet(value: DuePick, now: Long, cadence: Boolean, reminder: Boolean, onDone: (DuePick?) -> Unit, onDismiss: () -> Unit) {
    val today = localDay(now)
    var day by remember { mutableStateOf(value.at?.let(::localDay) ?: today) }
    var time by remember { mutableStateOf(value.at?.takeIf { hasTime(it) }?.let(::clock)) }
    var repeat by remember { mutableStateOf(value.cadence) }
    var remind by remember { mutableStateOf(value.remind) }
    var month by remember { mutableStateOf(YearMonth.from(day)) }
    var pickTime by remember { mutableStateOf(false) }
    val done = { d: LocalDate, t: String? -> onDone(DuePick(composeDue(d, t, now), repeat, remind)); onDismiss() }
    Sheet(onDismiss, "Date", action = { IconBtn("check", "Done", { done(day, time) }, tint = av.accentText) }) {
        Column(Modifier.padding(vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            Row(Modifier.fillMaxWidth()) {
                (quickDays(now).map { q -> Triple(q.icon, q.label) { done(q.day, q.time ?: time) } } + Triple("circle-slash", "No date") { onDone(null); onDismiss() }).forEach { (icon, label, f) ->
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(Tokens.shapeLg)).clickable(onClick = f).padding(vertical = Tokens.sp4), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                        AvIcon(icon, null, tint = av.fgMuted)
                        Text(label, style = Type.caption, color = av.fg, textAlign = TextAlign.Center, maxLines = 2)
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                val pattern = if (month.year == today.year) "MMMM" else "MMMM yyyy"
                Text(month.format(DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH)), Modifier.weight(1f).padding(start = Tokens.sp4), style = Type.headline, color = av.fg)
                IconBtn("chevron-left", "Previous month", { month = month.minusMonths(1) })
                IconBtn("chevron-right", "Next month", { month = month.plusMonths(1) })
            }
            Column {
                Row(Modifier.fillMaxWidth()) { listOf("M", "T", "W", "T", "F", "S", "S").forEach { Text(it, Modifier.weight(1f), style = Type.caption, color = av.fgMuted, textAlign = TextAlign.Center) } }
                val cells = monthCells(month)
                cells.chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        (week + List(7 - week.size) { null }).forEach { d ->
                            Box(Modifier.weight(1f).height(Tokens.touch), contentAlignment = Alignment.Center) {
                                if (d != null) {
                                    val on = d == day
                                    val label = d.format(DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.ENGLISH))
                                    Box(Modifier.size(Tokens.touch).clip(CircleShape).background(if (on) av.accentFill else androidx.compose.ui.graphics.Color.Transparent).clickable { day = d }.semantics { contentDescription = label; selected = on }, contentAlignment = Alignment.Center) {
                                        Text("${d.dayOfMonth}", style = Type.body, color = when { on -> av.onAccent; d == today -> av.accentText; d < today -> av.fgFaint; else -> av.fg })
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Group {
                ListRow("Time", leading = { AvIcon("clock") }, trailing = {
                    Text(time ?: "None", style = Type.body, color = av.fgMuted)
                    if (time != null) IconBtn("close", "Clear time", { time = null }) else AvIcon("chevron-right")
                }, onClick = { pickTime = true })
                if (reminder) {
                    Hairline()
                    var open by remember { mutableStateOf(false) }
                    Box {
                        ListRow("Reminder", leading = { AvIcon("bell") }, trailing = { Text(remindLabel(remind), style = Type.body, color = av.fgMuted); AvIcon("chevron-right") }, onClick = { open = true })
                        Menu(open, { open = false }) { REMINDS.forEach { (r, l) -> MenuItem(l, if (r == -1) "bell-slash" else "bell", { remind = r; open = false }, checked = r == remind) } }
                    }
                }
                if (cadence) {
                    Hairline()
                    var open by remember { mutableStateOf(false) }
                    Box {
                        ListRow("Repeat", leading = { AvIcon("sync") }, trailing = { Text(repeatLabel(repeat), style = Type.body, color = av.fgMuted); AvIcon("chevron-right") }, onClick = { open = true })
                        Menu(open, { open = false }) { REPEATS.forEach { (c, l) -> MenuItem(l, "sync", { repeat = c; open = false }, checked = c == repeat) } }
                    }
                }
            }
        }
    }
    if (pickTime) TimeDialog(dayLabel(atHour(day, 12)), time?.substringBefore(':')?.toInt() ?: MORNING, time?.substringAfter(':')?.toInt() ?: 0, "Set", "No time", { h, m -> time = "%02d:%02d".format(h, m); pickTime = false }, { time = null; pickTime = false }, { pickTime = false })
}
