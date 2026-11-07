package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration

// What the meetings and wiki pages share: Raise and points, pinned text, open questions, Prep groups, the Series page and Review mode.
class CodexOps(val points: PointActions, val goals: GoalActions, val review: ReviewOps, val replies: ReplyOps)

@Composable
fun RaiseButton(text: String, people: List<String>, onRaise: (String) -> Unit) {
    if (people.isEmpty() || text.isBlank()) return
    var open by remember { mutableStateOf(false) }
    Box {
        Button("Raise", { open = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        Menu(open, { open = false }) { people.forEach { p -> MenuItem("Raise with ${firstName(p)}", { open = false; onRaise(p) }) } }
    }
}

@Composable
fun PointList(points: List<Row>, meetings: List<Row>, now: Long, person: Boolean, showMeeting: Boolean, ops: CodexOps) {
    Group {
        points.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            val m = if (showMeeting) pointMeeting(r, meetings) else null
            ListRow((if (person) "${firstName(r.people ?: "")}: " else "") + (r.title ?: ""), m?.let { "${it.title} · ${whenText(it.startsAt!!, now, true)}" },
                trailing = { Button("Raised", { ops.points.tick(r) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = Icons.Filled.Check) })
        }
    }
}

@Composable
fun AddPoint(person: String, profile: String, ops: CodexOps) {
    var text by rememberSaveable(person) { mutableStateOf("") }
    val add = {
        val t = text.trim()
        if (t.isNotEmpty() && ops.points.raise(t, person, profile)) text = ""
    }
    TextField(text, { text = it }, Modifier.padding(horizontal = Tokens.sp6, vertical = Tokens.sp2), singleLine = true, placeholder = if ('@' in person) "Raise a point" else "Raise with ${firstName(person)}",
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }))
}

