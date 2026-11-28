package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.net.protocolJson
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.chat.MemoryFile
import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.sessions.SavedSession
import no.pradhan.agentview.nativeapp.sessions.Workspace
import no.pradhan.agentview.nativeapp.sessions.groupChats
import no.pradhan.agentview.nativeapp.sessions.rowId
import no.pradhan.agentview.nativeapp.sessions.rowsById
import no.pradhan.agentview.nativeapp.sessions.withRestored
import no.pradhan.agentview.nativeapp.ui.plural

class SeenMark(val id: String, val value: Long, val at: Long, val sent: Boolean)

// web shared/seen.ts: the server's seen times with each local mark applied that its POST has not confirmed, or that was made once the load began.
fun mergeSeen(server: Map<String, Long>, marks: List<SeenMark>, startedAt: Long): Map<String, Long> =
    server + marks.filter { !it.sent || it.at >= startedAt }.associate { it.id to it.value }

private fun Hub.postMark(m: SeenMark) {
    if (readOnly) return
    viewModelScope.launch {
        if (runCatching { api.markSeen(m.id, unread = m.value == 0L) }.isSuccess && seenMarks[m.id] === m) seenMarks[m.id] = SeenMark(m.id, m.value, m.at, true)
    }
}

private fun Hub.mark(sessionId: String, value: Long) {
    val m = SeenMark(sessionId, value, System.currentTimeMillis(), false)
    seenMarks[sessionId] = m
    workspace.value = workspace.value.let { it.copy(seen = it.seen + (sessionId to value)) }
    postMark(m)
}

fun Hub.refreshWorkspace(force: Boolean = false): Job? {
    val now = System.currentTimeMillis()
    if (!force && now - workspaceAt < WORKSPACE_MIN_AGE_MS) return null
    workspaceAt = now
    seenMarks.values.filter { !it.sent }.forEach { m -> SeenMark(m.id, m.value, now, false).also { seenMarks[m.id] = it; postMark(it) } }
    return viewModelScope.launch {
        val from = origin.value
        runCatching {
            coroutineScope {
                val was = workspace.value
                val saved = async { runCatching { groupChats(api.sessions()) }.getOrDefault(was.saved) }
                val repos = async { runCatching { api.repos() }.getOrDefault(was.repos) }
                val trees = async { runCatching { api.worktrees() }.getOrDefault(was.trees) }
                val pins = async { runCatching { api.pins() }.getOrDefault(was.pins) }
                val seen = async { runCatching { api.seen() }.getOrDefault(was.seen) }
                Workspace(repos.await(), trees.await(), saved.await(), pins.await(), seen.await())
            }
        }.onSuccess {
            if (from == origin.value) {
                workspace.value = it.copy(seen = mergeSeen(it.seen, seenMarks.values.toList(), now))
                seenMarks.values.removeAll { m -> m.sent && m.at < now }
            }
        }.onFailure { workspaceAt = 0 }
        if (from == origin.value) viewModelScope.launch { syncResolved() }
    }
}

fun Hub.refreshMcpGroups() {
    viewModelScope.launch {
        runCatching { protocolJson.decodeFromString(MapSerializer(String.serializer(), String.serializer()), read("/api/mcp/groups")) }.onSuccess { mcpGroups.value = it }
    }
}

// Marks the id and, for a sub-chat, its root row too, so opening it clears Mark as unread on the root.
internal fun Hub.markSeen(sessionId: String?) {
    if (sessionId == null) return
    val now = System.currentTimeMillis()
    mark(sessionId, now)
    rowsById(workspace.value.saved).rowId(sessionId)?.takeIf { it != sessionId }?.let { mark(it, now) }
}

fun Hub.markRead(sessionIds: List<String>) {
    sessionIds.forEach(::markSeen)
    undoable.tryEmit(Undoable("Marked ${plural(sessionIds.size, "chat")} as read") { sessionIds.forEach(::markUnread) })
}

// Seen time 0, so the chat shows Done until it is opened again.
fun Hub.markUnread(sessionId: String) = mark(sessionId, 0L)

fun Hub.loadEarlier() {
    val s = store.state.value
    val first = s.events.firstOrNull()?.id ?: return
    if (loadingEarlier.value) return
    val chat = s.shownId
    loadingEarlier.value = true
    viewModelScope.launch {
        runCatching { api.earlier(chat, first) }
            .onSuccess { (older, earlier) -> store.prepend(chat, first, older, earlier) }
            .onFailure { notice.value = "Could not load earlier messages: ${it.message}" }
        loadingEarlier.value = false
    }
}

fun Hub.rename(sessionId: String, title: String) = write("Could not rename the chat. The old title is kept.") {
    api.rename(sessionId, title)
    workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.map { if (it.sessionId == sessionId) it.copy(title = title) else it }) }
}

fun Hub.nest(sessionId: String, parent: String) = write(if (parent.isEmpty()) "Could not un-nest the chat." else "Could not nest the chat.") {
    api.nest(sessionId, parent)
    workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.map { if (it.sessionId == sessionId) it.copy(nestedIn = parent.ifEmpty { null }) else it }) }
}

fun Hub.archive(sessionId: String) = write("Could not archive the chat. It is still in the list.") {
    val row = workspace.value.saved.firstOrNull { it.sessionId == sessionId }
    val pinned = sessionId in workspace.value.pins
    api.archive(sessionId)
    workspace.value = workspace.value.let { w -> w.copy(saved = w.saved.filter { it.sessionId != sessionId }) }
    loadBin()
    undoable.tryEmit(Undoable("Archived") { restore(sessionId, row, pinned) })
}

private fun Hub.restore(sessionId: String, row: SavedSession?, pinned: Boolean) = write(RESTORE_FAILED) {
    api.restore(sessionId)
    if (row != null) workspace.value = withRestored(workspace.value, row, pinned)
    if (pinned) runCatching { api.pin(sessionId, true) }
    if (row == null) refreshWorkspace(force = true)
    loadBin()
}

private const val RESTORE_FAILED = "Could not restore the chat. It is still in the bin."

fun Hub.loadBin() {
    val from = origin.value
    viewModelScope.launch { runCatching { api.bin() }.onSuccess { if (from == origin.value) bin.value = it } }
}

fun Hub.restoreFromBin(sessionId: String) {
    if (readOnly) return
    viewModelScope.launch {
        val ok = runCatching { api.restore(sessionId) }.isSuccess
        notice.value = if (ok) "Chat restored" else RESTORE_FAILED
        if (ok) {
            bin.value = bin.value.filterNot { it.sessionId == sessionId }
            refreshWorkspace(force = true)
            loadBin()
        }
    }
}

fun Hub.deleteFromBin(sessionId: String) {
    if (readOnly) return
    viewModelScope.launch {
        val ok = runCatching { api.deleteChat(sessionId) }.isSuccess
        notice.value = if (ok) "Chat deleted" else "Could not delete the chat. It is still in the bin."
        if (ok) bin.value = bin.value.filterNot { it.sessionId == sessionId }
    }
}

fun Hub.emptyBin() = write("Could not empty the bin") {
    api.emptyBin()
    bin.value = emptyList()
}

fun Hub.pin(sessionId: String, on: Boolean, undo: Boolean = false): Unit = write("Could not ${if (on) "pin" else "unpin"} the chat. Try again.") {
    api.pin(sessionId, on)
    workspace.value = workspace.value.let { w -> w.copy(pins = if (on) w.pins + sessionId else w.pins - sessionId) }
    if (undo) undoable.tryEmit(Undoable(if (on) "Pinned" else "Unpinned") { pin(sessionId, !on) })
}
