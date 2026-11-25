package no.pradhan.agentview.nativeapp.sessions

import java.util.Calendar
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.chat.RepoChoice
import no.pradhan.agentview.nativeapp.codex.PERSONAL
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.net.LiveChat

// web/src/sessions/folders.ts: the grouping, state and search logic of the sessions list.

@Serializable
data class SavedSession(
    val sessionId: String,
    val title: String = "",
    val cwd: String = "",
    val gitBranch: String? = null,
    val lastModified: Long = 0,
    val firstPrompt: String? = null,
    val summary: String? = null,
    val provider: String? = null,
    val parentId: String? = null,
    val via: String? = null,
    val startedAt: Long? = null,
    val subs: String? = null,
    val members: List<String>? = null,
)

// web groupChats: one row per chat, the root session with the group's last activity, the count label and every member id when it has sub-chats.
fun groupChats(saved: List<SavedSession>) = groupSessions(saved).map { r -> if (r.count > 0) r.root.copy(lastModified = r.lastModified, subs = r.label, members = r.members) else r.root }

// Each chat row by its root id and every member id, so an open chat on a sub-chat finds its row.
fun rowsById(saved: List<SavedSession>): Map<String, SavedSession> = saved.flatMap { s -> (s.members ?: listOf(s.sessionId)).map { it to s } }.toMap()

// The row id (root session) of any member id; other ids stay as they are.
fun Map<String, SavedSession>.rowId(id: String?) = id?.let { this[it]?.sessionId ?: it }

@Serializable
data class Repo(val name: String, val cwd: String, val root: String = "", val kind: String = "other", val branch: String = "", val dirty: Int = 0, val lastCommit: Double = 0.0)

@Serializable
data class Worktree(val id: String = "", val repo: String = "", val cwd: String, val name: String = "")

data class Workspace(val repos: List<Repo> = emptyList(), val trees: List<Worktree> = emptyList(), val saved: List<SavedSession> = emptyList(), val pins: List<String> = emptyList(), val seen: Map<String, Long> = emptyMap())

// An archived chat in the bin (shared/protocol.ts BinnedSession); the server deletes it BIN_MS after deletedAt.
@Serializable
data class BinnedSession(val sessionId: String, val title: String = "", val cwd: String = "", val lastModified: Long = 0, val deletedAt: Long = 0)

const val BIN_MS = 7 * 24 * 60 * 60 * 1000L

// web binLeft in folders.ts: days from 24 hours, else hours, at least one.
fun binLeft(deletedAt: Long, now: Long = System.currentTimeMillis()): String {
    val h = maxOf(1L, Math.round((deletedAt + BIN_MS - now) / 3_600_000.0))
    return if (h >= 24) "${Math.round(h / 24.0)}d left" else "${h}h left"
}

fun withRestored(ws: Workspace, saved: SavedSession, pinned: Boolean) = ws.copy(
    saved = listOf(saved) + ws.saved.filter { it.sessionId != saved.sessionId },
    pins = if (pinned) (ws.pins - saved.sessionId) + saved.sessionId else ws.pins,
)

fun inside(cwd: String, dir: String) = cwd == dir || cwd.startsWith("$dir/")

// The repo folder a working directory belongs to: the owner of the worktree it is in, else the deepest repo containing it.
fun folderKey(cwd: String, repos: List<Repo>, trees: List<Worktree>): String {
    val tree = trees.firstOrNull { inside(cwd, it.cwd) }
    if (tree != null) return tree.repo.ifEmpty { tree.cwd }
    var best: String? = null
    for (r in repos) if (inside(cwd, r.cwd) && r.cwd.length > (best?.length ?: -1)) best = r.cwd
    return best ?: cwd
}

// The folder whose chats are personal, from /api/settings; empty means every folder is work.
var personalRoot = ""

fun segmentOf(key: String, root: String = personalRoot) = if (root.isNotEmpty() && inside(key, root)) PERSONAL else WORK

