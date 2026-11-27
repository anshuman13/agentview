package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items as lazyItems
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.app.loadEarlier
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.retryTurn
import no.pradhan.agentview.nativeapp.app.rewind
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.isSketchPath
import no.pradhan.agentview.nativeapp.workspace.sketchName
import no.pradhan.agentview.nativeapp.ui.plural

internal fun Modifier.gap(d: Dp?) = if (d == null) this else padding(top = d)

@Composable
fun Transcript(hub: Hub, view: ChatView, earlier: Int, settled: Boolean, chatId: String, cwd: String, running: Boolean, finding: Boolean, onOpenAgent: (String) -> Unit, onOpenWork: (String) -> Unit, modifier: Modifier = Modifier, queued: List<Queued> = emptyList(), failed: String? = null, sessionId: String? = null, subFind: FindRequest? = null) {
    val subChats = rememberSubChats(hub, sessionId, chatId)
    SeekSubChat(hub, subChats, subFind)
    val items = view.items
    val rows = view.rows
    val noEvents by hub.store.state.select { it.events.isEmpty() }
    val canRewind by hub.store.state.select { it.session?.capabilities?.rewind ?: true }
    val bill by hub.store.state.select { billing(it.session?.provider) }
    val list = remember(view.items, view.folds) { view.foldRows.filter { it is FoldRow.Row || (it is FoldRow.Fold && (it.steps.isNotEmpty() || it.work.tools > 0)) } }
    val folded = remember(view.runs) { view.runs.values.flatMap { r -> r.drop(1).map { it.id } }.toSet() }
    val fresh = remember(chatId) { FreshReplies() }
    remember(items) { fresh.update(items) }
    val seen = remember(chatId) { hub.leftAt(chatId) to System.currentTimeMillis() }
    val newId = remember(items, seen) { newMarker(items, view.ats, seen.first, seen.second) }
    val newKey = remember(list, newId) { newId?.let { id -> list.firstOrNull { r -> if (r is FoldRow.Fold) r.hidden.any { it.id == id } else r.key == id }?.key } }
    DisposableEffect(chatId) { onDispose { hub.leftChat(chatId) } }
    val listState = rememberSaveable(chatId, saver = LazyListState.Saver) { LazyListState() }
    val loading by hub.loadingEarlier.collectAsState()
    val scope = rememberCoroutineScope()
    val stick = rememberSaveable(chatId) { mutableStateOf(true) }
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 } }
    HideNavOnScroll(hub, listState, atBottom)
    DisposableEffect(atBottom, finding) {
        hub.store.atLatest = atBottom && !finding
        onDispose { hub.store.atLatest = false }
    }
    var leftId by remember(chatId) { mutableStateOf<String?>(null) }
    LaunchedEffect(atBottom) { leftId = if (atBottom) null else leftId ?: rows.firstOrNull()?.id }
    val replies = remember(items, leftId) { leftId?.let { newReplies(items, it) } ?: 0 }
    val blank = rows.isEmpty() && earlier > 0
    val earlierDue = rememberEarlierDue(hub, chatId, view.replyCount, loading, earlier, settled)
    val open = remember(items, newId, newKey) { if (openAtNew(items, newId) != null) newKey else null }
    val pin = remember(chatId) { mutableStateOf(false) }
    FollowNewest(hub, view, list, listState, stick, pin, atBottom, chatId, open, queued.size + if (failed != null) 1 else 0)
    val margin = with(LocalDensity.current) { Tokens.touch.roundToPx() }
    LaunchedEffect(subChats.hit) {
        if (subChats.hit == null) return@LaunchedEffect
        stick.value = false
        pin.value = false
        val index = queued.size + (if (failed != null) 1 else 0) + list.size + (if (earlier > 0) 1 else 0)
        listState.scrollToItem(index)
        val y = withTimeoutOrNull(2000) { snapshotFlow { subChats.hitY }.first { it != null } }
        subChats.hit = null
        val size = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }?.size ?: return@LaunchedEffect
        val info = listState.layoutInfo
        listState.scrollToItem(index, size - (y?.toInt() ?: 0) - (info.viewportSize.height - info.beforeContentPadding - info.afterContentPadding) + margin)
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
            if (failed != null) item(key = "failed") {
                var retried by remember(chatId, failed) { mutableStateOf(false) }
                Row(Modifier.padding(top = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp5), verticalAlignment = Alignment.CenterVertically) {
                    Text(failed, Modifier.weight(1f), style = Type.footnote, color = av.err, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!retried) Button("Retry", { retried = true; hub.retryTurn(chatId) }, size = ButtonSize.Sm)
                }
            }
            transcriptRows(hub, view, list, bill, newKey, folded, chatId, cwd, running, canRewind, fresh, onOpenAgent, onOpenWork)
            if (earlier > 0) item(key = "earlier") {
                Box(Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(enabled = !loading) { hub.loadEarlier() }, contentAlignment = Alignment.Center) {
                    Text(if (loading) "Loading earlier…" else "Show earlier ($earlier hidden)", style = Type.callout, color = av.accentText)
                }
            }
            if (subChats.subs.isNotEmpty()) item(key = "subchats") { SubChatRows(hub, subChats, chatId, cwd) }
            if (rows.isEmpty()) item(key = "empty") {
                if (settled && noEvents == view.events.isEmpty() && !(blank && (loading || earlierDue))) EmptyState("No messages yet", "Your prompts, the agent's steps and replies show up here", icon = "comment-discussion") else Loading("Loading the chat…")
            }
        }
        ScrollDayPill(listState, view.dayOf, Modifier.align(Alignment.TopCenter).padding(top = Tokens.sp4))
        if (!atBottom) JumpButton(replies, Modifier.align(Alignment.BottomEnd).padding(end = Tokens.sp4, bottom = Tokens.sp4)) {
            stick.value = true
            pin.value = false
            hub.shell.navHidden.value = false
            scope.launch { listState.animateScrollToItem(0) }
        }
    }
}

