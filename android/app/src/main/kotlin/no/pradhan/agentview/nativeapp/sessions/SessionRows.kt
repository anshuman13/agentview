package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.chat.RenameDialog
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.chat.shortModel
import no.pradhan.agentview.nativeapp.codex.autopilot.RunBadge
import no.pradhan.agentview.nativeapp.codex.autopilot.RunBadgeView
import no.pradhan.agentview.nativeapp.codex.autopilot.runBadge
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.archive
import no.pradhan.agentview.nativeapp.net.closeChat
import no.pradhan.agentview.nativeapp.net.draftSnippet
import no.pradhan.agentview.nativeapp.net.markUnread
import no.pradhan.agentview.nativeapp.net.pin
import no.pradhan.agentview.nativeapp.net.providerMark
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.rename
import no.pradhan.agentview.nativeapp.net.resume
import no.pradhan.agentview.nativeapp.net.setMuted
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.PrChip
import no.pradhan.agentview.nativeapp.workspace.parsePulls
import no.pradhan.agentview.nativeapp.workspace.prChip
import no.pradhan.agentview.nativeapp.workspace.rememberLoad


@Composable
fun rememberChatRows(hub: Hub, dialogs: SessionDialogs, onOpen: () -> Unit): ChatRows {
    val live by hub.store.state.select { it.live }
    val shownId by hub.store.state.select { it.shownId }
    val ws by hub.workspace.collectAsState()
    val muted by hub.muted.collectAsState()
    val saved = remember(ws.saved) { ws.saved.associateBy { it.sessionId } }
    val shownCwd = live.firstOrNull { it.id == shownId }?.cwd
    val (prLoad) = rememberLoad(shownId, shownCwd) { if (shownCwd == null || live.none { it.pr != null }) emptyList() else parsePulls(hub.read("/api/gh/prs")) }
    val prFor = { c: LiveChat -> c.pr?.let { n -> prChip(n, prLoad.data?.takeIf { c.cwd == shownCwd }?.firstOrNull { it.number == n }, c.prChecks) } }
    return ChatRows(hub, onOpen, live, ws, saved, ws.pins.toSet(), muted, shownId, prFor, dialogs, rememberCoroutineScope(), LocalClipboardManager.current, remember { mutableStateOf<String?>(null) })
}

class SessionDialogs {
    var renaming by mutableStateOf<Pair<String, String>?>(null)
    var archiving by mutableStateOf<Pair<String, String>?>(null)
    var closing by mutableStateOf<LiveChat?>(null)

