package no.pradhan.agentview.nativeapp.codex.meetings

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.ui.SearchField
import androidx.compose.ui.text.font.FontFamily
import no.pradhan.agentview.nativeapp.codex.CodexOps
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.DigestGroup
import no.pradhan.agentview.nativeapp.codex.firstName
import no.pradhan.agentview.nativeapp.codex.DigestLine
import no.pradhan.agentview.nativeapp.codex.ExpandRow
import no.pradhan.agentview.nativeapp.codex.GroupList
import no.pradhan.agentview.nativeapp.codex.PinList
import no.pradhan.agentview.nativeapp.codex.PinSheet
import no.pradhan.agentview.nativeapp.codex.PointList
import no.pradhan.agentview.nativeapp.codex.RaiseButton
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.Today
import no.pradhan.agentview.nativeapp.codex.actionsOf
import no.pradhan.agentview.nativeapp.codex.dayLabel

import no.pradhan.agentview.nativeapp.codex.parseWhen

import no.pradhan.agentview.nativeapp.codex.pinsOf
import no.pradhan.agentview.nativeapp.codex.pointsFor
import no.pradhan.agentview.nativeapp.codex.recentPeople
import no.pradhan.agentview.nativeapp.codex.stripWhen
import no.pradhan.agentview.nativeapp.codex.theirActions
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.app.readNow
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

private fun LazyListScope.actionGroup(rows: List<Row>, c: MeetingCtx) {
    item { Group { rows.forEachIndexed { i, r -> if (i > 0) Hairline(); ActionLine(r, c.m, c.now, c.actions, c.hub.readOnly, onTask = c.onTask) } } }
}


private class PrepData(val prior: List<Prior>, val brief: Brief, val points: List<Row>, val theirs: List<String>, val questions: List<Question>, val person: String?, val between: List<Between>)

private class MeetingCtx(val hub: Hub, val st: CodexState, val m: Row, val now: Long, val actions: TaskActions, val ops: CodexOps, val onMeeting: (Row) -> Unit, val onPerson: (String) -> Unit, val onSeries: (String) -> Unit, val onTask: (Row) -> Unit)

private class MeetingFolds(val pinning: MutableState<Boolean>, val more: MutableState<Boolean>, val unassigned: MutableState<Boolean>, val notMine: MutableState<Boolean>, val transcriptOpen: MutableState<Boolean>, val newAction: MutableState<String>, val context: MutableState<Boolean>, val transcriptQuery: MutableState<String>, val transcriptCur: MutableState<Int>)

@Composable
private fun rememberMeetingFolds(key: String) = MeetingFolds(
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf("") },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf("") },
    rememberSaveable(key) { mutableStateOf(-1) },
)

@Composable
private fun rememberPrep(c: MeetingCtx, state: MState): PrepData? {
    val st = c.st
    val m = c.m
    val resolved by c.hub.resolvedQuestions.collectAsState()
    return remember(st.meetings, st.items, st.facts, st.chats, st.briefs, m.key, c.now / 60_000, resolved) {
        if ((state == MState.Upcoming || state == MState.Live) && !isSolo(m)) {
            val prior = priorWith(m, st.meetings, st.items)
            val person = peopleOf(m).singleOrNull()
            val between = person?.let { betweenRows(personInbox(it, st.items, st.chats, unanswered(st.briefs)), firstName(displayName(it))) } ?: emptyList()
            PrepData(prior, briefFor(m, st.items, st.facts), pointsFor(m, st.items, st.meetings), theirActions(m, prior.map { it.meeting }),
                visibleQuestions(openQuestions(st.meetings, c.now), resolved).filter { q -> prior.any { it.meeting.id == q.meeting.id && it.meeting.profile == q.profile } }, person, between)
        } else null
    }
}

@Composable
private fun rememberTranscript(hub: Hub, m: Row, done: Boolean): Pair<Result<String?>?, () -> Unit> {
    var transcript by remember(m.key) { mutableStateOf<Result<String?>?>(null) }
    var tries by remember(m.key) { mutableStateOf(0) }
    LaunchedEffect(m.key, done, m.str("summary"), tries) {
        if (done) transcript = runCatching { hub.api.transcript(m.profile, m.id) }
    }
    return transcript to { transcript = null; tries++ }
}

