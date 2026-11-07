package no.pradhan.agentview.nativeapp

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

// The pieces of the Codex Overview (web/src/codex Overview.tsx, split.ts, NeedsYou.tsx, data/meetings.ts, data/goals.ts).

fun isBlock(m: Row) = m.id.startsWith("block:")
fun isSolo(m: Row) = m.id.startsWith("cal:") && m.str("people") == "[]"

fun peopleOf(m: Row): List<String> {
    val s = m.str("people") ?: return emptyList()
    val list = if (s.startsWith("[")) runCatching { (protocolJson.parseToJsonElement(s) as JsonArray).mapNotNull { (it as? JsonPrimitive)?.contentOrNull } }.getOrDefault(emptyList()) else s.split(",")
    return list.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
}

class Others(val who: String, val what: String)

fun othersOf(m: Row): List<Others> = runCatching {
    (protocolJson.parseToJsonElement(m.str("others") ?: "[]") as JsonArray).mapNotNull {
        val o = it as? JsonObject ?: return@mapNotNull null
        val who = (o["who"] as? JsonPrimitive)?.contentOrNull; val what = (o["what"] as? JsonPrimitive)?.contentOrNull
        if (who != null && what != null) Others(who, what) else null
    }
}.getOrDefault(emptyList())

private fun span(ms: Long): String {
    val min = (ms + 59_999) / 60_000
    return if (min < 60) "$min min" else "${min / 60}h${if (min % 60 != 0L) " ${min % 60}m" else ""}"
}

fun countdown(m: Row, now: Long): String? {
    val start = m.startsAt!!
    if (start > now) return if (start - now < 60_000) "Starts now" else "Starts in ${span(start - now)}"
    val end = m.endsAt
    return if (end == null || end <= now) null else "Ends in ${span(end - now)}"
}

fun isLive(m: Row, now: Long) = m.startsAt!! <= now && (m.endsAt ?: m.startsAt!!) > now

// Whole minutes left when the meeting starts within the next 10 minutes, else null.
fun joinMinutes(m: Row, now: Long): Long? {
    val left = m.startsAt!! - now
    return if (left in 1..600_000) (left + 59_999) / 60_000 else null
}

fun meetingMeta(m: Row, now: Long, noDay: Boolean = false): String {
    val n = peopleOf(m).size
    val day = if (!noDay && m.startsAt!! >= dayEnd(now)) "${DateTimeFormatter.ofPattern("EEE, d MMM", Locale.ENGLISH).format(Instant.ofEpochMilli(m.startsAt!!).atZone(codexZone))}, " else ""
    val time = "$day${clock(m.startsAt!!)}${m.endsAt?.let { " - ${clock(it)}" } ?: ""}"
    return listOfNotNull(time, m.str("room")?.takeIf { it.isNotEmpty() }, if (n > 0) "$n ${if (n == 1) "person" else "people"}" else null).joinToString(" · ")
}

// Meetings with a start time, in the profile, not focus blocks, in the pieces the Overview shows.
class Meetings(val next: Row?, val today: List<Row>, val nextLater: Row?)

fun meetingsOf(meetings: List<Row>, profile: String?, now: Long): Meetings {
    val all = meetings.filter { !it.deleted && it.startsAt != null && matchesProfile(profile, it) && !isBlock(it) }
    val endOfDay = dayEnd(now)
    val ahead = all.filter { (it.endsAt ?: it.startsAt!!) > now }.sortedBy { it.startsAt }
    val todayAhead = ahead.filter { it.startsAt!! < endOfDay }
    val next = todayAhead.firstOrNull()
    val start = dayStart(now)
    return Meetings(
        next,
        all.filter { it.startsAt!! >= start && it.startsAt!! < endOfDay }.sortedBy { it.startsAt },
        todayAhead.firstOrNull { it != next && it.startsAt!! > now } ?: ahead.firstOrNull { it.startsAt!! >= endOfDay },
    )
}

fun actionsOf(items: List<Row>, m: Row) = items.filter { !it.deleted && it.meetingId == m.id && it.profile == m.profile }

const val NEEDS_CAP = 5
const val JUST_ENDED_MS = 2 * 3_600_000L

sealed class Need(val keys: List<String>) {
    class Overdue(val row: Row) : Need(listOf("task:${row.key}"))
    class OverdueAll(val rows: List<Row>) : Need(emptyList())
    class Ask(val row: Row) : Need(listOf("task:${row.key}"))
    class Dm(val chat: Row) : Need(listOf("chat:${chat.key}") + listOfNotNull(chat.str("url")?.let { "url:$it" }))
    class JustEnded(val row: Row, val meeting: Row) : Need(listOf("task:${row.key}"))

    val isTask get() = this is Overdue || this is OverdueAll || this is JustEnded
}

// Each item once, in rank order: overdue tasks, asks to confirm, DMs waiting on me, then actions of meetings that just ended.
// Three or more overdue tasks collapse into one entry.
fun needsYou(items: List<Row>, meetings: List<Row>, chats: List<Row>, profile: String?, now: Long): List<Need> {
    val s = split(items, profile, now)
    val mt = meetingsOf(meetings, profile, now)
    val ended = mt.today.filter { it.endsAt != null && it.endsAt!! <= now && now - it.endsAt!! < JUST_ENDED_MS }
    val dms = chats.filter { !it.deleted && it.str("kind") == "dm" && it.long("waiting") == 1L && matchesProfile(profile, it) }.sortedByDescending { it.long("last_at") ?: 0L }
    val groups = listOf<List<Need>>(
        s.overdue.map { Need.Overdue(it) },
        s.review.map { Need.Ask(it) },
        dms.map { Need.Dm(it) },
        ended.flatMap { m -> actionsOf(items, m).filter { it.status == "open" }.map { Need.JustEnded(it, m) } },
    )
    val seen = HashSet<String>()
    val ranked = groups.flatten().filter { n ->
        if (n.keys.any { it in seen }) false else { seen.addAll(n.keys); true }
    }
    val overdue = ranked.filterIsInstance<Need.Overdue>()
    if (overdue.size < 3) return ranked
    val first = ranked.indexOfFirst { it is Need.Overdue }
    return ranked.subList(0, first) + Need.OverdueAll(overdue.map { it.row }) + ranked.subList(first, ranked.size).filter { it !is Need.Overdue }
}

