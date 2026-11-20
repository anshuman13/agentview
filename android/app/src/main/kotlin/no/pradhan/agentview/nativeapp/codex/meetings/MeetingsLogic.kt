package no.pradhan.agentview.nativeapp.codex.meetings

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
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
import no.pradhan.agentview.nativeapp.codex.DAY_MS
import no.pradhan.agentview.nativeapp.codex.isSaid
import no.pradhan.agentview.nativeapp.codex.liveRows
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.split
import no.pradhan.agentview.nativeapp.codex.firstName
import no.pradhan.agentview.nativeapp.codex.weekdayDate
import no.pradhan.agentview.nativeapp.codex.ymd
import no.pradhan.agentview.nativeapp.codex.whenText
import no.pradhan.agentview.nativeapp.codex.wiki.factTime
import no.pradhan.agentview.nativeapp.codex.wiki.proposals
import no.pradhan.agentview.nativeapp.net.Ask
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.sessions.matchesWords
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.ui.plural

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

// A calendar meeting that has started has a transcript to read.
fun readable(m: Row, now: Long) = m.id.startsWith("cal:") && (m.startsAt ?: Long.MAX_VALUE) <= now

fun readLabel(state: MState): String? = when (state) {
    MState.Waiting -> "Read now"
    MState.Missing -> "Retry"
    else -> null
}

private val UNTICKED = Regex("""^\s*[-*]\s+\[ \]\s+(.+)$""")

fun normalizeTitle(t: String) = t.lowercase().replace(Regex("""[^\p{L}\p{N}]+"""), " ").trim()

// Mirrors shared/noteActions.ts: the unticked "- [ ] text" lines of the notes that no title matches yet, once strip has taken the due date out.
fun unmadeActions(notes: String, titles: List<String>, strip: (String) -> String): List<String> {
    val seen = titles.map(::normalizeTitle).toMutableSet()
    val out = mutableListOf<String>()
    for (line in notes.split('\n')) {
        val text = UNTICKED.find(line)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() } ?: continue
        val key = normalizeTitle(strip(text).ifEmpty { text })
        if (key.isEmpty() || !seen.add(key)) continue
        out.add(text)
    }
    return out
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
    return listOfNotNull(time.ifEmpty { null }, m.str("room")?.takeIf { it.isNotEmpty() }, if (n > 0) plural(n, "person", "people") else null, rec).joinToString(" · ")
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

private val SAFE_LINK = Regex("^(https?:|mailto:)", RegexOption.IGNORE_CASE)

// A link that is safe to open: web or mail, never javascript: or a file.
fun safeHref(url: String?) = url?.takeIf { SAFE_LINK.containsMatchIn(it) }

fun isBlock(m: Row) = m.id.startsWith("block:")
fun isSolo(m: Row) = m.id.startsWith("cal:") && m.str("people") == "[]"

private val CALL_HOSTS = listOf("meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "whereby.com")

fun isEvent(m: Row) = isSolo(m) && linksOf(m).none { l -> runCatching { java.net.URI(l.url).host?.lowercase() }.getOrNull().orEmpty().let { h -> CALL_HOSTS.any { h == it || h.endsWith(".$it") } } }

fun peopleOf(m: Row): List<String> {
    val s = m.str("people") ?: return emptyList()
    val list = if (s.startsWith("[")) runCatching { (protocolJson.parseToJsonElement(s) as JsonArray).mapNotNull { (it as? JsonPrimitive)?.contentOrNull } }.getOrDefault(emptyList()) else s.split(",")
    return list.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
}

// Mirrors hasContent, toMarkdown and followUpText of web/src/codex/data/meetings/meetingMarkdown.ts; shared/fixtures/meeting-copy.json holds the texts.
fun hasContent(m: Row, actions: List<Row>) =
    !m.str("summary").isNullOrBlank() || jsonList(m.str("decisions")).isNotEmpty() || actions.any { it.status == "open" }

fun meetingMarkdown(m: Row, actions: List<Row>): String {
    val date = m.startsAt?.let(::ymd)
    val people = peopleOf(m)
    val decisions = jsonList(m.str("decisions"))
    val todo = actions.filter { it.status == "open" }
    val out = mutableListOf("# ${m.title ?: "Meeting"}${if (date != null) " ($date)" else ""}")
    if (people.isNotEmpty()) out.add("Attendees: ${people.joinToString(", ")}")
    m.str("summary")?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add("## Summary\n\n$it") }
    if (decisions.isNotEmpty()) out.add("## Decisions\n\n${decisions.joinToString("\n") { "- $it" }}")
    if (todo.isNotEmpty()) out.add("## Actions\n\n${todo.joinToString("\n") { "- [ ] ${it.title ?: ""}" }}")
    return out.joinToString("\n\n") + "\n"
}

