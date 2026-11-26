package no.pradhan.agentview.nativeapp.ops

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.chat.ACCOUNT_LABEL
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.isoMillis
import no.pradhan.agentview.nativeapp.ui.plural

// shared/protocol.ts Deploy types, read by web/src/ops/Deploy.tsx.
@Serializable data class DeployRecord(val id: Long = 0, val sha: String = "", val ref: String = "", val state: String = "", val description: String = "", val at: String = "", val by: String = "", val url: String = "")
@Serializable data class DeployEnv(val name: String, val label: String = name, val defaultBranchOnly: Boolean = false, val deployed: DeployRecord? = null, val latest: DeployRecord? = null, val rollbackTo: DeployRecord? = null, val history: List<DeployRecord> = emptyList())
@Serializable data class DeployHead(val sha: String = "", val branch: String = "")
@Serializable data class DeployStatus(val apps: List<String> = emptyList(), val app: String = "", val repo: String = "", val serviceUrl: String = "", val head: DeployHead = DeployHead(), val envs: List<DeployEnv> = emptyList())
@Serializable data class DeployJob(val id: String = "", val lines: List<String> = emptyList(), val done: Boolean = false, val ok: Boolean = false, val url: String = "")

fun parseDeploy(body: String): DeployStatus = protocolJson.decodeFromString(DeployStatus.serializer(), body)
fun parseDeployJob(body: String): DeployJob = protocolJson.decodeFromString(DeployJob.serializer(), body)

fun shortSha(sha: String) = sha.take(7)

fun envMeta(env: DeployEnv, s: DeployStatus, now: Long): String {
    val d = env.deployed ?: return "Nothing deployed"
    return "${d.ref.ifEmpty { s.head.branch }} · ${agoShort(isoMillis(d.at), now, " ago")}" + (if (d.by.isNotEmpty()) " by ${d.by}" else "") + (if (d.sha == s.head.sha) " · HEAD" else "")
}

// The badge of an env whose latest deploy is not the one running: Deployed, Failed or Deploying.
fun envBadge(env: DeployEnv): Pair<String, BadgeTone>? {
    val latest = env.latest ?: return null
    val state = latest.state
    if (state.isEmpty() || state == "inactive" || (latest.id == env.deployed?.id && state == "success")) return null
    return when (state) {
        "success" -> "Deployed" to BadgeTone.Done
        "failure", "error" -> "Failed" to BadgeTone.Failed
        else -> "Deploying" to BadgeTone.Running
    }
}

fun deployWarning(env: DeployEnv) = when {
    "prod" in env.name -> "This is a production environment."
    env.defaultBranchOnly -> "Only the default branch deploys here."
    else -> null
}

fun deployBody(app: String, env: String, ref: String) = buildJsonObject { put("app", app); put("env", env); put("ref", ref) }.toString()
fun rollbackBody(app: String, env: String, sha: String) = buildJsonObject { put("app", app); put("env", env); put("sha", sha) }.toString()

// shared/protocol.ts McpServer and web/src/ops/mcpHelpers.ts.
@Serializable data class McpTool(val name: String, val title: String? = null, val description: String = "", val readOnly: Boolean = false, val destructive: Boolean = false, val inputSchema: JsonObject? = null)

@Serializable
data class McpServer(
    val name: String,
    val status: String = "",
    val scope: String? = null,
    val type: String? = null,
    val command: String? = null,
    val env: List<String>? = null,
    val version: String? = null,
    val ms: Long? = null,
    val error: String? = null,
    val tools: List<McpTool>? = null,
)

data class McpRow(val server: McpServer, val live: Boolean = false, val account: String? = null) {
    val name get() = server.name
    val status get() = server.status
}

fun parseMcp(body: String): List<McpServer> = protocolJson.decodeFromString(kotlinx.serialization.builtins.ListSerializer(McpServer.serializer()), body)

// The probed servers with the chat's live state laid over them; a live server the probe missed is added.
fun mergeMcp(probed: List<McpServer>, live: List<McpServer>): List<McpRow> {
    val rows = probed.map { McpRow(it) }.toMutableList()
    for (m in live) {
        val i = rows.indexOfFirst { it.name == m.name }
        if (i >= 0) {
            val p = rows[i].server
            rows[i] = McpRow(m.copy(scope = p.scope ?: m.scope, tools = if (m.tools?.any { it.description.isNotEmpty() } == true) m.tools else p.tools ?: m.tools, ms = m.ms ?: p.ms, command = m.command ?: p.command, env = m.env ?: p.env), live = true)
        } else rows += McpRow(m, live = true)
    }
    return rows
}

