package no.pradhan.agentview.nativeapp.codex.jobs

import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.codex.daysFrom
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.weekdayDate
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.unbilledText

// Jobs of web/src/codex/jobs/schedule.tsx: how a schedule reads, and the state a job shows.

val DAY_NAMES = listOf("Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays")
val DAYS = listOf("sun", "mon", "tue", "wed", "thu", "fri", "sat")
private val SCHEDULE = Regex("^(hourly|daily|weekdays|weekly)(?: (sun|mon|tue|wed|thu|fri|sat))?(?: (\\d{1,2}:\\d{2}))?$")

fun describeSchedule(s: String?): String {
    val t = (s ?: "").trim().lowercase()
    val m = SCHEDULE.find(t)
    if (m == null) {
        val once = Regex("^once (\\S+) (\\S+)$", RegexOption.IGNORE_CASE).find((s ?: "").trim())
        if (once != null) {
            val day = runCatching { java.time.LocalDate.parse(once.groupValues[1]).atStartOfDay(codexZone).toInstant().toEpochMilli() }.getOrNull()
            return "Once, ${day?.let { weekdayDate(it) } ?: once.groupValues[1]} at ${once.groupValues[2]}"
        }
        return if (t.isEmpty()) "Weekdays at 08:00" else "Cron ${(s ?: "").trim()}"
    }
    val kind = m.groupValues[1]
    val time = m.groupValues[3].ifEmpty { "08:00" }.padStart(5, '0')
    return when (kind) {
        "hourly" -> "Every hour"
        "daily" -> "Every day at $time"
        "weekdays" -> "Weekdays at $time"
        else -> "${DAY_NAMES[DAYS.indexOf(m.groupValues[2].ifEmpty { "mon" })]} at $time"
    }
}

fun runsOf(runs: List<Row>, j: Row) = runs.filter { !it.deleted && it.profile == j.profile && it.str("job_id") == j.id }.sortedByDescending { it.long("started_at") ?: 0L }

// Each job's runs, newest first, keyed by profile and job id: one pass for the whole list.
fun runsByJob(runs: List<Row>): Map<Pair<String, String?>, List<Row>> =
    runs.filter { !it.deleted }.sortedByDescending { it.long("started_at") ?: 0L }.groupBy { it.profile to it.str("job_id") }

fun Map<Pair<String, String?>, List<Row>>.of(j: Row) = this[j.profile to j.id].orEmpty()

// `own` is the job's runs, newest first (runsOf or runsByJob).
fun isQueued(j: Row, own: List<Row>, now: Long): Boolean {
    val next = j.long("next_run_at") ?: return false
    return next <= now && own.none { it.str("status") == "running" }
}

fun isEnabled(j: Row) = j.long("enabled") == 1L

enum class JobState(val label: String) { Running("Running"), Queued("Queued"), Failed("Failed"), Off("Off") }

fun jobState(j: Row, own: List<Row>, now: Long): JobState? {
    val latest = own.firstOrNull()?.str("status")
    return when {
        latest == "running" -> JobState.Running
        isQueued(j, own, now) -> JobState.Queued
        latest == "error" -> JobState.Failed
        !isEnabled(j) -> JobState.Off
        else -> null
    }
}

fun nextText(t: Long, now: Long): String {
    val days = daysFrom(t, now)
    val day = when (days) { 0L -> "today"; 1L -> "tomorrow"; -1L -> "yesterday"; else -> weekdayDate(t) }
    return "$day ${clock(t)}"
}

// The row's second line: the schedule, then when the job runs next.
fun jobMeta(j: Row, own: List<Row>, now: Long): String {
    val next = j.long("next_run_at")
    val extra = if (next != null && isEnabled(j) && !isQueued(j, own, now)) "Next ${nextText(next, now)}" else null
    return listOfNotNull(describeSchedule(j.str("schedule")), extra).joinToString(" · ")
}

fun money(n: Double, billing: String = "usd") = unbilledText(billing) ?: if (n > 0 && n < 0.005) "<$0.01" else if (n < 10) "$" + String.format(java.util.Locale.ENGLISH, "%.2f", n) else "$" + Math.round(n)

fun runTime(r: Row): String? = r.long("started_at")?.let { "${weekdayDate(it)} ${clock(it)}" }

fun runMeta(r: Row): String {
    if (r.str("status") == "running") return "Running"
    val start = r.long("started_at"); val end = r.long("finished_at")
    val secs = if (start != null && end != null) maxOf(1L, Math.round((end - start) / 1000.0)) else 0L
    val dur = when { secs == 0L -> ""; secs < 60 -> "$secs s"; else -> "${secs / 60} min ${secs % 60} s" }
    val cost = r.str("cost")?.toDoubleOrNull()?.takeIf { it > 0 }?.let { money(it) }
    return listOfNotNull(dur.ifEmpty { null }, cost).joinToString(" · ")
}

fun jobsOf(jobs: List<Row>, profile: String?) = jobs.filter { !it.deleted && matchesProfile(profile, it) }.sortedBy { (it.str("name") ?: "").lowercase() }

// The folder name of a job's repo, or null for a job that only reads.
fun repoLabel(repo: String?): String? = repo?.trimEnd('/')?.substringAfterLast('/')?.ifEmpty { null }
