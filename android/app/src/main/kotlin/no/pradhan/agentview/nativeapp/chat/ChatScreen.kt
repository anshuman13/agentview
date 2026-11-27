package no.pradhan.agentview.nativeapp.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.codex.autopilot.ReviewCard
import no.pradhan.agentview.nativeapp.codex.autopilot.activeRun
import no.pradhan.agentview.nativeapp.codex.autopilot.buildHead
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.sessions.rowId
import no.pradhan.agentview.nativeapp.sessions.rowsById
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.gitStatus
import no.pradhan.agentview.nativeapp.app.pulls
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ops.PullsScreen
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.FilePath
import no.pradhan.agentview.nativeapp.ui.LocalOpenFile
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.ChangesPager
import no.pradhan.agentview.nativeapp.ops.branchPr
import no.pradhan.agentview.nativeapp.ops.checkDot
import no.pradhan.agentview.nativeapp.ops.prStripMeta
import no.pradhan.agentview.nativeapp.ui.rememberLoad

class ChatPanels {
    var agents by mutableStateOf(false)
    // The agent open in the Agents sheet; null shows the list.
    var agent by mutableStateOf<String?>(null)
    var memory by mutableStateOf(false)
    var tools by mutableStateOf(false)
    var find by mutableStateOf(false)
    var file by mutableStateOf<FilePath?>(null)
    var dialog by mutableStateOf<String?>(null)

    // The open agent while it is still in the chat; the sheet's back arrow shows only then.
    fun shownAgent(list: List<Agent>): Agent? = agent?.let { id -> list.firstOrNull { it.id == id } }
    fun closeAgents() { agents = false; agent = null }
}

@Composable
fun ChatScreen(hub: Hub, onOpenAgent: (String) -> Unit, onOpenWork: (String) -> Unit, onChats: (() -> Unit)? = null) {
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
    val ws by hub.workspace.collectAsState()
    val root = remember(ws.saved, live.sessionId) { rowsById(ws.saved).rowId(live.sessionId) }
    val request = hub.findRequest.collectAsState().value?.takeIf { settled && view.events.isNotEmpty() && (it.sessionId == live.sessionId || it.sessionId == root) }
    val subFind = request?.takeIf { it.sub != null && it.sub != live.sessionId }
    val findRequest = request?.takeIf { subFind == null }
    LaunchedEffect(findRequest) { if (findRequest != null) panels.find = true }
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
        ChatHeader(hub, live, session, view.cost, panels, left.isNotEmpty(), running, cwd, onChats) { review = 0 }
        ChatStatus(live, session, view.cost, remember(view.events) { lastReplyAt(view.events) }, if (view.agents.isNotEmpty() || live.agentList.isNotEmpty() || run != null) agentChipCount(view.agents.size, live.agentList.size) else null) { panels.agents = true }
        run?.let { r -> buildHead(r)?.let { BuildHead(it, buildHead(r, true) ?: it) } }
        Hairline()
        BuildBar(hub, session?.sessionId, view.events)
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
            CompositionLocalProvider(LocalOpenFile provides openFile) {
                val failed = if (live.failed && !running && !hub.readOnly) failedLine(view.events, providerLabel(live.provider)) else null
                Transcript(hub, view, earlier, settled, live.id, cwd, running, panels.find, onOpenAgent, onOpenWork, Modifier.fillMaxSize(), remember(queued, live.id) { queued.filter { it.chat == live.id } }, failed, live.sessionId, subFind)
            }
        }
        PendingList(pending, session?.permissionMode ?: "default", hub)
        if (live.stalled) Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.End) {
            Button("Resume", { hub.submit("continue", true) {} }, variant = ButtonVariant.Tinted, icon = "debug-continue")
        }
        run?.let { if (it.kind == "job" && it.review == "pending") ReviewCard(hub, it) }
        Composer(hub, live.id, live.sessionId, session, running, pending.isNotEmpty())
    }
    ChatSheets(hub, live, session, view.agents, panels, cwd, onOpenAgent, run)
}

@Composable
private fun rememberShownChat(hub: Hub, hasEvents: Boolean): LiveChat? {
    val shown by hub.store.state.select { st -> st.live.firstOrNull { it.id == st.shownId } }
    val shownId by hub.store.state.select { it.shownId }
    val connected by hub.connected.collectAsState()
    val cached = shownId.isNotEmpty() && hasEvents
    return shown ?: if (cached && !connected) LiveChat(shownId, remember(shownId) { hub.savedTitle(shownId) }) else null
}