@Composable
fun MeetingPage(hub: Hub, st: CodexState, m: Row, now: Long, actions: TaskActions, ops: CodexOps, onMeeting: (Row) -> Unit, onPerson: (String) -> Unit, onSeries: (String) -> Unit, onTask: (Row) -> Unit) {
    val c = MeetingCtx(hub, st, m, now, actions, ops, onMeeting, onPerson, onSeries, onTask)
    val state = meetingState(m, now)
    val all = remember(st.items, m.key) { actionsOf(st.items, m) }
    val prep = rememberPrep(c, state)
    val folds = rememberMeetingFolds(m.key)
    val notesEmptyAtOpen = remember(m.key) { m.str("notes").isNullOrEmpty() }
    val (transcript, reloadTranscript) = rememberTranscript(hub, m, state == MState.Done)
    val talk = remember(transcript) { transcript?.getOrNull()?.let(::talkTime).orEmpty() }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val scrollFromEnd = { k: Int -> scope.launch { list.animateScrollToItem(list.layoutInfo.totalItemsCount - 1 - k) }; Unit }
    LazyColumn(Modifier.fillMaxWidth(), list) {
        meetingHeader(c, state, all)
        if (isEvent(m)) {
            item { NotesHeader(c, all) }
            item { NotesField(hub, m, notesEmptyAtOpen) }
            meetingActions(c, all, alwaysHeader = true)
            item { NewActionField(c, folds.newAction) }
        } else {
            meetingActions(c, all)
            meetingSummary(c, folds)
            meetingDecisions(c)
            prep?.let { meetingPrep(c, it) }
            item { NotesHeader(c, all) }
            item { NotesField(hub, m, notesEmptyAtOpen) }
            item { SectionHeader("More", open = folds.more.value, onToggle = { folds.more.value = !folds.more.value }) }
            if (folds.more.value) meetingMore(c, state, all, folds, transcript, reloadTranscript, talk, scrollFromEnd)
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
    if (folds.pinning.value) PinSheet(m, ops) { folds.pinning.value = false }
}

private fun LazyListScope.meetingHeader(c: MeetingCtx, state: MState, all: List<Row>) {
    val m = c.m
    val links = linksOf(m)
    item {
        MeetingTitle(c, state, all)
        if (!m.str("room").isNullOrEmpty() && m.long("room_me") == null) RoomMic(c.hub, m)
    }
    if (links.isNotEmpty()) {
        item { SectionHeader("Links", links.size.toString()) }
        item {
            val uri = LocalUriHandler.current
            Group { links.forEachIndexed { i, l -> if (i > 0) Hairline(); ListRow(l.title, l.domain, onClick = { uri.openUri(l.url) }, trailing = { AvIcon("link-external", tint = av.fgMuted) }) } }
        }
    }
}

@Composable
private fun MeetingTitle(c: MeetingCtx, state: MState, all: List<Row>) {
    val m = c.m
    val link = safeHref(m.str("calendar_url"))
    val copyable = hasContent(m, all)
    val uri = LocalUriHandler.current
    val clip = LocalClipboardManager.current
    var reading by remember(m.key) { mutableStateOf(false) }
    val read = { reading = true; c.hub.readNow(m) { reading = false } }
    val canRead = state == MState.Done && readable(m, c.now)
    val hasNotes = !m.str("notes").isNullOrEmpty()
    val readText = readLabel(state)
    Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        if (isEvent(m)) Text("Event", style = Type.footnote, color = av.fgMuted)
        LRow(verticalAlignment = Alignment.CenterVertically) {
            Text(m.title?.ifEmpty { null } ?: UNTITLED, Modifier.weight(1f), style = Type.title)
            if (state == MState.Live && link != null && !isEvent(m)) Button("Join", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            if (link != null || copyable || canRead || hasNotes) MoreButton { close ->
                if (link != null) MenuItem("Open calendar", "calendar", { close(); uri.openUri(link) })
                if (copyable) MenuItem("Copy follow-up", "mail", { close(); clip.setText(AnnotatedString(followUpText(m, all))); c.actions.say("Follow-up copied") })
                if (copyable) MenuItem("Copy as Markdown", "copy", { close(); clip.setText(AnnotatedString(meetingMarkdown(m, all))); c.actions.say("Meeting copied") })
                if (canRead) MenuItem(if (reading) "Reading" else "Read again", "sync", { close(); read() }, enabled = !reading)
                if (hasNotes) MenuSeparator()
                if (hasNotes) MenuItem("Delete notes", "trash", { close(); c.actions.change(m, mapOf("notes" to ""), "Notes deleted") }, danger = true)
            }
        }
        pageMeta(m).takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.subheadline, color = av.fgMuted) }
        stateLine(m, c.now)?.let { line ->
            LRow(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp8)) {
                Text(line, Modifier.weight(1f, fill = false), style = Type.callout, color = if (state == MState.Missing) av.warn else av.info)
                if (readText != null) Button(if (reading) "Reading" else readText, { read() }, size = ButtonSize.Sm, enabled = !reading)
            }
        }
    }
}

