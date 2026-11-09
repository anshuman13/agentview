package no.pradhan.agentview.nativeapp.sessions

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import no.pradhan.agentview.nativeapp.app.icon
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.MessageHit
import no.pradhan.agentview.nativeapp.chat.NewChatSheet
import no.pradhan.agentview.nativeapp.chat.RepoChoice
import no.pradhan.agentview.nativeapp.chat.boldMatches
import no.pradhan.agentview.nativeapp.chat.messageMeta
import no.pradhan.agentview.nativeapp.chat.messageQuery
import no.pradhan.agentview.nativeapp.codex.PERSONAL
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.markRead
import no.pradhan.agentview.nativeapp.net.newChat
import no.pradhan.agentview.nativeapp.net.pin
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.refreshWorkspace
import no.pradhan.agentview.nativeapp.net.setChatSegment
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Fab
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color
import no.pradhan.agentview.nativeapp.ui.lazyGroup
import no.pradhan.agentview.nativeapp.ui.select


@Composable
fun SessionsScreen(hub: Hub, onOpen: () -> Unit) {
    val live by hub.store.state.select { it.live }
    val sessionCwd by hub.store.state.select { it.session?.cwd }
    val ws by hub.workspace.collectAsState()
    val filters = rememberSessionsFilters()
    var newChat by remember { mutableStateOf<RepoChoice?>(null) }
    val dialogs = remember { SessionDialogs() }
    LaunchedEffect(Unit) { hub.refreshWorkspace() }
    val hits = rememberMessageHits(hub, filters.filter)
    val rows = rememberChatRows(hub, dialogs, onOpen)
    val unfiltered = remember(live, ws) { groupByRepo(live, ws) }
    val repo = filters.repoKey?.let { k -> unfiltered.firstOrNull { it.key == k } }

    if (repo != null) RepoSessions(repo, rows, filters) { newChat = it }
    else AllSessions(rows, filters, hits) { newChat = it }

    newChat?.let { choice ->
        val here = sessionCwd?.ifEmpty { null }?.let { c -> folderKey(c, ws.repos, ws.trees) }?.takeIf { k -> unfiltered.any { g -> g.key == k } }
        val choices = unfiltered.filter { g -> g.key == here || g.open.isNotEmpty() || g.recent.isNotEmpty() }.sortedByDescending { g -> g.key == here }
        NewChatSheet(hub, choice.key, choices.map { RepoChoice(it.key, it.name) }, onDismiss = { newChat = null }, initial = here)
    }
    dialogs.Show(hub)
}

private class SessionsFilters(private val text: MutableState<String>, private val statusState: MutableState<StatusFilter>, private val idle: MutableState<Boolean>, private val repo: MutableState<String?>) {
    var filter by text
    var status by statusState
    var showIdle by idle
    var repoKey by repo
    val byStatus get() = status != StatusFilter.All
}

@Composable
private fun rememberSessionsFilters() = SessionsFilters(
    rememberSaveable { mutableStateOf("") },
    rememberSaveable { mutableStateOf(StatusFilter.All) },
    rememberSaveable { mutableStateOf(false) },
    rememberSaveable { mutableStateOf<String?>(null) },
)

@Composable
private fun rememberMessageHits(hub: Hub, filter: String): List<MessageHit> {
    var hits by remember { mutableStateOf(emptyList<MessageHit>()) }
    LaunchedEffect(filter) {
        val q = messageQuery(filter)
        if (q == null) { hits = emptyList(); return@LaunchedEffect }
        delay(400)
        hits = runCatching { protocolJson.decodeFromString<List<MessageHit>>(hub.read("/api/sessions/search?q=${enc(q)}")) }.getOrDefault(emptyList())
    }
    return hits
}

@Composable
private fun ChipRow(content: @Composable () -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) { content() }
}

