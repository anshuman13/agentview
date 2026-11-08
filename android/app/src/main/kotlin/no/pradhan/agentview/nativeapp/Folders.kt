package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable
import java.util.Calendar

// web/src/sessions/folders.ts: the grouping, state and search logic of the sessions list.

@Serializable
data class SavedSession(
    val sessionId: String,
    val title: String = "",
    val cwd: String = "",
    val gitBranch: String? = null,
    val lastModified: Long = 0,
    val firstPrompt: String? = null,
)

@Serializable
data class Repo(val name: String, val cwd: String, val kind: String = "other", val branch: String = "", val dirty: Int = 0, val lastCommit: Double = 0.0)

@Serializable
data class Worktree(val id: String = "", val repo: String = "", val cwd: String, val name: String = "")

data class Workspace(val repos: List<Repo> = emptyList(), val trees: List<Worktree> = emptyList(), val saved: List<SavedSession> = emptyList(), val pins: List<String> = emptyList(), val seen: Map<String, Long> = emptyMap())

fun inside(cwd: String, dir: String) = cwd == dir || cwd.startsWith("$dir/")

// The repo folder a working directory belongs to: the owner of the worktree it is in, else the deepest repo containing it.
fun folderKey(cwd: String, repos: List<Repo>, trees: List<Worktree>): String {
    val tree = trees.firstOrNull { inside(cwd, it.cwd) }
    if (tree != null) return tree.repo.ifEmpty { tree.cwd }
    return repos.map { it.cwd }.sortedByDescending { it.length }.firstOrNull { inside(cwd, it) } ?: cwd
}

fun segmentOf(key: String) = if (key.contains("/workspace_personal/") || key.endsWith("/workspace_personal")) PERSONAL else WORK

fun folderName(key: String) = key.substringAfterLast('/').ifEmpty { key }

fun isDefaultBranch(b: String?) = b.isNullOrEmpty() || b == "main" || b == "master"

enum class ChatState { Needs, Failed, Running, Done }

fun chatState(live: LiveChat?, saved: SavedSession?, seen: Map<String, Long>): ChatState? {
    if (live != null) {
        if (live.pending > 0) return ChatState.Needs
        if (live.failed) return ChatState.Failed
        if (live.running) return if (live.stalled) null else ChatState.Running
    }
    val id = live?.sessionId ?: saved?.sessionId ?: return null
    val at = maxOf(live?.lastActive ?: 0, saved?.lastModified ?: 0)
    val s = seen[id] ?: return null
    return if (at > s) ChatState.Done else null
}

private fun urgency(c: LiveChat) = if (c.pending > 0) 0 else if (c.running) 1 else 2
val byUrgency = Comparator<LiveChat> { a, b -> urgency(a) - urgency(b) }.thenByDescending { it.lastActive }

class RepoGroup(val key: String, val name: String) {
    val open = mutableListOf<LiveChat>()
    val recent = mutableListOf<SavedSession>()
    var last = 0L
    var waiting = 0
}

fun queryWords(q: String) = q.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }

fun matchesWords(words: List<String>, vararg texts: String?): Boolean {
    if (words.isEmpty()) return false
    val hay = texts.joinToString(" ") { it ?: "" }.lowercase()
    return words.all { hay.contains(it) }
}

// A chat matches when every word of the query is in its title, repo or the title or first prompt of its saved copy.
fun groupByRepo(live: List<LiveChat>, ws: Workspace, filter: String = ""): List<RepoGroup> {
    val words = queryWords(filter)
    val saved = ws.saved.associateBy { it.sessionId }
    val pinned = ws.pins.toSet()
    val m = LinkedHashMap<String, RepoGroup>()
    fun add(cwd: String, title: String, sessionId: String?, last: Long): RepoGroup? {
        val key = folderKey(cwd, ws.repos, ws.trees)
        val name = folderName(key)
        if (words.isNotEmpty()) {
            val s = sessionId?.let { saved[it] }
            if (!matchesWords(words, title, s?.title, s?.firstPrompt, name)) return null
        }
        val g = m.getOrPut(key) { RepoGroup(key, name) }
        g.last = maxOf(g.last, last)
        return g
    }
    for (c in live) {
        if (c.sessionId != null && c.sessionId in pinned) continue
        val g = add(c.cwd, c.title, c.sessionId, c.lastActive) ?: continue
        g.open += c
        if (c.pending > 0) g.waiting++
    }
    val ids = live.mapNotNull { it.sessionId }.toSet()
    for (s in ws.saved) if (s.sessionId !in ids && s.sessionId !in pinned) add(s.cwd, s.title, s.sessionId, s.lastModified)?.recent?.add(s)
    for (r in ws.repos) if (r.cwd !in m && (words.isEmpty() || matchesWords(words, r.name))) m[r.cwd] = RepoGroup(r.cwd, folderName(r.cwd)).apply { last = r.lastCommit.toLong() }
    for (g in m.values) {
        g.open.sortWith(byUrgency)
        g.recent.sortByDescending { it.lastModified }
    }
    return m.values.sortedWith(compareByDescending<RepoGroup> { it.waiting > 0 }.thenByDescending { it.last })
}

// Pinned chats, live or saved, that match the filter.
fun pinnedRows(live: List<LiveChat>, ws: Workspace, filter: String): List<Pair<LiveChat?, SavedSession?>> {
    val words = queryWords(filter)
    val saved = ws.saved.associateBy { it.sessionId }
    return ws.pins.mapNotNull { id ->
        val c = live.firstOrNull { it.sessionId == id }
        val s = if (c == null) saved[id] else null
        val title = c?.title ?: s?.title ?: return@mapNotNull null
        val cwd = c?.cwd ?: s!!.cwd
        val repo = folderName(folderKey(cwd, ws.repos, ws.trees))
        if (words.isNotEmpty() && !matchesWords(words, title, saved[id]?.firstPrompt, repo)) null else Pair(c, s)
    }
}

data class Glance(val running: Int, val needs: Int, val unread: Int)

fun groupGlance(g: RepoGroup, seen: Map<String, Long>): Glance {
    var running = 0
    var needs = 0
    var unread = 0
    fun count(s: ChatState?) {
        when (s) {
            ChatState.Running -> running++
            ChatState.Needs -> needs++
            ChatState.Done -> unread++
            else -> {}
        }
    }
    g.open.forEach { count(chatState(it, null, seen)) }
    g.recent.forEach { count(chatState(null, it, seen)) }
    return Glance(running, needs, unread)
}

fun since(t: Long, now: Long = System.currentTimeMillis()): String {
    val m = maxOf(0L, (now - t) / 60_000)
    if (m < 1) return "just now"
    if (m < 60) return "${m}m ago"
    if (m < 1440) return "${m / 60}h ago"
    fun day(x: Long) = Calendar.getInstance().apply { timeInMillis = x; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
    val d = Math.round((day(now) - day(t)) / 864e5)
    return if (d == 1L) "yesterday" else if (d < 7) "${d}d ago" else "${d / 7}w ago"
}

fun metaLine(vararg parts: String?) = parts.filter { !it.isNullOrEmpty() }.joinToString(" · ")

fun renameTitle(text: String, current: String): String? {
    val t = text.trim()
    return if (t.isNotEmpty() && t != current) t else null
}
