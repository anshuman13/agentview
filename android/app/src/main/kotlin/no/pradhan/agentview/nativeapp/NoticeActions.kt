package no.pradhan.agentview.nativeapp

import java.util.UUID

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

suspend fun noticeAsk(remote: NoticeRemote, n: Notice): Notice {
    val open = runCatching { remote.pending(n.chatId) }.getOrNull() ?: return n
    val permission = open.permission()
    return when {
        permission != null -> n.copy(ask = NoticeAsk.Permission, permissionId = permission.id, body = "${permission.toolName}: ${n.body}")
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
