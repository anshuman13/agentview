package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items as lazyItems
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.loadEarlier
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.rewind
import no.pradhan.agentview.nativeapp.net.sendNow
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.isSketchPath
import no.pradhan.agentview.nativeapp.workspace.isSpecPath
import no.pradhan.agentview.nativeapp.workspace.sketchName
import no.pradhan.agentview.nativeapp.workspace.specSlug

internal fun gapAbove(older: Item?, it: Item): Dp? {
    if (older == null) return null
    val act = { i: Item -> i is Item.Step || i is Item.Agent }
    return when {
        act(older) && act(it) -> null
        (act(older) && it is Item.File) || (older is Item.File && act(it)) -> Tokens.sp1
        it is Item.User || older is Item.User -> Tokens.sp12
        it is Item.Phase -> Tokens.sp12
        else -> Tokens.sp4
    }
}

internal fun Modifier.gap(d: Dp?) = if (d == null) this else padding(top = d)

// Hides the bottom bar while scrolling away from the newest message.
@Composable
private fun HideNavOnScroll(hub: Hub, listState: LazyListState, atBottom: Boolean) {
    LaunchedEffect(listState) {
        var last = Int.MAX_VALUE to Int.MAX_VALUE
        snapshotFlow { Triple(listState.isScrollInProgress, listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset) }.collect { (moving, index, offset) ->
            val pos = index to offset
            if (moving && last.first != Int.MAX_VALUE) {
                if (index > last.first || (index == last.first && offset > last.second)) hub.navHidden.value = true
                else if (pos != last) hub.navHidden.value = false
            }
            last = pos
        }
    }
    LaunchedEffect(atBottom) { if (atBottom) hub.navHidden.value = false }
}

// Keeps the newest row in view while the user is at the bottom, and jumps to a turn or a just-sent message.
@Composable
private fun FollowNewest(hub: Hub, view: ChatView, listState: LazyListState, stick: MutableState<Boolean>, atBottom: Boolean) {
    val rows = view.rows
    val bottom by rememberUpdatedState(atBottom)
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to bottom }.collect { (moving, at) -> if (moving) stick.value = at }
    }
    val newest = rows.firstOrNull()?.id
    LaunchedEffect(newest, rows.size) { if (stick.value && newest != null) listState.scrollToItem(0) }
    val turn by hub.showTurn.collectAsState()
    LaunchedEffect(turn, rows) {
        val at = rows.indexOfFirst { it.id == turn }
        if (at >= 0) { stick.value = false; listState.animateScrollToItem(at); hub.showTurn.value = null }
    }
    var lastSent by remember { mutableStateOf<String?>(null) }
    val sent = view.sent
    LaunchedEffect(sent) {
        if (lastSent != null) { stick.value = true; if (rows.isNotEmpty()) listState.scrollToItem(0) }
        lastSent = sent
    }
}

// Loads earlier messages while the chat shows too few replies, up to three pages, and not again at a hidden count that failed to load; returns whether a load is due.
@Composable
private fun rememberEarlierDue(hub: Hub, chatId: String, replies: Int, loading: Boolean, earlier: Int, settled: Boolean): Boolean {
    var tried by remember(chatId) { mutableStateOf(-1) }
    var autoLoads by remember(chatId) { mutableStateOf(0) }
    val due = settled && !loading && earlier != tried && needsEarlier(replies, earlier, autoLoads)
    LaunchedEffect(due, earlier) { if (due) { tried = earlier; autoLoads++; hub.loadEarlier() } }
    return due
}

