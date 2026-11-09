package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.BadgedBox
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.delay

data class StatusLine(val text: String, val tone: Tone2)
enum class Tone2 { Running, Needs, Failed, Idle }

fun statusLine(live: LiveChat, session: SessionInfo?): StatusLine = when {
    live.pending > 0 -> StatusLine("Needs you", Tone2.Needs)
    live.failed -> StatusLine("Failed", Tone2.Failed)
    live.stalled -> StatusLine("No activity for 15 min", Tone2.Failed)
    (session?.running ?: live.running) -> StatusLine(live.status.ifBlank { "Working" }, Tone2.Running)
    else -> StatusLine("Idle", Tone2.Idle)
}

fun costLabel(cost: Double) = if (cost > 0) "$" + String.format(java.util.Locale.US, "%.2f", cost) else ""

@Composable
fun ChatScreen(hub: Hub, onOpenAgent: (String) -> Unit) {
    val store = hub.store.state
    val liveChats by store.select { it.live }
    val shownId by store.select { it.shownId }
    val session by store.select { it.session }
    val pending by store.select { it.pending }
    val runs by store.select { it.runs }
    val earlier by store.select { it.earlier }
    val settled by store.select { it.settled }
    val hasEvents by store.select { it.events.isNotEmpty() }
    val feed by hub.transcript.view.collectAsState()
    val view = if (feed.chat == shownId) feed else ChatView.EMPTY
    val connected by hub.connected.collectAsState()
    val queued by hub.outbox.items.collectAsState()
    val cached = shownId.isNotEmpty() && hasEvents
    val live = liveChats.firstOrNull { it.id == shownId } ?: if (cached && !connected) LiveChat(shownId, remember(shownId) { hub.savedTitle(shownId) }) else null
    if (live == null) {
        Column(Modifier.fillMaxSize()) {
            PageHeader("Chat")
            EmptyState("No chat open", "Open a chat from Sessions")
        }
        return
    }
    val context = androidx.compose.ui.platform.LocalContext.current
    val running = session?.running ?: live.running
    val cost = live.cost ?: view.cost
    var dialog by remember { mutableStateOf<String?>(null) }
    val agents = view.agents
    var agentsOpen by remember { mutableStateOf(false) }
    var serversOpen by remember { mutableStateOf(false) }
    var imagesOpen by remember { mutableStateOf(false) }
    var todosOpen by remember { mutableStateOf(false) }
    var remindOpen by remember { mutableStateOf(false) }
    var memoryOpen by remember { mutableStateOf(false) }
    val images = view.images
    val now = rememberNow(agentsOpen && agents.any { it.status == "running" })
    val status = statusLine(live, session)
    val cwd = session?.cwd ?: live.cwd
    val changed = remember(view.changed, cwd) { view.changed.map { relPath(it, cwd) }.filter { !it.startsWith("/") }.distinct() }
    var review by rememberSaveable(live.id) { mutableStateOf<Int?>(null) }
    var reviewed by rememberSaveable(live.id) { mutableStateOf(listOf<String>()) }
    var reverted by rememberSaveable(live.id) { mutableStateOf(listOf<String>()) }
    val left = changed - reverted.toSet()
    review?.let { start ->
        ChangesPager(hub, left, start, reviewed.toSet(), { reviewed = reviewed + it }, { reverted = reverted + it }, onBack = { review = null })
        return
    }
    val sessionId = live.sessionId ?: session?.sessionId
    val clip = LocalClipboardManager.current
    val (prLoad) = rememberLoad(live.id, cwd) { branchPr(parsePulls(hub.read("/api/gh/prs")), parseGitStatus(hub.read("/api/git/status")).branch) }
    var prOpen by rememberSaveable(live.id) { mutableStateOf<Int?>(null) }
    prOpen?.let { PullsScreen(hub, onBack = { prOpen = null }, initial = it); return }

    Column(Modifier.fillMaxSize()) {
        PageHeader(
            live.title.ifBlank { "Untitled" },
            subtitle = {
                val toneColor = when (status.tone) { Tone2.Running -> av.agent; Tone2.Needs -> av.warn; Tone2.Failed -> av.err; Tone2.Idle -> av.fgMuted }
                val muted = av.fgMuted
                val usage = session?.usage
                val warn = av.warn
                val line = remember(status, cost, toneColor, muted, usage) {
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = toneColor)) { append(status.text) }
                        costLabel(cost).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = muted)) { append(" · $it") } }
                        usageText(usage).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = if (usageHigh(usage)) warn else muted)) { append(" · $it") } }
                    }
                }
                WordClamp(line, Type.subheadline, muted, 1)
            },
        ) {
            if (agents.isNotEmpty()) {
                val (count, anyRunning) = agentBadge(agents)
                BadgedBox(badge = { Badge("$count", if (anyRunning) BadgeTone.Running else BadgeTone.Quiet) }) { IconBtn("hubot", "Agents", { agentsOpen = true }) }
            }
            MoreButton { close ->
                MenuItem("Review changes", "source-control", { close(); review = 0 }, enabled = left.isNotEmpty())
                MenuItem("Images", "file-media", { close(); imagesOpen = true }, enabled = images.isNotEmpty())
                MenuItem("Dev servers", "globe", { close(); serversOpen = true })
                MenuItem("TODOs", "checklist", { close(); todosOpen = true })
                MenuItem("Memory", "book", { close(); memoryOpen = true })
                MenuItem("Share chat", "share", {
                    close()
                    val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, chatMarkdown(live.title, store.value.events))
                    context.startActivity(android.content.Intent.createChooser(send, null))
                }, enabled = view.items.any { it is Item.Assistant })
                MenuItem("Continue in terminal", "terminal", {
                    close()
                    clip.setText(AnnotatedString(resumeCommand(cwd, sessionId!!, session?.account)))
                    hub.notice.value = "Copied. Stop this chat before resuming it in a terminal"
                }, enabled = sessionId != null)
                MenuItem("Remind me", "bell", { close(); remindOpen = true }, enabled = sessionId != null)
                MenuItem("Fork chat", "repo-forked", { close(); hub.forkChat(cwd, sessionId!!, session?.model) }, enabled = sessionId != null)
                MenuItem("Rename", "edit", { close(); dialog = "rename" }, enabled = sessionId != null)
                MenuItem("Close chat", "close", { close(); if (running || live.pending > 0) dialog = "close" else hub.closeChat(live.id) })
                MenuSeparator()
                MenuItem("Archive", "archive", { close(); dialog = "archive" }, danger = true, enabled = sessionId != null)
            }
        }
        prLoad.data?.let { pr ->
            ListRow(pr.title, prStripMeta(pr), leading = { StatusDot(checkDot(pr.checks)) }, trailing = { AvIcon("chevron-right", tint = av.fgMuted) }, lines = 1, onClick = { prOpen = pr.number })
            Hairline()
        }
        if (!connected && hasEvents) Text("Offline. Showing the saved transcript.", Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), style = Type.footnote, color = av.fgMuted)
        SelectionContainer(Modifier.weight(1f).fillMaxWidth()) {
            Transcript(hub, view, earlier, settled, live.id, cwd, running, onOpenAgent, Modifier.fillMaxSize(), queued.filter { it.chat == live.id })
        }
        PendingList(pending, session?.permissionMode ?: "default", hub)
        if (live.stalled) Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.End) {
            Button("Resume", { hub.submit("continue", false) {} }, variant = ButtonVariant.Tinted, icon = "debug-continue")
        }
        runs.lastOrNull { it.chatId == live.id && it.state != "done" }?.let { LoopCard(hub, it, session?.loop?.phase) }
        Composer(hub, live.id, session, running, pending.isNotEmpty(), runs.lastOrNull { it.chatId == live.id && it.state != "done" })
    }

    if (agentsOpen) Sheet(onDismiss = { agentsOpen = false }, title = "Agents", padded = false, full = false) {
        AgentList(agents, { now.value }) { agentsOpen = false; onOpenAgent(it) }
    }

    if (imagesOpen) ImagesSheet(hub, live.id, images, cwd) { imagesOpen = false }
    if (serversOpen) DevServersSheet(hub) { serversOpen = false }
    if (todosOpen) TodosSheet(hub, cwd) { todosOpen = false }
    if (memoryOpen) MemorySheet(hub, cwd) { memoryOpen = false }
    if (remindOpen) Sheet(onDismiss = { remindOpen = false }, title = "Remind me", padded = false, full = false) {
        val choices = remember { remindChoices(System.currentTimeMillis()) }
        Group { choices.forEachIndexed { i, (label, at) -> if (i > 0) Hairline(); ListRow(label, lines = 1, onClick = { hub.remindChat(live.title, sessionId!!, cwd, at); remindOpen = false }) } }
    }

    when (dialog) {
        "rename" -> RenameDialog(live.title, onSave = { hub.rename(sessionId!!, it) }, onDismiss = { dialog = null })
        "archive" -> ConfirmDialog("Archive this chat?", "${live.title}\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(sessionId!!) }) { dialog = null }
        "close" -> ConfirmDialog("Close this chat?", "Claude is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(live.id) }) { dialog = null }
    }
}

@Composable
fun RenameDialog(current: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    TextDialog("Rename chat", current, "Save", { t -> renameTitle(t, current)?.let(onSave) }, onDismiss, maxLength = 120)
}
