package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.codex.meetings.isBlock
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import no.pradhan.agentview.nativeapp.codex.meetings.linksOf
import no.pradhan.agentview.nativeapp.codex.wiki.proposals
import no.pradhan.agentview.nativeapp.net.Ask
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.ui.plural

// The pieces of the Codex Overview (web/src/codex Overview.tsx, split.ts, NeedsYou.tsx, data/meetings.ts, data/goals.ts).

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

sealed class Need(val keys: List<String>, val marks: List<String> = emptyList()) {
    class Overdue(val row: Row) : Need(listOf("task:${row.key}"))
    class Risk(val row: Row, val due: Long, val short: Long) : Need(listOf("task:${row.key}"))
    class Slack(val bullet: Bullet, val brief: Row) : Need(listOf(bullet.url?.let { "url:$it" } ?: "slack:${bullet.title}")) { val profile get() = brief.profile }
    class OverdueAll(val rows: List<Row>) : Need(emptyList())
    class Ask(val row: Row) : Need(listOf("task:${row.key}"), listOfNotNull(row.sourceUrl?.takeIf { it.startsWith("http") }?.let { "url:$it" }))
    class Dm(val chat: Row) : Need(listOf("chat:${chat.key}") + listOfNotNull(chat.str("url")?.let { "url:$it" }))
    class JustEnded(val row: Row, val meeting: Row) : Need(listOf("task:${row.key}"))
    class StaleAsks(val count: Int, val oldest: Long) : Need(listOf("stale-asks"))
    class Wiki(val count: Int) : Need(listOf("wiki-claims"))

    val isTask get() = this is Overdue || this is OverdueAll || this is JustEnded || this is Risk
}

// Each item once, in rank order: overdue tasks, asks to confirm, DMs waiting on me, then actions of meetings that just ended.
// Three or more overdue tasks collapse into one entry.
// Dismissed bullets are stored on the brief row, so every device hides them.
fun dismissedOf(brief: Row) = dismissedKeys(brief.str("dismissed"))

// shared/dismissed.ts: one line per dismissal ("+key\tat") or undo ("-key\tat"), merged as a set; the latest line per key decides.
private const val DISMISSED_KEEP = 100

private class DismissLine(val key: String, val on: Boolean, val at: Long, val raw: String)

private fun dismissLines(v: String?) = v.orEmpty().split("\n").filter { it.isNotEmpty() }.map { raw ->
    val tab = raw.lastIndexOf('\t')
    if ((raw[0] != '+' && raw[0] != '-') || tab < 0) DismissLine(raw, true, 0, raw)
    else DismissLine(raw.substring(1, tab), raw[0] == '+', raw.substring(tab + 1).toLongOrNull() ?: 0, raw)
}

fun dismissedKeys(v: String?): List<String> {
    val latest = LinkedHashMap<String, DismissLine>()
    for (l in dismissLines(v)) if ((latest[l.key]?.at ?: -1) <= l.at) latest[l.key] = l
    return latest.values.filter { it.on }.map { it.key }
}

fun mergeDismissed(a: String?, b: String?): String? {
    val all = LinkedHashMap<String, DismissLine>()
    for (l in dismissLines(a) + dismissLines(b)) all[l.raw] = l
    return all.values.sortedBy { it.at }.takeLast(DISMISSED_KEEP).joinToString("\n") { it.raw }.ifEmpty { null }
}

fun withDismissal(v: String?, key: String, on: Boolean, at: Long) = mergeDismissed(v, "${if (on) "+" else "-"}$key\t$at")

