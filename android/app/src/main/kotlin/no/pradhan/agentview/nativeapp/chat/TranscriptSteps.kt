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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.net.image
import no.pradhan.agentview.nativeapp.net.stopTask
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.MonoFont
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.well
import no.pradhan.agentview.nativeapp.workspace.lineDiff

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
internal fun ExploredRow(label: String, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).heightIn(min = Tokens.touch), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(Tokens.leadWidth), contentAlignment = Alignment.CenterStart) { Box(Modifier.size(Tokens.dot).background(toneColor(stepTone("Read")), CircleShape)) }
        Text(androidx.compose.ui.text.buildAnnotatedString {
            withStyleColor(toneColor(stepTone("Read"))) { append("Explored ") }
            withStyleColor(av.fg) { append(label) }
        }, Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Chevron()
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
    val agentBar = av.agent
    val canStop by hub.store.state.select { it.session?.capabilities?.stopTask ?: true }
    val shown = if (it.running) it.steps.takeLast(3) else emptyList()
    Column(Modifier.fillMaxWidth().clickable { onOpenAgent(it.use.id) }) {
        Row(Modifier.fillMaxWidth().heightIn(min = Tokens.touch), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(Tokens.leadWidth), contentAlignment = Alignment.CenterStart) { StatusDot(DotState.Agent) }
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    append(desc)
                    withStyleColor(if (result?.isError == true && !isDenied(result)) av.err else av.fgMuted) {
                        append(" · ${if (type.isNotEmpty()) "$type · " else ""}$state${if (it.steps.isNotEmpty()) " · ${it.steps.size} ${if (it.steps.size == 1) "step" else "steps"}" else ""}")
                    }
                },
                Modifier.weight(1f), style = Type.subheadline, color = av.fg, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            if (it.running && canStop) Button("Stop", { hub.stopTask(it.use.id) }, variant = ButtonVariant.Gray, size = ButtonSize.Sm)
            AvIcon("chevron-right", null, Tokens.icon, Modifier.padding(horizontal = Tokens.sp3), tint = av.fgFaint)
        }
        if (shown.isNotEmpty()) Column(Modifier.padding(start = Tokens.subIndent).leftBar(agentBar, Tokens.stroke).padding(start = Tokens.sp7)) {
            if (it.steps.size > shown.size) Row(Modifier.fillMaxWidth().heightIn(min = Tokens.touch), verticalAlignment = Alignment.CenterVertically) {
                Text("${it.steps.size - shown.size} earlier steps", style = Type.footnote, color = av.fgMuted)
            }
            val running = it.running
            shown.forEachIndexed { i, s -> Box(Modifier.gap(gapAbove(shown.getOrNull(i - 1), s)?.coerceAtMost(Tokens.sp2))) { ItemRow(hub, s, chat, cwd, !running, onOpenAgent) } }
        }
    }
}