// Mirrors personMarkdown of web/src/codex/data/meetings/meetingMarkdown.ts; shared/fixtures/person-copy.json holds the texts.
fun personMarkdown(name: String, commitments: List<Commitment>, questions: List<Question>, tasks: List<Row>, points: List<Row>, pins: List<Row>, meetings: List<Row>, claims: List<Row>): String {
    val sections = listOf(
        "Commitments" to commitments.map { "${it.what} (${it.meeting.title ?: "Meeting"})" },
        "Open questions" to questions.map { it.text },
        "Open tasks" to tasks.map { it.title ?: "" },
        "To raise" to points.map { it.title ?: "" },
        "Pinned" to pins.map { it.text?.trim()?.ifEmpty { null } ?: it.title ?: "" },
        "Meetings" to meetings.map { m -> "${m.title ?: "Meeting"}${m.startsAt?.let { " (${ymd(it)})" } ?: ""}" },
        "In the wiki" to claims.map { it.text ?: "" },
    )
    val out = mutableListOf("# $name")
    for ((head, lines) in sections) if (lines.isNotEmpty()) out.add("## $head\n\n${lines.joinToString("\n") { "- $it" }}")
    return out.joinToString("\n\n") + "\n"
}

class ActionMenu(val notMine: Boolean, val assign: Boolean, val snooze: Boolean)

// Which menu items a meeting action shows for its status (shared/actionMenu.ts, checked by shared/fixtures/action-menu.json). Delete shows for every status.
fun actionMenu(status: String): ActionMenu {
    val live = status == "open" || status == "suggested"
    return ActionMenu(live, status == "open", live)
}

// The More menu items of a task row in the Overview's Today list (shared/actionMenu.ts, checked by shared/fixtures/today-menu.json).
fun todayTaskMenu(late: Boolean) = if (late) listOf("moveToday", "snooze", "open") else listOf("snooze", "open")

// The name after "Is this yours? ·" on a meeting's group (shared/actionMenu.ts, checked by shared/fixtures/group-title.json).
fun meetingGroupTitle(title: String?, people: String?) = title?.takeIf { it.isNotEmpty() } ?: people?.takeIf { it.isNotEmpty() } ?: "Meeting"

class ActionGroup(val key: String, val rows: List<Row>)

// Suggested actions grouped by meeting, else by source with said promises apart (shared/actionMenu.ts, checked by shared/fixtures/action-groups.json).
fun actionGroups(rows: List<Row>): List<ActionGroup> {
    val groups = LinkedHashMap<String, MutableList<Row>>()
    for (r in rows) {
        val key = "${r.profile}:${r.meetingId.takeUnless { it.isNullOrEmpty() } ?: "source:${r.source ?: ""}${if (isSaid(r)) ":said" else ""}"}"
        groups.getOrPut(key) { mutableListOf() }.add(r)
    }
    return groups.map { (k, v) -> ActionGroup(k, v) }
}

fun followUpText(m: Row, actions: List<Row>): String {
    val people = peopleOf(m).map(::firstName)
    val decisions = jsonList(m.str("decisions"))
    val who = othersOf(m).map { "- ${firstName(it.who)}: ${it.what}" } + actions.filter { it.status == "open" }.map { "- I will ${it.title ?: ""}" }
    val out = mutableListOf("Hi ${if (people.isNotEmpty()) people.joinToString(", ") else "all"},", "Thanks for the time on ${m.title ?: "our meeting"}.")
    if (decisions.isNotEmpty()) out.add("What we decided:\n${decisions.joinToString("\n") { "- $it" }}")
    if (who.isNotEmpty()) out.add("Who does what:\n${who.joinToString("\n")}")
    out.add("Let me know if I missed anything."); out.add("Best,")
    return out.joinToString("\n\n") + "\n"
}

// Mirrors draftFor of web/src/codex/data/meetings/meetingMarkdown.ts; shared/fixtures/action-draft.json holds the texts.
fun draftFor(a: Row, m: Row): String {
    val date = m.startsAt?.let(::ymd)
    val out = mutableListOf(a.title ?: "")
    a.people?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add("Owner: $it") }
    out.add("From: ${m.title ?: "Meeting"}${if (date != null) " ($date)" else ""}")
    a.at?.let { out.add("Due: ${ymd(it)}") }
    return out.joinToString("\n")
}

