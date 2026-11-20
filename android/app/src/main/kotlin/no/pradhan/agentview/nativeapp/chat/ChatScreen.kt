package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet
import no.pradhan.agentview.nativeapp.codex.autopilot.loopNow
import no.pradhan.agentview.nativeapp.codex.autopilot.runDetail
import no.pradhan.agentview.nativeapp.codex.autopilot.RunActions
import no.pradhan.agentview.nativeapp.codex.autopilot.RunRows
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.codex.autopilot.ReviewCard
import no.pradhan.agentview.nativeapp.codex.autopilot.activeRun
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.sendAt
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.app.archive
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.closeChat
import no.pradhan.agentview.nativeapp.app.forkChat
import no.pradhan.agentview.nativeapp.app.gitStatus
import no.pradhan.agentview.nativeapp.app.pulls
import no.pradhan.agentview.nativeapp.app.remindChat
import no.pradhan.agentview.nativeapp.app.rememberFromChat
import no.pradhan.agentview.nativeapp.app.rename
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.app.stopTask
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.ui.IconBtn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import no.pradhan.agentview.nativeapp.net.unbilledText
import no.pradhan.agentview.nativeapp.ops.AgentList
import no.pradhan.agentview.nativeapp.ops.PullsScreen
import no.pradhan.agentview.nativeapp.sessions.chatPlace
import no.pradhan.agentview.nativeapp.sessions.renameTitle
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.FilePath
import no.pradhan.agentview.nativeapp.ui.LocalOpenFile
import no.pradhan.agentview.nativeapp.ui.LocalRunCommand
import no.pradhan.agentview.nativeapp.app.runInTerminal
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.workspace.FileScreen
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.rememberNow
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.ChangesPager
import no.pradhan.agentview.nativeapp.workspace.DevServersSheet
import no.pradhan.agentview.nativeapp.ops.branchPr
import no.pradhan.agentview.nativeapp.ops.checkDot
import no.pradhan.agentview.nativeapp.ops.prStripMeta
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.ui.plural

fun costLabel(cost: Double, billing: String = "usd") = unbilledText(billing) ?: if (cost > 0) money(cost) else ""

class ChatPanels {
    var agents by mutableStateOf(false)
    var servers by mutableStateOf(false)
    var images by mutableStateOf(false)
    var todos by mutableStateOf(false)
    var remind by mutableStateOf(false)
    var memory by mutableStateOf(false)
    var hooks by mutableStateOf(false)
    var saved by mutableStateOf(false)
    var tools by mutableStateOf(false)
    var find by mutableStateOf(false)
    var file by mutableStateOf<FilePath?>(null)
    var dialog by mutableStateOf<String?>(null)
}

