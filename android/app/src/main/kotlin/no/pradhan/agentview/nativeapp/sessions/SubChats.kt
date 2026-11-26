package no.pradhan.agentview.nativeapp.sessions

import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.chat.MessageHit

// shared/subChats.ts: a chat that sends /clear goes on in a new session, linked to the chat's first (root) session.
// The cases in shared/fixtures/sub-chats.json run in SubChatsTest. linkOlder stays on the server.

@Serializable
data class SubLink(val parent: String, val via: String, val at: Long)

data class OpenSession(val sessionId: String?, val parentId: String? = null, val lastActive: Long = 0)

data class ParentRow(val root: SavedSession, val latest: String, val count: Int, val label: String, val lastModified: Long, val members: List<String>, val builds: Int = 0, val buildMembers: List<String> = emptyList())

data class HitRow(val hit: MessageHit, val session: String, val sub: String?)

fun rootOf(links: Map<String, SubLink>, id: String): String {
    val seen = mutableSetOf<String>()
    var cur = id
    while (true) {
        val link = links[cur] ?: break
        if (!seen.add(cur)) break
        cur = link.parent
    }
    return cur
}

private fun plural(n: Int, noun: String) = "$n $noun${if (n == 1) "" else "s"}"

fun subChatLabel(count: Int, allBuild: Boolean, builds: Int = 0): String = listOfNotNull(
    if (count > 0) plural(count, if (allBuild) "task" else "sub-chat") else null,
    if (builds > 0) plural(builds, "build") else null,
).joinToString(" · ")

// Every session of a row: its own chain, then the builds started from it.
fun rowSessions(row: ParentRow) = row.members + row.buildMembers

private fun startOf(s: SavedSession) = s.startedAt ?: s.lastModified

private class Group(val root: SavedSession, val count: Int, val allBuild: Boolean, val lastModified: Long, val members: List<String>)

// One row per chat: sub-chats fold into their root's row. A sub-chat whose root is not in the list stands on its own.
// An open chat whose current session is a sub-chat not yet saved joins its root's row as the latest member.
// A build chat started from a listed chat (spawnedBy) folds into that chat's row, after its members; the row still
// opens the chat's own latest session. A build started from a build that folds stands on its own.
fun groupSessions(saved: List<SavedSession>, open: List<OpenSession> = emptyList()): List<ParentRow> {
    val ids = saved.mapTo(mutableSetOf()) { it.sessionId }
    fun isSub(s: SavedSession) = s.parentId != null && s.parentId in ids
    val roots = saved.filterNot(::isSub)
    val subs = saved.filter(::isSub).groupBy { it.parentId!! }
    val live = open.filter { it.sessionId != null && it.sessionId !in ids && it.parentId != null }.groupBy { it.parentId!! }
    val groups = roots.map { root ->
        val ss = subs[root.sessionId].orEmpty().sortedBy(::startOf)
        val ls = live[root.sessionId].orEmpty().sortedBy { it.lastActive }
        val members = listOf(root.sessionId) + ss.map { it.sessionId } + ls.map { it.sessionId!! }
        val count = ss.size + ls.size
        val allBuild = ls.isEmpty() && ss.all { it.via == "build" }
        val last = (listOf(root.lastModified) + ss.map { it.lastModified } + ls.map { it.lastActive }).max()
        Group(root, count, allBuild, last, members)
    }
    val groupOf = groups.flatMap { g -> g.members.map { it to g } }.toMap()
    fun hostOf(g: Group) = g.root.spawnedBy?.let(groupOf::get)?.takeIf { it !== g }
    val folded = groups.filter { g -> hostOf(g)?.let { hostOf(it) == null } == true }.sortedBy { startOf(it.root) }
    return groups.filterNot { it in folded }.map { g ->
        val bs = folded.filter { hostOf(it) === g }
        val last = (listOf(g.lastModified) + bs.map { it.lastModified }).max()
        ParentRow(g.root, g.members.last(), g.count, subChatLabel(g.count, g.allBuild, bs.size), last, g.members, bs.size, bs.flatMap { it.members })
    }.sortedByDescending { it.lastModified }
}

// Where a message search hit opens: the root chat, with the sub-chat to expand when the hit is in one.
fun searchHitRow(hit: MessageHit) = hit.parentId?.let { HitRow(hit, it, hit.sessionId) } ?: HitRow(hit, hit.sessionId, null)

// One row per chat for a list of hits, best (first) hit kept.
fun searchHitRows(hits: List<MessageHit>): List<HitRow> = hits.map(::searchHitRow).distinctBy { it.session }