fun folderName(key: String) = key.substringAfterLast('/').ifEmpty { key }

// How a chat's place is labelled: its repo, plus the worktree name when the folder is inside a worktree.
fun chatPlace(ws: Workspace, cwd: String): String {
    val repo = folderName(folderKey(cwd, ws.repos, ws.trees))
    val tree = ws.trees.firstOrNull { inside(cwd, it.cwd) } ?: return repo
    return "$repo · ${tree.name.substringAfterLast('/')}"
}

fun isDefaultBranch(b: String?) = b.isNullOrEmpty() || b == "main" || b == "master" || b == "HEAD"

enum class ChatState { Needs, Failed, Running, Done }

fun chatState(live: LiveChat?, saved: SavedSession?, seen: Map<String, Long>): ChatState? {
    if (live != null) {
        if (live.pending > 0) return ChatState.Needs
        if (live.failed) return ChatState.Failed
        if (live.running) return if (live.stalled) null else ChatState.Running
    }
    // A chat with sub-chats reads the latest mark of its root and members; Mark as unread zeroes the root's.
    val id = if (saved?.members != null) saved.sessionId else live?.sessionId ?: saved?.sessionId ?: return null
    val at = maxOf(live?.lastActive ?: 0, saved?.lastModified ?: 0)
    val marks = (listOf(id, live?.sessionId) + saved?.members.orEmpty()).mapNotNull { it?.let(seen::get) }
    val s = if (seen[id] == 0L) 0L else marks.maxOrNull() ?: return null
    return if (at > s) ChatState.Done else null
}

// The line under a repo in a picker: its root folder and branch (web RepoPicker).
fun repoDetail(r: Repo) = metaLine(r.root, if (r.kind == "new") "empty" else r.branch.ifEmpty { "no git" })

private fun urgency(c: LiveChat) = if (c.pending > 0) 0 else if (c.running) 1 else 2
val byUrgency = Comparator<LiveChat> { a, b -> urgency(a) - urgency(b) }.thenByDescending { it.lastActive }

// shared/util.ts heldOrder: the keys in their held order; keys not held come first in the order given, held keys no longer present are dropped.
fun heldOrder(held: List<String>?, keys: List<String>): List<String> {
    val slot = held.orEmpty().withIndex().associate { it.value to it.index }
    return keys.filter { it !in slot } + keys.filter { it in slot }.sortedBy { slot.getValue(it) }
}

private fun <T> List<T>.heldBy(held: List<String>?, id: (T) -> String): List<T> {
    val byId = associateBy(id)
    return heldOrder(held, byId.keys.toList()).map { byId.getValue(it) }
}

private fun <T> MutableList<T>.holdBy(held: List<String>?, id: (T) -> String) {
    val ordered = heldBy(held, id)
    clear()
    addAll(ordered)
}

private val LiveChat.heldKey get() = sessionId ?: id

// The order taken when the Sessions screen opens or its search, segment or status changes: the groups, the rows inside each group (open chats by urgency, then saved) and the Recent list, newest first.
class HeldOrder(val groups: List<String>, val rows: List<String>, val recent: List<String>)

fun holdOrder(groups: List<RepoGroup>) = HeldOrder(
    groups.map { it.key },
    groups.flatMap { g -> g.open.map { it.heldKey } + g.recent.map { it.sessionId } },
    groups.flatMap { g -> g.open.map { it.heldKey to it.lastActive } + g.recent.map { it.sessionId to it.lastModified } }.sortedByDescending { it.second }.map { it.first },
)

private fun List<String>.withNew(keys: List<String>): List<String> {
    val known = toSet()
    val added = keys.filter { it !in known }
    return if (added.isEmpty()) this else added + this
}

// Groups and chats that appeared since go first, once, and stay held; this when nothing is new.
fun HeldOrder.extend(groups: List<RepoGroup>): HeldOrder {
    val now = holdOrder(groups)
    val next = HeldOrder(this.groups.withNew(now.groups), rows.withNew(now.rows), recent.withNew(now.recent))
    return if (next.groups === this.groups && next.rows === rows && next.recent === recent) this else next
}

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

