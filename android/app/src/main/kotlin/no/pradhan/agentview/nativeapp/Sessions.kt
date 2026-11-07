package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private const val RECENT = 5

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(hub: Hub, onOpen: () -> Unit) {
    val state by hub.store.state.collectAsState()
    val ws by hub.workspace.collectAsState()
    val connected by hub.connected.collectAsState()
    val collapsed: Map<String, Boolean> by hub.collapsed.collectAsState()
    var filter by rememberSaveable { mutableStateOf("") }
    val full = remember { mutableStateListOf<String>() }
    var opening by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Pair<String, String>?>(null) }
    var archiving by remember { mutableStateOf<Pair<String, String>?>(null) }
    var closing by remember { mutableStateOf<LiveChat?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { hub.refreshWorkspace() }

    val live = state.live
    val groups = remember(live, ws, filter) { groupByRepo(live, ws, filter) }
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

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Sessions") },
            actions = { IconButton(onClick = { hub.refreshWorkspace(force = true) }) { Icon(Icons.Filled.Refresh, "Refresh") } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = av.bg),
        )
        SearchField(filter) { filter = it }
        if (live.isEmpty() && ws.saved.isEmpty()) {
            Text(if (connected) "No sessions yet" else "Waiting for the server. Check the Mac address.", Modifier.padding(Sp.s8), color = av.fgMuted)
            return@Column
        }
        if (groups.isEmpty() && pinned.isEmpty() && waiting.isEmpty()) {
            Text(if (filter.isNotBlank()) "No repo or session matches" else "No sessions yet", Modifier.padding(Sp.s8), color = av.fgMuted)
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize()) {
            if (waiting.isNotEmpty()) {
                item(key = "needs-head") { SectionHead("Needs you", waiting.size, av.warn) }
                items(waiting.size, key = { "needs-${waiting[it].id}" }) { Box { liveRow(waiting[it], folderName(folderKey(waiting[it].cwd, ws.repos, ws.trees))) } }
            }
            if (pinned.isNotEmpty()) {
                item(key = "pinned-head") { SectionHead("Pinned", pinned.size, av.fgMuted) }
                items(pinned.size, key = { "pin-${pinned[it].first?.id ?: pinned[it].second?.sessionId}" }) { i ->
                    val (c, s) = pinned[i]
                    val repo = folderName(folderKey(c?.cwd ?: s!!.cwd, ws.repos, ws.trees))
                    Box { if (c != null) liveRow(c, repo) else savedRow(s!!, repo) }
                }
            }
            for (g in groups) {
                val open = filter.isNotBlank() || !(collapsed[g.key] ?: g.open.isEmpty())
                item(key = "g-${g.key}") { GroupHeader(g, open, seen) { hub.setCollapsed(g.key, open) } }
                if (open) {
                    val chats = g.open.filter { it.pending == 0 }
                    items(chats.size, key = { "o-${chats[it].id}" }) { Box { liveRow(chats[it]) } }
                    val recent = if (g.key in full || filter.isNotBlank()) g.recent else g.recent.take(RECENT)
                    items(recent.size, key = { "r-${recent[it].sessionId}" }) { Box { savedRow(recent[it]) } }
                    if (filter.isBlank() && g.recent.size > RECENT) item(key = "m-${g.key}") {
                        val all = g.key in full
                        Text(
                            if (all) "Show less" else "Show ${g.recent.size - RECENT} more",
                            Modifier.fillMaxWidth().clickable { if (all) full.remove(g.key) else full.add(g.key) }.padding(start = Sp.s12, top = Sp.s5, bottom = Sp.s5),
                            style = MaterialTheme.typography.labelMedium,
                            color = av.fgMuted,
                        )
                    }
                }
            }
        }
    }

    renaming?.let { (id, title) -> RenameDialog(title, onSave = { hub.rename(id, it) }, onDismiss = { renaming = null }) }
    archiving?.let { (id, title) -> ConfirmDialog("Archive this chat?", "$title\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(id) }) { archiving = null } }
    closing?.let { c -> ConfirmDialog("Close this chat?", "${c.title}\n\nClaude is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(c.id) }) { closing = null } }
}

class RowActions(val pinned: Boolean, val canPin: Boolean, val onPin: () -> Unit, val onRename: () -> Unit, val onClose: (() -> Unit)?, val onArchive: () -> Unit)

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Sp.s6, vertical = Sp.s2).background(av.surface, RoundedCornerShape(10.dp)).padding(horizontal = Sp.s5).heightIn(min = 40.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Sp.s4),
    ) {
        Icon(Icons.Filled.Search, null, Modifier.size(18.dp), tint = av.fgMuted)
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text("Search repos and sessions", style = MaterialTheme.typography.bodySmall, color = av.fgFaint)
            BasicTextField(value, onChange, Modifier.fillMaxWidth(), singleLine = true, textStyle = MaterialTheme.typography.bodySmall.copy(color = av.fg), cursorBrush = SolidColor(av.accent))
        }
        if (value.isNotEmpty()) Icon(Icons.Filled.Close, "Clear", Modifier.size(18.dp).clickable { onChange("") }, tint = av.fgMuted)
    }
}

