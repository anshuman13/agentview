package no.pradhan.agentview.nativeapp.codex

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.EXTRA_ROOTS
import no.pradhan.agentview.nativeapp.app.ExtraContent
import no.pradhan.agentview.nativeapp.app.ExtraMenu
import no.pradhan.agentview.nativeapp.app.popRoute
import no.pradhan.agentview.nativeapp.app.pushRoute
import no.pradhan.agentview.nativeapp.app.routeTitle
import no.pradhan.agentview.nativeapp.app.routesOf
import no.pradhan.agentview.nativeapp.codex.wiki.proposals
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.track
import no.pradhan.agentview.nativeapp.net.setCodexFilter
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.Fab
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SnackHost
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.WhileStarted
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.ReviewOps

private const val SYNC_EVERY_MS = 30_000L

private fun greeting(now: Long) = when (hourOf(now)) { in 0..4 -> "Good night"; in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening" } +
    ", " + java.time.format.DateTimeFormatter.ofPattern("EEE d", java.util.Locale.ENGLISH).format(Instant.ofEpochMilli(now).atZone(codexZone))

private class CodexNav(private val pageS: MutableState<String>, private val routeS: MutableState<String>, private val editS: MutableState<String?>, private val addingS: MutableState<Boolean>, private val needsS: MutableState<Boolean>, private val chipS: MutableState<String>, private val decisionsS: MutableState<Boolean>, private val searchingS: MutableState<Boolean>, private val queryS: MutableState<String>) {
    var page by pageS
    var routeText by routeS
    var editKey by editS
    var adding by addingS
    var needsOpen by needsS
    var decisions by decisionsS
    var searching by searchingS
    var query by queryS
    val route get() = routesOf(routeText).lastOrNull()
    val extra get() = route ?: page.takeIf { it in EXTRA_ROOTS }
    val sub get() = route != null || page == "search" || page.startsWith("tag:")
    val chips get() = chipS.value.split(',').filter { it.isNotEmpty() }.toSet()

    fun push(r: String) { routeText = pushRoute(routeText, r) }
    fun pop() { routeText = popRoute(routeText) }
    fun go(p: String) { routeText = ""; page = p }
    fun toggleChip(c: String) { chipS.value = (if (c in chips) chips - c else chips + c).joinToString(",") }
    fun openRow(r: Row) { editKey = r.key }
    fun back() {
        if (route != null) pop()
        else if (searching && page == "tasks") { searching = false; query = "" }
        else page = if (page.startsWith("tag:")) "tasks" else "overview"
    }
}

@Composable
private fun rememberCodexNav() = CodexNav(
    rememberSaveable { mutableStateOf("overview") },
    rememberSaveable { mutableStateOf("") },
    rememberSaveable { mutableStateOf<String?>(null) },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf("") },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf("") },
)

@Composable
private fun rememberCodexNow(hub: Hub, st: CodexState): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(st.items, st.meetings, now / 60_000) {
        if (!hub.readOnly) endedPoints(st.items, st.meetings, now).forEach { hub.codex.update(it, mapOf("status" to RAISED)) }
    }
    val origin by hub.origin.collectAsState()
    WhileStarted(origin) {
        while (true) { now = System.currentTimeMillis(); hub.codex.sync(); delay(SYNC_EVERY_MS) }
    }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    LaunchedEffect(st) { now = System.currentTimeMillis() }
    return now
}

