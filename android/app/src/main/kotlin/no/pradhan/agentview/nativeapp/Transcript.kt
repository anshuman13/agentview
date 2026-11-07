package no.pradhan.agentview.nativeapp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.draw.rotate
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

private val pretty = Json { prettyPrint = true }

private fun gapAbove(older: Item?, it: Item): Dp? {
    if (older == null) return null
    val act = { i: Item -> i is Item.Step || i is Item.Agent }
    return when {
        act(older) && act(it) -> null
        (act(older) && it is Item.File) || (older is Item.File && act(it)) -> Tokens.sp1
        it is Item.Phase -> Tokens.sp7
        else -> Tokens.sp6
    }
}

private fun Modifier.gap(d: Dp?) = if (d == null) this else padding(top = d)

@Composable
fun Transcript(hub: Hub, state: StoreState, chatId: String, cwd: String, running: Boolean, modifier: Modifier = Modifier) {
    val items = remember(state.events) { buildTranscript(state.events) }
    val rows = remember(items) { items.asReversed() }
    val listState = rememberLazyListState()
    val loading by hub.loadingEarlier.collectAsState()
    val scope = rememberCoroutineScope()
    var stick by rememberSaveable { mutableStateOf(true) }
    var users by remember { mutableStateOf(0) }
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80 } }

    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to atBottom }.collect { (moving, bottom) -> if (moving) stick = bottom }
    }
    val newest = rows.firstOrNull()?.id
    LaunchedEffect(newest, rows.size) { if (stick && newest != null) listState.scrollToItem(0) }
    val sent = items.count { it is Item.User }
    LaunchedEffect(sent) {
        if (users > 0) { stick = true; if (rows.isNotEmpty()) listState.scrollToItem(0) }
        users = sent
    }

    Box(modifier) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = listState,
            reverseLayout = true,
            contentPadding = PaddingValues(horizontal = Tokens.sp6, vertical = Tokens.sp6),
        ) {
            itemsIndexed(rows, key = { _, it -> it.id }, contentType = { _, it -> it::class }) { i, it ->
                Box(Modifier.gap(gapAbove(rows.getOrNull(i + 1), it))) { ItemRow(hub, it, chatId, cwd, !running) }
            }
            if (state.earlier > 0) item(key = "earlier") {
                Button(if (loading) "Loading earlier" else "Show earlier (${state.earlier} hidden)", { hub.loadEarlier() }, enabled = !loading, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
            if (rows.isEmpty()) item(key = "empty") {
                if (state.settled) EmptyState("No messages yet", "Your prompts, Claude's steps and replies show up here.") else EmptyState("Loading")
            }
        }
        if (!atBottom) JumpButton(Modifier.align(Alignment.BottomCenter).padding(bottom = Tokens.sp5)) {
            stick = true
            scope.launch { listState.animateScrollToItem(0) }
        }
    }
}

@Composable
private fun JumpButton(modifier: Modifier, onClick: () -> Unit) {
    Surface(modifier.clickable(onClick = onClick), shape = RoundedCornerShape(Tokens.radiusPill), color = av.raised, contentColor = av.fg, border = BorderStroke(Tokens.hairline, av.borderCard), shadowElevation = Tokens.elev2) {
        Text("Jump to latest ↓", Modifier.heightIn(min = Tokens.touchSm).padding(horizontal = Tokens.sp6, vertical = Tokens.sp4), style = Type.footnote)
    }
}

