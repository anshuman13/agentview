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
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
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
import no.pradhan.agentview.nativeapp.workspace.pageRepo
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuLabel
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.Type
import androidx.compose.material3.Text
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Box
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.motionOff
import no.pradhan.agentview.nativeapp.workspace.ErrorHint
import no.pradhan.agentview.nativeapp.workspace.Hint
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.openLink
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.ui.plural

// MCP Servers (web/src/ops/McpStatus.tsx): the probed servers with the chat's live state, grouped by where they come from, with status and source filter chips, and a detail page.
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
    var query by rememberSaveable { mutableStateOf("") }
    val live = session?.mcp ?: emptyList()
    val account = session?.account
    val rows = remember(probe.data, live, account, accounts, connectors) { mergeMcp(probe.data ?: emptyList(), live).let { if (connectors) mcpWithAccounts(it, account, accounts) else it } }
    val calls = remember(events) { mcpCalls(events) }
    val sections = remember(rows, groups) { mcpSections(rows, groups) }
    val personal = remember(sections) { sections.personal.map(::mcpKey).toSet() }
    var saved by remember { mutableStateOf(hub.prefs.getString("mcpFilter", null)?.split("|")?.takeIf { it.size == 2 }?.let { McpFilter(it[0], it[1]) } ?: McpFilter()) }
    fun setFilter(f: McpFilter) { saved = f; hub.prefs.edit().putString("mcpFilter", "${f.show}|${f.where}").apply() }
    val shownRows = remember(sections) { sections.work + sections.personal }
    val hidden = remember(sections) { sections.hidden.map(::mcpKey).toSet() }
    val isHidden = { r: McpRow -> mcpKey(r) in hidden }
    val searched = remember(rows, query) { rows.filter { mcpMatches(it, query) } }
    val menu = remember(searched, saved, hidden) { mcpFilterCounts(searched, saved, isHidden) }
    val filter = mcpValidFilter(saved, menu)
    val narrowed = query.isNotBlank() || filter != McpFilter()
    val list = remember(searched, filter, hidden) { mcpList(searched, filter, isHidden) }

    fun setGroup(service: String, group: String) {
        val before = groups
        hub.mcpGroups.value = if (group == "shown") groups - service else groups + (service to group)
        hub.saveMcpGroup(service, group) { ok -> if (!ok) hub.mcpGroups.value = before }
    }

    val shown = sel?.takeIf { s -> rows.any { mcpKey(it) == s } }
    val still = motionOff()
    val mcp = remember(shownRows) { mcpStatusCounts(shownRows) }
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
            if (!hub.readOnly) McpAddMenu(hub, connectors, account)
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize(), listState) {
                item { ErrorHint(probe.error) }
                if (probe.data == null && probe.error.isEmpty()) item { Loading("Checking the servers…") }
                if (probe.data != null && rows.isEmpty()) item { EmptyState("No MCP servers yet", "Servers you add show here", action = { SetupButton(hub, "mcp", mcpCommand = if (connectors) "claude mcp add" else "codex mcp add") }, icon = "plug") }
                if (!connectors) item { Hint("claude.ai connectors load in Claude chats only") }
                if (probe.data != null && rows.isNotEmpty()) item {
                    Row(Modifier.padding(end = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                        SearchField(query, { query = it }, "Search", Modifier.weight(1f))
                        McpFilterMenu(menu, filter, ::setFilter)
                    }
                }
                if (narrowed && list.isEmpty()) item { EmptyState("No servers match", icon = "search", action = { Button("Clear filters", { query = ""; setFilter(McpFilter()) }, size = ButtonSize.Sm) }) }
                if (list.isNotEmpty()) item(key = "rows") { McpGroup(list, personal) { sel = mcpKey(it) } }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    }
}

// web ToolInputs: the whole description, then each input with its type, whether it is required and its description.
@Composable
private fun McpToolSheet(t: McpTool, onDismiss: () -> Unit) {
    val props = (t.inputSchema?.get("properties") as? JsonObject).orEmpty()
    val required = (t.inputSchema?.get("required") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
    Sheet(onDismiss, t.title ?: t.name, padded = false, full = false) {
        if (t.description.isNotBlank()) Text(t.description, Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), style = Type.body, color = av.fgMuted)
        if (props.isNotEmpty()) {
            SectionHeader("Inputs", props.size.toString())
            Group {
                props.entries.forEachIndexed { i, (name, p) ->
                    if (i > 0) Hairline()
                    val o = p as? JsonObject
                    val type = listOfNotNull((o?.get("type") as? JsonPrimitive)?.contentOrNull, "required".takeIf { name in required }).joinToString(" · ")
                    Column(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                            Text(name, style = Mono, color = av.fg)
                            if (type.isNotEmpty()) Text(type, style = Type.caption, color = av.fgMuted)
                        }
                        (o?.get("description") as? JsonPrimitive)?.contentOrNull?.let { Text(it, style = Type.footnote, color = av.fgMuted) }
                    }
                }
            }
        }
    }
}

