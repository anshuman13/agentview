package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import no.pradhan.agentview.nativeapp.chat.runningText
import java.net.URLEncoder
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.providerLabel

enum class NoticeKind(val channel: String, val label: String) {
    Approval("approvals", "Approvals"),
    Finished("finished", "Finished chats"),
    Failed("failed", "Failed chats"),
}

enum class NoticeAsk { None, Permission, Question }

data class Notice(val kind: NoticeKind, val chatId: String, val title: String, val body: String, val ask: NoticeAsk = NoticeAsk.None, val permissionId: String = "", val questionId: String = "", val detail: String = "", val slug: String = "", val sub: String = "", val options: List<String> = emptyList(), val outcome: String = "")

fun noticeId(n: Notice) = (n.kind.channel + n.chatId + n.slug).hashCode()

fun repoName(c: LiveChat) = c.cwd.trimEnd('/').substringAfterLast('/')

private val ROUND_NOTICE = setOf("done", "blocked", "question", "failed")

// shared/notices.ts chatNotices, cases in shared/fixtures/chat-notices.json: the one notice a chat's live-list change earns.
// A muted chat (Slack's mute) skips Finished and round notices; Needs you and Failed still come.
fun chatNotice(before: LiveChat, c: LiveChat, muted: Boolean): Notice? {
    val who = providerLabel(c.provider)
    val repo = repoName(c)
    if (c.pending > before.pending) return Notice(NoticeKind.Approval, c.id, "$who needs you in $repo", c.title)
    if (c.failed && !before.failed) return Notice(NoticeKind.Failed, c.id, "$who failed in $repo", c.title)
    if (muted) return null
    val run = c.run
    if (run != null) {
        if (before.run == null || run.round <= before.run.round || run.outcome !in ROUND_NOTICE) return null
        return Notice(NoticeKind.Finished, c.id, "${if (run.kind == "goal") "Goal" else "Loop"} in $repo: ${run.outcome}", run.line?.ifEmpty { null } ?: c.title, outcome = run.outcome.orEmpty())
    }
    if (!before.running || c.running || c.failed) return null
    val title = "$who finished in $repo"
    return if (c.last.isNullOrEmpty()) Notice(NoticeKind.Finished, c.id, title, c.title) else Notice(NoticeKind.Finished, c.id, title, c.last, sub = c.title)
}

fun notices(was: List<LiveChat>, now: List<LiveChat>, muted: Set<String> = emptySet()): List<Notice> = now.mapNotNull { c ->
    val before = was.firstOrNull { it.id == c.id } ?: return@mapNotNull null
    chatNotice(before, c, c.sessionId in muted)
}

// The quiet hours Settings offers; any other stored value is Off.
val QUIET_HOURS = listOf("22:00-07:00", "20:00-08:00")

// The quiet window as start and end minute of the day, or null when quiet hours are off.
fun quietWindow(pref: String?): Pair<Int, Int>? {
    if (pref !in QUIET_HOURS) return null
    val (start, end) = pref!!.split("-").map { it.substringBefore(":").toInt() * 60 + it.substringAfter(":").toInt() }
    return start to end
}

// Inside the window a chat finish or a done loop round posts without sound; a round that is blocked, a question or failed
// keeps it. The window may wrap midnight and its end minute is outside it.
fun silentNotice(kind: NoticeKind, outcome: String, minuteOfDay: Int, window: Pair<Int, Int>?): Boolean {
    if (kind != NoticeKind.Finished || (outcome != "" && outcome != "done") || window == null) return false
    val (start, end) = window
    return if (start <= end) minuteOfDay in start until end else minuteOfDay >= start || minuteOfDay < end
}

const val WAITING_MAX = 5

@Serializable
data class WaitingLine(val chatId: String, val title: String, val repo: String)

@Serializable
data class WaitingSnapshot(val total: Int = 0, val lines: List<WaitingLine> = emptyList())

// Chats with a request open, the longest idle first; the ongoing notification and the home screen widget list the first five.
fun waitingSnapshot(live: List<LiveChat>): WaitingSnapshot {
    val waiting = live.filter { it.pending > 0 }.sortedBy { it.lastActive }
    return WaitingSnapshot(waiting.size, waiting.take(WAITING_MAX).map { WaitingLine(it.id, it.title.ifBlank { UNTITLED }, repoName(it)) })
}

data class RunningNote(val chatId: String, val title: String, val text: String, val since: Long, val pending: Int, val permissionId: String = "")

// The ongoing notification per running chat; a chat counts from the first list that showed it running.
fun runningNotes(live: List<LiveChat>, was: Map<String, Long>, now: Long): List<RunningNote> = live.filter { it.running }.map {
    RunningNote(it.id, it.title.ifBlank { UNTITLED }, runningText(it), was[it.id] ?: now, it.pending)
}

// The waiting notification and its badge: the waiting chats plus the Needs-you rows; badge < 0 means notifications are off.
fun waitingBadge(snap: WaitingSnapshot, badge: Int): Pair<WaitingSnapshot, Int> = if (badge >= 0) snap to snap.total + badge else WaitingSnapshot() to 0

// Running notes post again when they change, or before the notification timeout clears an unchanged set.
fun repostRunning(notes: List<RunningNote>, shown: List<RunningNote>?, postedAt: Long, now: Long) = notes != shown || now - postedAt >= RUNNING_TIMEOUT_MS / 3

// The known permission id of a waiting chat, while its request count is the one it was fetched for.
fun knownAsk(asks: Map<String, Pair<Int, String>>, n: RunningNote): String? = asks[n.chatId]?.takeIf { it.first == n.pending }?.second

// Drops the permission ids of chats no longer waiting.
fun keptAsks(asks: Map<String, Pair<Int, String>>, notes: List<RunningNote>) = asks.filterKeys { id -> notes.any { it.chatId == id && it.pending > 0 } }

fun WaitingLine.text() = if (repo.isEmpty()) title else "$title · $repo"

const val sessionsLink = "agentview://open?view=sessions"

fun chatLink(id: String, slug: String = "") = "agentview://open?chat=${URLEncoder.encode(id, "UTF-8")}" + if (slug.isEmpty()) "" else "&slug=${URLEncoder.encode(slug, "UTF-8")}"

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
