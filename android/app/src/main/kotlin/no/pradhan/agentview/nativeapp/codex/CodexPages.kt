package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import no.pradhan.agentview.nativeapp.codex.meetings.actionGroups
import no.pradhan.agentview.nativeapp.codex.meetings.actionMeta
import no.pradhan.agentview.nativeapp.codex.meetings.meetingGroupTitle
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import no.pradhan.agentview.nativeapp.ui.rememberSettled
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens

@Composable
internal fun TasksPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, searching: Boolean, query: String, setQuery: (String) -> Unit, onOpen: (Row) -> Unit, onTag: (String) -> Unit, picked: Set<String>?, setPicked: (Set<String>?) -> Unit, onMeeting: (Row) -> Unit) {
    val s = remember(st.items, profile, now / 60_000) { split(st.items, profile, now) }
    val days = remember(s) { taskDays(s, now) }
    val tags = remember(st.items, profile) { allTags(st.items, profile).take(12) }
    var doneOpen by rememberSaveable { mutableStateOf(false) }
    var olderOpen by rememberSaveable { mutableStateOf(false) }
    val showProfile = profile == null
    val hit = remember(s, days, query) { searchTasks(s, days, query) }
    val review = s.review.filter { !queued(it) }
    val fresh = review.filter { now - it.statusTime < DAY_MS }
    val older = review.filter { now - it.statusTime >= DAY_MS }
    val pickable = remember(s, days) { s.overdue + days.flatMap { it.rows } }
    val chosen = pickable.filter { picked != null && it.key in picked }
    LaunchedEffect(chosen.size, picked?.size) { if (picked != null && chosen.size != picked.size) setPicked(chosen.map { it.key }.toSet()) }
    val pick = { r: Row -> if (searching) null else RowPick(picked != null, picked?.contains(r.key) == true) { setPicked(((picked ?: emptySet()).let { if (r.key in it) it - r.key else it + r.key })) } }
    Box(Modifier.fillMaxSize()) {
    LazyColumn(Modifier.fillMaxSize()) {
        if (searching) item {
            SearchField(query, setQuery, "Search tasks")
        }
        if (searching && query.isNotBlank()) {
            item { SectionHeader("Results", hit.size.takeIf { it > 0 }?.toString()) }
            if (hit.isEmpty()) item { EmptyState("No task matches") } else item { Group { hit.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, onOpen = { onOpen(r) }) } } }
            return@LazyColumn
        }
        if (tags.isNotEmpty() && !searching) item {
            androidx.compose.foundation.lazy.LazyRow(Modifier.padding(vertical = Tokens.sp2), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                items(tags) { t -> Chip("#$t", { onTag(t) }) }
            }
        }
        if (s.overdue.isNotEmpty()) {
            item { SectionHeader("Overdue", s.overdue.size.toString(), action = if (picked == null) ({ Button("Move all to today", { actions.moveToToday(s.overdue) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) else null) }
            item { Group { s.overdue.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, pick = pick(r), onOpen = { onOpen(r) }) } } }
        }
        days.firstOrNull()?.takeIf { it.rows.isNotEmpty() }?.let { d -> daySection(d, now, actions, pick, onOpen) }
        reviewSection("Needs you", fresh, st.meetings, now, actions, showProfile, onOpen, onMeeting)
        if (older.isNotEmpty()) {
            item { SectionHeader("Older to review", older.size.toString(), open = olderOpen, onToggle = { olderOpen = !olderOpen }) }
            if (olderOpen) reviewSection(null, older, st.meetings, now, actions, showProfile, onOpen, onMeeting)
        }
        days.drop(1).filter { it.rows.isNotEmpty() }.forEach { d -> daySection(d, now, actions, pick, onOpen) }
        if (s.overdue.isEmpty() && days.all { it.rows.isEmpty() } && review.isEmpty()) item { EmptyState("All clear", "Add a task with the button below, like “call the bank tomorrow 9”") }
        if (s.doneToday.isNotEmpty()) {
            item { SectionHeader("Done", s.doneToday.size.toString(), open = doneOpen, onToggle = { doneOpen = !doneOpen }, action = if (doneOpen) ({ Button("Clear", { actions.clear(s.doneToday) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) else null) }
            if (doneOpen) item { Group { s.doneToday.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, onOpen = { onOpen(r) }) } } }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = Tokens.fab + Tokens.sp16)) }
    }
    if (picked != null && !searching) SelectionBar(
        chosen.size, { kind -> actions.bulk(chosen, kind); setPicked(null) }, { setPicked(null) }, Modifier.align(Alignment.BottomCenter),
        menu = chosen.singleOrNull()?.let { r -> { close -> TaskMenu(r, { close(); setPicked(null) }, actions) { onOpen(r) } } },
    )
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.daySection(d: Day, now: Long, actions: TaskActions, pick: (Row) -> RowPick?, onOpen: (Row) -> Unit) {
    item { SectionHeader(d.label, d.rows.size.toString()) }
    item { Group { d.rows.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, inDay = d.day != null, pick = pick(r), onOpen = { onOpen(r) }) } } }
}

