package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.codex.meetings.othersOf
import no.pradhan.agentview.nativeapp.codex.meetings.peopleOf
import no.pradhan.agentview.nativeapp.codex.meetings.sameName

// web/src/codex/data/points.ts and meetings.ts pinsOf: points to raise with one person, and pinned text of a meeting.
const val POINT = "point"
const val RAISED = "raised"

private fun isPoint(r: Row) = !r.deleted && r.status == POINT && !r.people.isNullOrBlank()
fun firstName(name: String) = name.trim().split(Regex("\\s+")).firstOrNull()?.ifEmpty { null } ?: name

// The first meeting with the point's person that starts after the point was raised.
fun pointMeeting(point: Row, meetings: List<Row>): Row? = firstMeeting(point, liveRows(meetings))

private fun firstMeeting(point: Row, live: List<Row>): Row? {
    val since = point.madeAt
    return live.filter { m -> m.profile == point.profile && m.startsAt != null && m.startsAt!! >= since && peopleOf(m).any { sameName(it, point.people!!) } }.minByOrNull { it.startsAt!! }
}

fun pointsOf(items: List<Row>, person: String) = items.filter { isPoint(it) && sameName(it.people!!, person) }.sortedBy { it.madeAt }
fun pointsFor(m: Row, items: List<Row>, meetings: List<Row>): List<Row> {
    val live = liveRows(meetings)
    return items.filter { isPoint(it) && firstMeeting(it, live)?.key == m.key }.sortedBy { it.madeAt }
}

// Open points whose meeting has ended.
fun endedPoints(items: List<Row>, meetings: List<Row>, now: Long): List<Row> {
    val points = items.filter(::isPoint)
    if (points.isEmpty()) return emptyList()
    val live = liveRows(meetings)
    return points.filter { r -> firstMeeting(r, live)?.let { m -> (m.endsAt ?: m.startsAt!!) <= now } == true }
}

// Attendees of the given meeting first, then of the latest meetings of the profile that have started.
fun recentPeople(meetings: List<Row>, profile: String, first: Row?, now: Long, max: Int = 6): List<String> {
    val recent = liveRows(meetings).filter { it.profile == profile && it.startsAt != null && it.startsAt!! <= now }.sortedByDescending { it.startsAt }
    val out = ArrayList<String>()
    for (m in (if (first != null) listOf(first) + recent else recent)) {
        for (p in peopleOf(m)) {
            if (out.size >= max) return out
            if (out.none { sameName(p, it) }) out.add(p)
        }
    }
    return out
}

fun pinsOf(items: List<Row>, meetings: List<Row>): List<Row> {
    val ids = meetings.map { it.key }.toSet()
    return items.filter { !it.deleted && it.status == "note" && it.meetingId != null && "${it.profile}:${it.meetingId}" in ids }.sortedByDescending { it.updatedAt }
}

// Raise and pin save a row through the store, each with one undo.
class PointActions(private val store: CodexStore, private val snack: (String, (() -> Unit)?) -> Unit) {
    fun raise(text: String, person: String, profile: String): Boolean {
        val row = store.capture(text, "note", profile, null, mapOf("status" to POINT, "source" to "raise", "people" to person)) ?: return false
        snack("Raise with ${firstName(person)} next time") { store.update(row, mapOf("deleted" to true)) }
        return true
    }

    fun tick(r: Row) {
        if (store.update(r, mapOf("status" to RAISED))) snack("Raised") { store.update(r, mapOf("status" to POINT)) }
    }

    fun pin(text: String, m: Row): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return false
        val row = store.capture(t, "note", m.profile, null, mapOf("source" to "action", "people" to m.title, "meeting_id" to m.id, "title" to t.take(120), "text" to t))
        snack(if (row != null) "Pinned" else "Not pinned", null)
        return row != null
    }

    fun unpin(r: Row) {
        if (store.update(r, mapOf("deleted" to true))) snack("Unpinned") { store.update(r, mapOf("deleted" to false)) }
    }
}

// web/src/codex/overview/digest.ts and meetings/Prep.tsx: one group per kind, the first 3 rows of a folded group and Show all.
class DigestLine(val title: String, val meta: String? = null, val open: (() -> Unit)? = null)
class DigestGroup(val outcome: String, val label: String, val rows: List<DigestLine>, val open: Boolean)

const val FOLDED_ROWS = 3

fun visibleRows(g: DigestGroup, all: Boolean, capOpen: Boolean = false) = if ((g.open && !capOpen) || all) g.rows else g.rows.take(FOLDED_ROWS)

// What the meeting's attendees took on in the given earlier meetings, as "Name: what".
fun theirActions(m: Row, earlier: List<Row>): List<String> =
    earlier.flatMap { x -> othersOf(x).filter { o -> peopleOf(m).any { sameName(it, o.who) } }.map { "${firstName(it.who)}: ${it.what}" } }.distinct()