// web AddMenu: add a server through the chat, or a claude.ai connector on claude.ai.
@Composable
private fun McpAddMenu(hub: Hub, connectors: Boolean, account: String?) {
    var open by remember { mutableStateOf(false) }
    val prompt = setupPrompt("mcp", pageRepo(hub), if (connectors) "claude mcp add" else "codex mcp add")
    val provider by hub.store.state.select { it.session?.provider }
    Box {
        IconBtn("add", "Add", { open = true })
        Menu(open, { open = false }) {
            MenuItem("Add MCP server with ${providerLabel(provider)}", "terminal", { open = false; hub.askChat(prompt) })
            if (connectors) MenuItem("Add claude.ai connector", "globe", { open = false; hub.openConnectors(account) {} })
        }
    }
}

// The filter menu (web FilterMenu): Show, then Source when rows come from more than one place, with a check on the current one.
@Composable
private fun McpFilterMenu(menu: McpMenu, filter: McpFilter, onChange: (McpFilter) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconBtn("list-filter", "Filter", { open = true }, on = filter != McpFilter())
        Menu(open, { open = false }) {
            MenuLabel("Show")
            menu.show.forEach { (k, _) -> MenuItem(MCP_SHOWS.first { it.first == k }.second, "", { open = false; onChange(filter.copy(show = k)) }, checked = filter.show == k) }
            if (menu.where.size > 2) {
                MenuSeparator()
                MenuLabel("Source")
                menu.where.forEach { (k, _) -> MenuItem(mcpWhereLabel(k), "", { open = false; onChange(filter.copy(where = k)) }, checked = filter.where == k) }
            }
        }
    }
}

// One row per server, by name (web ServiceRow): Web or Local icon, name, Type and Source under it, and the status at the end; Off rows are greyed.
@Composable
private fun McpGroup(rows: List<McpRow>, personal: Set<String>, onOpen: (McpRow) -> Unit) {
    Group {
        rows.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            ListRow(
                mcpShortName(r.name), mcpMeta(r, mcpKey(r) in personal),
                leading = { McpIcon(r) },
                trailing = { McpStatus(r) },
                lines = 1, metaLines = 1, muted = mcpStatusGroup(r) == "Off", onClick = { onOpen(r) },
            )
        }
    }
}

// web ServerIcon: the Web or Local glyph in a small bordered tile, like Claude's connector logos.
@Composable
private fun McpIcon(r: McpRow) {
    val shape = RoundedCornerShape(Tokens.radiusSm)
    Box(Modifier.size(32.dp).background(av.raised, shape).border(Tokens.hairline, av.border, shape), contentAlignment = Alignment.Center) {
        AvIcon(if (mcpType(r) == "Web") "globe" else "terminal", null, Tokens.iconSm, tint = av.fgMuted)
    }
}

// The status at the end of a row (web StatusCell): a check when connected, a pulsing dot while connecting, else the reason.
@Composable
private fun McpStatus(r: McpRow) {
    val (label, tone) = mcpState(r)
    when {
        r.status == "pending" || r.status == "probing" -> StatusDot(DotState.Busy, desc = label)
        tone == BadgeTone.Done -> AvIcon("check", label, Tokens.iconMd, tint = av.fgMuted)
        else -> Text(label, style = Type.footnote, color = if (tone == BadgeTone.Failed) av.err else av.fgMuted, maxLines = 1)
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
    val label = if (opened && kind != McpLogin.ClaudeAi) "Open again" else "Connect"
    ListRow("Connect", hint, metaLines = 3, trailing = {
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
    val tools = (r.server.tools ?: emptyList()).filter { q.isEmpty() || it.name.contains(q, true) || it.title?.contains(q, true) == true || it.description.contains(q, true) }
    val url = r.server.command?.startsWith("http") == true
    var toolSheet by remember(r.name) { mutableStateOf<McpTool?>(null) }
    toolSheet?.let { McpToolSheet(it) { toolSheet = null } }
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
                        mcpUsage(r, calls)?.let { Hairline(); ListRow("Used in this chat", it) }
                    }
                }
                if ((r.server.tools?.size ?: 0) > 6) item { SearchField(q, { q = it }, "Filter tools") }
                if (tools.isEmpty()) item {
                    SectionHeader("Tools", (r.server.tools?.size ?: 0).toString())
                    Group { mcpNoTools(r).let { (title, hint) -> EmptyState(if (r.server.tools.isNullOrEmpty()) title else "No tool matches", hint.takeIf { r.server.tools.isNullOrEmpty() }) } }
                }
                mcpToolGroups(tools).filter { it.second.isNotEmpty() }.forEach { (name, list) ->
                    item(key = name) { SectionHeader(name, list.size.toString()) }
                    item(key = "$name-rows") {
                        Group {
                            list.forEachIndexed { i, t ->
                                if (i > 0) Hairline()
                                ListRow(t.title ?: t.name, firstLine(t.description).ifEmpty { null }, metaLines = 2, below = mcpToolInputs(t.inputSchema)?.let { ins -> { Text(ins, style = Type.footnote, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) } }, trailing = if (canUse) ({ IconBtn("comment", "Add ${t.name} to chat", { use(Use(r.name, t.name)) }) }) else null, onClick = { toolSheet = t })
                            }
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}
