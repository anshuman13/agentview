package no.pradhan.agentview.nativeapp.codex.meetings

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.SYNCED_FIELDS
import no.pradhan.agentview.nativeapp.codex.actionsOf
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.codex.dayEnd
import no.pradhan.agentview.nativeapp.codex.dayPlus
import no.pradhan.agentview.nativeapp.codex.dayStart
import no.pradhan.agentview.nativeapp.codex.edited
import no.pradhan.agentview.nativeapp.codex.isEvent
import no.pradhan.agentview.nativeapp.codex.isSolo
import no.pradhan.agentview.nativeapp.codex.othersOf
import no.pradhan.agentview.nativeapp.codex.peopleOf
import no.pradhan.agentview.nativeapp.codex.weekdayDate
import no.pradhan.agentview.nativeapp.codex.whenText
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.sessions.matchesWords
import no.pradhan.agentview.nativeapp.sessions.queryWords

// The Meetings list and page, person page and wiki lookups of web/src/codex (data/meetings.ts, data/wiki.ts).

fun jsonList(s: String?): List<String> {
    if (s.isNullOrBlank()) return emptyList()
    return runCatching { (protocolJson.parseToJsonElement(s) as JsonArray).mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.contentOrNull } }.getOrDefault(emptyList())
}

class MeetingLink(val title: String, val url: String) {
    val domain get() = url.substringAfter("://").substringBefore('/').removePrefix("www.")
}

// The ticket, doc and thread links the calendar import found on the event.
fun linksOf(m: Row): List<MeetingLink> = runCatching {
    (protocolJson.parseToJsonElement(m.str("links") ?: "[]") as JsonArray).mapNotNull {
        val o = it as? JsonObject ?: return@mapNotNull null
        val title = (o["title"] as? JsonPrimitive)?.contentOrNull; val url = safeHref((o["url"] as? JsonPrimitive)?.contentOrNull)
        if (title != null && url != null) MeetingLink(title, url) else null
    }
}.getOrDefault(emptyList())

fun liveRows(rows: List<Row>) = rows.filter { !it.deleted && (it.str("state") ?: "live") == "live" }

private fun weekdayShort(t: Long): String = DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH).format(Instant.ofEpochMilli(t).atZone(codexZone))

class MeetingGroup(val label: String, val rows: List<Row>)

// Meetings that have started, newest day first and in time order within a day.
fun groupMeetings(meetings: List<Row>, now: Long): List<MeetingGroup> {
    val today = dayStart(now)
    val past = liveRows(meetings).filter { it.startsAt != null && it.startsAt!! <= now }
    val sorted = past.sortedWith(compareByDescending<Row> { dayStart(it.startsAt!!) }.thenBy { it.startsAt })
    val out = ArrayList<MeetingGroup>()
    var lastDay = -1L
    var label = ""
    var rows = ArrayList<Row>()
    for (m in sorted) {
        val d = dayStart(m.startsAt!!)
        if (d != lastDay) {
            if (rows.isNotEmpty()) out.add(MeetingGroup(label, rows))
            rows = ArrayList()
            label = if (d == today) "Today" else weekdayDate(m.startsAt!!)
            lastDay = d
        }
        rows.add(m)
    }
    if (rows.isNotEmpty()) out.add(MeetingGroup(label, rows))
    return out
}

// The coming week grouped by day; a meeting already running counts for today.
fun comingDays(meetings: List<Row>, now: Long): List<MeetingGroup> {
    val today = dayStart(now)
    val end = dayPlus(today, 7)
    val ahead = liveRows(meetings).filter { it.startsAt != null && (it.endsAt ?: it.startsAt!!) > now && it.startsAt!! < end }.sortedBy { it.startsAt }
    val byDay = LinkedHashMap<Long, MutableList<Row>>()
    for (m in ahead) byDay.getOrPut(maxOf(today, dayStart(m.startsAt!!))) { ArrayList() }.add(m)
    return byDay.map { (d, rows) -> MeetingGroup(if (d == today) "Today" else if (d == dayEnd(now)) "Tomorrow" else weekdayDate(d), rows) }
}

enum class MState { Upcoming, Live, Waiting, Done, Missing, Manual }

// Where a meeting is between the calendar and its transcript.
fun meetingState(m: Row, now: Long): MState {
    if (!m.id.startsWith("cal:")) return MState.Manual
    val start = m.startsAt
    if (start != null && start > now) return MState.Upcoming
    if ((m.endsAt ?: start ?: 0L) > now) return MState.Live
    if (isSolo(m)) return MState.Manual
    val t = m.str("transcript")
    if (t == "missing") return MState.Missing
    if (t == "done" || (t.isNullOrEmpty() && !m.str("summary").isNullOrEmpty())) return MState.Done
    return MState.Waiting
}

