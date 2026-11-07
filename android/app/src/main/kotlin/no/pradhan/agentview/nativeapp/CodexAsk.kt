package no.pradhan.agentview.nativeapp

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

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

fun askText(question: String, profile: String, items: List<Row>, about: Row? = null, meetings: List<Row> = emptyList(), now: Long = System.currentTimeMillis()): String {
    val open = items.filter { !it.deleted && it.status == "open" }.take(60)
    val personal = profile == PERSONAL
    val others = if (personal) emptyList() else othersText(meetings, now)
    return listOfNotNull(
        question,
        about?.let { "\nAbout this item:\n${line(it)}${it.text?.let { t -> "\n$t" } ?: ""}" },
        if (open.isNotEmpty()) "\nMy open items in Codex:\n${open.joinToString("\n") { line(it) }}" else null,
        if (others.isNotEmpty()) "\nWhat others took on in recent meetings:\n${others.joinToString("\n")}" else null,
        if (personal) plansText(meetings, now) else "\nUse my Slack, Calendar, Gmail and Linear connectors when the question needs them.",
        if (personal) "\nRead these events in Calendar for location and notes. Then use Calendar, Gmail and web search to suggest concrete alternatives near where I am, each with opening hours and travel time. Change the calendar only after I confirm." else null,
    ).joinToString("\n")
}
