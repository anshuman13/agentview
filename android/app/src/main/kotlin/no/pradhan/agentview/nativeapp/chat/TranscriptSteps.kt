package no.pradhan.agentview.nativeapp.chat

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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.image
import no.pradhan.agentview.nativeapp.net.stopTask
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ops.Findings
import no.pradhan.agentview.nativeapp.ops.agentSummary
import no.pradhan.agentview.nativeapp.sessions.BUILD_FOLD
import no.pradhan.agentview.nativeapp.sessions.BuildDetail
import no.pradhan.agentview.nativeapp.sessions.FLOW_LABEL
import no.pradhan.agentview.nativeapp.sessions.FlowStep
import no.pradhan.agentview.nativeapp.sessions.HOLD_BADGE
import no.pradhan.agentview.nativeapp.sessions.flowBadge
import no.pradhan.agentview.nativeapp.sessions.pipelineLabel
import no.pradhan.agentview.nativeapp.sessions.stateBadge
import no.pradhan.agentview.nativeapp.sessions.stateDot
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.MonoFont
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.well
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.lineDiff
import no.pradhan.agentview.nativeapp.workspace.rememberLoad
import no.pradhan.agentview.nativeapp.workspace.sketchTitle

private val pretty = Json { prettyPrint = true }

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
    if (b != null) Image(b.asImageBitmap(), path, Modifier.fillMaxWidth().heightIn(max = Tokens.imageMax).clip(RoundedCornerShape(Tokens.radiusSm)), contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
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
internal fun ExploredRow(hub: Hub, id: String, steps: List<Item.Step>, cwd: String, settled: Boolean) {
    TranscriptBox(hub, "explore:$id", "Explored ${exploreLabel(steps)}") {
        Column(Modifier.padding(horizontal = Tokens.listPad).padding(bottom = Tokens.sp3)) { steps.forEach { StepRow(it, cwd, settled) } }
    }
}

@Composable
internal fun StepRow(it: Item.Step, cwd: String, settled: Boolean) {
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
    Column(Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = Tokens.touch)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(Tokens.leadWidth), contentAlignment = Alignment.CenterStart) {
                if (state == "pending") CircularProgressIndicator(Modifier.size(Tokens.sp6), strokeWidth = Tokens.stroke, color = av.fgFaint)
                else Box(Modifier.size(Tokens.dot).background(if (state == "err") av.err else toneColor(stepTone(it.use.name)), CircleShape))
            }
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    if (label.verb.isNotEmpty()) withStyleColor(toneColor(stepTone(it.use.name))) { append(label.verb + " ") }
                    withStyleColor(av.fg, mono = label.mono) { append(label.obj) }
                },
                Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (dur.isNotEmpty()) Text(dur, style = Type.footnote, color = av.fgMuted, modifier = Modifier.padding(start = Tokens.sp3))
        }
        if (!open) {
            label.cmd?.let { Text(cmdPreview(it), Modifier.padding(start = Tokens.leadWidth), style = Mono, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            if (state == "err") WordClamp(androidx.compose.ui.text.AnnotatedString(firstLine(result!!.text).ifEmpty { "Failed" }), Type.footnote, av.err, 2, modifier = Modifier.padding(start = Tokens.leadWidth))
            if (state == "denied") Text("Denied", Modifier.padding(start = Tokens.leadWidth), style = Type.footnote, color = av.fgMuted)
        } else ToolDetail(it.use, result)
    }
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.withStyleColor(color: androidx.compose.ui.graphics.Color, mono: Boolean = false, block: () -> Unit) {
    withStyle(androidx.compose.ui.text.SpanStyle(color = color, fontFamily = if (mono) MonoFont else null)) { block() }
}

@Composable
private fun ToolDetail(use: ChatEvent, result: ChatEvent?) {
    val input = use.input.s("command").ifEmpty { pretty.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), use.input) }
    Column(Modifier.fillMaxWidth().padding(start = Tokens.leadWidth, top = Tokens.sp1, bottom = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
        Pre(input, wrap = false)
        if (result != null) Pre(result.text.ifEmpty { "(no output)" }, error = result.isError && !isDenied(result))
    }
}

@Composable
private fun Pre(text: String, wrap: Boolean = true, error: Boolean = false) {
    Box(Modifier.heightIn(max = Tokens.scrollTall).well(av).verticalScroll(rememberScrollState())) {
        Text(
            text,
            Modifier.then(if (wrap) Modifier else Modifier.horizontalScroll(rememberScrollState())).padding(Tokens.sp6),
            style = Mono,
            softWrap = wrap,
            color = if (error) av.err else av.fg,
        )
    }
}

