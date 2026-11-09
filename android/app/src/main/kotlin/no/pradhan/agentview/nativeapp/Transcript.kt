package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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

@Composable
fun Transcript(hub: Hub, view: ChatView, earlier: Int, settled: Boolean, chatId: String, cwd: String, running: Boolean, onOpenAgent: (String) -> Unit, modifier: Modifier = Modifier, queued: List<Queued> = emptyList()) {
    val items = view.items
    val rows = view.rows
    val days = view.days
    val dayOf = view.dayOf
    val rewinds = view.rewinds
    val runs = view.runs
    val noEvents by hub.store.state.select { it.events.isEmpty() }
    var openRuns by rememberSaveable(chatId) { mutableStateOf(setOf<String>()) }
    val firstId = items.firstOrNull()?.id
    val folded = remember(runs, openRuns) { runs.filterKeys { it !in openRuns }.values.flatMap { r -> r.drop(1).map { it.id } }.toSet() }
    val seen = remember(chatId) { hub.leftAt(chatId) to System.currentTimeMillis() }
    val newId = remember(items, seen) { newMarker(items, view.ats, seen.first, seen.second) }
    DisposableEffect(chatId) { onDispose { hub.leftChat(chatId) } }
    val listState = rememberLazyListState()
    val loading by hub.loadingEarlier.collectAsState()
    val scope = rememberCoroutineScope()
    var stick by rememberSaveable { mutableStateOf(true) }
    var users by remember { mutableStateOf(0) }
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 } }

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
    var leftId by remember(chatId) { mutableStateOf<String?>(null) }
    LaunchedEffect(atBottom) { leftId = if (atBottom) null else leftId ?: rows.firstOrNull()?.id }
    val replies = remember(items, leftId) { leftId?.let { newReplies(items, it) } ?: 0 }
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to atBottom }.collect { (moving, bottom) -> if (moving) stick = bottom }
    }
    val blank = rows.isEmpty() && earlier > 0
    var tried by remember(chatId) { mutableStateOf(-1) }
    LaunchedEffect(blank, loading, earlier, settled) { if (blank && settled && !loading && earlier != tried) { tried = earlier; hub.loadEarlier() } }
    val newest = rows.firstOrNull()?.id
    LaunchedEffect(newest, rows.size) { if (stick && newest != null) listState.scrollToItem(0) }
    val sent = view.sent
    LaunchedEffect(sent) {
        if (users > 0) { stick = true; if (rows.isNotEmpty()) listState.scrollToItem(0) }
        users = sent
    }

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
            itemsIndexed(rows, key = { _, it -> it.id }, contentType = { _, it -> it::class }) { i, it ->
                Column(Modifier.gap(gapAbove(rows.getOrNull(i + 1), it))) {
                    if (it is Item.User && it.id !in days && it.id != firstId) HorizontalDivider(Modifier.padding(bottom = Tokens.sp12), color = av.border, thickness = Tokens.hairline)
                    days[it.id]?.let { DayDivider(it) }
                    if (it.id == newId) NewLine()
                    val run = runs[it.id]
                    when {
                        it.id in folded -> {}
                        run != null && it.id !in openRuns -> ExploredRow(exploreLabel(run)) { openRuns = openRuns + it.id }
                        else -> ItemRow(hub, it, chatId, cwd, !running, onOpenAgent, !running && it.id in rewinds)
                    }
                }
            }
            if (earlier > 0) item(key = "earlier") {
                Box(Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(enabled = !loading) { hub.loadEarlier() }, contentAlignment = Alignment.Center) {
                    Text(if (loading) "Loading earlier…" else "Show earlier ($earlier hidden)", style = Type.callout, color = av.accentText)
                }
            }
            if (rows.isEmpty()) item(key = "empty") {
                if (settled && noEvents == view.events.isEmpty() && !(blank && (loading || tried != earlier))) EmptyState("No messages yet", "Your prompts, Claude's steps and replies show up here") else EmptyState("Loading…")
            }
        }
        val pill by remember(dayOf) { derivedStateOf { if (listState.isScrollInProgress) listState.layoutInfo.visibleItemsInfo.lastOrNull()?.key?.let { dayOf[it] } else null } }
        pill?.let { DayPill(it, Modifier.align(Alignment.TopCenter).padding(top = Tokens.sp4)) }
        if (!atBottom) JumpButton(replies, Modifier.align(Alignment.BottomCenter).padding(bottom = Tokens.sp4)) {
            stick = true
            hub.navHidden.value = false
            scope.launch { listState.animateScrollToItem(0) }
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
internal fun ItemRow(hub: Hub, it: Item, chat: String, cwd: String, settled: Boolean, onOpenAgent: (String) -> Unit, canRewind: Boolean = false) {
    when (it) {
        is Item.User -> UserRow(hub, it, chat, canRewind)
        is Item.Phase -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Text(it.text, style = Type.label, color = av.agent, fontWeight = FontWeight.SemiBold)
            HorizontalDivider(Modifier.weight(1f), color = av.border, thickness = Tokens.hairline)
        }
        is Item.Assistant -> Markdown(it.text, Modifier.fillMaxWidth(), it.streaming)
        is Item.System -> Text(it.text, Modifier.padding(start = Tokens.sp12), style = Type.footnote, color = if (it.error) av.err else av.fgMuted)
        is Item.Step -> StepRow(it, cwd, settled)
        is Item.File -> FileCard(it, cwd)
        is Item.Agent -> AgentRow(hub, it, chat, cwd, onOpenAgent)
        is Item.Blocked -> BlockedCard(it.ev, hub)
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
        if (it.stopping) Text("Stopping Claude to send this", style = Type.footnote, color = av.fgMuted)
        if (it.queued) BubbleFooter("Waiting for Claude's next step", "Send now") { hub.sendNow(it.id) }
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
