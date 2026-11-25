package no.pradhan.agentview.nativeapp.codex

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.animation.core.tween
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.rememberDrawerState
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.askCodex
import no.pradhan.agentview.nativeapp.app.EXTRA_ROOTS
import no.pradhan.agentview.nativeapp.app.ExtraContent
import no.pradhan.agentview.nativeapp.app.ExtraMenu
import no.pradhan.agentview.nativeapp.app.popRoute
import no.pradhan.agentview.nativeapp.app.pushRoute
import no.pradhan.agentview.nativeapp.app.routeTitle
import no.pradhan.agentview.nativeapp.app.routesOf
import no.pradhan.agentview.nativeapp.app.SNACK_MS
import no.pradhan.agentview.nativeapp.codex.wiki.proposals
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.track
import no.pradhan.agentview.nativeapp.app.setCodexFilter
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.Fab
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SnackHost
import no.pradhan.agentview.nativeapp.ui.rememberShowSnack
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.ReadingFont
import no.pradhan.agentview.nativeapp.ui.WhileStarted
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.codex.wiki.ReviewOps
import no.pradhan.agentview.nativeapp.app.refreshWorkspace
import no.pradhan.agentview.nativeapp.chat.NewChatSheet
import no.pradhan.agentview.nativeapp.sessions.groupByRepo
import no.pradhan.agentview.nativeapp.sessions.newChatChoices
import no.pradhan.agentview.nativeapp.ui.select

private const val SYNC_EVERY_MS = 30_000L

private fun greeting(now: Long) = when (hourOf(now)) { in 0..4 -> "Good night"; in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening" }

private class CodexNav(private val pageS: MutableState<String>, private val routeS: MutableState<String>, private val editS: MutableState<String?>, private val addingS: MutableState<Boolean>, private val addingGoalS: MutableState<String?>, private val needsS: MutableState<Boolean>, private val chipS: MutableState<String>, private val decisionsS: MutableState<Boolean>, private val searchingS: MutableState<Boolean>, private val queryS: MutableState<String>, private val pickS: MutableState<Set<String>?>) {
    var page by pageS
    var routeText by routeS
    var editKey by editS
    var adding by addingS
    var addingGoal by addingGoalS
    var needsOpen by needsS
    var decisions by decisionsS
    var searching by searchingS
    var query by queryS
    var picked by pickS
    val route get() = routesOf(routeText).lastOrNull()
    val extra get() = route ?: page.takeIf { it in EXTRA_ROOTS }
    val sub get() = route != null || page.startsWith("tag:")
    val chips get() = chipS.value.split(',').filter { it.isNotEmpty() }.toSet()

    fun push(r: String) { routeText = pushRoute(routeText, r) }
    fun pop() { routeText = popRoute(routeText) }
    fun go(p: String) { routeText = ""; page = p }
    fun toggleChip(c: String) { chipS.value = (if (c in chips) chips - c else chips + c).joinToString(",") }
    fun openRow(r: Row) { editKey = r.key }
    fun back() {
        if (picked != null) picked = null
        else if (route != null) pop()
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
    rememberSaveable { mutableStateOf<String?>(null) },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf("") },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf("") },
    remember { mutableStateOf<Set<String>?>(null) },
)

