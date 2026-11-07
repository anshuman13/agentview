package no.pradhan.agentview.nativeapp

import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

// The pages the Codex tab reaches from its menu beyond Overview and Tasks: Meetings, Wiki and Jobs with the pages under them.
// A route is "meetings", "meeting:<key>", "person:<name>", "wiki", "wiki:<key>", "jobs" or "job:<key>".
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
    route == "wiki" -> "Wiki"
    route.startsWith("wiki:") -> st.pages.firstOrNull { it.key == keyOf(route) }?.title ?: "Wiki"
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
        route == "wiki" -> WikiIndexPage(st, profile, now, { push("wiki:${it.key}") }, { f -> claimRoute(f)?.let(push) }, { push("review") })
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
fun ExtraMenu(route: String, hub: Hub, profile: String?, now: Long, chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, onDecisions: () -> Unit, push: (String) -> Unit, close: () -> Unit) {
    if (route != "meetings") return
    MenuItem("Decisions", "check", { close(); onDecisions() }, checked = decisions)
    MenuItem("Take notes", "edit", {
        close()
        val row = newNotes(if (profile == PERSONAL) PERSONAL else WORK, now)
        if (hub.codex.add(row)) push("meeting:${row.key}")
    })
    MEETING_CHIPS.forEach { c ->
        MenuItem(c, "tag", { close(); onChip(c) }, checked = c in chips)
    }
}
