package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.style.TextOverflow
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
import no.pradhan.agentview.nativeapp.ui.plural

// The claim a proposal replaces or repeats, clamped to two lines; a tap shows all of it.
@Composable
private fun OldClaim(claim: Row, label: String, struck: Boolean, key: String) {
    var full by remember(key, label) { mutableStateOf(false) }
    Column(Modifier.heightIn(min = Tokens.touchSm).clickable { full = !full }) {
        Text(label, style = Type.meta, color = av.metaFg)
        Text(claim.str("text") ?: "", style = Type.subheadline, color = av.fgMuted, textDecoration = if (struck) TextDecoration.LineThrough else null, maxLines = if (full) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
    }
}

// One proposed claim at a time with big Approve, Skip and Reject, so a long list can be cleared with the thumb.
@OptIn(ExperimentalLayoutApi::class)
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
        EmptyState(if (total > 0) "All claims reviewed" else "Nothing waits for review", icon = "check", action = { Button("Back to the wiki", onBack, size = ButtonSize.Sm) })
        return
    }
    val page = fact.str("page_id")?.let { id -> st.pages.firstOrNull { it.id == id && it.profile == fact.profile } }
    val old = fact.str("replaces")?.let { id -> st.facts.firstOrNull { it.id == id && it.profile == fact.profile } }
    val similar = remember(fact, st.facts) { similarLive(fact, st.facts) }
    var editing by remember(fact.key) { mutableStateOf(false) }
    if (editing) ClaimTextSheet("Edit claim", fact.str("text") ?: "", "Save", { editing = false }) { ops.edit(fact, it) }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        Text("${total - left + 1} of $total", Modifier.padding(horizontal = Tokens.listPad), style = Type.label, color = av.fgMuted)
        Group {
            Column(Modifier.padding(Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
                Text(listOfNotNull(page?.title, if (page?.str("state") == "proposed") "(new page)" else null, fact.str("heading")?.ifEmpty { null }).joinToString(" · ").ifEmpty { "Memory" }, style = Type.callout, color = av.fgMuted)
                Text(fact.str("text") ?: "", style = Type.body, color = av.fg)
                Button("Edit", { editing = true }, size = ButtonSize.Sm, icon = "edit")
                if (old != null) OldClaim(old, "Replaces", true, fact.key)
                if (similar != null) OldClaim(similar, "Similar to", false, fact.key)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4), itemVerticalAlignment = Alignment.CenterVertically) {
                    sourcesOf(fact).forEach { s -> Chip(s.label, safeHref(s.url)?.let { u -> { uri.openUri(u) } }) }
                    fact.long("at")?.let { Text(shortDate(it, System.currentTimeMillis()), style = Type.meta, color = av.metaFg) }
                }
            }
            if (page != null) { Hairline(); ListRow("Open page", onClick = { onPage(page) }, trailing = { Chevron() }) }
        }
        Column(Modifier.padding(horizontal = Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Button("Approve", { ops.approve(listOf(fact)) }, Modifier.fillMaxWidth(), variant = ButtonVariant.Filled, size = ButtonSize.Lg)
            if (similar != null) Button("Replace it", { ops.replace(fact, similar) }, Modifier.fillMaxWidth(), size = ButtonSize.Md)
            LRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Button("Reject", { ops.reject(listOf(fact)) }, Modifier.weight(1f), variant = ButtonVariant.Danger, size = ButtonSize.Md)
                Button("Skip", { if (queue.size == 1) onBack() else skipped = skipped.filter { it != fact.key } + fact.key }, Modifier.weight(1f), size = ButtonSize.Md)
            }
        }
    }
}
