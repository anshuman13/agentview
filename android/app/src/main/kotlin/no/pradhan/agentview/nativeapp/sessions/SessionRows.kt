package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import no.pradhan.agentview.nativeapp.app.nest
import no.pradhan.agentview.nativeapp.app.section
import no.pradhan.agentview.nativeapp.ui.SearchField
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.withLink
import no.pradhan.agentview.nativeapp.ui.Sheet
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.runtime.CompositionLocalProvider
import no.pradhan.agentview.nativeapp.chat.LocalCardChat
import no.pradhan.agentview.nativeapp.chat.PendingCard
import no.pradhan.agentview.nativeapp.net.asked
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.chat.FindRequest
import no.pradhan.agentview.nativeapp.chat.RenameDialog
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.chat.shortModel
import no.pradhan.agentview.nativeapp.codex.autopilot.RunBadge
import no.pradhan.agentview.nativeapp.codex.autopilot.RunBadgeView
import no.pradhan.agentview.nativeapp.codex.autopilot.askLine
import no.pradhan.agentview.nativeapp.codex.autopilot.runBadge
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.app.archive
import no.pradhan.agentview.nativeapp.app.closeChat
import no.pradhan.agentview.nativeapp.net.draftSnippet
import no.pradhan.agentview.nativeapp.app.markUnread
import no.pradhan.agentview.nativeapp.app.pin
import no.pradhan.agentview.nativeapp.net.providerMark
import no.pradhan.agentview.nativeapp.app.pulls
import no.pradhan.agentview.nativeapp.app.rename
import no.pradhan.agentview.nativeapp.app.resume
import no.pradhan.agentview.nativeapp.app.retryTurn
import no.pradhan.agentview.nativeapp.app.setMuted
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.SwipeLabel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ops.PrChip
import no.pradhan.agentview.nativeapp.ops.prChip
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.ui.plural


@Composable
fun rememberChatRows(hub: Hub, dialogs: SessionDialogs, onOpen: () -> Unit): ChatRows {
    val live by hub.store.state.select { it.live }
    val shownId by hub.store.state.select { it.shownId }
    val ws by hub.workspace.collectAsState()
    val muted by hub.muted.collectAsState()
    val saved = remember(ws.saved) { rowsById(ws.saved) }
    val shownCwd = live.firstOrNull { it.id == shownId }?.cwd
    val (prLoad) = rememberLoad(shownId, shownCwd) { if (shownCwd == null || live.none { it.pr != null }) emptyList() else hub.pulls(false) }
    val prFor = { c: LiveChat -> c.pr?.let { n -> prChip(n, prLoad.data?.takeIf { c.cwd == shownCwd }?.firstOrNull { it.number == n }, c.prChecks) } }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val menu = remember { mutableStateOf<String?>(null) }
    val open = rememberUpdatedState(onOpen)
    return remember(live, ws, saved, muted, shownId, prLoad.data, dialogs) { ChatRows(hub, { open.value() }, live, ws, saved, rowPins(ws, saved).toSet(), muted, shownId, prFor, dialogs, scope, clipboard, menu) }
}

class SessionDialogs {
    var renaming by mutableStateOf<Pair<String, String>?>(null)
    var archiving by mutableStateOf<Pair<String, String>?>(null)
    var closing by mutableStateOf<LiveChat?>(null)
    var nesting by mutableStateOf<String?>(null)
    var sectioning by mutableStateOf<String?>(null)