@Composable
fun ChatScreen(hub: Hub, onOpenAgent: (String) -> Unit, onOpenWork: (String) -> Unit) {
    val store = hub.store.state
    val shownId by store.select { it.shownId }
    val session by store.select { it.session }
    val pending by store.select { it.pending }
    val run by store.select { st -> activeRun(st.runs, st.shownId) }
    val earlier by store.select { it.earlier }
    val settled by store.select { it.settled }
    val hasEvents by store.select { it.events.isNotEmpty() }
    val feed by hub.transcript.view.collectAsState()
    val view = if (feed.chat == shownId) feed else ChatView.EMPTY
    val connected by hub.connected.collectAsState()
    val queued by hub.outbox.items.collectAsState()
    val live = rememberShownChat(hub, hasEvents)
    if (live == null) {
        Column(Modifier.fillMaxSize()) {
            PageHeader("Chat")
            EmptyState("No chat open", "Open a chat from Sessions")
        }
        return
    }
    val panels = remember { ChatPanels() }
    val findRequest = hub.findRequest.collectAsState().value?.takeIf { settled && view.events.isNotEmpty() && it.sessionId == live.sessionId }
    LaunchedEffect(findRequest) { if (findRequest != null) panels.find = true }
    val buildSheets = remember(live.id) { OpenBuildSheets() }
    val running = session?.running ?: live.running
    val cwd = session?.cwd ?: live.cwd
    val edits = remember(view.changed, cwd) { view.changed.map { relPath(it, cwd) }.filter { !it.startsWith("/") } }
    val changed = remember(edits) { edits.distinct() }
    var review by rememberSaveable(live.id) { mutableStateOf<Int?>(null) }
    var reviewed by rememberSaveable(live.id) { mutableStateOf(listOf<String>()) }
    // "path\tedits": a reverted file stays hidden until the agent edits it again.
    var reverted by rememberSaveable(live.id) { mutableStateOf(listOf<String>()) }
    val left = remember(changed, reverted) { changed.filter { p -> "$p\t${edits.count { it == p }}" !in reverted } }
    review?.let { start ->
        ChangesPager(hub, left, start, reviewed.toSet(), { reviewed = reviewed + it }, { p -> reverted = reverted + "$p\t${edits.count { it == p }}" }, onBack = { review = null })
        return
    }
    val (prLoad) = rememberLoad(live.id, cwd) { branchPr(hub.pulls(false), hub.gitStatus().branch) }
    var prOpen by rememberSaveable(live.id) { mutableStateOf<Int?>(null) }
    prOpen?.let { PullsScreen(hub, onBack = { prOpen = null }, initial = it); return }

    Column(Modifier.fillMaxSize()) {
        ChatHeader(hub, live, session, view.cost, view.items.any { it is Item.Assistant }, panels, left.isNotEmpty(), running, cwd) { review = 0 }
        ChatStatus(live, session, view.cost, if (view.agents.isNotEmpty() || run != null) agentChipCount(view.agents.size, live.agentList.size) else null) { panels.agents = true }
        Hairline()
        if (panels.find) {
            BackHandler { panels.find = false }
            FindBar(hub, view.events, earlier, findRequest) { panels.find = false }
        }
        prLoad.data?.let { pr ->
            ListRow(pr.title, prStripMeta(pr), leading = { StatusDot(checkDot(pr.checks)) }, trailing = { AvIcon("chevron-right", tint = av.fgMuted) }, onClick = { prOpen = pr.number })
            Hairline()
        }
        if (!connected && hasEvents) Text("Offline. Showing the saved transcript.", Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), style = Type.footnote, color = av.fgMuted)
        SelectionContainer(Modifier.weight(1f).fillMaxWidth()) {
            val openFile = remember(panels) { { path: String, line: Int? -> panels.file = FilePath(path, line) } }
            val runCommand = remember(hub) { if (hub.readOnly) null else { cmd: String -> hub.runInTerminal(cmd, enter = false); Unit } }
            CompositionLocalProvider(LocalBuildSheets provides buildSheets, LocalOpenFile provides openFile, LocalRunCommand provides runCommand) {
                val failed = if (live.failed && !running && !hub.readOnly) failedLine(view.events, providerLabel(live.provider)) else null
                Transcript(hub, view, earlier, settled, live.id, cwd, running, panels.find, onOpenAgent, onOpenWork, Modifier.fillMaxSize(), remember(queued, live.id) { queued.filter { it.chat == live.id } }, failed)
            }
        }
        PendingList(pending, session?.permissionMode ?: "default", hub)
        if (live.stalled) Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.End) {
            Button("Resume", { hub.submit("continue", false) {} }, variant = ButtonVariant.Tinted, icon = "debug-continue")
        }
        val resume = remember(view.events) { limitResume(view.events) }
        if (resume != null && !running && run == null && !hub.readOnly) Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.End) {
            Button("Continue at ${clock(resume.reset)}", { hub.sendAt(clock(resume.reset), resume.prompt) {} }, variant = ButtonVariant.Tinted, icon = "clock")
        }
        run?.let { if (it.kind == "job" && it.review == "pending") ReviewCard(hub, it) }
        Composer(hub, live.id, live.sessionId, session, running, pending.isNotEmpty(), run)
    }
    ChatSheets(hub, live, session, view.agents, view.images, panels, cwd, onOpenAgent, run)
    BuildSheetsHost(hub, live.id, buildSheets)
}

@Composable
private fun rememberShownChat(hub: Hub, hasEvents: Boolean): LiveChat? {
    val shown by hub.store.state.select { st -> st.live.firstOrNull { it.id == st.shownId } }
    val shownId by hub.store.state.select { it.shownId }
    val connected by hub.connected.collectAsState()
    val cached = shownId.isNotEmpty() && hasEvents
    return shown ?: if (cached && !connected) LiveChat(shownId, remember(shownId) { hub.savedTitle(shownId) }) else null
}

// Takes the fields it shows, not the ChatView, so a streamed token batch does not redraw the header.
@Composable
private fun ChatHeader(hub: Hub, live: LiveChat, session: SessionInfo?, cost: Double, hasReply: Boolean, panels: ChatPanels, canReview: Boolean, running: Boolean, cwd: String, onReview: () -> Unit) {
    val ws by hub.workspace.collectAsState()
    PageHeader(
        live.title.ifBlank { UNTITLED },
        subtitle = { Text(chatPlace(ws, cwd), style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) },
    ) {
        ChatMenu(hub, live, session, hasReply, panels, canReview, running, cwd, onReview)
    }
}

