package no.pradhan.agentview.nativeapp

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
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
    var needsOpen by rememberSaveable { mutableStateOf(false) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val actions = remember(hub) {
        TaskActions(hub.codex, { text, undo ->
            scope.launch {
                snack.currentSnackbarData?.dismiss()
                val r = snack.showSnackbar(text, if (undo != null) "Undo" else null, duration = SnackbarDuration.Short)
                if (r == SnackbarResult.ActionPerformed) undo?.invoke()
            }
        })
    }
    val owner = LocalLifecycleOwner.current
    val origin by hub.origin.collectAsState()
    LaunchedEffect(owner, origin) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { now = System.currentTimeMillis(); hub.codex.sync(); delay(SYNC_EVERY_MS) }
        }
    }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    LaunchedEffect(st) { now = System.currentTimeMillis() }

    val editing = editKey?.let { k -> st.items.firstOrNull { it.key == k && !it.deleted } }
    LaunchedEffect(editing, editKey) { if (editKey != null && editing == null && st.loaded) editKey = null }
    val sub = page != "overview" && page != "tasks"
    val back = { if (searching && page == "tasks") { searching = false; query = "" } else page = if (page.startsWith("tag:") ) "tasks" else if (sub) "overview" else page }
    BackHandler(enabled = sub || searching) { back() }
    val refresh = { scope.launch { refreshing = true; hub.codex.sync(); refreshing = false }; Unit }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            CodexTopBar(
                title = when {
                    page == "overview" -> greeting(now)
                    page == "tasks" -> "Tasks"
                    page == "goals" -> "Goals"
                    page == "search" -> "Search"
                    else -> "#" + page.removePrefix("tag:")
                },
                back = if (sub) back else null,
                filter = filterKey, onFilter = hub::setCodexFilter,
                onSearch = if (page == "overview" || page == "tasks") { { page = "tasks"; searching = true } } else null,
                menu = { close ->
                    DropdownMenuItem(text = { Text("Goals") }, onClick = { close(); page = "goals" })
                    DropdownMenuItem(text = { Text("Search everything") }, onClick = { close(); page = "search" })
                },
            )
            if (!sub) Row(Modifier.padding(horizontal = Sp.s6), horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                FilterChip(page == "overview", { page = "overview" }, { Text("Overview") })
                FilterChip(page == "tasks", { page = "tasks" }, { Text("Tasks") })
            }
            st.error?.let { Text("Sync failed: $it. Tap to retry.", Modifier.fillMaxWidth().clickable { refresh() }.padding(Sp.s8), style = MaterialTheme.typography.labelMedium, color = av.warn) }
            PullToRefreshBox(refreshing, { refresh() }, Modifier.weight(1f)) {
                when {
                    !st.loaded -> Empty("Loading Codex...")
                    page == "overview" -> OverviewPage(hub, st, profile, now, actions, { editKey = it.key }, { needsOpen = true }, { page = "goals" }, { adding = true })
                    page == "tasks" -> TasksPage(st, profile, now, actions, searching, query, { query = it }, { editKey = it.key }, { page = "tag:$it" })
                    page == "goals" -> GoalsPage(st, profile, now, actions, hub, { editKey = it.key })
                    page == "search" -> SearchPage(st, profile, { editKey = it.key })
                    else -> TagPage(st, page.removePrefix("tag:"), now, actions, profile == null, { editKey = it.key })
                }
            }
            if (page == "overview" && st.loaded) AskBar(hub, st, profile)
        }
        if (page != "goals" && page != "search") FloatingActionButton(
            onClick = { adding = true },
            Modifier.align(Alignment.BottomEnd).padding(end = Sp.s8, bottom = if (page == "overview") 88.dp else Sp.s8),
            containerColor = av.accent, contentColor = androidx.compose.ui.graphics.Color.White,
        ) { Icon(Icons.Filled.Add, "Add task") }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }

    editing?.let { row -> EditorSheet(row, st.items, now, actions) { editKey = null } }
    if (adding) AddSheet(hub, profile, now, { adding = false }) { added ->
        scope.launch { snack.currentSnackbarData?.dismiss(); snack.showSnackbar("Task · $added", duration = SnackbarDuration.Short) }
    }
    if (needsOpen) {
        val needs = remember(st, profile, now / 60_000) { needsYou(st.items, st.meetings, st.chats, profile, now) }
        NeedsSheet(needs, now, actions, hub, { needsOpen = false; editKey = it.key }) { needsOpen = false }
    }
}

