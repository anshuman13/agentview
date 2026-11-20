package no.pradhan.agentview.nativeapp.codex

import java.net.URI

class SourceLink(val icon: String, val label: String)

private val SOURCES = mapOf(
    "slack" to SourceLink("comment-discussion", "Slack"),
    "linear" to SourceLink("issues", "Linear"),
    "gmail" to SourceLink("mail", "Gmail"),
    "mail" to SourceLink("mail", "Mail"),
    "calendar" to SourceLink("calendar", "Calendar"),
    "meeting" to SourceLink("record", "Meeting"),
    "action" to SourceLink("checklist", "Meeting"),
    "github" to SourceLink("github", "GitHub"),
    "capture" to SourceLink("edit", "You"),
    "job" to SourceLink("history", "Job"),
    "chat" to SourceLink("sparkle", "Chat"),
)

// channelOf, sourceOf and sourceLink of web/src/codex/tasks/taskSource.ts; shared/fixtures/task-source.json holds the cases.
fun channelOf(r: Row) = SOURCES[r.source ?: "capture"] ?: SourceLink("circle-small", r.source ?: "")

fun sourceOf(r: Row) = if (isSaid(r)) SourceLink("reply", "You said") else channelOf(r)

// The link to a task's source: a meeting task links to its transcript.
fun sourceLink(r: Row) = sourceOf(r).let { if (!r.meetingId.isNullOrEmpty()) SourceLink(it.icon, "Transcript") else it }

const val LINK_LIMIT = 8
private val URL_RE = Regex("https?://[^\\s<>\"'\\[\\]]+")
private val TRAILING_RE = Regex("[.,;:)]+$")
private val HOST_RE = Regex("^https?://[^/?#]")

// linksIn, linkDomain and linkPath of web/src/codex/data/ask/links.ts; shared/fixtures/links-in.json holds the cases.
fun linksIn(notes: String, limit: Int = LINK_LIMIT) =
    URL_RE.findAll(notes).map { it.value.replace(TRAILING_RE, "") }.filter { HOST_RE.containsMatchIn(it) }.distinct().take(limit).toList()

fun linkDomain(url: String) = runCatching { URI(url).host?.lowercase()?.removePrefix("www.") }.getOrNull() ?: url

fun linkPath(url: String): String {
    val u = runCatching { URI(url) }.getOrNull() ?: return ""
    val path = if (u.rawPath.isNullOrEmpty() || u.rawPath == "/") "" else u.rawPath + (u.rawQuery?.ifEmpty { null }?.let { "?$it" } ?: "")
    return if (path.length > 40) "${path.take(40)}..." else path
}
