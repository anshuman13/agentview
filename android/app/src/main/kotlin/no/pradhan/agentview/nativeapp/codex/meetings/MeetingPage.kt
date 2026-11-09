package no.pradhan.agentview.nativeapp.codex.meetings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import kotlinx.coroutines.delay
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.codex.CodexOps
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.DigestGroup
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
import no.pradhan.agentview.nativeapp.codex.isSolo
import no.pradhan.agentview.nativeapp.codex.othersOf
import no.pradhan.agentview.nativeapp.codex.parseWhen
import no.pradhan.agentview.nativeapp.codex.peopleOf
import no.pradhan.agentview.nativeapp.codex.pinsOf
import no.pradhan.agentview.nativeapp.codex.pointsFor
import no.pradhan.agentview.nativeapp.codex.recentPeople
import no.pradhan.agentview.nativeapp.codex.stripWhen
import no.pradhan.agentview.nativeapp.codex.theirActions
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.readWithRoomMic
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color
import no.pradhan.agentview.nativeapp.workspace.ErrorHint

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
internal fun Pending(text: String) = Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted)

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

private const val NOTES_SAVE_MS = 800L
private const val TALK_TOP = 5
private val TALK_ALPHA = floatArrayOf(1f, 0.75f, 0.55f, 0.4f, 0.28f)

private class PrepData(val prior: List<Prior>, val brief: Brief, val points: List<Row>, val theirs: List<String>, val questions: List<Question>)

private class MeetingCtx(val hub: Hub, val st: CodexState, val m: Row, val now: Long, val actions: TaskActions, val ops: CodexOps, val onMeeting: (Row) -> Unit, val onPerson: (String) -> Unit, val onSeries: (String) -> Unit, val onTask: (Row) -> Unit)

private class MeetingFolds(val pinning: MutableState<Boolean>, val more: MutableState<Boolean>, val unassigned: MutableState<Boolean>, val notMine: MutableState<Boolean>, val transcriptOpen: MutableState<Boolean>, val newAction: MutableState<String>, val context: MutableState<Boolean>)

@Composable
private fun rememberMeetingFolds(key: String) = MeetingFolds(
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf(false) },
    rememberSaveable(key) { mutableStateOf("") },
    rememberSaveable(key) { mutableStateOf(false) },
)

@Composable
private fun rememberPrep(c: MeetingCtx, state: MState): PrepData? {
    val st = c.st
    val m = c.m
    val resolved by c.hub.resolvedQuestions.collectAsState()
    return remember(st.meetings, st.items, st.facts, m.key, c.now / 60_000, resolved) {
        if ((state == MState.Upcoming || state == MState.Live) && !isSolo(m)) {
            val prior = priorWith(m, st.meetings, st.items)
            PrepData(prior, briefFor(m, st.items, st.facts), pointsFor(m, st.items, st.meetings), theirActions(m, prior.map { it.meeting }),
                visibleQuestions(openQuestions(st.meetings, c.now), resolved).filter { q -> prior.any { it.meeting.id == q.meeting.id && it.meeting.profile == q.profile } })
        } else null
    }
}

@Composable
private fun rememberTranscript(hub: Hub, m: Row, done: Boolean): Result<String?>? {
    var transcript by remember(m.key) { mutableStateOf<Result<String?>?>(null) }
    LaunchedEffect(m.key, done, m.str("summary")) {
        if (done) transcript = runCatching { hub.api.transcript(m.profile, m.id) }
    }
    return transcript
}