@Composable
private fun CodexTopBar(title: String, back: (() -> Unit)?, filter: String, onFilter: (String) -> Unit, onSearch: (() -> Unit)?, menu: @Composable (() -> Unit) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = Sp.s4, end = Sp.s2).height(56.dp), verticalAlignment = Alignment.CenterVertically) {
        if (back != null) IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(title, Modifier.weight(1f).padding(start = if (back == null) Sp.s4 else 0.dp), style = MaterialTheme.typography.titleLarge, maxLines = 1)
        var open by remember { mutableStateOf(false) }
        Box {
            TextButton(onClick = { open = true }) { Text(if (filter == "all") "All" else profileLabel(filter)) }
            androidx.compose.material3.DropdownMenu(open, { open = false }) {
                listOf("all" to "All", WORK to "Work", PERSONAL to "Personal").forEach { (k, label) ->
                    DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onFilter(k) })
                }
            }
        }
        if (onSearch != null) IconButton(onClick = onSearch) { Icon(Icons.Filled.Search, "Search tasks") }
        MoreButton { close -> menu(close) }
    }
}

@Composable
private fun AskBar(hub: Hub, st: CodexState, profile: String?) {
    var text by rememberSaveable { mutableStateOf("") }
    val send = {
        val q = text.trim()
        if (q.isNotEmpty()) {
            val p = profile ?: hub.codexProfile
            hub.askCodex(askText(q, p, st.items.filter { !it.deleted && it.profile == p }, null, st.meetings.filter { it.profile == p }), p)
            text = ""
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = Sp.s6, vertical = Sp.s3), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(text, { text = it }, Modifier.weight(1f), placeholder = { Text("Ask Codex about your day") }, singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
        IconButton(onClick = { send() }, enabled = text.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
    }
}

@Composable
private fun OverviewPage(hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions, onOpen: (Row) -> Unit, onNeeds: () -> Unit, onGoals: () -> Unit, onAdd: () -> Unit) {
    val s = remember(st.items, profile, now / 60_000) { split(st.items, profile, now) }
    val mt = remember(st.meetings, profile, now / 60_000) { meetingsOf(st.meetings, profile, now) }
    val needs = remember(st, profile, now / 60_000) { needsYou(st.items, st.meetings, st.chats, profile, now) }
    val today = remember(s, mt) { overviewToday(s, mt.next, now) }
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
                    mt.next?.let { MeetingRow(it, now, upNext = true) }
                    if (mt.next != null && task != null) Hairline()
                    task?.let { PlainRow(it.title ?: "", it.at?.let { a -> clock(a) }, onClick = { onOpen(it) }, trailing = { TextButton(onClick = { actions.done(it) }) { Text("Done") } }) }
                }
            } else {
                val later = s.later.filter { it.at != null }.minByOrNull { it.at!! }
                val hint = when {
                    later != null && (mt.nextLater == null || later.at!! < mt.nextLater.startsAt!!) -> "Next: ${whenText(later.at!!, now)} ${later.title}"
                    mt.nextLater != null -> "Next: ${whenText(mt.nextLater.startsAt!!, now)} ${mt.nextLater.title}"
                    else -> "Nothing planned. Add a task to start the day."
                }
                Empty("Nothing today", hint)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { TextButton(onClick = onAdd) { Text("New task") } }
            }
            if (needs.isNotEmpty()) {
                Group(Modifier.padding(top = Sp.s6)) { PlainRow("Needs you", onClick = onNeeds, trailing = { Text("${needs.size}  ›", style = MaterialTheme.typography.labelLarge, color = av.warn, modifier = Modifier.padding(end = Sp.s6)) }) }
            }
        }
        if (rows.isNotEmpty()) {
            item { SectionHeader("Today", action = doneCount(s.doneToday.size, today.openCount)?.let { t -> { Text(t, style = MaterialTheme.typography.labelMedium, color = av.fgFaint, modifier = Modifier.padding(end = Sp.s4)) } }) }
            val shown = if (all) rows else rows.take(TODAY_SHOWN)
            item {
                Group {
                    shown.forEachIndexed { i, (_, m, r) ->
                        if (i > 0) Hairline()
                        if (m != null) MeetingRow(m, now, upNext = false)
                        else if (r != null) PlainRow(
                            r.title ?: "", if (r in today.late) null else r.at?.let { clock(it) },
                            leading = { CheckCircle(false, "Mark ${r.title} done") { actions.done(r) } },
                            trailing = {
                                if (r in today.late) Text("Overdue", style = MaterialTheme.typography.labelSmall, color = av.err)
                                MoreButton { close ->
                                    DropdownMenuItem(text = { Text("Snooze to tomorrow") }, onClick = { close(); actions.snoozeLater(r) })
                                    DropdownMenuItem(text = { Text("Open") }, onClick = { close(); onOpen(r) })
                                }
                            },
                            onClick = { onOpen(r) },
                        )
                    }
                }
                if (rows.size > shown.size) TextButton(onClick = { all = true }, Modifier.padding(start = Sp.s4)) { Text("Show all ${rows.size}") }
            }
        }
        if (goals.isNotEmpty()) {
            item { SectionHeader("Goals this week", action = { TextButton(onClick = onGoals) { Text("All goals") } }) }
            item {
                Group {
                    goals.forEachIndexed { i, g ->
                        if (i > 0) Hairline()
                        val p = goalProgress(st.items, g)
                        PlainRow(g.title ?: "", if (p.total > 0) "${p.done}/${p.total} done" else "No tasks yet", onClick = onGoals)
                    }
                }
            }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = 96.dp)) }
    }
}

