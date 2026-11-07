package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

// MCP Servers (web/src/ops/McpStatus.tsx): the probed servers with the chat's live state, by Work and Personal, and a detail page.
@Composable
fun McpScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    var refresh by remember { mutableStateOf(false) }
    var accounts by remember { mutableStateOf<Map<String, List<McpConnector>>>(emptyMap()) }
    val (probe, reprobe) = rememberLoad(chat) {
        val q = if (refresh) "?refresh=1" else ""
        refresh = false
        hub.quietCommand(mcpStatusCmd())
        coroutineScope {
            launch {
                runCatching { parseConnectors(hub.read("/api/mcp/connectors$q")) }.onSuccess { a ->
                    accounts = a
                    val s = hub.store.state.value.session
                    mcpLoggedInSince(s?.mcp ?: emptyList(), s?.account, a).forEach { hub.quietCommand(mcpReconnectCmd(it)) }
                }
            }
            parseMcp(hub.read("/api/mcp/probe$q"))
        }
    }
    var groups by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(Unit) { runCatching { groups = protocolJson.decodeFromString(MapSerializer(String.serializer(), String.serializer()), hub.read("/api/mcp/groups")) } }
    var sel by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    var showHidden by rememberSaveable { mutableStateOf(false) }
    val live = st.session?.mcp ?: emptyList()
    val account = st.session?.account
    val rows = remember(probe.data, live, account, accounts) { mcpWithAccounts(mergeMcp(probe.data ?: emptyList(), live), account, accounts) }
    val calls = remember(st.events) { mcpCalls(st.events) }
    val sections = remember(rows, groups) { mcpSections(rows, groups) }

    fun setGroup(service: String, group: String) {
        val before = groups
        groups = if (group == "shown") groups - service else groups + (service to group)
        hub.write("/api/mcp/groups", mcpGroupBody(service, group), "Could not save the group") { ok -> if (!ok) groups = before }
    }

    val current = rows.firstOrNull { mcpKey(it) == sel }
    if (current != null) { McpDetail(hub, current, calls[mcpSlug(current.name)], groups, ::setGroup, onBack = { sel = null }); return }

    val shown = sections.work + sections.personal
    val ok = shown.count { it.status == "connected" }
    val need = shown.count { mcpNeedsYou(it) }
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "MCP Servers", onBack, sub = if (probe.data != null) "$ok connected of ${shown.size}" + if (need > 0) " · $need need you" else "" else null) {
            Button(if (probe.busy) "Checking" else "Check", { refresh = true; reprobe() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !probe.busy)
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                item { ErrorHint(probe.error) }
                if (probe.data == null && probe.error.isEmpty()) item { Hint("Checking the servers") }
                if (probe.data != null && rows.isEmpty()) item { EmptyState("No MCP servers yet", "Add one with claude mcp add or connect one on claude.ai, then check again.") }
                listOf("Work" to sections.work, "Personal" to sections.personal).forEach { (label, list) ->
                    if (list.isNotEmpty()) {
                        item { SectionHeader(label, list.size.toString()) }
                        item { McpGroup(list, calls) { sel = mcpKey(it) } }
                    }
                }
                if (sections.hidden.isNotEmpty()) {
                    item { SectionHeader("Hidden", sections.hidden.size.toString(), open = showHidden, onToggle = { showHidden = !showHidden }) }
                    if (showHidden) item { McpGroup(sections.hidden, calls) { sel = mcpKey(it) } }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

@Composable
private fun McpGroup(rows: List<McpRow>, calls: Map<String, Pair<Int, Int>>, onOpen: (McpRow) -> Unit) {
    Group {
        rows.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            val (label, tone) = mcpState(r)
            ListRow(mcpShortName(r.name), mcpMeta(r, calls[mcpSlug(r.name)]).ifEmpty { null }, lines = 1, trailing = { Badge(if (r.status == "needs-auth" && tone == BadgeTone.Waiting) "Needs you" else label, tone) }, onClick = { onOpen(r) })
        }
    }
}

@Composable
private fun McpDetail(hub: Hub, r: McpRow, calls: Pair<Int, Int>?, groups: Map<String, String>, setGroup: (String, String) -> Unit, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val (label, tone) = mcpState(r)
    val (scope, where) = mcpScope(r.server.scope)
    var q by rememberSaveable(r.name) { mutableStateOf("") }
    val link = openLink()
    val hidden = groups[mcpHideKey(r)] == "hidden"
    val group = if (r.account != null) (if (r.account == "main") "personal" else "work") else if (groups[mcpGroupKey(r)] == "personal") "personal" else "work"
    val tools = (r.server.tools ?: emptyList()).filter { q.isEmpty() || it.name.contains(q, true) || it.description.contains(q, true) }
    val url = r.server.command?.startsWith("http") == true
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, mcpShortName(r.name), onBack, sub = label) {
            MoreButton { close ->
                MenuItem(if (hidden) "Show" else "Hide", { close(); setGroup(mcpHideKey(r), if (hidden) "shown" else "hidden") })
                if (r.account == null) MenuItem("Move to ${if (group == "work") "Personal" else "Work"}", { close(); setGroup(mcpGroupKey(r), if (group == "work") "personal" else "work") })
                if (url) MenuItem("Open URL", { close(); link(r.server.command) })
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                if (r.live) item {
                    Row(Modifier.padding(horizontal = Tokens.sp6, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        if (r.status == "failed" || r.status == "needs-auth") Button("Reconnect in chat", { hub.command(mcpReconnectCmd(r.name)) }, size = ButtonSize.Sm)
                        if (r.status == "disabled") Button("Enable", { hub.command(mcpToggleCmd(r.name, true)) }, size = ButtonSize.Sm)
                        else Button("Disable for this chat", { hub.command(mcpToggleCmd(r.name, false)) }, size = ButtonSize.Sm)
                    }
                }
                item {
                    Group(Modifier.padding(top = Tokens.sp4)) {
                        ListRow("Status", label + (r.server.version?.let { " · v$it" } ?: ""), trailing = { Badge(label, tone) })
                        r.server.error?.takeIf { r.live || r.status != "needs-auth" }?.let { Hairline(); ListRow("Error", it, lines = 3) }
                        r.server.command?.let { Hairline(); ListRow(if (url) "URL" else "Command", it) }
                        r.server.env?.takeIf { it.isNotEmpty() }?.let { Hairline(); ListRow("Env", it.joinToString("  ")) }
                        Hairline(); ListRow("From", scope + if (where.isNotEmpty()) " · $where" else "")
                        Hairline(); ListRow("In chat", if (r.live) "Loaded" else "Not loaded")
                        Hairline(); ListRow(if (r.account != null) "Account" else "Group", if (r.account != null) r.account else if (group == "work") "Work" else "Personal")
                        calls?.let { (n, e) -> Hairline(); ListRow("Used in this chat", plural(n, "call") + if (e > 0) " · ${plural(e, "error")}" else "") }
                    }
                }
                item { SectionHeader("Tools", (r.server.tools?.size ?: 0).toString()) }
                if ((r.server.tools?.size ?: 0) > 6) item { SearchField(q, { q = it }, "Filter") }
                item {
                    Group {
                        if (tools.isEmpty()) EmptyState("No tools")
                        tools.forEachIndexed { i, t ->
                            if (i > 0) Hairline()
                            Column(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4)) {
                                Text(t.name, style = Mono, color = av.fg)
                                if (t.description.isNotEmpty()) Text(firstLine(t.description), style = Type.subheadline, color = av.fgMuted, maxLines = 3)
                            }
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}