@Composable
private fun SectionHead(label: String, count: Int, color: Color) {
    Row(Modifier.fillMaxWidth().padding(start = Sp.s8, end = Sp.s8, top = Sp.s6, bottom = Sp.s2), horizontalArrangement = Arrangement.spacedBy(Sp.s4), verticalAlignment = Alignment.CenterVertically) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = color, fontWeight = FontWeight.SemiBold, letterSpacing = androidx.compose.ui.unit.TextUnit(0.5f, androidx.compose.ui.unit.TextUnitType.Sp))
        Text("$count", style = MaterialTheme.typography.labelSmall, color = color)
    }
}

@Composable
private fun GroupHeader(g: RepoGroup, open: Boolean, seen: Map<String, Long>, onToggle: () -> Unit) {
    val glance = groupGlance(g, seen)
    Row(Modifier.fillMaxWidth().clickable(onClick = onToggle).heightIn(min = Sp.touch).padding(horizontal = Sp.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
        Text(if (open) "⌄" else "›", color = av.fgMuted, modifier = Modifier.size(16.dp))
        Text(g.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (open) {
            if (g.running > 0) Count(g.running, av.accentText)
            if (g.waiting > 0) Count(g.waiting, av.warn)
            Text("${g.open.count { it.pending == 0 } + g.recent.size}", style = MaterialTheme.typography.labelMedium, color = av.fgMuted)
        } else {
            if (glance.running > 0) Count(glance.running, av.accentText)
            if (glance.needs > 0) Count(glance.needs, av.warn)
            if (glance.unread > 0) Count(glance.unread, av.fgMuted)
            if (glance.last > 0) Text(since(glance.last), style = MaterialTheme.typography.labelSmall, color = av.fgFaint)
        }
    }
}

@Composable
private fun Count(n: Int, color: Color) {
    Text("$n", Modifier.background(color.copy(alpha = 0.18f), CircleShape).padding(horizontal = Sp.s4, vertical = 1.dp), style = MaterialTheme.typography.labelSmall, color = color)
}

@Composable
private fun ChatRow(title: String, meta: androidx.compose.ui.text.AnnotatedString, state: ChatState?, selected: Boolean, actions: RowActions, onClick: () -> Unit, muted: Boolean = false) {
    var menu by remember { mutableStateOf(false) }
    val dot = when (state) {
        ChatState.Needs -> av.warn
        ChatState.Failed -> av.err
        ChatState.Running -> av.accentText
        ChatState.Done -> av.accentText
        null -> Color.Transparent
    }
    Row(
        Modifier.fillMaxWidth().background(if (selected) av.surface else Color.Transparent).clickable(onClick = onClick).heightIn(min = 52.dp).padding(start = Sp.s8, top = Sp.s3, bottom = Sp.s3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Sp.s5),
    ) {
        Box(Modifier.size(8.dp).background(dot, CircleShape))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = if (muted) av.fgMuted else av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(meta, style = MaterialTheme.typography.labelMedium, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        when (state) {
            ChatState.Needs -> Text("Needs you", style = MaterialTheme.typography.labelSmall, color = av.warn)
            ChatState.Failed -> Text("Failed", style = MaterialTheme.typography.labelSmall, color = av.err)
            ChatState.Running -> Text("Running", style = MaterialTheme.typography.labelSmall, color = av.accentText)
            else -> {}
        }
        Box {
            IconButton(onClick = { menu = true }, Modifier.size(Sp.touch)) { Icon(Icons.Filled.MoreVert, "More", Modifier.size(20.dp), tint = av.fgMuted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (actions.canPin) DropdownMenuItem(text = { Text(if (actions.pinned) "Unpin" else "Pin") }, onClick = { menu = false; actions.onPin() })
                if (actions.canPin) DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; actions.onRename() })
                actions.onClose?.let { close -> DropdownMenuItem(text = { Text("Close chat") }, onClick = { menu = false; close() }) }
                if (actions.canPin) { HorizontalDivider(color = av.border); DropdownMenuItem(text = { Text("Archive", color = av.err) }, onClick = { menu = false; actions.onArchive() }) }
            }
        }
    }
}