// Mirrors agendaMarkdown of web/src/codex/data/meetings/meetingMarkdown.ts; shared/fixtures/agenda.json holds the texts.
fun agendaMarkdown(m: Row, points: List<Row>, actions: List<String>, questions: List<String>): String {
    val date = m.startsAt?.let(::ymd)
    val people = peopleOf(m)
    val out = mutableListOf("# Agenda: ${m.title ?: "Meeting"}${if (date != null) " ($date)" else ""}")
    if (people.isNotEmpty()) out.add("Attendees: ${people.joinToString(", ")}")
    listOf("To raise" to points.map { "${firstName(it.people ?: "")}: ${it.title ?: ""}" }, "Open actions" to actions, "Open questions" to questions)
        .forEach { (head, lines) -> if (lines.isNotEmpty()) out.add("## $head\n\n${lines.joinToString("\n") { "- [ ] $it" }}") }
    return out.joinToString("\n\n") + "\n"
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
    return listOfNotNull(time, m.str("room")?.takeIf { it.isNotEmpty() }, if (n > 0) plural(n, "person", "people") else null).joinToString(" · ")
}

// web/src/codex/data/tasks/review.ts: what waits on a person, from open tasks that name them and from sent mail with no reply.
@Serializable class Unanswered(val thread: String = "", val url: String = "", val to: String = "", val subject: String = "", @SerialName("sent_at") val sentAt: Long = 0)
fun unanswered(briefs: List<Row>): List<Unanswered> = briefs.filter { !it.deleted && it.str("kind") == "waiting" }.flatMap { b ->
    val list = try { protocolJson.decodeFromString(ListSerializer(Unanswered.serializer()), b.str("text") ?: "[]") } catch (e: Exception) { emptyList() }
    list.filter { it.to.isNotEmpty() && it.subject.isNotEmpty() }
}
class WaitingRow(val key: String, val title: String, val days: Int, val late: Boolean, val url: String? = null)
class Waiting(val name: String, val rows: List<WaitingRow>)

// Mirrors shared/waiting.ts, checked by shared/fixtures/late-promise.json: waiting over 3 workdays (Monday to Friday) is late.
fun isLate(since: Long, now: Long): Boolean {
    var d = Instant.ofEpochMilli(since).atZone(codexZone)
    var n = 0
    while (n < 3) {
        d = d.plusDays(1)
        if (d.dayOfWeek.value <= 5) n++
    }
    return now > d.toInstant().toEpochMilli()
}

private val WAITING_NAME = Regex("^(?:waiting\\s+(?:on|for)\\s+([^:,\\-\\n(]+)|@(\\S+))", RegexOption.IGNORE_CASE)
private val WAITING_WORD = Regex("\\bwaiting\\b", RegexOption.IGNORE_CASE)

private fun waitingOn(r: Row): String? {
    val title = r.title?.trim() ?: ""
    WAITING_NAME.find(title)?.let { m -> return (m.groupValues[1].ifEmpty { m.groupValues[2] }).trim().ifEmpty { null } }
    val first = r.people?.substringBefore(",")?.trim()
    return if (!first.isNullOrEmpty() && WAITING_WORD.containsMatchIn("$title ${r.text ?: ""}")) first else null
}

private fun daysSince(t: Long, now: Long) = maxOf(0L, (now - t) / DAY_MS).toInt()

