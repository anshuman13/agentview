package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.app.runControl
import no.pradhan.agentview.nativeapp.app.triesKeep
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Panel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.app.triesSend
import no.pradhan.agentview.nativeapp.ui.TextField
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions

// The run's head in a chat's Agents sheet (web sessions/brief/RailHead.tsx): Cancel on a scheduled send, else Open board on tries, Pause, and Stop or More with Run now and Stop.
@Composable
fun RunActions(hub: Hub, run: ChatRun) {
    var board by rememberSaveable(run.id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val stopOnly = run.kind == "tries" || run.kind == "job"
    val paused = run.state == "paused"
    if (sendsAt(run) != null) IconBtn("close", "Cancel", { hub.runControl(run, "stop") }, enabled = !hub.readOnly)
    else {
        if (run.kind == "tries") IconBtn("layout", "Open board", { board = true })
        if (!stopOnly) IconBtn(if (paused) "debug-start" else "debug-pause", if (paused) "Resume" else "Pause", { hub.runControl(run, if (paused) "resume" else "pause") }, enabled = !hub.readOnly)
        if (stopOnly) IconBtn("debug-stop", "Stop", { hub.runControl(run, "stop") }, enabled = !hub.readOnly)
        else MoreButton { close ->
            if (!paused) { MenuItem("Run now", "play", { close(); hub.runControl(run, "now") }, enabled = !hub.readOnly); MenuSeparator() }
            MenuItem("Stop", "debug-stop", { close(); hub.runControl(run, "stop") }, danger = true, enabled = !hub.readOnly)
        }
    }
    if (board) {
        val chats by hub.store.state.select { it.live }
        TriesSheet(hub, run, chats, { board = false }, { t -> scope.launch { if (hub.openSaved(t.sessionId)) board = false } })
    }
}

// The run's rows: what is happening now, the plan line on a goal or the what line and cost on other kinds, the cap row, the 5-hour row, the Rounds row that shows the history and the last report.
@Composable
fun RunRows(hub: Hub, run: ChatRun, live: LiveChat) {
    var rounds by rememberSaveable(run.id) { mutableStateOf(false) }
    var all by rememberSaveable(run.id) { mutableStateOf(false) }
    val goal = run.kind == "goal"
    val progress = if (goal) planProgress(hub, planOf(run.what), run.chatId) else null
    val state = loopNow(run, live.now)
    val working = live.running || live.agentList.isNotEmpty()
    val detail = if (runDetail(run).opens) ({ hub.shell.goalSheet.value = GoalSheet.Detail(run.id) }) else null
    Group {
        ListRow(
            state.title, nowMeta(state, buildsLine(run)).ifEmpty { null }, lines = 2, compact = true,
            leading = { StatusDot(if (working) DotState.Running else outcomeDot(run.rounds.lastOrNull()?.outcome ?: "quiet")) },
            onClick = detail,
        )
        if (goal) ListRow(progress?.let { "Plan $it" } ?: run.what, compact = true, stateSlot = false, onClick = detail)
        else ListRow(run.what, money(run.costUsd, billing(run.provider)), compact = true, stateSlot = false, onClick = detail)
        capLine(run)?.let { cap ->
            ListRow(cap.text, lines = 1, compact = true, leading = { AvIcon("dashboard", null, Tokens.iconSm, tint = av.fgMuted) }, state = if (cap.near) ({ Badge("Near cap", BadgeTone.Waiting) }) else null)
        }
        fiveHourLine(run.fiveHour?.content, run.capPct, run.provider).takeIf { it.isNotEmpty() }?.let { line ->
            ListRow(line, lines = 1, compact = true, leading = { AvIcon("watch", null, Tokens.iconSm, tint = av.fgMuted) })
        }
        if ((goal || run.kind == "loop") && run.rounds.isNotEmpty()) {
            ListRow(
                plural(run.round, "round"), "${roundsSummary(run.rounds)} · ${money(run.rounds.sumOf { it.costUsd }, billing(run.provider))}", lines = 1, compact = true,
                trailing = { AvIcon(if (rounds) "chevron-up" else "chevron-down", null, Tokens.iconSm, tint = av.fgMuted) },
                onClick = { rounds = !rounds },
            )
            if (rounds) {
                val groups = mergeQuiet(run.rounds).asReversed()
                (if (all) groups else groups.take(10)).forEach { g -> RoundRow(g, run.provider, compact = true) { hub.showTurn.value = it } }
                if (!all && groups.size > 10) Button("Show all ${groups.size}", { all = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
        }
        run.rounds.lastOrNull { it.report != null }?.let { r -> RoundRow(RoundGroup(r, r, 1, r.costUsd), run.provider, compact = true) { hub.showTurn.value = it } }
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

// Shows the chat of a run, and the report of one round when given; false when it cannot be opened.
suspend fun Hub.openRun(run: ChatRun, report: String?): Boolean {
    report?.let { showTurn.value = it }
    return openChatOf(run.chatId, run.sessionId)
}

suspend fun Hub.openChatOf(chatId: String, sessionId: String): Boolean {
    if (store.state.value.live.any { it.id == chatId }) { open(chatId); return true }
    return openSaved(sessionId)
}

// The tries board as a sheet (web TriesBoard): a card per try with its state, last report, diff size and cost, Open and Keep behind a confirm,
// and a message sent to every open try.
@Composable
private fun TriesSheet(hub: Hub, run: ChatRun, live: List<LiveChat>, onDismiss: () -> Unit, onOpen: (RunTry) -> Unit) {
    var keep by remember { mutableStateOf<Int?>(null) }
    var text by rememberSaveable { mutableStateOf("") }
    val open = run.tries.count { !it.dropped }
    val sendAll = { if (text.isNotBlank()) { hub.triesSend(run, text.trim()); text = "" } }
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
            if (open > 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                TextField(text, { text = it }, Modifier.weight(1f), placeholder = "Message to every open try", singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { sendAll() }))
                Button("Send to all", { sendAll() }, size = ButtonSize.Sm, enabled = text.isNotBlank())
            }
        }
    }
}
