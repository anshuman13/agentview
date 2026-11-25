package no.pradhan.agentview.nativeapp.sessions

import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.chat.MessageHit

// shared/subChats.ts: a chat that sends /clear goes on in a new session, linked to the chat's first (root) session.
// The cases in shared/fixtures/sub-chats.json run in SubChatsTest. linkOlder stays on the server.

@Serializable
data class SubLink(val parent: String, val via: String, val at: Long)

data class OpenSession(val sessionId: String?, val parentId: String? = null, val lastActive: Long = 0)

data class ParentRow(val root: SavedSession, val latest: String, val count: Int, val label: String, val lastModified: Long, val members: List<String>)

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

fun subChatLabel(count: Int, allBuild: Boolean): String {
    if (count <= 0) return ""
    val noun = if (allBuild) "task" else "sub-chat"
    return "$count $noun${if (count == 1) "" else "s"}"
}

private fun startOf(s: SavedSession) = s.startedAt ?: s.lastModified

// One row per chat: sub-chats fold into their root's row. A sub-chat whose root is not in the list stands on its own.
// An open chat whose current session is a sub-chat not yet saved joins its root's row as the latest member.
fun groupSessions(saved: List<SavedSession>, open: List<OpenSession> = emptyList()): List<ParentRow> {
    val ids = saved.mapTo(mutableSetOf()) { it.sessionId }
    fun isSub(s: SavedSession) = s.parentId != null && s.parentId in ids
    val roots = saved.filterNot(::isSub)
    val subs = saved.filter(::isSub).groupBy { it.parentId!! }
    val live = open.filter { it.sessionId != null && it.sessionId !in ids && it.parentId != null }.groupBy { it.parentId!! }
    return roots.map { root ->
        val ss = subs[root.sessionId].orEmpty().sortedBy(::startOf)
        val ls = live[root.sessionId].orEmpty().sortedBy { it.lastActive }
        val members = listOf(root.sessionId) + ss.map { it.sessionId } + ls.map { it.sessionId!! }
        val count = ss.size + ls.size
        val allBuild = ls.isEmpty() && ss.all { it.via == "build" }
        val last = (listOf(root.lastModified) + ss.map { it.lastModified } + ls.map { it.lastActive }).max()
        ParentRow(root, members.last(), count, subChatLabel(count, allBuild), last, members)
    }.sortedByDescending { it.lastModified }
}

// Where a message search hit opens: the root chat, with the sub-chat to expand when the hit is in one.
fun searchHitRow(hit: MessageHit) = hit.parentId?.let { HitRow(hit, it, hit.sessionId) } ?: HitRow(hit, hit.sessionId, null)

// One row per chat for a list of hits, best (first) hit kept.
fun searchHitRows(hits: List<MessageHit>): List<HitRow> = hits.map(::searchHitRow).distinctBy { it.session }
