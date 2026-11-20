package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.app.loadEarlier
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.retryTurn
import no.pradhan.agentview.nativeapp.app.rewind
import no.pradhan.agentview.nativeapp.app.sendNow
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.isSketchPath
import no.pradhan.agentview.nativeapp.workspace.isRepoSpec
import no.pradhan.agentview.nativeapp.workspace.sketchName
import no.pradhan.agentview.nativeapp.workspace.specSlug
import no.pradhan.agentview.nativeapp.ui.plural

internal fun gapAbove(older: Item?, it: Item): Dp? {
    if (older == null) return null
    val act = { i: Item -> i is Item.Step || i is Item.Agent }
    return when {
        act(older) && act(it) -> null
        (act(older) && it is Item.File) || (older is Item.File && act(it)) -> Tokens.sp1
        it is Item.User || older is Item.User -> Tokens.sp12
        else -> Tokens.sp4
    }
}

internal fun gapAbove(older: FoldRow?, row: FoldRow): Dp? = when {
    older == null -> null
    older is FoldRow.Row && row is FoldRow.Row -> gapAbove(older.it, row.it)
    (older as? FoldRow.Row)?.it is Item.User || (row as? FoldRow.Row)?.it is Item.User -> Tokens.sp12
    else -> Tokens.sp4
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
                if (index > last.first || (index == last.first && offset > last.second)) hub.shell.navHidden.value = true
                else if (pos != last) hub.shell.navHidden.value = false
            }
            last = pos
        }
    }
    LaunchedEffect(atBottom) { if (atBottom) hub.shell.navHidden.value = false }
}

// Keeps the newest row in view while the user is at the bottom, and jumps to a turn or a just-sent message.
@Composable
private fun FollowNewest(hub: Hub, view: ChatView, list: List<FoldRow>, listState: LazyListState, stick: MutableState<Boolean>, atBottom: Boolean) {
    val rows = view.rows
    val bottom by rememberUpdatedState(atBottom)
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to bottom }.collect { (moving, at) -> if (moving) stick.value = at }
    }
    val newest = rows.firstOrNull()?.id
    LaunchedEffect(newest, rows.size) { if (stick.value && newest != null) listState.scrollToItem(0) }
    val turn by hub.showTurn.collectAsState()
    LaunchedEffect(turn, list) {
        val at = list.indexOfFirst { it.key == turn || (it is FoldRow.Fold && it.hidden.any { h -> h.id == turn }) }
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
// Web chat/transcript/window.ts: a chat that opens on too few replies loads earlier pages by itself, a few times.
internal fun needsEarlier(replies: Int, earlier: Int, autoLoads: Int) = replies < 3 && earlier > 0 && autoLoads < 3

@Composable
private fun rememberEarlierDue(hub: Hub, chatId: String, replies: Int, loading: Boolean, earlier: Int, settled: Boolean): Boolean {
    var tried by remember(chatId) { mutableStateOf(-1) }
    var autoLoads by remember(chatId) { mutableStateOf(0) }
    val due = settled && !loading && earlier != tried && needsEarlier(replies, earlier, autoLoads)
    LaunchedEffect(due, earlier) { if (due) { tried = earlier; autoLoads++; hub.loadEarlier() } }
    return due
}

@Composable
fun Transcript(hub: Hub, view: ChatView, earlier: Int, settled: Boolean, chatId: String, cwd: String, running: Boolean, onOpenAgent: (String) -> Unit, onOpenWork: (String) -> Unit, modifier: Modifier = Modifier, queued: List<Queued> = emptyList(), failed: String? = null) {
    val items = view.items
    val rows = view.rows
    val noEvents by hub.store.state.select { it.events.isEmpty() }
    val canRewind by hub.store.state.select { it.session?.capabilities?.rewind ?: true }
    val bill by hub.store.state.select { billing(it.session?.provider) }
    val list = remember(view.items, view.folds) { view.foldRows.filter { it is FoldRow.Row || (it is FoldRow.Fold && (it.steps.isNotEmpty() || it.work.tools > 0)) } }
    val folded = remember(view.runs) { view.runs.values.flatMap { r -> r.drop(1).map { it.id } }.toSet() }
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
    var leftId by remember(chatId) { mutableStateOf<String?>(null) }
    LaunchedEffect(atBottom) { leftId = if (atBottom) null else leftId ?: rows.firstOrNull()?.id }
    val replies = remember(items, leftId) { leftId?.let { newReplies(items, it) } ?: 0 }
    val blank = rows.isEmpty() && earlier > 0
    val earlierDue = rememberEarlierDue(hub, chatId, view.replyCount, loading, earlier, settled)
    FollowNewest(hub, view, list, listState, stick, atBottom)

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
            transcriptRows(hub, view, list, bill, newKey, folded, chatId, cwd, running, canRewind, onOpenAgent, onOpenWork)
            if (earlier > 0) item(key = "earlier") {
                Box(Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(enabled = !loading) { hub.loadEarlier() }, contentAlignment = Alignment.Center) {
                    Text(if (loading) "Loading earlier…" else "Show earlier ($earlier hidden)", style = Type.callout, color = av.accentText)
                }
            }
            if (rows.isEmpty()) item(key = "empty") {
                if (settled && noEvents == view.events.isEmpty() && !(blank && (loading || earlierDue))) EmptyState("No messages yet", "Your prompts, the agent's steps and replies show up here") else Loading("Loading the chat…")
            }
        }
        val dayOf = view.dayOf
        val pill by remember(dayOf) { derivedStateOf { if (listState.isScrollInProgress) listState.layoutInfo.visibleItemsInfo.lastOrNull()?.key?.let { dayOf[it] } else null } }
        pill?.let { DayPill(it, Modifier.align(Alignment.TopCenter).padding(top = Tokens.sp4)) }
        if (!atBottom) JumpButton(replies, Modifier.align(Alignment.BottomEnd).padding(end = Tokens.sp4, bottom = Tokens.sp4)) {
            stick.value = true
            hub.shell.navHidden.value = false
            scope.launch { listState.animateScrollToItem(0) }
        }
    }
}