class ActionCount(val total: Int, val done: Int, val review: Int, val unassigned: Int, val dismissed: Int)

fun actionCount(items: List<Row>, m: Row): ActionCount {
    var total = 0; var done = 0; var review = 0; var unassigned = 0; var dismissed = 0
    for (r in actionsOf(items, m)) {
        val st = r.status
        if (!r.str("assignee").isNullOrEmpty() && (st == "open" || st == "done")) continue
        when (st) {
            "open" -> total++
            "done" -> { total++; done++ }
            "suggested" -> review++
            "unassigned" -> unassigned++
            "dismissed" -> dismissed++
        }
    }
    return ActionCount(total, done, review, unassigned, dismissed)
}

val MEETING_CHIPS = listOf("Mine", "With actions", "Not recorded", "Series")

private const val MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?"
private val SERIES_NOISE = Regex("\\([^)]*\\d[^)]*\\)|\\d{4}-\\d{2}-\\d{2}|\\b$MONTH\\s*\\d{1,2}\\b|\\b\\d{1,2}\\s*$MONTH|#\\s*\\d+|\\b\\d+\\b")
fun seriesTitle(t: String?) = (t ?: "").lowercase().replace(SERIES_NOISE, " ").replace(Regex("\\s+"), " ").trim()

private fun words(s: String): List<String> {
    val t = s.trim()
    return (if ('@' in t) t.substring(0, t.indexOf('@')).replace(Regex("[._+-]+"), " ") else t).split(Regex("\\s+")).filter { it.isNotEmpty() }
}

// A person's name, or "First Last" derived from an email like first.last@host.
fun displayName(s: String) = if ('@' in s) words(s).joinToString(" ") { it[0].uppercase() + it.drop(1).lowercase() }.ifEmpty { s.trim() } else s.trim()
fun sameName(a: String, b: String) = words(a).joinToString(" ").lowercase() == words(b).joinToString(" ").lowercase()

fun sharesGuests(people: List<String>, other: List<String>): Boolean {
    if (people.isEmpty() || other.isEmpty()) return people.size == other.size
    return people.count { p -> other.any { sameName(p, it) } } * 2 >= minOf(people.size, other.size)
}

// Keys (profile:id) of meetings in a recurring series of two or more.
fun inSeries(meetings: List<Row>): Set<String> {
    val out = HashSet<String>()
    val buckets = liveRows(meetings).filter { it.startsAt != null && seriesTitle(it.title).isNotEmpty() }.groupBy { it.profile + "\n" + seriesTitle(it.title) }
    for (group in buckets.values) {
        if (group.size < 2) continue
        val guests = group.map { peopleOf(it) }
        group.forEachIndexed { i, m -> if (group.indices.any { j -> j != i && sharesGuests(guests[i], guests[j]) }) out.add(m.key) }
    }
    return out
}

// Past meetings that pass every chip that is on; no chips keeps them all.
fun filterMeetings(meetings: List<Row>, items: List<Row>, chips: Set<String>, now: Long): List<Row> {
    if (chips.isEmpty()) return meetings
    val series = if ("Series" in chips) inSeries(meetings) else null
    return meetings.filter { m ->
        if ("Mine" in chips && m.long("organizer_me") != 1L) return@filter false
        if ("With actions" in chips) {
            val c = actionCount(items, m)
            if (!(c.total > c.done || c.review > 0)) return@filter false
        }
        if ("Not recorded" in chips && meetingState(m, now) != MState.Missing) return@filter false
        series == null || m.key in series
    }
}

fun searchMeetings(meetings: List<Row>, query: String): List<Row> {
    val w = queryWords(query)
    if (w.isEmpty()) return meetings
    return meetings.filter { matchesWords(w, it.title, it.str("people"), it.str("notes"), it.str("summary"), it.str("decisions")) }
}

// The page's meta line: weekday and time span, room, number of people and recorded minutes.
fun pageMeta(m: Row): String {
    val n = peopleOf(m).size
    val start = m.startsAt
    val time = if (start != null) "${weekdayShort(start)} ${clock(start)}${m.endsAt?.let { "-${clock(it)}" } ?: ""}" else ""
    val rec = m.long("recorded_ms")?.takeIf { it > 0 }?.let { "Recorded ${Math.round(it / 60000.0)} min" }
    if (isEvent(m)) return time
    return listOfNotNull(time.ifEmpty { null }, m.str("room")?.takeIf { it.isNotEmpty() }, if (n > 0) (if (n == 1) "1 person" else "$n people") else null, rec).joinToString(" · ")
}

