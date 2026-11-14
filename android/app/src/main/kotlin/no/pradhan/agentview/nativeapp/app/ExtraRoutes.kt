package no.pradhan.agentview.nativeapp.app

import androidx.compose.runtime.Composable
import no.pradhan.agentview.nativeapp.codex.CodexOps
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.PERSONAL
import no.pradhan.agentview.nativeapp.codex.wiki.ReviewModePage
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.meetings.SeriesPage
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotPage
import no.pradhan.agentview.nativeapp.codex.jobs.JobPageView
import no.pradhan.agentview.nativeapp.codex.jobs.JobsListPage
import no.pradhan.agentview.nativeapp.codex.meetings.MeetingPage
import no.pradhan.agentview.nativeapp.codex.meetings.MeetingsListPage
import no.pradhan.agentview.nativeapp.codex.meetings.PersonPage
import no.pradhan.agentview.nativeapp.codex.meetings.newNotes
import no.pradhan.agentview.nativeapp.codex.wiki.WikiIndexPage
import no.pradhan.agentview.nativeapp.codex.wiki.WikiPageView
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.MenuItem

// The pages the Codex tab shows beyond Overview, Tasks and Goals: Meetings, Wiki and Jobs with the pages under them.
// Meetings, Wiki and Jobs are tab roots, passed as the page value. A pushed route is "meeting:<key>", "person:<name>", "wiki:<key>", "job:<key>", "series:<key>", "review" or "autopilot".
val EXTRA_ROOTS = setOf("meetings", "jobs", "wiki")
const val ROUTE_SEP = '\u0001'

fun routesOf(text: String): List<String> = if (text.isEmpty()) emptyList() else text.split(ROUTE_SEP)
fun pushRoute(text: String, route: String) = if (text.isEmpty()) route else text + ROUTE_SEP + route
fun popRoute(text: String) = text.substringBeforeLast(ROUTE_SEP, "")

private fun keyOf(route: String) = route.substringAfter(':')

fun routeTitle(route: String, st: CodexState): String = when {
    route == "meetings" -> "Meetings"
    route.startsWith("meeting:") -> "Meeting"
    route.startsWith("person:") -> "Person"
    route.startsWith("series:") -> "Series"
    route == "review" -> "Review claims"
    route == "autopilot" -> "Reply for me in Slack"
    route == "wiki" || route.startsWith("wiki:") -> "Wiki"
    route == "jobs" -> "Jobs"
    else -> "Job"
}

// The wiki page a claim sits on, as a route; claims without a page have none.
fun claimRoute(f: Row): String? = f.str("page_id")?.ifEmpty { null }?.let { "wiki:${f.profile}:$it" }

@Composable
fun ExtraContent(
    route: String, hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions,
    ops: CodexOps, chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, push: (String) -> Unit, pop: () -> Unit, onReplies: () -> Unit, onTask: (Row) -> Unit,
) {
    val key = keyOf(route)
    val openMeeting = { m: Row -> push("meeting:${m.key}") }
    when {
        route == "meetings" -> MeetingsListPage(hub, st, profile, now, chips, decisions, onChip, openMeeting)
        route.startsWith("meeting:") -> {
            val m = st.meetings.firstOrNull { it.key == key && !it.deleted }
            if (m == null) EmptyState("This meeting is gone") else MeetingPage(hub, st, m, now, actions, ops, openMeeting, { push("person:$it") }, { push("series:$it") }, onTask)
        }
        route.startsWith("series:") -> SeriesPage(st, key, now, actions, openMeeting)
        route == "review" -> ReviewModePage(st, ops.review, pop) { push("wiki:${it.key}") }
        route == "autopilot" -> AutopilotPage(hub, st, now, onReplies, onTask)
        route.startsWith("person:") -> PersonPage(hub, st, key, now, ops, openMeeting, { p, id -> push("wiki:$p:$id") }, onTask)
        route == "wiki" -> WikiIndexPage(st, profile, now, actions, { push("wiki:${it.key}") }, { f -> claimRoute(f)?.let(push) }, { push("review") })
        route.startsWith("wiki:") -> {
            val p = st.pages.firstOrNull { it.key == key && !it.deleted }
            if (p == null) EmptyState("This page is gone") else WikiPageView(st, p, now, actions)
        }
        route == "jobs" -> JobsListPage(hub, st, profile, now, { push("autopilot") }) { push("job:${it.key}") }
        else -> {
            val j = st.jobs.firstOrNull { it.key == key && !it.deleted }
            if (j == null) EmptyState("This job is gone") else JobPageView(hub, st, j, now)
        }
    }
}

@Composable
fun ExtraMenu(route: String, hub: Hub, profile: String?, now: Long, decisions: Boolean, onDecisions: () -> Unit, push: (String) -> Unit, close: () -> Unit) {
    if (route != "meetings") return
    MenuItem("Decisions", "check", { close(); onDecisions() }, checked = decisions)
    MenuItem("Take notes", "edit", {
        close()
        val row = newNotes(if (profile == PERSONAL) PERSONAL else WORK, now)
        if (hub.codex.add(row)) push("meeting:${row.key}")
    })
}