private fun LazyListScope.transcriptRows(hub: Hub, view: ChatView, list: List<FoldRow>, bill: String, newKey: String?, folded: Set<String>, chatId: String, cwd: String, running: Boolean, canRewind: Boolean, fresh: FreshReplies, onOpenAgent: (String) -> Unit, onOpenWork: (String) -> Unit) {
    // Fields that keep their identity while a reply streams, so the rows do not capture the view, which does not.
    val days = view.days
    val runs = view.runs
    val docCards = view.docCards
    val rewinds = view.rewinds
    val answers = view.answers
    val openAnswer = view.openAnswer
    itemsIndexed(list, key = { _, r -> r.key }, contentType = { _, r -> (r as? FoldRow.Row)?.it?.let { it::class } ?: r::class }) { i, r ->
        Column(Modifier.gap(gapAbove(list.getOrNull(i + 1), r))) {
            val it = (r as? FoldRow.Row)?.it
            it?.let { row -> days[row.id]?.let { DayDivider(it) } }
            if (r.key == newKey) NewLine()
            when {
                r is FoldRow.Fold -> TaskLines(hub, r, cwd, running && r.last, onOpenWork)
                it == null || it.id in folded -> {}
                else -> {
                    val run = runs[it.id]
                    when {
                        run != null -> ExploredRow(hub, it.id, run, cwd, !running)
                        else -> {
                            val born = remember(it.id) { fresh.take(it.id) }
                            ItemRow(hub, it, chatId, cwd, !running, onOpenAgent, if (!running && canRewind) rewinds[it.id] else null, card = it.id in docCards, answer = it.id in answers && (!running || it.id != openAnswer), fresh = born)
                        }
                    }
                }
            }
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

// Reads the scroll state here so showing and hiding the pill on each drag does not recompose the whole Transcript.
@Composable
private fun ScrollDayPill(listState: LazyListState, dayOf: Map<String, String>, modifier: Modifier) {
    val pill by remember(dayOf) { derivedStateOf { if (listState.isScrollInProgress) listState.layoutInfo.visibleItemsInfo.lastOrNull()?.key?.let { dayOf[it] } else null } }
    pill?.let { DayPill(it, modifier) }
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
    val label = if (replies > 0) "Jump to latest · ${plural(replies, "new reply", "new replies")}" else "Jump to latest"
    Box(modifier) {
        Surface(Modifier.size(Tokens.touch).semantics { contentDescription = label }.clickable(onClick = onClick), shape = RoundedCornerShape(Tokens.radiusPill), color = av.raised, contentColor = av.fg, border = BorderStroke(Tokens.hairline, av.borderCard), shadowElevation = Tokens.elev2) {
            Box(contentAlignment = Alignment.Center) { AvIcon("arrow-down", null, Tokens.icon) }
        }
        if (replies > 0) Badge(if (replies > 9) "9+" else "$replies", BadgeTone.Quiet, Modifier.align(Alignment.TopEnd))
    }
}

@Composable
internal fun ItemRow(hub: Hub, it: Item, chat: String, cwd: String, settled: Boolean, onOpenAgent: (String) -> Unit, rewind: Item.User? = null, card: Boolean = false, answer: Boolean = false, readOnly: Boolean = false, fresh: Boolean = false) {
    when (it) {
        is Item.User -> UserRow(hub, it, chat, readOnly)
        is Item.Assistant -> {
            Markdown(it.text, Modifier.fillMaxWidth(), it.streaming, reading = true, fresh = fresh)
            if (!it.streaming && (answer || rewind != null)) ReplyActions(hub, if (answer) it.text.trim() else null, rewind)
        }
        is Item.System -> Text(it.text, style = Type.footnote, color = if (it.error) av.err else av.fgMuted)
        is Item.Step -> when (it.use.name) {
            ALARM_TOOL -> AlarmCard(it, !settled)
            BUILD_TOOL -> BuildCard(hub, it)
            else -> StepRow(it, cwd, settled)
        }
        is Item.File -> if (it.error != null) FileCard(hub, it, cwd)
            else if (card && isDocFile(it.path)) DocCard(hub, it, cwd)
            else if (isSketchPath(it.path)) SketchCard(hub, sketchName(it.path), if (it.uses.first().name == "Write") "Sketch written" else "Sketch edited \u00B7 +${it.add} -${it.del}")
            else FileCard(hub, it, cwd)
        is Item.Agent -> AgentRow(hub, it, chat, cwd, onOpenAgent)
        is Item.Blocked -> BlockedCard(it.ev, hub)
        is Item.Review -> ReviewCard(it.ev, hub)
    }
}

fun Modifier.leftBar(color: androidx.compose.ui.graphics.Color, width: Dp = Tokens.sp1): Modifier =
    drawBehind { drawRect(color, size = androidx.compose.ui.geometry.Size(width.toPx(), size.height)) }

// Copy (the Markdown source) and Rewind files under the turn's last reply (web Rewind.tsx).
@Composable
private fun ReplyActions(hub: Hub, copy: String?, rewind: Item.User?) {
    val clip = LocalClipboardManager.current
    var ask by remember { mutableStateOf(false) }
    if (ask && rewind != null) ConfirmDialog(
        "Rewind files?",
        "Puts every file ${providerLabel(hub.store.state.value.session?.provider)} changed back to how it was before \"${rewind.text.lineSequence().first().take(80)}\". Edits from later turns are undone too; the conversation stays.",
        "Rewind", { ask = false; hub.rewind(rewind.id) }, onDismiss = { ask = false },
    )
    Row(Modifier.offset(x = -Tokens.sp4)) {
        if (copy != null) IconBtn("copy", "Copy", { clip.setText(AnnotatedString(copy)); hub.notice.value = "Reply copied" }, iconSize = Tokens.icon)
        if (rewind != null) IconBtn("discard", "Rewind files", { ask = true }, iconSize = Tokens.icon)
    }
}
