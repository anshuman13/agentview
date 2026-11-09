package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.protocolJson

// web/src/codex/data/ask.ts askText: the question with the open items and, by profile, the meetings the chat needs.
private fun fmt(t: Long, pattern: String) = DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH).format(Instant.ofEpochMilli(t).atZone(codexZone))

private fun line(r: Row): String {
    val bits = listOfNotNull(r.source?.takeIf { it.isNotEmpty() && it != "capture" }, r.at?.let { "due ${fmt(it, "EEE HH:mm")}" }, r.sourceUrl?.takeIf { it.isNotEmpty() })
    return "- [${r.profile}] ${r.title ?: "(untitled)"}${if (bits.isNotEmpty()) " (${bits.joinToString(", ")})" else ""}"
}

private fun day(t: Long) = fmt(t, "EEE, d MMM")

private fun othersText(meetings: List<Row>, now: Long) = meetings.filter { !it.deleted && it.startsAt != null && it.startsAt!! > now - 14 * DAY_MS && it.startsAt!! < now }
    .flatMap { m -> othersOf(m).map { "- ${day(m.startsAt!!)} \"${m.title}\": ${it.who}: ${it.what}" } }.take(80)

private fun plansText(meetings: List<Row>, now: Long): String {
    val from = dayStart(now)
    val to = dayPlus(now, 4) - 1
    val plans = meetings.filter { !it.deleted && it.profile == PERSONAL && it.startsAt != null && it.startsAt!! in from..to }
        .sortedBy { it.startsAt }.take(30).map { "- ${day(it.startsAt!!)} ${clock(it.startsAt!!)} ${it.title}" }
    return "\nMy personal meetings, today and the next 3 days:\n${if (plans.isEmpty()) "No personal meetings in the next 3 days." else plans.joinToString("\n")}"
}

private val PERSONAL_WORDS = Regex("\\b(trip|travel|train|flight|fly|eurostar|hotel|airbnb|holiday|vacation|ferie|reise|museum|tickets?|restaurant|dinner|birthday|family|kids|weekend|booking|upgrade)\\b", RegexOption.IGNORE_CASE)
private val WORK_WORDS = Regex("\\b(slack|linear|jira|pr|pull request|oncall|on-call|standup|sprint|deploy|incident|ticket|review|roadmap|okr|oda|team|colleague|1:1)\\b", RegexOption.IGNORE_CASE)
private fun words(t: String) = t.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.length >= 4 }.toSet()

// web/src/codex/data/ask.ts guessProfile: work or personal for a question asked with the All filter.
fun guessProfile(question: String, meetings: List<Row>, fallback: String, now: Long = System.currentTimeMillis()): String {
    val q = words(question)
    val near = meetings.filter { !it.deleted && it.startsAt != null && it.startsAt!! > now - DAY_MS && it.startsAt!! < now + 7 * DAY_MS }
    fun hits(p: String) = near.count { m -> m.profile == p && words(m.title ?: "").any { it in q } }
    val personal = (if (PERSONAL_WORDS.containsMatchIn(question)) 2 else 0) + hits(PERSONAL)
    val work = (if (WORK_WORDS.containsMatchIn(question)) 2 else 0) + hits(WORK)
    return if (personal > work) PERSONAL else if (work > personal) WORK else fallback
}

fun askText(question: String, profile: String, items: List<Row>, about: Row? = null, meetings: List<Row> = emptyList(), now: Long = System.currentTimeMillis()): String {
    val open = items.filter { !it.deleted && it.status == "open" }.take(60)
    val personal = profile == PERSONAL
    val others = if (personal) emptyList() else othersText(meetings, now)
    return listOfNotNull(
        question,
        about?.let { "\nAbout this item:\n${line(it)}${it.text?.let { t -> "\n$t" } ?: ""}" },
        if (open.isNotEmpty()) "\nMy open items in Codex:\n${open.joinToString("\n") { line(it) }}" else null,
        if (others.isNotEmpty()) "\nWhat others took on in recent meetings:\n${others.joinToString("\n")}" else null,
        if (personal) plansText(meetings, now) else "\nUse my Slack, Calendar, Gmail and Linear connectors when the question needs them. They are my work accounts: if the question is about my private life (travel, family, personal bookings), do not search them and reply in one line that it belongs in Personal.",
        if (personal) "\nRead these events in Calendar for location and notes. Then use Calendar, Gmail and web search to suggest concrete alternatives near where I am, each with opening hours and travel time. Change the calendar only after I confirm." else null,
    ).joinToString("\n")
}


// One Codex chat per profile and Mac is reused for the day (web codex/data/ask.ts).
@Serializable
data class DailyChat(val day: String, val mac: String, val chat: String, val sessionId: String? = null)

fun today(): String = LocalDate.now().toString()

fun reusableDaily(d: DailyChat?, day: String, mac: String, fresh: Boolean = false): DailyChat? =
    d?.takeIf { !fresh && it.day == day && it.mac == mac }

fun openDaily(d: DailyChat?, live: List<LiveChat>): LiveChat? =
    d?.let { r -> live.firstOrNull { it.id == r.chat || (r.sessionId != null && it.sessionId == r.sessionId) } }

fun parseDaily(s: String?): DailyChat? = s?.let { runCatching { protocolJson.decodeFromString(DailyChat.serializer(), it) }.getOrNull() }
fun encodeDaily(d: DailyChat) = protocolJson.encodeToString(DailyChat.serializer(), d)