fun stateLine(m: Row, now: Long): String? = when (meetingState(m, now)) {
    MState.Upcoming -> "Starts ${whenText(m.startsAt!!, now)}"
    MState.Live -> "In progress"
    MState.Waiting -> "Waiting for the transcript"
    MState.Missing -> "No transcript for this meeting"
    else -> null
}

class Decision(val meeting: Row, val text: String, val at: Long)

fun decisionLog(meetings: List<Row>): List<Decision> =
    liveRows(meetings).flatMap { m -> jsonList(m.str("decisions")).map { it.trim() }.filter { it.isNotEmpty() }.map { Decision(m, it, m.startsAt ?: m.updatedAt) } }.sortedByDescending { it.at }

fun nameOf(meetings: List<Row>, person: String): String =
    if ('@' in person) liveRows(meetings).flatMap { peopleOf(it) }.firstOrNull { '@' !in it && sameName(it, person) } ?: displayName(person) else person.trim()

// Meetings the person attended, newest first.
fun meetingsWith(meetings: List<Row>, person: String) =
    liveRows(meetings).filter { m -> peopleOf(m).any { sameName(it, person) } }.sortedByDescending { it.startsAt ?: 0L }

class Commitment(val meeting: Row, val what: String)

fun commitmentsOf(meetings: List<Row>, person: String) =
    meetingsWith(meetings, person).flatMap { m -> othersOf(m).filter { sameName(it.who, person) }.map { Commitment(m, it.what) } }

const val MAX_PEOPLE = 8

class Prior(val meeting: Row, val decisions: List<String>, val open: List<Row>)

// The last two earlier meetings of the profile that share the title or an attendee (meetings of up to 8 people only), newest first.
fun priorWith(meeting: Row, meetings: List<Row>, items: List<Row>): List<Prior> {
    val people = peopleOf(meeting)
    val title = meeting.title?.trim()?.lowercase()
    val start = meeting.startsAt ?: return emptyList()
    return liveRows(meetings)
        .filter { m ->
            val at = m.startsAt
            at != null && at < start && m.profile == meeting.profile && m.id != meeting.id &&
                ((!title.isNullOrEmpty() && m.title?.trim()?.lowercase() == title) || (peopleOf(m).size <= MAX_PEOPLE && peopleOf(m).any { p -> people.any { sameName(p, it) } }))
        }
        .sortedByDescending { it.startsAt }.take(2)
        .map { m -> Prior(m, jsonList(m.str("decisions")), actionsOf(items, m).filter { it.status == "open" }) }
}

class Brief(val tasks: List<Pair<String, List<Row>>>, val claims: List<Row>)

fun contestAt(f: Row): Long = f.str("contested")?.let { s -> runCatching { (protocolJson.parseToJsonElement(s) as kotlinx.serialization.json.JsonObject)["at"]?.let { (it as JsonPrimitive).content.toDouble().toLong() } }.getOrNull() } ?: 0L
fun factTime(f: Row) = maxOf(f.long("at") ?: 0L, contestAt(f), f.updatedAt)

// Open tasks that mention each attendee and up to three current claims that name an attendee or match the title.
fun briefFor(meeting: Row, items: List<Row>, facts: List<Row>): Brief {
    val people = peopleOf(meeting)
    val open = items.filter { !it.deleted && it.status == "open" && it.source != "calendar" && !(it.meetingId == meeting.id && it.profile == meeting.profile) }
    val tasks = people.map { p -> p to open.filter { matchesWords(listOf(p.lowercase()), it.title, it.text, it.people) } }.filter { it.second.isNotEmpty() }
    val hits = (people.map { queryWords(it) } + listOf(queryWords(meeting.title ?: ""))).filter { it.isNotEmpty() }
    val claims = liveRows(facts).filter { it.str("superseded_by").isNullOrEmpty() && hits.any { w -> matchesWords(w, it.str("text")) } }.sortedByDescending { factTime(it) }.take(3)
    return Brief(tasks, claims)
}

// Current claims whose text names the person.
fun claimsMentioning(facts: List<Row>, person: String): List<Row> {
    val name = person.trim().lowercase()
    if (name.isEmpty()) return emptyList()
    return liveRows(facts).filter { it.str("superseded_by").isNullOrEmpty() && it.str("text")?.lowercase()?.contains(name) == true }.sortedByDescending { factTime(it) }
}

// A meeting made on the phone to write notes in; the web's Take notes.
fun newNotes(profile: String, now: Long, id: String = java.util.UUID.randomUUID().toString()): Row {
    val blank = Row("meetings", id, profile, updatedAt = now, f = SYNCED_FIELDS.getValue("meetings").associateWith { kotlinx.serialization.json.JsonNull })
    return edited(blank, mapOf("title" to "Notes", "starts_at" to now, "notes" to ""), now)
}
