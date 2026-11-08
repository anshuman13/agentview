package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.launch

private const val RECENT = 6

@Composable
fun SessionsScreen(hub: Hub, onOpen: () -> Unit) {
    val state by hub.store.state.collectAsState()
    val ws by hub.workspace.collectAsState()
    val connected by hub.connected.collectAsState()
    val segment by hub.chatSegment.collectAsState()
    var filter by rememberSaveable { mutableStateOf("") }
    var opening by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Pair<String, String>?>(null) }
    var archiving by remember { mutableStateOf<Pair<String, String>?>(null) }
    var closing by remember { mutableStateOf<LiveChat?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { hub.refreshWorkspace() }

    val live = state.live
    val all = remember(live, ws, filter) { groupByRepo(live, ws, filter) }
    val groups = remember(all, segment) { all.filter { segmentOf(it.key) == segment } }
    val pinned = remember(live, ws, filter) { pinnedRows(live, ws, filter) }
    val waiting = remember(live) { live.filter { it.pending > 0 }.sortedWith(byUrgency) }
    val saved = remember(ws.saved) { ws.saved.associateBy { it.sessionId } }
    val pins = ws.pins.toSet()
    val seen = ws.seen
    var showIdle by rememberSaveable { mutableStateOf(false) }
    var repoKey by rememberSaveable { mutableStateOf<String?>(null) }

    fun repoBranch(cwd: String) = ws.repos.firstOrNull { it.cwd == folderKey(cwd, ws.repos, ws.trees) }?.branch

    fun actions(sessionId: String?, title: String, liveChat: LiveChat?) = RowActions(
        pinned = sessionId != null && sessionId in pins,
        onPin = { sessionId?.let { hub.pin(it, it !in pins) } },
        onRename = { sessionId?.let { renaming = it to title } },
        onClose = liveChat?.let { c -> { if (c.running || c.pending > 0) closing = c else hub.closeChat(c.id) } },
        onArchive = { sessionId?.let { archiving = it to title } },
        canPin = sessionId != null,
    )

    @Composable
    fun liveRow(c: LiveChat, repo: String? = null) {
        val s = c.sessionId?.let { saved[it] }
        val line = c.edits?.takeIf { !c.running && c.pending == 0 && (it.add > 0 || it.del > 0) }
        val when_ = when {
            c.pending > 0 -> since(c.lastActive)
            c.stalled -> "No activity for 15 min"
            c.running -> c.status.ifBlank { "Working" }
            else -> since(maxOf(c.lastActive, s?.lastModified ?: 0))
        }
        val branch = (s?.gitBranch ?: repoBranch(c.cwd)).takeIf { !isDefaultBranch(it) }
        ChatRow(
            title = c.title.ifBlank { "Untitled" },
            meta = buildAnnotatedString {
                append(metaLine(repo, branch, when_))
                if (line != null) {
                    append(" · ")
                    withStyle(SpanStyle(color = av.ok)) { append("+${line.add}") }
                    append(" ")
                    withStyle(SpanStyle(color = av.err)) { append("-${line.del}") }
                }
            },
            state = chatState(c, s, seen),
            selected = c.id == state.shownId,
            actions = actions(c.sessionId, c.title, c),
            onClick = { hub.open(c.id); onOpen() },
        )
    }

    @Composable
    fun savedRow(s: SavedSession, repo: String? = null) {
        val branch = (s.gitBranch ?: repoBranch(s.cwd)).takeIf { !isDefaultBranch(it) }
        ChatRow(
            title = (if (opening == s.sessionId) "Opening… " else "") + s.title.ifBlank { "Untitled" },
            meta = buildAnnotatedString { append(metaLine(repo, branch, since(s.lastModified))) },
            state = chatState(null, s, seen),
            selected = false,
            actions = actions(s.sessionId, s.title, null),
            onClick = { scope.launch { opening = s.sessionId; if (hub.openSaved(s.sessionId)) onOpen(); opening = null } },
        )
    }

    val waitingForServer = !connected && live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty()
    val (busy, idle) = groups.partition { it.open.isNotEmpty() || it.recent.isNotEmpty() }
    val recentRows = remember(busy, filter) {
        busy.flatMap { g -> g.open.filter { it.pending == 0 }.map { Triple<LiveChat?, SavedSession?, String>(it, null, g.name) to it.lastActive } + g.recent.map { Triple<LiveChat?, SavedSession?, String>(null, it, g.name) to it.lastModified } }
            .sortedByDescending { it.second }.map { it.first }.let { if (filter.isBlank()) it.take(RECENT) else it }
    }
    val repo = repoKey?.let { k -> all.firstOrNull { it.key == k } ?: groupByRepo(live, ws).firstOrNull { it.key == k } }

    if (repo != null) {
        BackHandler { repoKey = null }
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                PageHeader(repo.name, onBack = { repoKey = null })
                val rows = repo.open.map<LiveChat, Pair<LiveChat?, SavedSession?>> { it to null } + repo.recent.map { null to it }
                if (rows.isEmpty()) EmptyState("No chats in ${repo.name} yet", action = { Button("New chat", { hub.newChat(repo.key); onOpen() }, variant = ButtonVariant.Tinted, icon = "add") })
                else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = Tokens.sp3, bottom = Tokens.fabClear)) {
                    lazyGroup(rows, { if (it.first != null) "o-${it.first!!.id}" else "r-${it.second!!.sessionId}" }) { (c, s) -> if (c != null) liveRow(c) else savedRow(s!!) }
                }
            }
            Fab("add", "New chat in ${repo.name}", { hub.newChat(repo.key); onOpen() }, Modifier.align(Alignment.BottomEnd).padding(Tokens.listPad))
        }
    } else Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PageHeader("Sessions") { IconBtn("refresh", "Refresh", { hub.refreshWorkspace(force = true) }) }
            SearchField(filter, { filter = it }, "Search repos and sessions")
            Row(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                listOf(WORK, PERSONAL).forEach { k ->
                    Chip("${profileLabel(k)} ${all.count { segmentOf(it.key) == k }}", { hub.setChatSegment(k) }, on = segment == k, tone = if (k == WORK) ChipTone.Work else ChipTone.Personal)
                }
            }
            if (live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty()) {
                EmptyState(if (waitingForServer) "Waiting for the server" else "No sessions yet", if (waitingForServer) "Check the Mac address." else null)
                return@Column
            }
            if (groups.isEmpty() && pinned.isEmpty() && waiting.isEmpty()) {
                EmptyState(if (filter.isNotBlank()) "No repo or session matches" else "No ${profileLabel(segment).lowercase()} sessions yet")
                return@Column
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Tokens.fabClear)) {
                if (waiting.isNotEmpty()) {
                    item(key = "needs-head") { SectionHeader("Needs you", waiting.size.toString(), color = av.warn) }
                    lazyGroup(waiting, { "needs-${it.id}" }) { liveRow(it, folderName(folderKey(it.cwd, ws.repos, ws.trees))) }
                }
                if (pinned.isNotEmpty()) {
                    item(key = "pinned-head") { SectionHeader("Pinned", pinned.size.toString()) }
                    lazyGroup(pinned, { "pin-${it.first?.id ?: it.second?.sessionId}" }) { (c, s) ->
                        val name = folderName(folderKey(c?.cwd ?: s!!.cwd, ws.repos, ws.trees))
                        if (c != null) liveRow(c, name) else savedRow(s!!, name)
                    }
                }
                if (recentRows.isNotEmpty()) {
                    item(key = "recent-head") { SectionHeader(if (filter.isBlank()) "Recent" else "Chats") }
                    lazyGroup(recentRows, { (c, s) -> if (c != null) "rc-${c.id}" else "rs-${s!!.sessionId}" }) { (c, s, name) -> if (c != null) liveRow(c, name) else savedRow(s!!, name) }
                }
                val repoRows = if (showIdle || filter.isNotBlank()) busy + idle.sortedBy { it.name.lowercase() } else busy
                if (repoRows.isNotEmpty() || idle.isNotEmpty()) item(key = "repos-head") { SectionHeader("Repos", (busy.size + idle.size).toString()) }
                lazyGroup(repoRows, { "g-${it.key}" }, lead = true) { g -> RepoRow(g, seen) { repoKey = g.key } }
                if (idle.isNotEmpty() && filter.isBlank()) item(key = "idle") {
                    Group { ListRow(if (showIdle) "Show fewer repos" else "More repos", trailing = { if (!showIdle) Text("${idle.size}", style = Type.body, color = av.fgMuted); Chevron() }, onClick = { showIdle = !showIdle }) }
                }
            }
        }
        if (!waitingForServer) Fab("add", "New chat", { hub.newChat() }, Modifier.align(Alignment.BottomEnd).padding(Tokens.listPad))
    }

    renaming?.let { (id, title) -> RenameDialog(title, onSave = { hub.rename(id, it) }, onDismiss = { renaming = null }) }
    archiving?.let { (id, title) -> ConfirmDialog("Archive this chat?", "$title\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(id) }) { archiving = null } }
    closing?.let { c -> ConfirmDialog("Close this chat?", "${c.title}\n\nClaude is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(c.id) }) { closing = null } }
}

class RowActions(val pinned: Boolean, val canPin: Boolean, val onPin: () -> Unit, val onRename: () -> Unit, val onClose: (() -> Unit)?, val onArchive: () -> Unit)

@Composable
private fun RepoRow(g: RepoGroup, seen: Map<String, Long>, onClick: () -> Unit) {
    val glance = groupGlance(g, seen)
    val chats = g.open.size + g.recent.size
    val meta = when {
        chats == 0 -> "No chats"
        g.open.isNotEmpty() -> "${g.open.size} open · ${since(g.last)}"
        else -> "$chats ${if (chats == 1) "chat" else "chats"} · ${since(g.last)}"
    }
    ListRow(g.name, meta, leading = { RepoMark(g.name) }, onClick = onClick, trailing = {
        when {
            glance.needs > 0 -> Badge("${glance.needs}", BadgeTone.Waiting)
            glance.running > 0 -> Badge("${glance.running}", BadgeTone.Running)
            glance.unread > 0 -> Badge("${glance.unread}", BadgeTone.Quiet)
        }
        Chevron()
    })
}

// A coloured tile with the repo's first letter, the colour fixed by the name.
@Composable
private fun RepoMark(name: String) {
    val hues = listOf(av.hueBlue, av.hueViolet, av.hueTeal, av.hueAmber, av.hueMagenta, av.hueGreen, av.hueOrange, av.hueSky)
    Box(Modifier.size(Tokens.leadWidth + Tokens.sp2).clip(RoundedCornerShape(Tokens.shapeMd)).background(hues[Math.floorMod(name.hashCode(), hues.size)]), contentAlignment = Alignment.Center) {
        Text(name.trimStart('.', '_', '-').take(1).uppercase(), style = Type.label, color = av.onColor)
    }
}

@Composable
private fun ChatRow(title: String, meta: androidx.compose.ui.text.AnnotatedString, state: ChatState?, selected: Boolean, actions: RowActions, onClick: () -> Unit) {
    val unread = state == ChatState.Done || state == ChatState.Needs
    ListRow(
        title, meta, lines = 2, metaLines = 2, selected = selected, onClick = onClick,
        leading = if (unread) ({ StatusDot(DotState.Unread) }) else null,
        trailing = {
            when (state) {
                ChatState.Needs -> Badge("Needs you", BadgeTone.Waiting)
                ChatState.Failed -> Badge("Failed", BadgeTone.Failed)
                ChatState.Running -> Badge("Running", BadgeTone.Running)
                ChatState.Done -> Badge("Done", BadgeTone.Done)
                null -> {}
            }
            MoreButton { close ->
                if (actions.canPin) MenuItem(if (actions.pinned) "Unpin" else "Pin", if (actions.pinned) "pinned" else "pin", { close(); actions.onPin() })
                if (actions.canPin) MenuItem("Rename", "edit", { close(); actions.onRename() })
                actions.onClose?.let { c -> MenuItem("Close chat", "close", { close(); c() }) }
                if (actions.canPin) { MenuSeparator(); MenuItem("Archive", "archive", { close(); actions.onArchive() }, danger = true) }
            }
        },
    )
}