@Composable
fun QuestionList(rows: List<Question>, now: Long, onOpen: (Row) -> Unit, onResolve: (Question) -> Unit) {
    Group {
        rows.forEachIndexed { i, q ->
            if (i > 0) Hairline()
            ListRow(q.text, "${q.meeting.title ?: "Meeting"} · ${whenText(q.at, now)}", onClick = { onOpen(q.meeting) },
                trailing = { Button("Resolve", { onResolve(q) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
        }
    }
}

@Composable
fun PinList(pins: List<Row>, ops: CodexOps, onOpen: ((Row) -> Unit)? = null) {
    Group {
        pins.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            ListRow(r.text ?: r.title ?: "", if (onOpen != null) r.people else null, lines = 4, onClick = if (onOpen != null && r.meetingId != null) { { onOpen(r) } } else null,
                trailing = { Button("Unpin", { ops.points.unpin(r) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
        }
    }
}

// The summary's lines to pick from; a tap pins that line to the meeting.
@Composable
fun PinSheet(m: Row, ops: CodexOps, onDismiss: () -> Unit) {
    val lines = remember(m.str("summary")) { summaryLines(m.str("summary")) }
    Sheet(onDismiss, padded = false) {
        SectionHeader("Pin from the summary")
        if (lines.isEmpty()) EmptyState("No summary to pin from")
        Group { lines.forEachIndexed { i, l -> if (i > 0) Hairline(); ListRow(l, lines = 4, onClick = { ops.points.pin(l, m); onDismiss() }) } }
    }
}

// A Prep group: folded or open by the group's default, with Show all N under the first 3 rows.
@Composable
fun GroupList(foldKey: String, group: DigestGroup, capOpen: Boolean = false, plain: Boolean = false) {
    var open by rememberSaveable(foldKey) { mutableStateOf(group.open) }
    var all by rememberSaveable(foldKey, "all") { mutableStateOf(false) }
    SectionHeader(group.label, group.rows.size.toString(), open = open, onToggle = { open = !open })
    if (!open) return
    val rows = visibleRows(group, all, capOpen)
    Group {
        rows.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            if (plain) ListRow(r.title, lines = 2) else ListRow(r.title, r.meta, onClick = r.open)
        }
    }
    if (!all && rows.size < group.rows.size) Button("Show all ${group.rows.size}", { all = true }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
}

// A recurring series: open actions across the occurrences, then the occurrences newest first.
@Composable
fun SeriesPage(st: CodexState, key: String, now: Long, actions: TaskActions, onMeeting: (Row) -> Unit) {
    val (profile, title) = remember(key) { parseSeriesKey(key) }
    val minute = now / 60_000
    val members = remember(st.meetings, key, minute) { seriesMeetings(st.meetings, profile, title, now) }
    val open = remember(members, st.items) { openAcrossSeries(st.items, members) }
    val next = remember(st.meetings, key, minute) { nextInSeries(st.meetings, profile, title, now) }
    val cadence = remember(members) { cadenceOf(members) }
    val people = remember(members) { seriesPeople(members) }
    val calendar = safeHref(next?.str("calendar_url") ?: members.firstOrNull()?.str("calendar_url"))
    val uri = LocalUriHandler.current
    var allOpen by rememberSaveable(key) { mutableStateOf(false) }
    var allOcc by rememberSaveable(key) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (members.isEmpty()) { item { EmptyState("No meetings") }; return@LazyColumn }
        item {
            SectionHeader(members[0].title ?: "Meeting", action = {
                if (next != null) Button("Open next", { onMeeting(next) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
                if (calendar != null) MoreButton { close -> MenuItem("Open calendar", { close(); uri.openUri(calendar) }) }
            })
            LRow(Modifier.padding(horizontal = Tokens.sp6), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                cadence?.let { Chip(it, null) }
                if (people.isNotEmpty()) Chip(if (people.size == 1) "1 person" else "${people.size} people", null)
            }
        }
        item { SectionHeader("Open across the series") }
        if (open.isEmpty()) item { EmptyState("Nothing open") }
        else item {
            Group {
                (if (allOpen) open else open.take(5)).forEachIndexed { i, (m, r) -> if (i > 0) Hairline(); ActionLine(r, m, now, actions, from = weekdayDate(m.startsAt!!)) }
            }
            if (!allOpen && open.size > 5) Button("+${open.size - 5} more", { allOpen = true }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
        item { SectionHeader("Occurrences", members.size.toString()) }
        item {
            Group {
                (if (allOcc) members else members.take(5)).forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    val decisions = jsonList(m.str("decisions")).size
                    val left = open.count { it.first.key == m.key }
                    val meta = listOfNotNull(if (decisions > 0) "$decisions ${if (decisions == 1) "decision" else "decisions"}" else null, if (left > 0) "$left open" else null).joinToString(", ")
                    ListRow("${weekdayDate(m.startsAt!!)}, ${clock(m.startsAt!!)}", meta.ifEmpty { null }, muted = meetingState(m, now) == MState.Missing, onClick = { onMeeting(m) })
                }
            }
            if (!allOcc && members.size > 5) Button("+${members.size - 5} more", { allOcc = true }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            Spacer(Modifier.padding(bottom = Tokens.sp16))
        }
    }
}

// One proposed claim at a time with big Approve, Skip and Reject, so a long list can be cleared with the thumb.
@Composable
fun ReviewModePage(st: CodexState, ops: ReviewOps, onBack: () -> Unit, onPage: (Row) -> Unit) {
    val open = remember(st.facts) { proposals(st.facts).associateBy { it.key } }
    var order by remember { mutableStateOf(emptyList<String>()) }
    var skipped by remember { mutableStateOf(emptyList<String>()) }
    val ord = extendOrder(order, open.keys)
    SideEffect { if (ord != order) order = ord }
    val queue = reviewQueue(ord, skipped, open.keys)
    val fact = queue.firstOrNull()?.let(open::get)
    val total = ord.size
    val left = ord.count { it in open }
    SideEffect { if (fact == null && skipped.isNotEmpty()) skipped = emptyList() }
    val uri = LocalUriHandler.current
    if (fact == null) {
        EmptyState(if (total > 0) "All claims reviewed" else "Nothing waits for review", icon = Icons.Filled.Check, action = { Button("Back to the wiki", onBack, size = ButtonSize.Sm) })
        return
    }
    val page = fact.str("page_id")?.let { id -> st.pages.firstOrNull { it.id == id && it.profile == fact.profile } }
    val old = fact.str("replaces")?.let { id -> st.facts.firstOrNull { it.id == id && it.profile == fact.profile } }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        Text("${total - left + 1} of $total", style = Type.label, color = av.fgMuted)
        Panel(Modifier.fillMaxWidth()) {
            Text(if (page != null) listOfNotNull(page.title, if (page.str("state") == "proposed") "(new page)" else null, fact.str("heading")?.ifEmpty { null }).joinToString(" · ") else "Memory",
                if (page != null) Modifier.clickable { onPage(page) } else Modifier, style = Type.callout, color = if (page != null) av.accentText else av.fgMuted)
            Text(fact.str("text") ?: "", style = Type.body, color = av.fg)
            if (old != null) Text(old.str("text") ?: "", style = Type.subheadline, color = av.fgMuted, textDecoration = TextDecoration.LineThrough)
            LRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                sourcesOf(fact).forEach { s -> Chip(s.label, safeHref(s.url)?.let { u -> { uri.openUri(u) } }) }
                fact.long("at")?.let { Text(shortDate(it, System.currentTimeMillis()), style = Type.meta, color = av.metaFg) }
            }
        }
        LRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Button("Reject", { ops.reject(listOf(fact)) }, Modifier.weight(1f), variant = ButtonVariant.Danger, size = ButtonSize.Lg)
            Button("Skip", { skipped = skipped.filter { it != fact.key } + fact.key }, Modifier.weight(1f), size = ButtonSize.Lg)
            Button("Approve", { ops.approve(listOf(fact)) }, Modifier.weight(1f), variant = ButtonVariant.Filled, size = ButtonSize.Lg)
        }
    }
}
