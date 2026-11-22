package no.pradhan.agentview.nativeapp.codex.wiki

import no.pradhan.agentview.nativeapp.codex.CheckCircle
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.matchesProfile
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.SwipeLabel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.lazyGroup

// The claim a proposal replaces or repeats, clamped to two lines; a tap shows all of it.
@Composable
private fun OldClaim(claim: Row, label: String, struck: Boolean, key: String) {
    var full by remember(key, label) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().heightIn(min = Tokens.touchSm).clickable { full = !full }.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4)) {
        Text(label, style = Type.meta, color = av.metaFg)
        Text(claim.str("text") ?: "", style = Type.subheadline, color = av.fgMuted, textDecoration = if (struck) TextDecoration.LineThrough else null, maxLines = if (full) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
    }
}

// A right swipe approves, a left swipe rejects; the row leaves with the data, so the box never settles open.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DecideSwipe(onApprove: () -> Unit, onReject: () -> Unit, content: @Composable () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val approve by rememberUpdatedState(onApprove)
    val reject by rememberUpdatedState(onReject)
    val state = rememberSwipeToDismissBoxState(confirmValueChange = { v ->
        haptic.performHapticFeedback(HapticFeedbackType.Confirm)
        when (v) { SwipeToDismissBoxValue.StartToEnd -> approve(); SwipeToDismissBoxValue.EndToStart -> reject(); else -> {} }
        false
    })
    SwipeToDismissBox(
        state = state,
        backgroundContent = {
            when (state.dismissDirection) {
                SwipeToDismissBoxValue.StartToEnd -> SwipeLabel(av.okContainer, "check", "Approve", av.onOkContainer, start = true)
                SwipeToDismissBoxValue.EndToStart -> SwipeLabel(av.errContainer, "close", "Reject", av.onErrContainer)
                else -> SwipeLabel(av.groupCard)
            }
        },
        content = { Box(Modifier.background(av.groupCard)) { content() } },
    )
}

@Composable
private fun ReviewClaimRow(st: CodexState, fact: Row, ops: ReviewOps, readOnly: Boolean, picked: Boolean, toggle: () -> Unit, onClaim: (Row) -> Unit, onOpenChat: (String) -> Unit) {
    val old = fact.str("replaces")?.let { id -> replacedClaim(fact, st.facts) ?: st.facts.firstOrNull { it.id == id && it.profile == fact.profile } }
    val similar = remember(fact, st.facts) { similarLive(fact, st.facts) }
    var editing by remember(fact.key) { mutableStateOf(false) }
    val meta = listOfNotNull(proposalSource(fact.id, fact.str("added_by"))?.label, fact.str("why")?.ifEmpty { null }).joinToString(" · ")
    val row = @Composable {
        if (readOnly) ListRow(fact.str("text") ?: "", meta)
        else ListRow(
            fact.str("text") ?: "", meta,
            leading = { CheckCircle(picked, if (picked) "Deselect claim" else "Select claim") { toggle() } },
            selected = picked,
            onClick = toggle,
            trailing = { Button("Approve", { ops.approve(listOf(fact)) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm) },
            menu = { dismiss ->
                val pick = { act: () -> Unit -> { dismiss(); act() } }
                MenuItem("Edit", "edit", pick { editing = true })
                MenuItem("Open page", "book", pick { onClaim(fact) })
                chatOf(fact)?.let { id -> MenuItem("Open chat", "sparkle", pick { onOpenChat(id) }) }
                if (similar != null) MenuItem("Replace it", "arrow-swap", pick { ops.replace(fact, similar) })
                MenuItem("Reject", "close", pick { ops.reject(listOf(fact)) }, danger = true)
            },
        )
    }
    Column {
        if (readOnly) row() else DecideSwipe({ ops.approve(listOf(fact)) }, { ops.reject(listOf(fact)) }, row)
        if (old != null) OldClaim(old, "Replaces", true, fact.key)
        if (similar != null) OldClaim(similar, "Similar to", false, fact.key)
    }
    if (editing) ClaimTextSheet("Edit claim", fact.str("text") ?: "", "Save", { editing = false }) { ops.edit(fact, it) }
}

// The bar over a claim selection (tasks SelectionBar): the count, Select all, Approve, Reject with its reasons, and an X that clears it.
@Composable
private fun ReviewSelectionBar(count: Int, onAll: () -> Unit, onApprove: () -> Unit, onReject: (String?) -> Unit, onClear: () -> Unit, modifier: Modifier = Modifier) {
    LRow(modifier.fillMaxWidth().background(av.groupCard).padding(horizontal = Tokens.sp4, vertical = Tokens.sp2), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        IconBtn("close", "Clear selection", onClear)
        Text("$count selected", Modifier.weight(1f), color = av.fg, style = Type.callout)
        Button("Select all", onAll, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        Button("Approve", onApprove, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
        var reasons by remember { mutableStateOf(false) }
        Box {
            Button("Reject", { reasons = true }, variant = ButtonVariant.Danger, size = ButtonSize.Sm)
            Menu(reasons, { reasons = false }) {
                (listOf<String?>(null) + REJECT_REASONS).forEach { r -> MenuItem(r ?: "Reject", "close", { reasons = false; onReject(r) }) }
            }
        }
    }
}

// Every proposed claim of the profile filter, by page, with source chips and a selection to decide many at once (web ReviewList).
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReviewListPage(st: CodexState, profile: String?, ops: ReviewOps, readOnly: Boolean, onBack: () -> Unit, onClaim: (Row) -> Unit, onOpenChat: (String) -> Unit) {
    var filter by rememberSaveable { mutableStateOf("all") }
    var picked by remember { mutableStateOf(emptySet<String>()) }
    val pages = remember(st.pages, profile) { st.pages.filter { matchesProfile(profile, it) } }
    val facts = remember(st.facts, profile) { st.facts.filter { matchesProfile(profile, it) } }
    val view = remember(pages, facts, filter) { reviewList(pages, facts, filter) }
    if (view.sections.isEmpty()) {
        EmptyState("Nothing waits for review", icon = "check", small = false, action = { Button("Back", onBack, size = ButtonSize.Sm) })
        return
    }
    val chosen = proposals(facts).filter { it.key in picked }
    fun decide(act: (List<Row>) -> Unit) { act(chosen); picked = emptySet() }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxWidth()) {
            item {
                FlowRow(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    view.filters.forEach { c -> Chip("${c.label} ${c.count}", { filter = c.key }, on = view.filter == c.key) }
                }
            }
            view.sections.forEach { s ->
                item(key = "head:${s.key}") { SectionHeader(s.title, s.claims.size.toString(), action = if (readOnly) null else ({ Button("Select", { picked = picked + s.claims.map { it.key } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })) }
                lazyGroup(s.claims, key = { it.key }) { f ->
                    ReviewClaimRow(st, f, ops, readOnly, f.key in picked, { picked = if (f.key in picked) picked - f.key else picked + f.key }, onClaim, onOpenChat)
                }
            }
            if (chosen.isNotEmpty()) item { Spacer(Modifier.padding(bottom = Tokens.fab)) }
        }
        if (!readOnly && chosen.isNotEmpty()) ReviewSelectionBar(
            chosen.size, { picked = picked + view.sections.flatMap { s -> s.claims.map { it.key } } }, { decide(ops::approve) }, { reason -> decide { ops.reject(it, reason) } }, { picked = emptySet() },
            Modifier.align(Alignment.BottomCenter),
        )
    }
}