fun mcpState(r: McpRow): Pair<String, BadgeTone> = when {
    r.status == "needs-auth" && !r.live && r.account == null -> "OAuth via Claude" to BadgeTone.Quiet
    else -> when (r.status) {
        "connected" -> "Connected" to BadgeTone.Done
        "failed" -> "Failed" to BadgeTone.Failed
        "needs-auth" -> "Needs login" to BadgeTone.Waiting
        "pending" -> "Connecting" to BadgeTone.Waiting
        "disabled" -> "Disabled" to BadgeTone.Quiet
        "probing" -> "Checking" to BadgeTone.Waiting
        else -> r.status to BadgeTone.Quiet
    }
}

fun mcpShortName(name: String) = name.removePrefix("claude.ai ")

private fun splitMcpName(name: String): String {
    val i = name.indexOfFirst { it == '_' || it == '-' }
    return if (i > 0) name.substring(0, i) else name
}

fun mcpGroupKey(r: McpRow) = splitMcpName(r.name)
fun mcpHideKey(name: String) = "hide:${splitMcpName(name)}"
fun mcpHideKey(r: McpRow) = mcpHideKey(r.name)

fun mcpScope(scope: String?): Pair<String, String> = when (scope) {
    "user" -> "Your servers" to "~/.claude.json"
    "project" -> "This repo" to ".mcp.json"
    "local" -> "This folder" to "~/.claude.json · project entry"
    "codex" -> "Codex config" to "~/.codex/config.toml"
    "claudeai" -> "Claude.ai connectors" to "claude.ai settings"
    "plugin" -> "Plugins" to "Claude Code plugins"
    null -> "Other" to ""
    else -> scope.replaceFirstChar { it.uppercase() } to ""
}

data class McpSections(val work: List<McpRow>, val personal: List<McpRow>, val hidden: List<McpRow>)

// Rows by Work and Personal (claude.ai connectors by their account), hidden services apart, each sorted by name.
fun mcpSections(rows: List<McpRow>, groups: Map<String, String>): McpSections {
    val sorted = rows.sortedBy { it.name.lowercase() }
    val (hidden, shown) = sorted.partition { groups[mcpHideKey(it)] == "hidden" }
    val personal = { r: McpRow -> if (r.account != null) r.account == "main" else groups[mcpGroupKey(r)] == "personal" }
    return McpSections(shown.filterNot(personal), shown.filter(personal), hidden)
}

val MCP_STATUS_GROUPS = listOf("Connected", "Needs login", "Failed", "Off")

fun mcpStatusGroup(r: McpRow) = when (r.status) {
    "connected", "pending", "probing" -> "Connected"
    "needs-auth" -> "Needs login"
    "failed" -> "Failed"
    else -> "Off"
}

// The filter menu (web McpFilter): Show is all, connected, not-connected or hidden; Source is "servers", an account id or "all".
data class McpFilter(val show: String = "all", val where: String = "all")
data class McpMenu(val show: List<Pair<String, Int>>, val where: List<Pair<String, Int>>)

val MCP_SHOWS = listOf("all" to "All servers", "connected" to "Connected", "not-connected" to "Not connected", "hidden" to "Hidden")
private val MCP_ACCOUNTS get() = ACCOUNT_LABEL.keys.toList()

fun mcpWhere(r: McpRow) = if (r.server.type == "claudeai" && r.account != null) r.account else "servers"
fun mcpWhereLabel(w: String) = when (w) { "all" -> "All sources"; "servers" -> "Configured servers"; else -> ACCOUNT_LABEL[w] ?: w }

// The Type and Source of a row, like Claude's Connectors page (web typeOf, tagOf, sourceOf).
fun mcpType(r: McpRow) = if (r.server.type in listOf("claudeai", "http", "sse") || r.server.command?.startsWith("http") == true) "Web" else "Local"
fun mcpTag(r: McpRow) = when (r.server.scope) { "plugin" -> "Plugin"; "project" -> "Repo"; "local" -> "Folder"; "codex" -> "Codex"; else -> null }
fun mcpSource(r: McpRow) = if (r.server.type == "claudeai") r.account?.let { ACCOUNT_LABEL[it] ?: it } ?: "Claude.ai" else mcpScope(r.server.scope).first

private fun mcpShows(r: McpRow, show: String, hidden: Boolean) =
    if (show == "hidden") hidden else !hidden && (show == "all" || (show == "connected") == (mcpStatusGroup(r) == "Connected"))

