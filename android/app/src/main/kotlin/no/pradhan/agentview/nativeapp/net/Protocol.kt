package no.pradhan.agentview.nativeapp.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.ops.Findings
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.ReviewFindings

val protocolJson = Json { ignoreUnknownKeys = true; isLenient = true }

// shared/protocol.ts ChatEvent: one flat class covering the kinds this client reads (user, assistant, tool_use, agent, result, system).
// Fields not present on a kind keep their defaults. For tool_use, `summary` is the one-line description; for agent it is `description`.
@Immutable
@Serializable
data class ChatEvent(
    val id: String,
    val kind: String,
    val text: String = "",
    val streaming: Boolean = false,
    val name: String = "",
    val summary: String = "",
    val description: String = "",
    val isError: Boolean = false,
    val error: Boolean = false,
    val queued: Boolean = false,
    val at: Long = 0,
    val input: JsonObject = JsonObject(emptyMap()),
    val toolUseId: String = "",
    val parent: String? = null,
    val agent: String? = null,
    val costUsd: Double = 0.0,
    val model: String? = null,
    val phase: String? = null,
    val auto: String? = null,
    val round: Int = 0,
    val stopping: Boolean = false,
    val stopped: Boolean = false,
    val rule: String = "",
    val reason: String = "",
    val allowed: Boolean = false,
    val next: List<String> = emptyList(),
    val status: String = "",
    val subagentType: String = "",
    val prompt: String = "",
    val startedAt: Long = 0,
    val endedAt: Long? = null,
    val progress: String? = null,
    val usage: AgentUsage? = null,
    val background: Boolean = false,
    val group: String? = null,
    val files: List<ReviewFile> = emptyList(),
    val result: String = "",
)

// A file of a review event: hunks are the runs of changed lines; a created or binary file has none and is decided whole. state is kept or undone once decided.
@Immutable
@Serializable
data class ReviewFile(val path: String, val hunks: List<ReviewHunk> = emptyList(), val created: Boolean = false, val binary: Boolean = false, val state: String? = null)

@Immutable
@Serializable
data class ReviewHunk(val line: Int = 0, val del: List<String> = emptyList(), val add: List<String> = emptyList(), val state: String? = null)

// shared/protocol.ts PublicSettings.
@Serializable
data class AppSettings(val deploy: Boolean = false, val accountLabels: Map<String, String> = emptyMap(), val providers: List<ProviderOption> = emptyList(), val personalRoot: String = "", val defaultProvider: String = "claude", val featureUse: Boolean = false, val hiddenFeatures: List<String> = emptyList())

// POST /api/feature-use: false when the setting is off on the server.
@Serializable
data class TrackReply(val recorded: Boolean = false)

// GET /api/feature-use: the counts per day and feature, empty while the setting is off.
@Serializable
data class FeatureUseReply(val days: Map<String, Map<String, Int>> = emptyMap())

// shared/protocol.ts ProviderOption: what a new chat can run on; a disabled one says what is missing.
@Serializable
data class ProviderOption(val id: String, val label: String, val enabled: Boolean = true, val note: String? = null)

@Serializable
data class AgentUsage(val tokens: Long = 0, val toolUses: Int = 0, val durationMs: Long = 0)

// shared/protocol.ts LiveChat, the entries of the 'live' message.
@Serializable
data class LiveChat(
    val id: String,
    val title: String = "",
    val cwd: String = "",
    val running: Boolean = false,
    val pending: Int = 0,
    val status: String = "",
    val lastActive: Long = 0,
    val last: String? = null,
    val failed: Boolean = false,
    val sessionId: String? = null,
    val stalled: Boolean = false,
    val model: String? = null,
    val edits: Edits? = null,
    val cost: Double? = null,
    val provider: String? = null,
    val pr: Int? = null,
    val prChecks: String? = null,
    val todos: LiveTodos? = null,
    val recap: String? = null,
    val run: LiveRun? = null,
    val agentList: List<LiveAgent> = emptyList(),
    val now: LiveNow? = null,
)

// shared/protocol.ts LiveAgent: a running subagent of a chat.
@Serializable
data class LiveAgent(val id: String, val description: String = "", val type: String = "", val slug: String? = null, val startedAt: Long = 0)

// shared/protocol.ts LiveNow: the agent's last set_status with its detail.
@Serializable
data class LiveNow(val text: String = "", val at: Long = 0, val done: String? = null, val next: List<String>? = null)