@Composable
fun MeetingPage(hub: Hub, st: CodexState, m: Row, now: Long, actions: TaskActions, ops: CodexOps, onMeeting: (Row) -> Unit, onPerson: (String) -> Unit, onSeries: (String) -> Unit, onTask: (Row) -> Unit) {
    val c = MeetingCtx(hub, st, m, now, actions, ops, onMeeting, onPerson, onSeries, onTask)
    val state = meetingState(m, now)
    val all = remember(st.items, m.key) { actionsOf(st.items, m) }
    val prep = rememberPrep(c, state)
    val folds = rememberMeetingFolds(m.key)
    val transcript = rememberTranscript(hub, m, state == MState.Done)
    LazyColumn(Modifier.fillMaxWidth()) {
        meetingHeader(c, state)
        meetingActions(c, all)
        meetingSummary(c, folds)
        meetingDecisions(c)
        prep?.let { meetingPrep(c, it) }
        item { SectionHeader("My notes") }
        item { NotesField(hub, m) }
        item { SectionHeader("More", open = folds.more.value, onToggle = { folds.more.value = !folds.more.value }) }
        if (folds.more.value) meetingMore(c, state, all, folds, transcript)
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
    if (folds.pinning.value) PinSheet(m, ops) { folds.pinning.value = false }
}

private fun LazyListScope.meetingHeader(c: MeetingCtx, state: MState) {
    val m = c.m
    val links = linksOf(m)
    item {
        MeetingTitle(c, state)
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
private fun MeetingTitle(c: MeetingCtx, state: MState) {
    val m = c.m
    val link = safeHref(m.str("calendar_url"))
    val uri = LocalUriHandler.current
    Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        LRow(verticalAlignment = Alignment.CenterVertically) {
            Text(m.title?.ifEmpty { null } ?: "Untitled", Modifier.weight(1f), style = Type.title)
            if (state == MState.Live && link != null) Button("Join", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            else if (link != null && m.id.startsWith("cal:")) IconBtn("link-external", "Open in calendar", { uri.openUri(link) })
        }
        pageMeta(m).takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.subheadline, color = av.fgMuted) }
        stateLine(m, c.now)?.let { Text(it, style = Type.callout, color = if (state == MState.Missing) av.warn else av.info) }
    }
}

private fun LazyListScope.meetingActions(c: MeetingCtx, all: List<Row>) {
    val actions = c.actions
    val mine = all.filter { it.status == "open" || it.status == "done" }.sortedBy { if (it.status == "open") 0 else 1 }
    val review = all.filter { it.status == "suggested" }
    val count = actionCount(c.st.items, c.m)
    if (mine.isNotEmpty()) {
        item { SectionHeader("My actions", if (count.total > 0) "${count.done} of ${count.total} done" else null) }
        actionGroup(mine, c.m, c.now, actions, c.onTask)
    }
    if (review.isNotEmpty()) {
        item { SectionHeader("To review", review.size.toString(), action = { if (review.size > 1) Button("Confirm all", { review.forEach { actions.edit(it, mapOf("status" to "open")) }; actions.undoable("${review.size} added to Today") { review.forEach { r -> actions.edit(r, mapOf("status" to "suggested")) } } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
        actionGroup(review, c.m, c.now, actions, c.onTask)
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
    if (groups.isEmpty() && pr.points.isEmpty()) return
    item { SectionHeader("Prep") }
    groups.forEach { g -> item(key = "prep-${g.outcome}") { GroupList("prep:${c.m.key}:${g.outcome}", g, capOpen = true, plain = g.outcome == "theirs" || g.outcome == "claims") } }
    if (pr.points.isNotEmpty()) {
        item { SectionHeader("To raise", pr.points.size.toString()) }
        item { PointList(pr.points, c.st.meetings, c.now, person = true, showMeeting = false, ops = c.ops) }
    }
}

@Composable
private fun NewActionField(c: MeetingCtx, newAction: MutableState<String>) {
    TextField(newAction.value, { newAction.value = it }, Modifier.padding(horizontal = Tokens.listPad), singleLine = true, placeholder = "Add an action",
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = {
            val t = newAction.value.trim()
            if (t.isNotEmpty()) {
                val w = parseWhen(t, c.now)
                if (c.hub.codex.capture(stripWhen(t, w).ifEmpty { t }, "open", c.m.profile, w?.at, mapOf("meeting_id" to c.m.id)) != null) newAction.value = ""
            }
        }))
}

private fun LazyListScope.meetingMore(c: MeetingCtx, state: MState, all: List<Row>, folds: MeetingFolds, transcript: Result<String?>?) {
    val m = c.m
    item { NewActionField(c, folds.newAction) }
    meetingContext(c, all, folds, transcript?.getOrNull()?.let { talkTime(it) } ?: emptyList())
    val unassigned = all.filter { it.status == "unassigned" }
    item { Fold("Unassigned", unassigned.size, folds.unassigned.value) { folds.unassigned.value = !folds.unassigned.value } }
    if (folds.unassigned.value) actionGroup(unassigned, m, c.now, c.actions, c.onTask)
    val others = othersOf(m)
    if (others.isNotEmpty()) {
        item { SectionHeader("Others took", others.size.toString()) }
        item { Group { others.forEachIndexed { i, o -> if (i > 0) Hairline(); ListRow(o.what, o.who) } } }
    }
    val dismissed = all.filter { it.status == "dismissed" }
    item { Fold("Not mine", dismissed.size, folds.notMine.value) { folds.notMine.value = !folds.notMine.value } }
    if (folds.notMine.value) actionGroup(dismissed, m, c.now, c.actions, c.onTask)
    if (state == MState.Done) meetingTranscript(folds, transcript)
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

private fun LazyListScope.meetingTranscript(folds: MeetingFolds, transcript: Result<String?>?) {
    item { SectionHeader("Transcript", open = folds.transcriptOpen.value, onToggle = { folds.transcriptOpen.value = !folds.transcriptOpen.value }) }
    if (!folds.transcriptOpen.value) return
    when {
        transcript == null -> item { EmptyState("Loading…") }
        transcript.isFailure -> item { ErrorHint("Could not load the transcript: ${transcript.exceptionOrNull()?.message}") }
        transcript.getOrNull().isNullOrEmpty() -> item { EmptyState("No transcript text kept") }
        else -> items(transcript.getOrNull()!!.lines().filter { it.isNotBlank() }) { line ->
            Text(line, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted, fontFamily = FontFamily.Default)
        }
    }
}
