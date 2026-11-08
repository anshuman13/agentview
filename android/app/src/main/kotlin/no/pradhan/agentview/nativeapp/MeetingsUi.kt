package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
            if (questions.isNotEmpty()) {
                item { SectionHeader("Open questions", questions.size.toString()) }
                item {
                    QuestionList(if (allQuestions) questions else questions.take(3), now, onOpen) { hub.resolveQuestion(it, st.meetings, now) }
                    if (!allQuestions && questions.size > 3) Button("Show all ${questions.size}", { allQuestions = true }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            }
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

private fun LazyListScope.actionGroup(rows: List<Row>, m: Row, now: Long, actions: TaskActions, onTask: (Row) -> Unit) {
    item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); ActionLine(r, m, now, actions, onTask = onTask) } } }
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
    TextField(text, { text = it; dirty = true }, Modifier.padding(horizontal = Tokens.listPad), minLines = 3,
        placeholder = "Write your notes. They stay yours; the summary is written separately.")
}

@Composable
private fun Body(text: String) = Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fg)

@Composable
private fun Pending(text: String) = Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted)

@Composable
private fun Fold(label: String, count: Int, open: Boolean, onToggle: () -> Unit) {
    if (count == 0) return
    SectionHeader(label, count.toString(), open = open, onToggle = onToggle)
}

@Composable
private fun RoomMic(hub: Hub, m: Row) {
    val room = m.str("room") ?: ""
    var busy by remember(m.key) { mutableStateOf(false) }
    Group {
        ListRow("On the room mic?", room, trailing = {
            Button("No", { hub.codex.update(m, mapOf("room_me" to 0)) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !busy)
            Button(if (busy) "Reading" else "Yes", {
                busy = true
                hub.readWithRoomMic(m) { busy = false }
            }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !busy)
        })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TalkTimeBar(speakers: List<Speaker>, actions: Int, decisions: Int) {
    val top = speakers.take(TALK_TOP)
    val rest = speakers.drop(TALK_TOP).sumOf { it.share }
    val parts = if (rest > 0) top.map { it.name to it.share } + ("Others" to rest) else top.map { it.name to it.share }
    val c = av
    val color = { i: Int -> if (i >= TALK_TOP) c.borderStrong else c.cMeeting.copy(alpha = TALK_ALPHA[i]) }
    SectionHeader("Talk time", "$actions ${if (actions == 1) "action" else "actions"} · $decisions ${if (decisions == 1) "decision" else "decisions"}")
    LRow(Modifier.padding(horizontal = Tokens.sp8).fillMaxWidth().height(Tokens.sp5).clip(RoundedCornerShape(Tokens.radiusPill))) {
        parts.forEachIndexed { i, p -> Box(Modifier.weight(p.second.toFloat().coerceAtLeast(0.001f)).fillMaxHeight().background(color(i))) }
    }
    FlowRow(Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp7), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
        parts.forEachIndexed { i, p ->
            LRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp3), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(Tokens.dot).clip(RoundedCornerShape(Tokens.radiusXs)).background(color(i)))
                Text("${p.first} ${Math.round(p.second * 100)}%", style = Type.footnote, color = av.fgMuted)
            }
        }
    }
}

private const val TALK_TOP = 5
private val TALK_ALPHA = floatArrayOf(1f, 0.75f, 0.55f, 0.4f, 0.28f)

