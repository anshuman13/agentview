package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
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
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.jobs.JobState
import no.pradhan.agentview.nativeapp.codex.jobs.jobMeta
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.net.runControl
import no.pradhan.agentview.nativeapp.net.triesKeep
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.Panel
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.lazyGroup

// The loop card above the composer (web/src/chat/LoopCard.tsx): state, last round, Pause and Stop; the rounds on tap, Run now on long press.
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LoopCard(hub: Hub, run: ChatRun, phase: String?) {
    var open by rememberSaveable(run.id) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val cycle = run.kind == "cycle" || run.kind == "tries"
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
            run.rounds.lastOrNull { it.report != null }?.takeIf { it !== last }?.let { r -> Box(Modifier.clickable { hub.showTurn.value = r.report }) { RoundLine(r, showTime = false) } }
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
        Text(roundText(r), Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
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

    var board by rememberSaveable { mutableStateOf<String?>(null) }
    state.runs.firstOrNull { it.id == board }?.let { run ->
        TriesSheet(hub, run, state.live, { board = null }, { t -> scope.launch { if (hub.openSaved(t.sessionId)) { board = null; onChat() } } })
    }

    fun openChat(run: ChatRun) {
        run.rounds.lastOrNull()?.report?.let { hub.showTurn.value = it }
        if (state.live.any { it.id == run.chatId }) { hub.open(run.chatId); onChat() }
        else scope.launch { if (hub.openSaved(run.sessionId)) onChat() }
    }

    @Composable
    fun entry(e: RunEntry) = when (e) {
        is RunEntry.Chat -> {
            val last = e.run.rounds.lastOrNull()
            ListRow(
                e.run.title.ifBlank { "Untitled" }, runLine(e.run), onClick = { if (e.run.kind == "tries") board = e.run.id else openChat(e.run) },
                below = last?.let { { StatusDot(outcomeDot(it.outcome)); Text(roundText(it), style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
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

// The tries board as a sheet (web TriesBoard): a card per try with its state, last report, diff size and cost, Open and Keep behind a confirm.
@Composable
private fun TriesSheet(hub: Hub, run: ChatRun, live: List<LiveChat>, onDismiss: () -> Unit, onOpen: (RunTry) -> Unit) {
    var keep by remember { mutableStateOf<Int?>(null) }
    val open = run.tries.count { !it.dropped }
    keep?.let { n ->
        ConfirmDialog("Keep try $n?", "Archive the other ${open - 1} chats? Their worktrees stay on disk.", "Keep try $n", { hub.triesKeep(run, n) }, onDismiss = { keep = null })
    }
    Sheet(onDismiss, run.title.ifBlank { "Tries" }, count = run.tries.size.toString()) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp5)) {
            run.tries.forEach { t ->
                val c = tryColumn(run, t, live)
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        Text(c.branch, Modifier.weight(1f), style = Type.callout, color = av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Badge(c.state, when (c.state) { "Needs you" -> BadgeTone.Waiting; "Running" -> BadgeTone.Running; "Failed" -> BadgeTone.Failed; "Done" -> BadgeTone.Done; else -> BadgeTone.Quiet })
                    }
                    Text(c.line.ifEmpty { "No report yet" }, style = Type.subheadline, color = av.fg)
                    Text((c.edits?.let { "+${it.add} -${it.del}" } ?: "No edits") + " · " + money(c.cost), style = Type.footnote, color = av.fgMuted)
                    if (!c.archived) Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        Button("Open", { onOpen(t) }, size = ButtonSize.Sm)
                        Button("Keep try ${t.n}", { keep = t.n }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
                    }
                }
            }
        }
    }
}
