package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable
import java.net.URLEncoder

enum class NoticeKind(val channel: String, val label: String) {
    Approval("approvals", "Approvals"),
    Finished("finished", "Finished chats"),
    Failed("failed", "Failed chats"),
}

enum class NoticeAsk { None, Permission, Question }

data class Notice(val kind: NoticeKind, val chatId: String, val title: String, val body: String, val ask: NoticeAsk = NoticeAsk.None, val permissionId: String = "")

fun repoName(c: LiveChat) = c.cwd.trimEnd('/').substringAfterLast('/')

// web/src/app/store.ts notifyBackground: a chat that gained a pending request, or stopped running, since the last list.
fun notices(was: List<LiveChat>, now: List<LiveChat>, shownId: String = ""): List<Notice> = now.mapNotNull { c ->
    if (c.id == shownId) return@mapNotNull null
    val before = was.firstOrNull { it.id == c.id } ?: return@mapNotNull null
    when {
        c.pending > before.pending -> Notice(NoticeKind.Approval, c.id, "Claude needs you in ${repoName(c)}", c.title)
        c.failed && !before.failed -> Notice(NoticeKind.Failed, c.id, "Claude failed in ${repoName(c)}", c.title)
        before.running && !c.running && !c.failed -> Notice(NoticeKind.Finished, c.id, "Claude finished in ${repoName(c)}", c.title)
        else -> null
    }
}

const val WAITING_MAX = 5

@Serializable
data class WaitingLine(val chatId: String, val title: String, val repo: String)

@Serializable
data class WaitingSnapshot(val total: Int = 0, val lines: List<WaitingLine> = emptyList())

// Chats with a request open, the longest idle first; the ongoing notification and the home screen widget list the first five.
fun waitingSnapshot(live: List<LiveChat>): WaitingSnapshot {
    val waiting = live.filter { it.pending > 0 }.sortedBy { it.lastActive }
    return WaitingSnapshot(waiting.size, waiting.take(WAITING_MAX).map { WaitingLine(it.id, it.title.ifBlank { "Untitled" }, repoName(it)) })
}

fun WaitingLine.text() = if (repo.isEmpty()) title else "$title · $repo"

fun chatLink(id: String) = "agentview://open?chat=${URLEncoder.encode(id, "UTF-8")}"

data class SharedItem(val text: String?, val subject: String?, val images: List<String>)

data class ShareTask(val title: String, val body: String, val url: String?)

private val URL_RE = Regex("https?://\\S+")
private const val TITLE_MAX = 120

fun shareTask(subject: String?, text: String?): ShareTask {
    val t = text?.trim().orEmpty()
    val url = URL_RE.find(t)?.value
    val lines = (if (url != null) t.replace(url, "") else t).lines().map { it.trim() }.filter { it.isNotEmpty() }
    val sub = subject?.trim()?.takeIf { it.isNotEmpty() }
    val title = (sub ?: lines.firstOrNull() ?: url ?: "Shared item").take(TITLE_MAX)
    return ShareTask(title, (if (sub != null) lines else lines.drop(1)).joinToString("\n"), url)
}

fun shareChatText(subject: String?, text: String?): String =
    listOfNotNull(subject?.trim()?.takeIf { it.isNotEmpty() && it != text?.trim() }, text?.trim()?.takeIf { it.isNotEmpty() }).joinToString("\n")

object Shortcut {
    const val NEW_CHAT = "new-chat"
    const val ADD_TASK = "add-task"
}