// The live card of a spec in a chat: its header and menu load with the box closed; the body shows the flow, the criteria and the findings, and each row opens a sheet.
@Composable
internal fun SpecCard(hub: Hub, chat: String, slug: String, path: String, bump: Int) {
    val (load, reload) = rememberLoad(chat, slug) { loadBuild(hub, slug) }
    var seen by remember(chat, slug) { mutableIntStateOf(bump) }
    LaunchedEffect(bump) { if (bump != seen) { seen = bump; reload() } }
    val d = load.data
    PollWhile(d?.summary?.state == "running", reload)
    val gone = d == null && !load.busy && load.error.isEmpty()
    val stack = remember { mutableStateListOf<BuildSheet>() }
    val actions = buildActions(hub, slug, reload)
    val cwd by hub.store.state.select { it.session?.cwd.orEmpty() }
    val run = d?.specFile?.takeIf { chat.isNotEmpty() }?.let { "$cwd/$it" }?.let { p -> TaskRun(p) { hub.askChat(it) } }
    TranscriptBox(
        hub, "build:$chat:$slug", d?.title?.ifEmpty { null } ?: slug,
        if (gone) "Spec removed" else d?.let { listOf(pipelineLabel(it.pipeline), it.summary.conclusion).filter(String::isNotEmpty).joinToString(" · ") }.orEmpty(),
        state = {
            if (d?.hold == true) Badge(HOLD_BADGE.first, HOLD_BADGE.second)
            else if (d != null && d.entries.isNotEmpty()) stateBadge(d.summary.state).let { Badge(it.first, it.second) }
        },
        action = { SpecMenu(hub, d, path, stack, actions) },
        defaultOpen = true,
    ) {
        when {
            gone -> {}
            d != null -> SpecBody(hub, d, stack)
            load.error.isNotEmpty() -> LoadFailed("this build", reload)
            else -> Loading("Loading build")
        }
    }
    if (d != null) BuildSheets(hub, d, stack, actions, run)
}

@Composable
private fun SpecMenu(hub: Hub, d: BuildDetail?, path: String, stack: MutableList<BuildSheet>, actions: BuildActions) {
    val subagents by hub.store.state.select { (it.session?.capabilities ?: Capabilities()).can("subagents") }
    MoreButton { dismiss ->
        if (d != null) MenuItem("Open spec", "go-to-file", { dismiss(); stack.add(BuildSheet.Spec()) })
        if (d != null && !hub.readOnly) MenuItem(if (d.hold) "Release hold" else "Hold", "debug-pause", { dismiss(); actions.setHold(if (d.hold) "release" else "hold") })
        MenuItem(if (subagents) "Review with fresh eyes" else "Needs subagents, not in this chat", "eye", { dismiss(); hub.askChat("/spec-review $path") }, enabled = subagents && !hub.readOnly)
    }
}

private fun flowSheet(f: FlowStep, d: BuildDetail): BuildSheet? = when {
    f.state == "todo" -> null
    f.key == "spec" -> BuildSheet.Spec(d.phases.firstOrNull { it.key == "requirements" }?.key ?: d.phases.firstOrNull()?.key)
    f.key == "approval" -> BuildSheet.Spec()
    f.key == "merge" -> null
    else -> BuildSheet.Step(f.key)
}

// The flow's marks are joined by a hairline from the row above to the row below.
private fun Modifier.flowLine(color: Color, first: Boolean, last: Boolean) = drawBehind {
    val x = (Tokens.listPad + Tokens.leadWidth / 2).toPx()
    drawLine(color, Offset(x, if (first) size.height / 2 else 0f), Offset(x, if (last) size.height / 2 else size.height), Tokens.hairline.toPx())
}

