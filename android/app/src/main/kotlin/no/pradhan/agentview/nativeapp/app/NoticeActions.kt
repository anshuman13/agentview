package no.pradhan.agentview.nativeapp.app

import java.util.UUID
import no.pradhan.agentview.nativeapp.chat.editPairs
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.net.Pending
import no.pradhan.agentview.nativeapp.net.answerCmd
import no.pradhan.agentview.nativeapp.net.interruptCmd
import no.pradhan.agentview.nativeapp.net.permissionCmd
import no.pradhan.agentview.nativeapp.net.promptCmd
import no.pradhan.agentview.nativeapp.ui.lineDiff

object NoticeOp {
    const val ALLOW = "no.pradhan.agentview.native.ALLOW"
    const val DENY = "no.pradhan.agentview.native.DENY"
    const val REPLY = "no.pradhan.agentview.native.REPLY"
    const val STOP = "no.pradhan.agentview.native.STOP"
    const val APPROVE = "no.pradhan.agentview.native.APPROVE"
    const val ANSWER = "no.pradhan.agentview.native.ANSWER"
}

// The server calls a notification action makes: read a chat's open requests and send it a command.
interface NoticeRemote {
    suspend fun pending(chat: String): List<Pending>
    suspend fun send(chat: String, body: String)
    suspend fun review(chat: String, slug: String): Boolean
}

sealed interface ActionResult {
    data object Sent : ActionResult
    data object ReadOnly : ActionResult
    data class Failed(val text: String) : ActionResult
}

// Never plan approvals: those need the plan on screen.
private fun List<Pending>.permission() = filterIsInstance<Pending.Permission>().firstOrNull { it.toolName != "ExitPlanMode" }

// The one single-select question a notification can answer with a pick.
private fun List<Pending>.pick() = filterIsInstance<Pending.Question>().firstOrNull()?.let { q -> q.questions.singleOrNull()?.takeIf { !it.multiSelect && it.options.isNotEmpty() }?.let { q.id to it } }

private const val PREVIEW_LINES = 8
private const val PREVIEW_WIDTH = 100

// An Edit, Write or MultiEdit request as a notification: the file with "+N -M" for the title, the first changed lines for the expanded text.
fun editPreview(p: Pending.Permission): Pair<String, String>? {
    val edits = editPairs(p.toolName, p.input) ?: return null
    val changed = edits.flatMap { (a, b) -> lineDiff(a, b).filter { it.mark != ' ' } }
    val file = p.input.s("file_path").substringAfterLast('/')
    val title = "${p.toolName} $file +${changed.count { it.mark == '+' }} -${changed.count { it.mark == '-' }}"
    return title to changed.take(PREVIEW_LINES).joinToString("\n") { it.mark + it.text.take(PREVIEW_WIDTH) }
}

suspend fun noticeAsk(remote: NoticeRemote, n: Notice): Notice {
    val open = runCatching { remote.pending(n.chatId) }.getOrNull() ?: return n
    val permission = open.permission()
    val pick = open.pick()
    return when {
        permission != null -> {
            val preview = editPreview(permission)
            n.copy(ask = NoticeAsk.Permission, permissionId = permission.id, title = preview?.first ?: n.title, body = "${permission.toolName}: ${n.body}", detail = preview?.second.orEmpty())
        }
        pick != null -> {
            val labels = pick.second.options.map { it.label }
            n.copy(ask = NoticeAsk.Question, questionId = pick.first, body = pick.second.question, detail = labels.withIndex().joinToString("\n") { (i, l) -> "${i + 1}. $l" }, options = labels)
        }
        open.any { it is Pending.Question } -> n.copy(ask = NoticeAsk.Question)
        else -> n
    }
}

// The same commands the in-app buttons send: interrupt for Stop, permission for Allow and Deny, answer for a question, prompt for a finished chat.
suspend fun runNoticeAction(remote: NoticeRemote, readOnly: Boolean, op: String, chat: String, text: String = "", requestId: String = "", slug: String = "", newId: () -> String = { UUID.randomUUID().toString() }): ActionResult {
    if (readOnly) return ActionResult.ReadOnly
    return try {
        if (op == NoticeOp.APPROVE) return if (remote.review(chat, slug)) ActionResult.Failed("Already approved") else ActionResult.Sent
        val open = if (op == NoticeOp.STOP) emptyList() else remote.pending(chat)
        val body = when (op) {
            NoticeOp.STOP -> interruptCmd()
            NoticeOp.ALLOW, NoticeOp.DENY -> open.permission()?.takeIf { it.id == requestId }?.let { permissionCmd(it.id, op == NoticeOp.ALLOW) } ?: return ActionResult.Failed("Already answered")
            NoticeOp.ANSWER -> {
                val (id, ask) = open.pick()?.takeIf { (qid, a) -> qid == requestId && a.options.any { it.label == text } } ?: return ActionResult.Failed("Already answered")
                answerCmd(id, mapOf(ask.question to text))
            }
            NoticeOp.REPLY -> {
                val reply = text.trim()
                if (reply.isEmpty()) return ActionResult.Failed("Nothing to send")
                val q = open.filterIsInstance<Pending.Question>().firstOrNull()
                val labels = open.pick()?.second?.options?.map { it.label }.orEmpty()
                val answer = labels.getOrNull((reply.toIntOrNull() ?: 0) - 1) ?: labels.firstOrNull { it.equals(reply, ignoreCase = true) } ?: reply
                when {
                    q != null && q.questions.size == 1 -> answerCmd(q.id, mapOf(q.questions[0].question to answer))
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
        val held = if (op == NoticeOp.APPROVE && e is ApiError) mapOf(400 to "On hold", 404 to "Spec removed")[e.code] else null
        ActionResult.Failed(held ?: "Not sent: ${e.message ?: "no connection"}")
    }
}

// Process-wide flag, so a notification action respects the read-only launch check like the Hub does.
object AppState {
    @Volatile var readOnly = false
}