fun doneCount(done: Int, open: Int) = if (done > 0) "$done of ${done + open} done" else null

// The tasks the Today list shows for the Overview, split the way Overview.tsx does it.
class Today(val upNextTask: Row?, val todo: List<Row>, val late: List<Row>, val openCount: Int)

fun overviewToday(s: Split, next: Row?, now: Long): Today {
    val due = dueToday(s, now).filter { it.status == "open" }
    val late = s.overdue.filter { it.status == "open" }
    val todo = due.sortedBy { it.at ?: 0L }
    val task = if (next == null) todo.firstOrNull() else null
    val open = (due + late).distinctBy { it.key }.size
    return Today(task, if (task != null) todo.filter { it != task } else todo, late, open)
}

// A weekly goal is an item with status goal whose at is a time in its week; a task links to it by its goal column.
const val GOAL = "goal"
const val MAX_GOALS = 3

fun goalsOf(items: List<Row>, now: Long, profile: String? = null): List<Row> {
    val start = weekStart(now)
    val end = dayPlus(start, 7)
    return items.filter { !it.deleted && it.status == GOAL && it.at != null && it.at!! >= start && it.at!! < end && matchesProfile(profile, it) }.sortedBy { it.madeAt }
}

fun linkedTo(items: List<Row>, goal: Row) = items.filter { !it.deleted && it.profile == goal.profile && it.goal == goal.id && (it.status == "open" || it.status == "done") }

class Progress(val done: Int, val total: Int)
fun goalProgress(items: List<Row>, goal: Row) = linkedTo(items, goal).let { t -> Progress(t.count { it.status == "done" }, t.size) }

// A goal's tasks, open ones first then done, and its done/total count.
fun goalTasks(items: List<Row>, goal: Row): List<Row> = linkedTo(items, goal).sortedBy { it.status != "open" }

class Week(val start: Long, val label: String, val goals: List<Row>)

const val GOAL_WEEKS = 8

// Goals of next week, this week and the 7 before it, newest first; weeks without goals are left out.
fun goalHistory(items: List<Row>, now: Long, profile: String? = null): List<Week> {
    val monday = weekStart(now)
    val out = ArrayList<Week>()
    for (i in -1 until GOAL_WEEKS) {
        val day = dayPlus(monday, -7L * i) + 12 * 3_600_000L
        val goals = goalsOf(items, day, profile)
        if (goals.isEmpty()) continue
        val label = when (i) {
            -1 -> "Next week"
            0 -> "This week"
            1 -> "Last week"
            else -> DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH).format(Instant.ofEpochMilli(day).atZone(codexZone))
        }
        out.add(Week(weekStart(day), label, goals))
    }
    return out
}

fun titleKey(t: String?) = (t ?: "").trim().lowercase()

// Why a goal of this week cannot move to next week, if it cannot.
fun moveBlock(items: List<Row>, goal: Row, now: Long): String? {
    val mine = goalsOf(items, dayPlus(weekStart(now), 7), goal.profile)
    if (mine.size >= MAX_GOALS) return "Next week is full ($MAX_GOALS goals)"
    return if (mine.any { titleKey(it.title) == titleKey(goal.title) }) "Already a goal next week with this title" else null
}

// Item and meeting hits of the search: every word of the query must appear in the row.
class Hit(val row: Row, val title: String, val snippet: String)
class Hits(val tasks: List<Hit>, val meetings: List<Hit>) { val total get() = tasks.size + meetings.size }

fun snippet(words: List<String>, vararg texts: String?): String {
    for (t in texts) {
        if (t.isNullOrBlank()) continue
        val low = t.lowercase()
        val i = words.map { low.indexOf(it) }.filter { it >= 0 }.minOrNull() ?: continue
        val from = maxOf(0, i - 30)
        return (if (from > 0) "…" else "") + t.substring(from, minOf(t.length, from + 90)).replace('\n', ' ').trim()
    }
    return ""
}

fun searchAll(items: List<Row>, meetings: List<Row>, query: String, profile: String?): Hits {
    val words = queryWords(query)
    if (words.isEmpty()) return Hits(emptyList(), emptyList())
    fun hits(vararg texts: String?) = words.all { w -> texts.joinToString(" ").lowercase().contains(w) }
    val tasks = items.filter { !it.deleted && matchesProfile(profile, it) && it.status !in listOf("dismissed", "point", "raised", GOAL) && hits(it.title, it.text, it.people, it.source) }
        .sortedByDescending { it.updatedAt }.map { Hit(it, it.title ?: it.text ?: "Untitled", snippet(words, it.text, it.people, it.source)) }
    val found = meetings.filter { !it.deleted && matchesProfile(profile, it) && hits(it.title, it.str("people"), it.str("notes"), it.str("summary"), it.str("decisions")) }
        .sortedByDescending { it.startsAt ?: 0L }.map { Hit(it, it.title ?: "Meeting", snippet(words, it.str("summary"), it.str("decisions"), it.str("notes"), it.str("people"))) }
    return Hits(tasks, found)
}
