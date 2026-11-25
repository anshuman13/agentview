package no.pradhan.agentview.nativeapp.ops

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.IntOffset
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.chat.ACCOUNT_LABEL
import no.pradhan.agentview.nativeapp.chat.can
import no.pradhan.agentview.nativeapp.chat.firstLine
import no.pradhan.agentview.nativeapp.codex.firstLine
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.command
import no.pradhan.agentview.nativeapp.app.quietCommand
import no.pradhan.agentview.nativeapp.app.mcpConnectors
import no.pradhan.agentview.nativeapp.app.loginMcp
import no.pradhan.agentview.nativeapp.app.mcpProbe
import no.pradhan.agentview.nativeapp.app.openConnectors
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.chat.Use
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import no.pradhan.agentview.nativeapp.app.refreshMcpGroups
import no.pradhan.agentview.nativeapp.app.saveMcpGroup
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.motionOff
import no.pradhan.agentview.nativeapp.workspace.ErrorHint
import no.pradhan.agentview.nativeapp.workspace.Hint
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.openLink
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.plural

// MCP Servers (web/src/ops/McpStatus.tsx): the probed servers with the chat's live state, in status groups (Connected, Needs login, Failed, Off), and a detail page.
@Composable
fun McpScreen(hub: Hub, onBack: () -> Unit) {
    val chat by hub.store.state.select { it.shownId }
    val session by hub.store.state.select { it.session }
    val events by hub.store.state.select { it.events }
    val connectors = (session?.capabilities ?: Capabilities()).can("connectors")
    var refresh by remember { mutableStateOf(false) }
    var accounts by remember { mutableStateOf<Map<String, List<McpConnector>>>(emptyMap()) }
    val (probe, reprobe) = rememberLoad(chat) {
        val fresh = refresh
        refresh = false
        hub.quietCommand(mcpStatusCmd())
        coroutineScope {
            if (connectors) launch {
                runCatching { hub.mcpConnectors(fresh) }.onSuccess { a ->
                    accounts = a
                    val s = hub.store.state.value.session
                    mcpLoggedInSince(s?.mcp ?: emptyList(), s?.account, a).forEach { hub.quietCommand(mcpReconnectCmd(it)) }
                }
            }
            hub.mcpProbe(fresh)
        }
    }
    val groups by hub.mcpGroups.collectAsState()
    LaunchedEffect(Unit) { hub.refreshMcpGroups() }
    var sel by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    var showHidden by rememberSaveable { mutableStateOf(false) }
    var expanded by rememberSaveable { mutableStateOf(listOf<String>()) }
    var query by rememberSaveable { mutableStateOf("") }
    val live = session?.mcp ?: emptyList()
    val account = session?.account
    val rows = remember(probe.data, live, account, accounts, connectors) { mergeMcp(probe.data ?: emptyList(), live).let { if (connectors) mcpWithAccounts(it, account, accounts) else it } }
    val calls = remember(events) { mcpCalls(events) }
    val sections = remember(rows, groups) { mcpSections(rows, groups) }
    val byStatus = remember(sections) { mcpStatusGroups(sections.work + sections.personal) }
    val personal = remember(sections) { sections.personal.map(::mcpKey).toSet() }
    val filtering = query.isNotBlank()
    val matched = remember(byStatus, query) { if (filtering) byStatus.map { (g, rs) -> g to rs.filter { mcpMatches(it, query) } }.filter { it.second.isNotEmpty() } else byStatus }
    val hiddenMatched = remember(sections, query) { mcpStatusGroups(sections.hidden).flatMap { it.second }.filter { mcpMatches(it, query) } }

    fun setGroup(service: String, group: String) {
        val before = groups
        hub.mcpGroups.value = if (group == "shown") groups - service else groups + (service to group)
        hub.saveMcpGroup(service, group) { ok -> if (!ok) hub.mcpGroups.value = before }
    }

    val shown = sel?.takeIf { s -> rows.any { mcpKey(it) == s } }
    val still = motionOff()
    val mcp = remember(byStatus) { mcpStatusCounts(byStatus) }
    val listState = rememberLazyListState()
    AnimatedContent(shown, Modifier.fillMaxSize(), transitionSpec = {
        val ease = if (targetState != null) Tokens.motionEaseIn else Tokens.motionEaseOut
        val slide = tween<IntOffset>(Tokens.motionDuration, easing = ease)
        val fade = tween<Float>(Tokens.motionDuration, easing = ease)
        (if (still) EnterTransition.None togetherWith ExitTransition.None
        else if (targetState != null) (slideInHorizontally(slide) { it } + fadeIn(fade)) togetherWith fadeOut(fade)
        else fadeIn(fade) togetherWith (slideOutHorizontally(slide) { it } + fadeOut(fade)))
            .apply { targetContentZIndex = if (targetState != null) 1f else -1f }
    }, label = "mcp") { key ->
    val current = rows.firstOrNull { mcpKey(it) == key }
    if (current != null) McpDetail(hub, current, calls[mcpSlug(current.name)], groups, ::setGroup, onBack = { sel = null })
    else Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "MCP Servers", onBack, sub = if (probe.data != null) "${mcp.connected} connected of ${mcp.total}" + if (mcp.needsYou > 0) " · ${mcp.needsYou} need you" else "" else null) {
            IconBtn("refresh", "Check", { refresh = true; reprobe() }, enabled = !probe.busy)
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize(), listState) {
                item { ErrorHint(probe.error) }
                if (probe.data == null && probe.error.isEmpty()) item { Loading("Checking the servers…") }
                if (probe.data != null && rows.isEmpty()) item { EmptyState("No MCP servers yet", "Servers you add show here", action = { SetupButton(hub, "mcp", mcpCommand = if (connectors) "claude mcp add" else "codex mcp add") }, icon = "plug") }
                if (!connectors) item { Hint("claude.ai connectors load in Claude chats only") }
                if (probe.data != null && rows.isNotEmpty()) item { SearchField(query, { query = it }, "Filter servers") }
                if (filtering && matched.isEmpty() && hiddenMatched.isEmpty()) item { EmptyState("No servers match", icon = "search", action = { Button("Clear filter", { query = "" }, size = ButtonSize.Sm) }) }
                matched.forEach { (label, list) ->
                    val folded = !filtering && label !in expanded && list.size > FOLD
                    item { SectionHeader(label, list.size.toString()) }
                    item { McpGroup(if (folded) list.take(FOLD) else list, calls, personal) { sel = mcpKey(it) } }
                    if (folded) item { Button("Show all ${list.size}", { expanded = expanded + label }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
                }
                if (hiddenMatched.isNotEmpty()) {
                    item { SectionHeader("Hidden", hiddenMatched.size.toString(), open = showHidden, onToggle = { showHidden = !showHidden }) }
                    if (showHidden) item { McpGroup(hiddenMatched, calls, personal) { sel = mcpKey(it) } }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    }
}

private const val FOLD = 5

// One row per server: status dot, name, one meta line and the tool count; Off rows are greyed.
@Composable
private fun McpGroup(rows: List<McpRow>, calls: Map<String, Pair<Int, Int>>, personal: Set<String>, onOpen: (McpRow) -> Unit) {
    Group {
        rows.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            val count = mcpToolCount(r)
            ListRow(
                mcpShortName(r.name), mcpMeta(r, calls[mcpSlug(r.name)], mcpKey(r) in personal).ifEmpty { null },
                leading = { StatusDot(mcpDot(r), desc = mcpState(r).first) }, leadMin = Tokens.dot,
                trailing = count?.let { { Badge(it, BadgeTone.Quiet) } },
                lines = 1, metaLines = 1, muted = mcpStatusGroup(r) == "Off", onClick = { onOpen(r) },
            )
        }
    }
}

// web ClaudeAiLogin and Login: the login page opens in a browser on the Mac; the hint says which and what to do next.
@Composable
private fun McpLoginRow(hub: Hub, r: McpRow, kind: McpLogin) {
    var opened by remember(r.name, r.account) { mutableStateOf(false) }
    var busy by remember(r.name, r.account) { mutableStateOf(false) }
    val hint = when {
        kind == McpLogin.ClaudeAi && opened -> "Opened in ${connectorsBrowser(r.account)} on the Mac. Reconnect once it says Connected."
        kind == McpLogin.ClaudeAi -> "Opens in ${connectorsBrowser(r.account)} on the Mac."
        opened -> "Opened in Chrome on the Mac. Reconnect once you finish there."
        else -> "Opens the login page in Chrome on the Mac."
    }
    val label = if (kind == McpLogin.ClaudeAi) "Connect on claude.ai" else if (opened) "Open again" else "Log in"
    ListRow("Log in", hint, metaLines = 3, trailing = {
        Button(label, {
            busy = true
            if (kind == McpLogin.ClaudeAi) hub.openConnectors(r.account) { busy = false; opened = opened || it }
            else hub.loginMcp(r.name, r.live) { busy = false; opened = opened || it }
        }, size = ButtonSize.Sm, enabled = !busy)
    })
}

@Composable
private fun McpDetail(hub: Hub, r: McpRow, calls: Pair<Int, Int>?, groups: Map<String, String>, setGroup: (String, String) -> Unit, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val (label, tone) = mcpState(r)
    val (scope, where) = mcpScope(r.server.scope)
    val caps = hub.store.state.value.session?.capabilities ?: Capabilities()
    val canEdit = caps.can("mcpEdit")
    val canUse = mcpCanUse(r)
    val canManage = caps.can("connectors") && mcpCanManage(r) && !hub.readOnly
    val use = { u: Use -> hub.pendingUse.value = u; hub.link.value = DeepLink(chat = hub.pageChat) }
    var q by rememberSaveable(r.name) { mutableStateOf("") }
    val link = openLink()
    val hidden = groups[mcpHideKey(r)] == "hidden"
    val group = if (r.account != null) (if (r.account == "main") "personal" else "work") else if (groups[mcpGroupKey(r)] == "personal") "personal" else "work"
    val tools = (r.server.tools ?: emptyList()).filter { q.isEmpty() || it.name.contains(q, true) || it.description.contains(q, true) }
    val url = r.server.command?.startsWith("http") == true
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, mcpShortName(r.name), onBack, sub = label) {
            MoreButton { close ->
                MenuItem(if (hidden) "Show" else "Hide", if (hidden) "eye" else "eye-closed", { close(); setGroup(mcpHideKey(r), if (hidden) "shown" else "hidden") })
                if (r.account == null) MenuItem("Move to ${if (group == "work") "Personal" else "Work"}", "arrow-swap", { close(); setGroup(mcpGroupKey(r), if (group == "work") "personal" else "work") })
                if (canEdit && r.live) MenuItem(if (r.status == "disabled") "Enable" else "Disable for this chat", if (r.status == "disabled") "play" else "circle-slash", { close(); hub.command(mcpToggleCmd(r.name, r.status == "disabled")) })
                if (url) MenuItem("Open URL", "link-external", { close(); link(r.server.command) })
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                if (canUse || canManage) item {
                    Row(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        if (canUse) Button("Add to chat", { use(Use(r.name)) }, size = ButtonSize.Sm, icon = "comment")
                        if (canManage) Button("Manage on claude.ai", { hub.openConnectors(r.account) {} }, size = ButtonSize.Sm, icon = "key")
                    }
                }
                item {
                    Group(Modifier.padding(top = Tokens.sp4)) {
                        ListRow("Status", r.server.version?.let { "v$it" }, trailing = {
                            if (r.live && (r.status == "failed" || r.status == "needs-auth")) Button("Reconnect", { hub.command(mcpReconnectCmd(r.name)) }, size = ButtonSize.Sm)
                            else Badge(label, tone)
                        })
                        r.server.error?.takeIf { r.live || r.status != "needs-auth" }?.let { Hairline(); ListRow("Error", it, lines = 3) }
                        if (canEdit && !hub.readOnly) mcpLogin(r)?.let { kind -> Hairline(); McpLoginRow(hub, r, kind) }
                        r.server.command?.let { Hairline(); ListRow(if (url) "URL" else "Command", it) }
                        r.server.env?.takeIf { it.isNotEmpty() }?.let { Hairline(); ListRow("Env", it.joinToString("  ")) }
                        Hairline(); ListRow("From", scope + if (where.isNotEmpty()) " · $where" else "")
                        Hairline(); ListRow("In chat", if (r.live) "Loaded" else "Not loaded")
                        Hairline(); ListRow(if (r.account != null) "Account" else "Group", if (r.account != null) ACCOUNT_LABEL[r.account] ?: r.account else if (group == "work") "Work" else "Personal")
                        if (!canEdit) { Hairline(); ListRow("Edit", "~/.codex/config.toml, then Reconnect") }
                        calls?.let { (n, e) -> Hairline(); ListRow("Used in this chat", plural(n, "call") + if (e > 0) " · ${plural(e, "error")}" else "") }
                    }
                }
                item { SectionHeader("Tools", (r.server.tools?.size ?: 0).toString()) }
                if ((r.server.tools?.size ?: 0) > 6) item { SearchField(q, { q = it }, "Filter") }
                item {
                    Group {
                        if (tools.isEmpty()) mcpNoTools(r).let { (title, hint) -> EmptyState(if (r.server.tools.isNullOrEmpty()) title else "No tool matches", hint.takeIf { r.server.tools.isNullOrEmpty() }) }
                        tools.forEachIndexed { i, t ->
                            if (i > 0) Hairline()
                            ListRow(t.name, firstLine(t.description).ifEmpty { null }, metaLines = 2, trailing = if (t.readOnly || t.destructive || canUse) ({
                                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
                                    if (t.readOnly) Badge("read only", BadgeTone.Done)
                                    if (t.destructive) Badge("destructive", BadgeTone.Waiting)
                                    if (canUse) IconBtn("comment", "Add ${t.name} to chat", { use(Use(r.name, t.name)) })
                                }
                            }) else null)
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}