// The repos the New chat sheet offers, the open chat's repo first, and that repo's key.
fun newChatChoices(groups: List<RepoGroup>, ws: Workspace, sessionCwd: String?): Pair<String?, List<RepoChoice>> {
    val here = sessionCwd?.ifEmpty { null }?.let { c -> folderKey(c, ws.repos, ws.trees) }?.takeIf { k -> groups.any { g -> g.key == k } }
    return here to groups.sortedByDescending { g -> g.key == here }.map { g -> RepoChoice(g.key, g.name, ws.repos.firstOrNull { it.cwd == g.key }?.let(::repoDetail)) }
}

// The first max choices, plus the picked one when it is further down; all of them once expanded.
fun shownChoices(choices: List<RepoChoice>, picked: String?, all: Boolean, max: Int = 5): List<RepoChoice> =
    if (all || choices.size <= max) choices else choices.filterIndexed { i, c -> i < max || c.key == picked }

// web shared/chatSearch.ts: a chat matches when every word of the query is, ignoring case, in its title, repo name, or the title, first prompt, summary or branch of its saved copy.
fun chatMatches(words: List<String>, title: String, saved: SavedSession?, repo: String?) =
    matchesWords(words, title, saved?.title, saved?.firstPrompt, saved?.summary, saved?.gitBranch, repo)

// ws.saved holds the grouped rows (groupChats), so an open chat on a sub-chat stands for its root's row.
fun groupByRepo(live: List<LiveChat>, ws: Workspace, filter: String = "", held: HeldOrder? = null): List<RepoGroup> {
    val words = queryWords(filter)
    val saved = rowsById(ws.saved)
    val m = LinkedHashMap<String, RepoGroup>()
    fun add(cwd: String, title: String, sessionId: String?, last: Long): RepoGroup? {
        val key = folderKey(cwd, ws.repos, ws.trees)
        val name = folderName(key)
        if (words.isNotEmpty()) {
            val s = sessionId?.let { saved[it] }
            if (!chatMatches(words, title, s, name)) return null
        }
        val g = m.getOrPut(key) { RepoGroup(key, name) }
        g.last = maxOf(g.last, last)
        return g
    }
    val shown = mutableSetOf<String>()
    for (c in live.sortedWith(byUrgency)) {
        val id = saved.rowId(c.sessionId)
        if (id != null && !shown.add(id)) continue
        val g = add(c.cwd, c.title, c.sessionId, c.lastActive) ?: continue
        g.open += c
        if (c.pending > 0) g.waiting++
    }
    val ids = live.mapNotNull { saved.rowId(it.sessionId) }.toSet()
    for (s in ws.saved) if (s.sessionId !in ids) add(s.cwd, s.title, s.sessionId, s.lastModified)?.recent?.add(s)
    for (r in ws.repos) if (r.cwd !in m && (words.isEmpty() || matchesWords(words, r.name))) m[r.cwd] = RepoGroup(r.cwd, folderName(r.cwd)).apply { last = r.lastCommit.toLong() }
    for (g in m.values) {
        g.open.sortWith(byUrgency)
        g.recent.sortByDescending { it.lastModified }
        g.open.holdBy(held?.rows) { it.heldKey }
        g.recent.holdBy(held?.rows) { it.sessionId }
    }
    val (waiting, rest) = m.values.sortedByDescending { it.last }.partition { it.waiting > 0 }
    return waiting + rest.heldBy(held?.groups) { it.key }
}

const val RECENT = 6

data class ChatItem(val live: LiveChat?, val saved: SavedSession?, val repo: String? = null) {
    val key get() = live?.id ?: saved!!.sessionId
    val heldKey get() = live?.heldKey ?: saved!!.sessionId
}