// Status chips with a count above zero; tapping the chosen one again shows all.
@Composable
private fun StatusChips(of: List<RepoGroup>, rows: ChatRows, filters: SessionsFilters) {
    val status = filters.status
    StatusFilter.entries.filter { it != StatusFilter.All }.forEach { f ->
        val n = statusCount(of, f, rows.saved, rows.seen)
        if (n > 0 || status == f) Chip("${f.label} $n", { filters.status = if (status == f) StatusFilter.All else f }, on = status == f)
    }
    // Slack's mark all read, while the Done chip is on.
    if (status == StatusFilter.Done) {
        val done = of.flatMap { it.items() }.filter { it.state(rows.saved, rows.seen) == ChatState.Done }.mapNotNull { it.live?.sessionId ?: it.saved?.sessionId }
        if (done.isNotEmpty()) Chip("Mark all read", { rows.hub.markRead(done) })
    }
}

@Composable
private fun RepoSessions(repo: RepoGroup, rows: ChatRows, filters: SessionsFilters, onNewChat: (RepoChoice) -> Unit) {
    val status = filters.status
    BackHandler { filters.repoKey = null }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PageHeader(repo.name, onBack = { filters.repoKey = null })
            ChipRow { StatusChips(listOf(repo), rows, filters) }
            val items = repo.items().map { it.copy(repo = null) }.filter { status.matches(it.state(rows.saved, rows.seen)) }
            if (items.isEmpty()) EmptyState(if (filters.byStatus) "No ${status.label.lowercase()} chats in ${repo.name}" else "No chats in ${repo.name} yet", action = { Button("New chat", { onNewChat(RepoChoice(repo.key, repo.name)) }, variant = ButtonVariant.Tinted, icon = "add") })
            else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = Tokens.sp3, bottom = Tokens.fabClear)) {
                lazyGroup(items, { "c-${it.key}" }) { rows.Row(it) }
            }
        }
        Fab("add", "New chat in ${repo.name}", { onNewChat(RepoChoice(repo.key, repo.name)) }, Modifier.align(Alignment.BottomEnd).padding(Tokens.listPad))
    }
}

@Composable
private fun AllSessions(rows: ChatRows, filters: SessionsFilters, hits: List<MessageHit>, onNewChat: (RepoChoice) -> Unit) {
    val hub = rows.hub
    val live = rows.live
    val ws = rows.ws
    val connected by hub.connected.collectAsState()
    val segment by hub.chatSegment.collectAsState()
    val filter = filters.filter
    val all = remember(live, ws, filter) { groupByRepo(live, ws, filter) }
    val groups = remember(all, segment) { all.filter { segmentOf(it.key) == segment } }
    val pinned = remember(live, ws, filter) { pinnedRows(live, ws, filter) }
    val waiting = remember(live) { live.filter { it.pending > 0 }.sortedWith(byUrgency) }
    val waitingForServer = !connected && live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty()
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PageHeader("Sessions") { IconBtn("mic", "Ask by voice", { hub.voiceRequest.tryEmit(Unit) }); IconBtn("refresh", "Refresh", { hub.refreshWorkspace(force = true) }) }
            SearchField(filter, { filters.filter = it }, "Search repos and sessions")
            ChipRow {
                listOf(WORK, PERSONAL).forEach { k ->
                    Chip("${profileLabel(k)} ${all.count { segmentOf(it.key) == k }}", { hub.setChatSegment(k) }, on = segment == k, tone = if (k == WORK) ChipTone.Work else ChipTone.Personal)
                }
                StatusChips(groups, rows, filters)
            }
            when {
                live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty() -> OfflineSessions(rows, waitingForServer)
                groups.isEmpty() && pinned.isEmpty() && waiting.isEmpty() && hits.isEmpty() ->
                    EmptyState(if (filter.isNotBlank()) "No repo or session matches" else "No ${profileLabel(segment).lowercase()} sessions yet")
                else -> SessionsList(rows, filters, groups, pinned, waiting, hits)
            }
        }
        if (!waitingForServer) Fab("add", "New chat", { onNewChat(RepoChoice(null, "")) }, Modifier.align(Alignment.BottomEnd).padding(Tokens.listPad))
    }
}