private fun LazyListScope.transcriptRows(hub: Hub, view: ChatView, list: List<FoldRow>, bill: String, newKey: String?, folded: Set<String>, chatId: String, cwd: String, running: Boolean, canRewind: Boolean, onOpenAgent: (String) -> Unit, onOpenWork: (String) -> Unit) {
    // Fields that keep their identity while a reply streams, so the rows do not capture the view, which does not.
    val days = view.days
    val runs = view.runs
    val specCards = view.specCards
    val specBumps = view.specBumps
    val rewinds = view.rewinds
    val answers = view.answers
    val openAnswer = view.openAnswer
    val firstId = view.items.firstOrNull()?.id
    itemsIndexed(list, key = { _, r -> r.key }, contentType = { _, r -> (r as? FoldRow.Row)?.it?.let { it::class } ?: r::class }) { i, r ->
        Column(Modifier.gap(gapAbove(list.getOrNull(i + 1), r))) {
            val it = (r as? FoldRow.Row)?.it
            if (it is Item.User && it.id !in days && it.id != firstId) HorizontalDivider(Modifier.padding(bottom = Tokens.sp12), color = av.border, thickness = Tokens.hairline)
            it?.let { row -> days[row.id]?.let { DayDivider(it) } }
            if (r.key == newKey) NewLine()
            when {
                r is FoldRow.Fold -> TaskLines(hub, r, running && r.last, onOpenWork)
                it == null || it.id in folded -> {}
                else -> {
                    val run = runs[it.id]
                    val bump = if (it.id in specCards) specBumps[itemSlug(it)] ?: 0 else null
                    val build = (it as? Item.Agent)?.let { a -> agentBuild(a.use) }
                    when {
                        run != null -> ExploredRow(hub, it.id, run, cwd, !running)
                        build != null && bump != null -> SpecCard(hub, chatId, build.slug, ".claude/specs/${build.slug}.md", bump)
                        else -> ItemRow(hub, it, chatId, cwd, !running, onOpenAgent, !running && canRewind && it.id in rewinds, bump = bump, answer = it.id in answers && !(running && it.id == openAnswer))
                    }
                }
            }
        }
    }
}