@Composable
private fun SpecBody(hub: Hub, d: BuildDetail, stack: MutableList<BuildSheet>) {
    var all by remember(d.slug) { mutableStateOf(false) }
    val failed = d.criteria.any { it.result == "fail" }
    val now = System.currentTimeMillis()
    val line = av.border
    SectionHeader("Flow")
    Group {
        d.flow.forEachIndexed { i, f ->
            if (i > 0) Hairline(lead = true)
            val badge = flowBadge(f)
            val sheet = flowSheet(f, d)
            ListRow(
                FLOW_LABEL[f.key] ?: f.key, listOf(f.by, f.result, f.at?.let { agoShort(it, now) }.orEmpty()).filter(String::isNotEmpty).joinToString(" · "),
                leading = { StatusDot(if (f.state == "running") DotState.Running else stateDot(f.state)) },
                state = { if (badge != null) Badge(badge.first, badge.second) }, stateSlot = true,
                modifier = Modifier.flowLine(line, i == 0, i == d.flow.lastIndex),
                onClick = sheet?.let { { stack.add(it) } },
            )
        }
    }
    Criteria(d.criteria, if (all || failed) d.criteria.size else BUILD_FOLD, { all = true }) { stack.add(BuildSheet.Criterion(it)) }
    Findings(hub, "spec:${d.slug}") { stack.add(BuildSheet.File(it.file)) }
}

// A spec write that no longer holds the live card, shown plain.
@Composable
internal fun SpecRow(slug: String, meta: String) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard)) {
        ListRow(slug, meta, leading = { AvIcon("beaker", null, Tokens.icon) })
    }
}

// A mockup the agent wrote with /sketch; a tap opens it on the Sketches page.
@Composable
internal fun SketchCard(hub: Hub, name: String, meta: String) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard)) {
        ListRow(sketchTitle(name), meta, leading = { AvIcon("paintcan", null, Tokens.icon) }, onClick = { hub.link.value = DeepLink(page = "sketches", slug = name) })
    }
}

@Composable
internal fun FileCard(it: Item.File, cwd: String) {
    var open by rememberSaveable(it.id) { mutableStateOf(false) }
    val rel = relPath(it.path, cwd)
    val cut = rel.lastIndexOf('/')
    val shape = RoundedCornerShape(Tokens.radius)
    val bar = if (it.error != null && !it.denied) av.err else av.tEdit
    Column(Modifier.fillMaxWidth().background(av.raised, shape).border(BorderStroke(Tokens.hairline, av.border), shape).clip(shape).leftBar(bar, Tokens.bar)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = Tokens.touch).padding(start = Tokens.sp7, end = Tokens.sp6), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    withStyleColor(av.fgMuted) { append(if (cut >= 0) rel.substring(0, cut + 1) else "") }
                    append(rel.substring(cut + 1))
                },
                Modifier.weight(1f), style = Type.subheadline, color = av.fg, maxLines = 1, overflow = TextOverflow.StartEllipsis,
            )
            if (it.error != null) WordClamp(androidx.compose.ui.text.AnnotatedString(it.error), Type.footnote, if (it.denied) av.fgMuted else av.err, 1, modifier = Modifier.widthIn(max = Tokens.fileError))
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
internal fun AgentRow(hub: Hub, it: Item.Agent, chat: String, cwd: String, onOpenAgent: (String) -> Unit) {
    val result = it.result
    val dur = if (result != null && !it.running) duration(result.at - it.use.at) else ""
    val steps = if (it.steps.isNotEmpty()) "${it.steps.size} ${if (it.steps.size == 1) "step" else "steps"}" else ""
    val canStop by hub.store.state.select { it.session?.capabilities?.stopTask ?: true }
    val shown = it.steps.takeLast(3)
    val running = it.running
    TranscriptBox(
        hub, "agent:${it.use.id}", it.use.input.s("description").ifEmpty { "Sub-agent" },
        listOf(it.use.input.s("subagent_type"), dur, steps).filter { m -> m.isNotEmpty() }.joinToString(" \u00B7 "),
        state = {
            when {
                running -> Badge("Running", BadgeTone.Running)
                result?.stopped == true || isDenied(result) -> Badge("Skipped", BadgeTone.Quiet)
                result?.isError == true -> Badge("Failed", BadgeTone.Failed)
                else -> Badge("Done", BadgeTone.Done)
            }
        },
        action = if (running && canStop) ({ IconBtn("debug-stop", "Stop agent", { hub.stopTask(it.use.id) }) }) else null,
        summary = agentSummary(it), reserveSummary = running,
    ) {
        if (shown.isNotEmpty()) Column(Modifier.padding(start = Tokens.subIndent).leftBar(av.agent, Tokens.stroke).padding(start = Tokens.sp7)) {
            shown.forEachIndexed { i, s -> Box(Modifier.gap(gapAbove(shown.getOrNull(i - 1), s)?.coerceAtMost(Tokens.sp2))) { ItemRow(hub, s, chat, cwd, !running, onOpenAgent) } }
        }
        ListRow("Steps and report", trailing = { Chevron() }, onClick = { onOpenAgent(it.use.id) })
    }
}