@Composable
internal fun ItemRow(hub: Hub, it: Item, chat: String, cwd: String, settled: Boolean) {
    when (it) {
        is Item.User -> UserRow(hub, it, chat)
        is Item.Phase -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Text(it.text, style = Type.label, color = av.agent, fontWeight = FontWeight.SemiBold)
            HorizontalDivider(Modifier.weight(1f), color = av.border, thickness = Tokens.hairline)
        }
        is Item.Assistant -> Box(Modifier.fillMaxWidth().leftBar(av.claude.copy(alpha = 0.7f)).padding(start = Tokens.sp5, end = Tokens.sp1)) { Markdown(it.text) }
        is Item.System -> Text(it.text, Modifier.padding(start = Tokens.sp12), style = Type.footnote, color = av.fgFaint)
        is Item.Step -> StepRow(it, cwd, settled)
        is Item.File -> FileCard(it, cwd)
        is Item.Agent -> AgentRow(hub, it, chat, cwd)
        is Item.Blocked -> BlockedCard(it.ev, hub)
    }
}

fun Modifier.leftBar(color: androidx.compose.ui.graphics.Color, width: Dp = Tokens.sp1): Modifier =
    drawBehind { drawRect(color, size = androidx.compose.ui.geometry.Size(width.toPx(), size.height)) }