@Composable
fun Transcript(hub: Hub, view: ChatView, earlier: Int, settled: Boolean, chatId: String, cwd: String, running: Boolean, onOpenAgent: (String) -> Unit, modifier: Modifier = Modifier, queued: List<Queued> = emptyList()) {
    val items = view.items
    val rows = view.rows
    val noEvents by hub.store.state.select { it.events.isEmpty() }
    val canRewind by hub.store.state.select { it.session?.capabilities?.rewind ?: true }
    val folded = remember(view.runs) { view.runs.values.flatMap { r -> r.drop(1).map { it.id } }.toSet() }
    val seen = remember(chatId) { hub.leftAt(chatId) to System.currentTimeMillis() }
    val newId = remember(items, seen) { newMarker(items, view.ats, seen.first, seen.second) }
    DisposableEffect(chatId) { onDispose { hub.leftChat(chatId) } }
    val listState = rememberLazyListState()
    val loading by hub.loadingEarlier.collectAsState()
    val scope = rememberCoroutineScope()
    val stick = rememberSaveable { mutableStateOf(true) }
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 } }
    HideNavOnScroll(hub, listState, atBottom)
    var leftId by remember(chatId) { mutableStateOf<String?>(null) }
    LaunchedEffect(atBottom) { leftId = if (atBottom) null else leftId ?: rows.firstOrNull()?.id }
    val replies = remember(items, leftId) { leftId?.let { newReplies(items, it) } ?: 0 }
    val blank = rows.isEmpty() && earlier > 0
    val earlierDue = rememberEarlierDue(hub, chatId, remember(items) { items.count { it is Item.Assistant } }, loading, earlier, settled)
    FollowNewest(hub, view, listState, stick, atBottom)

    Box(modifier) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = listState,
            reverseLayout = true,
            contentPadding = PaddingValues(horizontal = Tokens.listPad, vertical = Tokens.sp8),
        ) {
            lazyItems(queued.asReversed(), key = { "out-${it.id}" }) { q ->
                Box(Modifier.padding(bottom = Tokens.sp4)) { QueuedRow(hub, q) }
            }
            transcriptRows(hub, view, newId, folded, chatId, cwd, running, canRewind, onOpenAgent)
            if (earlier > 0) item(key = "earlier") {
                Box(Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(enabled = !loading) { hub.loadEarlier() }, contentAlignment = Alignment.Center) {
                    Text(if (loading) "Loading earlier…" else "Show earlier ($earlier hidden)", style = Type.callout, color = av.accentText)
                }
            }
            if (rows.isEmpty()) item(key = "empty") {
                if (settled && noEvents == view.events.isEmpty() && !(blank && (loading || earlierDue))) EmptyState("No messages yet", "Your prompts, the agent's steps and replies show up here") else EmptyState("Loading…")
            }
        }
        val dayOf = view.dayOf
        val pill by remember(dayOf) { derivedStateOf { if (listState.isScrollInProgress) listState.layoutInfo.visibleItemsInfo.lastOrNull()?.key?.let { dayOf[it] } else null } }
        pill?.let { DayPill(it, Modifier.align(Alignment.TopCenter).padding(top = Tokens.sp4)) }
        if (!atBottom) JumpButton(replies, Modifier.align(Alignment.BottomCenter).padding(bottom = Tokens.sp4)) {
            stick.value = true
            hub.navHidden.value = false
            scope.launch { listState.animateScrollToItem(0) }
        }
    }
}

private fun LazyListScope.transcriptRows(hub: Hub, view: ChatView, newId: String?, folded: Set<String>, chatId: String, cwd: String, running: Boolean, canRewind: Boolean, onOpenAgent: (String) -> Unit) {
    val rows = view.rows
    val days = view.days
    val firstId = view.items.firstOrNull()?.id
    itemsIndexed(rows, key = { _, it -> it.id }, contentType = { _, it -> it::class }) { i, it ->
        Column(Modifier.gap(gapAbove(rows.getOrNull(i + 1), it))) {
            if (it is Item.User && it.id !in days && it.id != firstId) HorizontalDivider(Modifier.padding(bottom = Tokens.sp12), color = av.border, thickness = Tokens.hairline)
            days[it.id]?.let { DayDivider(it) }
            if (it.id == newId) NewLine()
            val run = view.runs[it.id]
            when {
                it.id in folded -> {}
                run != null -> ExploredRow(hub, it.id, run, cwd, !running)
                else -> ItemRow(hub, it, chatId, cwd, !running, onOpenAgent, !running && canRewind && it.id in view.rewinds, bump = if (it.id in view.specCards) view.specBumps[itemSlug(it)] ?: 0 else null)
            }
            view.summaries[it.id]?.takeIf { s -> !(running && s.latest) }?.let { s -> SummaryRow(s.events) }
        }
    }
}