fun recentRows(groups: List<RepoGroup>, filter: String, pins: Set<String> = emptySet(), status: StatusFilter = StatusFilter.All, saved: Map<String, SavedSession> = emptyMap(), seen: Map<String, Long> = emptyMap(), held: HeldOrder? = null): List<ChatItem> {
    val every = status != StatusFilter.All
    return groups.flatMap { g -> g.open.filter { every || (it.pending == 0 && saved.rowId(it.sessionId) !in pins) }.map { ChatItem(it, null, g.name) to it.lastActive } + g.recent.filter { every || it.sessionId !in pins }.map { ChatItem(null, it, g.name) to it.lastModified } }
        .sortedByDescending { it.second }.map { it.first }
        .heldBy(held?.recent) { it.heldKey }
        .filter { status.matches(it.state(saved, seen)) }
        .let { if (filter.isBlank() && !every) it.take(RECENT) else it }
}

enum class StatusFilter(val label: String) {
    All("All"), Running("Running"), Needs("Needs you"), Done("Done");

    fun matches(s: ChatState?) = when (this) {
        All -> true
        Running -> s == ChatState.Running
        Needs -> s == ChatState.Needs || s == ChatState.Failed
        Done -> s == ChatState.Done
    }
}

fun ChatItem.state(saved: Map<String, SavedSession>, seen: Map<String, Long>) = chatState(live, live?.sessionId?.let { saved[it] } ?: this.saved, seen)

fun ChatItem.stalled() = live?.stalled == true

fun RepoGroup.items() = open.map { ChatItem(it, null, name) } + recent.map { ChatItem(null, it, name) }

fun statusCount(groups: List<RepoGroup>, status: StatusFilter, saved: Map<String, SavedSession>, seen: Map<String, Long>) =
    groups.sumOf { g -> g.items().count { status.matches(it.state(saved, seen)) } }

// Mute is kept by row id; a muted row silences every member session.
fun mutedIds(muted: Set<String>, saved: List<SavedSession>) = muted + saved.filter { it.sessionId in muted }.flatMap { it.members.orEmpty() }

// The pinned row ids: a pin kept under a sub-chat id counts for its root.
fun rowPins(ws: Workspace, saved: Map<String, SavedSession> = rowsById(ws.saved)) = ws.pins.map { saved.rowId(it)!! }.distinct()

// Pinned chats, live or saved, that match the filter.
fun pinnedRows(live: List<LiveChat>, ws: Workspace, filter: String): List<ChatItem> {
    val words = queryWords(filter)
    val saved = rowsById(ws.saved)
    return rowPins(ws, saved).mapNotNull { id ->
        val c = live.sortedWith(byUrgency).firstOrNull { saved.rowId(it.sessionId) == id }
        val s = if (c == null) saved[id] else null
        val title = c?.title ?: s?.title ?: return@mapNotNull null
        val cwd = c?.cwd ?: s!!.cwd
        val repo = folderName(folderKey(cwd, ws.repos, ws.trees))
        if (words.isNotEmpty() && !chatMatches(words, title, saved[id], repo)) null else ChatItem(c, s, repo)
    }
}

// Chats waiting on the user that match the filter, most urgent first.
fun waitingRows(live: List<LiveChat>, ws: Workspace, filter: String): List<LiveChat> {
    val words = queryWords(filter)
    val saved = rowsById(ws.saved)
    return live.filter { c ->
        val s = saved[c.sessionId]
        c.pending > 0 && (words.isEmpty() || chatMatches(words, c.title, s, folderName(folderKey(c.cwd, ws.repos, ws.trees))))
    }.sortedWith(byUrgency)
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

// The row ids of the listed chats that are Done.
fun doneChats(live: List<LiveChat>, saved: List<SavedSession>, seen: Map<String, Long>, savedById: Map<String, SavedSession>) =
    live.mapNotNull { c -> val s = c.sessionId?.let(savedById::get); if (chatState(c, s, seen) == ChatState.Done) s?.sessionId ?: c.sessionId else null } +
        saved.filter { chatState(null, it, seen) == ChatState.Done }.map { it.sessionId }

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