// The turn's tasks from set_status as small lines, and on the right a button that opens the turn's tool calls on their own screen (web Transcript.tsx Tasks).
@Composable
private fun TaskLines(hub: Hub, fold: FoldRow.Fold, live: Boolean, onOpenWork: (String) -> Unit) {
    // A finished turn shows only the tasks it marked done: the steps it never reached are no longer next.
    val steps = if (live) fold.steps else fold.steps.filter { it.done }
    val done = steps.count { it.done }
    val current = if (live) steps.firstOrNull { !it.done } else null
    val spin = @Composable { CircularProgressIndicator(Modifier.size(Tokens.sp5), strokeWidth = Tokens.stroke, color = av.fgFaint) }
    var reading by remember { mutableStateOf(false) }
    var proposing by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp1)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (steps.isNotEmpty()) Text(if (done < steps.size) "Tasks \u00b7 $done of ${steps.size}" else plural(steps.size, "task"), style = Type.label, color = av.fgFaint)
            Spacer(Modifier.weight(1f))
            if (fold.claims.isNotEmpty()) Chip("Used ${plural(fold.claims.size, "claim")}", { reading = !reading }, on = reading)
            if (fold.proposed.isNotEmpty()) Chip("Proposed ${plural(fold.proposed.size, "claim")}", { proposing = !proposing }, on = proposing)
            if (fold.work.tools > 0) Row(
                Modifier.clip(RoundedCornerShape(Tokens.shapeFull)).border(Tokens.hairline, av.border, RoundedCornerShape(Tokens.shapeFull)).clickable { onOpenWork(fold.id) }.padding(horizontal = Tokens.sp4, vertical = Tokens.sp1),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(plural(fold.work.tools, "tool"), style = Type.label, color = av.fgMuted)
                AvIcon("chevron-right", null, Tokens.sp5, tint = av.fgMuted)
            }
        }
        @Composable fun Task(icon: @Composable () -> Unit, text: String, color: androidx.compose.ui.graphics.Color) =
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) { Box(Modifier.padding(top = Tokens.sp1)) { icon() }; Text(text, style = Type.footnote, color = color) }
        if (reading) fold.claims.forEach { c ->
            Text(if (c.where.isEmpty()) c.text else "${c.text} (${c.where})", Modifier.padding(start = Tokens.sp8), style = Type.footnote, color = av.fgMuted)
        }
        if (proposing) {
            val facts by hub.codex.state.select { it.facts }
            fold.proposed.forEach { p ->
                Text("${p.text} (${proposalState(facts.firstOrNull { it.id == p.id })})", Modifier.padding(start = Tokens.sp8), style = Type.footnote, color = av.fgMuted)
            }
        }
        steps.forEach { s ->
            when {
                s.done -> Task({ AvIcon("check", null, Tokens.sp5, tint = av.ok) }, s.title, av.fg)
                s == current -> Task(spin, fold.now.ifEmpty { s.title }, av.fgStrong)
                else -> Task({ AvIcon("circle-large-outline", null, Tokens.sp5, tint = av.fgFaint) }, s.title, av.fgMuted)
            }
        }
        if (live && current == null && fold.now.isNotEmpty()) Task(spin, fold.now, av.fgStrong)
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
    val label = if (replies > 0) "Jump to latest · ${plural(replies, "new reply", "new replies")}" else "Jump to latest"
    Box(modifier) {
        Surface(Modifier.size(Tokens.touch).semantics { contentDescription = label }.clickable(onClick = onClick), shape = RoundedCornerShape(Tokens.radiusPill), color = av.raised, contentColor = av.fg, border = BorderStroke(Tokens.hairline, av.borderCard), shadowElevation = Tokens.elev2) {
            Box(contentAlignment = Alignment.Center) { AvIcon("arrow-down", null, Tokens.icon) }
        }
        if (replies > 0) Badge(if (replies > 9) "9+" else "$replies", BadgeTone.Quiet, Modifier.align(Alignment.TopEnd))
    }
}