    @Composable
    fun Show(hub: Hub) {
        nesting?.let { id -> NestSheet(hub, id) { nesting = null } }
        sectioning?.let { id -> SectionSheet(hub, id) { sectioning = null } }
        renaming?.let { (id, title) -> RenameDialog(title, onSave = { hub.rename(id, it) }, onDismiss = { renaming = null }) }
        archiving?.let { (id, title) -> ConfirmDialog("Archive this chat?", "$title\n\nYou can restore it from the bin for 7 days.", "Archive", { hub.archive(id) }) { archiving = null } }
        closing?.let { c -> ConfirmDialog("Close this chat?", "${c.title}\n\nThe agent is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(c.id) }) { closing = null } }
    }
}

// Nest under: the other chats as a searchable list, folder on the right.
@Composable
private fun NestSheet(hub: Hub, id: String, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val chats by hub.workspace.collectAsState()
    Sheet(onDismiss, "Nest under") {
        SearchField(query, { query = it }, "Search chats")
        nestTargets(chats.saved, id, query).take(50).forEach { c ->
            ListRow(c.title.ifBlank { "Untitled" }, AnnotatedString(c.cwd.substringAfterLast('/')), lines = 1, metaLines = 1, onClick = { hub.nest(id, c.sessionId); onDismiss() })
        }
    }
}

// Move to section: the other sections with counts, and New section from the typed name.
@Composable
private fun SectionSheet(hub: Hub, id: String, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val chats by hub.workspace.collectAsState()
    val (list, fresh) = sectionChoices(chats.saved, chats.saved.firstOrNull { it.sessionId == id }?.section, query)
    Sheet(onDismiss, "Move to section") {
        SearchField(query, { query = it }, "Section name")
        list.filter { query.isBlank() || it.first.contains(query.trim(), ignoreCase = true) }.forEach { (name, n) ->
            ListRow(name, AnnotatedString(n.toString()), lines = 1, metaLines = 1, onClick = { hub.section(id, name); onDismiss() })
        }
        fresh?.let { n -> ListRow("New section \"$n\"", leading = { AvIcon("add", tint = av.fgMuted) }, onClick = { hub.section(id, n); onDismiss() }) }
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

    private fun actions(sessionId: String?, title: String, liveChat: LiveChat?, state: ChatState? = null): RowActions {
        val busy = liveChat?.let { it.running || it.pending > 0 } == true
        return RowActions(
            onRetry = liveChat?.takeIf { state == ChatState.Failed && !hub.readOnly }?.let { c -> { hub.open(c.id); hub.retryTurn(c.id) } },
            pinned = sessionId != null && sessionId in pins,
            onPin = { sessionId?.let { hub.pin(it, it !in pins) } },
            onRename = { sessionId?.let { dialogs.renaming = it to title } },
            onNest = { sessionId?.let { dialogs.nesting = it } },
            onUnnest = sessionId?.takeIf { saved[it]?.nestedIn != null }?.let { id -> { hub.nest(id, "") } },
            onSection = { sessionId?.let { dialogs.sectioning = it } },
            onUnsection = sessionId?.takeIf { saved[it]?.section != null }?.let { id -> { hub.section(id, "") } },
            onClose = liveChat?.let { c -> { if (busy) dialogs.closing = c else hub.closeChat(c.id) } },
            onArchive = { sessionId?.let { dialogs.archiving = it to title } },
            canPin = sessionId != null,
            onUnread = { sessionId?.let { hub.markUnread(it) } },
            muted = sessionId != null && sessionId in muted,
            onMute = { sessionId?.let { hub.setMuted(it, it !in muted) } },
            onLink = { sessionId?.let { clipboard.setText(AnnotatedString("${hub.origin.value}/?session=$it")); hub.notice.value = "Link copied" } },
            onSwipePin = sessionId?.takeIf { !hub.readOnly }?.let { id -> { hub.pin(id, id !in pins, undo = true) } },
            onSwipeArchive = sessionId?.takeIf { !hub.readOnly && !busy }?.let { id -> { hub.archive(id) } },
        )
    }

    fun openSaved(sessionId: String, find: FindRequest? = null) {
        scope.launch {
            hub.findRequest.value = find
            if (hub.openSaved(sessionId)) onOpen() else hub.findRequest.value = null
        }
    }

    @Composable
    fun Row(item: ChatItem) {
        if (item.live != null) LiveRow(item.live, item.repo) else SavedRow(item.saved!!, item.repo)
    }

    @Composable
    fun LiveRow(c: LiveChat, repo: String? = null) {
        val s = c.sessionId?.let { saved[it] }
        val branch = chatBranch(s?.gitBranch, repoBranch(c.cwd))
        val builds = buildsState(live, s?.buildMembers)
        val state = chatState(c, s, seen, builds)
        val id = saved.rowId(c.sessionId)
        // Claude.app's hover card on a waiting row, as a sheet: a tap on the ask line answers it without opening the chat.
        val asked = c.asked?.takeIf { !hub.readOnly && c.id != shownId }
        var asking by remember(c.id) { mutableStateOf(false) }
        if (asking && asked != null) Sheet({ asking = false }, c.title.ifBlank { "Untitled" }, full = false) {
            CompositionLocalProvider(LocalCardChat provides c.id) { PendingCard(asked, "", hub) }
        }
        Column { ChatRow(
            title = c.title.ifBlank { "Untitled" },
            meta = liveMeta(c, s, repo, branch, prFor(c), if (asked != null) ({ asking = true }) else null),
            state = state,
            selected = c.id == shownId,
            actions = actions(id, s?.title?.ifBlank { null } ?: c.title, c, state),
            run = c.run,
            onResume = if (c.stalled) ({ hub.resume(c.id) }) else null,
            onClick = { hub.open(c.id); onOpen() },
        )
        BuildRows(hub, s?.sessionId, s?.buildMembers, builds, onOpen)
        id?.let { NestedRows(it) } }
    }

    @Composable
    private fun liveMeta(c: LiveChat, s: SavedSession?, repo: String?, branch: String?, pr: PrChip?, onAsk: (() -> Unit)? = null): AnnotatedString {
        draftSnippet(hub.draft(c.id))?.let { return draftMeta(it) }
        val line = c.edits?.takeIf { !c.running && c.pending == 0 && (it.add > 0 || it.del > 0) }
        val when_ = when {
            c.pending > 0 -> metaLine(c.ask, since(c.lastActive))
            c.stalled -> "No activity for 15 min"
            c.running -> c.status.ifBlank { "Working" }
            else -> metaLine(since(maxOf(c.lastActive, s?.lastModified ?: 0)), askLine(c.run))
        }
        val text = metaLine(repo, branch, s?.subs, c.model?.let(::shortModel), providerMark(c.provider), when_, pr?.text, c.todos?.let { "${it.done}/${it.total}" })
        val ask = c.ask?.takeIf { onAsk != null && c.pending > 0 }?.let { text.indexOf(it) } ?: -1
        return buildAnnotatedString {
            if (ask < 0) append(text) else {
                append(text.substring(0, ask))
                withLink(LinkAnnotation.Clickable("ask", TextLinkStyles(SpanStyle(color = av.accent))) { onAsk?.invoke() }) { append(c.ask!!) }
                append(text.substring(ask + c.ask!!.length))
            }
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
        val branch = chatBranch(s.gitBranch, repoBranch(s.cwd))
        val builds = buildsState(live, s.buildMembers)
        Column { ChatRow(
            title = (if (opening.value == s.sessionId) "Opening… " else "") + s.title.ifBlank { "Untitled" },
            meta = draftSnippet(hub.draftOfSession(s.sessionId))?.let { draftMeta(it) }
                ?: AnnotatedString(s.summary?.takeIf { it.isNotBlank() }?.let { metaLine(since(s.lastModified), s.subs, it) } ?: metaLine(repo, branch, s.subs, providerMark(s.provider), since(s.lastModified))),
            state = chatState(null, s, seen, builds),
            selected = false,
            actions = actions(s.sessionId, s.title, null),
            onClick = { scope.launch { opening.value = s.sessionId; if (hub.openSaved(s.sessionId)) onOpen(); opening.value = null } },
        )
        BuildRows(hub, s.sessionId, s.buildMembers, builds, onOpen)
        NestedRows(s.sessionId) }
    }

    private val nested by lazy { nestedRows(ws.saved) }

    // The chats nested under a row, indented below it; a tap opens one.
    @Composable
    private fun NestedRows(parent: String) {
        nested[parent]?.forEach { c ->
            Box(Modifier.padding(start = Tokens.sp16)) {
                ListRow(c.title.ifBlank { "Untitled" }, AnnotatedString(since(c.lastModified)), lines = 1, metaLines = 1, leading = { AvIcon("indent", tint = av.fgMuted) },
                    onClick = { openSaved(c.sessionId) },
                    menu = if (hub.readOnly) null else { close -> MenuItem("Un-nest", "debug-step-out", { close(); hub.nest(c.sessionId, "") }) })
            }
        }
    }
}

@Composable
private fun draftMeta(draft: String) = buildAnnotatedString {
    withStyle(SpanStyle(color = av.err)) { append("Draft: ") }
    append(draft)
}

class RowActions(val pinned: Boolean, val canPin: Boolean, val onPin: () -> Unit, val onRename: () -> Unit, val onClose: (() -> Unit)?, val onArchive: () -> Unit, val onUnread: () -> Unit = {}, val muted: Boolean = false, val onMute: () -> Unit = {}, val onLink: () -> Unit = {}, val onRetry: (() -> Unit)? = null, val onSwipePin: (() -> Unit)? = null, val onSwipeArchive: (() -> Unit)? = null, val onNest: () -> Unit = {}, val onUnnest: (() -> Unit)? = null, val onSection: () -> Unit = {}, val onUnsection: (() -> Unit)? = null)

@Composable
fun RepoRow(g: RepoGroup, seen: Map<String, Long>, live: List<LiveChat>, onClick: () -> Unit) {
    val glance = groupGlance(g, seen, live)
    val chats = g.open.size + g.recent.size
    val meta = when {
        chats == 0 -> "No chats"
        g.open.isNotEmpty() -> metaLine("${g.open.size} open", since(g.last))
        else -> metaLine(plural(chats, "chat"), since(g.last))
    }
    ListRow(g.name, meta, leading = { RepoMark(g.name) }, onClick = onClick, trailing = {
        folderBadge(glance)?.let { Badge("${it.count}", BadgeTone.New, Modifier.semantics { contentDescription = it.label }) }
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

internal fun boldIf(on: Boolean, title: String): CharSequence = if (on) buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(title) } } else title

@Composable
internal fun StateDot(state: ChatState?) {
    val (d, word) = when (state) {
        ChatState.Needs -> DotState.Warn to "Needs you"
        ChatState.Failed -> DotState.Bad to "Failed"
        ChatState.Running -> DotState.Running to "Running"
        ChatState.Done -> DotState.Unread to "Unread"
        null -> DotState.Idle to null
    }
    StatusDot(d, desc = word)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatRow(title: String, meta: androidx.compose.ui.text.AnnotatedString, state: ChatState?, selected: Boolean, actions: RowActions, onClick: () -> Unit, run: LiveRun? = null, onResume: (() -> Unit)? = null) {
    val badge = run?.let { runBadge(it) }
    val shown = if (badge == RunBadge.Needs) ChatState.Needs else state
    // Like Slack's unread channels, a chat with a reply or question you have not opened has a bold title.
    val unread = shown == ChatState.Done || shown == ChatState.Needs
    val body = @Composable { Box(Modifier.background(av.groupCard)) { ChatListRow(title, meta, shown, unread, selected, actions, onClick, run, badge, onResume) } }
    if (actions.onSwipePin == null) return body()
    val pin by rememberUpdatedState(actions.onSwipePin)
    val archive by rememberUpdatedState(actions.onSwipeArchive)
    val haptic = LocalHapticFeedback.current
    val swipe = rememberSwipeToDismissBoxState(confirmValueChange = { v ->
        when (v) {
            SwipeToDismissBoxValue.StartToEnd -> { haptic.performHapticFeedback(HapticFeedbackType.Confirm); pin?.invoke() }
            SwipeToDismissBoxValue.EndToStart -> archive?.let { haptic.performHapticFeedback(HapticFeedbackType.Confirm); it() }
            else -> {}
        }
        false
    })
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromEndToStart = actions.onSwipeArchive != null,
        backgroundContent = {
            when (swipe.dismissDirection) {
                SwipeToDismissBoxValue.StartToEnd -> SwipeLabel(av.accentSoft, if (actions.pinned) "pinned" else "pin", if (actions.pinned) "Unpin" else "Pin", av.onSecondaryContainer, start = true)
                SwipeToDismissBoxValue.EndToStart -> SwipeLabel(av.errContainer, "archive", "Archive", av.onErrContainer)
                else -> SwipeLabel(av.groupCard)
            }
        },
        content = { body() },
    )
}

@Composable
internal fun ChatListRow(title: String, meta: AnnotatedString, shown: ChatState?, unread: Boolean, selected: Boolean, actions: RowActions, onClick: () -> Unit, run: LiveRun?, badge: RunBadge?, onResume: (() -> Unit)?) {
    ListRow(
        boldIf(unread, title),
        meta, lines = 1, metaLines = 1, selected = selected, onClick = onClick,
        onLongClick = if (actions.canPin) actions.onRename else null,
        leading = { StateDot(shown) }, leadMin = Tokens.sp4,
        state = when {
            run != null && badge != null && badge != RunBadge.Needs -> ({ RunBadgeView(badge, run) })
            actions.muted -> ({ AvIcon("bell-slash", tint = av.fgMuted) })
            else -> null
        },
        menu = { close ->
            actions.onRetry?.let { r -> MenuItem("Retry", "refresh", { close(); r() }) }
            if (onResume != null) MenuItem("Resume", "play", { close(); onResume() })
            if (actions.canPin) MenuItem(if (actions.pinned) "Unpin" else "Pin", if (actions.pinned) "pinned" else "pin", { close(); actions.onPin() })
            if (actions.canPin && shown == null && !selected) MenuItem("Mark as unread", "mail", { close(); actions.onUnread() })
            if (actions.canPin) MenuItem(if (actions.muted) "Unmute" else "Mute", if (actions.muted) "bell" else "bell-slash", { close(); actions.onMute() })
            if (actions.canPin) MenuItem("Copy link", "link", { close(); actions.onLink() })
            if (actions.canPin) MenuItem("Rename", "edit", { close(); actions.onRename() })
            if (actions.canPin) MenuItem("Nest under…", "indent", { close(); actions.onNest() })
            actions.onUnnest?.let { u -> MenuItem("Un-nest", "debug-step-out", { close(); u() }) }
            if (actions.canPin) MenuItem("Move to section…", "list-tree", { close(); actions.onSection() })
            actions.onUnsection?.let { u -> MenuItem("Remove from section", "close", { close(); u() }) }
            actions.onClose?.let { c -> MenuItem("Close chat", "close", { close(); c() }) }
            if (actions.canPin) { MenuSeparator(); MenuItem("Archive", "archive", { close(); actions.onArchive() }, danger = true) }
        },
    )
}
