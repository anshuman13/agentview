package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import kotlinx.coroutines.flow.update
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

private const val SYNC_EVERY_MS = 30_000L
private const val TODAY_SHOWN = 7

private fun greeting(now: Long) = when (hourOf(now)) { in 0..4 -> "Good night"; in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening" } +
    ", " + java.time.format.DateTimeFormatter.ofPattern("EEE d", java.util.Locale.ENGLISH).format(Instant.ofEpochMilli(now).atZone(codexZone))

// The Codex tab (web/src/codex): Overview and Tasks of the work profile, the personal profile or both, with Goals, Search and tag pages.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodexScreen(hub: Hub) {
    val st by hub.codex.state.collectAsState()
    val filterKey by hub.codexFilter.collectAsState()
    val profile = filterKey.takeIf { it != "all" }
    var page by rememberSaveable { mutableStateOf("overview") }
    var editKey by rememberSaveable { mutableStateOf<String?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    val addRequest by hub.addTask.collectAsState()
    LaunchedEffect(addRequest) { if (addRequest) { adding = true; hub.addTask.value = false } }
    var needsOpen by rememberSaveable { mutableStateOf(false) }
    var routeText by rememberSaveable { mutableStateOf("") }
    var chipText by rememberSaveable { mutableStateOf("") }
    var decisions by rememberSaveable { mutableStateOf(false) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
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
    LaunchedEffect(st.items, st.meetings, now / 60_000) {
        if (!hub.readOnly) endedPoints(st.items, st.meetings, now).forEach { hub.codex.update(it, mapOf("status" to RAISED)) }
    }
    val origin by hub.origin.collectAsState()
    WhileStarted(origin) {
        while (true) { now = System.currentTimeMillis(); hub.codex.sync(); delay(SYNC_EVERY_MS) }
    }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    LaunchedEffect(st) { now = System.currentTimeMillis() }

    val editing = editKey?.let { k -> st.items.firstOrNull { it.key == k && !it.deleted } }
    LaunchedEffect(editing, editKey) { if (editKey != null && editing == null && st.loaded) editKey = null }
    val route = routesOf(routeText).lastOrNull()
    val extra = route ?: page.takeIf { it in EXTRA_ROOTS }
    val chips = remember(chipText) { chipText.split(',').filter { it.isNotEmpty() }.toSet() }
    val push = { r: String -> routeText = pushRoute(routeText, r) }
    val onChip = { c: String -> chipText = (if (c in chips) chips - c else chips + c).joinToString(",") }
    val go = { p: String -> routeText = ""; page = p }
    val jobRequest by hub.openJob.collectAsState()
    LaunchedEffect(jobRequest) { jobRequest?.let { page = "jobs"; routeText = "job:$it"; hub.openJob.value = null } }
    val sub = route != null || page == "search" || page.startsWith("tag:")
    LaunchedEffect(page) { if (page != "meetings") decisions = false }
    val back = {
        if (route != null) routeText = popRoute(routeText)
        else if (searching && page == "tasks") { searching = false; query = "" }
        else page = if (page.startsWith("tag:")) "tasks" else "overview"
    }
    BackHandler(enabled = sub || searching || page != "overview") { back() }
    val refresh = { scope.launch { refreshing = true; hub.codex.sync(); refreshing = false }; Unit }

    Box(Modifier.fillMaxSize().background(av.groupPage)) {
        Column(Modifier.fillMaxSize()) {
            CodexTopBar(
                title = when {
                    extra != null -> routeTitle(extra, st)
                    page == "overview" -> greeting(now)
                    page == "tasks" -> "Tasks"
                    page == "goals" -> "Goals"
                    page == "search" -> "Search"
                    else -> "#" + page.removePrefix("tag:")
                },
                back = if (sub) back else null,
                filter = filterKey.takeIf { !sub }, onFilter = hub::setCodexFilter,
                onSearch = if (route == null && (page == "overview" || page == "tasks")) { { page = "tasks"; searching = true } } else null,
                menu = if (route != null) null else { close ->
                    ExtraMenu(page, hub, profile, now, decisions, { decisions = !decisions }, push, close)
                    MenuItem("Search everything", "search", { close(); page = "search" })
                },
            )
            if (!sub) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                val claims = remember(st.facts, profile) { proposals(st.facts.filter { matchesProfile(profile, it) }).size }
                Chip("Overview", { go("overview") }, on = page == "overview")
                Chip("Tasks", { go("tasks") }, on = page == "tasks")
                Chip("Meetings", { go("meetings") }, on = page == "meetings")
                Chip("Jobs", { go("jobs") }, on = page == "jobs")
                Chip(if (claims > 0) "Wiki $claims" else "Wiki", { go("wiki") }, on = page == "wiki")
                Chip("Goals", { go("goals") }, on = page == "goals")
            }
            st.error?.let { Group { ListRow("Sync failed", it, trailing = { Button("Retry", { refresh() }, size = ButtonSize.Sm) }) } }
            PullToRefreshBox(refreshing, { refresh() }, Modifier.weight(1f)) {
                when {
                    !st.loaded -> Loading("Loading Codex…")
                    extra != null -> ExtraContent(extra, hub, st, profile, now, actions, ops, chips, decisions, onChip, push, { routeText = popRoute(routeText) }, { routeText = popRoute(routeText); needsOpen = true }) { editKey = it.key }
                    page == "overview" -> OverviewPage(hub, st, profile, now, actions, { editKey = it.key }, { needsOpen = true }, { page = "goals" }, { adding = true }, { push("meeting:${it.key}") })
                    page == "tasks" -> TasksPage(st, profile, now, actions, searching, query, { query = it }, { editKey = it.key }, { page = "tag:$it" })
                    page == "goals" -> GoalsPage(st, profile, now, actions, ops.goals, { editKey = it.key })
                    page == "search" -> SearchPage(st, profile, { editKey = it.key }, { push("meeting:${it.key}") })
                    else -> TagPage(st, page.removePrefix("tag:"), now, actions, profile == null, { editKey = it.key })
                }
            }
            if (page == "overview" && route == null && st.loaded) AskBar(hub, st, profile)
        }
        if (route == null && (page == "overview" || page == "tasks" || page.startsWith("tag:"))) Fab(
            "add", "Add task", { adding = true },
            Modifier.align(Alignment.BottomEnd).padding(end = Tokens.sp8, bottom = if (page == "overview") Tokens.fab + Tokens.sp16 else Tokens.sp8),
        )
        SnackHost(snack, Modifier.align(Alignment.BottomCenter))
    }

    editing?.let { row ->
        val from = st.meetings.firstOrNull { it.profile == row.profile && it.id == row.meetingId }
        val people = if (row.status == "open") remember(st.meetings, row.key, now / 60_000) { recentPeople(st.meetings, row.profile, from, now) } else emptyList()
        EditorSheet(row, st.items, now, actions, people, { p, t -> ops.points.raise(t, p, row.profile) }) { editKey = null }
    }
    if (adding) AddSheet(hub, profile, now, { adding = false }) { added ->
        scope.launch { snack.currentSnackbarData?.dismiss(); snack.showSnackbar("Task · $added", duration = SnackbarDuration.Short) }
    }
    if (needsOpen) {
        val hidden by hub.handled.collectAsState()
        val view = remember(st, profile, now / 60_000, hidden) { needsView(st, profile, now, hidden) }
        NeedsSheet(view.list, view.queue, now, actions, ops.replies, hub, { needsOpen = false; editKey = it.key }, { needsOpen = false; push("review") }, { needsOpen = false; push("person:$it") }) { needsOpen = false }
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

@Composable
private fun AskBar(hub: Hub, st: CodexState, profile: String?) {
    val text by hub.codexDraft.collectAsState()
    val uploading by hub.codexUploads.collectAsState()
    val send = {
        val q = text.trim()
        if (q.isNotEmpty() && uploading == 0) {
            val p = profile ?: hub.codexProfile
            hub.askCodex(askText(q, p, st.items.filter { !it.deleted && it.profile == p }, null, st.meetings.filter { it.profile == p }), p)
            hub.setCodexDraft("")
        }
    }
    val recipes = remember(text) { matchRecipes(DEFAULT_RECIPES, text) }
    Column {
        if (recipes.isNotEmpty()) Group {
            recipes.forEachIndexed { i, r -> if (i > 0) Hairline(); ListRow(r.title, onClick = { hub.setCodexDraft(r.text) }) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), verticalAlignment = Alignment.CenterVertically) {
            AttachButton(hub, { n -> hub.codexUploads.update { it + n } }, choose = false) { path -> hub.setCodexDraft(appendWord(hub.codexDraft.value, "[Image: $path] ")) }
            TextField(text, hub::setCodexDraft, Modifier.weight(1f), placeholder = if (uploading > 0) "Uploading image…" else "Ask Codex about your day, or / for recipes", singleLine = true, pill = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
            val dictation = remember { Dictation() }
            VoiceButton({ spoken, final -> dictation.apply(text, text.length, spoken, final)?.let { hub.setCodexDraft(it.first) } }, { hub.notice.value = it })
            IconBtn("send", "Send", { send() }, enabled = text.isNotBlank() && uploading == 0, on = text.isNotBlank() && uploading == 0)
        }
    }
}

@Composable
private fun OverviewPage(hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions, onOpen: (Row) -> Unit, onNeeds: () -> Unit, onGoals: () -> Unit, onAdd: () -> Unit, onMeeting: (Row) -> Unit) {
    val s = remember(st.items, profile, now / 60_000) { split(st.items, profile, now) }
    val mt = remember(st.meetings, profile, now / 60_000) { meetingsOf(st.meetings, profile, now) }
    val hidden by hub.handled.collectAsState()
    val needsView = remember(st, profile, now / 60_000, hidden) { needsView(st, profile, now, hidden) }
    val needs = needsView.list
    val needsTotal = needsView.total
    val today = remember(st, profile, s, mt, needs) { overviewToday(s, mt.next, now, riskKeys(needs)) }
    val others = mt.today.filter { it != mt.next && (it.endsAt ?: it.startsAt!!) > now }
    val goals = remember(st.items, profile, now / 60_000) { goalsOf(st.items, now, profile) }
    var all by remember { mutableStateOf(false) }
    val rows = remember(today, others) {
        today.late.map { Triple(it.at ?: 0L, null as Row?, it) } + (others.map { Triple(it.startsAt!!, it, null as Row?) } + today.todo.map { Triple(it.at ?: 0L, null as Row?, it) }).sortedBy { it.first }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            val task = today.upNextTask
            if (mt.next != null || task != null) {
                SectionHeader("Up next")
                Group {
                    mt.next?.let { MeetingRow(it, now, upNext = true) { onMeeting(it) } }
                    if (mt.next != null && task != null) Hairline()
                    task?.let { ListRow(it.title ?: "", it.at?.let { a -> clock(a) }, onClick = { onOpen(it) }, trailing = { Button("Done", { actions.done(it) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
                }
            } else {
                val later = s.later.filter { it.at != null }.minByOrNull { it.at!! }
                val hint = when {
                    later != null && (mt.nextLater == null || later.at!! < mt.nextLater.startsAt!!) -> "Next: ${whenText(later.at!!, now)} ${later.title}"
                    mt.nextLater != null -> "Next: ${whenText(mt.nextLater.startsAt!!, now)} ${mt.nextLater.title}"
                    else -> "Nothing planned. Add a task to start the day."
                }
                EmptyState("Nothing today", hint, icon = "pass") { Button("New task", onAdd, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }
            }
            if (needsTotal > 0) {
                Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Needs you", onClick = onNeeds, trailing = { Badge("$needsTotal", BadgeTone.Quiet); Chevron() }) }
            }
        }
        if (rows.isNotEmpty()) {
            item { SectionHeader("Today", action = doneCount(s.doneToday.size, today.openCount)?.let { t -> { Badge(t, BadgeTone.Quiet) } }) }
            val shown = if (all) rows else rows.take(TODAY_SHOWN)
            item {
                Group {
                    shown.forEachIndexed { i, (_, m, r) ->
                        if (i > 0) Hairline()
                        if (m != null) MeetingRow(m, now, upNext = false) { onMeeting(m) }
                        else if (r != null) ListRow(
                            r.title ?: "", if (r in today.late) null else r.at?.let { clock(it) },
                            leading = { CheckCircle(false, "Mark ${r.title} done") { actions.done(r) } },
                            trailing = {
                                if (r in today.late) Badge("Late", BadgeTone.Failed)
                                MoreButton { close ->
                                    MenuItem("Snooze to tomorrow", "clock", { close(); actions.snoozeLater(r) })
                                    MenuItem("Open", "arrow-right", { close(); onOpen(r) })
                                }
                            },
                            onClick = { onOpen(r) },
                        )
                    }
                }
                if (rows.size > shown.size) Button("Show all ${rows.size}", { all = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
        }
        if (goals.isNotEmpty()) {
            item { SectionHeader("Goals this week") }
            item {
                Group {
                    goals.forEachIndexed { i, g ->
                        if (i > 0) Hairline()
                        val p = goalProgress(st.items, g)
                        ListRow(g.title ?: "", if (p.total > 0) "${p.done}/${p.total} done" else "No tasks yet", onClick = onGoals, trailing = { Chevron() })
                    }
                }
            }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = Tokens.fab + Tokens.sp20)) }
    }
}

@Composable
private fun MeetingRow(m: Row, now: Long, upNext: Boolean, onClick: () -> Unit) {
    val live = isLive(m, now)
    val soon = joinMinutes(m, now)
    val meta = if (upNext) listOfNotNull(countdown(m, now), meetingMeta(m, now)).joinToString(" · ") else if (soon != null) "Starts in $soon min" else clock(m.startsAt!!)
    ListRow(m.title ?: "Meeting", meta, onClick = onClick, trailing = { if (live) Badge("Live", BadgeTone.Running) })
}

@Composable
private fun TasksPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, searching: Boolean, query: String, setQuery: (String) -> Unit, onOpen: (Row) -> Unit, onTag: (String) -> Unit) {
    val s = remember(st.items, profile, now / 60_000) { split(st.items, profile, now) }
    val days = remember(s) { taskDays(s, now) }
    val tags = remember(st.items, profile) { allTags(st.items, profile).take(12) }
    var doneOpen by rememberSaveable { mutableStateOf(false) }
    var olderOpen by rememberSaveable { mutableStateOf(false) }
    val showProfile = profile == null
    val hit = remember(s, days, query) { searchTasks(s, days, query) }
    val fresh = s.review.filter { now - it.statusTime < DAY_MS }
    val older = s.review.filter { now - it.statusTime >= DAY_MS }
    LazyColumn(Modifier.fillMaxSize()) {
        if (searching) item {
            SearchField(query, setQuery, "Search tasks")
        }
        if (searching && query.isNotBlank()) {
            item { SectionHeader("Results", hit.size.toString()) }
            if (hit.isEmpty()) item { EmptyState("No task matches") } else item { Group { hit.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
            return@LazyColumn
        }
        if (tags.isNotEmpty() && !searching) item {
            androidx.compose.foundation.lazy.LazyRow(Modifier.padding(vertical = Tokens.sp2), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                items(tags) { t -> Chip("#$t", { onTag(t) }) }
            }
        }
        if (s.overdue.isNotEmpty()) {
            item { SectionHeader("Overdue", s.overdue.size.toString(), action = { Button("Move all to today", { actions.moveToToday(s.overdue) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
            item { Group { s.overdue.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
        }
        days.firstOrNull()?.takeIf { it.rows.isNotEmpty() }?.let { d -> daySection(d, now, actions, showProfile, onOpen) }
        reviewSection("Needs you", fresh, now, actions, showProfile, onOpen)
        if (older.isNotEmpty()) {
            item { SectionHeader("Older to review", older.size.toString(), open = olderOpen, onToggle = { olderOpen = !olderOpen }) }
            if (olderOpen) reviewSection(null, older, now, actions, showProfile, onOpen)
        }
        days.drop(1).filter { it.rows.isNotEmpty() }.forEach { d -> daySection(d, now, actions, showProfile, onOpen) }
        if (s.overdue.isEmpty() && days.all { it.rows.isEmpty() } && s.review.isEmpty()) item { EmptyState("All clear", "Add a task with the button below, like “call the bank tomorrow 9”") }
        if (s.doneToday.isNotEmpty()) {
            item { SectionHeader("Done", s.doneToday.size.toString(), open = doneOpen, onToggle = { doneOpen = !doneOpen }, action = if (doneOpen) ({ Button("Clear", { actions.clear(s.doneToday) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) else null) }
            if (doneOpen) item { Group { s.doneToday.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = Tokens.fab + Tokens.sp16)) }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.daySection(d: Day, now: Long, actions: TaskActions, showProfile: Boolean, onOpen: (Row) -> Unit) {
    item { SectionHeader(d.label, d.rows.size.toString()) }
    item { Group { d.rows.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, inDay = d.day != null, onOpen = { onOpen(r) }) } } }
}

private fun androidx.compose.foundation.lazy.LazyListScope.reviewSection(label: String?, rows: List<Row>, now: Long, actions: TaskActions, showProfile: Boolean, onOpen: (Row) -> Unit) {
    if (rows.isEmpty()) return
    if (label != null) item { SectionHeader(label, rows.size.toString()) }
    item {
        Group {
            rows.forEachIndexed { i, r ->
                if (i > 0) Hairline()
                ListRow(r.title ?: "", listOfNotNull(r.people?.takeIf { it.isNotEmpty() }, if (showProfile) profileLabel(r.profile) else null).joinToString(" · "), onClick = { onOpen(r) },
                    trailing = {
                        Button("Add", { actions.accept(r) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                        MoreButton { close -> MenuItem("Dismiss", "close", { close(); actions.dismiss(r) }) }
                    })
            }
        }
    }
}

@Composable
private fun TagPage(st: CodexState, tag: String, now: Long, actions: TaskActions, showProfile: Boolean, onOpen: (Row) -> Unit) {
    val rows = remember(st.items, tag) { tagTasks(st.items, tag) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { SectionHeader("#$tag", rows.size.toString()) }
        if (rows.isEmpty()) item { EmptyState("No open tasks with #$tag") }
        else item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
    }
}

@Composable
private fun GoalsPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, goals: GoalActions, onOpen: (Row) -> Unit) {
    val weeks = remember(st.items, profile, now / 60_000) { goalHistory(st.items, now, profile) }
    var renaming by remember { mutableStateOf<Row?>(null) }
    var text by rememberSaveable { mutableStateOf("") }
    var pick by rememberSaveable { mutableStateOf(WORK) }
    val target = profile ?: pick
    val full = remember(st.items, target, now / 60_000) { goalsOf(st.items, now, target).size >= MAX_GOALS }
    val add = { if (goals.add(text, target)) text = "" }
    LazyColumn(Modifier.fillMaxSize()) {
        if (!full) item {
            if (profile == null) Row(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Chip("Work", { pick = WORK }, on = pick == WORK, tone = ChipTone.Work)
                Chip("Personal", { pick = PERSONAL }, on = pick == PERSONAL, tone = ChipTone.Personal)
            }
            TextField(text, { text = it }, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), singleLine = true, placeholder = "Add a goal for this week",
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }))
        }
        if (weeks.isEmpty()) item { EmptyState("No goals yet", "Add up to $MAX_GOALS goals for this week above") }
        weeks.forEach { w ->
            item { SectionHeader(w.label) }
            w.goals.forEach { g ->
                val tasks = goalTasks(st.items, g)
                val p = goalProgress(st.items, g)
                val thisWeek = w.start == weekStart(now)
                val past = w.start < weekStart(now)
                val blocked = if (thisWeek) moveBlock(st.items, g, now) else if (past) reopenBlock(st.items, g, now) else null
                item {
                    Group(Modifier.padding(bottom = Tokens.sp4)) {
                        ListRow(g.title ?: "", (if (profile == null) "${profileLabel(g.profile)} · " else "") + if (p.total > 0) "${p.done}/${p.total}" else "No tasks yet", trailing = {
                            MoreButton { close ->
                                MenuItem("Rename", "edit", { close(); renaming = g })
                                if (thisWeek) MenuItem(blocked ?: "Move to next week", "arrow-right", {
                                    close()
                                    val at = dayPlus(weekStart(now), 7)
                                    val old = g.at
                                    if (goals.move(g, at)) actions.undoable("Moved to next week") { goals.move(g, old) }
                                }, enabled = blocked == null)
                                if (past) MenuItem(blocked ?: "Reopen this week", "discard", { close(); goals.reopen(g) }, enabled = blocked == null)
                                MenuSeparator()
                                MenuItem("Delete", "trash", { close(); goals.remove(g) }, danger = true)
                            }
                        })
                        tasks.forEach { t -> Hairline(); TaskRowView(t, now, actions, false, onOpen = { onOpen(t) }) }
                    }
                }
            }
        }
    }
    renaming?.let { g -> TextDialog("Rename goal", g.title ?: "", "Save", { goals.rename(g, it) }, { renaming = null }, maxLength = 120) }
}

@Composable
private fun SearchPage(st: CodexState, profile: String?, onOpen: (Row) -> Unit, onMeeting: (Row) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val hits = remember(st.items, st.meetings, profile, query) { searchAll(st.items, st.meetings, query, profile) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { SearchField(query, { query = it }, "Search tasks and meetings") }
        fun section(label: String, list: List<Hit>, open: ((Row) -> Unit)?) {
            if (list.isEmpty()) return
            item { SectionHeader(label, list.size.toString()) }
            item { Group { list.take(30).forEachIndexed { i, h -> if (i > 0) Hairline(); ListRow(h.title, listOf(profileLabel(h.row.profile), h.snippet).filter { it.isNotEmpty() }.joinToString(" · "), onClick = open?.let { o -> { o(h.row) } }) } } }
        }
        section("Tasks and notes", hits.tasks, onOpen)
        section("Meetings", hits.meetings, onMeeting)
        if (query.isNotBlank() && hits.total == 0) item { EmptyState("No matches") }
    }
}