// The rows the filter lets through, by name; the same name from several accounts follows the Source order (web mcpList).
fun mcpList(rows: List<McpRow>, f: McpFilter, isHidden: (McpRow) -> Boolean): List<McpRow> {
    val order = listOf("servers") + MCP_ACCOUNTS
    return rows.filter { mcpShows(it, f.show, isHidden(it)) && (f.where == "all" || mcpWhere(it) == f.where) }
        .sortedWith(compareBy({ mcpShortName(it.name).lowercase() }, { order.indexOf(mcpWhere(it)) }))
}

// Menu counts: the Show items count the rows the Source lets through, and the other way round; empty sources are left out (web filterCounts).
fun mcpFilterCounts(rows: List<McpRow>, f: McpFilter, isHidden: (McpRow) -> Boolean) = McpMenu(
    MCP_SHOWS.map { (k) -> k to rows.count { mcpShows(it, k, isHidden(it)) && (f.where == "all" || mcpWhere(it) == f.where) } },
    (listOf("all", "servers") + MCP_ACCOUNTS).filter { k -> k == "all" || rows.any { mcpWhere(it) == k } }
        .map { k -> k to rows.count { mcpShows(it, f.show, isHidden(it)) && (k == "all" || mcpWhere(it) == k) } },
)

// A saved Source that has no rows any more falls back to All.
fun mcpValidFilter(f: McpFilter, menu: McpMenu) = McpFilter(
    if (MCP_SHOWS.any { it.first == f.show }) f.show else "all",
    if (menu.where.any { it.first == f.where }) f.where else "all",
)

// The page subtitle counts every row that is not hidden (web statusCounts).
data class McpCounts(val connected: Int, val total: Int, val needsYou: Int)

fun mcpStatusCounts(rows: List<McpRow>) = McpCounts(
    rows.count { mcpStatusGroup(it) == "Connected" }, rows.size,
    rows.count { mcpStatusGroup(it) == "Needs login" || mcpStatusGroup(it) == "Failed" },
)

fun mcpGroupBody(service: String, group: String) = buildJsonObject { put("service", service); put("group", group) }.toString()

fun mcpSlug(server: String) = server.replace(Regex("[^A-Za-z0-9_-]"), "_")

// How many MCP calls of each server the chat made, and how many failed.
fun mcpCalls(events: List<ChatEvent>): Map<String, Pair<Int, Int>> {
    val failed = events.filter { it.kind == "tool_result" && it.isError }.map { it.toolUseId }.toSet()
    return events.filter { it.kind == "tool_use" && it.name.startsWith("mcp__") && !it.name.endsWith("__set_status") }
        .groupBy { it.name.split("__")[1] }
        .mapValues { (_, uses) -> uses.size to uses.count { it.id in failed } }
}

// Dot for a row (web dotTone): connecting and checking rows pulse, the rest follow their state.
fun mcpDot(r: McpRow): DotState = if (r.status == "pending" || r.status == "probing") DotState.Busy else when (mcpState(r).second) {
    BadgeTone.Done -> DotState.Ok
    BadgeTone.Failed -> DotState.Bad
    BadgeTone.Waiting -> DotState.Warn
    else -> DotState.Faint
}

// One line under the name (web rowNote): the error or reason when not connected; connected rows need none, their section says where they come from.
fun mcpNote(r: McpRow): String? = when {
    r.status == "failed" && r.server.error != null -> r.server.error
    r.status != "connected" -> mcpState(r).first
    else -> null
}

// A row matches when every word of the query is in its name, account, Type or Source, or its status note (web mcpMatches).
fun mcpMatches(r: McpRow, query: String): Boolean {
    val text = listOfNotNull(r.name, r.account, mcpSource(r), mcpType(r), mcpTag(r), mcpNote(r)).joinToString(" ").lowercase()
    return query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.all { text.contains(it) }
}

fun mcpToolCount(r: McpRow): String? = r.server.tools?.let { if (it.isEmpty()) "No tools" else plural(it.size, "tool") }

// The line under a row's name: the table's Type and Source cells, as "Web · Repo · Work".
fun mcpMeta(r: McpRow, personal: Boolean = false): String = listOfNotNull(
    mcpType(r), mcpTag(r), mcpSource(r), "Personal".takeIf { personal && r.account == null },
).joinToString(" · ")

// Calls and errors in this chat, for the detail page.
fun mcpUsage(r: McpRow, calls: Pair<Int, Int>?): String? = listOfNotNull(
    r.server.ms?.let { "$it ms" },
    calls?.let { (n, e) -> plural(n, "call") + if (e > 0) " · ${plural(e, "error")}" else "" },
).joinToString(" · ").ifEmpty { null }

fun mcpReconnectCmd(name: String) = buildJsonObject { put("type", "mcp_reconnect"); put("name", name) }.toString()
fun mcpToggleCmd(name: String, enabled: Boolean) = buildJsonObject { put("type", "mcp_toggle"); put("name", name); put("enabled", enabled) }.toString()
fun mcpStatusCmd() = buildJsonObject { put("type", "mcp_status") }.toString()

