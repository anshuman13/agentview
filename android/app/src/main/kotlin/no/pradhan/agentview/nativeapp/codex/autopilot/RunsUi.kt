package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.delay
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
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.runControl
import no.pradhan.agentview.nativeapp.net.triesKeep
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
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

// The loop card above the composer (web/src/chat/cards/LoopCard.tsx): state and Pause in the head, what is happening now, the running agents, then the what line.
private const val MAX_AGENTS = 3

@Composable
fun LoopCard(hub: Hub, run: ChatRun, live: LiveChat, phase: String?, onOpenAgent: (String) -> Unit, onOpenAgents: () -> Unit) {
    var open by rememberSaveable(run.id) { mutableStateOf(false) }
    val cycle = run.kind == "cycle" || run.kind == "tries"
    val goal = run.kind == "goal"
    val paused = run.state == "paused"
    val agents = live.agentList
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(agents.isNotEmpty()) { while (agents.isNotEmpty()) { delay(30_000); now = System.currentTimeMillis() } }
    val progress = if (goal) planProgress(hub, planOf(run.what), run.chatId) else null
    val state = loopNow(run, live.now)
    val working = live.running || agents.isNotEmpty()
    val detail = { hub.goalSheet.value = GoalSheet.Detail(run.id) }
    val meta = listOfNotNull(
        state.at?.let { clock(it) },
        state.outcome?.replaceFirstChar(Char::uppercase),
        state.next?.let { "Next: $it" },
        state.stepsLeft.takeIf { it > 0 }?.let { "$it ${if (it == 1) "step" else "steps"} left" },
    ).joinToString(" · ")
    Box(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp3)) {
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(runLine(run, phase), Modifier.weight(1f).then(if (goal) Modifier.clickable(onClick = detail) else Modifier), style = Type.callout, color = av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!cycle) IconBtn(if (paused) "debug-start" else "debug-pause", if (paused) "Resume" else "Pause", { hub.runControl(run, if (paused) "resume" else "pause") })
                if (cycle) IconBtn("debug-stop", "Stop", { hub.runControl(run, "stop") }, enabled = !hub.readOnly)
                else MoreButton { close ->
                    if (!paused) MenuItem("Run now", "debug-start", { close(); hub.runControl(run, "now") }, enabled = !hub.readOnly)
                    MenuItem("Stop", "debug-stop", { close(); hub.runControl(run, "stop") }, danger = true, enabled = !hub.readOnly)
                }
            }
            ListRow(
                state.title, meta.ifEmpty { null }, lines = 2,
                leading = { StatusDot(if (working) DotState.Running else outcomeDot(run.rounds.lastOrNull()?.outcome ?: "quiet")) },
                onClick = if (goal) detail else if (run.kind == "loop" && state.outcome != null) ({ open = !open }) else null,
            )
            agents.take(MAX_AGENTS).forEach { a ->
                ListRow(a.slug ?: a.description, "${a.type} · ${agentAge(a.startedAt, now)}", leading = { AvIcon("hubot", null, Tokens.iconSm, tint = av.fgMuted) }, stateSlot = false, onClick = { onOpenAgent(a.id) })
            }
            if (agents.size > MAX_AGENTS) ListRow("${agents.size - MAX_AGENTS} more agents", leading = { AvIcon("hubot", null, Tokens.iconSm, tint = av.fgMuted) }, onClick = onOpenAgents)
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text(progress?.let { "Plan $it" } ?: run.what, Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(money(run.costUsd, billing(run.provider)), style = Type.subheadline, color = av.fgMuted, maxLines = 1)
            }
            run.rounds.lastOrNull { it.report != null }?.let { r -> Box(Modifier.clickable { hub.showTurn.value = r.report }) { RoundLine(r, showTime = false, run.provider) } }
            if (open && run.kind == "loop") run.rounds.takeLast(10).reversed().forEach { RoundLine(it, showTime = true, run.provider) }
        }
    }
}

@Composable
private fun RoundLine(r: Round, showTime: Boolean, provider: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
        if (showTime) Text(clock(r.at), style = Type.footnote, color = av.fgMuted)
        StatusDot(outcomeDot(r.outcome))
        Text(roundText(r), Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (showTime) Text(money(r.costUsd, billing(provider)), style = Type.footnote, color = av.fgMuted)
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

    fun openChat(run: ChatRun) = scope.launch { if (hub.openRun(run, run.rounds.lastOrNull()?.report)) onChat() }

    @Composable
    fun entry(e: RunEntry) = when (e) {
        is RunEntry.Chat -> {
            val last = e.run.rounds.lastOrNull()
            ListRow(
                e.run.title.ifBlank { "Untitled" }, runLine(e.run), onClick = { when (e.run.kind) { "tries" -> board = e.run.id; "goal" -> hub.goalSheet.value = GoalSheet.Detail(e.run.id); else -> openChat(e.run) } },
                below = last?.let { { StatusDot(outcomeDot(it.outcome)); Text(roundText(it), style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
                trailing = { RowLabel(money(e.run.costUsd, billing(e.run.provider))) },
            )
        }
        is RunEntry.Job -> ListRow(
            e.row.str("name")?.ifEmpty { null } ?: "Untitled job", jobMeta(e.row, codex.runs, now), onClick = { hub.openJob.value = e.row.key; onJob() },
            trailing = { Badge(e.state.label, if (e.state == JobState.Failed) BadgeTone.Failed else if (e.state == JobState.Running) BadgeTone.Running else BadgeTone.Waiting) },
        )
    }

    Column(Modifier.fillMaxSize()) {
        PageHeader("Runs", onBack) { IconBtn("add", "New goal", { hub.goalSheet.value = GoalSheet.Start() }) }
        if (bands.needs.isEmpty() && bands.running.isEmpty() && bands.finished.isEmpty()) {
            EmptyState("Loops, goals and scheduled jobs you start show here", icon = "sync", action = { Button("New goal", { hub.goalSheet.value = GoalSheet.Start() }, size = ButtonSize.Sm) })
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

// Shows the chat of a run, and the report of one round when given; false when it cannot be opened.
suspend fun Hub.openRun(run: ChatRun, report: String?): Boolean {
    report?.let { showTurn.value = it }
    return openChatOf(run.chatId, run.sessionId)
}

suspend fun Hub.openChatOf(chatId: String, sessionId: String): Boolean {
    if (store.state.value.live.any { it.id == chatId }) { open(chatId); return true }
    return openSaved(sessionId)
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
                    Text((c.edits?.let { "+${it.add} -${it.del}" } ?: "No edits") + " · " + money(c.cost, billing(run.provider)), style = Type.footnote, color = av.fgMuted)
                    if (!c.archived) Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        Button("Open", { onOpen(t) }, size = ButtonSize.Sm)
                        Button("Keep try ${t.n}", { keep = t.n }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
                    }
                }
            }
        }
    }
}