    @Composable
    fun Show(hub: Hub) {
        renaming?.let { (id, title) -> RenameDialog(title, onSave = { hub.rename(id, it) }, onDismiss = { renaming = null }) }
        archiving?.let { (id, title) -> ConfirmDialog("Archive this chat?", "$title\n\nYou can restore it from the bin for 24 hours.", "Archive", { hub.archive(id) }) { archiving = null } }
        closing?.let { c -> ConfirmDialog("Close this chat?", "${c.title}\n\nThe agent is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(c.id) }) { closing = null } }
    }
}

class ChatRows(
    val hub: Hub,
    val onOpen: () -> Unit,
    val live: List<LiveChat>,
    val ws: Workspace,
    val saved: Map<String, SavedSession>,
    private val pins: Set<String>,
    private val muted: Set<String>,
    private val shownId: String?,
    private val prFor: (LiveChat) -> PrChip?,
    private val dialogs: SessionDialogs,
    private val scope: CoroutineScope,
    private val clipboard: ClipboardManager,
    private val opening: MutableState<String?>,
) {
    val seen get() = ws.seen

    private fun repoBranch(cwd: String) = ws.repos.firstOrNull { it.cwd == folderKey(cwd, ws.repos, ws.trees) }?.branch

    private fun actions(sessionId: String?, title: String, liveChat: LiveChat?) = RowActions(
        pinned = sessionId != null && sessionId in pins,
        onPin = { sessionId?.let { hub.pin(it, it !in pins) } },
        onRename = { sessionId?.let { dialogs.renaming = it to title } },
        onClose = liveChat?.let { c -> { if (c.running || c.pending > 0) dialogs.closing = c else hub.closeChat(c.id) } },
        onArchive = { sessionId?.let { dialogs.archiving = it to title } },
        canPin = sessionId != null,
        onUnread = { sessionId?.let { hub.markUnread(it) } },
        muted = sessionId != null && sessionId in muted,
        onMute = { sessionId?.let { hub.setMuted(it, it !in muted) } },
        onLink = { sessionId?.let { clipboard.setText(AnnotatedString("${hub.origin.value}/?session=$it")); hub.notice.value = "Copied the chat link" } },
    )

    fun openSaved(sessionId: String) {
        scope.launch { if (hub.openSaved(sessionId)) onOpen() }
    }

    @Composable
    fun Row(item: ChatItem) {
        if (item.live != null) LiveRow(item.live, item.repo) else SavedRow(item.saved!!, item.repo)
    }

    @Composable
    fun LiveRow(c: LiveChat, repo: String? = null) {
        val s = c.sessionId?.let { saved[it] }
        val branch = (s?.gitBranch ?: repoBranch(c.cwd)).takeIf { !isDefaultBranch(it) }
        ChatRow(
            title = c.title.ifBlank { "Untitled" },
            meta = liveMeta(c, s, repo, branch, prFor(c)),
            state = chatState(c, s, seen),
            selected = c.id == shownId,
            actions = actions(c.sessionId, c.title, c),
            run = c.run,
            onResume = if (c.stalled) ({ hub.resume(c.id) }) else null,
            onClick = { hub.open(c.id); onOpen() },
        )
    }

    @Composable
    private fun liveMeta(c: LiveChat, s: SavedSession?, repo: String?, branch: String?, pr: PrChip?): AnnotatedString {
        val line = c.edits?.takeIf { !c.running && c.pending == 0 && (it.add > 0 || it.del > 0) }
        val when_ = when {
            c.pending > 0 -> since(c.lastActive)
            c.stalled -> "No activity for 15 min"
            c.running -> c.status.ifBlank { "Working" }
            else -> since(maxOf(c.lastActive, s?.lastModified ?: 0))
        }
        val draft = draftSnippet(hub.draft(c.id))
        return buildAnnotatedString {
            if (draft != null) {
                withStyle(SpanStyle(color = av.err)) { append("Draft: ") }
                append("$draft · ")
            }
            append(metaLine(repo, branch, c.model?.let(::shortModel), providerMark(c.provider), when_, pr?.text, c.todos?.let { "${it.done}/${it.total}" }))
            if (line != null) {
                append(" · ")
                withStyle(SpanStyle(color = av.ok)) { append("+${line.add}") }
                append(" ")
                withStyle(SpanStyle(color = av.err)) { append("-${line.del}") }
            }
        }
    }

    @Composable
    fun SavedRow(s: SavedSession, repo: String? = null) {
        val branch = (s.gitBranch ?: repoBranch(s.cwd)).takeIf { !isDefaultBranch(it) }
        ChatRow(
            title = (if (opening.value == s.sessionId) "Opening… " else "") + s.title.ifBlank { "Untitled" },
            meta = buildAnnotatedString { append(metaLine(repo, branch, providerMark(s.provider), since(s.lastModified))) },
            state = chatState(null, s, seen),
            selected = false,
            actions = actions(s.sessionId, s.title, null),
            onClick = { scope.launch { opening.value = s.sessionId; if (hub.openSaved(s.sessionId)) onOpen(); opening.value = null } },
        )
    }
}

class RowActions(val pinned: Boolean, val canPin: Boolean, val onPin: () -> Unit, val onRename: () -> Unit, val onClose: (() -> Unit)?, val onArchive: () -> Unit, val onUnread: () -> Unit = {}, val muted: Boolean = false, val onMute: () -> Unit = {}, val onLink: () -> Unit = {})

@Composable
fun RepoRow(g: RepoGroup, seen: Map<String, Long>, onClick: () -> Unit) {
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
private fun ChatRow(title: String, meta: androidx.compose.ui.text.AnnotatedString, state: ChatState?, selected: Boolean, actions: RowActions, onClick: () -> Unit, run: LiveRun? = null, onResume: (() -> Unit)? = null) {
    val badge = run?.let { runBadge(it) }
    val shown = if (badge == RunBadge.Needs) ChatState.Needs else state
    // Like Slack's unread channels, a chat with a reply or question you have not opened has a bold title.
    val unread = shown == ChatState.Done || shown == ChatState.Needs
    val dot = when (shown) {
        ChatState.Needs -> DotState.Warn to "Needs you"
        ChatState.Failed -> DotState.Bad to "Failed"
        ChatState.Running -> DotState.Running to "Running"
        ChatState.Done -> DotState.Unread to "Unread"
        null -> null
    }
    ListRow(
        if (unread) buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(title) } } else title,
        meta, lines = 1, metaLines = 1, selected = selected, onClick = onClick,
        onLongClick = if (actions.canPin) actions.onRename else null,
        leading = { dot?.let { (d, word) -> StatusDot(d, Modifier.semantics { contentDescription = word }) } },
        state = {
            if (run != null && badge != null && badge != RunBadge.Needs) RunBadgeView(badge, run)
            else if (actions.muted) AvIcon("bell-slash", tint = av.fgMuted)
        },
        menu = { close ->
            if (onResume != null) MenuItem("Resume", "play", { close(); onResume() })
            if (actions.canPin) MenuItem(if (actions.pinned) "Unpin" else "Pin", if (actions.pinned) "pinned" else "pin", { close(); actions.onPin() })
            if (actions.canPin && shown == null && !selected) MenuItem("Mark as unread", "mail", { close(); actions.onUnread() })
            if (actions.canPin) MenuItem(if (actions.muted) "Unmute" else "Mute", if (actions.muted) "bell" else "bell-slash", { close(); actions.onMute() })
            if (actions.canPin) MenuItem("Copy link", "link", { close(); actions.onLink() })
            if (actions.canPin) MenuItem("Rename", "edit", { close(); actions.onRename() })
            actions.onClose?.let { c -> MenuItem("Close chat", "close", { close(); c() }) }
            if (actions.canPin) { MenuSeparator(); MenuItem("Archive", "archive", { close(); actions.onArchive() }, danger = true) }
        },
    )
}
