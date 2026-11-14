package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import no.pradhan.agentview.nativeapp.ui.rememberSettled
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
internal fun TasksPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, searching: Boolean, query: String, setQuery: (String) -> Unit, onOpen: (Row) -> Unit, onTag: (String) -> Unit) {
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
internal fun TagPage(st: CodexState, tag: String, now: Long, actions: TaskActions, showProfile: Boolean, onOpen: (Row) -> Unit) {
    val rows = remember(st.items, tag) { tagTasks(st.items, tag) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { SectionHeader("#$tag", rows.size.toString()) }
        if (rows.isEmpty()) item { EmptyState("No open tasks with #$tag") }
        else item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); TaskRowView(r, now, actions, showProfile, onOpen = { onOpen(r) }) } } }
    }
}

@Composable
internal fun GoalsPage(st: CodexState, profile: String?, now: Long, actions: TaskActions, goals: GoalActions, onOpen: (Row) -> Unit) {
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
internal fun SearchPage(st: CodexState, profile: String?, onOpen: (Row) -> Unit, onMeeting: (Row) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val settled = rememberSettled(query)
    val hits = remember(st.items, st.meetings, profile, settled) { searchAll(st.items, st.meetings, settled, profile) }
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
