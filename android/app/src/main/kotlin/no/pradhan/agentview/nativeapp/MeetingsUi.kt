package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import kotlinx.coroutines.delay

private const val PAGE_SIZE = 30
private const val NOTES_SAVE_MS = 800L

fun safeHref(url: String?) = url?.takeIf { it.startsWith("https://") || it.startsWith("http://") }

@Composable
private fun MeetingListRow(m: Row, now: Long, showProfile: Boolean, noDay: Boolean = false, onClick: () -> Unit) {
    val live = isLive(m, now)
    val meta = listOfNotNull(meetingMeta(m, now, noDay), if (showProfile) profileLabel(m.profile) else null).joinToString(" · ")
    ListRow(m.title ?: "Meeting", meta, onClick = onClick, trailing = { if (live) RowLabel("Live", av.ok) })
}

@Composable
fun MeetingsListPage(st: CodexState, profile: String?, now: Long, chips: Set<String>, decisions: Boolean, onChip: (String) -> Unit, onOpen: (Row) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var shown by rememberSaveable(query, chips.joinToString(), decisions) { mutableIntStateOf(PAGE_SIZE) }
    val minute = now / 60_000
    val mine = remember(st.meetings, profile) { liveRows(st.meetings.filter { matchesProfile(profile, it) }) }
    val found = remember(mine, st.items, chips, query, minute) { searchMeetings(filterMeetings(mine, st.items, chips, now), query) }
    val groups = remember(found, minute) { groupMeetings(found, now) }
    val coming = remember(mine, minute) { comingDays(mine, now) }
    val log = remember(mine) { decisionLog(mine) }
    val showProfile = profile == null
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
                if (log.size > shown) Button("Show more", { shown += PAGE_SIZE }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
            return@LazyColumn
        }
        item {
            SearchField(query, { query = it }, "Search meetings")
        }
        item {
            LazyRow(Modifier.padding(vertical = Tokens.sp2), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.sp6), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                items(MEETING_CHIPS) { c -> Chip(c, { onChip(c) }, on = c in chips) }
            }
        }
        if (query.isEmpty() && chips.isEmpty()) {
            coming.forEach { g ->
                item { SectionHeader(g.label, g.rows.size.toString()) }
                item { Group { g.rows.forEachIndexed { i, m -> if (i > 0) Hairline(); MeetingListRow(m, now, showProfile, noDay = true) { onOpen(m) } } } }
            }
            if (coming.isEmpty()) item { EmptyState("Nothing on the calendar this week") }
        }
        var left = shown
        for (g in groups) {
            if (left <= 0) break
            val rows = g.rows.take(left)
            left -= rows.size
            item { SectionHeader(g.label) }
            item { Group { rows.forEachIndexed { i, m -> if (i > 0) Hairline(); MeetingListRow(m, now, showProfile) { onOpen(m) } } } }
        }
        val total = groups.sumOf { it.rows.size }
        if (total > shown) item { Button("Show more", { shown += PAGE_SIZE }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
        if (groups.isEmpty()) item {
            if (chips.isNotEmpty()) EmptyState("No meetings match", "Try fewer filters")
            else EmptyState(if (query.isNotEmpty()) "No meetings match" else "No past meetings yet", if (query.isNotEmpty()) "Search covers titles, people, notes, summaries and decisions" else "Coming meetings are listed by day")
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
private fun ActionLine(r: Row, m: Row, now: Long, actions: TaskActions) {
    val status = r.status ?: ""
    val at = r.at
    val late = status == "open" && at != null && at < now
    val meta = listOfNotNull(
        if ((status == "open" || status == "suggested") && at != null) whenText(at, now) else null,
        r.str("assignee")?.takeIf { it.isNotEmpty() }?.let { displayName(it).substringBefore(' ') },
        firstLine(r.text).ifEmpty { null },
    ).joinToString(" · ")
    val primary: Pair<String, () -> Unit>? = when (status) {
        "open" -> "Done" to { actions.done(r) }
        "done" -> "Not done" to { actions.reopen(r) }
        "suggested" -> "Mine" to { actions.accept(r) }
        "unassigned" -> "Take it" to { actions.accept(r) }
        "dismissed" -> "Restore" to { actions.restore(r) }
        else -> null
    }
    ListRow(r.title ?: "(Untitled)", meta, strike = status == "done", trailing = {
        if (late) RowLabel("Overdue", av.err)
        if (primary != null) Button(primary.first, primary.second, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        if (status == "open" || status == "suggested" || status == "done") MoreButton { close ->
            if (status != "done") MenuItem("Not mine", { close(); actions.dismiss(r) })
            if (status == "open") MenuItem("Snooze", { close(); actions.snoozeLater(r) })
            MenuItem("Delete", { close(); actions.delete(r) }, danger = true)
        }
    })
}

private fun LazyListScope.actionGroup(rows: List<Row>, m: Row, now: Long, actions: TaskActions) {
    item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); ActionLine(r, m, now, actions) } } }
}

