package no.pradhan.agentview.nativeapp.codex.meetings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.codex.AddPoint
import no.pradhan.agentview.nativeapp.codex.CodexOps
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.PinList
import no.pradhan.agentview.nativeapp.codex.PointList
import no.pradhan.agentview.nativeapp.codex.QuestionList
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.dayLabel
import no.pradhan.agentview.nativeapp.codex.dueText
import no.pradhan.agentview.nativeapp.codex.firstName
import no.pradhan.agentview.nativeapp.codex.peopleOf
import no.pradhan.agentview.nativeapp.codex.pinsOf
import no.pradhan.agentview.nativeapp.codex.pointsOf
import no.pradhan.agentview.nativeapp.codex.weekdayDate
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.Pending
import no.pradhan.agentview.nativeapp.net.resolveQuestion
import no.pradhan.agentview.nativeapp.sessions.matchesWords
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.plural

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
    var allCommitments by rememberSaveable(name, "commitments") { mutableStateOf(false) }
    var allClaims by rememberSaveable(name, "claims") { mutableStateOf(false) }
    var adding by rememberSaveable(name, "adding") { mutableStateOf(false) }
    val points = remember(st.items, name) { pointsOf(st.items, name) }
    val pins = remember(st.items, mine) { pinsOf(st.items, mine) }
    val resolved by hub.resolvedQuestions.collectAsState()
    val questions = remember(mine, resolved, now / 60_000) { visibleQuestions(openQuestions(mine, now), resolved) }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(shown, Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            Text(listOfNotNull(email, plural(mine.size, "meeting")).joinToString(" · "), Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted)
        }
        if (tasks.isNotEmpty()) {
            item { SectionHeader("Open tasks", tasks.size.toString()) }
            item { Group { tasks.take(5).forEachIndexed { i, r -> if (i > 0) Hairline(); ListRow(r.title ?: "(Untitled)", dueText(r, now), onClick = { onTask(r) }) } } }
        }
        if (commitments.isNotEmpty()) {
            item { SectionHeader("Commitments", commitments.size.toString()) }
            item {
                Group { (if (allCommitments) commitments else commitments.take(5)).forEachIndexed { i, c -> if (i > 0) Hairline(); ListRow(c.what, c.meeting.title, onClick = { onMeeting(c.meeting) }) } }
                if (!allCommitments && commitments.size > 5) Button("Show all ${commitments.size}", { allCommitments = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
        }
        if (points.isNotEmpty() || adding) {
            item { SectionHeader("Raise with ${firstName(shown)}", points.size.toString()) }
            if (points.isNotEmpty()) item { PointList(points, st.meetings, now, person = false, showMeeting = true, ops = ops) }
            item { AddPoint(name, mine.firstOrNull()?.profile ?: WORK, ops) }
        } else item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Add point", onClick = { adding = true }) } }
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
            if (mine.size > 5 && !all) Button("Show all ${mine.size}", { all = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
        if (claims.isNotEmpty()) {
            item { SectionHeader("In the wiki", claims.size.toString()) }
            item {
                Group {
                    (if (allClaims) claims else claims.take(5)).forEachIndexed { i, f ->
                        if (i > 0) Hairline()
                        val pid = f.str("page_id")
                        ListRow(f.str("text") ?: "", pid?.let { titles[it] }, onClick = pid?.let { p -> { onWikiPage(f.profile, p) } })
                    }
                }
                if (!allClaims && claims.size > 5) Button("Show all ${claims.size}", { allClaims = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

internal fun LazyListScope.seriesRows(prior: List<Row>, repeats: Repeats?, decisions: List<Pair<Row, String>>, undone: List<Pair<Row, Row>>, onMeeting: (Row) -> Unit) {
    val last = prior[0]
    val date = { x: Row -> dayLabel(x.startsAt!!) }
    val again = repeats?.let { r -> r.decisions.map { it to "Decided again, also on ${date(last)}" } + r.questions.map { it to "Asked again, also on ${date(last)}" } } ?: emptyList()
    item { SectionHeader("Series", again.size.takeIf { it > 0 }?.toString()) }
    item { Pending("${prior.size} earlier, last on ${date(last)}") }
    if (again.isNotEmpty()) item { Group { again.forEachIndexed { i, (t, meta) -> if (i > 0) Hairline(); ListRow(t, meta, lines = 2, onClick = { onMeeting(last) }) } } }
    if (decisions.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { decisions.forEachIndexed { i, (x, t) -> if (i > 0) Hairline(); ListRow(t, "Decided ${date(x)}", lines = 2, onClick = { onMeeting(x) }) } } }
    if (undone.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { undone.forEachIndexed { i, (x, r) -> if (i > 0) Hairline(); ListRow(r.title ?: r.str("text") ?: "", "Still open from ${date(x)}", lines = 2, onClick = { onMeeting(x) }) } } }
}
