package no.pradhan.agentview.nativeapp.codex.meetings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import no.pradhan.agentview.nativeapp.codex.isLive
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import no.pradhan.agentview.nativeapp.codex.meetingMeta
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.codex.whenText
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.resolveQuestion
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
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

private const val PAGE_SIZE = 30

fun safeHref(url: String?) = url?.takeIf { Regex("^(https?:|mailto:)", RegexOption.IGNORE_CASE).containsMatchIn(it) }

@Composable
private fun MeetingListRow(m: Row, now: Long, showProfile: Boolean, noDay: Boolean = false, onClick: () -> Unit) {
    val live = isLive(m, now)
    val meta = listOfNotNull(meetingMeta(m, now, noDay), if (showProfile) profileLabel(m.profile) else null).joinToString(" · ")
    ListRow(m.title ?: "Meeting", meta, onClick = onClick, trailing = { if (live) Badge("Live", BadgeTone.Running) })
}

@Composable
fun MeetingsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, onOpen: (Row) -> Unit) {
    val resolved by hub.resolvedQuestions.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    var shown by rememberSaveable(query, chips.joinToString(), decisions) { mutableIntStateOf(PAGE_SIZE) }
    val minute = now / 60_000
    val mine = remember(st.meetings, profile) { liveRows(st.meetings.filter { matchesProfile(profile, it) }) }
    val found = remember(mine, st.items, chips, query, minute) { searchMeetings(filterMeetings(mine, st.items, chips, now), query) }
    val groups = remember(found, minute) { groupMeetings(found, now) }
    val coming = remember(mine, minute) { comingDays(mine, now) }
    val log = remember(mine) { decisionLog(mine) }
    val showProfile = profile == null
    val questions = remember(mine, resolved, minute) { visibleQuestions(openQuestions(mine, now), resolved) }
    var allQuestions by rememberSaveable { mutableStateOf(false) }
    var showPast by rememberSaveable { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (decisions) {
            item { SectionHeader("Decisions", log.size.toString()) }
            if (log.isEmpty()) item { EmptyState("No decisions yet", "Decisions come from the meeting summaries") }
            else item {
                Group {
                    log.take(shown).forEachIndexed { i, d ->
                        if (i > 0) Hairline()
                        ListRow(d.text, "${d.meeting.title ?: "Meeting"} · ${whenText(d.at, now)}", onClick = { onOpen(d.meeting) })
                    }
                }
                if (log.size > shown) Button("Show more", { shown += PAGE_SIZE }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
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
                item { Group { g.rows.forEachIndexed { i, m -> if (i > 0) Hairline(); MeetingListRow(m, now, showProfile, noDay = true) { onOpen(m) } } } }
            }
            if (coming.isEmpty()) item { EmptyState("Nothing on the calendar this week") }
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
            item { Group { rows.forEachIndexed { i, m -> if (i > 0) Hairline(); MeetingListRow(m, now, showProfile) { onOpen(m) } } } }
        }
        if (listed.sumOf { it.rows.size } > shown) item { Button("Show more", { shown += PAGE_SIZE }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        if (groups.isEmpty()) item {
            if (chips.isNotEmpty()) EmptyState("No meetings match", "Try fewer filters")
            else EmptyState(if (query.isNotEmpty()) "No meetings match" else "No past meetings yet", if (query.isNotEmpty()) "Search covers titles, people, notes, summaries and decisions" else "Coming meetings are listed by day")
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
fun ActionLine(r: Row, m: Row, now: Long, actions: TaskActions, from: String? = null, onTask: ((Row) -> Unit)? = null) {
    val status = r.status ?: ""
    val at = r.at
    val late = status == "open" && at != null && at < now
    val rest = listOfNotNull(
        if ((status == "open" || status == "suggested") && at != null) whenText(at, now) else null,
        r.str("assignee")?.takeIf { it.isNotEmpty() }?.let { displayName(it).substringBefore(' ') },
        from,
    ).joinToString(" · ")
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
    ListRow(r.title ?: "(Untitled)", meta, strike = status == "done", onClick = onTask?.let { { it(r) } }, trailing = {
        if (primary != null) Button(primary.first, primary.second, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        if (status == "open" || status == "suggested" || status == "done") MoreButton { close ->
            if (status != "done") MenuItem("Not mine", "circle-slash", { close(); actions.dismiss(r) })
            if (status == "open") MenuItem("Snooze", "clock", { close(); actions.snoozeLater(r) })
            MenuItem("Delete", "trash", { close(); actions.delete(r) }, danger = true)
        }
    })
}
