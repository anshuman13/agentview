package no.pradhan.agentview.nativeapp

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenuItem
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
    chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, push: (String) -> Unit, onTask: (Row) -> Unit,
) {
    val key = keyOf(route)
    val openMeeting = { m: Row -> push("meeting:${m.key}") }
    when {
        route == "meetings" -> MeetingsListPage(st, profile, now, chips, decisions, onChip, openMeeting)
        route.startsWith("meeting:") -> {
            val m = st.meetings.firstOrNull { it.key == key && !it.deleted }
            if (m == null) Empty("This meeting is gone") else MeetingPage(hub, st, m, now, actions, openMeeting, { push("person:$it") }, onTask)
        }
        route.startsWith("person:") -> PersonPage(st, key, now, openMeeting, { p, id -> push("wiki:$p:$id") }, onTask)
        route == "wiki" -> WikiIndexPage(st, profile, now, { push("wiki:${it.key}") }, { f -> claimRoute(f)?.let(push) })
        route.startsWith("wiki:") -> {
            val p = st.pages.firstOrNull { it.key == key && !it.deleted }
            if (p == null) Empty("This page is gone") else WikiPageView(st, p, now)
        }
        route == "jobs" -> JobsListPage(hub, st, profile, now) { push("job:${it.key}") }
        else -> {
            val j = st.jobs.firstOrNull { it.key == key && !it.deleted }
            if (j == null) Empty("This job is gone") else JobPageView(hub, st, j, now)
        }
    }
}

@Composable
fun ExtraMenu(route: String, hub: Hub, profile: String?, now: Long, chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, onDecisions: () -> Unit, push: (String) -> Unit, close: () -> Unit) {
    if (route != "meetings") return
    DropdownMenuItem(text = { Text("Decisions") }, leadingIcon = if (decisions) { { Icon(Icons.Filled.Check, null) } } else null, onClick = { close(); onDecisions() })
    DropdownMenuItem(text = { Text("Take notes") }, onClick = {
        close()
        val row = newNotes(if (profile == PERSONAL) PERSONAL else WORK, now)
        if (hub.codex.add(row)) push("meeting:${row.key}")
    })
    MEETING_CHIPS.forEach { c ->
        DropdownMenuItem(text = { Text(c) }, leadingIcon = if (c in chips) { { Icon(Icons.Filled.Check, null) } } else null, onClick = { close(); onChip(c) })
    }
}
