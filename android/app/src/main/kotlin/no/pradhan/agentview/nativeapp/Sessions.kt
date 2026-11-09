package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SessionsScreen(hub: Hub, onOpen: () -> Unit) {
    val live by hub.store.state.select { it.live }
    val shownId by hub.store.state.select { it.shownId }
    val sessionCwd by hub.store.state.select { it.session?.cwd }
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

    val all = remember(live, ws, filter) { groupByRepo(live, ws, filter) }
    var hits by remember { mutableStateOf(emptyList<MessageHit>()) }
    LaunchedEffect(filter) {
        val q = messageQuery(filter)
        if (q == null) { hits = emptyList(); return@LaunchedEffect }
        delay(400)
        hits = runCatching { protocolJson.decodeFromString<List<MessageHit>>(hub.read("/api/sessions/search?q=${enc(q)}")) }.getOrDefault(emptyList())
    }
    val groups = remember(all, segment) { all.filter { segmentOf(it.key) == segment } }
    val pinned = remember(live, ws, filter) { pinnedRows(live, ws, filter) }
    val waiting = remember(live) { live.filter { it.pending > 0 }.sortedWith(byUrgency) }
    val saved = remember(ws.saved) { ws.saved.associateBy { it.sessionId } }
    val pins = ws.pins.toSet()
    val seen = ws.seen
    val muted by hub.muted.collectAsState()
    val clipboard = LocalClipboardManager.current
    var status by rememberSaveable { mutableStateOf(StatusFilter.All) }
    val byStatus = status != StatusFilter.All
    var showIdle by rememberSaveable { mutableStateOf(false) }
    var repoKey by rememberSaveable { mutableStateOf<String?>(null) }
    var newChat by remember { mutableStateOf<RepoChoice?>(null) }

    val shownCwd = live.firstOrNull { it.id == shownId }?.cwd
    val (prLoad) = rememberLoad(shownId, shownCwd) { if (shownCwd == null || live.none { it.pr != null }) emptyList() else parsePulls(hub.read("/api/gh/prs")) }

    fun repoBranch(cwd: String) = ws.repos.firstOrNull { it.cwd == folderKey(cwd, ws.repos, ws.trees) }?.branch

    fun actions(sessionId: String?, title: String, liveChat: LiveChat?) = RowActions(
        pinned = sessionId != null && sessionId in pins,
        onPin = { sessionId?.let { hub.pin(it, it !in pins) } },
        onRename = { sessionId?.let { renaming = it to title } },
        onClose = liveChat?.let { c -> { if (c.running || c.pending > 0) closing = c else hub.closeChat(c.id) } },
        onArchive = { sessionId?.let { archiving = it to title } },
        canPin = sessionId != null,
        onUnread = { sessionId?.let { hub.markUnread(it) } },
        muted = sessionId != null && sessionId in muted,
        onMute = { sessionId?.let { hub.setMuted(it, it !in muted) } },
        onLink = { sessionId?.let { clipboard.setText(AnnotatedString("${hub.origin.value}/?session=$it")); hub.notice.value = "Copied the chat link" } },
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
        val draft = draftSnippet(hub.draft(c.id))
        ChatRow(
            title = c.title.ifBlank { "Untitled" },
            meta = buildAnnotatedString {
                if (draft != null) {
                    withStyle(SpanStyle(color = av.err)) { append("Draft: ") }
                    append("$draft · ")
                }
                append(metaLine(repo, branch, c.model?.let(::shortModel), when_, c.todos?.let { "${it.done}/${it.total}" }))
                if (line != null) {
                    append(" · ")
                    withStyle(SpanStyle(color = av.ok)) { append("+${line.add}") }
                    append(" ")
                    withStyle(SpanStyle(color = av.err)) { append("-${line.del}") }
                }
            },
            state = chatState(c, s, seen),
            selected = c.id == shownId,
            actions = actions(c.sessionId, c.title, c),
            run = c.run,
            recap = c.recap,
            pr = c.pr?.let { n -> prChip(n, prLoad.data?.takeIf { c.cwd == shownCwd }?.firstOrNull { it.number == n }) },
            onResume = if (c.stalled) ({ hub.resume(c.id) }) else null,
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

    @Composable
    fun row(item: ChatItem) {
        if (item.live != null) liveRow(item.live, item.repo) else savedRow(item.saved!!, item.repo)
    }

    // Status chips with a count above zero; tapping the chosen one again shows all.
    @Composable
    fun statusChips(of: List<RepoGroup>) {
        StatusFilter.entries.filter { it != StatusFilter.All }.forEach { f ->
            val n = statusCount(of, f, saved, seen)
            if (n > 0 || status == f) Chip("${f.label} $n", { status = if (status == f) StatusFilter.All else f }, on = status == f)
        }
        // Slack's mark all read, while the Done chip is on.
        if (status == StatusFilter.Done) {
            val done = of.flatMap { it.items() }.filter { it.state(saved, seen) == ChatState.Done }.mapNotNull { it.live?.sessionId ?: it.saved?.sessionId }
            if (done.isNotEmpty()) Chip("Mark all read", { hub.markRead(done) })
        }
    }

    @Composable
    fun chipRow(content: @Composable () -> Unit) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) { content() }
    }

    val waitingForServer = !connected && live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty()
    val (busy, idle) = remember(groups) { groups.partition { it.open.isNotEmpty() || it.recent.isNotEmpty() } }
    val recentRows = remember(groups, filter, ws.pins, status, saved, seen) { recentRows(groups, filter, pins, status, saved, seen) }
    val unfiltered = remember(live, ws) { groupByRepo(live, ws) }
    val repo = repoKey?.let { k -> unfiltered.firstOrNull { it.key == k } }

    if (repo != null) {
        BackHandler { repoKey = null }
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                PageHeader(repo.name, onBack = { repoKey = null })
                chipRow { statusChips(listOf(repo)) }
                val rows = repo.items().map { it.copy(repo = null) }.filter { status.matches(it.state(saved, seen)) }
                if (rows.isEmpty()) EmptyState(if (byStatus) "No ${status.label.lowercase()} chats in ${repo.name}" else "No chats in ${repo.name} yet", action = { Button("New chat", { newChat = RepoChoice(repo.key, repo.name) }, variant = ButtonVariant.Tinted, icon = "add") })
                else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = Tokens.sp3, bottom = Tokens.fabClear)) {
                    lazyGroup(rows, { "c-${it.key}" }) { row(it) }
                }
            }
            Fab("add", "New chat in ${repo.name}", { newChat = RepoChoice(repo.key, repo.name) }, Modifier.align(Alignment.BottomEnd).padding(Tokens.listPad))
        }
    } else Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PageHeader("Sessions") { IconBtn("mic", "Ask by voice", { hub.voiceRequest.tryEmit(Unit) }); IconBtn("refresh", "Refresh", { hub.refreshWorkspace(force = true) }) }
            SearchField(filter, { filter = it }, "Search repos and sessions")
            chipRow {
                listOf(WORK, PERSONAL).forEach { k ->
                    Chip("${profileLabel(k)} ${all.count { segmentOf(it.key) == k }}", { hub.setChatSegment(k) }, on = segment == k, tone = if (k == WORK) ChipTone.Work else ChipTone.Personal)
                }
                statusChips(groups)
            }
            if (live.isEmpty() && ws.saved.isEmpty() && ws.repos.isEmpty()) {
                val offline = if (waitingForServer) remember { hub.savedChats() } else emptyList()
                if (offline.isEmpty()) EmptyState(if (waitingForServer) "Waiting for the server" else "No sessions yet", if (waitingForServer) "Check the Mac address" else null)
                else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Tokens.fabClear)) {
                    item(key = "saved-head") { SectionHeader("Saved on this phone", offline.size.toString()) }
                    lazyGroup(offline, { "sv-${it.first}" }) { c ->
                        ListRow(c.second.ifBlank { "Untitled" }, "Offline", onClick = { hub.open(c.first); onOpen() })
                    }
                }
                return@Column
            }
            if (groups.isEmpty() && pinned.isEmpty() && waiting.isEmpty() && hits.isEmpty()) {
                EmptyState(if (filter.isNotBlank()) "No repo or session matches" else "No ${profileLabel(segment).lowercase()} sessions yet")
                return@Column
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = Tokens.fabClear)) {
                if (!byStatus && waiting.isNotEmpty()) {
                    item(key = "needs-head") { SectionHeader("Needs you", waiting.size.toString(), color = av.warn) }
                    lazyGroup(waiting, { "needs-${it.id}" }) { liveRow(it, folderName(folderKey(it.cwd, ws.repos, ws.trees))) }
                }
                if (!byStatus && pinned.isNotEmpty()) {
                    item(key = "pinned-head") { SectionHeader("Pinned", pinned.size.toString()) }
                    lazyGroup(pinned, { "pin-${it.key}" }) { row(it) }
                }
                if (recentRows.isNotEmpty()) {
                    item(key = "recent-head") { SectionHeader(if (byStatus) status.label else if (filter.isBlank()) "Recent" else "Chats") }
                    lazyGroup(recentRows, { "rc-${it.key}" }) { row(it) }
                }
                if (byStatus && recentRows.isEmpty()) item(key = "none") { EmptyState("No ${status.label.lowercase()} chats") }
                val repoRows = if (byStatus) emptyList() else if (showIdle || filter.isNotBlank()) busy + idle.sortedBy { it.name.lowercase() } else busy
                if (!byStatus && (repoRows.isNotEmpty() || idle.isNotEmpty())) item(key = "repos-head") { SectionHeader("Repos", (busy.size + idle.size).toString()) }
                lazyGroup(repoRows, { "g-${it.key}" }, lead = true) { g -> RepoRow(g, seen) { repoKey = g.key } }
                if (!byStatus && idle.isNotEmpty() && filter.isBlank()) item(key = "idle") {
                    Group { ListRow(if (showIdle) "Show fewer repos" else "More repos", trailing = { Chevron(if (!showIdle) "${idle.size}" else null) }, onClick = { showIdle = !showIdle }) }
                }
                if (hits.isNotEmpty()) {
                    item(key = "msg-head") { SectionHeader("Messages", hits.size.toString()) }
                    val now = System.currentTimeMillis()
                    lazyGroup(hits, { "msg-${it.sessionId}-${it.role}-${it.at}" }) { h ->
                        ListRow(boldMatches(h.text, filter), messageMeta(h, now), onClick = { scope.launch { if (hub.openSaved(h.sessionId)) onOpen() } })
                    }
                }
            }
        }
        if (!waitingForServer) Fab("add", "New chat", { newChat = RepoChoice(null, "") }, Modifier.align(Alignment.BottomEnd).padding(Tokens.listPad))
    }

    newChat?.let { choice ->
        val here = sessionCwd?.ifEmpty { null }?.let { c -> folderKey(c, ws.repos, ws.trees) }?.takeIf { k -> unfiltered.any { g -> g.key == k } }
        val choices = unfiltered.filter { g -> g.key == here || g.open.isNotEmpty() || g.recent.isNotEmpty() }.sortedByDescending { g -> g.key == here }
        NewChatSheet(hub, choice.key, choices.map { RepoChoice(it.key, it.name) }, onDismiss = { newChat = null }, initial = here)
    }
    renaming?.let { (id, title) -> RenameDialog(title, onSave = { hub.rename(id, it) }, onDismiss = { renaming = null }) }
    archiving?.let { (id, title) -> ConfirmDialog("Archive this chat?", "$title\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(id) }) { archiving = null } }
    closing?.let { c -> ConfirmDialog("Close this chat?", "${c.title}\n\nClaude is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(c.id) }) { closing = null } }
}

class RowActions(val pinned: Boolean, val canPin: Boolean, val onPin: () -> Unit, val onRename: () -> Unit, val onClose: (() -> Unit)?, val onArchive: () -> Unit, val onUnread: () -> Unit = {}, val muted: Boolean = false, val onMute: () -> Unit = {}, val onLink: () -> Unit = {})

@Composable
private fun RepoRow(g: RepoGroup, seen: Map<String, Long>, onClick: () -> Unit) {
    val glance = groupGlance(g, seen)
    val chats = g.open.size + g.recent.size
    val meta = when {
        chats == 0 -> "No chats"
        g.open.isNotEmpty() -> metaLine("${g.open.size} open", since(g.last))
        else -> metaLine("$chats ${if (chats == 1) "chat" else "chats"}", since(g.last))
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
private fun ChatRow(title: String, meta: androidx.compose.ui.text.AnnotatedString, state: ChatState?, selected: Boolean, actions: RowActions, onClick: () -> Unit, run: LiveRun? = null, recap: String? = null, pr: PrChip? = null, onResume: (() -> Unit)? = null) {
    val uri = LocalUriHandler.current
    // Like Slack's unread channels, a chat with a reply or question you have not opened has a bold title.
    val unread = state == ChatState.Done || state == ChatState.Needs
    ListRow(
        if (unread) buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(title) } } else title,
        meta, lines = 2, metaLines = 2, selected = selected, onClick = onClick,
        below = if (pr == null && recap == null) null else ({
            Column(Modifier.weight(1f)) {
                if (recap != null) Text(recap, style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (pr != null) Row(Modifier.clip(RoundedCornerShape(Tokens.sp4)).clickable(enabled = pr.url.isNotEmpty()) { uri.openUri(pr.url) }.padding(vertical = Tokens.sp2), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    pr.dot?.let { StatusDot(it) }
                    Text(pr.text, style = Type.meta, color = av.metaFg)
                }
            }
        }),
        trailing = {
            if (onResume != null) Button("Resume", onResume, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
            if (actions.muted) AvIcon("bell-slash", tint = av.fgMuted)
            run?.let { r -> runBadge(r)?.takeIf { !(it == RunBadge.Needs && state == ChatState.Needs) }?.let { RunBadgeView(it, r) } }
            when (state) {
                ChatState.Needs -> Badge("Needs you", BadgeTone.Waiting)
                ChatState.Failed -> Badge("Failed", BadgeTone.Failed)
                ChatState.Running -> Badge("Running", BadgeTone.Running)
                ChatState.Done -> Badge("Done", BadgeTone.Done)
                null -> {}
            }
            MoreButton { close ->
                if (actions.canPin) MenuItem(if (actions.pinned) "Unpin" else "Pin", if (actions.pinned) "pinned" else "pin", { close(); actions.onPin() })
                if (actions.canPin && state == null && !selected) MenuItem("Mark as unread", "mail", { close(); actions.onUnread() })
                if (actions.canPin) MenuItem(if (actions.muted) "Unmute" else "Mute", if (actions.muted) "bell" else "bell-slash", { close(); actions.onMute() })
                if (actions.canPin) MenuItem("Copy link", "link", { close(); actions.onLink() })
                if (actions.canPin) MenuItem("Rename", "edit", { close(); actions.onRename() })
                actions.onClose?.let { c -> MenuItem("Close chat", "close", { close(); c() }) }
                if (actions.canPin) { MenuSeparator(); MenuItem("Archive", "archive", { close(); actions.onArchive() }, danger = true) }
            }
        },
    )
}
