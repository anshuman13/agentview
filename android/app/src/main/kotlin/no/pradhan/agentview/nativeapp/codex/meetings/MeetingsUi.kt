package no.pradhan.agentview.nativeapp.codex.meetings

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.QuestionList
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.Today

import no.pradhan.agentview.nativeapp.codex.firstName
import no.pradhan.agentview.nativeapp.codex.liveRows
import no.pradhan.agentview.nativeapp.codex.matchesProfile

import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.codex.snoozeChoices
import no.pradhan.agentview.nativeapp.codex.whenText
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.resolveQuestion
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

private const val PAGE_SIZE = 50

@Composable
internal fun MeetingListRow(m: Row, now: Long, showProfile: Boolean, noDay: Boolean = false, onNotes: (Row) -> Unit, onClick: () -> Unit) {
    val live = isLive(m, now)
    val meta = listOfNotNull(meetingMeta(m, now, noDay), if (showProfile) profileLabel(m.profile) else null).joinToString(" · ")
    val calendar = if (m.id.startsWith("cal:")) safeHref(m.str("calendar_url")) else null
    val uri = LocalUriHandler.current
    ListRow(m.title ?: "Meeting", meta, state = if (live) ({ Badge("Live", BadgeTone.Running) }) else null, onClick = onClick, menu = { close ->
        if (calendar != null) MenuItem("Open calendar", "calendar", { close(); uri.openUri(calendar) })
        MenuItem("Notes", "edit", { close(); onNotes(m) })
    })
}