@Composable
private fun MeetingRow(m: Row, now: Long, upNext: Boolean) {
    val live = isLive(m, now)
    val soon = joinMinutes(m, now)
    val meta = if (upNext) listOfNotNull(countdown(m, now), meetingMeta(m, now)).joinToString(" · ") else if (soon != null) "Starts in $soon min" else clock(m.startsAt!!)
    PlainRow(m.title ?: "Meeting", meta, trailing = { if (live) Text("Live", style = MaterialTheme.typography.labelSmall, color = av.ok, modifier = Modifier.padding(end = Sp.s4)) })
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
            OutlinedTextField(query, setQuery, Modifier.fillMaxWidth().padding(horizontal = Sp.s6), placeholder = { Text("Search tasks") }, singleLine = true,
                trailingIcon = { IconButton(onClick = { setQuery("") }) { Icon(Icons.Filled.Close, "Clear") } })
        }
        if (searching && query.isNotBlank()) {
            item { SectionHeader("Results", hit.size.toString()) }
            if (hit.isEmpty()) item { Empty("No task matches") } else item { Group { hit.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
            return@LazyColumn
        }
        if (tags.isNotEmpty() && !searching) item {
            androidx.compose.foundation.lazy.LazyRow(Modifier.padding(vertical = Sp.s2), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Sp.s6), horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                items(tags) { t -> androidx.compose.material3.AssistChip(onClick = { onTag(t) }, label = { Text("#$t") }) }
            }
        }
        if (s.overdue.isNotEmpty()) {
            item { SectionHeader("Overdue", s.overdue.size.toString(), action = { TextButton(onClick = { actions.moveToToday(s.overdue) }) { Text("Move all to today") } }) }
            item { Group { s.overdue.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
        }
        days.firstOrNull()?.takeIf { it.rows.isNotEmpty() }?.let { d -> daySection(d, now, actions, showProfile, onOpen) }
        reviewSection("Needs you", fresh, now, actions, showProfile, onOpen)
        if (older.isNotEmpty()) {
            item { SectionHeader("Older to review", older.size.toString(), action = { TextButton(onClick = { olderOpen = !olderOpen }) { Text(if (olderOpen) "Hide" else "Show") } }) }
            if (olderOpen) reviewSection(null, older, now, actions, showProfile, onOpen)
        }
        days.drop(1).filter { it.rows.isNotEmpty() }.forEach { d -> daySection(d, now, actions, showProfile, onOpen) }
        if (s.overdue.isEmpty() && days.all { it.rows.isEmpty() } && s.review.isEmpty()) item { Empty("All clear", "Add a task with the button below, like “call the bank tomorrow 9”") }
        if (s.doneToday.isNotEmpty()) {
            item { SectionHeader("Done", s.doneToday.size.toString(), action = { TextButton(onClick = { doneOpen = !doneOpen }) { Text(if (doneOpen) "Hide" else "Show") } }) }
            if (doneOpen) item { Group { s.doneToday.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = 88.dp)) }
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
                PlainRow(r.title ?: "", listOfNotNull(r.people?.takeIf { it.isNotEmpty() }, if (showProfile) profileLabel(r.profile) else null).joinToString(" · "), onClick = { onOpen(r) },
                    trailing = { Row { TextButton(onClick = { actions.dismiss(r) }) { Text("Dismiss", color = av.fgMuted) }; TextButton(onClick = { actions.accept(r) }) { Text("Add") } } })
            }
        }
    }
}