// The Codex tab (web/src/codex): Overview and Tasks of the work profile, the personal profile or both, with Goals, Search and tag pages.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodexScreen(hub: Hub) {
    val st by hub.codex.state.collectAsState()
    val filterKey by hub.codexFilter.collectAsState()
    val profile = filterKey.takeIf { it != "all" }
    val nav = rememberCodexNav()
    val addRequest by hub.addTask.collectAsState()
    LaunchedEffect(addRequest) { if (addRequest) { nav.adding = true; hub.addTask.value = false } }
    var refreshing by remember { mutableStateOf(false) }
    val now = rememberCodexNow(hub, st)
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val say = remember(hub) {
        { text: String, undo: (() -> Unit)? ->
            scope.launch {
                snack.currentSnackbarData?.dismiss()
                val r = snack.showSnackbar(text, if (undo != null) "Undo" else null, duration = SnackbarDuration.Short)
                if (r == SnackbarResult.ActionPerformed) undo?.invoke()
            }
            Unit
        }
    }
    val actions = remember(hub) { TaskActions(hub.codex, say) }
    val ops = remember(hub) { CodexOps(PointActions(hub.codex, say), GoalActions(hub.codex, say), ReviewOps(hub.codex, say), ReplyOps(hub.api, hub.writes, hub.codex, say)) }
    val editing = nav.editKey?.let { k -> st.items.firstOrNull { it.key == k && !it.deleted } }
    LaunchedEffect(editing, nav.editKey) { if (nav.editKey != null && editing == null && st.loaded) nav.editKey = null }
    val jobRequest by hub.openJob.collectAsState()
    LaunchedEffect(jobRequest) { jobRequest?.let { nav.page = "jobs"; nav.routeText = "job:$it"; hub.openJob.value = null } }
    LaunchedEffect(nav.page) { if (nav.page != "meetings") nav.decisions = false }
    BackHandler(enabled = nav.sub || nav.searching || nav.page != "overview") { nav.back() }
    val refresh = { scope.launch { refreshing = true; hub.codex.sync(); refreshing = false }; Unit }

    Box(Modifier.fillMaxSize().background(av.groupPage)) {
        Column(Modifier.fillMaxSize()) {
            CodexHeader(hub, st, nav, profile, filterKey, now)
            st.error?.let { Group { ListRow("Sync failed", it, trailing = { Button("Retry", { refresh() }, size = ButtonSize.Sm) }) } }
            PullToRefreshBox(refreshing, { refresh() }, Modifier.weight(1f)) { CodexBody(hub, st, nav, profile, now, actions, ops) }
            if (nav.page == "overview" && nav.route == null && st.loaded) AskBar(hub, st, profile)
        }
        if (nav.route == null && (nav.page == "overview" || nav.page == "tasks" || nav.page.startsWith("tag:"))) Fab(
            "add", "Add task", { nav.adding = true },
            Modifier.align(Alignment.BottomEnd).padding(end = Tokens.sp8, bottom = if (nav.page == "overview") Tokens.fab + Tokens.sp16 else Tokens.sp8),
        )
        SnackHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    CodexSheetsHost(hub, st, nav, profile, now, actions, ops, editing, snack)
}

@Composable
private fun CodexHeader(hub: Hub, st: CodexState, nav: CodexNav, profile: String?, filterKey: String, now: Long) {
    val page = nav.page
    val extra = nav.extra
    val go = { p: String -> if (p != page) hub.track("list:$p"); nav.go(p) }
    CodexTopBar(
        title = when {
            extra != null -> routeTitle(extra, st)
            page == "overview" -> greeting(now)
            page == "tasks" -> "Tasks"
            page == "goals" -> "Goals"
            page == "search" -> "Search"
            else -> "#" + page.removePrefix("tag:")
        },
        back = if (nav.sub) nav::back else null,
        filter = filterKey.takeIf { !nav.sub }, onFilter = hub::setCodexFilter,
        onSearch = if (nav.route == null && (page == "overview" || page == "tasks")) { { nav.page = "tasks"; nav.searching = true } } else null,
        menu = if (nav.route != null) null else { close ->
            ExtraMenu(page, hub, profile, now, nav.decisions, { nav.decisions = !nav.decisions }, nav::push, close)
            MenuItem("Search everything", "search", { close(); nav.page = "search" })
        },
    )
    if (!nav.sub) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        val claims = remember(st.facts, profile) { proposals(st.facts.filter { matchesProfile(profile, it) }).size }
        Chip("Overview", { go("overview") }, on = page == "overview")
        Chip("Tasks", { go("tasks") }, on = page == "tasks")
        Chip("Meetings", { go("meetings") }, on = page == "meetings")
        Chip("Jobs", { go("jobs") }, on = page == "jobs")
        Chip(if (claims > 0) "Wiki $claims" else "Wiki", { go("wiki") }, on = page == "wiki")
        Chip("Goals", { go("goals") }, on = page == "goals")
    }
}