fun needsYou(items: List<Row>, meetings: List<Row>, chats: List<Row>, profile: String?, now: Long, facts: List<Row> = emptyList(), briefs: List<Row> = emptyList(), s: Split = split(items, profile, now)): List<Need> {
    val mt = meetingsOf(meetings, profile, now)
    val ended = mt.today.filter { it.endsAt != null && it.endsAt!! <= now && now - it.endsAt!! < JUST_ENDED_MS }
    val dms = chats.filter { !it.deleted && it.str("kind") == "dm" && it.long("waiting") == 1L && matchesProfile(profile, it) }.sortedByDescending { it.long("last_at") ?: 0L }
    // A Slack summary older than the stale-ask age is out of date; its bullets are not shown.
    val brief = briefs.filter { !it.deleted && it.str("kind") == "slack" && matchesProfile(profile, it) && now - (it.long("to_at") ?: 0L) <= STALE_DAYS * DAY_MS }.maxByOrNull { it.long("to_at") ?: 0L }
    val bullets = brief?.str("text")?.let(::briefBullets)?.filter { it.key !in dismissedOf(brief) } ?: emptyList()
    val timed = meetings.filter { !it.deleted && matchesProfile(profile, it) && it.startsAt != null && it.endsAt != null && it.endsAt!! > it.startsAt!! && it.endsAt!! - it.startsAt!! < 20 * 3_600_000L }
    val minute = now / 60_000 * 60_000
    val blocked = timed.filter { isBlock(it) && it.endsAt!! > minute }.map { "${it.profile}:${it.id}" }.toSet()
    val dated = (s.overdue + s.today + s.later).filter { it.at != null && "${it.profile}:block:${it.id}" !in blocked }
    val risk = atRisk(dated.map { it to it.at!! }, timed.map { it.startsAt!! to it.endsAt!! }, minute)
    val old = staleAsks(replyQueue(s.review, null, now), now)
    val claims = proposals(facts.filter { matchesProfile(profile, it) }).size
    val groups = listOf<List<Need>>(
        s.overdue.map { Need.Overdue(it) },
        risk.map { (row, short) -> Need.Risk(row, row.at!!, short) },
        s.review.filter { !queued(it) }.map { Need.Ask(it) },
        dms.map { Need.Dm(it) },
        bullets.map { Need.Slack(it, brief!!) },
        ended.flatMap { m -> actionsOf(items, m).filter { it.status == "open" }.map { Need.JustEnded(it, m) } },
        if (old.isNotEmpty()) listOf(Need.StaleAsks(old.size, old.minOf { it.statusTime })) else emptyList(),
        if (claims > 0) listOf(Need.Wiki(claims)) else emptyList(),
    )
    val seen = HashSet<String>()
    val ranked = groups.flatten().filter { n ->
        if (n.keys.any { it in seen }) false else { seen.addAll(n.keys + n.marks); true }
    }
    val overdue = ranked.filterIsInstance<Need.Overdue>()
    if (overdue.size < 3) return ranked
    val first = ranked.indexOfFirst { it is Need.Overdue }
    return ranked.subList(0, first) + Need.OverdueAll(overdue.map { it.row }) + ranked.subList(first, ranked.size).filter { it !is Need.Overdue }
}

fun needsList(st: CodexState, profile: String?, now: Long) = needsYou(st.items, st.meetings, st.chats, profile, now, st.facts, st.briefs)

class NeedsView(val list: List<Need>, val queue: List<Row>) { val total get() = list.size + queue.size }

fun needsView(st: CodexState, profile: String?, now: Long): NeedsView {
    val s = split(st.items, profile, now)
    return NeedsView(needsYou(st.items, st.meetings, st.chats, profile, now, st.facts, st.briefs, s), replyQueue(s.review, profile, now))
}

fun doneCount(done: Int, open: Int) = if (done > 0) "$done of ${done + open} done" else null

// The tasks the Today list shows for the Overview, split the way Overview.tsx does it.
class Today(val upNextTask: Row?, val todo: List<Row>, val late: List<Row>, val openCount: Int)

fun riskKeys(needs: List<Need>) = needs.filterIsInstance<Need.Risk>().map { it.row.key }.toSet()

fun overviewToday(s: Split, next: Row?, now: Long, risky: Set<String> = emptySet()): Today {
    val due = dueToday(s, now).filter { it.status == "open" }
    val openLate = s.overdue.filter { it.status == "open" }
    val late = openLate.filter { it.key !in risky }
    val todo = due.filter { it.key !in risky }.sortedBy { it.at ?: 0L }
    val task = if (next == null) todo.firstOrNull() else null
    val open = (due + openLate).distinctBy { it.key }.size
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
    fun hits(vararg texts: String?) = texts.joinToString(" ") { it.orEmpty() }.lowercase().let { hay -> words.all { hay.contains(it) } }
    val tasks = items.filter { !it.deleted && matchesProfile(profile, it) && it.status !in listOf("dismissed", "point", "raised", GOAL) && hits(it.title, it.text, it.people, it.source) }
        .sortedByDescending { it.updatedAt }.map { Hit(it, it.title ?: it.text ?: "Untitled", snippet(words, it.text, it.people, it.source)) }
    val found = meetings.filter { !it.deleted && matchesProfile(profile, it) && hits(it.title, it.str("people"), it.str("notes"), it.str("summary"), it.str("decisions")) }
        .sortedByDescending { it.startsAt ?: 0L }.map { Hit(it, it.title ?: "Meeting", snippet(words, it.str("summary"), it.str("decisions"), it.str("notes"), it.str("people"))) }
    return Hits(tasks, found)
}
