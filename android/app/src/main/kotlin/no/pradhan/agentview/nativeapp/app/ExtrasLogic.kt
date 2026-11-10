package no.pradhan.agentview.nativeapp.app

import java.net.URLEncoder
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.providerLabel

enum class NoticeKind(val channel: String, val label: String) {
    Approval("approvals", "Approvals"),
    Finished("finished", "Finished chats"),
    Failed("failed", "Failed chats"),
}

enum class NoticeAsk { None, Permission, Question }

data class Notice(val kind: NoticeKind, val chatId: String, val title: String, val body: String, val ask: NoticeAsk = NoticeAsk.None, val permissionId: String = "", val detail: String = "")

fun repoName(c: LiveChat) = c.cwd.trimEnd('/').substringAfterLast('/')

// web/src/app/store.ts notifyBackground: a chat that gained a pending request, or stopped running, since the last list.
// A muted chat (Slack's mute) skips Finished; Needs you and Failed still come.
fun notices(was: List<LiveChat>, now: List<LiveChat>, shownId: String = "", muted: Set<String> = emptySet()): List<Notice> = now.mapNotNull { c ->
    if (c.id == shownId) return@mapNotNull null
    val before = was.firstOrNull { it.id == c.id } ?: return@mapNotNull null
    when {
        c.pending > before.pending -> Notice(NoticeKind.Approval, c.id, "${providerLabel(c.provider)} needs you in ${repoName(c)}", c.title)
        c.failed && !before.failed -> Notice(NoticeKind.Failed, c.id, "${providerLabel(c.provider)} failed in ${repoName(c)}", c.title)
        before.running && !c.running && !c.failed && c.sessionId !in muted -> Notice(NoticeKind.Finished, c.id, "${providerLabel(c.provider)} finished in ${repoName(c)}", c.title)
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

data class RunningNote(val chatId: String, val title: String, val text: String, val since: Long, val pending: Boolean, val permissionId: String = "")

// The ongoing notification per running chat; a chat counts from the first list that showed it running.
fun runningNotes(live: List<LiveChat>, was: Map<String, Long>, now: Long): List<RunningNote> = live.filter { it.running }.map {
    RunningNote(it.id, it.title.ifBlank { "Untitled" }, it.status.takeIf { s -> s != "Idle" }.orEmpty().ifBlank { "Working" }, was[it.id] ?: now, it.pending > 0)
}

fun WaitingLine.text() = if (repo.isEmpty()) title else "$title · $repo"

const val sessionsLink = "agentview://open?view=sessions"

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
