package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import no.pradhan.agentview.nativeapp.codex.meetings.ActionLine
import no.pradhan.agentview.nativeapp.codex.meetings.MState
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.codex.meetings.cadenceOf
import no.pradhan.agentview.nativeapp.codex.meetings.jsonList
import no.pradhan.agentview.nativeapp.codex.meetings.meetingState
import no.pradhan.agentview.nativeapp.codex.meetings.nextInSeries
import no.pradhan.agentview.nativeapp.codex.meetings.openAcrossSeries
import no.pradhan.agentview.nativeapp.codex.meetings.parseSeriesKey
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.codex.meetings.seriesMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.seriesPeople
import no.pradhan.agentview.nativeapp.codex.meetings.summaryLines
import no.pradhan.agentview.nativeapp.codex.wiki.proposals
import no.pradhan.agentview.nativeapp.codex.wiki.shortDate
import no.pradhan.agentview.nativeapp.codex.wiki.sourcesOf
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.codex.wiki.ReviewOps
import no.pradhan.agentview.nativeapp.codex.wiki.extendOrder
import no.pradhan.agentview.nativeapp.codex.wiki.reviewQueue
import no.pradhan.agentview.nativeapp.ui.plural

// What the meetings and wiki pages share: Raise and points, pinned text, open questions, Prep groups, the Series page and Review mode.
class CodexOps(val points: PointActions, val goals: GoalActions, val review: ReviewOps, val replies: ReplyOps)

@Composable
fun RaiseButton(text: String, people: List<String>, onRaise: (String) -> Unit) {
    if (people.isEmpty() || text.isBlank()) return
    var open by remember { mutableStateOf(false) }
    Box {
        Button("Raise", { open = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        Menu(open, { open = false }) { people.forEach { p -> MenuItem("Raise with ${firstName(p)}", "comment", { open = false; onRaise(p) }) } }
    }
}

@Composable
fun ExpandRow(title: String, meta: String? = null, onClick: (() -> Unit)? = null, trailing: (@Composable RowScope.() -> Unit)? = null) {
    var open by remember(title) { mutableStateOf(false) }
    ListRow(title, meta, lines = if (open) Int.MAX_VALUE else 2, onClick = onClick ?: { open = !open }, trailing = trailing)
}

@Composable
fun PointList(points: List<Row>, meetings: List<Row>, now: Long, person: Boolean, showMeeting: Boolean, ops: CodexOps) {
    Group {
        points.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            val m = if (showMeeting) pointMeeting(r, meetings) else null
            ExpandRow((if (person) "${firstName(r.people ?: "")}: " else "") + (r.title ?: ""), m?.let { "${it.title} · ${whenText(it.startsAt!!, now, true)}" },
                trailing = { Button("Raised", { ops.points.tick(r) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "check") })
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
    TextField(text, { text = it }, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), singleLine = true, placeholder = if ('@' in person) "Raise a point" else "Raise with ${firstName(person)}",
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
            ExpandRow(r.text ?: r.title ?: "", if (onOpen != null) r.people else null, onClick = if (onOpen != null && r.meetingId != null) { { onOpen(r) } } else null,
                trailing = { Button("Unpin", { ops.points.unpin(r) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
        }
    }
}

// The summary's lines to pick from; a tap pins that line to the meeting.
@Composable
fun PinSheet(m: Row, ops: CodexOps, onDismiss: () -> Unit) {
    val lines = remember(m.str("summary")) { summaryLines(m.str("summary")) }
    Sheet(onDismiss, "Pin from the summary", padded = false) {
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
    if (!all && rows.size < group.rows.size) Button("Show all ${group.rows.size}", { all = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
}
