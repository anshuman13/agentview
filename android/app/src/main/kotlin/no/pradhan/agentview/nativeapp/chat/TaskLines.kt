package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import android.provider.Settings
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.claimRoute
import no.pradhan.agentview.nativeapp.codex.wiki.replaceTarget
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.rememberNow
import no.pradhan.agentview.nativeapp.ops.turnMeter
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

// The turn's tasks from set_status as small lines, and on the right a button that opens the turn's tool calls on their own screen (web Transcript.tsx Tasks).
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TaskLines(hub: Hub, fold: FoldRow.Fold, cwd: String, live: Boolean, onOpenWork: (String) -> Unit) {
    // A finished turn shows only the tasks it marked done: the steps it never reached are no longer next.
    val steps = if (live) fold.steps else fold.steps.filter { it.done }
    val done = steps.count { it.done }
    val current = if (live) steps.firstOrNull { !it.done } else null
    val spin = @Composable { WorkDots() }
    val doing = if (live) runningStep(fold.hidden, cwd) else ""
    val view by hub.transcriptView.collectAsState()
    val thinking = if (live || foldOpen(view, "thinking")) fold.thought else ""
    if (fold.work.tools == 0 && steps.isEmpty() && fold.claims.isEmpty() && fold.proposed.isEmpty() && fold.remembered.isEmpty() && thinking.isEmpty()) return
    var reading by remember { mutableStateOf(false) }
    var proposing by remember { mutableStateOf(false) }
    var memory by remember { mutableStateOf(false) }
    if (memory) {
        val files by hub.store.state.select { it.session?.instructionFiles.orEmpty() }
        MemorySheet(hub, cwd, files, fold.remembered.singleOrNull()) { memory = false }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp1)) {
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3), itemVerticalAlignment = Alignment.CenterVertically) {
            if (steps.isNotEmpty()) Text(if (done < steps.size) "Tasks \u00b7 $done of ${steps.size}" else plural(steps.size, "task"), style = Type.footnote, color = av.fgMuted)
            if (steps.isNotEmpty() && fold.work.tools > 0 && fold.claims.isEmpty() && fold.proposed.isEmpty() && fold.remembered.isEmpty()) Text("\u00b7", style = Type.footnote, color = av.fgMuted)
            if (fold.claims.isNotEmpty()) Chip("Used ${plural(fold.claims.size, "claim")}", { reading = !reading }, on = reading)
            if (fold.proposed.isNotEmpty()) Chip("Proposed ${plural(fold.proposed.size, "claim")}", { proposing = !proposing }, on = proposing)
            if (fold.remembered.isNotEmpty()) Chip("Remembered ${plural(fold.remembered.size, "memory", "memories")}", { memory = true })
            if (fold.work.tools > 0) Row(
                Modifier.heightIn(min = Tokens.touchSm).clickable { onOpenWork(fold.id) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (doing.isNotEmpty()) {
                    WorkDots()
                    Text(doing, Modifier.padding(start = Tokens.sp2).weight(1f, fill = false), style = Type.footnote, color = av.fgStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else Text("Used ${plural(fold.work.tools, "tool")}", style = Type.footnote, color = av.fgMuted, maxLines = 1, softWrap = false)
                AvIcon("chevron-right", null, Tokens.sp5, tint = av.fgMuted)
            }
            if (fold.work.tools > 0) EditMarks(fold.work.add, fold.work.del)
        }
        if (thinking.isNotEmpty()) Text(thinking, style = Type.footnote, color = av.fgMuted, fontStyle = FontStyle.Italic, maxLines = 1, overflow = TextOverflow.Ellipsis)
        @Composable fun Task(icon: @Composable () -> Unit, text: String, color: androidx.compose.ui.graphics.Color) =
            Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.sp6, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) { Box(Modifier.padding(top = Tokens.sp1)) { icon() }; Text(text, style = Type.footnote, color = color) }
        if (reading) {
            val facts by hub.codex.state.select { it.facts }
            fold.claims.forEach { c ->
                val state = usedClaimState(facts, c.id)
                val note = listOf(c.where, state).filter { it.isNotEmpty() }.joinToString(" · ")
                val fact = facts.firstOrNull { it.id == c.id }?.takeIf { state != "Gone" }?.let { if (state == "Replaced") replaceTarget(facts, c.id, it.profile) ?: it else it }
                val tap = if (fact == null) Modifier else Modifier.heightIn(min = Tokens.touchSm).clickable { hub.link.value = DeepLink(codexRoute = claimRoute(fact)) }
                Text(if (note.isEmpty()) c.text else "${c.text} ($note)", tap.padding(start = Tokens.sp8), style = Type.footnote, color = av.fgMuted)
            }
        }
        if (proposing) {
            val facts by hub.codex.state.select { it.facts }
            fold.proposed.forEach { p ->
                Text("${p.text} (${proposalState(facts.firstOrNull { it.id == p.id })})", Modifier.padding(start = Tokens.sp8), style = Type.footnote, color = av.fgMuted)
            }
        }
        // The task checklist sits in a framed list with a line between rows, as the Claude apps show a step's details.
        if (steps.isNotEmpty()) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).border(Tokens.hairline, av.borderCard, RoundedCornerShape(Tokens.shapeLg))) {
            steps.forEachIndexed { i, s ->
                if (i > 0) HorizontalDivider(thickness = Tokens.hairline, color = av.borderCard)
                when {
                    s.done -> Task({ AvIcon("check", null, Tokens.sp5, tint = av.ok) }, s.title, av.fg)
                    s == current -> Task(spin, fold.now.ifEmpty { s.title }, av.fgStrong)
                    else -> Task({ AvIcon("circle-large-outline", null, Tokens.sp5, tint = av.fgFaint) }, s.title, av.fgMuted)
                }
            }
            if (live && current == null && fold.now.isNotEmpty()) {
                HorizontalDivider(thickness = Tokens.hairline, color = av.borderCard)
                Task(spin, fold.now, av.fgStrong)
            }
        }
    }
}

// The working dots under a running turn, with how long it has run and the output tokens streamed so far (web Transcript.tsx Working).
@Composable
internal fun Working(hub: Hub) {
    val turn by hub.store.state.select { it.session?.turn }
    val now by rememberNow(turn != null)
    val meta = turnMeter(turn, now)
    Row(Modifier.gap(Tokens.sp24).semantics(mergeDescendants = true) { contentDescription = "Working" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        WorkDots()
        if (meta.isNotEmpty()) Text(meta, style = Type.footnote, color = av.fgMuted, maxLines = 1)
    }
}

// Two accent dots pulsing in turn, the Claude apps' mark for a running step; still when animations are off.
@Composable
internal fun WorkDots() {
    val resolver = LocalContext.current.contentResolver
    val moving = remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f }
    val t = rememberInfiniteTransition(label = "work")
    val phase = if (moving) t.animateFloat(0f, 1f, infiniteRepeatable(tween(Tokens.dur * 8)), label = "phase").value else 0.5f
    Row(Modifier.height(Tokens.sp5), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp1)) {
        listOf(0f, 0.5f).forEach { off ->
            val x = (phase + off) % 1f
            Box(Modifier.size(Tokens.sp2).alpha(0.35f + 0.65f * (1f - kotlin.math.abs(2f * x - 1f))).clip(CircleShape).background(av.accent))
        }
    }
}
