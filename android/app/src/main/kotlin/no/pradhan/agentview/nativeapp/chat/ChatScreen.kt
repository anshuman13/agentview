package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import no.pradhan.agentview.nativeapp.codex.autopilot.LoopCard
import no.pradhan.agentview.nativeapp.codex.autopilot.ReviewCard
import no.pradhan.agentview.nativeapp.codex.autopilot.activeRun
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.archive
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.closeChat
import no.pradhan.agentview.nativeapp.net.forkChat
import no.pradhan.agentview.nativeapp.net.gitStatus
import no.pradhan.agentview.nativeapp.net.pulls
import no.pradhan.agentview.nativeapp.net.remindChat
import no.pradhan.agentview.nativeapp.net.rename
import no.pradhan.agentview.nativeapp.net.setShowWork
import no.pradhan.agentview.nativeapp.net.submit
import no.pradhan.agentview.nativeapp.net.unbilledText
import no.pradhan.agentview.nativeapp.ops.AgentList
import no.pradhan.agentview.nativeapp.ops.PullsScreen
import no.pradhan.agentview.nativeapp.ops.agentBadge
import no.pradhan.agentview.nativeapp.sessions.renameTitle
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
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
import no.pradhan.agentview.nativeapp.workspace.branchPr
import no.pradhan.agentview.nativeapp.workspace.checkDot
import no.pradhan.agentview.nativeapp.workspace.prStripMeta
import no.pradhan.agentview.nativeapp.ui.rememberLoad

fun costLabel(cost: Double, billing: String = "usd") = unbilledText(billing) ?: if (cost > 0) "$" + String.format(java.util.Locale.US, "%.2f", cost) else ""

class ChatPanels {
    var agents by mutableStateOf(false)
    var servers by mutableStateOf(false)
    var images by mutableStateOf(false)
    var todos by mutableStateOf(false)
    var remind by mutableStateOf(false)
    var memory by mutableStateOf(false)
    var hooks by mutableStateOf(false)
    var tools by mutableStateOf(false)
    var dialog by mutableStateOf<String?>(null)
}

@Composable
fun ChatScreen(hub: Hub, onOpenAgent: (String) -> Unit) {
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
        ChatHeader(hub, live, session, view, panels, left.isNotEmpty(), running, cwd) { review = 0 }
        prLoad.data?.let { pr ->
            ListRow(pr.title, prStripMeta(pr), leading = { StatusDot(checkDot(pr.checks)) }, trailing = { AvIcon("chevron-right", tint = av.fgMuted) }, lines = 1, onClick = { prOpen = pr.number })
            Hairline()
        }
        if (!connected && hasEvents) Text("Offline. Showing the saved transcript.", Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), style = Type.footnote, color = av.fgMuted)
        SelectionContainer(Modifier.weight(1f).fillMaxWidth()) {
            Transcript(hub, view, earlier, settled, live.id, cwd, running, onOpenAgent, Modifier.fillMaxSize(), remember(queued, live.id) { queued.filter { it.chat == live.id } })
        }
        PendingList(pending, session?.permissionMode ?: "default", hub)
        if (live.stalled) Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.End) {
            Button("Resume", { hub.submit("continue", false) {} }, variant = ButtonVariant.Tinted, icon = "debug-continue")
        }
        visibleChecklist(view.checklist, running)?.let { ChecklistCard(it, live.id, pending.isNotEmpty()) }
        run?.let { if (it.kind == "job" && it.review == "pending") ReviewCard(hub, it) else LoopCard(hub, it, live, session?.loop?.phase, pending.isNotEmpty(), onOpenAgent) { panels.agents = true } }
        Composer(hub, live.id, session, running, pending.isNotEmpty(), run)
    }
    ChatSheets(hub, live, session, view, panels, cwd, onOpenAgent)
}

@Composable
private fun rememberShownChat(hub: Hub, hasEvents: Boolean): LiveChat? {
    val shown by hub.store.state.select { st -> st.live.firstOrNull { it.id == st.shownId } }
    val shownId by hub.store.state.select { it.shownId }
    val connected by hub.connected.collectAsState()
    val cached = shownId.isNotEmpty() && hasEvents
    return shown ?: if (cached && !connected) LiveChat(shownId, remember(shownId) { hub.savedTitle(shownId) }) else null
}

