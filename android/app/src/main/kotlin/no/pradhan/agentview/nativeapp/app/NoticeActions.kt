package no.pradhan.agentview.nativeapp.app

import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.meetings.Pending
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.net.Pending
import no.pradhan.agentview.nativeapp.net.answerCmd
import no.pradhan.agentview.nativeapp.net.permissionCmd
import no.pradhan.agentview.nativeapp.net.promptCmd
import no.pradhan.agentview.nativeapp.workspace.lineDiff

object NoticeOp {
    const val ALLOW = "no.pradhan.agentview.native.ALLOW"
    const val DENY = "no.pradhan.agentview.native.DENY"
    const val REPLY = "no.pradhan.agentview.native.REPLY"
}

// The server calls a notification action makes: read a chat's open requests and send it a command.
interface NoticeRemote {
    suspend fun pending(chat: String): List<Pending>
    suspend fun send(chat: String, body: String)
}

sealed interface ActionResult {
    data object Sent : ActionResult
    data object ReadOnly : ActionResult
    data class Failed(val text: String) : ActionResult
}

// Never plan approvals: those need the plan on screen.
private fun List<Pending>.permission() = filterIsInstance<Pending.Permission>().firstOrNull { it.toolName != "ExitPlanMode" }

private const val PREVIEW_LINES = 8
private const val PREVIEW_WIDTH = 100

// An Edit, Write or MultiEdit request as a notification: the file with "+N -M" for the title, the first changed lines for the expanded text.
fun editPreview(p: Pending.Permission): Pair<String, String>? {
    val edits = when (p.toolName) {
        "Write" -> listOf("" to p.input.s("content"))
        "Edit" -> listOf(p.input.s("old_string") to p.input.s("new_string"))
        "MultiEdit" -> (p.input["edits"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { e -> e.s("old_string") to e.s("new_string") } } ?: emptyList()
        else -> return null
    }
    val changed = edits.flatMap { (a, b) -> lineDiff(a, b).filter { it.mark != ' ' } }
    val file = p.input.s("file_path").substringAfterLast('/')
    val title = "${p.toolName} $file +${changed.count { it.mark == '+' }} -${changed.count { it.mark == '-' }}"
    return title to changed.take(PREVIEW_LINES).joinToString("\n") { it.mark + it.text.take(PREVIEW_WIDTH) }
}

suspend fun noticeAsk(remote: NoticeRemote, n: Notice): Notice {
    val open = runCatching { remote.pending(n.chatId) }.getOrNull() ?: return n
    val permission = open.permission()
    return when {
        permission != null -> {
            val preview = editPreview(permission)
            n.copy(ask = NoticeAsk.Permission, permissionId = permission.id, title = preview?.first ?: n.title, body = "${permission.toolName}: ${n.body}", detail = preview?.second.orEmpty())
        }
        open.any { it is Pending.Question } -> n.copy(ask = NoticeAsk.Question)
        else -> n
    }
}

// The same commands the in-app buttons send: permission for Allow and Deny, answer for a question, prompt for a finished chat.
suspend fun runNoticeAction(remote: NoticeRemote, readOnly: Boolean, op: String, chat: String, text: String = "", permissionId: String = "", newId: () -> String = { UUID.randomUUID().toString() }): ActionResult {
    if (readOnly) return ActionResult.ReadOnly
    return try {
        val open = remote.pending(chat)
        val body = when (op) {
            NoticeOp.ALLOW, NoticeOp.DENY -> open.permission()?.takeIf { it.id == permissionId }?.let { permissionCmd(it.id, op == NoticeOp.ALLOW) } ?: return ActionResult.Failed("Already answered")
            NoticeOp.REPLY -> {
                val reply = text.trim()
                if (reply.isEmpty()) return ActionResult.Failed("Nothing to send")
                val q = open.filterIsInstance<Pending.Question>().firstOrNull()
                when {
                    q != null && q.questions.size == 1 -> answerCmd(q.id, mapOf(q.questions[0].question to reply))
                    q != null -> return ActionResult.Failed("Open the chat to answer")
                    open.isNotEmpty() -> return ActionResult.Failed("Open the chat to answer")
                    else -> promptCmd(reply, false, newId())
                }
            }
            else -> return ActionResult.Failed("Unknown action")
        }
        remote.send(chat, body)
        ActionResult.Sent
    } catch (e: Exception) {
        ActionResult.Failed("Not sent: ${e.message ?: "no connection"}")
    }
}

// Process-wide flag, so a notification action respects the read-only launch check like the Hub does.
object AppState {
    @Volatile var readOnly = false
}