@Composable
private fun TagPage(st: CodexState, tag: String, now: Long, actions: TaskActions, showProfile: Boolean, onOpen: (Row) -> Unit) {
    val rows = remember(st.items, tag) { tagTasks(st.items, tag) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { SectionHeader("#$tag", rows.size.toString()) }
        if (rows.isEmpty()) item { Empty("No open tasks with #$tag") }
        else item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
    }
}

@Composable
private fun GoalsPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, hub: Hub, onOpen: (Row) -> Unit) {
    val weeks = remember(st.items, profile, now / 60_000) { goalHistory(st.items, now, profile) }
    LazyColumn(Modifier.fillMaxSize()) {
        if (weeks.isEmpty()) item { Empty("No goals yet", "Weekly goals are set on the web, in Meetings > Week") }
        weeks.forEach { w ->
            item { SectionHeader(w.label) }
            w.goals.forEach { g ->
                val tasks = goalTasks(st.items, g)
                val p = goalProgress(st.items, g)
                val blocked = if (w.start == weekStart(now)) moveBlock(st.items, g, now) else null
                item {
                    Group(Modifier.padding(bottom = Sp.s4)) {
                        PlainRow(g.title ?: "", (if (profile == null) "${profileLabel(g.profile)} · " else "") + if (p.total > 0) "${p.done}/${p.total}" else "No tasks yet", trailing = {
                            MoreButton { close ->
                                if (w.start == weekStart(now)) DropdownMenuItem(text = { Text(blocked ?: "Move to next week") }, enabled = blocked == null, onClick = {
                                    close()
                                    val at = dayPlus(weekStart(now), 7)
                                    val old = g.at
                                    if (hub.codex.update(g, mapOf("at" to at))) actions.undoable("Moved to next week") { hub.codex.update(g, mapOf("at" to old)) }
                                })
                                DropdownMenuItem(text = { Text("Delete", color = av.err) }, onClick = { close(); actions.delete(g) })
                            }
                        })
                        tasks.forEach { t -> Hairline(); TaskRowView(t, now, actions, false, onOpen = { onOpen(t) }) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchPage(st: CodexState, profile: String?, onOpen: (Row) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val hits = remember(st.items, st.meetings, profile, query) { searchAll(st.items, st.meetings, query, profile) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = Sp.s6), placeholder = { Text("Search tasks and meetings") }, singleLine = true) }
        fun section(label: String, list: List<Hit>, open: ((Row) -> Unit)?) {
            if (list.isEmpty()) return
            item { SectionHeader(label, list.size.toString()) }
            item { Group { list.take(30).forEachIndexed { i, h -> if (i > 0) Hairline(); PlainRow(h.title, listOf(profileLabel(h.row.profile), h.snippet).filter { it.isNotEmpty() }.joinToString(" · "), onClick = open?.let { o -> { o(h.row) } }) } } }
        }
        section("Tasks and notes", hits.tasks, onOpen)
        section("Meetings", hits.meetings, null)
        if (query.isNotBlank() && hits.total == 0) item { Empty("No matches") }
    }
}