@Composable
private fun rememberCodexNow(hub: Hub, st: CodexState): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(st.items, st.meetings, now / 60_000) {
        if (!hub.readOnly) withContext(Dispatchers.Default) { endedPoints(st.items, st.meetings, now) }.forEach { hub.codex.update(it, mapOf("status" to RAISED)) }
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
    val addRequest by hub.shell.addTask.collectAsState()
    LaunchedEffect(addRequest) { if (addRequest) { nav.adding = true; hub.shell.addTask.value = false } }
    val routeRequest by hub.shell.codexRoute.collectAsState()
    LaunchedEffect(routeRequest) { routeRequest?.let { nav.go("wiki"); nav.push(it); hub.shell.codexRoute.value = null } }
    var refreshing by remember { mutableStateOf(false) }
    val now = rememberCodexNow(hub, st)
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val show = rememberShowSnack(snack)
    val say = remember(hub, show) {
        { text: String, undo: (() -> Unit)? ->
            scope.launch {
                val r = show(text, if (undo != null) "Undo" else null, SNACK_MS)
                if (r == SnackbarResult.ActionPerformed) undo?.invoke()
            }
            Unit
        }
    }
    val actions = remember(hub) { TaskActions(hub.codex, say) }
    val ops = remember(hub) { CodexOps(PointActions(hub.codex, say), GoalActions(hub.codex, say), ReviewOps(hub.codex, say), ReplyOps(hub.api, hub.writes, hub.codex, say)) }
    val editing = nav.editKey?.let { k -> st.items.firstOrNull { it.key == k && !it.deleted } }
    LaunchedEffect(editing, nav.editKey) { if (nav.editKey != null && editing == null && st.loaded) nav.editKey = null }
    LaunchedEffect(nav.page, nav.route, nav.searching, filterKey) { nav.picked = null; if (nav.page != "meetings") nav.decisions = false }
    BackHandler(enabled = nav.picked != null || nav.sub || nav.searching || nav.page != "overview") { nav.back() }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    BackHandler(enabled = drawerState.isOpen) { scope.launch { drawerState.close() } }
    val refresh = { scope.launch { refreshing = true; hub.codex.sync(); refreshing = false }; Unit }
    val go = { p: String -> if (p != nav.page) hub.track("list:$p"); nav.go(p); scope.launch { drawerState.animateTo(DrawerValue.Closed, tween(Tokens.motionDuration, easing = Tokens.motionEaseOut)) }; Unit }

    ModalNavigationDrawer(
        drawerContent = { ListsDrawer(hub, st, nav.page, profile, filterKey, go) },
        drawerState = drawerState,
        gesturesEnabled = drawerState.isOpen,
    ) {
        Box(Modifier.fillMaxSize().background(av.groupPage)) {
            Column(Modifier.align(Alignment.TopCenter).widthIn(max = Tokens.pageMax).fillMaxSize()) {
                CodexHeader(hub, st, nav, profile, filterKey, now) { scope.launch { drawerState.animateTo(DrawerValue.Open, tween(Tokens.motionDuration, easing = Tokens.motionEaseIn)) } }
                if (st.reconnecting) Group { ListRow("Reconnecting to the hub…", syncedAt(st.lastSync, now), muted = true) }
                else st.error?.let { error -> Group { ListRow(error, syncedAt(st.lastSync, now), trailing = { Button("Retry", { refresh() }, size = ButtonSize.Sm) }) } }
                PullToRefreshBox(refreshing, { refresh() }, Modifier.weight(1f)) { CodexBody(hub, st, nav, profile, now, actions, ops) }
                if (nav.page == "overview" && nav.route == null && st.loaded) AskBar(hub, st, profile)
            }
            if (nav.route == null && nav.picked == null && ((nav.page == "overview" && hasOpenTasks(st.items, profile)) || nav.page == "tasks" || nav.page.startsWith("tag:"))) Fab(
                "add", "Add task", { nav.adding = true },
                Modifier.align(Alignment.BottomEnd).padding(end = Tokens.sp8, bottom = if (nav.page == "overview") Tokens.fab + Tokens.sp16 else Tokens.sp8),
            )
            SnackHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    CodexSheetsHost(hub, st, nav, profile, now, actions, ops, editing, snack)
}

@Composable
private fun CodexHeader(hub: Hub, st: CodexState, nav: CodexNav, profile: String?, filterKey: String, now: Long, onMenu: () -> Unit) {
    val page = nav.page
    val extra = nav.extra
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
        onMenu = if (nav.sub) null else onMenu,
        profileLabel = filterKey.takeIf { it != "all" && !nav.sub }?.let { profileLabel(it) },
        onSearch = if (nav.route == null && page == "tasks") { { nav.searching = true } } else null,
        menu = if (nav.route == null && page == "meetings") { close ->
            ExtraMenu(page, hub, profile, now, nav.decisions, { nav.decisions = !nav.decisions }, nav::push, close)
        } else null,
        greeting = extra == null && page == "overview",
    )
}

private val DRAWER_ROWS = listOf(
    Triple("search", "Search", "search"),
    Triple("overview", "Overview", "home"),
    Triple("tasks", "Tasks", "checklist"),
    Triple("meetings", "Meetings", "record"),
    Triple("wiki", "Wiki", "book"),
    Triple("jobs", "Jobs", "history"),
    Triple("goals", "Goals", "target"),
)

@Composable
private fun ListsDrawer(hub: Hub, st: CodexState, page: String, profile: String?, filterKey: String, go: (String) -> Unit) {
    val claims = remember(st.facts, profile) { proposals(st.facts.filter { matchesProfile(profile, it) }).size }
    ModalDrawerSheet(Modifier.widthIn(max = 300.dp), drawerContainerColor = av.groupPage) {
        Column(Modifier.fillMaxSize().padding(vertical = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp1)) {
            Text("Codex", style = Type.title.copy(fontFamily = ReadingFont, fontWeight = FontWeight.Normal), color = av.fg, modifier = Modifier.padding(horizontal = Tokens.sp10, vertical = Tokens.sp4))
            DRAWER_ROWS.forEach { (id, label, icon) ->
                if (id == "goals") Text("Planning", style = Type.label, color = av.fgMuted, modifier = Modifier.padding(start = Tokens.sp4 + Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp2))
                ListRow(
                    if (page == id) AnnotatedString(label, SpanStyle(fontWeight = FontWeight.Medium)) else label,
                    leading = { AvIcon(icon) },
                    trailing = if (id == "wiki" && claims > 0) { { Badge(claims.toString(), BadgeTone.Quiet) } } else null,
                    compact = true,
                    modifier = Modifier.padding(horizontal = Tokens.sp4).clip(RoundedCornerShape(Tokens.shapeMd)).then(if (page == id) Modifier.background(av.raised) else Modifier),
                    onClick = { go(id) },
                )
            }
            Spacer(Modifier.weight(1f))
            Row(Modifier.padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                listOf("all" to "All", WORK to "Work", PERSONAL to "Personal").forEach { (k, label) -> Chip(label, { hub.setCodexFilter(k) }, on = filterKey == k) }
            }
        }
    }
}

@Composable
private fun CodexBody(hub: Hub, st: CodexState, nav: CodexNav, profile: String?, now: Long, actions: TaskActions, ops: CodexOps) {
    val page = nav.page
    val extra = nav.extra
    val meeting = { r: Row -> nav.push("meeting:${r.key}") }
    val openNeeds = { hub.track("sheet:needsYou"); nav.needsOpen = true }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var searchOpened by rememberSaveable { mutableStateOf(emptySet<String>()) }
    when {
        !st.loaded -> Loading("Loading Codex…")
        extra != null -> ExtraContent(extra, hub, st, profile, now, actions, ops, nav.chips, nav.decisions, nav::toggleChip, nav::push, nav::pop, { nav.pop(); openNeeds() }, nav::openRow)
        page == "overview" -> OverviewPage(hub, st, profile, now, actions, nav::openRow, openNeeds, { nav.page = "goals" }, { nav.adding = true }, meeting) { nav.push("meeting:${it.key}#notes") }
        page == "tasks" -> TasksPage(st, profile, now, actions, nav.searching, nav.query, { nav.query = it }, nav::openRow, { nav.page = "tag:$it" }, nav.picked, { nav.picked = it }, meeting)
        page == "goals" -> GoalsPage(st, profile, now, actions, ops.goals, nav::openRow) { nav.addingGoal = it.id; nav.adding = true }
        page == "search" -> SearchPage(st, profile, searchQuery, { searchQuery = it; searchOpened = emptySet() }, searchOpened, { searchOpened = it }, nav::openRow, meeting, nav::push)
        else -> TagPage(st, page.removePrefix("tag:"), now, actions, nav::openRow)
    }
}

@Composable
private fun CodexSheetsHost(hub: Hub, st: CodexState, nav: CodexNav, profile: String?, now: Long, actions: TaskActions, ops: CodexOps, editing: Row?, snack: SnackbarHostState) {
    val scope = rememberCoroutineScope()
    val show = rememberShowSnack(snack)
    var chatText by remember { mutableStateOf<((String?) -> String)?>(null) }
    val askAbout: (Row) -> Unit = { r -> hub.askCodex(askIn(st, "Help me with this item.", r.profile, r), r.profile) }
    editing?.let { row ->
        val from = st.meetings.firstOrNull { it.profile == row.profile && it.id == row.meetingId }
        val people = if (row.status == "open") remember(st.meetings, row.key, now / 60_000) { recentPeople(st.meetings, row.profile, from, now) } else emptyList()
        EditorSheet(hub, row, st.items, st.meetings, now, actions, people, from, { nav.push("meeting:${it.key}") }, { p, t -> ops.points.raise(t, p, row.profile) }, askAbout, { chatText = it }, { id -> scope.launch { if (hub.openSaved(id)) nav.editKey = null } }) { nav.editKey = null }
    }
    chatText?.let { text ->
        val live by hub.store.state.select { it.live }
        val sessionCwd by hub.store.state.select { it.session?.cwd }
        val ws by hub.workspace.collectAsState()
        LaunchedEffect(Unit) { hub.refreshWorkspace() }
        val (here, choices) = newChatChoices(groupByRepo(live, ws), ws, sessionCwd)
        NewChatSheet(hub, null, choices, onDismiss = { chatText = null }, initial = here, text = text)
    }
    if (nav.adding) AddSheet(hub, profile, st.items, nav.addingGoal, now, { nav.adding = false; nav.addingGoal = null }) { added ->
        scope.launch { show("Task · $added", null, SNACK_MS) }
    }
    if (nav.needsOpen) {
        val view by hub.needed.collectAsState()
        NeedsSheet(view.list, view.queue, ignoredToday(st.briefs, profile, now), now, actions, ops.replies, hub, { nav.needsOpen = false; nav.editKey = it.key }, askAbout, { nav.needsOpen = false; nav.push("review") }, { nav.needsOpen = false; nav.push("person:$it") }, { nav.needsOpen = false; nav.push("meeting:${it.key}#notes") }, { nav.needsOpen = false; nav.push("job:${it.key}") }) { nav.needsOpen = false }
    }
}

@Composable
private fun CodexTopBar(title: String, back: (() -> Unit)?, onMenu: (() -> Unit)?, profileLabel: String?, onSearch: (() -> Unit)?, menu: (@Composable (() -> Unit) -> Unit)?, greeting: Boolean = false) {
    PageHeader(title, back, greeting = greeting, onMenu = onMenu, trailing = profileLabel) {
        if (onSearch != null) IconBtn("search", "Search tasks", onSearch)
        if (menu != null) MoreButton { close -> menu(close) }
    }
}
