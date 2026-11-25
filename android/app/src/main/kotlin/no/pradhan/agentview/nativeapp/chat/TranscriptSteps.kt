package no.pradhan.agentview.nativeapp.chat

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.provider.AlarmClock
import android.util.LruCache
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.image
import no.pradhan.agentview.nativeapp.app.stopTask
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ops.agentSummary

import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.workspace.CopyPathItems
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.MonoFont
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.well
import no.pradhan.agentview.nativeapp.ui.lineDiff
import no.pradhan.agentview.nativeapp.workspace.sketchTitle
import no.pradhan.agentview.nativeapp.ui.plural

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

private fun stepIcon(t: Tone) = when (t) {
    Tone.Read -> "eye"
    Tone.Edit -> "edit"
    Tone.Run -> "terminal"
    Tone.Web -> "globe"
    Tone.Mcp -> "plug"
    Tone.Agent -> "sparkle"
    Tone.Other -> "tools"
}

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
    val bad = state == "err" || state == "denied"
    val tone = stepTone(it.use.name)
    Column(Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = Tokens.touch)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(Tokens.leadWidth), contentAlignment = Alignment.CenterStart) {
                if (state == "pending") CircularProgressIndicator(Modifier.size(Tokens.sp6), strokeWidth = Tokens.stroke, color = av.fgFaint)
                else AvIcon(stepIcon(tone), null, Tokens.iconSm, tint = if (bad) av.err else toneColor(tone))
            }
            val text = if (bad) av.err else av.fgMuted
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    if (label.verb.isNotEmpty()) withStyleColor(text) { append(label.verb + " ") }
                    withStyleColor(text, mono = label.mono) { append(label.obj) }
                },
                Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (dur.isNotEmpty()) Text(dur, style = Type.footnote, color = av.fgMuted, modifier = Modifier.padding(start = Tokens.sp3))
            AvIcon(if (open) "chevron-down" else "chevron-right", null, Tokens.iconSm, Modifier.padding(start = Tokens.sp2), tint = av.fgFaint)
        }
        if (!open) {
            label.cmd?.let { Text(cmdPreview(it), Modifier.padding(start = Tokens.leadWidth), style = Mono, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            if (state == "err") WordClamp(androidx.compose.ui.text.AnnotatedString(firstLine(result!!.text).ifEmpty { "Failed" }), Type.footnote, av.err, 2, modifier = Modifier.padding(start = Tokens.leadWidth))
            if (state == "denied") Text("Denied", Modifier.padding(start = Tokens.leadWidth), style = Type.footnote, color = av.err)
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

// web AlarmCard.tsx: an alarm the agent set on the phone, with the time, its label and whether the phone took it.
@Composable
internal fun AlarmCard(it: Item.Step, running: Boolean) {
    val card = alarmCard(it.use, it.result, running)
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard)) {
        ListRow(
            "Alarm", leading = { AvIcon("bell", null, Tokens.icon) },
            trailing = {
                Button("See alarms", { runCatching { context.startActivity(Intent(AlarmClock.ACTION_SHOW_ALARMS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            },
        )
        Column(Modifier.padding(start = Tokens.listPad + Tokens.leadWidth + Tokens.sp8, end = Tokens.listPad, bottom = Tokens.sp6), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            Text(card.time, style = Type.display, color = av.fgStrong)
            if (card.label.isNotEmpty()) Text(card.label, style = Type.body, color = av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                if (card.tone == AlarmTone.Pending) CircularProgressIndicator(Modifier.size(Tokens.sp6), strokeWidth = Tokens.stroke, color = av.fgFaint)
                Text(card.status, style = Type.meta, color = if (card.tone == AlarmTone.Error) av.err else av.metaFg)
            }
        }
    }
}

// A mockup the agent wrote with /sketch; a tap opens it on the Sketches page.
@Composable
internal fun SketchCard(hub: Hub, name: String, meta: String) {
    val open = { hub.link.value = DeepLink(page = "sketches", slug = name) }
    TranscriptBox(hub, "sketch:$name", sketchTitle(name), meta, icon = "paintcan", onOpen = open, action = { LinkAction("Open", open) })
}

private fun docTitle(path: String) = path.substringAfterLast('/').replace(Regex("\\.(md|markdown|mdx)$", RegexOption.IGNORE_CASE), "").replace(Regex("[-_]+"), " ")

// web DocCard.tsx: a Markdown file the agent wrote, opened rendered in a sheet where a block can be edited or asked about.
@Composable
internal fun DocCard(hub: Hub, it: Item.File, cwd: String) {
    var open by rememberSaveable(it.id) { mutableStateOf(false) }
    val rel = relPath(it.path, cwd)
    val meta = if (it.pending) "Updating\u2026" else "${if (it.uses.size == 1 && it.uses.first().name == "Write") "Written" else "Edited \u00B7 +${it.add} -${it.del}"} \u00B7 $rel"
    var copying by remember(it.id) { mutableStateOf(false) }
    Box {
        TranscriptBox(hub, "doc:${it.id}", docTitle(rel), meta, icon = "markdown", onOpen = { open = true }, onLongClick = { copying = true }, action = { LinkAction("Open") { open = true } })
        Menu(copying, { copying = false }) { CopyPathItems(hub, it.path, cwd) { copying = false } }
    }
    if (open) FileSheet(hub, rel, docTitle(rel)) { open = false }
}

@Composable
private fun FileSheet(hub: Hub, rel: String, title: String, onDismiss: () -> Unit) {
    no.pradhan.agentview.nativeapp.ui.Sheet(onDismiss, title, padded = false) {
        Box(Modifier.height(sheetHeight())) { no.pradhan.agentview.nativeapp.workspace.FileScreen(hub, rel, onDismiss, diffFirst = false) }
    }
}

@Composable
internal fun FileCard(hub: Hub, it: Item.File, cwd: String) {
    var sheet by rememberSaveable(it.id) { mutableStateOf(false) }
    val rel = relPath(it.path, cwd)
    val cut = rel.lastIndexOf('/')
    var copying by remember(it.id) { mutableStateOf(false) }
    Box {
        TranscriptBox(
            hub, "file:${it.id}", rel.substring(cut + 1), if (cut >= 0) rel.substring(0, cut + 1) else "", icon = "file",
            onLongClick = { copying = true },
            state = {
                if (it.error != null) WordClamp(androidx.compose.ui.text.AnnotatedString(it.error), Type.footnote, if (it.denied) av.fgMuted else av.err, 1, modifier = Modifier.widthIn(max = Tokens.fileError))
                else Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                    Text("+${it.add}", style = Type.footnote, color = av.diffAdd)
                    Text("-${it.del}", style = Type.footnote, color = av.diffDel)
                }
            },
            action = { LinkAction("Open") { sheet = true } },
            onOpen = if (it.error != null) ({ sheet = true }) else null,
        ) {
            Column(Modifier.padding(start = Tokens.sp7, end = Tokens.sp5, top = Tokens.sp4, bottom = Tokens.sp5), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                val diffs = remember(it.uses) { it.uses.flatMap { u -> editPairs(u).map { (a, b) -> lineDiff(a, b) } } }
                for (d in diffs) DiffView(d)
            }
        }
        Menu(copying, { copying = false }) { CopyPathItems(hub, it.path, cwd) { copying = false } }
    }
    if (sheet) FileSheet(hub, rel, rel.substring(cut + 1)) { sheet = false }
}

fun editPairs(use: ChatEvent) = editPairs(use.name, use.input) ?: emptyList()

@Composable
internal fun AgentRow(hub: Hub, it: Item.Agent, chat: String, cwd: String, onOpenAgent: (String) -> Unit) {
    val result = it.result
    val dur = if (result != null && !it.running) duration(result.at - it.use.at) else ""
    val steps = if (it.steps.isNotEmpty()) plural(it.steps.size, "step") else ""
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
        action = if (running && canStop) ({ LinkAction("Stop") { hub.stopTask(it.use.id) } }) else null,
        icon = "sparkle",
        summary = agentSummary(it), reserveSummary = running,
    ) {
        if (shown.isNotEmpty()) Column(Modifier.padding(start = Tokens.subIndent).leftBar(av.agent, Tokens.stroke).padding(start = Tokens.sp7)) {
            shown.forEachIndexed { i, s -> Box(Modifier.gap(gapAbove(shown.getOrNull(i - 1), s)?.coerceAtMost(Tokens.sp2))) { ItemRow(hub, s, chat, cwd, !running, onOpenAgent) } }
        }
        ListRow("Steps and report", trailing = { Chevron() }, onClick = { onOpenAgent(it.use.id) })
    }
}