// One line under the title: what the chat is doing, and on the right the agents and run controls it opens.
@Composable
private fun ChatStatus(live: LiveChat, session: SessionInfo?, viewCost: Double, agents: Int?, onAgents: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = Tokens.listPad, end = Tokens.sp2, bottom = Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f, fill = false)) { ChatSubtitle(live, session, viewCost) }
        if (agents != null) Row(Modifier.heightIn(min = Tokens.touchSm).clickable(onClick = onAgents).padding(start = Tokens.sp4, end = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            Text(if (agents > 0) plural(agents, "agent") else "Run", style = Type.footnote, color = av.fgMuted, maxLines = 1)
            AvIcon("chevron-right", null, Tokens.iconSm, tint = av.fgMuted)
        }
    }
}

@Composable
private fun ChatSubtitle(live: LiveChat, session: SessionInfo?, viewCost: Double) {
    val status = statusLine(live, session)
    val cost = live.cost ?: viewCost
    val toneColor = when (status.tone) { ChatTone.Running -> av.agent; ChatTone.Needs -> av.warn; ChatTone.Failed -> av.err; ChatTone.Warn -> av.warn; ChatTone.Idle -> av.fgMuted }
    val muted = av.fgMuted
    val usage = session?.usage
    val warn = av.warn
    val line = remember(status, cost, toneColor, muted, usage) {
        buildAnnotatedString {
            withStyle(SpanStyle(color = toneColor)) { append(status.text) }
            costLabel(cost, billing(live.provider)).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = muted)) { append(" · $it") } }
            usageText(usage).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = if (usageHigh(usage)) warn else muted)) { append(" · $it") } }
        }
    }
    WordClamp(line, Type.subheadline, muted, 1)
}

@Composable
private fun ChatMenu(hub: Hub, live: LiveChat, session: SessionInfo?, hasReply: Boolean, panels: ChatPanels, canReview: Boolean, running: Boolean, cwd: String, onReview: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val clip = LocalClipboardManager.current
    val sessionId = live.sessionId ?: session?.sessionId
    MoreButton { close ->
        MenuItem(reviewLabel(false, canReview), "source-control", { close(); onReview() }, enabled = canReview)
        MenuItem("Find in chat", "search", { close(); panels.find = true })
        MenuItem("Rename", "edit", { close(); panels.dialog = "rename" }, enabled = sessionId != null)
        MenuItem("Fork chat", "repo-forked", { close(); hub.forkChat(cwd, sessionId!!, session?.model, session?.provider) }, enabled = sessionId != null)
        MenuItem("Remind me", "bell", { close(); panels.remind = true }, enabled = sessionId != null)
        MenuItem("Remember…", "lightbulb", { close(); panels.dialog = "remember" })
        MenuItem("Share chat", "share", {
            close()
            val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, chatMarkdown(live.title, hub.store.state.value.events))
            context.startActivity(android.content.Intent.createChooser(send, null))
        }, enabled = hasReply)
        MenuItem("Copy last reply", "copy", {
            close()
            lastReply(hub.store.state.value.events)?.let { clip.setText(AnnotatedString(it)); hub.notice.value = "Reply copied" }
        }, enabled = hasReply)
        MenuItem("Tools\u2026", "tools", { close(); panels.tools = true })
        MenuItem("Close chat", "close", { close(); if (running || live.pending > 0) panels.dialog = "close" else hub.closeChat(live.id) })
        MenuSeparator()
        MenuItem("Archive", "archive", { close(); panels.dialog = "archive" }, danger = true, enabled = sessionId != null)
    }
}