@Composable
private fun ChatHeader(hub: Hub, live: LiveChat, session: SessionInfo?, view: ChatView, panels: ChatPanels, canReview: Boolean, running: Boolean, cwd: String, onReview: () -> Unit) {
    val agents = view.agents
    PageHeader(
        live.title.ifBlank { "Untitled" },
        subtitle = { ChatSubtitle(live, session, view.cost) },
    ) {
        if (agents.isNotEmpty()) {
            val (count, anyRunning) = agentBadge(agents)
            BadgedBox(badge = { Badge("$count", if (anyRunning) BadgeTone.Running else BadgeTone.Quiet) }) { IconBtn("hubot", "Agents", { panels.agents = true }) }
        }
        ChatMenu(hub, live, session, view, panels, canReview, running, cwd, onReview)
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
private fun ChatMenu(hub: Hub, live: LiveChat, session: SessionInfo?, view: ChatView, panels: ChatPanels, canReview: Boolean, running: Boolean, cwd: String, onReview: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val sessionId = live.sessionId ?: session?.sessionId
    val showWork by hub.showWork.collectAsState()
    MoreButton { close ->
        MenuItem(reviewLabel(false, canReview), "source-control", { close(); onReview() }, enabled = canReview)
        MenuItem("Rename", "edit", { close(); panels.dialog = "rename" }, enabled = sessionId != null)
        MenuItem("Fork chat", "repo-forked", { close(); hub.forkChat(cwd, sessionId!!, session?.model, session?.provider) }, enabled = sessionId != null)
        MenuItem("Remind me", "bell", { close(); panels.remind = true }, enabled = sessionId != null)
        MenuItem("Share chat", "share", {
            close()
            val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, chatMarkdown(live.title, hub.store.state.value.events))
            context.startActivity(android.content.Intent.createChooser(send, null))
        }, enabled = view.items.any { it is Item.Assistant })
        MenuItem("Tools\u2026", "tools", { close(); panels.tools = true })
        MenuItem("Show work", "list-tree", { close(); hub.setShowWork(!showWork) }, checked = showWork)
        MenuItem("Close chat", "close", { close(); if (running || live.pending > 0) panels.dialog = "close" else hub.closeChat(live.id) })
        MenuSeparator()
        MenuItem("Archive", "archive", { close(); panels.dialog = "archive" }, danger = true, enabled = sessionId != null)
    }
}

@Composable
private fun ChatSheets(hub: Hub, live: LiveChat, session: SessionInfo?, view: ChatView, panels: ChatPanels, cwd: String, onOpenAgent: (String) -> Unit) {
    val clip = LocalClipboardManager.current
    val sessionId = live.sessionId ?: session?.sessionId
    val agents = view.agents
    val now = rememberNow(panels.agents && agents.any { it.status == "running" })
    if (panels.agents) Sheet(onDismiss = { panels.agents = false }, title = "Agents", padded = false, full = false) {
        AgentList(agents, { now.value }) { panels.agents = false; onOpenAgent(it) }
    }
    if (panels.tools) Sheet(onDismiss = { panels.tools = false }, title = "Tools", padded = false, full = false) {
        val hooks = session?.hooks.orEmpty()
        val open = { panel: () -> Unit -> { panels.tools = false; panel() } }
        Group {
            ListRow("Images", "${view.images.size} ${if (view.images.size == 1) "image" else "images"}", muted = view.images.isEmpty(), onClick = if (view.images.isEmpty()) null else open { panels.images = true }, trailing = { Chevron() })
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
    if (panels.images) ImagesSheet(hub, live.id, view.images, cwd) { panels.images = false }
    if (panels.servers) DevServersSheet(hub) { panels.servers = false }
    if (panels.todos) TodosSheet(hub, cwd) { panels.todos = false }
    if (panels.memory) MemorySheet(hub, cwd, session?.instructionFiles.orEmpty()) { panels.memory = false }
    if (panels.hooks) HooksSheet(hub, session?.hooks.orEmpty()) { panels.hooks = false }
    if (panels.remind) Sheet(onDismiss = { panels.remind = false }, title = "Remind me", padded = false, full = false) {
        val choices = remember { remindChoices(System.currentTimeMillis()) }
        Group { choices.forEachIndexed { i, (label, at) -> if (i > 0) Hairline(); ListRow(label, lines = 1, onClick = { hub.remindChat(live.title, sessionId!!, cwd, at); panels.remind = false }) } }
    }
    when (panels.dialog) {
        "rename" -> RenameDialog(live.title, onSave = { hub.rename(sessionId!!, it) }, onDismiss = { panels.dialog = null })
        "archive" -> ConfirmDialog("Archive this chat?", "${live.title}\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(sessionId!!) }) { panels.dialog = null }
        "close" -> ConfirmDialog("Close this chat?", "The agent is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(live.id) }) { panels.dialog = null }
    }
}

@Composable
fun RenameDialog(current: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    TextDialog("Rename chat", current, "Save", { t -> renameTitle(t, current)?.let(onSave) }, onDismiss, maxLength = 120)
}