private fun androidx.compose.foundation.lazy.LazyListScope.reviewSection(label: String?, rows: List<Row>, meetings: List<Row>, now: Long, actions: TaskActions, showProfile: Boolean, onOpen: (Row) -> Unit, onMeeting: (Row) -> Unit) {
    if (rows.isEmpty()) return
    if (label != null) item { SectionHeader(label, rows.size.toString()) }
    actionGroups(rows).forEach { g ->
        val first = g.rows[0]
        val meeting = first.meetingId?.takeIf { it.isNotEmpty() }?.let { id -> meetings.firstOrNull { it.profile == first.profile && it.id == id } }
        val header = when {
            !first.meetingId.isNullOrEmpty() -> "Is this yours? · ${meetingGroupTitle(meeting?.title, first.people)}"
            isSaid(first) -> "You said · ${channelOf(first).label}"
            else -> "Is this yours? · ${channelOf(first).label}"
        }
        item(g.key) {
            val clip = LocalClipboardManager.current
            val uri = LocalUriHandler.current
            Column {
                SectionHeader(header, action = meeting?.let { m -> { Button("Open meeting", { onMeeting(m) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } })
                Group {
                    g.rows.forEachIndexed { i, r ->
                        if (i > 0) Hairline()
                        val meta = actionMeta(r, now, r.text?.takeIf { it.isNotEmpty() }, if (showProfile) profileLabel(r.profile) else null)
                        val inMeeting = !r.meetingId.isNullOrEmpty()
                        ListRow(r.title ?: "", meta, onClick = { onOpen(r) },
                            state = { Badge("Needs you", BadgeTone.Waiting) },
                            trailing = { Button("Mine", { actions.accept(r) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
                            menu = { close ->
                                MenuItem("Not mine", "circle-slash", { close(); actions.dismiss(r, if (inMeeting) "Moved to Not mine" else "Dismissed") })
                                if (!inMeeting) {
                                    safeHref(r.sourceUrl)?.let { href -> MenuItem("Open source", "link-external", { close(); uri.openUri(href) }) }
                                    r.draft?.takeIf { it.isNotBlank() }?.let { d -> MenuItem("Copy draft", "copy", { close(); clip.setText(AnnotatedString(d)); actions.say("Draft copied") }) }
                                }
                            })
                    }
                }
                if (g.rows.size > 1) Row(Modifier.padding(start = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    Button("Confirm all ${g.rows.size}", { actions.acceptAll(g.rows) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
                    Button("Dismiss all ${g.rows.size}", { actions.dismissAll(g.rows) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            }
        }
    }
}

@Composable
internal fun TagPage(st: CodexState, tag: String, now: Long, actions: TaskActions, onOpen: (Row) -> Unit) {
    val rows = remember(st.items, tag) { tagTasks(st.items, tag) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { SectionHeader("#$tag", rows.size.toString()) }
        if (rows.isEmpty()) item { EmptyState("No open tasks with #$tag") }
        else item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, onOpen = { onOpen(r) }) } } }
    }
}

@Composable
internal fun GoalsPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, goals: GoalActions, onOpen: (Row) -> Unit, onAddTask: (Row) -> Unit) {
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
        if (weeks.isEmpty()) item { EmptyState("No goals yet", "Set up to $MAX_GOALS goals for this week in the field above", icon = "target") }
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
                                if (!past) MenuItem("Add task", "add", { close(); onAddTask(g) })
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
                        tasks.forEach { t -> Hairline(); TaskRowView(t, now, actions, onOpen = { onOpen(t) }) }
                    }
                }
            }
        }
    }
    renaming?.let { g -> TextDialog("Rename goal", g.title ?: "", "Save", { goals.rename(g, it) }, { renaming = null }, maxLength = 120) }
}

@Composable
internal fun SearchPage(st: CodexState, profile: String?, query: String, onQuery: (String) -> Unit, opened: Set<String>, onOpened: (Set<String>) -> Unit, onOpen: (Row) -> Unit, onMeeting: (Row) -> Unit, onRoute: (String) -> Unit) {
    val settled = rememberSettled(query)
    val hits = remember(st.items, st.meetings, st.pages, st.facts, st.jobs, profile, settled) { searchAll(st, settled, profile) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { SearchField(query, onQuery, "Search tasks, meetings, wiki and jobs") }
        fun section(label: String, list: List<Hit>, open: (Hit) -> Unit) {
            if (list.isEmpty()) return
            val all = label in opened
            item { SectionHeader(label, list.size.toString()) }
            item { Group { (if (all) list else list.take(5)).forEachIndexed { i, h -> if (i > 0) Hairline(); ListRow(h.title, listOf(profileLabel(h.row.profile), h.snippet).filter { it.isNotEmpty() }.joinToString(" · "), onClick = { open(h) }) } } }
            if (!all && list.size > 5) item { Button("Show all ${list.size}", { onOpened(opened + label) }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        }
        section("Tasks and notes", hits.tasks) { onOpen(it.row) }
        section("Meetings", hits.meetings) { onMeeting(it.row) }
        section("Wiki", hits.wiki) { h -> h.route?.let(onRoute) }
        section("Jobs", hits.jobs) { h -> h.route?.let(onRoute) }
        if (query.isNotBlank() && hits.total == 0) item { EmptyState("No matches") }
    }
}