@Composable
private fun WaitingRowView(g: Waiting, hub: Hub) {
    val clip = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    val links = g.rows.mapNotNull { r -> safeHref(r.url)?.let { r.title to it } }
    ListRow(g.name, g.rows.joinToString(", ") { "${it.title} (${it.days}d)" }, state = if (g.rows[0].late) ({ Badge("Late", BadgeTone.Failed) }) else null, trailing = {
        Button("Copy nudge", { clip.setText(AnnotatedString(nudgeText(g))); hub.notice.value = "Nudge copied" }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        if (links.isNotEmpty()) MoreButton { close -> links.forEach { (title, href) -> MenuItem("Open $title", "link-external", { close(); uri.openUri(href) }) } }
    })
}

@Composable
fun MeetingsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, onNotes: (Row) -> Unit, onOpen: (Row) -> Unit) {
    val resolved by hub.resolvedQuestions.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    var shown by rememberSaveable(query, chips.joinToString(), decisions) { mutableIntStateOf(PAGE_SIZE) }
    val minute = now / 60_000
    val mine = remember(st.meetings, profile) { liveRows(st.meetings.filter { matchesProfile(profile, it) }) }
    val found = remember(mine, st.items, chips, query, minute) { searchMeetings(filterMeetings(mine, st.items, chips, now), query) }
    val groups = remember(found, minute) { groupMeetings(found, now) }
    val coming = remember(mine, minute) { comingDays(mine, now) }
    val log = remember(mine) { decisionLog(mine) }
    val people = remember(log) { log.flatMap { peopleOf(it.meeting) }.distinctBy { it.lowercase() }.sortedWith(String.CASE_INSENSITIVE_ORDER) }
    var person by remember(decisions) { mutableStateOf("") }
    val who = if (person in people) person else ""
    val rows = remember(log, who) { decisionsWith(log, who) }
    val clip = LocalClipboardManager.current
    val waiting = remember(st.items, st.briefs, profile, minute) { waitingByPerson(st.items, st.briefs, profile, now) }
    val showProfile = profile == null
    val questions = remember(mine, resolved, minute) { visibleQuestions(openQuestions(mine, now), resolved) }
    var allQuestions by rememberSaveable { mutableStateOf(false) }
    var showPast by rememberSaveable { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (decisions) {
            item {
                SectionHeader("Decisions", rows.size.toString(), action = if (rows.isEmpty()) null else ({
                    IconBtn("copy", "Copy as Markdown", { clip.setText(AnnotatedString(decisionsMarkdown(rows))); hub.notice.value = "Decisions copied" })
                }))
            }
            if (people.isNotEmpty()) item {
                Group {
                    var menu by remember { mutableStateOf(false) }
                    ListRow("With", who.ifEmpty { "Everyone" }, onClick = { menu = true }, trailing = {
                        Box {
                            Chevron()
                            Menu(menu, { menu = false }) {
                                (listOf("") + people).forEach { p -> MenuItem(p.ifEmpty { "Everyone" }, if (p.isEmpty()) "organization" else "person", { menu = false; person = p }, checked = who == p) }
                            }
                        }
                    })
                }
            }
            if (rows.isEmpty()) item { EmptyState(if (who.isEmpty()) "No decisions yet" else "No decisions with this person", "Decisions come from the meeting summaries", icon = "check") }
            else item {
                Group {
                    rows.take(shown).forEachIndexed { i, d ->
                        if (i > 0) Hairline()
                        ListRow(d.text, "${d.meeting.title ?: "Meeting"} · ${whenText(d.at, now)}", onClick = { onOpen(d.meeting) })
                    }
                }
                if (rows.size > shown) Button("Show more (${rows.size - shown})", { shown += PAGE_SIZE }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
            return@LazyColumn
        }
        item {
            SearchField(query, { query = it }, "Search meetings")
        }
        item {
            LazyRow(Modifier.padding(vertical = Tokens.sp2), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                items(MEETING_CHIPS) { c -> Chip(c, { onChip(c) }, on = c in chips) }
            }
        }
        if (query.isEmpty() && chips.isEmpty()) {
            if (questions.isNotEmpty()) {
                item { SectionHeader("Open questions", questions.size.toString()) }
                item {
                    QuestionList(if (allQuestions) questions else questions.take(3), now, onOpen) { hub.resolveQuestion(it, st.meetings, now) }
                    if (!allQuestions && questions.size > 3) Button("Show all ${questions.size}", { allQuestions = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            }
            coming.forEach { g ->
                item { SectionHeader(g.label, g.rows.size.toString()) }
                item { Group { g.rows.forEachIndexed { i, m -> if (i > 0) Hairline(); MeetingListRow(m, now, showProfile, noDay = true, onNotes = onNotes) { onOpen(m) } } } }
            }
            if (coming.isEmpty()) item { EmptyState("Nothing on the calendar this week", icon = "calendar") }
            if (waiting.isNotEmpty()) {
                item { SectionHeader("Waiting on", waiting.size.toString()) }
                item { Group { waiting.forEachIndexed { i, g -> if (i > 0) Hairline(); WaitingRowView(g, hub) } } }
            }
        }
        val folded = query.isEmpty() && chips.isEmpty() && !showPast
        val older = groups.filter { it.label != "Today" }.sumOf { it.rows.size }
        if (folded && older > 0) item { Group(Modifier.padding(top = Tokens.sp8)) { ListRow("Past meetings", trailing = { Chevron("$older") }, onClick = { showPast = true }) } }
        val listed = if (folded) groups.filter { it.label == "Today" } else groups
        var left = shown
        for (g in listed) {
            if (left <= 0) break
            val rows = g.rows.take(left)
            left -= rows.size
            item { SectionHeader(g.label) }
            item { Group { rows.forEachIndexed { i, m -> if (i > 0) Hairline(); MeetingListRow(m, now, showProfile, noDay = true, onNotes = onNotes) { onOpen(m) } } } }
        }
        val total = listed.sumOf { it.rows.size }
        if (total > shown) item { Button("Show more (${total - shown})", { shown += PAGE_SIZE }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        if (groups.isEmpty()) item {
            if (chips.isNotEmpty()) EmptyState("No meetings match", "Try fewer filters", icon = "calendar", small = false, action = { Button("Clear filters", { chips.forEach(onChip) }, size = ButtonSize.Sm) })
            else EmptyState(if (query.isNotEmpty()) "No meetings match" else "No past meetings yet", if (query.isNotEmpty()) "Search covers titles, people, notes, summaries and decisions" else "Coming meetings are listed by day", icon = "calendar", small = false)
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
fun ActionLine(r: Row, m: Row, now: Long, actions: TaskActions, readOnly: Boolean, from: String? = null, onTask: ((Row) -> Unit)? = null) {
    val status = r.status ?: ""
    val at = r.at
    val late = status == "open" && at != null && at < now
    val rest = actionMeta(r, now, from)
    val meta = buildAnnotatedString {
        if (late) { pushStyle(SpanStyle(color = av.err)); append("Late"); pop(); if (rest.isNotEmpty()) append(" · ") }
        append(rest)
    }
    val primary: Pair<String, () -> Unit>? = when (status) {
        "open" -> "Done" to { actions.done(r) }
        "done" -> "Not done" to { actions.reopen(r) }
        "suggested" -> "Mine" to { actions.accept(r) }
        "unassigned" -> "Take it" to { actions.accept(r) }
        "dismissed" -> "Restore" to { actions.restore(r) }
        else -> null
    }
    ListRow(r.title ?: UNTITLED, meta, strike = status == "done", onClick = onTask?.let { { it(r) } }, trailing = {
        if (primary != null) Button(primary.first, primary.second, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !readOnly)
        MoreButton { close -> ActionMenuItems(r, m, now, actions, readOnly, close, onTask) }
    })
}

@Composable
fun ColumnScope.ActionMenuItems(r: Row, m: Row, now: Long, actions: TaskActions, readOnly: Boolean, close: () -> Unit, onEdit: ((Row) -> Unit)?, extra: @Composable ColumnScope.() -> Unit = {}) {
    val clip = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    var sub by remember(r.key) { mutableStateOf<String?>(null) }
    val cur = r.str("assignee")?.ifEmpty { null }
    val assign = { who: String? -> if (who != cur) actions.change(r, mapOf("assignee" to who), "Assigned to ${who?.let { firstName(displayName(it)) } ?: "me"}") }
    val items = actionMenu(r.status ?: "")
    if (sub == "assign") {
        MenuItem("Me", "person", { close(); assign(null) }, checked = cur == null)
        val people = peopleOf(m)
        (if (cur != null && cur !in people) listOf(cur) + people else people).forEach { n ->
            MenuItem(displayName(n), "person", { close(); assign(n) }, checked = n == cur)
        }
    } else if (sub == "snooze") {
        snoozeChoices(now).forEach { s ->
            val to = s.at(now, r.profile)
            MenuItem("${s.label} · ${whenText(to, now)}", "clock", { close(); actions.snooze(r, to) })
        }
    } else {
        if (items.notMine) MenuItem("Not mine", "circle-slash", { close(); actions.dismiss(r, "Moved to Not mine") }, enabled = !readOnly)
        if (items.assign) MenuItem("Assign", "person", { sub = "assign" }, enabled = !readOnly)
        if (items.snooze) MenuItem("Snooze", "clock", { sub = "snooze" }, enabled = !readOnly)
        if (onEdit != null) MenuItem("Edit", "edit", { close(); onEdit(r) })
        if (r.status == "open") MenuItem("New Linear issue", "issues", { close(); uri.openUri(linearIssue(r, m)) })
        MenuItem("Copy as message", "copy", { close(); clip.setText(AnnotatedString(draftFor(r, m))); actions.say("Message copied") })
        extra()
        MenuItem("Delete", "trash", { close(); actions.delete(r) }, danger = true, enabled = !readOnly)
    }
}