@Composable
private fun OfflineSessions(rows: ChatRows, waitingForServer: Boolean) {
    val hub = rows.hub
    val offline = if (waitingForServer) remember { hub.savedChats() } else emptyList()
    if (offline.isEmpty()) EmptyState(if (waitingForServer) "Waiting for the server" else "No sessions yet", if (waitingForServer) "Check the Mac address" else null)
    else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Tokens.fabClear)) {
        item(key = "saved-head") { SectionHeader("Saved on this phone", offline.size.toString()) }
        lazyGroup(offline, { "sv-${it.first}" }) { c ->
            ListRow(c.second.ifBlank { "Untitled" }, "Offline", onClick = { hub.open(c.first); rows.onOpen() })
        }
    }
}

@Composable
private fun SessionsList(rows: ChatRows, filters: SessionsFilters, groups: List<RepoGroup>, pinned: List<ChatItem>, waiting: List<LiveChat>, hits: List<MessageHit>) {
    val ws = rows.ws
    val filter = filters.filter
    val status = filters.status
    val byStatus = filters.byStatus
    val (busy, idle) = remember(groups) { groups.partition { it.open.isNotEmpty() || it.recent.isNotEmpty() } }
    val recentRows = remember(groups, filter, ws.pins, status, rows.saved, rows.seen) { recentRows(groups, filter, ws.pins.toSet(), status, rows.saved, rows.seen) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Tokens.fabClear)) {
        if (!byStatus && waiting.isNotEmpty()) {
            item(key = "needs-head") { SectionHeader("Needs you", waiting.size.toString(), color = av.warn) }
            lazyGroup(waiting, { "needs-${it.id}" }) { rows.LiveRow(it, folderName(folderKey(it.cwd, ws.repos, ws.trees))) }
        }
        if (!byStatus && pinned.isNotEmpty()) {
            item(key = "pinned-head") { SectionHeader("Pinned", pinned.size.toString()) }
            lazyGroup(pinned, { "pin-${it.key}" }) { rows.Row(it) }
        }
        if (recentRows.isNotEmpty()) {
            item(key = "recent-head") { SectionHeader(if (byStatus) status.label else if (filter.isBlank()) "Recent" else "Chats") }
            lazyGroup(recentRows, { "rc-${it.key}" }) { rows.Row(it) }
        }
        if (byStatus && recentRows.isEmpty()) item(key = "none") { EmptyState("No ${status.label.lowercase()} chats") }
        val repoRows = if (byStatus) emptyList() else if (filters.showIdle || filter.isNotBlank()) busy + idle.sortedBy { it.name.lowercase() } else busy
        if (!byStatus && (repoRows.isNotEmpty() || idle.isNotEmpty())) item(key = "repos-head") { SectionHeader("Repos", (busy.size + idle.size).toString()) }
        lazyGroup(repoRows, { "g-${it.key}" }, lead = true) { g -> RepoRow(g, rows.seen) { filters.repoKey = g.key } }
        if (!byStatus && idle.isNotEmpty() && filter.isBlank()) item(key = "idle") {
            Group { ListRow(if (filters.showIdle) "Show fewer repos" else "More repos", trailing = { Chevron(if (!filters.showIdle) "${idle.size}" else null) }, onClick = { filters.showIdle = !filters.showIdle }) }
        }
        if (hits.isNotEmpty()) messageHits(rows, hits, filter)
    }
}

private fun LazyListScope.messageHits(rows: ChatRows, hits: List<MessageHit>, filter: String) {
    item(key = "msg-head") { SectionHeader("Messages", hits.size.toString()) }
    val now = System.currentTimeMillis()
    lazyGroup(hits, { "msg-${it.sessionId}-${it.role}-${it.at}" }) { h ->
        ListRow(boldMatches(h.text, filter), messageMeta(h, now), onClick = { rows.openSaved(h.sessionId) })
    }
}