@Composable
private fun DayDivider(label: String) {
    Row(Modifier.fillMaxWidth().padding(bottom = Tokens.sp8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        HorizontalDivider(Modifier.weight(1f), color = av.border, thickness = Tokens.hairline)
        Text(label, style = Type.label, color = av.fgMuted, fontWeight = FontWeight.SemiBold)
        HorizontalDivider(Modifier.weight(1f), color = av.border, thickness = Tokens.hairline)
    }
}

// Slack's floating date while scrolling a chat that spans several days.
@Composable
private fun DayPill(label: String, modifier: Modifier) {
    Text(
        label, modifier.clip(RoundedCornerShape(Tokens.shapeFull)).background(av.raised).border(Tokens.hairline, av.border, RoundedCornerShape(Tokens.shapeFull)).padding(horizontal = Tokens.sp6, vertical = Tokens.sp2),
        style = Type.label, color = av.fg, fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun NewLine() {
    Row(Modifier.fillMaxWidth().padding(bottom = Tokens.sp4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        HorizontalDivider(Modifier.weight(1f), color = av.danger, thickness = Tokens.hairline)
        Text("New", style = Type.label, color = av.danger, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun JumpButton(replies: Int, modifier: Modifier, onClick: () -> Unit) {
    Surface(modifier.clickable(onClick = onClick), shape = RoundedCornerShape(Tokens.radiusPill), color = av.raised, contentColor = av.fg, border = BorderStroke(Tokens.hairline, av.borderCard), shadowElevation = Tokens.elev2) {
        Row(Modifier.heightIn(min = Tokens.touch).padding(horizontal = Tokens.sp6), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            Text(if (replies > 0) "Jump to latest · $replies new ${if (replies == 1) "reply" else "replies"}" else "Jump to latest", style = Type.subheadline)
            AvIcon("arrow-down", null, Tokens.icon)
        }
    }
}

@Composable
internal fun ItemRow(hub: Hub, it: Item, chat: String, cwd: String, settled: Boolean, onOpenAgent: (String) -> Unit, canRewind: Boolean = false, bump: Int? = null) {
    when (it) {
        is Item.User -> UserRow(hub, it, chat, canRewind)
        is Item.Phase -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Text(it.text, style = Type.label, color = av.agent, fontWeight = FontWeight.SemiBold)
            HorizontalDivider(Modifier.weight(1f), color = av.border, thickness = Tokens.hairline)
        }
        is Item.Assistant -> Markdown(it.text, Modifier.fillMaxWidth(), it.streaming)
        is Item.System -> Text(it.text, Modifier.padding(start = Tokens.sp12), style = Type.footnote, color = if (it.error) av.err else av.fgMuted)
        is Item.Step -> StepRow(it, cwd, settled)
        is Item.File -> if (it.error != null) FileCard(it, cwd)
            else if (isSpecPath(it.path)) {
                val meta = if (it.uses.first().name == "Write") "Spec written" else "Spec edited \u00B7 +${it.add} -${it.del}"
                if (bump != null) SpecCard(hub, chat, specSlug(it.path), it.path, bump) else SpecRow(specSlug(it.path), meta)
            }
            else if (isSketchPath(it.path)) SketchCard(hub, sketchName(it.path), if (it.uses.first().name == "Write") "Sketch written" else "Sketch edited \u00B7 +${it.add} -${it.del}")
            else FileCard(it, cwd)
        is Item.Agent -> {
            AgentRow(hub, it, chat, cwd, onOpenAgent)
            val build = agentBuild(it.use)
            if (bump != null && build != null) Box(Modifier.padding(top = Tokens.sp4)) { SpecCard(hub, chat, build.slug, ".claude/specs/${build.slug}.md", bump) }
        }
        is Item.Blocked -> BlockedCard(it.ev, hub)
        is Item.Review -> ReviewCard(it.ev, hub)
    }
}

fun Modifier.leftBar(color: androidx.compose.ui.graphics.Color, width: Dp = Tokens.sp1): Modifier =
    drawBehind { drawRect(color, size = androidx.compose.ui.geometry.Size(width.toPx(), size.height)) }

@Composable
private fun UserBubble(content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.widthIn(max = maxWidth * 0.85f).background(av.surface, RoundedCornerShape(Tokens.shapeLg)).padding(horizontal = Tokens.sp8, vertical = Tokens.sp6),
            verticalArrangement = Arrangement.spacedBy(Tokens.sp3),
            content = content,
        )
    }
}

@Composable
private fun BubbleFooter(label: String, action: String, onClick: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp5), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f, fill = false), style = Type.footnote, color = av.fgMuted)
        Button(action, onClick, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

@Composable
private fun UserRow(hub: Hub, it: Item.User, chat: String, canRewind: Boolean) {
    var ask by remember { mutableStateOf(false) }
    val label = providerLabel(hub.store.state.value.session?.provider)
    if (ask) ConfirmDialog(
        "Rewind files?",
        "Puts every file Claude changed back to how it was before this prompt. Edits from later prompts are undone too; the conversation stays.",
        "Rewind", { ask = false; hub.rewind(it.id) }, onDismiss = { ask = false },
    )
    UserBubble {
        for (p in userParts(it.text)) when (p) {
            is Part.Text -> Text(p.text, style = Type.body, color = av.fg)
            is Part.Image -> ChatImage(hub, chat, p.path)
        }
        if (it.stopping) Text("Stopping $label to send this", style = Type.footnote, color = av.fgMuted)
        if (it.queued) BubbleFooter("Waiting for $label's next step", "Send now") { hub.sendNow(it.id) }
        if (canRewind) BubbleFooter("", "Rewind files") { ask = true }
    }
}

@Composable
private fun QueuedRow(hub: Hub, q: Queued) {
    UserBubble {
        Text(q.text, style = Type.body, color = av.fgMuted)
        BubbleFooter("Waiting to send", "Cancel") { hub.cancelQueued(q.id) }
    }
}
