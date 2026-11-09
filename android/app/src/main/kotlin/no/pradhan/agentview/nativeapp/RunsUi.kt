package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.launch

// The loop card above the composer (web/src/chat/LoopCard.tsx): state, last round, Pause and Stop; the rounds on tap, Run now on long press.
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LoopCard(hub: Hub, run: ChatRun, phase: String?) {
    var open by rememberSaveable(run.id) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val cycle = run.kind == "cycle"
    val paused = run.state == "paused"
    val last = run.rounds.lastOrNull()
    Box(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp3)) {
        Panel(Modifier.combinedClickable(onClick = { open = !open }, onLongClick = { if (!cycle && !paused) menu = true })) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(runLine(run, phase), Modifier.weight(1f), style = Type.callout, color = av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!cycle) IconBtn(if (paused) "debug-start" else "debug-pause", if (paused) "Resume" else "Pause", { hub.runControl(run, if (paused) "resume" else "pause") })
                IconBtn("debug-stop", "Stop", { hub.runControl(run, "stop") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text(run.what, Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(money(run.costUsd), style = Type.subheadline, color = av.fgMuted, maxLines = 1)
            }
            if (last != null) RoundLine(last, showTime = false)
            if (open) run.rounds.takeLast(10).reversed().forEach { RoundLine(it, showTime = true) }
        }
        Menu(menu, { menu = false }) { MenuItem("Run now", "debug-start", { menu = false; hub.runControl(run, "now") }) }
    }
}

@Composable
private fun RoundLine(r: Round, showTime: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
        if (showTime) Text(clock(r.at), style = Type.footnote, color = av.fgMuted)
        StatusDot(outcomeDot(r.outcome))
        Text(r.line.ifEmpty { r.outcome }, Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (showTime) Text(money(r.costUsd), style = Type.footnote, color = av.fgMuted)
    }
}

@Composable
fun RunBadgeView(badge: RunBadge, run: LiveRun) = when (badge) {
    RunBadge.Needs -> Badge("Needs you", BadgeTone.Waiting)
    RunBadge.Paused -> Badge("Paused", BadgeTone.Waiting)
    RunBadge.Next -> {
        AvIcon("sync", null, Tokens.iconSm, tint = av.fgMuted)
        run.nextAt?.let { RowLabel(clock(it)) } ?: Unit
    }
}

@Composable
fun RunsScreen(hub: Hub, onBack: () -> Unit, onChat: () -> Unit, onJob: () -> Unit) {
    val state by hub.store.state.collectAsState()
    val codex by hub.codex.state.collectAsState()
    val scope = rememberCoroutineScope()
    var finishedOpen by rememberSaveable { mutableStateOf(false) }
    val now = System.currentTimeMillis()
    val bands = remember(state.runs, codex.jobs, codex.runs, now / 60_000) { runBands(state.runs, codex.jobs, codex.runs, now) }
    LaunchedEffect(Unit) { hub.codex.sync() }

    fun openChat(run: ChatRun) {
        if (state.live.any { it.id == run.chatId }) { hub.open(run.chatId); onChat() }
        else scope.launch { if (hub.openSaved(run.sessionId)) onChat() }
    }

    @Composable
    fun entry(e: RunEntry) = when (e) {
        is RunEntry.Chat -> {
            val last = e.run.rounds.lastOrNull()
            ListRow(
                e.run.title.ifBlank { "Untitled" }, runLine(e.run), onClick = { openChat(e.run) },
                below = last?.let { { StatusDot(outcomeDot(it.outcome)); Text(it.line.ifEmpty { it.outcome }, style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
                trailing = { RowLabel(money(e.run.costUsd)) },
            )
        }
        is RunEntry.Job -> ListRow(
            e.row.str("name")?.ifEmpty { null } ?: "Untitled job", jobMeta(e.row, codex.runs, now), onClick = { hub.openJob.value = e.row.key; onJob() },
            trailing = { Badge(e.state.label, if (e.state == JobState.Failed) BadgeTone.Failed else if (e.state == JobState.Running) BadgeTone.Running else BadgeTone.Waiting) },
        )
    }

    Column(Modifier.fillMaxSize()) {
        PageHeader("Runs", onBack)
        if (bands.needs.isEmpty() && bands.running.isEmpty() && bands.finished.isEmpty()) {
            EmptyState("Loops, goals and scheduled jobs you start show here", icon = "sync")
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = Tokens.sp8)) {
            if (bands.needs.isNotEmpty()) {
                item(key = "needs-head") { SectionHeader("Needs you", bands.needs.size.toString(), color = av.warn) }
                lazyGroup(bands.needs, { entryKey(it) }) { entry(it) }
            }
            if (bands.running.isNotEmpty()) {
                item(key = "running-head") { SectionHeader("Running", bands.running.size.toString()) }
                lazyGroup(bands.running, { entryKey(it) }) { entry(it) }
            }
            if (bands.finished.isNotEmpty()) {
                item(key = "finished-head") { SectionHeader("Finished", bands.finished.size.toString(), open = finishedOpen, onToggle = { finishedOpen = !finishedOpen }) }
                if (finishedOpen) lazyGroup(bands.finished, { "f-${it.id}" }) { entry(RunEntry.Chat(it)) }
            }
        }
    }
}

private fun entryKey(e: RunEntry) = when (e) {
    is RunEntry.Chat -> "r-${e.run.id}"
    is RunEntry.Job -> "j-${e.row.key}"
}