@Composable
private fun UserRow(hub: Hub, it: Item.User, chat: String) {
    val shape = RoundedCornerShape(Tokens.radius)
    Column(
        Modifier.fillMaxWidth().background(av.raised, shape).border(BorderStroke(Tokens.hairline, av.borderCard), shape).clip(shape).leftBar(av.prompt, Tokens.bar).padding(horizontal = Tokens.sp7, vertical = Tokens.sp6),
        verticalArrangement = Arrangement.spacedBy(Tokens.sp3),
    ) {
        for (p in userParts(it.text)) when (p) {
            is Part.Text -> Text(p.text, style = Type.body, color = av.fg)
            is Part.Image -> ChatImage(hub, chat, p.path)
        }
        if (it.stopping) Text("Stopping Claude to send this", style = Type.footnote, color = av.fgFaint)
        if (it.queued) Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp5), verticalAlignment = Alignment.CenterVertically) {
            Text("Waiting for Claude's next step", Modifier.weight(1f, fill = false), style = Type.footnote, color = av.fgFaint)
            Button("Send now", { hub.sendNow(it.id) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
    }
}

private val bitmaps = LruCache<String, Bitmap>(24)

@Composable
fun ChatImage(hub: Hub, chat: String, path: String) {
    val key = "$chat\n$path"
    val bmp by produceState(bitmaps.get(key), key) {
        if (value == null) value = withContext(Dispatchers.Default) {
            hub.image(chat, path)?.let { decodeSampled(it, 1080) }?.also { bitmaps.put(key, it) }
        }
    }
    val b = bmp
    if (b != null) Image(b.asImageBitmap(), path, Modifier.fillMaxWidth().heightIn(max = Geometry.imageMax).clip(RoundedCornerShape(Tokens.radiusSm)), contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
    else Text("Image: ${path.substringAfterLast('/')}", style = Type.footnote, color = av.fgMuted, modifier = Modifier.background(av.surface, RoundedCornerShape(Tokens.radiusSm)).padding(horizontal = Tokens.sp4, vertical = Tokens.sp2))
}

fun decodeSampled(bytes: ByteArray, maxWidth: Int): Bitmap? {
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
    var sample = 1
    while (o.outWidth / (sample * 2) >= maxWidth) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

@Composable
private fun toneColor(t: Tone) = if (t == Tone.Agent) av.agent else av.fgMuted

@Composable
private fun StepRow(it: Item.Step, cwd: String, settled: Boolean) {
    var open by rememberSaveable(it.id) { mutableStateOf(false) }
    val label = stepLabel(it.use.name, it.use.input, cwd)
    val result = it.result
    val state = when {
        result == null -> if (settled) "idle" else "pending"
        isDenied(result) -> "denied"
        result.isError -> "err"
        else -> "ok"
    }
    val dur = result?.let { r -> duration(r.at - it.use.at) } ?: ""
    Column(Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = Tokens.touchSm)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(Geometry.leadWidth), contentAlignment = Alignment.CenterStart) {
                if (state == "pending") CircularProgressIndicator(Modifier.size(Tokens.sp6), strokeWidth = Tokens.stroke, color = av.fgFaint)
                else Box(Modifier.size(Geometry.dot).background(if (state == "err") av.err else toneColor(stepTone(it.use.name)), CircleShape))
            }
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    if (label.verb.isNotEmpty()) withStyleColor(toneColor(stepTone(it.use.name))) { append(label.verb + " ") }
                    withStyleColor(av.fg, mono = label.mono) { append(label.obj) }
                },
                Modifier.weight(1f),
                style = Type.subheadline,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = av.fgMuted,
            )
            if (dur.isNotEmpty()) Text(dur, style = Type.footnote, color = av.fgFaint, modifier = Modifier.padding(start = Tokens.sp3))
        }
        if (!open) {
            label.cmd?.let { Text("$ " + it.replace(Regex("\\s*\\n\\s*"), " ⏎ "), Modifier.padding(start = Geometry.leadWidth), style = Mono, color = av.fgFaint, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            if (state == "err") Text(firstLine(result!!.text).ifEmpty { "Failed" }, Modifier.padding(start = Geometry.leadWidth), style = Type.footnote, color = av.err, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (state == "denied") Text("Denied", Modifier.padding(start = Geometry.leadWidth), style = Type.footnote, color = av.fgFaint)
        } else ToolDetail(it.use, result)
    }
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.withStyleColor(color: androidx.compose.ui.graphics.Color, mono: Boolean = false, block: () -> Unit) {
    withStyle(androidx.compose.ui.text.SpanStyle(color = color, fontFamily = if (mono) FontFamily.Monospace else null)) { block() }
}

@Composable
private fun ToolDetail(use: ChatEvent, result: ChatEvent?) {
    val input = use.input.s("command").ifEmpty { pretty.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), use.input) }
    Column(Modifier.fillMaxWidth().padding(start = Geometry.leadWidth, top = Tokens.sp1, bottom = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
        Pre(input, wrap = false)
        if (result != null) Pre(result.text.ifEmpty { "(no output)" }, error = result.isError && !isDenied(result))
    }
}

@Composable
private fun Pre(text: String, wrap: Boolean = true, error: Boolean = false) {
    Box(Modifier.heightIn(max = Geometry.scrollTall).well(av).verticalScroll(rememberScrollState())) {
        Text(
            text,
            Modifier.then(if (wrap) Modifier else Modifier.horizontalScroll(rememberScrollState())).padding(horizontal = Tokens.sp5, vertical = Tokens.sp4),
            style = Mono,
            softWrap = wrap,
            color = if (error) av.err else av.fg,
        )
    }
}

@Composable
private fun FileCard(it: Item.File, cwd: String) {
    var open by rememberSaveable(it.id) { mutableStateOf(false) }
    val rel = relPath(it.path, cwd)
    val cut = rel.lastIndexOf('/')
    val shape = RoundedCornerShape(Tokens.radius)
    val bar = if (it.error != null && !it.denied) av.err else av.tEdit
    Column(Modifier.fillMaxWidth().background(av.raised, shape).border(BorderStroke(Tokens.hairline, if (it.error != null && !it.denied) av.err.copy(alpha = 0.4f) else av.borderCard), shape).clip(shape).leftBar(bar, Tokens.bar)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = Tokens.touch).padding(start = Tokens.sp7, end = Tokens.sp6), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    withStyleColor(av.fgFaint) { append(if (cut >= 0) rel.substring(0, cut + 1) else "") }
                    append(rel.substring(cut + 1))
                },
                Modifier.weight(1f), style = Type.subheadline, color = av.fg, maxLines = 1, overflow = TextOverflow.StartEllipsis,
            )
            if (it.error != null) Text(it.error, style = Type.footnote, color = if (it.denied) av.fgFaint else av.err, maxLines = 1, modifier = Modifier.widthIn(max = Geometry.fileError))
            else Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                Text("+${it.add}", style = Type.footnote, color = av.diffAdd)
                Text("-${it.del}", style = Type.footnote, color = av.diffDel)
            }
        }
        if (open && it.error == null) Column(Modifier.padding(start = Tokens.sp7, end = Tokens.sp5, bottom = Tokens.sp5), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
            for (u in it.uses) for ((a, b) in editPairs(u)) DiffView(lineDiff(a, b))
        }
    }
}