fun waitingByPerson(items: List<Row>, briefs: List<Row>, profile: String?, now: Long): List<Waiting> {
    val groups = LinkedHashMap<String, Pair<String, MutableList<WaitingRow>>>()
    fun add(name: String, row: WaitingRow) = groups.getOrPut(name.lowercase()) { name to mutableListOf() }.second.add(row)
    for (r in items) {
        if (r.deleted || r.source == "calendar" || r.status != "open" || !matchesProfile(profile, r)) continue
        val name = waitingOn(r) ?: continue
        val title = (r.title ?: "").replace(WAITING_NAME, "").trimStart(' ', '\t', '\n', ':', ',', '-').trim().ifEmpty { r.title ?: "" }
        val created = minOf(r.updatedAt, *r.times.values.filter { it > 0 }.toLongArray())
        add(name, WaitingRow(r.key, title, daysSince(created, now), isLate(created, now)))
    }
    for (b in briefs) {
        if (b.deleted || b.str("kind") != "waiting" || !matchesProfile(profile, b)) continue
        for (w in unanswered(listOf(b))) add(w.to, WaitingRow("mail:${w.thread}", w.subject, daysSince(w.sentAt, now), isLate(w.sentAt, now), w.url.ifEmpty { null }))
    }
    return groups.values.map { (name, rows) -> Waiting(name, rows.sortedWith(compareByDescending<WaitingRow> { it.late }.thenByDescending { it.days })) }.sortedWith(compareByDescending<Waiting> { it.rows[0].late }.thenByDescending { it.rows[0].days }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
}

// web/src/codex/data/tasks/review.ts personInbox: the person a Slack or Gmail item names ("Ada · DM" or "Ada"), which of these items are asks to me.
private fun personOf(people: String?) = (people ?: "").substringBefore(" · ").replace(Regex("<[^>]*>"), "").trim()
private fun isAsk(r: Row) = !r.deleted && (r.source == "slack" || r.source == "gmail") && (r.status == "open" || r.status == "suggested")

class PersonInbox(val dm: Row?, val asks: List<Row>, val promises: List<Row>, val mail: List<Unanswered>)

fun personInbox(name: String, items: List<Row>, chats: List<Row>, mail: List<Unanswered>): PersonInbox {
    val theirs = items.filter { isAsk(it) && sameName(personOf(it.people), name) }
    return PersonInbox(
        liveRows(chats).firstOrNull { it.str("kind") == "dm" && !it.str("summary").isNullOrEmpty() && sameName(it.str("name") ?: "", name) },
        theirs.filter { !isSaid(it) },
        theirs.filter { isSaid(it) },
        mail.filter { sameName(personOf(it.to), name) },
    )
}

class Between(val title: String, val meta: String, val task: Row? = null, val url: String? = null)

// Up to 5 rows of what is open between me and a person: my promises, their asks, my mail they have not answered, then the DM thread.
fun betweenRows(inbox: PersonInbox, first: String): List<Between> {
    val dm = inbox.dm
    val rows = (
        inbox.promises.map { Between(it.title ?: "", "You told $first", it) } +
            inbox.asks.map { Between(it.title ?: "", "$first asked you", it) } +
            inbox.mail.map { Between(it.subject, "Waiting on $first", url = it.url) }
        ).take(if (dm != null) 4 else 5)
    return if (dm == null) rows else rows + Between("Slack DM", (dm.str("summary") ?: "").substringBefore("\n"), url = dm.str("url"))
}

class Segment(val text: String, val hit: Boolean)

// web/src/ui/util.tsx: splits text into plain and matched pieces for the words of a query, ignoring case. Overlapping or touching matches merge into one piece.
fun markSegments(text: String, words: List<String>): List<Segment> {
    if (words.isEmpty()) return listOf(Segment(text, false))
    val lower = text.lowercase()
    val ranges = words.flatMap { w ->
        generateSequence(lower.indexOf(w).takeIf { it >= 0 }) { lower.indexOf(w, it + 1).takeIf { i -> i >= 0 } }.map { it to it + w.length }.toList()
    }.sortedBy { it.first }
    val merged = ArrayList<Pair<Int, Int>>()
    for ((s, e) in ranges) {
        val last = merged.lastOrNull()
        if (last != null && s <= last.second) merged[merged.lastIndex] = last.first to maxOf(last.second, e) else merged.add(s to e)
    }
    val out = ArrayList<Segment>()
    var at = 0
    for ((s, e) in merged) {
        if (s > at) out.add(Segment(text.substring(at, s), false))
        out.add(Segment(text.substring(s, e), true))
        at = e
    }
    if (at < text.length) out.add(Segment(text.substring(at), false))
    return out
}

private const val MATCH_CAP = 500

fun matchLabel(count: Int) = when {
    count == 0 -> "No matches"
    count > MATCH_CAP -> "$MATCH_CAP+ matches"
    else -> "$count ${if (count == 1) "match" else "matches"}"
}

// The next current match from cur (-1 for none), wrapping at both ends.
fun stepMatch(cur: Int, dir: Int, count: Int) = if (cur < 0 && dir < 0) count - 1 else (cur + dir + count) % count

fun nudgeText(g: Waiting): String =
    "Hi ${g.name.substringBefore(" ")}, a quick nudge on ${g.rows.joinToString("; ") { it.title }}. Any update when you have a moment? Thanks!"
