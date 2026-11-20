package no.pradhan.agentview.nativeapp.codex.meetings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.DAY_MS
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.hourOf
import no.pradhan.agentview.nativeapp.codex.liveRows
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.minuteOf
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader

private const val HOUR = 3_600_000.0
private const val WEEK = 7 * DAY_MS
private const val MAX_HOURS = 8.0

// isAllDay and seriesAudit mirror web/src/codex/data/load.ts and meetings/seriesAudit.ts, checked by shared/fixtures/series-audit.json.
// All-day calendar events start and end at local midnight.
private fun midnight(t: Long) = hourOf(t) == 0 && minuteOf(t) == 0
fun isAllDay(m: Row): Boolean {
    val s = m.startsAt ?: return false
    val e = m.endsAt ?: return false
    return e > s && midnight(s) && midnight(e)
}

class SeriesValue(val key: String, val title: String, val latest: Row, val count: Int, val hours: Double, val decisions: Int, val actions: Int, val recentHours: Double, val quiet: Boolean)

private class Tally(var latest: Row) {
    var count = 0
    var hours = 0.0
    var decisions = 0
    var actions = 0
    var recentHours = 0.0
    var recentValue = 0
}

// Recurring series (a title seen at least twice) over the last 8 weeks: hours, decisions and my actions (open or done).
// A series is quiet when its meetings of the last 4 weeks brought no decision and no action of mine; quiet ones come first, most recent hours first.
fun seriesAudit(meetings: List<Row>, items: List<Row>, now: Long): List<SeriesValue> {
    val mine = items.filter { !it.deleted && it.str("meeting_id") != null && (it.status == "open" || it.status == "done") }
        .groupingBy { "${it.profile}:${it.str("meeting_id")}" }.eachCount()
    val rows = LinkedHashMap<String, Tally>()
    for (m in liveRows(meetings)) {
        val start = m.startsAt ?: continue
        val end = m.endsAt ?: continue
        if (end <= start || start > now || start < now - 8 * WEEK || isAllDay(m)) continue
        val title = seriesTitle(m.title)
        if (title.isEmpty()) continue
        val row = rows.getOrPut("${m.profile}:$title") { Tally(m) }
        val hours = minOf((minOf(end, now) - start) / HOUR, MAX_HOURS)
        val decisions = jsonList(m.str("decisions")).size
        val actions = mine[m.key] ?: 0
        row.count++
        row.hours += hours
        row.decisions += decisions
        row.actions += actions
        if (start >= now - 4 * WEEK) {
            row.recentHours += hours
            row.recentValue += decisions + actions
        }
        if (start >= row.latest.startsAt!!) row.latest = m
    }
    return rows.filter { it.value.count > 1 }.map { (key, r) ->
        SeriesValue(key, r.latest.title ?: "", r.latest, r.count, r.hours, r.decisions, r.actions, r.recentHours, r.recentHours > 0 && r.recentValue == 0)
    }.sortedWith(compareByDescending<SeriesValue> { it.quiet }.thenByDescending { if (it.quiet) it.recentHours else it.hours }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.title })
}

private fun hoursText(h: Double) = "%.1f h".format(java.util.Locale.ROOT, h)

private fun seriesValueMeta(s: SeriesValue) =
    if (s.quiet) "Nothing for you lately · ${hoursText(s.recentHours)} in 4 weeks"
    else "${s.count} meetings · ${hoursText(s.hours)} · ${s.decisions} decisions · ${s.actions} actions for me"

// The Load view's series value list on the phone; a tap opens the series' latest meeting.
@Composable
fun SeriesValuePage(st: CodexState, profile: String?, now: Long, onMeeting: (Row) -> Unit) {
    val rows = remember(st.meetings, st.items, profile, now / 60_000) { seriesAudit(st.meetings.filter { matchesProfile(profile, it) }, st.items, now) }
    if (rows.isEmpty()) {
        EmptyState("No recurring meetings in the last 8 weeks", icon = "calendar", small = false)
        return
    }
    LazyColumn(Modifier.fillMaxWidth()) {
        item { SectionHeader("Series value, last 8 weeks", "${rows.size}") }
        item {
            Group {
                rows.forEachIndexed { i, s ->
                    if (i > 0) Hairline()
                    ListRow(s.title, seriesValueMeta(s), trailing = if (s.quiet) ({ Badge("Waiting", BadgeTone.Waiting) }) else null, onClick = { onMeeting(s.latest) })
                }
            }
        }
    }
}