// The old and new text of each edit of a tool call.
fun editPairs(use: ChatEvent): List<Pair<String, String>> = when (use.name) {
    "Write" -> listOf("" to use.input.s("content"))
    "Edit" -> listOf(use.input.s("old_string") to use.input.s("new_string"))
    "MultiEdit" -> (use.input["edits"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonObject)?.let { e -> e.s("old_string") to e.s("new_string") } } ?: emptyList()
    else -> emptyList()
}

@Composable
private fun AgentRow(hub: Hub, it: Item.Agent, chat: String, cwd: String) {
    var open by rememberSaveable(it.id) { mutableStateOf(false) }
    val desc = it.use.input.s("description").ifEmpty { "Sub-agent" }
    val type = it.use.input.s("subagent_type")
    val result = it.result
    val dur = result?.let { r -> duration(r.at - it.use.at) } ?: ""
    val state = when {
        it.running -> "running"
        result?.stopped == true -> "stopped"
        isDenied(result) -> "denied"
        result?.isError == true -> "failed"
        else -> "done" + if (dur.isNotEmpty()) " $dur" else ""
    }
    val canOpen = it.steps.isNotEmpty() || result != null
    val agentBar = av.agent.copy(alpha = 0.45f)
    val shown = if (open) it.steps else if (it.running) it.steps.takeLast(3) else emptyList()
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = Tokens.touchSm).clickable(enabled = canOpen) { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(Geometry.leadWidth), contentAlignment = Alignment.CenterStart) { StatusDot(DotState.Agent) }
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    append(desc)
                    withStyleColor(if (result?.isError == true && !isDenied(result)) av.err else av.fgFaint) {
                        append(" · ${if (type.isNotEmpty()) "$type · " else ""}$state${if (it.steps.isNotEmpty()) " · ${it.steps.size} ${if (it.steps.size == 1) "step" else "steps"}" else ""}")
                    }
                },
                Modifier.weight(1f), style = Type.subheadline, color = av.fg, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            if (it.running) Button("Stop", { hub.stopTask(it.use.id) }, variant = ButtonVariant.Gray, size = ButtonSize.Sm)
            if (canOpen) Icon(Icons.Filled.KeyboardArrowRight, null, Modifier.padding(horizontal = Tokens.sp3).size(Tokens.icon).rotate(if (open) 90f else 0f), tint = av.fgFaint)
        }
        if (shown.isNotEmpty()) Column(Modifier.padding(start = Geometry.subIndent).leftBar(agentBar, Tokens.stroke).padding(start = Tokens.sp7)) {
            if (!open && it.steps.size > shown.size) Text("${it.steps.size - shown.size} earlier steps", Modifier.clickable { open = true }.padding(vertical = Tokens.sp2), style = Type.footnote, color = av.fgFaint)
            val running = it.running
            shown.forEachIndexed { i, s -> Box(Modifier.gap(gapAbove(shown.getOrNull(i - 1), s)?.coerceAtMost(Tokens.sp2))) { ItemRow(hub, s, chat, cwd, !running) } }
        }
        if (open && result != null && !it.running) Box(Modifier.padding(start = Geometry.leadWidth, top = Tokens.sp1, bottom = Tokens.sp4).heightIn(max = Geometry.scrollTall).well(av).verticalScroll(rememberScrollState()).padding(Tokens.sp5)) {
            Markdown(result.text.ifEmpty { "(no output)" })
        }
    }
}
