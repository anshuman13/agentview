package no.pradhan.agentview.nativeapp.codex

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
)

// channelOf, sourceOf and sourceLink of web/src/codex/tasks/taskSource.ts; shared/fixtures/task-source.json holds the cases.
fun channelOf(r: Row) = SOURCES[r.source ?: "capture"] ?: SourceLink("circle-small", r.source ?: "")

fun sourceOf(r: Row) = if (isSaid(r)) SourceLink("reply", "You said") else channelOf(r)

// The link to a task's source: a meeting task links to its transcript.
fun sourceLink(r: Row) = sourceOf(r).let { if (!r.meetingId.isNullOrEmpty()) SourceLink(it.icon, "Transcript") else it }