@Composable
internal fun ItemRow(hub: Hub, it: Item, chat: String, cwd: String, settled: Boolean, onOpenAgent: (String) -> Unit, canRewind: Boolean = false, bump: Int? = null, answer: Boolean = false) {
    when (it) {
        is Item.User -> UserRow(hub, it, chat, canRewind)
        is Item.Assistant -> {
            Markdown(it.text, Modifier.fillMaxWidth(), it.streaming)
            if (answer) {
                val clip = LocalClipboardManager.current
                BubbleFooter("", "Copy") { clip.setText(AnnotatedString(it.text.trim())); hub.notice.value = "Reply copied" }
            }
        }
        is Item.System -> Text(it.text, Modifier.padding(start = Tokens.sp12), style = Type.footnote, color = if (it.error) av.err else av.fgMuted)
        is Item.Step -> StepRow(it, cwd, settled)
        is Item.File -> if (it.error != null) FileCard(it, cwd)
            else if (isRepoSpec(it.path, cwd)) {
                val meta = if (it.uses.first().name == "Write") "Spec written" else "Spec edited \u00B7 +${it.add} -${it.del}"
                if (bump != null) SpecCard(hub, chat, specSlug(it.path), it.path, bump) else SpecRow(specSlug(it.path), meta)
            }
            else if (bump != null && isDocFile(it.path)) DocCard(hub, it, cwd)
            else if (isSketchPath(it.path)) SketchCard(hub, chat, sketchName(it.path), if (it.uses.first().name == "Write") "Sketch written" else "Sketch edited \u00B7 +${it.add} -${it.del}")
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UserBubble(onLongClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.widthIn(max = maxWidth * 0.85f).background(av.surface, RoundedCornerShape(Tokens.shapeLg))
                .then(if (onLongClick != null) Modifier.combinedClickable(onClick = {}, onLongClick = onLongClick) else Modifier)
                .padding(horizontal = Tokens.sp8, vertical = Tokens.sp6),
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
    val clip = LocalClipboardManager.current
    val haptic = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val menuable = !it.queued && !it.stopping
    UserBubble(if (menuable) ({ haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu = true }) else null) {
        Menu(menu, { menu = false }) {
            if (!hub.readOnly) MenuItem("Use again", "reply", { menu = false; hub.useAgain(chat, it.text) })
            MenuItem("Copy", "copy", { menu = false; clip.setText(AnnotatedString(it.text)); hub.notice.value = "Prompt copied" })
        }
        userParts(it.text).forEachIndexed { i, p -> when (p) {
            is Part.Text -> FoldText("${it.id}:$i", p.text)
            is Part.Image -> ChatImage(hub, chat, p.path)
        } }
        if (it.stopping) Text("Stopping $label to send this", style = Type.footnote, color = av.fgMuted)
        if (it.queued) BubbleFooter("Waiting for $label's next step", "Send now") { hub.sendNow(it.id) }
        if (canRewind) BubbleFooter("", "Rewind files") { ask = true }
    }
}

private const val FOLD_LINES = 6

@Composable
private fun FoldText(key: String, text: String) {
    var open by rememberSaveable(key) { mutableStateOf(false) }
    var long by remember(key) { mutableStateOf(false) }
    Text(
        text, style = Type.body, color = av.fg,
        maxLines = if (open) Int.MAX_VALUE else FOLD_LINES, overflow = TextOverflow.Ellipsis,
        onTextLayout = { long = if (open) it.lineCount > FOLD_LINES else it.hasVisualOverflow },
    )
    if (long) Button(if (open) "Show less" else "Show more", { open = !open }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
}

@Composable
private fun QueuedRow(hub: Hub, q: Queued) {
    UserBubble {
        Text(q.text, style = Type.body, color = av.fgMuted)
        BubbleFooter("Waiting to send", "Cancel") { hub.cancelQueued(q.id) }
    }
}
