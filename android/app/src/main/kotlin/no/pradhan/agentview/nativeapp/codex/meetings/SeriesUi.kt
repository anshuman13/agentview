package no.pradhan.agentview.nativeapp.codex.meetings

import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.weekdayDate
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
            Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp8, bottom = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                LRow(verticalAlignment = Alignment.CenterVertically) {
                    Text(members[0].title ?: "Meeting", Modifier.weight(1f), style = Type.title)
                    if (next != null) Button("Open next", { onMeeting(next) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
                    if (calendar != null) MoreButton { close -> MenuItem("Open calendar", "calendar", { close(); uri.openUri(calendar) }) }
                }
                val meta = listOfNotNull(cadence, if (people.isNotEmpty()) plural(people.size, "person", "people") else null).joinToString(" · ")
                if (meta.isNotEmpty()) Text(meta, style = Type.subheadline, color = av.fgMuted)
            }
        }
        item { SectionHeader("Open across the series") }
        if (open.isEmpty()) item { EmptyState("Nothing open") }
        else item {
            Group {
                (if (allOpen) open else open.take(5)).forEachIndexed { i, (m, r) -> if (i > 0) Hairline(); ActionLine(r, m, now, actions, from = weekdayDate(m.startsAt!!)) }
            }
            if (!allOpen && open.size > 5) Button("Show all ${open.size}", { allOpen = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
        item { SectionHeader("Occurrences", members.size.toString()) }
        item {
            Group {
                (if (allOcc) members else members.take(5)).forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    val decisions = jsonList(m.str("decisions")).size
                    val left = open.count { it.first.key == m.key }
                    val meta = listOfNotNull(if (decisions > 0) plural(decisions, "decision") else null, if (left > 0) "$left open" else null).joinToString(", ")
                    ListRow("${weekdayDate(m.startsAt!!)}, ${clock(m.startsAt!!)}", meta.ifEmpty { null }, muted = meetingState(m, now) == MState.Missing, onClick = { onMeeting(m) })
                }
            }
            if (!allOcc && members.size > 5) Button("Show all ${members.size}", { allOcc = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            Spacer(Modifier.padding(bottom = Tokens.sp16))
        }
    }
}