// shared/protocol.ts LiveChat.todos: how far Claude's to-do list is, while it has items left.
@Serializable
data class LiveTodos(val done: Int = 0, val total: Int = 0)

// shared/protocol.ts LiveChat.run: the run a chat is on, as the live list carries it.
@Serializable
data class LiveRun(
    val id: String,
    val kind: String = "loop",
    val state: String = "running",
    val why: String? = null,
    val nextAt: Long? = null,
    val round: Int = 0,
    val needsYou: Boolean = false,
    val outcome: String? = null,
    val line: String? = null,
)

// shared/protocol.ts Round and ChatRun, the entries of the 'runs' message.
@Serializable
data class Round(val n: Int = 0, val at: Long = 0, val outcome: String = "", val line: String = "", val costUsd: Double = 0.0, val report: String? = null)

// shared/protocol.ts Try: one chat of a /tries run.
@Serializable
data class RunTry(val n: Int = 0, val chatId: String = "", val sessionId: String = "", val branch: String = "", val dropped: Boolean = false)

@Serializable
data class ChatRun(
    val id: String,
    val kind: String = "loop",
    val sessionId: String = "",
    val chatId: String = "",
    val title: String = "",
    val what: String = "",
    val startedAt: Long = 0,
    val endedAt: Long? = null,
    val state: String = "running",
    val why: String = "",
    val round: Int = 0,
    val max: Int = 0,
    val nextAt: Long? = null,
    val every: Long? = null,
    val endAt: Long? = null,
    val capPct: Int? = null,
    val usage: PlanUsage? = null,
    val provider: String? = null,
    val costUsd: Double = 0.0,
    val rounds: List<Round> = emptyList(),
    val tries: List<RunTry> = emptyList(),
    val needsYou: Boolean = false,
    val branch: String = "",
    val review: String? = null,
    val pr: String? = null,
)

@Serializable
data class Edits(val add: Int = 0, val del: Int = 0)

@Serializable
data class ModelInfo(val value: String, val displayName: String = "", val description: String = "", val efforts: List<String>? = null)

// shared/protocol.ts Capabilities: what the chat's driver supports; a missing field counts as supported.
@Serializable
data class Capabilities(val rewind: Boolean = true, val mcp: Boolean = true, val mcpEdit: Boolean = true, val connectors: Boolean = true, val effort: Boolean = true, val team: Boolean = true, val stopTask: Boolean = true, val subagents: Boolean = true)

@Serializable
data class CommandInfo(val name: String, val description: String = "")

// shared/protocol.ts SessionInfo, the fields the chat screen reads.
@Serializable
data class SessionInfo(
    val id: String = "",
    val sessionId: String? = null,
    val model: String? = null,
    val effort: String? = null,
    val team: Boolean = false,
    val cwd: String = "",
    val running: Boolean = false,
    val permissionMode: String? = null,
    val models: List<ModelInfo> = emptyList(),
    val commands: List<CommandInfo> = emptyList(),
    val context: Long? = null,
    val contextWindow: Long? = null,
    val compacting: Boolean = false,
    val stopping: Boolean = false,
    val pr: Int? = null,
    val mcp: List<McpServer> = emptyList(),
    val account: String? = null,
    val accounts: List<String> = emptyList(),
    val usage: PlanUsage? = null,
    val loop: LoopInfo? = null,
    val hooks: List<String> = emptyList(),
    val review: Boolean = false,
    val provider: String? = null,
    val capabilities: Capabilities = Capabilities(),
    val instructionFiles: List<String> = emptyList(),
    val resumeCommand: String? = null,
)

@Serializable
data class LoopInfo(val phase: String? = null)

@Serializable
data class UsageWindow(val pct: Double = 0.0)

@Serializable
data class PlanUsage(val fiveHour: UsageWindow? = null, val week: UsageWindow? = null)

data class AskOption(val label: String, val description: String = "", val preview: String? = null)
data class Ask(val question: String, val header: String, val multiSelect: Boolean, val options: List<AskOption>)

// shared/protocol.ts PendingRequest.
sealed interface Pending {
    val id: String

    data class Question(override val id: String, val questions: List<Ask>) : Pending
    data class Permission(
        override val id: String,
        val toolName: String,
        val title: String,
        val detail: String,
        val input: JsonObject,
        val canAlwaysAllow: Boolean,
        val confirmFirst: Boolean,
    ) : Pending
}