@Composable
private fun ChatSheets(hub: Hub, live: LiveChat, session: SessionInfo?, agents: List<Agent>, images: List<String>, panels: ChatPanels, cwd: String, onOpenAgent: (String) -> Unit, run: ChatRun?) {
    val clip = LocalClipboardManager.current
    val sessionId = live.sessionId ?: session?.sessionId
    val now = rememberNow(panels.agents && agents.any { it.status == "running" })
    val prompts by hub.savedPrompts.items.collectAsState()
    if (panels.agents) Sheet(onDismiss = { panels.agents = false }, title = "Agents", padded = false, full = false, action = { AgentsActions(hub, run, agents) }) {
        run?.let { r ->
            val line = listOfNotNull(runLine(r), loopNow(r, live.now).next?.let { "next $it" }).joinToString(" · ")
            Text(line, Modifier.fillMaxWidth().then(if (runDetail(r).opens) Modifier.heightIn(min = Tokens.touchSm).clickable { hub.shell.goalSheet.value = GoalSheet.Detail(r.id) } else Modifier).padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), style = Type.footnote, color = av.fgMuted)
            RunRows(hub, r, live)
        }
        AgentList(agents, { now.value }) { panels.agents = false; onOpenAgent(it) }
    }
    if (panels.tools) Sheet(onDismiss = { panels.tools = false }, title = "Tools", padded = false, full = false) {
        val hooks = session?.hooks.orEmpty()
        val open = { panel: () -> Unit -> { panels.tools = false; panel() } }
        Group {
            ListRow("Saved prompts", plural(prompts.size, "prompt"), muted = prompts.isEmpty(), onClick = if (prompts.isEmpty()) null else open { panels.saved = true }, trailing = { Chevron() })
            Hairline()
            ListRow("Images", plural(images.size, "image"), muted = images.isEmpty(), onClick = if (images.isEmpty()) null else open { panels.images = true }, trailing = { Chevron() })
            Hairline()
            ListRow("Dev servers", "Dev servers on this Mac", onClick = open { panels.servers = true }, trailing = { Chevron() })
            Hairline()
            ListRow("TODOs", "TODO, FIXME and AI! comments in the repo", onClick = open { panels.todos = true }, trailing = { Chevron() })
            Hairline()
            ListRow("Memory", "Instruction and memory files", onClick = open { panels.memory = true }, trailing = { Chevron() })
            Hairline()
            ListRow("Hooks", if (hooks.isEmpty()) "None" else "${hooks.size}", onClick = open { panels.hooks = true }, trailing = { Chevron() })
            session?.resumeCommand?.let { command ->
                Hairline()
                ListRow("Continue in terminal", "Copy the command that resumes this chat", onClick = open {
                    clip.setText(AnnotatedString(command))
                    hub.notice.value = "Copied. Stop this chat before resuming it in a terminal"
                }, trailing = { Chevron() })
            }
        }
    }
    if (panels.saved) SavedPromptsSheet(hub, prompts, live.id) { panels.saved = false }
    if (panels.images) ImagesSheet(hub, live.id, images, cwd) { panels.images = false }
    if (panels.servers) DevServersSheet(hub) { panels.servers = false }
    if (panels.todos) TodosSheet(hub, cwd) { panels.todos = false }
    if (panels.memory) MemorySheet(hub, cwd, session?.instructionFiles.orEmpty()) { panels.memory = false }
    if (panels.hooks) HooksSheet(hub, session?.hooks.orEmpty()) { panels.hooks = false }
    panels.file?.let { f ->
        val close = { panels.file = null }
        Sheet(close, "File", padded = false) { Box(Modifier.height(sheetHeight())) { FileScreen(hub, f.path, close, line = f.line) } }
    }
    if (panels.remind) Sheet(onDismiss = { panels.remind = false }, title = "Remind me", padded = false, full = false) {
        val choices = remember { remindChoices(System.currentTimeMillis()) }
        Group { choices.forEachIndexed { i, (label, at) -> if (i > 0) Hairline(); ListRow(label, onClick = { hub.remindChat(live.title, sessionId!!, cwd, at); panels.remind = false }) } }
    }
    when (panels.dialog) {
        "rename" -> RenameDialog(live.title, onSave = { hub.rename(sessionId!!, it) }, onDismiss = { panels.dialog = null })
        "remember" -> TextDialog("Remember", "", "Save", { hub.rememberFromChat(it, live.title, cwd) }, { panels.dialog = null }, maxLength = 400, detail = "Saved to Memory for every later chat.")
        "archive" -> ConfirmDialog("Archive this chat?", "${live.title}\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(sessionId!!) }) { panels.dialog = null }
        "close" -> ConfirmDialog("Close this chat?", "${live.title}\n\nThe agent is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(live.id) }) { panels.dialog = null }
    }
}

@Composable
fun RenameDialog(current: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    TextDialog("Rename chat", current, "Save", { t -> renameTitle(t, current)?.let(onSave) }, onDismiss, maxLength = 120)
}

// The Agents sheet's head: the run's controls, else stop every running agent.
@Composable
private fun AgentsActions(hub: Hub, run: ChatRun?, agents: List<Agent>) {
    val running = agents.filter { it.status == "running" && it.group == null }
    if (run != null) RunActions(hub, run)
    else if (running.isNotEmpty()) IconBtn("debug-stop", "Stop all agents", { running.forEach { hub.stopTask(it.id) } }, enabled = !hub.readOnly)
}