@Composable
private fun CodexBody(hub: Hub, st: CodexState, nav: CodexNav, profile: String?, now: Long, actions: TaskActions, ops: CodexOps) {
    val page = nav.page
    val extra = nav.extra
    val meeting = { r: Row -> nav.push("meeting:${r.key}") }
    val openNeeds = { hub.track("sheet:needsYou"); nav.needsOpen = true }
    when {
        !st.loaded -> Loading("Loading Codex…")
        extra != null -> ExtraContent(extra, hub, st, profile, now, actions, ops, nav.chips, nav.decisions, nav::toggleChip, nav::push, nav::pop, { nav.pop(); openNeeds() }, nav::openRow)
        page == "overview" -> OverviewPage(hub, st, profile, now, actions, nav::openRow, openNeeds, { nav.page = "goals" }, { nav.adding = true }, meeting)
        page == "tasks" -> TasksPage(st, profile, now, actions, nav.searching, nav.query, { nav.query = it }, nav::openRow, { nav.page = "tag:$it" })
        page == "goals" -> GoalsPage(st, profile, now, actions, ops.goals, nav::openRow)
        page == "search" -> SearchPage(st, profile, nav::openRow, meeting)
        else -> TagPage(st, page.removePrefix("tag:"), now, actions, profile == null, nav::openRow)
    }
}

@Composable
private fun CodexSheetsHost(hub: Hub, st: CodexState, nav: CodexNav, profile: String?, now: Long, actions: TaskActions, ops: CodexOps, editing: Row?, snack: SnackbarHostState) {
    val scope = rememberCoroutineScope()
    editing?.let { row ->
        val from = st.meetings.firstOrNull { it.profile == row.profile && it.id == row.meetingId }
        val people = if (row.status == "open") remember(st.meetings, row.key, now / 60_000) { recentPeople(st.meetings, row.profile, from, now) } else emptyList()
        EditorSheet(row, st.items, now, actions, people, { p, t -> ops.points.raise(t, p, row.profile) }) { nav.editKey = null }
    }
    if (nav.adding) AddSheet(hub, profile, now, { nav.adding = false }) { added ->
        scope.launch { snack.currentSnackbarData?.dismiss(); snack.showSnackbar("Task · $added", duration = SnackbarDuration.Short) }
    }
    if (nav.needsOpen) {
        val hidden by hub.handled.collectAsState()
        val view = remember(st, profile, now / 60_000, hidden) { needsView(st, profile, now, hidden) }
        NeedsSheet(view.list, view.queue, now, actions, ops.replies, hub, { nav.needsOpen = false; nav.editKey = it.key }, { nav.needsOpen = false; nav.push("review") }, { nav.needsOpen = false; nav.push("person:$it") }) { nav.needsOpen = false }
    }
}

@Composable
private fun CodexTopBar(title: String, back: (() -> Unit)?, filter: String?, onFilter: (String) -> Unit, onSearch: (() -> Unit)?, menu: (@Composable (() -> Unit) -> Unit)?) {
    PageHeader(title, back) {
        var open by remember { mutableStateOf(false) }
        if (filter != null) Box {
            Chip(if (filter == "all") "All" else profileLabel(filter), { open = true }, tone = when (filter) { WORK -> ChipTone.Work; PERSONAL -> ChipTone.Personal; else -> ChipTone.Default }, trailingIcon = "chevron-down")
            Menu(open, { open = false }) {
                listOf("all" to "All", WORK to "Work", PERSONAL to "Personal").forEach { (k, label) ->
                    MenuItem(label, "filter", { open = false; onFilter(k) }, checked = filter == k)
                }
            }
        }
        if (onSearch != null) IconBtn("search", "Search tasks", onSearch)
        if (menu != null) MoreButton { close -> menu(close) }
    }
}