private fun JsonObject.str(k: String) = this[k]?.let { it as? JsonPrimitive }?.contentOrNull ?: ""
private fun JsonObject.flag(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false

fun parsePending(e: kotlinx.serialization.json.JsonElement): Pending? {
    val o = e as? JsonObject ?: return null
    val id = o.str("id")
    return when (o.str("kind")) {
        "question" -> Pending.Question(
            id,
            (o["questions"] as? JsonArray ?: JsonArray(emptyList())).map { q ->
                val qo = q.jsonObject
                Ask(
                    qo.str("question"), qo.str("header"), qo.flag("multiSelect"),
                    (qo["options"] as? JsonArray ?: JsonArray(emptyList())).map { op ->
                        val oo = op.jsonObject
                        AskOption(oo.str("label"), oo.str("description"), oo.str("preview").ifEmpty { null })
                    },
                )
            },
        )
        "permission" -> Pending.Permission(id, o.str("toolName"), o.str("title"), o.str("detail"), o["input"] as? JsonObject ?: JsonObject(emptyMap()), o.flag("canAlwaysAllow"), o.flag("confirmFirst"))
        else -> null
    }
}

// shared/protocol.ts ServerMessage, only the variants this client acts on.
sealed interface ServerMessage {
    // 'init': state.session.id, state.events (a tail of ROW_WINDOW), state.earlier
    data class Init(
        val chatId: String,
        val events: List<ChatEvent>,
        val earlier: Int,
        val session: SessionInfo? = null,
        val pending: List<Pending> = emptyList(),
    ) : ServerMessage
    // A merge: `commands` and `mcp` are absent from the payload while unchanged, so `keeps` names the fields to keep.
    data class SessionUpdate(val session: SessionInfo, val keeps: Set<String> = emptySet()) : ServerMessage
    data class PendingAdded(val request: Pending) : ServerMessage
    data class Resolved(val id: String) : ServerMessage
    data class Error(val text: String) : ServerMessage
    data class Event(val event: ChatEvent) : ServerMessage
    data class Append(val id: String, val offset: Int, val text: String) : ServerMessage
    data class Live(val chats: List<LiveChat>) : ServerMessage
    data class Runs(val runs: List<ChatRun>) : ServerMessage
    data class Findings(val review: ReviewFindings) : ServerMessage
    data class FileChanged(val path: String) : ServerMessage
    data class Other(val type: String) : ServerMessage
}

fun parseMessage(data: String): ServerMessage {
    val o = protocolJson.parseToJsonElement(data).jsonObject
    return when (val type = o["type"]?.jsonPrimitive?.contentOrNull ?: "") {
        "init" -> {
            val state = o["state"]!!.jsonObject
            val chatId = state["session"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull ?: ""
            val session = state["session"]?.let { runCatching { protocolJson.decodeFromJsonElement(SessionInfo.serializer(), it) }.getOrNull() }
            val pending = (state["pending"] as? JsonArray)?.mapNotNull { parsePending(it) } ?: emptyList()
            ServerMessage.Init(chatId, events(state), state["earlier"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0, session, pending)
        }
        "session" -> o["session"]!!.jsonObject.let { s -> ServerMessage.SessionUpdate(protocolJson.decodeFromJsonElement(SessionInfo.serializer(), s), setOf("commands", "mcp").filter { it !in s }.toSet()) }
        "pending" -> parsePending(o["request"]!!)?.let { ServerMessage.PendingAdded(it) } ?: ServerMessage.Other(type)
        "resolved" -> ServerMessage.Resolved(o["id"]!!.jsonPrimitive.content)
        "error" -> ServerMessage.Error(o["text"]?.jsonPrimitive?.contentOrNull ?: "")
        "event" -> ServerMessage.Event(protocolJson.decodeFromJsonElement(ChatEvent.serializer(), o["event"]!!))
        "append" -> ServerMessage.Append(
            o["id"]!!.jsonPrimitive.content,
            o["offset"]!!.jsonPrimitive.content.toInt(),
            o["text"]!!.jsonPrimitive.content,
        )
        "live" -> ServerMessage.Live(
            o["chats"]!!.let { protocolJson.decodeFromJsonElement(ListSerializer(LiveChat.serializer()), it) },
        )
        "runs" -> ServerMessage.Runs(protocolJson.decodeFromJsonElement(ListSerializer(ChatRun.serializer()), o["runs"]!!))
        "findings" -> ServerMessage.Findings(protocolJson.decodeFromJsonElement(ReviewFindings.serializer(), o["review"]!!))
        "file_changed" -> ServerMessage.FileChanged(o["path"]!!.jsonPrimitive.content)
        else -> ServerMessage.Other(type)
    }
}

private fun events(state: JsonObject): List<ChatEvent> =
    state["events"]?.let { protocolJson.decodeFromJsonElement(ListSerializer(ChatEvent.serializer()), it) } ?: emptyList()

// The body of /api/chat/events: older rows and how many are still left before them.
fun parseEarlier(body: String): Pair<List<ChatEvent>, Int> {
    val o = protocolJson.parseToJsonElement(body).jsonObject
    return Pair(events(o), o["earlier"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0)
}

// shared/protocol.ts appendTo: the event with streamed text added, or null when the append does not fit it.
fun appendTo(ev: ChatEvent, offset: Int, text: String): ChatEvent? {
    if (ev.kind != "assistant" || offset > ev.text.length) return null
    val add = text.substring(minOf(text.length, ev.text.length - offset))
    return if (add.isEmpty()) null else ev.copy(text = ev.text + add)
}

// shared/protocol.ts ClientMessage 'prompt' | 'queue' | 'view' as the JSON the web store posts to /api/cmd.
fun viewCmd(id: String) = """{"type":"view","id":${quote(id)}}"""

// web/src/chat/Composer.tsx: a message sent while Claude runs is queued for its next step, otherwise it is a prompt.
fun promptCmd(text: String, running: Boolean, id: String) =
    """{"type":"${if (running) "queue" else "prompt"}","text":${quote(text)},"id":${quote(id)}}"""

private fun quote(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()


private fun cmd(type: String, build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}) =
    buildJsonObject { put("type", type); build() }.toString()

fun steerCmd(text: String, id: String) = cmd("steer") { put("text", text); put("id", id) }
fun interruptCmd() = cmd("interrupt")
fun runCmd(run: String, op: String) = cmd("run") { put("run", run); put("op", op) }
// A null value clears the end time or the cap; a key left out stays as it is.
fun runEditCmd(run: String, edit: Map<String, Long?>) = cmd("run_edit") { put("run", run); edit.forEach { (k, v) -> put(k, v) } }
fun triesKeepCmd(run: String, n: Int) = cmd("tries_keep") { put("run", run); put("n", n) }
fun permissionCmd(id: String, allow: Boolean, always: Boolean = false) = cmd("permission") {
    put("id", id); put("allow", allow); if (always) put("always", true)
}
fun answerCmd(id: String, answers: Map<String, String>) = cmd("answer") {
    put("id", id)
    put("answers", buildJsonObject { answers.forEach { (k, v) -> put(k, v) } })
}
fun runHookCmd(name: String) = cmd("run_hook") { put("name", name) }
fun allowBlockedCmd(id: String) = cmd("allow_blocked") { put("id", id) }
fun sendNowCmd(id: String) = cmd("send_now") { put("id", id) }
fun setModelCmd(model: String) = cmd("set_model") { put("model", model) }
fun setEffortCmd(effort: String) = cmd("set_effort") { put("effort", effort) }
fun usageCmd() = cmd("usage")
fun setAccountCmd(account: String) = cmd("set_account") { put("account", account) }
fun setModeCmd(mode: String) = cmd("set_permission_mode") { put("mode", mode) }
fun setReviewCmd(on: Boolean) = cmd("set_review") { put("on", on) }
fun reviewCmd(id: String, action: String, file: String? = null, hunk: Int? = null) = cmd("review") { put("id", id); put("action", action); if (file != null) put("file", file); if (hunk != null) put("hunk", hunk) }
fun newSessionCmd(profile: String? = null, cwd: String? = null, model: String? = null, fork: String? = null, provider: String? = null, text: String? = null) = cmd("new_session") { if (profile != null) put("profile", profile); if (cwd != null) put("cwd", cwd); if (model != null) put("model", model); if (fork != null) put("fork", fork); if (provider != null) put("provider", provider); if (text != null) put("text", text) }
fun closeCmd(id: String) = cmd("close") { put("id", id) }
fun openSessionCmd(sessionId: String) = cmd("open_session") { put("sessionId", sessionId) }
fun rewindCmd(id: String) = cmd("rewind") { put("id", id) }
fun stopTaskCmd(toolUseId: String) = cmd("stop_task") { put("toolUseId", toolUseId) }