private class PrepData(val prior: List<Prior>, val brief: Brief, val points: List<Row>, val theirs: List<String>, val questions: List<Question>)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MeetingPage(hub: Hub, st: CodexState, m: Row, now: Long, actions: TaskActions, ops: CodexOps, onMeeting: (Row) -> Unit, onPerson: (String) -> Unit, onSeries: (String) -> Unit, onTask: (Row) -> Unit) {
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
    val resolved by hub.resolvedQuestions.collectAsState()
    val prep: PrepData? = remember(st.meetings, st.items, st.facts, m.key, now / 60_000, resolved) {
        if ((state == MState.Upcoming || state == MState.Live) && !isSolo(m)) {
            val prior = priorWith(m, st.meetings, st.items)
            PrepData(prior, briefFor(m, st.items, st.facts), pointsFor(m, st.items, st.meetings), theirActions(m, prior.map { it.meeting }),
                visibleQuestions(openQuestions(st.meetings, now), resolved).filter { q -> prior.any { it.meeting.id == q.meeting.id && it.meeting.profile == q.profile } })
        } else null
    }
    val pins = remember(st.items, m.key) { pinsOf(st.items, listOf(m)) }
    val prior = remember(st.meetings, m.key) { seriesOf(st.meetings, m) }
    val repeats = remember(st.meetings, m.key, now / 60_000) { prior.firstOrNull()?.let { seriesRepeats(m, it, now) } }
    val undone = remember(st.items, prior) { openAcrossSeries(st.items, prior).sortedBy { p -> prior.indexOfFirst { it.id == p.first.id } } }
    val family = remember(st.meetings, m.key, now / 60_000) { seriesMeetings(st.meetings, m.profile, seriesTitle(m.title), now) }
    val raiseTo = remember(st.meetings, m.key, now / 60_000) { recentPeople(st.meetings, m.profile, m, now) }
    var pinning by rememberSaveable(m.key) { mutableStateOf(false) }
    var more by rememberSaveable(m.key) { mutableStateOf(false) }
    var unassignedOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    var notMineOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    var transcriptOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    var transcript by remember(m.key) { mutableStateOf<Result<String?>?>(null) }
    var newAction by rememberSaveable(m.key) { mutableStateOf("") }
    var contextOpen by rememberSaveable(m.key) { mutableStateOf(false) }
    val done = state == MState.Done
    LaunchedEffect(m.key, done, m.str("summary")) {
        if (done) transcript = runCatching { hub.api.transcript(m.profile, m.id) }
    }
    val speakers = remember(transcript) { transcript?.getOrNull()?.let { talkTime(it) } ?: emptyList() }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                LRow(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.title?.ifEmpty { null } ?: "Untitled", Modifier.weight(1f), style = Type.title)
                    if (state == MState.Live && link != null) Button("Join", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    else if (link != null && isCal) Button("Calendar", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
                pageMeta(m).takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.subheadline, color = av.fgMuted) }
                stateLine(m, now)?.let { Text(it, style = Type.callout, color = if (state == MState.Missing) av.warn else av.accentText) }
            }
            if (!m.str("room").isNullOrEmpty() && m.long("room_me") == null) RoomMic(hub, m)
        }
        if (mine.isNotEmpty()) {
            item { SectionHeader("My actions", if (count.total > 0) "${count.done} of ${count.total} done" else null) }
            actionGroup(mine, m, now, actions, onTask)
        }
        if (review.isNotEmpty()) {
            item { SectionHeader("To review", review.size.toString(), action = { if (review.size > 1) Button("Confirm all", { review.forEach { actions.edit(it, mapOf("status" to "open")) }; actions.undoable("${review.size} added to Today") { review.forEach { r -> actions.edit(r, mapOf("status" to "suggested")) } } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
            actionGroup(review, m, now, actions, onTask)
        }
        item { SectionHeader("Summary", action = if (!m.str("summary").isNullOrEmpty()) { { Button("Pin", { pinning = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } } else null) }
        m.str("summary")?.takeIf { it.isNotEmpty() }?.let { item { Markdown(it, Modifier.padding(horizontal = Tokens.listPad)) } }
        if (pins.isNotEmpty()) {
            item { SectionHeader("Pinned", pins.size.toString()) }
            item { PinList(pins, ops) }
        }
        if (decisions.isNotEmpty()) {
            item { SectionHeader("Decisions") }
            item { Group { decisions.forEachIndexed { i, d -> if (i > 0) Hairline(); ExpandRow(d, trailing = { RaiseButton(d, raiseTo) { p -> ops.points.raise(d, p, m.profile) } }) } } }
        }
        prep?.let { pr ->
            val meta = { x: Row -> "${x.title} · ${dayLabel(x.startsAt!!)}" }
            val groups = listOf(
                DigestGroup("actions", "Open actions", pr.prior.flatMap { p -> p.open.map { DigestLine(it.title ?: "", meta(p.meeting)) { onMeeting(p.meeting) } } }, true),
                DigestGroup("decisions", "Decisions", pr.prior.flatMap { p -> p.decisions.map { DigestLine(it.lineSequence().first(), meta(p.meeting)) { onMeeting(p.meeting) } } }, false),
                DigestGroup("questions", "Open questions", pr.questions.map { q -> DigestLine(q.text, meta(q.meeting)) { onMeeting(q.meeting) } }, true),
                DigestGroup("tasks", "Tasks", pr.brief.tasks.flatMap { (person, rows) -> rows.map { r -> DigestLine(r.title ?: "", person) { onTask(r) } } }, true),
                DigestGroup("theirs", "They took on", pr.theirs.map { DigestLine(it) }, true),
                DigestGroup("claims", "Related claims", pr.brief.claims.map { DigestLine(it.str("text") ?: "") }, true),
            ).filter { it.rows.isNotEmpty() }
            if (groups.isNotEmpty() || pr.points.isNotEmpty()) {
                item { SectionHeader("Prep") }
                groups.forEach { g -> item(key = "prep-${g.outcome}") { GroupList("prep:${m.key}:${g.outcome}", g, capOpen = true, plain = g.outcome == "theirs" || g.outcome == "claims") } }
                if (pr.points.isNotEmpty()) {
                    item { SectionHeader("To raise", pr.points.size.toString()) }
                    item { PointList(pr.points, st.meetings, now, person = true, showMeeting = false, ops = ops) }
                }
            }
        }
        item { SectionHeader("My notes") }
        item { NotesField(hub, m) }
        item { SectionHeader("More", open = more, onToggle = { more = !more }) }
        if (more) {
            item {
                TextField(newAction, { newAction = it }, Modifier.padding(horizontal = Tokens.listPad), singleLine = true, placeholder = "Add an action",
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = {
                        val t = newAction.trim()
                        if (t.isNotEmpty()) {
                            val w = parseWhen(t, now)
                            if (hub.codex.capture(stripWhen(t, w).ifEmpty { t }, "open", m.profile, w?.at, mapOf("meeting_id" to m.id)) != null) newAction = ""
                        }
                    }))
            }
            item { Fold("Context", (if (speakers.isNotEmpty()) 1 else 0) + (if (prior.isNotEmpty()) 1 else 0) + (if (family.size >= 2) 1 else 0) + (if (people.isNotEmpty()) 1 else 0), contextOpen) { contextOpen = !contextOpen } }
            if (contextOpen) {
                if (speakers.isNotEmpty()) item { TalkTimeBar(speakers, all.count { it.status != "dismissed" }, decisions.size) }
                if (prior.isNotEmpty()) seriesRows(prior, repeats, decisions = prior.take(3).flatMap { x -> jsonList(x.str("decisions")).map { it.trim() }.filter { it.isNotEmpty() }.map { x to it } }, undone = undone, onMeeting = onMeeting)
                if (family.size >= 2) item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Series · ${family.size}", family[0].title, onClick = { onSeries(seriesKeyOf(m)) }) } }
                if (people.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { people.forEachIndexed { i, p -> if (i > 0) Hairline(); ListRow(displayName(p), onClick = { onPerson(p) }) } } }
            }
            val unassigned = all.filter { it.status == "unassigned" }
            item { Fold("Unassigned", unassigned.size, unassignedOpen) { unassignedOpen = !unassignedOpen } }
            if (unassignedOpen) actionGroup(unassigned, m, now, actions, onTask)
            if (others.isNotEmpty()) {
                item { SectionHeader("Others took", others.size.toString()) }
                item { Group { others.forEachIndexed { i, o -> if (i > 0) Hairline(); ListRow(o.what, o.who) } } }
            }
            val dismissed = all.filter { it.status == "dismissed" }
            item { Fold("Not mine", dismissed.size, notMineOpen) { notMineOpen = !notMineOpen } }
            if (notMineOpen) actionGroup(dismissed, m, now, actions, onTask)
            if (state == MState.Done) {
                item { SectionHeader("Transcript", open = transcriptOpen, onToggle = { transcriptOpen = !transcriptOpen }) }
                if (transcriptOpen) {
                    val t = transcript
                    when {
                        t == null -> item { EmptyState("Loading") }
                        t.isFailure -> item { ErrorHint("Could not load the transcript: ${t.exceptionOrNull()?.message}") }
                        t.getOrNull().isNullOrEmpty() -> item { EmptyState("No transcript text kept") }
                        else -> items(t.getOrNull()!!.lines().filter { it.isNotBlank() }) { line ->
                            Text(line, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted, fontFamily = FontFamily.Default)
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
    if (pinning) PinSheet(m, ops) { pinning = false }
}

@Composable
fun PersonPage(hub: Hub, st: CodexState, name: String, now: Long, ops: CodexOps, onMeeting: (Row) -> Unit, onWikiPage: (String, String) -> Unit, onTask: (Row) -> Unit) {
    val mine = remember(st.meetings, name) { meetingsWith(st.meetings, name) }
    val shown = remember(st.meetings, name) { nameOf(st.meetings, name) }
    val email = if ('@' in name) name.trim() else mine.flatMap { peopleOf(it) }.firstOrNull { '@' in it && sameName(it, name) }
    val commitments = remember(st.meetings, name) { commitmentsOf(st.meetings, name) }
    val claims = remember(st.facts, name) { claimsMentioning(st.facts, name) }
    val tasks = remember(st.items, name) { st.items.filter { !it.deleted && it.status == "open" && matchesWords(listOf(name.lowercase()), it.title, it.text, it.people) } }
    val titles = remember(st.pages) { st.pages.associate { it.id to it.title } }
    var all by rememberSaveable(name) { mutableStateOf(false) }
    val points = remember(st.items, name) { pointsOf(st.items, name) }
    val pins = remember(st.items, mine) { pinsOf(st.items, mine) }
    val resolved by hub.resolvedQuestions.collectAsState()
    val questions = remember(mine, resolved, now / 60_000) { visibleQuestions(openQuestions(mine, now), resolved) }
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
        item { SectionHeader("Raise with ${firstName(shown)}", points.size.toString()) }
        if (points.isNotEmpty()) item { PointList(points, st.meetings, now, person = false, showMeeting = true, ops = ops) }
        item { AddPoint(name, mine.firstOrNull()?.profile ?: WORK, ops) }
        if (questions.isNotEmpty()) {
            item { SectionHeader("Open questions", questions.size.toString()) }
            item { QuestionList(questions, now, onMeeting) { hub.resolveQuestion(it, st.meetings, now) } }
        }
        if (pins.isNotEmpty()) {
            item { SectionHeader("Pinned", pins.size.toString()) }
            item { PinList(pins, ops) { r -> mine.firstOrNull { it.profile == r.profile && it.id == r.meetingId }?.let(onMeeting) } }
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

private fun LazyListScope.seriesRows(prior: List<Row>, repeats: Repeats?, decisions: List<Pair<Row, String>>, undone: List<Pair<Row, Row>>, onMeeting: (Row) -> Unit) {
    val last = prior[0]
    val date = { x: Row -> dayLabel(x.startsAt!!) }
    val again = repeats?.let { r -> r.decisions.map { it to "Decided again, also on ${date(last)}" } + r.questions.map { it to "Asked again, also on ${date(last)}" } } ?: emptyList()
    item { SectionHeader("Series", again.size.takeIf { it > 0 }?.toString()) }
    item { Pending("${prior.size} earlier, last on ${date(last)}") }
    if (again.isNotEmpty()) item { Group { again.forEachIndexed { i, (t, meta) -> if (i > 0) Hairline(); ListRow(t, meta, lines = 2, onClick = { onMeeting(last) }) } } }
    if (decisions.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { decisions.forEachIndexed { i, (x, t) -> if (i > 0) Hairline(); ListRow(t, "Decided ${date(x)}", lines = 2, onClick = { onMeeting(x) }) } } }
    if (undone.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { undone.forEachIndexed { i, (x, r) -> if (i > 0) Hairline(); ListRow(r.title ?: r.str("text") ?: "", "Still open from ${date(x)}", lines = 2, onClick = { onMeeting(x) }) } } }
}
