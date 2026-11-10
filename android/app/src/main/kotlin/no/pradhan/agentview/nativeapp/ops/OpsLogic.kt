package no.pradhan.agentview.nativeapp.ops

import kotlin.math.abs
import kotlin.math.roundToLong
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.isoMillis

// shared/observe.ts, the parts web/src/ops/Observe.tsx shows.
@Serializable
data class SnowflakeInfo(val account: String = "", val user: String = "", val database: String = "", val schema: String = "", val auth: String = "pat", val hasSecret: Boolean = false)

@Serializable
data class ObserveInfo(
    val repo: String,
    val config: JsonElement? = null,
    val guess: JsonElement? = null,
    val repos: List<String> = emptyList(),
    val file: String = "",
    val grafanaServer: Boolean = false,
    val serversFile: String = "~/.claude.json",
    val snowflake: SnowflakeInfo = SnowflakeInfo(),
)

@Serializable data class GrafanaDashboard(val uid: String = "", val title: String, val url: String = "", val folder: String? = null)
@Serializable data class GrafanaDashboards(val dashboards: List<GrafanaDashboard> = emptyList(), val link: String? = null)
@Serializable data class GrafanaPanel(val title: String, val unit: String? = null, val points: List<List<Double>> = emptyList(), val last: Double? = null, val error: String? = null, val link: String? = null)
@Serializable data class GrafanaPanels(val panels: List<GrafanaPanel> = emptyList())
@Serializable data class LogLine(val ts: String = "", val line: String = "", val level: String? = null)
@Serializable data class GrafanaLogs(val logs: List<LogLine> = emptyList(), val link: String? = null, val scanned: Int = 0)
@Serializable data class LogPattern(val pattern: String, val count: Int = 0)
@Serializable data class GrafanaPatterns(val patterns: List<LogPattern> = emptyList(), val source: String = "", val link: String? = null)

private val pretty = Json { prettyPrint = true; prettyPrintIndent = "  " }

fun parseObserve(body: String): ObserveInfo = protocolJson.decodeFromString(ObserveInfo.serializer(), body)

// The settings shown in the field: the saved config, else the guess.
fun observeDraft(info: ObserveInfo): String = (info.config?.takeIf { it !is JsonNull } ?: info.guess)?.let { pretty.encodeToString(JsonElement.serializer(), it) } ?: ""

// The body of POST /api/observe/config; throws on JSON that does not parse, an empty field clears the config.
fun observeConfigBody(repo: String, draft: String): String {
    val config = if (draft.isBlank()) JsonNull else protocolJson.parseToJsonElement(draft)
    return buildJsonObject { put("repo", repo); put("config", config) }.toString()
}

fun observeRepos(names: List<String>, info: ObserveInfo?): List<String> = (names + (info?.repos ?: emptyList())).toSet().filter { it != "example" }.sorted()

// web Observe num: whole numbers past 1000 with separators, else two decimals at most.
fun panelNum(v: Double): String = if (abs(v) >= 1000) String.format(java.util.Locale.US, "%,d", v.roundToLong())
else (Math.round(v * 100) / 100.0).let { if (it == Math.floor(it)) it.toLong().toString() else it.toString() }

// The y positions of a sparkline from 0 (bottom) to 1 (top); a flat series sits in the middle.
fun sparkline(points: List<List<Double>>): List<Float> {
    val vs = points.mapNotNull { it.getOrNull(1) }
    if (vs.isEmpty()) return emptyList()
    val min = vs.min()
    val max = vs.max()
    return vs.map { if (max == min) 0.5f else ((it - min) / (max - min)).toFloat() }
}

fun logClock(iso: String): String = runCatching {
    java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss").withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(iso))
}.getOrDefault(iso)

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
@Serializable data class McpTool(val name: String, val description: String = "")

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

fun mcpGroupBody(service: String, group: String) = buildJsonObject { put("service", service); put("group", group) }.toString()

fun mcpSlug(server: String) = server.replace(Regex("[^A-Za-z0-9_-]"), "_")

// How many MCP calls of each server the chat made, and how many failed.
fun mcpCalls(events: List<ChatEvent>): Map<String, Pair<Int, Int>> {
    val failed = events.filter { it.kind == "tool_result" && it.isError }.map { it.toolUseId }.toSet()
    return events.filter { it.kind == "tool_use" && it.name.startsWith("mcp__") && !it.name.endsWith("__set_status") }
        .groupBy { it.name.split("__")[1] }
        .mapValues { (_, uses) -> uses.size to uses.count { it.id in failed } }
}

fun plural(n: Int, word: String) = "$n $word${if (n == 1) "" else "s"}"

fun mcpMeta(r: McpRow, calls: Pair<Int, Int>?): String = listOfNotNull(
    r.server.tools?.let { if (it.isEmpty()) "No tools" else plural(it.size, "tool") },
    r.server.ms?.let { "$it ms" },
    calls?.let { (n, e) -> plural(n, "call") + if (e > 0) " · ${plural(e, "error")}" else "" },
).joinToString(" · ")

fun mcpReconnectCmd(name: String) = buildJsonObject { put("type", "mcp_reconnect"); put("name", name) }.toString()
fun mcpToggleCmd(name: String, enabled: Boolean) = buildJsonObject { put("type", "mcp_toggle"); put("name", name); put("enabled", enabled) }.toString()
fun mcpStatusCmd() = buildJsonObject { put("type", "mcp_status") }.toString()

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
    "observe" -> "Set up Observe for $repo: use the Grafana MCP to find its dashboards and Loki selector, then save them as the Grafana settings for this repo."
    "deploy" -> "Set up deploys for $repo: add a .deploy/app.yaml that names the app and its environments."
    else -> "Help me add an MCP server: run `$mcpCommand` with the right arguments, then check the list again."
}
