package no.pradhan.agentview.nativeapp

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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

private const val RECENT = 5

@Composable
fun SessionsScreen(hub: Hub, onOpen: () -> Unit) {
    val state by hub.store.state.collectAsState()
    val ws by hub.workspace.collectAsState()
    val connected by hub.connected.collectAsState()
    val collapsed: Map<String, Boolean> by hub.collapsed.collectAsState()
    val segment by hub.chatSegment.collectAsState()
    var filter by rememberSaveable { mutableStateOf("") }
    val full = remember { mutableStateListOf<String>() }
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
            muted = true,
            actions = actions(s.sessionId, s.title, null),
            onClick = { scope.launch { opening = s.sessionId; if (hub.openSaved(s.sessionId)) onOpen(); opening = null } },
        )
    }

    val waitingForServer = !connected && live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty()
    Box(Modifier.fillMaxSize()) {
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
                    items(waiting.size, key = { "needs-${waiting[it].id}" }) { Box { liveRow(waiting[it], folderName(folderKey(waiting[it].cwd, ws.repos, ws.trees))) } }
                }
                if (pinned.isNotEmpty()) {
                    item(key = "pinned-head") { SectionHeader("Pinned", pinned.size.toString()) }
                    items(pinned.size, key = { "pin-${pinned[it].first?.id ?: pinned[it].second?.sessionId}" }) { i ->
                        val (c, s) = pinned[i]
                        val repo = folderName(folderKey(c?.cwd ?: s!!.cwd, ws.repos, ws.trees))
                        Box { if (c != null) liveRow(c, repo) else savedRow(s!!, repo) }
                    }
                }
                for (g in groups) {
                    val open = filter.isNotBlank() || !(collapsed[g.key] ?: g.open.isEmpty())
                    item(key = "g-${g.key}") { GroupHeader(g, open, seen, { hub.newChat(g.key); onOpen() }) { hub.setCollapsed(g.key, open) } }
                    if (open) {
                        val chats = g.open.filter { it.pending == 0 }
                        items(chats.size, key = { "o-${chats[it].id}" }) { Box { liveRow(chats[it]) } }
                        val recent = if (g.key in full || filter.isNotBlank()) g.recent else g.recent.take(RECENT)
                        items(recent.size, key = { "r-${recent[it].sessionId}" }) { Box { savedRow(recent[it]) } }
                        if (filter.isBlank() && g.recent.size > RECENT) item(key = "m-${g.key}") {
                            val all = g.key in full
                            Button(if (all) "Show less" else "Show ${g.recent.size - RECENT} more", { if (all) full.remove(g.key) else full.add(g.key) }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                        }
                    }
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
private fun GroupHeader(g: RepoGroup, open: Boolean, seen: Map<String, Long>, onNew: () -> Unit, onToggle: () -> Unit) {
    val glance = groupGlance(g, seen)
    SectionHeader(g.name, open = open, onToggle = onToggle, style = Type.headline, titleColor = av.fg, action = {
        when {
            glance.needs > 0 -> Badge("${glance.needs}", BadgeTone.Waiting)
            glance.running > 0 -> Badge("${glance.running}", BadgeTone.Running)
            glance.unread > 0 -> Badge("${glance.unread}", BadgeTone.Quiet)
        }
        IconBtn("add", "New chat in ${g.name}", onNew)
    })
}

@Composable
private fun ChatRow(title: String, meta: androidx.compose.ui.text.AnnotatedString, state: ChatState?, selected: Boolean, actions: RowActions, onClick: () -> Unit, muted: Boolean = false) {
    val unread = state == ChatState.Done || state == ChatState.Needs
    ListRow(
        title, meta, lines = 2, metaLines = 2, muted = muted, selected = selected, onClick = onClick,
        leading = { if (unread) StatusDot(DotState.Unread) },
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