@Composable
private fun NotesField(hub: Hub, m: Row) {
    val remote = m.str("notes") ?: ""
    var text by remember(m.key) { mutableStateOf(remote) }
    var dirty by remember(m.key) { mutableStateOf(false) }
    val latest by rememberUpdatedState(text)
    val save = {
        if (dirty) {
            dirty = false
            val row = hub.codex.current(m)
            if (latest != (row.str("notes") ?: "")) hub.codex.update(row, mapOf("notes" to latest))
        }
    }
    val flush by rememberUpdatedState(save)
    LaunchedEffect(remote) { if (!dirty) text = remote }
    LaunchedEffect(text) { if (dirty) { delay(NOTES_SAVE_MS); flush() } }
    DisposableEffect(m.key) { onDispose { flush() } }
    TextField(text, { text = it; dirty = true }, Modifier.padding(horizontal = Tokens.sp6), minLines = 3,
        placeholder = "Write your notes. They stay yours; the summary is written separately.")
}

@Composable
private fun Body(text: String) = Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fg)

@Composable
private fun Pending(text: String) = Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted)

@Composable
private fun Fold(label: String, count: Int, open: Boolean, onToggle: () -> Unit) {
    if (count == 0) return
    SectionHeader(label, count.toString(), action = { Button(if (open) "Hide" else "Show", onToggle, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
}

@Composable
fun MeetingPage(hub: Hub, st: CodexState, m: Row, now: Long, actions: TaskActions, onMeeting: (Row) -> Unit, onPerson: (String) -> Unit, onTask: (Row) -> Unit) {
    val state = meetingState(m, now)
    val all = remember(st.items, m.key) { actionsOf(st.items, m) }
    val mine = all.filter { it.status == "open" || it.status == "done" }.sortedBy { if (it.status == "open") 0 else 1 }
    val review = all.filter { it.status == "suggested" }
    val count = actionCount(st.items, m)
    val decisions = jsonList(m.str("decisions"))
    val others = othersOf(m)
    val people = peopleOf(m)
    val link = safeHref(m.str("calendar_url"))
    val uri = LocalUriHandler.current
    val isCal = m.id.startsWith("cal:")
    val prep: Pair<List<Prior>, Brief>? = remember(st.meetings, st.items, st.facts, m.key, now / 60_000) {
        if ((state == MState.Upcoming || state == MState.Live) && !isSolo(m)) Pair(priorWith(m, st.meetings, st.items), briefFor(m, st.items, st.facts)) else null
    }
    var more by rememberSaveable(m.key) { mutableStateOf(false) }
    var unassignedOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    var notMineOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    var transcriptOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    var transcript by remember(m.key) { mutableStateOf<Result<String?>?>(null) }
    var newAction by rememberSaveable(m.key) { mutableStateOf("") }
    LaunchedEffect(transcriptOpen, m.key, m.str("summary")) {
        if (transcriptOpen) transcript = runCatching { hub.api.transcript(m.profile, m.id) }
    }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            LRow(Modifier.fillMaxWidth().padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                Text(m.title?.ifEmpty { null } ?: "Untitled", Modifier.weight(1f), style = Type.title)
                if (state == MState.Live && link != null) Button("Join", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                else if (link != null && isCal) Button("Calendar", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
            pageMeta(m).takeIf { it.isNotEmpty() }?.let { Text(it, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted) }
            stateLine(m, now)?.let { Text(it, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.callout, color = if (state == MState.Missing) av.warn else av.accentText) }
        }
        item { SectionHeader("My actions", if (count.total > 0) "${count.done} of ${count.total} done" else null) }
        if (mine.isNotEmpty()) actionGroup(mine, m, now, actions)
        else if (review.isEmpty()) item {
            Pending(when (state) { MState.Missing -> "No transcript. Add actions under More."; MState.Done -> "Nothing for you in the transcript."; else -> "Your actions from the transcript land here and in Today." })
        }
        if (review.isNotEmpty()) {
            item { SectionHeader("To review", review.size.toString(), action = { if (review.size > 1) Button("Confirm all", { review.forEach { actions.edit(it, mapOf("status" to "open")) }; actions.undoable("${review.size} added to Today") { review.forEach { r -> actions.edit(r, mapOf("status" to "suggested")) } } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
            actionGroup(review, m, now, actions)
        }
        item { SectionHeader("Summary") }
        item {
            val summary = m.str("summary")
            if (!summary.isNullOrEmpty()) Markdown(summary, Modifier.padding(horizontal = Tokens.sp8))
            else Pending(if (state == MState.Missing) "No summary without a transcript." else "Written from the transcript after the meeting.")
        }
        if (decisions.isNotEmpty()) {
            item { SectionHeader("Decisions") }
            item { Column(Modifier.padding(horizontal = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) { decisions.forEach { Text("•  $it", style = Type.body, color = av.fg) } } }
        }
        prep?.let { (prior, brief) ->
            val open = prior.flatMap { p -> p.open.map { (it.title ?: "") to "${p.meeting.title} · ${dayLabel(p.meeting.startsAt!!)}" } }
            val ds = prior.flatMap { p -> p.decisions.map { it.lineSequence().first() to "${p.meeting.title} · ${dayLabel(p.meeting.startsAt!!)}" } }
            val tasks = brief.tasks.flatMap { (person, rows) -> rows.map { it to person } }
            if (open.isNotEmpty() || ds.isNotEmpty() || tasks.isNotEmpty() || brief.claims.isNotEmpty()) {
                item { SectionHeader("Prep") }
                if (open.isNotEmpty()) { item { Pending("Open actions") }; item { Group { open.forEachIndexed { i, (t, meta) -> if (i > 0) Hairline(); ListRow(t, meta) } } } }
                if (ds.isNotEmpty()) { item { Pending("Decisions") }; item { Group { ds.forEachIndexed { i, (t, meta) -> if (i > 0) Hairline(); ListRow(t, meta) } } } }
                if (tasks.isNotEmpty()) { item { Pending("Tasks") }; item { Group { tasks.forEachIndexed { i, (r, person) -> if (i > 0) Hairline(); ListRow(r.title ?: "", person, onClick = { onTask(r) }) } } } }
                if (brief.claims.isNotEmpty()) { item { Pending("Related claims") }; item { Group { brief.claims.forEachIndexed { i, f -> if (i > 0) Hairline(); ListRow(f.str("text") ?: "") } } } }
            }
        }
        item { SectionHeader("My notes") }
        item { NotesField(hub, m) }
        item { SectionHeader("More", action = { Button(if (more) "Hide" else "Show", { more = !more }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
        if (more) {
            item {
                TextField(newAction, { newAction = it }, Modifier.padding(horizontal = Tokens.sp6), singleLine = true, placeholder = "Add an action, like “send the slides friday”",
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = {
                        val t = newAction.trim()
                        if (t.isNotEmpty()) {
                            val w = parseWhen(t, now)
                            if (hub.codex.capture(stripWhen(t, w).ifEmpty { t }, "open", m.profile, w?.at, mapOf("meeting_id" to m.id)) != null) newAction = ""
                        }
                    }))
            }
            if (people.isNotEmpty()) {
                item { SectionHeader("People", people.size.toString()) }
                item { Group { people.forEachIndexed { i, p -> if (i > 0) Hairline(); ListRow(displayName(p), onClick = { onPerson(p) }) } } }
            }
            val unassigned = all.filter { it.status == "unassigned" }
            item { Fold("Unassigned", unassigned.size, unassignedOpen) { unassignedOpen = !unassignedOpen } }
            if (unassignedOpen) actionGroup(unassigned, m, now, actions)
            if (others.isNotEmpty()) {
                item { SectionHeader("Others took", others.size.toString()) }
                item { Group { others.forEachIndexed { i, o -> if (i > 0) Hairline(); ListRow(o.what, o.who) } } }
            }
            val dismissed = all.filter { it.status == "dismissed" }
            item { Fold("Not mine", dismissed.size, notMineOpen) { notMineOpen = !notMineOpen } }
            if (notMineOpen) actionGroup(dismissed, m, now, actions)
            if (state == MState.Done) {
                item { SectionHeader("Transcript", action = { Button(if (transcriptOpen) "Hide" else "Show", { transcriptOpen = !transcriptOpen }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
                if (transcriptOpen) {
                    val t = transcript
                    when {
                        t == null -> item { Pending("Loading") }
                        t.isFailure -> item { Pending("Could not load the transcript: ${t.exceptionOrNull()?.message}") }
                        t.getOrNull().isNullOrEmpty() -> item { Pending("No transcript text kept for this meeting.") }
                        else -> items(t.getOrNull()!!.lines().filter { it.isNotBlank() }) { line ->
                            Text(line, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp1), style = Type.subheadline, color = av.fgMuted, fontFamily = FontFamily.Default)
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
fun PersonPage(st: CodexState, name: String, now: Long, onMeeting: (Row) -> Unit, onWikiPage: (String, String) -> Unit, onTask: (Row) -> Unit) {
    val mine = remember(st.meetings, name) { meetingsWith(st.meetings, name) }
    val shown = remember(st.meetings, name) { nameOf(st.meetings, name) }
    val email = if ('@' in name) name.trim() else mine.flatMap { peopleOf(it) }.firstOrNull { '@' in it && sameName(it, name) }
    val commitments = remember(st.meetings, name) { commitmentsOf(st.meetings, name) }
    val claims = remember(st.facts, name) { claimsMentioning(st.facts, name) }
    val tasks = remember(st.items, name) { st.items.filter { !it.deleted && it.status == "open" && matchesWords(listOf(name.lowercase()), it.title, it.text, it.people) } }
    val titles = remember(st.pages) { st.pages.associate { it.id to it.title } }
    var all by rememberSaveable(name) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(shown, Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            Text(listOfNotNull(email, "${mine.size} ${if (mine.size == 1) "meeting" else "meetings"}").joinToString(" · "), Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted)
        }
        if (tasks.isNotEmpty()) {
            item { SectionHeader("Open tasks", tasks.size.toString()) }
            item { Group { tasks.take(5).forEachIndexed { i, r -> if (i > 0) Hairline(); ListRow(r.title ?: "(Untitled)", dueText(r, now), onClick = { onTask(r) }) } } }
        }
        if (commitments.isNotEmpty()) {
            item { SectionHeader("Commitments", commitments.size.toString()) }
            item { Group { commitments.forEachIndexed { i, c -> if (i > 0) Hairline(); ListRow(c.what, c.meeting.title, onClick = { onMeeting(c.meeting) }) } } }
        }
        item { SectionHeader("Meetings", mine.size.toString()) }
        if (mine.isEmpty()) item { EmptyState("No meetings") }
        else item {
            Group {
                (if (all) mine else mine.take(5)).forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ListRow(m.title ?: "Meeting", m.startsAt?.let { "${weekdayDate(it)} · ${clock(it)}" }, onClick = { onMeeting(m) })
                }
            }
            if (mine.size > 5 && !all) Button("Show all ${mine.size}", { all = true }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
        if (claims.isNotEmpty()) {
            item { SectionHeader("In the wiki", claims.size.toString()) }
            item {
                Group {
                    claims.forEachIndexed { i, f ->
                        if (i > 0) Hairline()
                        val pid = f.str("page_id")
                        ListRow(f.str("text") ?: "", pid?.let { titles[it] }, onClick = pid?.let { p -> { onWikiPage(f.profile, p) } })
                    }
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}