// web McpDetail: how a Needs login row logs in. claude.ai connectors on claude.ai for their account, a local server through its own OAuth page.
enum class McpLogin { ClaudeAi, OAuth }
fun mcpLogin(r: McpRow): McpLogin? = if (r.status != "needs-auth") null else if (r.server.type == "claudeai") McpLogin.ClaudeAi else McpLogin.OAuth

// web McpDetail: Add to chat needs the server loaded and connected in this chat; Manage on claude.ai a signed-in connector.
fun mcpCanUse(r: McpRow) = r.live && r.status == "connected"
fun mcpCanManage(r: McpRow) = r.server.type == "claudeai" && r.status != "needs-auth"

// The Tools section's empty line and hint (web McpDetail).
fun mcpNoTools(r: McpRow): Pair<String, String?> = when (r.status) {
    "connected" -> "No tools reported" to null
    "needs-auth" -> "No tools yet" to "Connect to load them"
    else -> "No tools yet" to "They load once the server connects"
}

// web openConnectors: the work accounts are signed in to claude.ai in Chrome on the Mac, the personal one in Firefox.
fun connectorsBrowser(account: String?) = if (account != null && account != "main") "Chrome" else "Firefox"
fun openConnectorsBody(account: String?) = buildJsonObject { put("url", "https://claude.ai/settings/connectors"); put("browser", connectorsBrowser(account).lowercase()) }.toString()
fun mcpAuthUrl(body: String): String? = runCatching { protocolJson.parseToJsonElement(body).jsonObject["authUrl"]?.jsonPrimitive?.contentOrNull }.getOrNull()

@Serializable data class McpConnector(val name: String, val status: String = "")

fun parseConnectors(body: String): Map<String, List<McpConnector>> =
    protocolJson.decodeFromString(MapSerializer(String.serializer(), ListSerializer(McpConnector.serializer())), body)

// The chat's rows with its claude.ai connectors tagged with its account, then the other accounts' connectors as rows not loaded here.
fun mcpWithAccounts(rows: List<McpRow>, account: String?, accounts: Map<String, List<McpConnector>>): List<McpRow> {
    val mine = rows.map { if (it.server.type == "claudeai" && account != null) it.copy(account = account) else it }
    val other = accounts.filterKeys { it != account }.flatMap { (a, list) -> list.map { McpRow(McpServer(it.name, it.status, type = "claudeai"), account = a) } }
        .filter { o -> mine.none { it.name == o.name && it.account == o.account } }
    return mine + other
}

// The chat's claude.ai connectors waiting for a login that the account now has.
fun mcpLoggedInSince(live: List<McpServer>, account: String?, accounts: Map<String, List<McpConnector>>): List<String> {
    val loggedIn = accounts[account].orEmpty().filter { it.status == "connected" }.map { it.name }.toSet()
    return live.filter { it.type == "claudeai" && it.status == "needs-auth" && it.name in loggedIn }.map { it.name }
}

fun mcpKey(r: McpRow) = r.name + "\n" + (r.account ?: "")

// shared/setupPrompt.ts: what the setup button asks the chat's agent for.
fun setupPrompt(kind: String, repo: String, mcpCommand: String) = when (kind) {
    "deploy" -> "Set up deploys for $repo: add a .deploy/app.yaml that names the app and its environments."
    else -> "Help me add an MCP server: run `$mcpCommand` with the right arguments, then check the list again."
}

// Claude's connector page splits tools into Interactive and Read-only; a server without read-only hints keeps one Tools list (web toolGroups).
fun mcpToolGroups(tools: List<McpTool>): List<Pair<String, List<McpTool>>> =
    if (tools.none { it.readOnly }) listOf("Tools" to tools)
    else listOf("Interactive tools" to tools.filter { !it.readOnly }, "Read-only tools" to tools.filter { it.readOnly }).filter { it.second.isNotEmpty() }

fun mcpToolInputs(schema: JsonObject?): String? {
    val names = (schema?.get("properties") as? JsonObject)?.keys?.toList().orEmpty()
    if (names.isEmpty()) return null
    val shown = names.take(3)
    val list = when {
        names.size > 3 -> "${shown.joinToString(", ")}, and ${names.size - 3} more"
        shown.size > 1 -> shown.dropLast(1).joinToString(", ") + (if (shown.size > 2) "," else "") + " and ${shown.last()}"
        else -> shown[0]
    }
    return "Takes ${names.size} input${if (names.size > 1) "s" else ""}: $list"
}