private fun LazyListScope.meetingActions(c: MeetingCtx, all: List<Row>, alwaysHeader: Boolean = false) {
    val actions = c.actions
    val mine = all.filter { it.status == "open" || it.status == "done" }.sortedBy { if (it.status == "open") 0 else 1 }
    val review = all.filter { it.status == "suggested" }
    val count = actionCount(c.st.items, c.m)
    if (alwaysHeader || mine.isNotEmpty()) {
        item { SectionHeader("My actions", if (count.total > 0) "${count.done} of ${count.total} done" else null) }
        actionGroup(mine, c)
    }
    if (review.isNotEmpty()) {
        item { SectionHeader("To review", review.size.toString(), action = { if (review.size > 1) Button("Confirm all", { review.forEach { actions.edit(it, mapOf("status" to "open")) }; actions.undoable("${review.size} added to Today") { review.forEach { r -> actions.edit(r, mapOf("status" to "suggested")) } } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
        actionGroup(review, c)
    }
}

private fun LazyListScope.meetingSummary(c: MeetingCtx, folds: MeetingFolds) {
    val m = c.m
    val pins = pinsOf(c.st.items, listOf(m))
    item { SectionHeader("Summary", action = if (!m.str("summary").isNullOrEmpty()) { { Button("Pin", { folds.pinning.value = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } } else null) }
    m.str("summary")?.takeIf { it.isNotEmpty() }?.let { item { Markdown(it, Modifier.padding(horizontal = Tokens.listPad)) } } ?: item { EmptyState("No summary yet", "It is written after the meeting ends") }
    if (pins.isNotEmpty()) {
        item { SectionHeader("Pinned", pins.size.toString()) }
        item { PinList(pins, c.ops) }
    }
}

private fun LazyListScope.meetingDecisions(c: MeetingCtx) {
    val decisions = jsonList(c.m.str("decisions"))
    if (decisions.isEmpty()) return
    val raiseTo = recentPeople(c.st.meetings, c.m.profile, c.m, c.now)
    item { SectionHeader("Decisions") }
    item { Group { decisions.forEachIndexed { i, d -> if (i > 0) Hairline(); ExpandRow(d, trailing = { RaiseButton(d, raiseTo) { p -> c.ops.points.raise(d, p, c.m.profile) } }) } } }
}

private fun prepGroups(c: MeetingCtx, pr: PrepData): List<DigestGroup> {
    val meta = { x: Row -> "${x.title} · ${dayLabel(x.startsAt!!)}" }
    return listOf(
        DigestGroup("actions", "Open actions", pr.prior.flatMap { p -> p.open.map { DigestLine(it.title ?: "", meta(p.meeting)) { c.onMeeting(p.meeting) } } }, true),
        DigestGroup("decisions", "Decisions", pr.prior.flatMap { p -> p.decisions.map { DigestLine(it.lineSequence().first(), meta(p.meeting)) { c.onMeeting(p.meeting) } } }, false),
        DigestGroup("questions", "Open questions", pr.questions.map { q -> DigestLine(q.text, meta(q.meeting)) { c.onMeeting(q.meeting) } }, true),
        DigestGroup("tasks", "Tasks", pr.brief.tasks.flatMap { (person, rows) -> rows.map { r -> DigestLine(r.title ?: "", person) { c.onTask(r) } } }, true),
        DigestGroup("theirs", "They took on", pr.theirs.map { DigestLine(it) }, true),
        DigestGroup("claims", "Related claims", pr.brief.claims.map { DigestLine(it.str("text") ?: "") }, true),
    ).filter { it.rows.isNotEmpty() }
}

private fun LazyListScope.meetingPrep(c: MeetingCtx, pr: PrepData) {
    val groups = prepGroups(c, pr)
    if (groups.isEmpty() && pr.points.isEmpty() && pr.between.isEmpty()) return
    item {
        val clip = LocalClipboardManager.current
        SectionHeader("Prep", action = {
            IconBtn("copy", "Copy agenda", {
                val mine = (pr.prior.flatMap { it.open } + pr.brief.tasks.flatMap { it.second }).map { it.title ?: "" }
                clip.setText(AnnotatedString(agendaMarkdown(c.m, pr.points, (pr.theirs + mine).distinct(), pr.questions.map { it.text })))
                c.actions.say("Agenda copied")
            })
        })
    }
    groups.forEach { g -> item(key = "prep-${g.outcome}") { GroupList("prep:${c.m.key}:${g.outcome}", g, capOpen = true, plain = g.outcome == "theirs" || g.outcome == "claims") } }
    if (pr.person != null && pr.between.isNotEmpty()) {
        item { SectionHeader("Between you and ${firstName(displayName(pr.person))}", pr.between.size.toString()) }
        item {
            val uri = LocalUriHandler.current
            Group {
                pr.between.forEachIndexed { i, b ->
                    if (i > 0) Hairline()
                    val href = safeHref(b.url)
                    ListRow(b.title.ifEmpty { UNTITLED }, b.meta.ifEmpty { null }, onClick = (b.task?.let { t -> { c.onTask(t) } }) ?: href?.let { h -> { uri.openUri(h) } })
                }
                Hairline()
                ListRow("Open person", onClick = { c.onPerson(pr.person) })
            }
        }
    }
    if (pr.points.isNotEmpty()) {
        item { SectionHeader("To raise", pr.points.size.toString()) }
        item { PointList(pr.points, c.st.meetings, c.now, person = true, showMeeting = false, ops = c.ops) }
    }
}

private fun makeAction(c: MeetingCtx, t: String): Row? {
    val w = parseWhen(t, c.now)
    return c.hub.codex.capture(stripWhen(t, w).ifEmpty { t }, "open", c.m.profile, w?.at, mapOf("meeting_id" to c.m.id))
}

@Composable
private fun NotesHeader(c: MeetingCtx, all: List<Row>) {
    val titles = all.filter { it.status == "open" || it.status == "done" }.map { it.title ?: "" }
    val lines = unmadeActions(c.m.str("notes") ?: "", titles) { t -> stripWhen(t, parseWhen(t, c.now)) }
    val label = if (lines.size == 1) "Add 1 action" else "Add ${lines.size} actions"
    SectionHeader("My notes", action = if (lines.isEmpty()) null else { {
        Button(label, {
            val made = lines.mapNotNull { makeAction(c, it) }
            if (made.isNotEmpty()) c.actions.undoable("Added ${made.size} ${if (made.size == 1) "action" else "actions"}") { made.forEach { c.hub.codex.update(it, mapOf("deleted" to true)) } }
        }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    } })
}

@Composable
private fun NewActionField(c: MeetingCtx, newAction: MutableState<String>) {
    TextField(newAction.value, { newAction.value = it }, Modifier.padding(horizontal = Tokens.listPad), singleLine = true, placeholder = "Add an action",
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = {
            val t = newAction.value.trim()
            if (t.isNotEmpty() && makeAction(c, t) != null) newAction.value = ""
        }))
}

private fun LazyListScope.meetingMore(c: MeetingCtx, state: MState, all: List<Row>, folds: MeetingFolds, transcript: Result<String?>?, reloadTranscript: () -> Unit, talk: List<Speaker>, scrollFromEnd: (Int) -> Unit) {
    val m = c.m
    item { NewActionField(c, folds.newAction) }
    meetingContext(c, all, folds, talk)
    val unassigned = all.filter { it.status == "unassigned" }
    item { Fold("Unassigned", unassigned.size, folds.unassigned.value) { folds.unassigned.value = !folds.unassigned.value } }
    if (folds.unassigned.value) actionGroup(unassigned, c)
    val others = othersOf(m)
    if (others.isNotEmpty()) {
        item { SectionHeader("Others took", others.size.toString()) }
        item { Group { others.forEachIndexed { i, o -> if (i > 0) Hairline(); ListRow(o.what, o.who) } } }
    }
    val dismissed = all.filter { it.status == "dismissed" }
    item { Fold("Not mine", dismissed.size, folds.notMine.value) { folds.notMine.value = !folds.notMine.value } }
    if (folds.notMine.value) actionGroup(dismissed, c)
    if (state == MState.Done) meetingTranscript(folds, transcript, reloadTranscript, scrollFromEnd)
}

private fun LazyListScope.meetingContext(c: MeetingCtx, all: List<Row>, folds: MeetingFolds, speakers: List<Speaker>) {
    val st = c.st
    val m = c.m
    val now = c.now
    val prior = seriesOf(st.meetings, m)
    val repeats = prior.firstOrNull()?.let { seriesRepeats(m, it, now) }
    val undone = openAcrossSeries(st.items, prior).sortedBy { p -> prior.indexOfFirst { it.id == p.first.id } }
    val family = seriesMeetings(st.meetings, m.profile, seriesTitle(m.title), now)
    val people = peopleOf(m)
    val decisions = jsonList(m.str("decisions"))
    item { Fold("Context", listOf(speakers.isNotEmpty(), prior.isNotEmpty(), family.size >= 2, people.isNotEmpty()).count { it }, folds.context.value) { folds.context.value = !folds.context.value } }
    if (!folds.context.value) return
    if (speakers.isNotEmpty()) item { TalkTimeBar(speakers, all.count { it.status != "dismissed" }, decisions.size) }
    if (prior.isNotEmpty()) seriesRows(prior, repeats, decisions = prior.take(3).flatMap { x -> jsonList(x.str("decisions")).map { it.trim() }.filter { it.isNotEmpty() }.map { x to it } }, undone = undone, onMeeting = c.onMeeting)
    if (family.size >= 2) item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Series · ${family.size}", family[0].title, onClick = { c.onSeries(seriesKeyOf(m)) }) } }
    if (people.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { people.forEachIndexed { i, p -> if (i > 0) Hairline(); ListRow(displayName(p), onClick = { c.onPerson(p) }) } } }
}

// The transcript is the last section, so a line is counted from the end of the list: k = 1 is the last line, in front of the closing spacer.
private fun LazyListScope.meetingTranscript(folds: MeetingFolds, transcript: Result<String?>?, reload: () -> Unit, scrollFromEnd: (Int) -> Unit) {
    val text = transcript?.getOrNull()?.takeIf { it.isNotEmpty() }
    val query = folds.transcriptQuery.value
    val words = queryWords(query)
    val segments = text?.lines()?.filter { it.isNotBlank() }.orEmpty().map { markSegments(it, words) }
    val starts = segments.runningFold(0) { n, line -> n + line.count { it.hit } }
    val count = starts.last()
    val cur = folds.transcriptCur.value
    val open = folds.transcriptOpen.value
    item { SectionHeader("Transcript", count = if (!open && text != null && words.isNotEmpty()) matchLabel(count) else null, open = open, onToggle = { folds.transcriptOpen.value = !open }) }
    if (!open) return
    when {
        transcript == null -> item { Loading("Loading the transcript…") }
        transcript.isFailure -> item { EmptyState("Could not load the transcript", transcript.exceptionOrNull()?.message, action = { Button("Retry", reload, size = ButtonSize.Sm) }) }
        text == null -> item { EmptyState("No transcript kept for this meeting") }
        else -> {
            val step = { dir: Int ->
                val n = stepMatch(cur, dir, count)
                folds.transcriptCur.value = n
                scrollFromEnd(segments.size - starts.indexOfLast { it <= n })
            }
            item {
                SearchField(query, { folds.transcriptQuery.value = it; folds.transcriptCur.value = -1 }, "Search transcript")
                if (query.isNotBlank()) LRow(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad), verticalAlignment = Alignment.CenterVertically) {
                    Text(matchLabel(count), Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted)
                    IconBtn("arrow-up", "Previous match", { step(-1) }, enabled = count > 0)
                    IconBtn("arrow-down", "Next match", { step(1) }, enabled = count > 0)
                }
            }
            itemsIndexed(segments) { i, line ->
                val soft = av.accentSoft
                val strong = av.accent.copy(alpha = 0.4f)
                var k = 0
                val shown = buildAnnotatedString {
                    for (s in line) if (s.hit) withStyle(SpanStyle(background = if (starts[i] + k++ == cur) strong else soft)) { append(s.text) } else append(s.text)
                }
                Text(shown, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted, fontFamily = FontFamily.Default)
            }
        }
    }
}
